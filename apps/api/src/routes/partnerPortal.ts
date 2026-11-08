import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { auth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { PIX_KEY_TYPES, maskPixKey, normalizePixKey } from '../lib/pix.js';
import { saveUserPix } from '../lib/pixStore.js';

/**
 * Portal do parceiro: convite por link (público para ler, conta logada para aceitar) e o painel com
 * comissão, receita, vendas, clientes e consultas dos indicados. Só mostra dados do próprio parceiro e
 * sempre mascarados (primeiro nome, e-mail e placa parciais): o parceiro não recebe dados pessoais completos dos clientes.
 */
export const partnerPortalRouter = Router();

const tokenSchema = z.string().trim().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/);

export const maskEmail = (email: unknown): string => {
  const s = String(email ?? '');
  const [local, domain] = s.split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(5, local.length - 1)))}@${domain}`;
};
export const firstName = (name: unknown): string => String(name ?? '').trim().split(/\s+/)[0] ?? '';
export const maskPlate = (plate: unknown): string => {
  const s = String(plate ?? '').toUpperCase();
  return s.length >= 4 ? `${s.slice(0, 3)}${'*'.repeat(s.length - 3)}` : '***';
};

type InviteRow = { id: string; name: string | null; email: string | null; code: string | null; partner_type: string; commission_bps: number; commission_base: string | null; expires_at: Date; used_at: Date | null; revoked_at: Date | null };
const invitePlace = (r: InviteRow): 'OK' | 'USED' | 'REVOKED' | 'EXPIRED' => r.used_at ? 'USED' : r.revoked_at ? 'REVOKED' : new Date(r.expires_at).getTime() < Date.now() ? 'EXPIRED' : 'OK';

/** Página do convite: diz se o link vale e para quem é (sem expor a comissão combinada). */
partnerPortalRouter.get('/partner-invites/:token', asyncRoute(async (req, res) => {
  const token = tokenSchema.safeParse(req.params.token);
  if (!token.success) throw appError('INVITE_NOT_FOUND', { code: 'INVITE_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query('SELECT * FROM partner_invites WHERE token=$1', [token.data]);
  if (!r.rowCount) throw appError('INVITE_NOT_FOUND', { code: 'INVITE_NOT_FOUND', http: 404, expose: true });
  const row = r.rows[0] as InviteRow;
  const state = invitePlace(row);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ valid: state === 'OK', state, name: row.name, emailHint: row.email ? maskEmail(row.email) : null, expiresAt: row.expires_at });
}));

/** A chave PIX é obrigatória para o parceiro (é por ela que ele recebe o repasse): vem no aceite ou já está no perfil da conta. */
const pixFields = { pixKey: z.string().trim().max(140).optional(), pixKeyType: z.enum(PIX_KEY_TYPES).optional() };
const acceptSchema = z.object({ token: tokenSchema, ...pixFields }).strict();
const pixSchema = z.object({ pixKey: z.string().trim().min(1).max(140), pixKeyType: z.enum(PIX_KEY_TYPES).optional() }).strict();

/** Quem está logado aceita o convite: vira parceiro com a comissão e o tipo definidos pelo painel. */
partnerPortalRouter.post('/affiliate/accept-invite', auth, asyncRoute(async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const sentPix = parsed.data.pixKey ? normalizePixKey(parsed.data.pixKey, parsed.data.pixKeyType) : null;
  if (parsed.data.pixKey && !sentPix) throw appError('INVALID_PIX_KEY', { code: 'INVALID_PIX_KEY', http: 400, expose: true });
  const out = await tx(async (client) => {
    const found = await client.query('SELECT * FROM partner_invites WHERE token=$1 FOR UPDATE', [parsed.data.token]);
    if (!found.rowCount) throw appError('INVITE_NOT_FOUND', { code: 'INVITE_NOT_FOUND', http: 404, expose: true });
    const inv = found.rows[0] as InviteRow & { id: string };
    const state = invitePlace(inv);
    if (state === 'USED') throw appError('INVITE_USED', { code: 'INVITE_USED', http: 410, expose: true });
    if (state === 'REVOKED') throw appError('INVITE_REVOKED', { code: 'INVITE_REVOKED', http: 410, expose: true });
    if (state === 'EXPIRED') throw appError('INVITE_EXPIRED', { code: 'INVITE_EXPIRED', http: 410, expose: true });
    const account = await client.query('SELECT name,email FROM users WHERE id=$1 AND active=true', [req.user!.id]);
    if (!account.rowCount) throw appError('ACCOUNT_NOT_FOUND', { code: 'ACCOUNT_NOT_FOUND', http: 404, expose: true });
    const { name, email } = account.rows[0] as { name: string; email: string };
    if (inv.email && String(email).toLowerCase() !== String(inv.email).toLowerCase()) throw appError('INVITE_EMAIL_MISMATCH', { code: 'INVITE_EMAIL_MISMATCH', http: 403, expose: true });

    const have = await client.query(`SELECT coalesce(p.pix_key,(SELECT a.pix_key FROM affiliates a WHERE a.user_id=$1)) AS pix FROM (SELECT 1) x LEFT JOIN user_profiles p ON p.user_id=$1`, [req.user!.id]);
    if (!sentPix && !have.rows[0]?.pix) throw appError('PIX_KEY_REQUIRED', { code: 'PIX_KEY_REQUIRED', http: 400, expose: true });
    const existing = await client.query('SELECT id,code FROM affiliates WHERE user_id=$1', [req.user!.id]);
    let affiliateId: string; let affiliateCode: string;
    if (existing.rowCount) {
      // Já tinha o "Indique e ganhe": o convite passa a valer as condições combinadas (comissão, tipo e base).
      const u = await client.query(`UPDATE affiliates SET partner_type=$2, commission_bps=$3, commission_base=$4, active=true, updated_at=now() WHERE id=$1 RETURNING id,code`, [existing.rows[0].id, inv.partner_type, inv.commission_bps, inv.commission_base]);
      affiliateId = String(u.rows[0].id); affiliateCode = String(u.rows[0].code);
    } else {
      let code = inv.code ? inv.code.toUpperCase() : `PNM-${randomBytes(5).toString('hex').toUpperCase()}`;
      for (let i = 0; i < 5; i += 1) {
        const taken = await client.query('SELECT 1 FROM affiliates WHERE code=$1', [code]);
        if (!taken.rowCount) break;
        if (inv.code && i === 0) throw appError('PARTNER_CODE_EXISTS', { code: 'PARTNER_CODE_EXISTS', http: 409, expose: true });
        code = `PNM-${randomBytes(5).toString('hex').toUpperCase()}`;
      }
      const ins = await client.query(
        `INSERT INTO affiliates(user_id,name,email,code,partner_type,commission_bps,commission_base,active) VALUES($1,$2,$3,$4,$5,$6,$7,true) RETURNING id,code`,
        [req.user!.id, inv.name || name, email, code, inv.partner_type, inv.commission_bps, inv.commission_base]
      );
      affiliateId = String(ins.rows[0].id); affiliateCode = String(ins.rows[0].code);
    }
    await client.query('UPDATE partner_invites SET used_at=now(), used_by=$2, affiliate_id=$3 WHERE id=$1', [inv.id, req.user!.id, affiliateId]);
    if (sentPix) await saveUserPix(client, req.user!.id, sentPix, 'force');
    else await client.query(`UPDATE affiliates SET pix_key=(SELECT pix_key FROM user_profiles WHERE user_id=$1) WHERE id=$2 AND pix_key IS NULL`, [req.user!.id, affiliateId]);
    await client.query(`UPDATE users SET active_profile='AFILIADO' WHERE id=$1`, [req.user!.id]);
    return { id: affiliateId, code: affiliateCode, inviteId: inv.id };
  });
  await audit(req.user!.id, 'ACCEPT_PARTNER_INVITE', 'PARTNER_INVITE', out.inviteId, { requestId: requestId(req), affiliateId: out.id });
  res.status(201).json({ affiliate: { id: out.id, code: out.code } });
}));

/** O parceiro informa ou troca a chave PIX em que recebe o repasse. Vale também para o perfil da conta (reembolso e cashback). */
partnerPortalRouter.put('/affiliate/pix', auth, asyncRoute(async (req, res) => {
  const parsed = pixSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const pix = normalizePixKey(parsed.data.pixKey, parsed.data.pixKeyType);
  if (!pix) throw appError('INVALID_PIX_KEY', { code: 'INVALID_PIX_KEY', http: 400, expose: true });
  const aff = await pool.query('SELECT id FROM affiliates WHERE user_id=$1', [req.user!.id]);
  if (!aff.rowCount) throw appError('AFFILIATE_NOT_FOUND', { code: 'AFFILIATE_NOT_FOUND', http: 404, expose: true });
  await tx((client) => saveUserPix(client, req.user!.id, pix, 'force'));
  await audit(req.user!.id, 'PARTNER_PIX_UPDATED', 'AFFILIATE', String(aff.rows[0].id), { requestId: requestId(req) });
  res.json({ pix: { set: true, type: pix.type, masked: maskPixKey(pix.key, pix.type) } });
}));

/** Painel do parceiro: totais, comissões, clientes e consultas dos indicados (dados mascarados). */
partnerPortalRouter.get('/affiliate/panel', auth, asyncRoute(async (req, res) => {
  const a = await pool.query(`SELECT a.id,a.code,a.name,a.commission_bps,a.partner_type,a.active,coalesce(a.pix_key,p.pix_key) AS pix_key,p.pix_key_type FROM affiliates a LEFT JOIN user_profiles p ON p.user_id=a.user_id WHERE a.user_id=$1`, [req.user!.id]);
  if (!a.rowCount) { res.json({ affiliate: null }); return; }
  const aff = a.rows[0] as { id: string; code: string; name: string; commission_bps: number; partner_type: string; active: boolean; pix_key: string | null; pix_key_type: string | null };
  const me = String(req.user!.id);
  const [totals, revenue, clients, queries, sales, payouts] = await Promise.all([
    pool.query(`SELECT
        coalesce(sum(amount_cents) FILTER (WHERE status='PENDING'),0)::int AS pending,
        coalesce(sum(amount_cents) FILTER (WHERE status='AVAILABLE' AND payout_id IS NULL),0)::int AS available,
        coalesce(sum(amount_cents) FILTER (WHERE status='AVAILABLE' AND payout_id IS NOT NULL),0)::int AS in_payout,
        coalesce(sum(amount_cents) FILTER (WHERE status='PAID'),0)::int AS paid,
        coalesce(sum(amount_cents) FILTER (WHERE status IN ('PENDING','AVAILABLE','PAID')),0)::int AS earned,
        coalesce(sum(amount_cents) FILTER (WHERE status='CLAWBACK_DUE'),0)::int AS clawback,
        count(*) FILTER (WHERE status IN ('REVERSED','CANCELLED','CLAWBACK_DUE'))::int AS reversed
      FROM affiliate_commissions WHERE affiliate_id=$1`, [aff.id]),
    pool.query(`SELECT coalesce(sum(amount_cents),0)::int AS cents, count(*)::int AS n FROM payment_orders WHERE affiliate_id=$1 AND status='PAID'`, [aff.id]),
    pool.query(`SELECT u.id,u.name,u.email,u.created_at,
        (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id=u.id AND q.status='SUCCESS') AS queries,
        (SELECT coalesce(sum(o.amount_cents),0)::int FROM payment_orders o WHERE o.user_id=u.id AND o.affiliate_id=$1 AND o.status='PAID') AS spent
      FROM users u WHERE u.affiliate_id=$1 AND u.id<>$2 ORDER BY u.created_at DESC LIMIT 200`, [aff.id, me]),
    pool.query(`SELECT q.id,q.plate,q.status,q.created_at,p.name AS product_name,u.name AS customer_name
      FROM vehicle_queries q JOIN users u ON u.id=q.user_id JOIN query_products p ON p.id=q.product_id
      WHERE u.affiliate_id=$1 AND u.id<>$2 ORDER BY q.created_at DESC LIMIT 100`, [aff.id, me]),
    pool.query(`SELECT c.id,c.amount_cents,c.status,c.rate_bps,c.created_at,c.available_at,c.paid_at,o.amount_cents AS order_cents,o.purchase_type,p.name AS product_name,u.name AS customer_name
      FROM affiliate_commissions c LEFT JOIN payment_orders o ON o.id=c.order_id LEFT JOIN query_products p ON p.id=o.product_id LEFT JOIN users u ON u.id=o.user_id
      WHERE c.affiliate_id=$1 ORDER BY c.created_at DESC LIMIT 100`, [aff.id]),
    pool.query(`SELECT id,amount_cents,status,requested_at,paid_at FROM payouts WHERE affiliate_id=$1 ORDER BY created_at DESC LIMIT 50`, [aff.id])
  ]);
  const t = totals.rows[0] as Record<string, number>;
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    affiliate: { id: aff.id, code: aff.code, name: aff.name, commissionBps: Number(aff.commission_bps), partnerType: aff.partner_type, active: aff.active },
    pix: { set: Boolean(aff.pix_key), type: aff.pix_key_type, masked: maskPixKey(aff.pix_key, aff.pix_key_type) },
    totals: { revenueCents: Number(revenue.rows[0].cents), salesCount: Number(revenue.rows[0].n), clientsCount: clients.rowCount ?? 0, queriesCount: clients.rows.reduce((n, r) => n + Number(r.queries), 0), earnedCents: t.earned, pendingCents: t.pending, availableCents: t.available, inPayoutCents: t.in_payout, paidCents: t.paid, clawbackDueCents: t.clawback, reversedCount: t.reversed },
    clients: clients.rows.map((r) => ({ id: String(r.id), name: firstName(r.name), email: maskEmail(r.email), joinedAt: r.created_at, queries: Number(r.queries), spentCents: Number(r.spent) })),
    queries: queries.rows.map((r) => ({ id: String(r.id), date: r.created_at, product: String(r.product_name), plate: maskPlate(r.plate), status: String(r.status), customer: firstName(r.customer_name) })),
    sales: sales.rows.map((r) => ({ id: String(r.id), date: r.created_at, product: r.product_name ? String(r.product_name) : r.purchase_type === 'QUERY' ? 'Consulta' : 'Pacote de saldo', customer: firstName(r.customer_name), orderCents: r.order_cents == null ? null : Number(r.order_cents), commissionCents: Number(r.amount_cents), rateBps: Number(r.rate_bps), status: String(r.status), availableAt: r.available_at, paidAt: r.paid_at })),
    payouts: payouts.rows.map((r) => ({ id: String(r.id), amountCents: Number(r.amount_cents), status: String(r.status), requestedAt: r.requested_at, paidAt: r.paid_at }))
  });
}));
