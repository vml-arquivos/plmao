import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { auth } from '../auth.js';
import { requirePermission } from '../permissions.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { env } from '../config.js';
import { assertCustomerProfile } from '../lib/customerProfile.js';
import { legalAcceptanceStatus } from '../legalAcceptance.js';
import { siteOpenFor } from '../siteAccess.js';
import { WATCH_INTERVALS, WATCH_MAX_PER_USER } from '../lib/plateWatch.js';
import { scopeForProduct } from '../lib/reportScope.js';
import { tierForProductCode, viewReport } from '../report/normalizeV2.js';
import type { NormalizedVehicle } from '../types.js';

/**
 * Monitoramento de placa e lista "Meus veículos" (tudo que a pessoa já consultou, uma linha por placa).
 * Só o dono vê e altera. Cada verificação do monitoramento é uma consulta normal, cobrada do saldo dele.
 */
export const watchesRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas ações em pouco tempo. Aguarde um instante.' } });
watchesRouter.use(['/watches', '/portfolio'], limiter, auth, requirePermission('QUERY_VEHICLE'));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => appError('Monitoramento não encontrado.', { code: 'WATCH_NOT_FOUND', http: 404, expose: true, showMessage: true });
const uuid = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) throw notFound(); return v; };
const bad = (message: string, code = 'INVALID_INPUT') => appError(message, { code, http: 400, expose: true, showMessage: true });
const plate = z.string().trim().transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine((v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), 'INVALID_PLATE');
const interval = z.coerce.number().int().refine((n) => (WATCH_INTERVALS as readonly number[]).includes(n), 'INVALID_INTERVAL');

function present(row: Record<string, unknown>) {
  return {
    id: row.id, plate: row.plate, productId: row.product_id, productName: row.product_name, priceCents: Number(row.price_cents ?? 0),
    intervalDays: Number(row.interval_days), status: row.status, pauseReason: row.pause_reason ?? null, runs: Number(row.runs ?? 0), failures: Number(row.failures ?? 0),
    lastCheckedAt: row.last_checked_at ?? null, nextCheckAt: row.next_check_at, createdAt: row.created_at, running: Boolean(row.pending_query_id),
    lastEvent: row.ev_kind ? { kind: row.ev_kind, at: row.ev_at, queryId: row.ev_query_id ?? null, changes: Array.isArray((row.ev_summary as { changes?: unknown } | null)?.changes) ? (row.ev_summary as { changes: unknown[] }).changes : [] } : null
  };
}
const LIST_SQL = `SELECT w.*,p.name AS product_name,p.price_cents,e.kind AS ev_kind,e.created_at AS ev_at,e.query_id AS ev_query_id,e.summary AS ev_summary
  FROM plate_watches w JOIN query_products p ON p.id=w.product_id
  LEFT JOIN LATERAL (SELECT kind,created_at,query_id,summary FROM plate_watch_events WHERE watch_id=w.id ORDER BY created_at DESC LIMIT 1) e ON true`;

watchesRouter.get('/watches', asyncRoute(async (req, res) => {
  const r = await pool.query(`${LIST_SQL} WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT 100`, [req.user!.id]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ enabled: env.PLATE_WATCH_ENABLED, max: WATCH_MAX_PER_USER, intervals: WATCH_INTERVALS, items: r.rows.map(present) });
}));

