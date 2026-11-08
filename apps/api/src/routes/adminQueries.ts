import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { hashIp } from '../lib/totpFlow.js';
import { decryptRaw } from '../lib/rawStore.js';
import { requirePermission } from '../permissions.js';
import { extractReturn, viewReport, type ReportV2 } from '../report/normalizeV2.js';
import type { NormalizedVehicle } from '../types.js';
import { renderVehiclePdf, type ReportMeta } from '../report/pdf.js';
import { env } from '../config.js';
import { getProvider } from '../providers/index.js';
import { canFetchSupplement, queriesMissingLien, refreshQueryGravame } from '../lib/lienRefresh.js';
import { runExclusive } from '../lib/providerGuard.js';
import { createSecureLink } from '../lib/secureLinks.js';
import { enqueueEmail } from '../lib/emailOutbox.js';
import { publicAppUrl } from '../config.js';
import { CLEANUP_KINDS, OPEN_CHECKOUT_HOURS, STUCK_HOURS, previewCleanup, runCleanup, type CleanupKind } from '../lib/queryCleanup.js';

/**
 * Consultas vistas pela equipe (LGPD): relatório com dados pessoais mascarados e revelação
 * pontual, motivada e auditada do valor original (decifrado do JSON bruto armazenado).
 */
export const adminQueriesRouter = Router();
adminQueriesRouter.use(adminAuth);

export const REVEALABLE_FIELDS = ['PRONOME', 'PRONOMEANTERIOR', 'CPF_CNPJ_PROPRIETARIO', 'CPFCNPJFATURADO', 'CPFCNPJCOMPRADOR', 'CHASSI', 'RENAVAM', 'MOTOR'] as const;

/**
 * Completa consultas já feitas com o gravame detalhado (Credify /gravame, uma chamada paga por consulta).
 * Sem "confirm", só informa quantas consultas precisam e quanto custa. Com "confirm", atualiza até "max" (padrão 25, teto 100) por vez.
 */
adminQueriesRouter.post('/refresh-gravame', requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const parsed = z.object({ confirm: z.boolean().default(false), max: z.number().int().min(1).max(100).default(25) }).safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const pending = await queriesMissingLien();
  if (!parsed.data.confirm) { res.json({ pending: pending.length }); return; }
  const provider = getProvider();
  if (!canFetchSupplement(provider)) throw appError('PROVIDER_NO_SUPPLEMENT', { code: 'PROVIDER_NO_SUPPLEMENT', http: 409, expose: true });
  const batch = pending.slice(0, parsed.data.max);
  let updated = 0; let failed = 0; let stopped: string | null = null;
  for (const id of batch) {
    try {
      const out = await runExclusive(`lien-refresh:${id}`, () => refreshQueryGravame(id, provider, req.user!.id));
      if (out === 'UPDATED') updated += 1;
    } catch (e) {
      failed += 1;
      const code = (e as { code?: string }).code ?? 'ERRO';
      // Limite de segurança, saldo ou limite da Credify: não adianta continuar.
      if (/BUDGET|QUOTA|RATE_LIMITED/.test(code)) { stopped = code; break; }
    }
  }
  await audit(req.user!.id, 'QUERIES_GRAVAME_REFRESH_BATCH', 'VEHICLE_QUERY', null, { updated, failed, stopped, requestId: requestId(req) });
  res.json({ updated, failed, stopped, remaining: Math.max(0, pending.length - updated) });
}));

/**
 * Limpeza do que não gerou receita: consultas que falharam ou travaram e pedidos sem pagamento.
 * Sem "confirm", só conta o que seria apagado (e o que fica por ter dinheiro envolvido). Com "confirm", apaga e audita.
 */
adminQueriesRouter.post('/cleanup', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = z.object({ kinds: z.array(z.enum(['FAILED', 'STUCK', 'UNPAID_ORDERS'])).min(1).max(3).optional(), confirm: z.boolean().default(false) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const kinds: CleanupKind[] = parsed.data.kinds ?? [...CLEANUP_KINDS];
  const preview = await previewCleanup(pool, kinds);
  if (!parsed.data.confirm) { res.json({ confirm: false, items: preview, rules: { stuckHours: STUCK_HOURS, openCheckoutHours: OPEN_CHECKOUT_HOURS } }); return; }
  const done = await tx((client) => runCleanup(client, kinds));
  await audit(req.user!.id, 'QUERY_CLEANUP', 'VEHICLE_QUERY', 'bulk', { kinds, deleted: done, requestId: requestId(req) });
  res.json({ confirm: true, deleted: done, items: await previewCleanup(pool, kinds) });
}));

