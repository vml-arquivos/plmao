import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth } from '../auth.js';
import { requirePermission } from '../permissions.js';
import { appError, asyncRoute } from '../lib/http.js';

/**
 * Resultados por período: consultas, receita, estornos e consultas internas, por produto, por dia e por cliente.
 * Receita = valor das consultas concluídas dos clientes. Consulta interna da equipe não gera receita nem entra no ticket.
 */
export const adminResultsRouter = Router();

const TZ = 'America/Sao_Paulo';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'INVALID_DATE');
const query = z.object({ from: day.optional(), to: day.optional() }).strict();
const iso = (d: Date) => d.toISOString().slice(0, 10);

adminResultsRouter.get('/results', adminAuth, requirePermission('VIEW_DASHBOARD'), asyncRoute(async (req, res) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const today = new Date();
  const to = parsed.data.to ?? iso(today);
  const from = parsed.data.from ?? iso(new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000));
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span < 0 || span > 366) throw appError('Escolha um período de até 366 dias, com a data final depois da inicial.', { code: 'INVALID_RANGE', http: 400, expose: true, showMessage: true });
  const win = `q.created_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND q.created_at < (($2::date) + 1)::timestamp AT TIME ZONE '${TZ}'`;
  const p = [from, to];

  const totals = await pool.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE q.status='SUCCESS')::int AS success,
      count(*) FILTER (WHERE q.status IN ('FAILED','REFUNDED'))::int AS failed,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source='ADMIN' AND q.request_metadata->>'sentFrom' IS NULL)::int AS internal,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source='ADMIN' AND q.request_metadata->>'sentFrom' IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN')::int AS customer,
      coalesce(sum(q.price_cents) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN'),0)::bigint AS revenue_cents,
      count(DISTINCT q.user_id) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN')::int AS customers
    FROM vehicle_queries q WHERE ${win}`, p);
  const byProduct = await pool.query(`SELECT p.id,p.name,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN')::int AS customer,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source='ADMIN')::int AS internal,
      count(*) FILTER (WHERE q.status IN ('FAILED','REFUNDED'))::int AS failed,
      coalesce(sum(q.price_cents) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN'),0)::bigint AS revenue_cents
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id WHERE ${win} GROUP BY p.id,p.name ORDER BY revenue_cents DESC, customer DESC`, p);
  const byDay = await pool.query(`SELECT ((q.created_at AT TIME ZONE '${TZ}')::date)::text AS day,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN')::int AS customer,
      count(*) FILTER (WHERE q.status='SUCCESS' AND q.source='ADMIN')::int AS internal,
      count(*) FILTER (WHERE q.status IN ('FAILED','REFUNDED'))::int AS failed,
      coalesce(sum(q.price_cents) FILTER (WHERE q.status='SUCCESS' AND q.source<>'ADMIN'),0)::bigint AS revenue_cents
    FROM vehicle_queries q WHERE ${win} GROUP BY 1 ORDER BY 1`, p);
  const byPayment = await pool.query(`SELECT q.charge_source,count(*)::int AS n,coalesce(sum(q.price_cents),0)::bigint AS revenue_cents
    FROM vehicle_queries q WHERE ${win} AND q.status='SUCCESS' AND q.source<>'ADMIN' GROUP BY q.charge_source ORDER BY n DESC`, p);
  const top = await pool.query(`SELECT u.id,u.name,u.email,count(*)::int AS queries,coalesce(sum(q.price_cents),0)::bigint AS revenue_cents
    FROM vehicle_queries q JOIN users u ON u.id=q.user_id WHERE ${win} AND q.status='SUCCESS' AND q.source<>'ADMIN' GROUP BY u.id,u.name,u.email ORDER BY queries DESC, revenue_cents DESC LIMIT 10`, p);
  const watch = await pool.query(`SELECT
      (SELECT count(*)::int FROM plate_watches WHERE status='ACTIVE') AS active,
      (SELECT count(*)::int FROM plate_watches WHERE status='PAUSED') AS paused,
      count(*) FILTER (WHERE e.kind IN ('BASELINE','NO_CHANGE','CHANGED'))::int AS checks,
      count(*) FILTER (WHERE e.kind='CHANGED')::int AS changes
    FROM plate_watch_events e WHERE e.created_at >= ($1::date)::timestamp AT TIME ZONE '${TZ}' AND e.created_at < (($2::date) + 1)::timestamp AT TIME ZONE '${TZ}'`, p);

  const t = totals.rows[0];
  const revenue = Number(t.revenue_cents);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    from, to,
    totals: { total: t.total, success: t.success, failed: t.failed, internal: t.internal, delivered: t.delivered, customer: t.customer, customers: t.customers, revenueCents: revenue, averageTicketCents: t.customer ? Math.round(revenue / t.customer) : 0 },
    byProduct: byProduct.rows.map((r) => ({ id: r.id, name: r.name, customer: r.customer, internal: r.internal, failed: r.failed, revenueCents: Number(r.revenue_cents) })),
    byDay: byDay.rows.map((r) => ({ date: String(r.day).slice(0, 10), customer: r.customer, internal: r.internal, failed: r.failed, revenueCents: Number(r.revenue_cents) })),
    byPayment: byPayment.rows.map((r) => ({ source: r.charge_source, count: r.n, revenueCents: Number(r.revenue_cents) })),
    topCustomers: top.rows.map((r) => ({ id: r.id, name: r.name, email: r.email, queries: r.queries, revenueCents: Number(r.revenue_cents) })),
    watch: { active: watch.rows[0].active, paused: watch.rows[0].paused, checks: watch.rows[0].checks, changes: watch.rows[0].changes }
  });
}));
