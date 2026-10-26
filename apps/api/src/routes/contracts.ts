import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { env } from '../config.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import * as C from '../lib/contracts.js';
import { ensureContractModels, CONTRACT_VARIABLES, CONTRACT_VARIABLE_DOCS } from '../lib/contractModels.js';
import { requirePermission } from '../permissions.js';
import { rateLimit } from 'express-rate-limit';

const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const uuid = z.string().uuid();
const idOf = (req: Request) => { const p = uuid.safeParse(req.params.id); if (!p.success) throw bad(); return p.data; };

export const adminContractsRouter = Router();
adminContractsRouter.use(adminAuth);
const view = requirePermission('VIEW_CONTRACTS');
const manage = requirePermission('MANAGE_CONTRACTS');
const approver = requirePermission('APPROVE_CONTRACTS');
const pricing = requirePermission('MANAGE_PRICING');

// ------------------------------------------------------------- modelos

adminContractsRouter.get('/contract-models', view, asyncRoute(async (_req, res) => {
  await ensureContractModels();
  const t = await pool.query(`SELECT t.id,t.code,t.name,t.kind,
    COALESCE(json_agg(json_build_object('id',v.id,'version',v.version,'status',v.status,'title',v.title,'legalReviewRef',v.legal_review_ref,'approvedAt',v.approved_at,'publishedAt',v.published_at) ORDER BY v.version DESC) FILTER (WHERE v.id IS NOT NULL),'[]') AS versions
    FROM contract_templates t LEFT JOIN contract_template_versions v ON v.template_id=t.id GROUP BY t.id ORDER BY t.name`);
  res.json({ items: t.rows, variables: CONTRACT_VARIABLES, notice: 'Minutas. Só publique depois de revisão jurídica.' });
}));

adminContractsRouter.get('/contract-model-versions/:id', view, asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,template_id,version,status,title,body,legal_review_ref,approved_at,published_at FROM contract_template_versions WHERE id=$1', [idOf(req)]);
  if (!r.rowCount) throw appError('CONTRACT_MODEL_NOT_FOUND', { code: 'CONTRACT_MODEL_NOT_FOUND', http: 404, expose: true });
  res.json(r.rows[0]);
}));

const versionBody = z.object({ title: z.string().trim().min(5).max(200), body: z.string().min(50).max(40000) }).strict();

adminContractsRouter.get('/contract-variables', view, asyncRoute(async (_req, res) => { res.json({ items: CONTRACT_VARIABLE_DOCS }); }));

/** Pré-visualiza uma minuta (ainda não salva) com dados fictícios; devolve também as variáveis desconhecidas. */
adminContractsRouter.post('/contract-models/preview', manage, asyncRoute(async (req, res) => {
  const b = versionBody.safeParse(req.body); if (!b.success) throw bad();
  const unknown = C.unknownVariables(`${b.data.title}\n${b.data.body}`);
  if (unknown.length) { res.json({ ok: false, unknown, text: '' }); return; }
  const vars = C.sampleVars();
  res.json({ ok: true, unknown: [], text: `${C.renderBody(b.data.title, vars)}\n\n${C.renderBody(b.data.body, vars)}` });
}));

