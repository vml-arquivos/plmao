import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';

/**
 * Convite por usuário: todo mundo (cliente, operador, administrador) tem um código e um link próprios.
 * Quem se cadastra pelo link fica ligado a quem convidou, com a data e o caminho (link do site ou consulta enviada).
 * Não tem comissão: é só rastreio. Comissão continua sendo o "Indique e ganhe".
 */
export type InviteVia = 'LINK' | 'REPORT';
type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0, O, 1, I
const CODE_RE = /^[A-Z2-9]{8}$/;

export const cleanInviteCode = (raw: unknown): string | null => {
  const v = String(raw ?? '').trim().toUpperCase();
  return CODE_RE.test(v) && !/[01IO]/.test(v) ? v : null;
};
export const cleanInviteVia = (raw: unknown): InviteVia => (String(raw ?? '').toUpperCase() === 'REPORT' ? 'REPORT' : 'LINK');

export function newInviteCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Devolve o código da pessoa; cria na primeira vez. */
export async function ensureInviteCode(userId: string, db: Db = pool): Promise<string> {
  const cur = await db.query('SELECT invite_code FROM users WHERE id=$1', [userId]);
  if (!cur.rowCount) throw new Error('USER_NOT_FOUND');
  if (cur.rows[0]!.invite_code) return String(cur.rows[0]!.invite_code);
  for (let i = 0; i < 8; i += 1) {
    const code = newInviteCode();
    try {
      const up = await db.query('UPDATE users SET invite_code=$2 WHERE id=$1 AND invite_code IS NULL RETURNING invite_code', [userId, code]);
      if (up.rowCount) return String(up.rows[0]!.invite_code);
      const again = await db.query('SELECT invite_code FROM users WHERE id=$1', [userId]);
      if (again.rows[0]?.invite_code) return String(again.rows[0].invite_code);
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === '23505') continue; // código repetido: sorteia outro
      throw e;
    }
  }
  throw new Error('INVITE_CODE_FAILED');
}

export async function inviterByCode(code: string, db: Db = pool): Promise<{ id: string; name: string } | null> {
  const r = await db.query('SELECT id,name FROM users WHERE invite_code=$1 AND active=true', [code]);
  return r.rowCount ? { id: String(r.rows[0]!.id), name: String(r.rows[0]!.name) } : null;
}

/**
 * Liga a conta nova a quem convidou. Só vale uma vez (a primeira), nunca a própria conta, e só se o código existir.
 * Código inválido não derruba o cadastro: simplesmente não liga.
 */
export async function attachInviter(userId: string, rawCode: unknown, rawVia: unknown, db: Db = pool): Promise<{ inviterId: string } | null> {
  const code = cleanInviteCode(rawCode);
  if (!code) return null;
  const inviter = await inviterByCode(code, db);
  if (!inviter || inviter.id === userId) return null;
  const via = cleanInviteVia(rawVia);
  const up = await db.query(`UPDATE users SET invited_by=$2, invited_at=now(), invited_via=$3 WHERE id=$1 AND invited_by IS NULL RETURNING id`, [userId, inviter.id, via]);
  if (!up.rowCount) return null;
  await db.query(`INSERT INTO invite_events(inviter_id,kind,via,invitee_id) VALUES($1,'SIGNUP',$2,$3)`, [inviter.id, via, userId]);
  return { inviterId: inviter.id };
}

/** Anota que o link foi aberto (sem guardar IP nem dado pessoal de quem abriu). */
export async function recordInviteClick(rawCode: unknown, rawVia: unknown): Promise<{ inviterName: string } | null> {
  const code = cleanInviteCode(rawCode);
  if (!code) return null;
  const inviter = await inviterByCode(code);
  if (!inviter) return null;
  await pool.query(`INSERT INTO invite_events(inviter_id,kind,via) VALUES($1,'CLICK',$2)`, [inviter.id, cleanInviteVia(rawVia)]);
  return { inviterName: inviter.name };
}

export const maskInviteeEmail = (email: unknown): string => {
  const [local, domain] = String(email ?? '').split('@');
  return local && domain ? `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(5, local.length - 1)))}@${domain}` : '';
};
const first = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] ?? '';

/** Resumo para a própria pessoa: totais e a lista de quem entrou pelo link dela (nome e e-mail parciais). */
export async function inviteSummaryFor(userId: string) {
  const [counts, rows] = await Promise.all([
    pool.query(`SELECT
        count(*) FILTER (WHERE kind='CLICK')::int AS clicks,
        count(*) FILTER (WHERE kind='SIGNUP')::int AS signups,
        count(*) FILTER (WHERE kind='SIGNUP' AND via='REPORT')::int AS via_report
      FROM invite_events WHERE inviter_id=$1`, [userId]),
    pool.query(`SELECT u.id,u.name,u.email,u.invited_at,u.invited_via,
        (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id=u.id AND q.status='SUCCESS') AS queries,
        (SELECT coalesce(sum(o.amount_cents),0)::int FROM payment_orders o WHERE o.user_id=u.id AND o.status='PAID') AS spent
      FROM users u WHERE u.invited_by=$1 ORDER BY u.invited_at DESC NULLS LAST LIMIT 200`, [userId])
  ]);
  const c = counts.rows[0] as Record<string, number>;
  return {
    totals: {
      clicks: Number(c.clicks), signups: Number(c.signups), viaReport: Number(c.via_report),
      withQuery: rows.rows.filter((r) => Number(r.queries) > 0).length,
      withPurchase: rows.rows.filter((r) => Number(r.spent) > 0).length
    },
    invited: rows.rows.map((r) => ({ name: first(r.name), email: maskInviteeEmail(r.email), joinedAt: r.invited_at, via: String(r.invited_via ?? 'LINK'), queries: Number(r.queries), purchased: Number(r.spent) > 0 }))
  };
}
