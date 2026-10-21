import { createHash, createHmac } from 'node:crypto';
import { env } from '../config.js';
import { pool } from '../db.js';
import { appError } from './http.js';

export const CONSENT_VERSION = '2026-10';
export const CONSENT_TEXT = 'Autorizo a Placa na Mão a publicar meu nome (ou apelido) e o texto acima na página inicial do site. Posso retirar esta autorização a qualquer momento em Minha conta e o depoimento será removido.';
export const MANUAL_CONSENT_TEXT = 'Autorização registrada fora da plataforma; comprovante arquivado e referenciado.';

const err = (code: string, http = 409) => appError(code, { code, http, expose: true });
const ipHash = (ip: string) => createHmac('sha256', env.JWT_SECRET).update(ip).digest('hex').slice(0, 32);
export const contentHash = (name: string, body: string, version: string) => createHash('sha256').update(`${name}\n${body}\n${version}`).digest('hex');

/** Links, e-mails e telefones não entram em depoimento (evita propaganda e dado pessoal de terceiros). */
export function contentProblem(name: string, body: string): string | null {
  const all = `${name}\n${body}`;
  if (/https?:\/\/|www\.|\b[\w.+-]+@[\w-]+\.[\w.]+/i.test(all)) return 'Não inclua links nem e-mails.';
  if (/(\d[\s().-]*){8,}/.test(all)) return 'Não inclua números de telefone, documentos ou placas completas.';
  return null;
}