adminContractsRouter.post('/contract-models/:id/versions', manage, asyncRoute(async (req, res) => {
  const b = versionBody.safeParse(req.body); if (!b.success) throw bad();
  const unknown = C.unknownVariables(`${b.data.title}\n${b.data.body}`);
  if (unknown.length) { res.status(400).json({ error: 'CONTRACT_VARIABLE_UNKNOWN', message: `Variáveis desconhecidas: ${unknown.join(', ')}` }); return; }
  const t = await pool.query('SELECT id FROM contract_templates WHERE id=$1', [idOf(req)]);
  if (!t.rowCount) throw appError('CONTRACT_MODEL_NOT_FOUND', { code: 'CONTRACT_MODEL_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query(`INSERT INTO contract_template_versions(template_id,version,title,body,created_by)
    VALUES($1,(SELECT COALESCE(MAX(version),0)+1 FROM contract_template_versions WHERE template_id=$1),$2,$3,$4) RETURNING id,version,status`, [t.rows[0].id, b.data.title, b.data.body, req.user!.id]);
  await audit(req.user!.id, 'CONTRACT_MODEL_VERSION_CREATED', 'CONTRACT_TEMPLATE', t.rows[0].id, { version: r.rows[0].version, requestId: requestId(req) });
  res.status(201).json(r.rows[0]);
}));

adminContractsRouter.patch('/contract-model-versions/:id', manage, asyncRoute(async (req, res) => {
  const b = versionBody.partial().strict().safeParse(req.body); if (!b.success || !Object.keys(b.data).length) throw bad();
  const unknown = C.unknownVariables(`${b.data.title ?? ''}\n${b.data.body ?? ''}`);
  if (unknown.length) { res.status(400).json({ error: 'CONTRACT_VARIABLE_UNKNOWN', message: `Variáveis desconhecidas: ${unknown.join(', ')}` }); return; }
  const r = await pool.query(`UPDATE contract_template_versions SET title=COALESCE($2,title),body=COALESCE($3,body),updated_at=now() WHERE id=$1 AND status='DRAFT' RETURNING id`, [idOf(req), b.data.title ?? null, b.data.body ?? null]);
  if (!r.rowCount) throw appError('CONTRACT_MODEL_NOT_EDITABLE', { code: 'CONTRACT_MODEL_NOT_EDITABLE', http: 409, expose: true });
  await audit(req.user!.id, 'CONTRACT_MODEL_VERSION_EDITED', 'CONTRACT_TEMPLATE_VERSION', r.rows[0].id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

adminContractsRouter.post('/contract-model-versions/:id/submit', manage, asyncRoute(async (req, res) => {
  const r = await pool.query(`UPDATE contract_template_versions SET status='IN_REVIEW',updated_at=now() WHERE id=$1 AND status='DRAFT' RETURNING id`, [idOf(req)]);
  if (!r.rowCount) throw appError('CONTRACT_MODEL_INVALID_STATE', { code: 'CONTRACT_MODEL_INVALID_STATE', http: 409, expose: true });
  await audit(req.user!.id, 'CONTRACT_MODEL_SUBMITTED', 'CONTRACT_TEMPLATE_VERSION', r.rows[0].id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

/** Aprovação jurídica: exige a referência do parecer e uma pessoa diferente de quem escreveu a versão. */
adminContractsRouter.post('/contract-model-versions/:id/approve', approver, asyncRoute(async (req, res) => {
  const b = z.object({ legalReviewRef: z.string().trim().min(5).max(300) }).strict().safeParse(req.body); if (!b.success) throw bad('LEGAL_REVIEW_REF_REQUIRED');
  const v = await pool.query('SELECT created_by,status FROM contract_template_versions WHERE id=$1', [idOf(req)]);
  if (!v.rowCount) throw appError('CONTRACT_MODEL_NOT_FOUND', { code: 'CONTRACT_MODEL_NOT_FOUND', http: 404, expose: true });
  if (v.rows[0].status !== 'IN_REVIEW') throw appError('CONTRACT_MODEL_INVALID_STATE', { code: 'CONTRACT_MODEL_INVALID_STATE', http: 409, expose: true });
  if (v.rows[0].created_by && v.rows[0].created_by === req.user!.id) throw appError('CONTRACT_APPROVER_MUST_DIFFER', { code: 'CONTRACT_APPROVER_MUST_DIFFER', http: 403, expose: true });
  await pool.query(`UPDATE contract_template_versions SET status='APPROVED',legal_review_ref=$2,approved_by=$3,approved_at=now(),updated_at=now() WHERE id=$1`, [idOf(req), b.data.legalReviewRef, req.user!.id]);
  await audit(req.user!.id, 'CONTRACT_MODEL_APPROVED', 'CONTRACT_TEMPLATE_VERSION', idOf(req), { legalReviewRef: b.data.legalReviewRef, requestId: requestId(req) });
  res.json({ ok: true });
}));

adminContractsRouter.post('/contract-model-versions/:id/publish', approver, asyncRoute(async (req, res) => {
  const id = idOf(req);
  const v = await pool.query('SELECT template_id,status,legal_review_ref FROM contract_template_versions WHERE id=$1', [id]);
  if (!v.rowCount) throw appError('CONTRACT_MODEL_NOT_FOUND', { code: 'CONTRACT_MODEL_NOT_FOUND', http: 404, expose: true });
  if (!['APPROVED', 'RETIRED'].includes(v.rows[0].status) || !v.rows[0].legal_review_ref) throw appError('CONTRACT_MODEL_NOT_APPROVED', { code: 'CONTRACT_MODEL_NOT_APPROVED', http: 409, expose: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE contract_template_versions SET status='RETIRED',updated_at=now() WHERE template_id=$1 AND status='PUBLISHED'`, [v.rows[0].template_id]);
    await client.query(`UPDATE contract_template_versions SET status='PUBLISHED',published_at=now(),updated_at=now() WHERE id=$1`, [id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await audit(req.user!.id, 'CONTRACT_MODEL_PUBLISHED', 'CONTRACT_TEMPLATE_VERSION', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

// ------------------------------------------------------------- contratos

const createBody = z.object({
  templateCode: z.enum(['PF_AVULSO', 'PJ_B2B', 'PACOTE_PERSONALIZADO', 'PARCEIRO', 'ADITIVO']),
  userId: uuid.optional(), organizationId: uuid.optional(), affiliateId: uuid.optional(), document: z.string().trim().max(30).optional(),
  signer: z.object({ name: z.string(), email: z.string() }), terms: C.termsSchema, parentContractId: uuid.optional()
}).strict().refine((v) => [v.userId, v.organizationId, v.affiliateId].filter(Boolean).length === 1, 'ONE_PARTY');

const send = (res: import('express').Response, err: unknown) => {
  if (err instanceof z.ZodError) { res.status(400).json({ error: 'INVALID_INPUT', message: 'Revise os dados informados e tente novamente.' }); return true; }
  const d = (err as { details?: unknown }).details;
  if (d && (err as { code?: string }).code === 'PRICE_BELOW_FLOOR') { res.status(422).json({ error: 'PRICE_BELOW_FLOOR', message: 'Preço abaixo do piso permitido para este produto.', details: d }); return true; }
  return false;
};

adminContractsRouter.get('/contracts', view, asyncRoute(async (req, res) => {
  await C.expireOverdue();
  const q = z.object({ status: z.string().max(30).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query); if (!q.success) throw bad();
  const r = await pool.query(`SELECT c.id,c.number,c.kind,c.status,c.party->>'name' AS party_name,c.party->>'type' AS party_type,c.created_at,c.sent_at,c.signed_at,c.expires_at,c.applied_at
    FROM contracts c WHERE ($1::text IS NULL OR c.status=$1) ORDER BY c.created_at DESC LIMIT $2`, [q.data.status ?? null, q.data.limit]);
  res.json({ items: r.rows, esign: { provider: env.ESIGN_PROVIDER, available: C.esignAvailable() } });
}));

adminContractsRouter.post('/contracts/preview', manage, asyncRoute(async (req, res) => {
  const b = createBody.safeParse(req.body); if (!b.success) throw bad();
  try { res.json(await C.previewContract(b.data)); } catch (e) { if (!send(res, e)) throw e; }
}));

adminContractsRouter.post('/contracts', manage, asyncRoute(async (req, res) => {
  const b = createBody.safeParse(req.body); if (!b.success) throw bad();
  try {
    const c = await C.createContract(b.data, req.user!.id);
    await audit(req.user!.id, 'CONTRACT_CREATED', 'CONTRACT', c.id, { number: c.number, requestId: requestId(req) });
    res.status(201).json(c);
  } catch (e) { if (!send(res, e)) throw e; }
}));

adminContractsRouter.get('/contracts/:id', view, asyncRoute(async (req, res) => {
  const id = idOf(req);
  const c = await pool.query(`SELECT id,number,kind,status,party,terms,rendered_body,body_hash,created_by,approved_by,approved_at,sent_at,expires_at,signed_at,cancel_reason,applied_at,created_at FROM contracts WHERE id=$1`, [id]);
  if (!c.rowCount) throw appError('CONTRACT_NOT_FOUND', { code: 'CONTRACT_NOT_FOUND', http: 404, expose: true });
  const [signers, events] = await Promise.all([
    pool.query(`SELECT id,name,email,role,status,signed_at,evidence->>'method' AS method,evidence->>'ipHash' AS ip_hash FROM contract_signers WHERE contract_id=$1`, [id]),
    pool.query('SELECT event,actor_user_id,detail,created_at FROM contract_events WHERE contract_id=$1 ORDER BY id', [id])
  ]);
  res.json({ ...c.rows[0], signers: signers.rows, events: events.rows });
}));

adminContractsRouter.patch('/contracts/:id', manage, asyncRoute(async (req, res) => {
  const b = z.object({ terms: C.termsSchema.optional(), signer: z.object({ name: z.string(), email: z.string() }).optional(), document: z.string().trim().max(30).optional() }).strict().safeParse(req.body);
  if (!b.success || !Object.keys(b.data).length) throw bad();
  try { const r = await C.updateDraft(idOf(req), b.data, req.user!.id); await audit(req.user!.id, 'CONTRACT_EDITED', 'CONTRACT', r.id, { requestId: requestId(req) }); res.json({ ok: true }); } catch (e) { if (!send(res, e)) throw e; }
}));

const reason = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const flow = (path: string, perm: import('express').RequestHandler, action: string, run: (id: string, actor: string, body: Request['body']) => Promise<unknown>, body?: z.ZodTypeAny) => {
  adminContractsRouter.post(`/contracts/:id/${path}`, perm, asyncRoute(async (req, res) => {
    const parsed = body ? body.safeParse(req.body) : { success: true as const, data: undefined };
    if (!parsed.success) throw bad();
    const out = await run(idOf(req), req.user!.id, parsed.data);
    await audit(req.user!.id, action, 'CONTRACT', idOf(req), { requestId: requestId(req) });
    res.json({ ok: true, ...(out && typeof out === 'object' ? out : {}) });
  }));
};
flow('submit', manage, 'CONTRACT_SUBMITTED', (id, a) => C.submitForApproval(id, a));
flow('approve', approver, 'CONTRACT_APPROVED', (id, a) => C.approve(id, a));
flow('reject', approver, 'CONTRACT_REJECTED', (id, a, b) => C.reject(id, a, b.reason), reason);
flow('cancel', manage, 'CONTRACT_CANCELLED', (id, a, b) => C.cancel(id, a, b.reason), reason);
flow('send', manage, 'CONTRACT_SENT_FOR_SIGNATURE', (id, a) => C.sendForSignature(id, a));
flow('apply', pricing, 'CONTRACT_TERMS_APPLIED', (id, a) => C.applyTerms(id, a));


// ------------------------------------------------------------- contratos de compra (adesão)

adminContractsRouter.get('/purchase-contracts', view, asyncRoute(async (req, res) => {
  const q = z.object({ q: z.string().trim().max(120).optional(), orderId: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query); if (!q.success) throw bad();
  const like = q.data.q ? `%${q.data.q.replace(/[%_]/g, '')}%` : null;
  const r = await pool.query(`SELECT c.id,c.number,c.kind,c.status,c.amount_cents,c.accepted_at,c.created_at,c.order_id,c.party->>'name' AS party_name,c.party->>'email' AS party_email,o.status AS order_status
    FROM purchase_contracts c LEFT JOIN payment_orders o ON o.id=c.order_id
    WHERE c.accepted_at IS NOT NULL AND ($1::uuid IS NULL OR c.order_id=$1) AND ($2::text IS NULL OR c.number ILIKE $2 OR c.party->>'name' ILIKE $2 OR c.party->>'email' ILIKE $2)
    ORDER BY c.accepted_at DESC LIMIT $3`, [q.data.orderId ?? null, like, q.data.limit]);
  res.json({ items: r.rows });
}));

adminContractsRouter.get('/purchase-contracts/:id', view, asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT id,number,user_id,kind,item_key,status,amount_cents,model_version,party,body,body_hash,otp_channel,otp_destination,otp_sent_count,accepted_at,accept_ip_hash,accept_user_agent,order_id,created_at FROM purchase_contracts WHERE id=$1`, [idOf(req)]);
  if (!r.rowCount) throw appError('PURCHASE_CONTRACT_NOT_FOUND', { code: 'PURCHASE_CONTRACT_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'PURCHASE_CONTRACT_VIEWED', 'PURCHASE_CONTRACT', r.rows[0].id, { requestId: requestId(req) });
  res.json(r.rows[0]);
}));

// ------------------------------------------------------------- páginas públicas (token)

export const contractsPublicRouter = Router();
const limiter = rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
contractsPublicRouter.use(limiter);
const noStore = (res: import('express').Response) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); };

contractsPublicRouter.get('/sign/:token', asyncRoute(async (req, res) => {
  noStore(res);
  const v = await C.viewForSigning(String(req.params.token));
  if (!v) { res.status(404).json({ error: 'LINK_INVALID', message: 'Link inválido ou expirado.' }); return; }
  res.json(v);
}));

const signBody = z.object({ name: z.string().trim().min(3).max(120), accept: z.boolean(), bodyHash: z.string().length(64) }).strict();
const SIGN_STATUS: Record<string, [number, string]> = {
  INVALID_LINK: [404, 'Link inválido ou expirado.'], NOT_OPEN: [409, 'Este contrato não está mais aberto para assinatura.'],
  HASH_MISMATCH: [409, 'O contrato mudou. Recarregue a página e leia novamente.'], NAME_MISMATCH: [422, 'Digite seu nome exatamente como aparece no contrato.'], NOT_ACCEPTED: [422, 'Marque a opção de aceite para assinar.']
};
contractsPublicRouter.post('/sign/:token', asyncRoute(async (req, res) => {
  noStore(res);
  const b = signBody.safeParse(req.body); if (!b.success) throw bad();
  const r = await C.signWithToken(String(req.params.token), b.data, { ip: req.ip ?? '', userAgent: String(req.headers['user-agent'] ?? '') });
  if (r === 'SIGNED') { res.json({ ok: true }); return; }
  const [status, message] = SIGN_STATUS[r]!;
  res.status(status).json({ error: `SIGN_${r}`, message });
}));

contractsPublicRouter.get('/view/:token', asyncRoute(async (req, res) => {
  noStore(res);
  const v = await C.viewSigned(String(req.params.token));
  if (!v) { res.status(404).json({ error: 'LINK_INVALID', message: 'Link inválido ou expirado.' }); return; }
  res.json(v);
}));