adminQueriesRouter.post('/:id/refresh-gravame', requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const provider = getProvider();
  if (!canFetchSupplement(provider)) throw appError('PROVIDER_NO_SUPPLEMENT', { code: 'PROVIDER_NO_SUPPLEMENT', http: 409, expose: true });
  try {
    const out = await runExclusive(`lien-refresh:${req.params.id}`, () => refreshQueryGravame(String(req.params.id), provider, req.user!.id));
    res.json({ result: out });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'QUERY_IN_PROGRESS') throw e;
    throw appError('Não foi possível buscar o gravame agora. Nada foi alterado; tente novamente em instantes.', { code: code ?? 'PROVIDER_ERROR', http: 424, expose: true, showMessage: true });
  }
}));

adminQueriesRouter.get('/:id', requirePermission('VIEW_QUERIES'), asyncRoute(async (req, res) => {
  const row = await pool.query(`SELECT q.id,q.plate,q.status,q.price_cents,q.charge_source,q.provider,q.source,q.created_at,q.completed_at,q.error_code,q.error_message,
      p.id AS product_id,p.name AS product_name,u.name AS customer_name,u.email AS customer_email,r.normalized,(r.raw_enc IS NOT NULL) AS has_raw
    FROM vehicle_queries q JOIN users u ON u.id=q.user_id JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.id=$1`, [req.params.id]);
  if (!row.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  const q = row.rows[0] as Record<string, unknown>;
  const normalized = q.normalized as NormalizedVehicle | null;
  const report: ReportV2 | null = normalized?.v2 ? viewReport(normalized.v2, { audience: 'team', tier: 3 }) : null;
  res.json({
    id: q.id, plate: q.plate, status: q.status, priceCents: Number(q.price_cents ?? 0), chargeSource: q.charge_source, provider: q.provider, source: q.source,
    productId: q.product_id, productName: q.product_name, createdAt: q.created_at, completedAt: q.completed_at, errorCode: q.error_code, errorMessage: q.error_message,
    customer: { name: q.customer_name, email: q.customer_email }, hasRaw: Boolean(q.has_raw), revealableFields: REVEALABLE_FIELDS, report
  });
}));

/** PDF da consulta para a equipe (mesmo layout do cliente, com a visão completa do relatório). */
adminQueriesRouter.get('/:id/report/pdf', requirePermission('VIEW_QUERIES'), asyncRoute(async (req, res) => {
  const row = await pool.query(`SELECT q.id,q.created_at,q.completed_at,q.result_hash,p.name AS product_name,r.normalized
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1 AND q.status='SUCCESS'`, [req.params.id]);
  if (!row.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const q = row.rows[0] as Record<string, unknown>;
  const v2 = (q.normalized as NormalizedVehicle | null)?.v2;
  if (!v2) throw appError('REPORT_UNAVAILABLE', { code: 'REPORT_UNAVAILABLE', http: 409, expose: true });
  const report = viewReport(v2, { audience: 'team', tier: 3 });
  const code = String(q.id).slice(0, 8).toUpperCase();
  const base = (env.APP_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');
  const meta: ReportMeta = { productName: String(q.product_name), verificationCode: code, verificationUrl: `${base}/validar/${code}`, consultedAt: new Date(String(q.completed_at ?? q.created_at)), resultHash: q.result_hash ? String(q.result_hash) : null, audience: 'team' };
  await audit(req.user!.id, 'EXPORT_QUERY_REPORT_PDF', 'VEHICLE_QUERY', String(req.params.id), { requestId: requestId(req), area: 'admin' });
  res.setHeader('Content-Disposition', `attachment; filename="placa-na-mao-${code}.pdf"`);
  res.type('application/pdf').send(await renderVehiclePdf(report, meta));
}));

/**
 * Consulta interna (feita pelo painel) pronta para entregar: enviar para a conta do cliente (aparece no histórico dele, com aviso por e-mail)
 * ou gerar um link de visualização. Nada disso chama o provedor de novo nem cobra o cliente.
 */
const UUID = /^[0-9a-f-]{36}$/i;
async function deliverableQuery(id: string) {
  if (!UUID.test(id)) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query(`SELECT q.id,q.user_id,q.plate,q.product_id,q.provider,q.provider_query_id,q.result_hash,q.completed_at,q.request_metadata,p.name AS product_name,
      r.normalized,r.raw_response,r.raw_enc,r.normalizer_version
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1 AND q.status='SUCCESS'`, [id]);
  if (!r.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const row = r.rows[0] as Record<string, unknown>;
  if (!(row.normalized as NormalizedVehicle | null)?.v2) throw appError('REPORT_UNAVAILABLE', { code: 'REPORT_UNAVAILABLE', http: 409, expose: true });
  return row;
}

const sendBody = z.object({ email: z.string().trim().toLowerCase().email().max(254), note: z.string().trim().max(500).optional() }).strict();
adminQueriesRouter.post('/:id/send', requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const parsed = sendBody.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const src = await deliverableQuery(String(req.params.id));
  const customer = await pool.query(`SELECT id,name,email FROM users WHERE lower(email)=$1 AND role='CLIENTE' AND active=true`, [parsed.data.email]);
  if (!customer.rowCount) throw appError('Não há cliente ativo com esse e-mail. Confira o endereço ou peça para a pessoa criar a conta.', { code: 'CUSTOMER_NOT_FOUND', http: 404, expose: true, showMessage: true });
  const target = customer.rows[0] as { id: string; name: string; email: string };
  let copyId = String(src.id);
  let alreadyThere = true;
  if (src.user_id !== target.id) {
    // Uma cópia por cliente: reenviar não duplica a consulta no histórico dele.
    const existing = await pool.query(`SELECT id FROM vehicle_queries WHERE user_id=$1 AND request_metadata->>'sentFrom'=$2 LIMIT 1`, [target.id, String(src.id)]);
    if (existing.rowCount) copyId = String(existing.rows[0].id);
    else {
      alreadyThere = false;
      copyId = await tx(async (client) => {
        const c = await client.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,provider_query_id,result_hash,request_metadata,source,search_type,completed_at)
          VALUES($1,$2,$3,'SUCCESS',0,0,'ADMIN_INTERNAL',$4,$5,$6,$7::jsonb,'ADMIN','PLATE',$8) RETURNING id`,
        [target.id, src.plate, src.product_id, src.provider, src.provider_query_id, src.result_hash, JSON.stringify({ sentFrom: String(src.id), sentBy: req.user!.id, requestId: requestId(req) }), src.completed_at]);
        const id = c.rows[0].id as string;
        await client.query('INSERT INTO vehicle_query_results(query_id,normalized,raw_response,raw_enc,normalizer_version) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)', [id, JSON.stringify(src.normalized), JSON.stringify(src.raw_response ?? {}), src.raw_enc ?? null, src.normalizer_version ?? null]);
        return id;
      });
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const note = parsed.data.note ? `\n\nMensagem da equipe: ${parsed.data.note}` : '';
  await enqueueEmail({
    idempotencyKey: `admin-send:${copyId}:${day}`, template: 'GENERIC_NOTICE', toEmail: target.email, toName: target.name,
    data: { name: target.name, documentTitle: `Seu relatório do veículo ${String(src.plate)} está pronto`, message: `A equipe do Placa na Mão preparou o relatório do veículo ${String(src.plate)} (${String(src.product_name)}) para você. Ele já está no seu histórico de consultas, sem nenhuma cobrança: ${publicAppUrl()}/app/consulta/${copyId}${note}` },
    relatedType: 'ADMIN_QUERY_SEND', relatedId: copyId
  });
  await audit(req.user!.id, 'ADMIN_QUERY_SENT', 'VEHICLE_QUERY', String(src.id), { copyId, customerId: target.id, alreadyThere, requestId: requestId(req) });
  res.status(201).json({ queryId: copyId, customer: { name: target.name, email: target.email }, url: `${publicAppUrl()}/app/consulta/${copyId}` });
}));

const SHARE_MAX_ACTIVE = 10;
adminQueriesRouter.post('/:id/share', requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const parsed = z.object({ days: z.coerce.number().int().min(1).max(15).default(7) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const src = await deliverableQuery(String(req.params.id));
  const active = await pool.query(`SELECT count(*)::int AS n FROM secure_links WHERE purpose='REPORT_SHARE' AND resource_type='VEHICLE_QUERY' AND resource_id=$1 AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses`, [String(src.id)]);
  if (Number(active.rows[0].n) >= SHARE_MAX_ACTIVE) throw appError(`Esta consulta já tem ${SHARE_MAX_ACTIVE} links ativos. Revogue um para criar outro.`, { code: 'SHARE_LIMIT', http: 409, expose: true, showMessage: true });
  const link = await createSecureLink({ purpose: 'REPORT_SHARE', resourceType: 'VEHICLE_QUERY', resourceId: String(src.id), ttlHours: parsed.data.days * 24, maxUses: 100, createdBy: req.user!.id });
  await audit(req.user!.id, 'REPORT_SHARE_CREATED', 'VEHICLE_QUERY', String(src.id), { linkId: link.id, days: parsed.data.days, area: 'admin', requestId: requestId(req) });
  res.status(201).json({ id: link.id, url: `${publicAppUrl()}/r/${link.token}`, expiresAt: link.expiresAt, maxViews: 100 });
}));

adminQueriesRouter.get('/:id/shares', requirePermission('VIEW_QUERIES'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query(`SELECT id,created_at,expires_at,uses,max_uses FROM secure_links WHERE purpose='REPORT_SHARE' AND resource_type='VEHICLE_QUERY' AND resource_id=$1 AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses ORDER BY created_at DESC`, [id]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(r.rows.map((x) => ({ id: x.id, createdAt: x.created_at, expiresAt: x.expires_at, views: Number(x.uses), maxViews: Number(x.max_uses) })));
}));

adminQueriesRouter.delete('/:id/shares/:linkId', requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const id = String(req.params.id); const linkId = String(req.params.linkId);
  if (!UUID.test(id) || !UUID.test(linkId)) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query(`UPDATE secure_links SET revoked_at=now() WHERE id=$1 AND purpose='REPORT_SHARE' AND resource_type='VEHICLE_QUERY' AND resource_id=$2 AND revoked_at IS NULL`, [linkId, id]);
  if (!r.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'REPORT_SHARE_REVOKED', 'VEHICLE_QUERY', id, { linkId, area: 'admin', requestId: requestId(req) });
  res.json({ revoked: true });
}));

const revealSchema = z.object({ field: z.enum(REVEALABLE_FIELDS), reason: z.string().trim().min(10).max(280) });

adminQueriesRouter.post('/:id/reveal', requirePermission('REVEAL_PII'), asyncRoute(async (req, res) => {
  const parsed = revealSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const row = await pool.query('SELECT r.raw_enc FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1', [req.params.id]);
  if (!row.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  if (!row.rows[0].raw_enc) throw appError('RAW_NOT_STORED', { code: 'RAW_NOT_STORED', http: 409, expose: true });
  let value: string | null = null;
  try {
    const raw = decryptRaw(String(row.rows[0].raw_enc));
    const ret = extractReturn(raw);
    const found = ret ? Object.entries(ret).find(([k]) => k.toUpperCase() === parsed.data.field)?.[1] : undefined;
    value = found == null || (Array.isArray(found) && !found.length) || found === '' ? null : String(Array.isArray(found) ? found[0] : found);
  } catch {
    throw appError('RAW_DECRYPT_FAILED', { code: 'RAW_DECRYPT_FAILED', http: 500, expose: true });
  }
  // A revelação é registrada ANTES de devolver o dado e nunca guarda o valor revelado.
  await pool.query('INSERT INTO pii_reveals(user_id,query_id,field,reason,ip_hash) VALUES($1,$2,$3,$4,$5)', [req.user!.id, req.params.id, parsed.data.field, parsed.data.reason, hashIp(req.ip ?? '')]);
  await audit(req.user!.id, 'PII_REVEAL', 'VEHICLE_QUERY', String(req.params.id), { field: parsed.data.field, reason: parsed.data.reason, requestId: requestId(req) });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ field: parsed.data.field, value });
}));

adminQueriesRouter.get('/:id/reveals', requirePermission('VIEW_AUDIT'), asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT v.id,v.field,v.reason,v.created_at,u.name,u.email FROM pii_reveals v JOIN users u ON u.id=v.user_id WHERE v.query_id=$1 ORDER BY v.created_at DESC LIMIT 100`, [req.params.id]);
  res.json(r.rows.map((x) => ({ id: x.id, field: x.field, reason: x.reason, createdAt: x.created_at, by: { name: x.name, email: x.email } })));
}));