const createBody = z.object({ plate, productId: z.string().trim().min(1).max(80), intervalDays: interval, acceptCharge: z.literal(true) }).strict();
watchesRouter.post('/watches', asyncRoute(async (req, res) => {
  if (!env.PLATE_WATCH_ENABLED) throw appError('O monitoramento de placa está desligado no momento.', { code: 'WATCH_DISABLED', http: 409, expose: true, showMessage: true });
  const parsed = createBody.safeParse(req.body ?? {});
  if (!parsed.success) throw bad('Informe a placa, o tipo de consulta, o intervalo e confirme que cada verificação é cobrada do seu saldo.');
  const userId = req.user!.id;
  if (!siteOpenFor(String(req.user!.email ?? ''))) throw appError('SITE_NOT_OPEN', { code: 'SITE_NOT_OPEN', http: 403, expose: true });
  await assertCustomerProfile(userId, req.user!.role, { productId: parsed.data.productId });
  if (!(await legalAcceptanceStatus(userId)).accepted) throw appError('TERMS_ACCEPTANCE_REQUIRED', { code: 'TERMS_ACCEPTANCE_REQUIRED', http: 409, expose: true });
  const product = await pool.query(`SELECT id,name,price_cents,is_free,commercial_status FROM query_products WHERE id=$1 AND active=true`, [parsed.data.productId]);
  if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
  if (product.rows[0].is_free || product.rows[0].commercial_status !== 'ACTIVE') throw bad('Este tipo de consulta não está disponível para monitoramento.', 'PRODUCT_NOT_AVAILABLE');
  const count = await pool.query('SELECT count(*)::int AS n FROM plate_watches WHERE user_id=$1', [userId]);
  if (Number(count.rows[0].n) >= WATCH_MAX_PER_USER) throw appError(`Você já tem ${WATCH_MAX_PER_USER} monitoramentos. Apague um para criar outro.`, { code: 'WATCH_LIMIT', http: 409, expose: true, showMessage: true });
  const dup = await pool.query('SELECT 1 FROM plate_watches WHERE user_id=$1 AND plate=$2 AND product_id=$3', [userId, parsed.data.plate, parsed.data.productId]);
  if (dup.rowCount) throw appError('Esta placa já está sendo monitorada com este tipo de consulta.', { code: 'WATCH_EXISTS', http: 409, expose: true, showMessage: true });
  // Se já existe uma consulta igual feita por você, ela vira a base de comparação e a próxima verificação só vem depois do intervalo.
  const base = await pool.query(`SELECT id,coalesce(completed_at,created_at) AS at FROM vehicle_queries WHERE user_id=$1 AND plate=$2 AND product_id=$3 AND status='SUCCESS' ORDER BY coalesce(completed_at,created_at) DESC LIMIT 1`, [userId, parsed.data.plate, parsed.data.productId]);
  const created = await pool.query(`INSERT INTO plate_watches(user_id,plate,product_id,interval_days,baseline_query_id,next_check_at)
    VALUES($1,$2,$3,$4,$5, CASE WHEN $5::uuid IS NULL THEN now() ELSE greatest(now(), $6::timestamptz + make_interval(days => $4)) END) RETURNING id`,
  [userId, parsed.data.plate, parsed.data.productId, parsed.data.intervalDays, base.rows[0]?.id ?? null, base.rows[0]?.at ?? null]);
  await audit(userId, 'PLATE_WATCH_CREATED', 'PLATE_WATCH', created.rows[0].id, { plate: parsed.data.plate, productId: parsed.data.productId, intervalDays: parsed.data.intervalDays, requestId: requestId(req) });
  const row = await pool.query(`${LIST_SQL} WHERE w.id=$1`, [created.rows[0].id]);
  res.status(201).json(present(row.rows[0]));
}));

const patchBody = z.object({ status: z.enum(['ACTIVE', 'PAUSED']).optional(), intervalDays: interval.optional() }).strict();
watchesRouter.patch('/watches/:id', asyncRoute(async (req, res) => {
  const id = uuid(req.params.id);
  const parsed = patchBody.safeParse(req.body ?? {});
  if (!parsed.success || (parsed.data.status === undefined && parsed.data.intervalDays === undefined)) throw bad('Nada para alterar.');
  const own = await pool.query('SELECT status,last_checked_at FROM plate_watches WHERE id=$1 AND user_id=$2', [id, req.user!.id]);
  if (!own.rowCount) throw notFound();
  if (parsed.data.status === 'ACTIVE' && !env.PLATE_WATCH_ENABLED) throw appError('O monitoramento de placa está desligado no momento.', { code: 'WATCH_DISABLED', http: 409, expose: true, showMessage: true });
  if (parsed.data.status === 'PAUSED') await pool.query(`UPDATE plate_watches SET status='PAUSED',pause_reason='MANUAL',updated_at=now() WHERE id=$1`, [id]);
  // Retomar verifica agora (e cobra uma verificação); depois segue o intervalo.
  if (parsed.data.status === 'ACTIVE') await pool.query(`UPDATE plate_watches SET status='ACTIVE',pause_reason=NULL,failures=0,next_check_at=now(),updated_at=now() WHERE id=$1`, [id]);
  if (parsed.data.intervalDays !== undefined) await pool.query(`UPDATE plate_watches SET interval_days=$2,next_check_at=CASE WHEN $3::text='ACTIVE' AND $4::boolean THEN greatest(now(), last_checked_at + make_interval(days => $2)) ELSE next_check_at END,updated_at=now() WHERE id=$1`, [id, parsed.data.intervalDays, parsed.data.status ?? own.rows[0].status, own.rows[0].last_checked_at != null]);
  await audit(req.user!.id, 'PLATE_WATCH_UPDATED', 'PLATE_WATCH', id, { ...parsed.data, requestId: requestId(req) });
  const row = await pool.query(`${LIST_SQL} WHERE w.id=$1`, [id]);
  res.json(present(row.rows[0]));
}));

