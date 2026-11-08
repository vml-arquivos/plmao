import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { auth, adminAuth } from '../auth.js';
import { env, publicAppUrl } from '../config.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { attachInviter, cleanInviteCode, cleanInviteVia, ensureInviteCode, inviteSummaryFor, recordInviteClick, maskInviteeEmail } from '../lib/invites.js';

/**
 * Convite por usuário. Cada pessoa tem um código e um link (/convite/CODE). Quem abre o link e se cadastra fica
 * ligado a quem convidou. A mesma conta vale para cliente, lojista, operador e administrador.
 * O painel da equipe enxerga tudo (quem convidou quem e quando); o cliente só enxerga os dados parciais dos seus convidados.
 */
export const invitesRouter = Router();
export const adminInvitesRouter = Router();
adminInvitesRouter.use(adminAuth);

const clickLimit = rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
const inviteUrl = (code: string) => new URL(`/convite/${code}`, publicAppUrl()).toString();

async function myInvite(userId: string) {
  const code = await ensureInviteCode(userId);
  const who = await pool.query('SELECT invited_by,invited_at,invited_via FROM users WHERE id=$1', [userId]);
  const inviter = who.rows[0]?.invited_by ? await pool.query('SELECT name FROM users WHERE id=$1', [who.rows[0].invited_by]) : null;
  return {
    code, url: inviteUrl(code),
    invitedBy: inviter?.rowCount ? { name: String(inviter.rows[0].name).split(/\s+/)[0], at: who.rows[0].invited_at, via: who.rows[0].invited_via } : null,
    ...(await inviteSummaryFor(userId))
  };
}

invitesRouter.get('/me/invite', auth, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await myInvite(req.user!.id));
}));

/** Página do convite: confere o código e diz quem convidou (só o primeiro nome). */
invitesRouter.get('/invites/:code', asyncRoute(async (req, res) => {
  const code = cleanInviteCode(req.params.code);
  const row = code ? await pool.query('SELECT name FROM users WHERE invite_code=$1 AND active=true', [code]) : null;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ valid: Boolean(row?.rowCount), inviterName: row?.rowCount ? String(row.rows[0].name).split(/\s+/)[0] : null });
}));

const clickSchema = z.object({ via: z.enum(['LINK', 'REPORT']).optional() }).strict();
invitesRouter.post('/invites/:code/click', clickLimit, asyncRoute(async (req, res) => {
  const parsed = clickSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const r = await recordInviteClick(req.params.code, parsed.data.via);
  res.json({ valid: Boolean(r) });
}));

/** Para quem entrou por outro caminho (Google): liga ao convite depois, só se a conta for nova e ainda sem convite. */
const claimSchema = z.object({ code: z.string().trim().min(4).max(20), via: z.enum(['LINK', 'REPORT']).optional() }).strict();
invitesRouter.post('/me/invite/claim', auth, asyncRoute(async (req, res) => {
  const parsed = claimSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const fresh = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role='CLIENTE' AND created_at > now() - interval '2 days'`, [req.user!.id]);
  if (!fresh.rowCount) { res.json({ attached: false }); return; }
  const r = await attachInviter(req.user!.id, parsed.data.code, parsed.data.via);
  if (r) await audit(req.user!.id, 'INVITE_CLAIMED', 'USER', req.user!.id, { requestId: requestId(req), inviterId: r.inviterId });
  res.json({ attached: Boolean(r) });
}));

// ------------------------------------------------------------------ painel da equipe

/** Equipe (operador, administrador…) também tem o próprio link. */
adminInvitesRouter.get('/me/invite', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(await myInvite(req.user!.id));
}));

/** Quem convidou quem e quando: totais por pessoa e a lista dos últimos cadastros por convite. */
adminInvitesRouter.get('/invites', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (_req, res) => {
  const [people, recent, total] = await Promise.all([
    pool.query(`SELECT u.id,u.name,u.email,u.role,u.invite_code,
        count(e.*) FILTER (WHERE e.kind='CLICK')::int AS clicks,
        count(e.*) FILTER (WHERE e.kind='SIGNUP')::int AS signups,
        (SELECT count(*)::int FROM users i WHERE i.invited_by=u.id AND EXISTS (SELECT 1 FROM vehicle_queries q WHERE q.user_id=i.id AND q.status='SUCCESS')) AS with_query,
        (SELECT count(*)::int FROM users i WHERE i.invited_by=u.id AND EXISTS (SELECT 1 FROM payment_orders o WHERE o.user_id=i.id AND o.status='PAID')) AS with_purchase
      FROM users u JOIN invite_events e ON e.inviter_id=u.id GROUP BY u.id ORDER BY signups DESC, clicks DESC LIMIT 100`),
    pool.query(`SELECT i.id,i.name,i.email,i.invited_at,i.invited_via,u.id AS inviter_id,u.name AS inviter_name,u.role AS inviter_role,
        (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id=i.id AND q.status='SUCCESS') AS queries,
        (SELECT coalesce(sum(o.amount_cents),0)::int FROM payment_orders o WHERE o.user_id=i.id AND o.status='PAID') AS spent
      FROM users i JOIN users u ON u.id=i.invited_by ORDER BY i.invited_at DESC NULLS LAST LIMIT 200`),
    pool.query(`SELECT count(*) FILTER (WHERE kind='CLICK')::int AS clicks, count(*) FILTER (WHERE kind='SIGNUP')::int AS signups FROM invite_events`)
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    totals: { clicks: Number(total.rows[0].clicks), signups: Number(total.rows[0].signups) },
    people: people.rows.map((p) => ({ id: String(p.id), name: String(p.name), email: String(p.email), role: String(p.role), code: p.invite_code ? String(p.invite_code) : null, clicks: Number(p.clicks), signups: Number(p.signups), withQuery: Number(p.with_query), withPurchase: Number(p.with_purchase) })),
    recent: recent.rows.map((r) => ({ id: String(r.id), name: String(r.name), email: String(r.email), joinedAt: r.invited_at, via: String(r.invited_via ?? 'LINK'), inviterId: String(r.inviter_id), inviterName: String(r.inviter_name), inviterRole: String(r.inviter_role), queries: Number(r.queries), spentCents: Number(r.spent) }))
  });
}));
