import { pool } from '../db.js';
import { appError } from './http.js';
import { recordProblem } from './supportAssistant.js';

const err = (code: string, http = 404) => appError(code, { code, http, expose: true });

// ---------------------------------------------------------------- respostas prontas (equipe)

export const CANNED_CATEGORIES = ['GERAL', 'CONSULTA', 'PAGAMENTO', 'CONTA', 'LGPD'] as const;
export async function cannedList(onlyActive: boolean) {
  const r = await pool.query(`SELECT id,title,body,category,active,use_count,updated_at FROM support_canned_replies ${onlyActive ? 'WHERE active=true' : ''} ORDER BY category,title`);
  return r.rows;
}
export async function cannedCreate(by: string, v: { title: string; body: string; category: string }) {
  try {
    const r = await pool.query('INSERT INTO support_canned_replies(title,body,category,created_by) VALUES($1,$2,$3,$4) RETURNING id', [v.title, v.body, v.category, by]);
    return r.rows[0].id as string;
  } catch (e) { if ((e as { code?: string }).code === '23505') throw err('SUPPORT_CANNED_DUPLICATE', 409); throw e; }
}
export async function cannedUpdate(id: string, v: Partial<{ title: string; body: string; category: string; active: boolean }>) {
  try {
    const r = await pool.query(`UPDATE support_canned_replies SET title=COALESCE($2,title),body=COALESCE($3,body),category=COALESCE($4,category),active=COALESCE($5,active),updated_at=now() WHERE id=$1 RETURNING id`, [id, v.title ?? null, v.body ?? null, v.category ?? null, v.active ?? null]);
    if (!r.rowCount) throw err('SUPPORT_CANNED_NOT_FOUND');
  } catch (e) { if ((e as { code?: string }).code === '23505') throw err('SUPPORT_CANNED_DUPLICATE', 409); throw e; }
}
export async function cannedDelete(id: string) {
  const r = await pool.query('DELETE FROM support_canned_replies WHERE id=$1', [id]);
  if (!r.rowCount) throw err('SUPPORT_CANNED_NOT_FOUND');
}
export async function cannedUsed(id: string) { await pool.query('UPDATE support_canned_replies SET use_count=use_count+1 WHERE id=$1', [id]); }

// ---------------------------------------------------------------- relatos de problema

export const PROBLEM_STATUSES = ['ABERTO', 'EM_ANALISE', 'RESOLVIDO', 'IGNORADO'] as const;
export async function problemList(status?: string) {
  const r = await pool.query(
    `SELECT id,source,severity,title,route,status,occurrences,users_affected,conversation_id,note,detail,first_seen,last_seen FROM support_problem_reports
     WHERE ($1::text IS NULL OR status=$1) ORDER BY CASE severity WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, last_seen DESC LIMIT 200`, [status ?? null]);
  return r.rows;
}
export async function problemUpdate(id: string, v: { status?: string; note?: string; severity?: string }) {
  const r = await pool.query(`UPDATE support_problem_reports SET status=COALESCE($2,status),note=COALESCE($3,note),severity=COALESCE($4,severity) WHERE id=$1 RETURNING id`, [id, v.status ?? null, v.note ?? null, v.severity ?? null]);
  if (!r.rowCount) throw err('SUPPORT_PROBLEM_NOT_FOUND');
}

export async function supportStats() {
  const [byStatus, week, cats, problems, top] = await Promise.all([
    pool.query(`SELECT status,count(*)::int AS n FROM support_conversations WHERE status NOT IN ('ENCERRADA') GROUP BY status`),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE handler='BOT')::int AS bot_only FROM support_conversations WHERE created_at > now() - interval '7 days'`),
    pool.query(`SELECT category,count(*)::int AS n FROM support_conversations WHERE created_at > now() - interval '30 days' GROUP BY category ORDER BY n DESC`),
    pool.query(`SELECT count(*)::int AS n FROM support_problem_reports WHERE status IN ('ABERTO','EM_ANALISE')`),
    pool.query(`SELECT id,title,severity,occurrences,users_affected,last_seen FROM support_problem_reports WHERE status IN ('ABERTO','EM_ANALISE') ORDER BY occurrences DESC, last_seen DESC LIMIT 5`)
  ]);
  const s = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return { waiting: s.AGUARDANDO_ATENDENTE ?? 0, inProgress: s.EM_ATENDIMENTO ?? 0, waitingClient: s.AGUARDANDO_CLIENTE ?? 0, open: s.ABERTA ?? 0, week: week.rows[0], categories: cats.rows, openProblems: problems.rows[0].n, topProblems: top.rows };
}

// ---------------------------------------------------------------- erros do navegador (sem dados pessoais)

const scrub = (t: string) => t.replace(/https?:\/\/[^\s)]+/g, (u) => { try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return '[url]'; } })
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]').replace(/\b[A-Za-z]{3}\d[A-Za-z0-9]\d{2}\b/g, '[placa]').replace(/\b\d{11,14}\b/g, '[número]').slice(0, 400);
const routeOnly = (r: string) => r.split(/[?#]/)[0]!.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id').replace(/\/[A-Za-z]{3}\d[A-Za-z0-9]\d{2}(?=\/|$)/g, '/:placa').slice(0, 120);

export async function recordClientError(input: { message: string; stack?: string; route: string; kind: string; userId?: string | null }): Promise<void> {
  const open = await pool.query(`SELECT count(*)::int AS n FROM support_problem_reports WHERE source='NAVEGADOR' AND status IN ('ABERTO','EM_ANALISE')`);
  if (open.rows[0].n >= 500) return; // teto contra enchente de relatos distintos
  const message = scrub(input.message); const route = routeOnly(input.route);
  const norm = message.replace(/\d+/g, '#').replace(/[0-9a-f]{12,}/gi, '#').slice(0, 120);
  await recordProblem({ source: 'NAVEGADOR', severity: 'MEDIA', title: `Erro no navegador: ${message.slice(0, 100)}`, key: `${input.kind}|${route.split('/').slice(0, 3).join('/')}|${norm}`, route, userId: input.userId, detail: { kind: input.kind, message, stack: input.stack ? scrub(input.stack).slice(0, 400) : undefined } });
}