export async function isVerifiedClient(userId: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM users u WHERE u.id=$1 AND u.active=true AND u.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM vehicle_queries q WHERE q.user_id=u.id AND q.status='SUCCESS')
      OR EXISTS (SELECT 1 FROM payment_orders o WHERE o.user_id=u.id AND o.status='PAID'))`, [userId]);
  return !!r.rowCount;
}

async function event(c: { query: typeof pool.query }, id: string, ev: string, actor: string | null, detail: Record<string, unknown> = {}) {
  await c.query('INSERT INTO testimonial_events(testimonial_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4::jsonb)', [id, ev, actor, JSON.stringify(detail)]);
}

// ------------------------------------------------------------- cliente

const mineRow = (r: Record<string, unknown>) => ({ id: r.id, status: r.status, displayName: r.display_name, body: r.body, rating: r.rating, consentAt: r.consent_at, consentVersion: r.consent_version, publishedAt: r.published_at });

export async function clientGet(userId: string) {
  const [r, eligible] = await Promise.all([
    pool.query(`SELECT * FROM testimonials WHERE user_id=$1 AND status<>'REMOVIDO'`, [userId]),
    isVerifiedClient(userId)
  ]);
  return { eligible, consentText: CONSENT_TEXT, consentVersion: CONSENT_VERSION, testimonial: r.rows[0] ? mineRow(r.rows[0]) : null };
}

export async function clientSave(userId: string, input: { displayName: string; body: string; rating?: number | null; consent: true }, ip: string) {
  if (!(await isVerifiedClient(userId))) throw err('TESTIMONIAL_NOT_ELIGIBLE', 403);
  const problem = contentProblem(input.displayName, input.body);
  if (problem) throw err('TESTIMONIAL_CONTENT_INVALID', 422);
  const hash = contentHash(input.displayName, input.body, CONSENT_VERSION);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const cur = (await c.query(`SELECT id,status,content_hash FROM testimonials WHERE user_id=$1 AND status<>'REMOVIDO' FOR UPDATE`, [userId])).rows[0];
    let id: string;
    if (cur) {
      id = cur.id;
      await c.query(`UPDATE testimonials SET display_name=$2,body=$3,rating=$4,status='PENDENTE',consent_text=$5,consent_version=$6,consent_at=now(),consent_ip_hash=$7,content_hash=$8,approved_by=NULL,approved_at=NULL,published_at=NULL,reason=NULL,updated_at=now() WHERE id=$1`,
        [id, input.displayName, input.body, input.rating ?? null, CONSENT_TEXT, CONSENT_VERSION, ipHash(ip), hash]);
      await event(c, id, cur.status === 'PUBLICADO' ? 'EDITADO_DESPUBLICADO' : 'EDITADO', userId);
    } else {
      id = (await c.query(`INSERT INTO testimonials(user_id,source,status,display_name,body,rating,consent_text,consent_version,consent_at,consent_ip_hash,content_hash,created_by) VALUES($1,'CLIENTE','PENDENTE',$2,$3,$4,$5,$6,now(),$7,$8,$1) RETURNING id`,
        [userId, input.displayName, input.body, input.rating ?? null, CONSENT_TEXT, CONSENT_VERSION, ipHash(ip), hash])).rows[0].id;
      await event(c, id, 'ENVIADO', userId, { consentVersion: CONSENT_VERSION });
    }
    await c.query('COMMIT');
    return { id };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export async function clientWithdraw(userId: string): Promise<void> {
  const r = await pool.query(`UPDATE testimonials SET status='REMOVIDO',display_name='',body='',rating=NULL,content_hash=NULL,consent_ip_hash=NULL,published_at=NULL,removed_at=now(),reason='RETIRADO_PELO_CLIENTE',updated_at=now() WHERE user_id=$1 AND status<>'REMOVIDO' RETURNING id`, [userId]);
  if (!r.rowCount) throw err('TESTIMONIAL_NOT_FOUND', 404);
  await event(pool, r.rows[0].id, 'CONSENTIMENTO_RETIRADO', userId);
}

// ------------------------------------------------------------- equipe

export async function adminList(status?: string) {
  const r = await pool.query(`SELECT t.id,t.source,t.status,t.display_name,t.body,t.rating,t.consent_at,t.consent_version,t.proof_ref,t.published_at,t.approved_at,t.reason,t.created_at,
      cb.name AS created_by_name, ab.name AS approved_by_name,
      (t.user_id IS NOT NULL) AS has_account
    FROM testimonials t LEFT JOIN users cb ON cb.id=t.created_by LEFT JOIN users ab ON ab.id=t.approved_by
    WHERE ($1::text IS NULL OR t.status=$1) ORDER BY t.created_at DESC LIMIT 200`, [status ?? null]);
  return r.rows;
}

export async function adminDetail(id: string) {
  const [t, ev] = await Promise.all([
    pool.query('SELECT id,source,status,display_name,body,rating,consent_text,consent_version,consent_at,proof_ref,published_at,approved_at,reason FROM testimonials WHERE id=$1', [id]),
    pool.query('SELECT e.event,e.detail,e.created_at,u.name AS actor FROM testimonial_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.testimonial_id=$1 ORDER BY e.id', [id])
  ]);
  if (!t.rowCount) throw err('TESTIMONIAL_NOT_FOUND', 404);
  return { ...t.rows[0], events: ev.rows };
}

export async function adminCreateManual(actor: string, input: { displayName: string; body: string; rating?: number | null; proofRef: string; consentConfirmed: true }) {
  const problem = contentProblem(input.displayName, input.body);
  if (problem) throw err('TESTIMONIAL_CONTENT_INVALID', 422);
  const hash = contentHash(input.displayName, input.body, CONSENT_VERSION);
  const r = await pool.query(`INSERT INTO testimonials(user_id,source,status,display_name,body,rating,consent_text,consent_version,consent_at,proof_ref,content_hash,created_by) VALUES(NULL,'MANUAL','PENDENTE',$1,$2,$3,$4,$5,now(),$6,$7,$8) RETURNING id`,
    [input.displayName, input.body, input.rating ?? null, MANUAL_CONSENT_TEXT, CONSENT_VERSION, input.proofRef, hash, actor]);
  await event(pool, r.rows[0].id, 'CADASTRO_MANUAL', actor, { proofRef: input.proofRef });
  return { id: r.rows[0].id as string };
}

async function lockRow(c: { query: typeof pool.query }, id: string) {
  const r = await c.query('SELECT * FROM testimonials WHERE id=$1 FOR UPDATE', [id]);
  if (!r.rowCount) throw err('TESTIMONIAL_NOT_FOUND', 404);
  return r.rows[0] as Record<string, unknown> & { id: string; status: string; source: string; user_id: string | null; display_name: string; body: string; consent_version: string; content_hash: string | null; consent_at: Date | null; created_by: string | null };
}

/** Conteúdo e consentimento precisam estar íntegros antes de aprovar, publicar ou reexibir. */
async function assertPublishable(c: { query: typeof pool.query }, t: Awaited<ReturnType<typeof lockRow>>) {
  if (!t.consent_at || !t.content_hash || t.content_hash !== contentHash(t.display_name, t.body, t.consent_version)) throw err('TESTIMONIAL_CONSENT_INVALID');
  if (t.source === 'CLIENTE') {
    const u = await c.query(`SELECT 1 FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL`, [t.user_id]);
    if (!u.rowCount) throw err('TESTIMONIAL_CONSENT_INVALID');
  }
}

async function transition(id: string, actor: string, from: string[], to: string, ev: string, opts: { reason?: string; check?: boolean; fourEyes?: boolean; publish?: boolean } = {}) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const t = await lockRow(c, id);
    if (!from.includes(t.status)) throw err('TESTIMONIAL_INVALID_STATE');
    if (opts.check) await assertPublishable(c, t);
    if (opts.fourEyes && t.source === 'MANUAL' && t.created_by === actor) throw err('TESTIMONIAL_FOUR_EYES', 403);
    await c.query(`UPDATE testimonials SET status=$2,reason=COALESCE($3,reason),approved_by=CASE WHEN $2='APROVADO' AND $5 THEN $4 ELSE approved_by END,approved_at=CASE WHEN $2='APROVADO' AND $5 THEN now() ELSE approved_at END,published_at=CASE WHEN $2='PUBLICADO' THEN now() WHEN $2 IN ('OCULTO','APROVADO') THEN NULL ELSE published_at END,updated_at=now() WHERE id=$1`,
      [id, to, opts.reason ?? null, actor, t.status === 'PENDENTE']);
    await event(c, id, ev, actor, opts.reason ? { reason: opts.reason } : {});
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export const adminApprove = (id: string, actor: string) => transition(id, actor, ['PENDENTE'], 'APROVADO', 'APROVADO', { check: true, fourEyes: true });
export const adminPublish = (id: string, actor: string) => transition(id, actor, ['APROVADO'], 'PUBLICADO', 'PUBLICADO', { check: true });
export const adminHide = (id: string, actor: string, reason: string) => transition(id, actor, ['PUBLICADO', 'APROVADO'], 'OCULTO', 'OCULTADO', { reason });
export const adminUnhide = (id: string, actor: string) => transition(id, actor, ['OCULTO'], 'APROVADO', 'REATIVADO', { check: true });

export async function adminRemove(id: string, actor: string, reason: string): Promise<void> {
  const r = await pool.query(`UPDATE testimonials SET status='REMOVIDO',display_name='',body='',rating=NULL,content_hash=NULL,consent_ip_hash=NULL,published_at=NULL,removed_at=now(),reason=$2,updated_at=now() WHERE id=$1 AND status<>'REMOVIDO' RETURNING id`, [id, reason]);
  if (!r.rowCount) { const ex = await pool.query('SELECT 1 FROM testimonials WHERE id=$1', [id]); throw err(ex.rowCount ? 'TESTIMONIAL_INVALID_STATE' : 'TESTIMONIAL_NOT_FOUND', ex.rowCount ? 409 : 404); }
  await event(pool, id, 'REMOVIDO', actor, { reason });
}

// ------------------------------------------------------------- público

export async function publicList() {
  const r = await pool.query(`SELECT t.id,t.display_name,t.body,t.rating,t.published_at,t.consent_version,t.content_hash FROM testimonials t
    LEFT JOIN users u ON u.id=t.user_id
    WHERE t.status='PUBLICADO' AND (t.source='MANUAL' OR (u.active=true AND u.deleted_at IS NULL)) ORDER BY t.published_at DESC LIMIT 12`);
  return r.rows.filter((t) => t.content_hash === contentHash(t.display_name, t.body, t.consent_version)).map((t) => ({ id: t.id as string, name: t.display_name as string, text: t.body as string, rating: t.rating as number | null, publishedAt: t.published_at as string }));
}