watchesRouter.delete('/watches/:id', asyncRoute(async (req, res) => {
  const id = uuid(req.params.id);
  const r = await pool.query('DELETE FROM plate_watches WHERE id=$1 AND user_id=$2', [id, req.user!.id]);
  if (!r.rowCount) throw notFound();
  await audit(req.user!.id, 'PLATE_WATCH_DELETED', 'PLATE_WATCH', id, { requestId: requestId(req) });
  res.json({ deleted: true });
}));

watchesRouter.get('/watches/:id/events', asyncRoute(async (req, res) => {
  const id = uuid(req.params.id);
  const own = await pool.query('SELECT 1 FROM plate_watches WHERE id=$1 AND user_id=$2', [id, req.user!.id]);
  if (!own.rowCount) throw notFound();
  const r = await pool.query('SELECT id,kind,query_id,summary,created_at FROM plate_watch_events WHERE watch_id=$1 ORDER BY created_at DESC LIMIT 50', [id]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(r.rows.map((e) => ({ id: e.id, kind: e.kind, queryId: e.query_id, at: e.created_at, changes: Array.isArray(e.summary?.changes) ? e.summary.changes : [], code: e.summary?.code ?? e.summary?.reason ?? null })));
}));

/** Meus veículos: uma linha por placa, com a consulta mais recente, a situação e se está sendo monitorada. */
const PORTFOLIO_MAX = 200;
watchesRouter.get('/portfolio', asyncRoute(async (req, res) => {
  const userId = req.user!.id;
  const latest = await pool.query(`SELECT * FROM (
      SELECT DISTINCT ON (q.plate) q.id,q.plate,q.product_id,q.created_at,coalesce(q.completed_at,q.created_at) AS at,p.name AS product_name,r.normalized
      FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id JOIN vehicle_query_results r ON r.query_id=q.id
      WHERE q.user_id=$1 AND q.status='SUCCESS' ORDER BY q.plate, coalesce(q.completed_at,q.created_at) DESC) t ORDER BY t.at DESC LIMIT ${PORTFOLIO_MAX}`, [userId]);
  const counts = await pool.query(`SELECT plate,count(*)::int AS n FROM vehicle_queries WHERE user_id=$1 AND status='SUCCESS' GROUP BY plate`, [userId]);
  const watched = await pool.query(`SELECT plate FROM plate_watches WHERE user_id=$1 AND status='ACTIVE'`, [userId]);
  const nByPlate = new Map(counts.rows.map((c) => [String(c.plate), Number(c.n)]));
  const watching = new Set(watched.rows.map((w) => String(w.plate)));
  const items = latest.rows.map((row) => {
    const v2 = (row.normalized as NormalizedVehicle | null)?.v2;
    let view: ReturnType<typeof viewReport> | null = null;
    try {
      if (v2) { const scope = scopeForProduct(String(row.product_id), row.created_at as Date); view = viewReport(v2, { audience: 'client', tier: tierForProductCode(String(row.product_id)), sections: scope.sections, template: scope.template }); }
    } catch { view = null; }
    const checks = view?.advice?.checks ?? [];
    const h = view?.headline;
    return {
      plate: row.plate, queryId: row.id, productName: row.product_name, consultedAt: row.at, queries: nByPlate.get(String(row.plate)) ?? 1, watching: watching.has(String(row.plate)),
      vehicle: [h?.brand, h?.model ?? h?.fullModel].filter(Boolean).join(' ') || null, year: h?.modelYear ?? h?.manufactureYear ?? null, color: h?.color ?? null, state: h?.state ?? null,
      verdict: view ? { level: view.verdict.level, title: view.verdict.title } : null,
      alerts: checks.filter((c) => c.status === 'ALERT').length, attention: checks.filter((c) => c.status === 'ATTENTION').length,
      debtsCents: view && !view.debtsHidden ? Number(view.debts.totalCents ?? 0) : null, resale: view?.advice?.resale?.level ?? null
    };
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ items, truncated: items.length >= PORTFOLIO_MAX });
}));
