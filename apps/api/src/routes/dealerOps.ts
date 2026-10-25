import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { auth } from '../auth.js';
import { env, publicAppUrl } from '../config.js';
import { asyncRoute, audit, requestId } from '../lib/http.js';
import { FinancingError } from '../lib/financing.js';
import { loadFinancingSettings } from '../financingSettings.js';
import { runSimulation } from '../simulator/service.js';
import { computeTradeIn } from '../dealer/tradeIn.js';
import { renderProposalPdf } from '../dealer/proposalPdf.js';
import { type DealerCtx, bad, can, centsZ, dayOut, dealerAccess, iso, isUnique, notFound, plateZ, uuidParam } from '../dealer/context.js';
import { leadScope } from './dealerLeads.js';

/** Propostas com simulação (PDF), avaliação de troca, alertas e resumo da loja. */
export const dealerOpsRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas ações em pouco tempo. Aguarde um instante.' } });
const pdfLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitos PDFs em pouco tempo. Tente novamente mais tarde.' } });
for (const p of ['/dealer/proposals', '/dealer/trade-in', '/dealer/trade-ins', '/dealer/alerts', '/dealer/summary']) dealerOpsRouter.use(p, limiter, auth);

const dealer = (req: { dealer?: DealerCtx }) => req.dealer!;
const money = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- propostas

const proposalBody = z.object({
  vehicleId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  customerName: z.string().trim().min(2).max(80).optional(),
  vehicleLabel: z.string().trim().min(2).max(120).optional(),
  priceCents: centsZ.refine((v) => v >= 1).optional(),
  downPaymentCents: centsZ.default(0),
  tradeInCents: centsZ.default(0),
  financing: z.object({
    months: z.number().int().min(1).max(120),
    ratePct: z.number().min(0.01).max(30).nullish(),
    personType: z.enum(['PF', 'PJ']).default('PF'),
    condition: z.enum(['NEW', 'USED']).default('USED')
  }).strict().nullish(),
  validDays: z.number().int().min(1).max(60).default(7),
  notes: z.string().trim().max(500).default('')
}).strict();

function proposalCode() { return `PRO-${randomBytes(4).toString('hex').toUpperCase()}`; }
function vehicleLabelOf(v: Record<string, unknown>) { return [v.brand, v.model, v.version, v.year_model].filter(Boolean).join(' '); }

function proposalOut(r: Record<string, unknown>) {
  return {
    id: r.id, code: r.code, customerName: r.customer_name, vehicleLabel: r.vehicle_label, leadId: r.lead_id ?? null, vehicleId: r.vehicle_id ?? null,
    priceCents: Number(r.price_cents), downPaymentCents: Number(r.down_payment_cents), tradeInCents: Number(r.trade_in_cents),
    months: r.months == null ? null : Number(r.months), installmentCents: r.installment_cents == null ? null : Number(r.installment_cents),
    ratePct: r.rate_pct == null ? null : Number(r.rate_pct), validUntil: dayOut(r.valid_until), notes: r.notes, sellerName: r.seller_name ?? null, createdAt: iso(r.created_at)
  };
}
const PROPOSAL_SELECT = 'SELECT p.*, u.name AS seller_name FROM dealer_proposals p LEFT JOIN users u ON u.id=p.created_by';

dealerOpsRouter.get('/dealer/proposals', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const values: unknown[] = [ctx.store.id];
  let where = 'p.dealership_id=$1';
  if (!can.manage(ctx)) { values.push(ctx.userId); where += ` AND p.created_by=$${values.length}`; }
  if (typeof req.query.leadId === 'string') { values.push(uuidParam(req.query.leadId)); where += ` AND p.lead_id=$${values.length}`; }
  const r = await pool.query(`${PROPOSAL_SELECT} WHERE ${where} ORDER BY p.created_at DESC LIMIT 200`, values);
  res.json(r.rows.map(proposalOut));
}));

dealerOpsRouter.post('/dealer/proposals', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = proposalBody.safeParse(req.body);
  if (!parsed.success) throw bad('Confira os dados da proposta.');
  const b = parsed.data;

  let vehicle: Record<string, unknown> | null = null;
  if (b.vehicleId) {
    const v = await pool.query('SELECT * FROM stock_vehicles WHERE id=$1 AND dealership_id=$2', [b.vehicleId, ctx.store.id]);
    if (!v.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
    vehicle = v.rows[0];
  }
  let lead: Record<string, unknown> | null = null;
  if (b.leadId) {
    const values: unknown[] = [b.leadId, ctx.store.id];
    const l = await pool.query(`SELECT l.* FROM dealer_leads l WHERE l.id=$1 AND l.dealership_id=$2${leadScope(ctx, values)}`, values);
    if (!l.rowCount) throw notFound('Lead não encontrado.', 'DEALER_LEAD_NOT_FOUND');
    lead = l.rows[0];
  }
  const customerName = b.customerName ?? (lead ? String(lead.name) : null);
  if (!customerName) throw bad('Informe o nome do cliente.');
  const vehicleLabel = b.vehicleLabel ?? (vehicle ? vehicleLabelOf(vehicle) : null);
  if (!vehicleLabel) throw bad('Informe o veículo.');
  const price = b.priceCents ?? (vehicle ? Number(vehicle.price_cents) : null);
  if (!price) throw bad('Informe o preço.');
  if (b.downPaymentCents + b.tradeInCents > price) throw bad('Entrada e troca somam mais que o preço.', 'DEALER_PROPOSAL_VALUES');

  let fin: { months: number; installmentCents: number; ratePct: number; totalPaidCents: number; cetAnnualPct: number; principalCents: number } | null = null;
  const toFinance = price - b.downPaymentCents - b.tradeInCents;
  if (b.financing) {
    if (toFinance < 1) throw bad('Não há saldo para financiar.', 'DEALER_PROPOSAL_VALUES');
    try {
      const sim = runSimulation({
        modality: 'CDC', personType: b.financing.personType, vehicleKind: 'CAR', condition: b.financing.condition, vehicleValueCents: price - b.tradeInCents, downPaymentCents: b.downPaymentCents,
        months: b.financing.months, ratePct: b.financing.ratePct ?? null, residualPct: 20, amortization: 'PRICE', financeFees: true, firstInstallmentDays: 30, vehicleLabel, notes: '', fees: {}
      }, await loadFinancingSettings());
      const r = sim.results.cdc!;
      fin = { months: r.months, installmentCents: r.installmentCents, ratePct: r.monthlyRatePct, totalPaidCents: r.totalPaidCents, cetAnnualPct: r.cetAnnualPct, principalCents: r.principalCents };
    } catch (e) {
      if (e instanceof FinancingError) throw bad(e.message, e.code);
      throw e;
    }
  }

  const validUntil = new Date(Date.now() + b.validDays * 86_400_000).toISOString().slice(0, 10);
  let row: Record<string, unknown> | null = null;
  for (let i = 0; i < 4 && !row; i++) {
    try {
      row = await tx(async (client) => {
        const r = await client.query(`INSERT INTO dealer_proposals(dealership_id,lead_id,vehicle_id,code,customer_name,vehicle_label,price_cents,down_payment_cents,trade_in_cents,months,installment_cents,rate_pct,valid_until,notes,snapshot,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [ctx.store.id, b.leadId ?? null, b.vehicleId ?? null, proposalCode(), customerName, vehicleLabel, price, b.downPaymentCents, b.tradeInCents, fin?.months ?? null, fin?.installmentCents ?? null, fin?.ratePct ?? null, validUntil, b.notes,
          JSON.stringify({ financing: fin, vehicleId: b.vehicleId ?? null }), ctx.userId]);
        if (lead) {
          await client.query(`INSERT INTO dealer_lead_events(lead_id,type,note,actor_user_id) VALUES($1,'PROPOSAL',$2,$3)`, [b.leadId, `Proposta ${r.rows[0].code} · ${money(price)}`, ctx.userId]);
          if (['NEW', 'CONTACT'].includes(String(lead.stage))) {
            await client.query(`UPDATE dealer_leads SET stage='PROPOSAL',assigned_to=COALESCE(assigned_to,$2),updated_at=now() WHERE id=$1`, [b.leadId, ctx.userId]);
            await client.query(`INSERT INTO dealer_lead_events(lead_id,type,from_stage,to_stage,actor_user_id) VALUES($1,'STAGE',$2,'PROPOSAL',$3)`, [b.leadId, lead.stage, ctx.userId]);
          } else await client.query('UPDATE dealer_leads SET updated_at=now() WHERE id=$1', [b.leadId]);
        }
        return r.rows[0];
      });
    } catch (e) { if (!isUnique(e)) throw e; }
  }
  if (!row) throw appErrorRetry();
  await audit(req.user!.id, 'DEALER_PROPOSAL_CREATED', 'DEALER_PROPOSAL', String(row.id), { code: row.code, requestId: requestId(req) });
  res.status(201).json(proposalOut(row));
}));

function appErrorRetry() { return bad('Não foi possível gerar o código da proposta. Tente de novo.', 'DEALER_PROPOSAL_CODE', 503); }

dealerOpsRouter.get('/dealer/proposals/:id', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const values: unknown[] = [uuidParam(req.params.id), ctx.store.id];
  let where = 'p.id=$1 AND p.dealership_id=$2';
  if (!can.manage(ctx)) { values.push(ctx.userId); where += ` AND p.created_by=$${values.length}`; }
  const r = await pool.query(`${PROPOSAL_SELECT} WHERE ${where}`, values);
  if (!r.rowCount) throw notFound('Proposta não encontrada.', 'DEALER_PROPOSAL_NOT_FOUND');
  res.json(proposalOut(r.rows[0]));
}));

dealerOpsRouter.get('/dealer/proposals/:id/pdf', pdfLimiter, auth, dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const values: unknown[] = [uuidParam(req.params.id), ctx.store.id];
  let where = 'p.id=$1 AND p.dealership_id=$2';
  if (!can.manage(ctx)) { values.push(ctx.userId); where += ` AND p.created_by=$${values.length}`; }
  const r = await pool.query(`${PROPOSAL_SELECT} WHERE ${where}`, values);
  if (!r.rowCount) throw notFound('Proposta não encontrada.', 'DEALER_PROPOSAL_NOT_FOUND');
  const p = r.rows[0] as Record<string, unknown>;
  let details: string[] = []; let qrUrl: string | null = null;
  if (p.vehicle_id) {
    const v = await pool.query(`SELECT v.*, q.id AS q_id FROM stock_vehicles v LEFT JOIN vehicle_queries q ON q.id=v.query_id AND q.status='SUCCESS' WHERE v.id=$1 AND v.dealership_id=$2`, [p.vehicle_id, ctx.store.id]);
    if (v.rowCount) {
      const x = v.rows[0] as Record<string, unknown>;
      details = [x.year_manufacture && x.year_model ? `${x.year_manufacture}/${x.year_model}` : x.year_model ? String(x.year_model) : '', x.color ? String(x.color) : '', x.fuel ? String(x.fuel) : '', x.transmission ? String(x.transmission) : '', x.mileage_km != null ? `${Number(x.mileage_km).toLocaleString('pt-BR')} km` : ''].filter(Boolean);
      if (x.seal_enabled && x.q_id) qrUrl = `${publicAppUrl()}/validar/${String(x.q_id).slice(0, 8).toUpperCase()}`;
    }
  }
  const snap = (p.snapshot ?? {}) as { financing?: Parameters<typeof renderProposalPdf>[0]['financing'] };
  const pdf = await renderProposalPdf({
    code: String(p.code), createdAt: p.created_at as Date, validUntil: dayOut(p.valid_until) ?? '', store: { name: ctx.store.name, whatsapp: ctx.store.whatsapp, email: ctx.store.email, city: ctx.store.city, state: ctx.store.state },
    customerName: String(p.customer_name), vehicleLabel: String(p.vehicle_label), vehicleDetails: details, priceCents: Number(p.price_cents), downPaymentCents: Number(p.down_payment_cents), tradeInCents: Number(p.trade_in_cents),
    financing: snap.financing ?? null, notes: String(p.notes ?? ''), sellerName: p.seller_name ? String(p.seller_name) : null, qrUrl, siteUrl: publicAppUrl()
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="proposta-${String(p.code).toLowerCase()}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
}));

// ---------------------------------------------------------------- avaliação de troca

const tradeBody = z.object({
  plate: plateZ.nullish(),
  vehicleLabel: z.string().trim().min(2).max(120),
  yearModel: z.number().int().min(1950).max(new Date().getFullYear() + 1).nullish(),
  mileageKm: z.number().int().min(0).max(2_000_000),
  condition: z.enum(['EXCELENTE', 'BOM', 'REGULAR']),
  fipeCents: z.number().int().min(100_000).max(2_000_000_000),
  leadId: z.string().uuid().nullish()
}).strict();

const tradeOut = (r: Record<string, unknown>) => ({
  id: r.id, plate: r.plate ?? null, vehicleLabel: r.vehicle_label, yearModel: r.year_model ?? null, mileageKm: Number(r.mileage_km), condition: r.condition, fipeCents: Number(r.fipe_cents),
  suggestedCents: Number(r.suggested_cents), minCents: Number(r.min_cents), maxCents: Number(r.max_cents), breakdown: r.breakdown, leadId: r.lead_id ?? null, createdAt: iso(r.created_at)
});

dealerOpsRouter.post('/dealer/trade-in', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = tradeBody.safeParse(req.body);
  if (!parsed.success) throw bad('Confira os dados da avaliação.');
  const b = parsed.data;
  if (b.leadId) {
    const values: unknown[] = [b.leadId, ctx.store.id];
    const l = await pool.query(`SELECT 1 FROM dealer_leads l WHERE l.id=$1 AND l.dealership_id=$2${leadScope(ctx, values)}`, values);
    if (!l.rowCount) throw notFound('Lead não encontrado.', 'DEALER_LEAD_NOT_FOUND');
  }
  const calc = computeTradeIn({ fipeCents: b.fipeCents, mileageKm: b.mileageKm, yearModel: b.yearModel ?? null, condition: b.condition, storeDiscountBps: ctx.store.tradeInDiscountBps });
  const r = await pool.query(`INSERT INTO dealer_trade_ins(dealership_id,plate,vehicle_label,year_model,mileage_km,condition,fipe_cents,suggested_cents,min_cents,max_cents,breakdown,lead_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [ctx.store.id, b.plate ?? null, b.vehicleLabel, b.yearModel ?? null, b.mileageKm, b.condition, b.fipeCents, calc.suggestedCents, calc.minCents, calc.maxCents, JSON.stringify({ lines: calc.lines, expectedKm: calc.expectedKm }), b.leadId ?? null, ctx.userId]);
  await audit(req.user!.id, 'DEALER_TRADE_IN', 'DEALER_TRADE_IN', String(r.rows[0].id), { requestId: requestId(req) });
  res.status(201).json(tradeOut(r.rows[0]));
}));

dealerOpsRouter.get('/dealer/trade-ins', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const values: unknown[] = [ctx.store.id];
  let where = 'dealership_id=$1';
  if (!can.manage(ctx)) { values.push(ctx.userId); where += ` AND created_by=$${values.length}`; }
  const r = await pool.query(`SELECT * FROM dealer_trade_ins WHERE ${where} ORDER BY created_at DESC LIMIT 100`, values);
  res.json(r.rows.map(tradeOut));
}));

// ---------------------------------------------------------------- alertas e resumo

dealerOpsRouter.get('/dealer/alerts', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  type Alert = { kind: string; severity: 'high' | 'medium'; vehicleId?: string; leadId?: string; label: string; detail: string };
  const alerts: Alert[] = [];
  const vq = await pool.query(`SELECT id,brand,model,year_model,plate,price_cents,fipe_cents,ipva_due_on,licensing_due_on,(current_date-entered_on)::int AS days,
      (ipva_due_on-current_date)::int AS ipva_in,(licensing_due_on-current_date)::int AS lic_in
    FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED')`, [ctx.store.id]);
  const name = (v: Record<string, unknown>) => [v.brand, v.model, v.year_model].filter(Boolean).join(' ');
  for (const v of vq.rows) {
    if (Number(v.days) >= ctx.store.staleDays) alerts.push({ kind: 'STALE', severity: 'medium', vehicleId: v.id, label: name(v), detail: `Parado há ${v.days} dias` });
    if (v.fipe_cents && Number(v.price_cents) > Number(v.fipe_cents) * 1.1) alerts.push({ kind: 'ABOVE_FIPE', severity: 'medium', vehicleId: v.id, label: name(v), detail: `Preço ${Math.round(((Number(v.price_cents) - Number(v.fipe_cents)) / Number(v.fipe_cents)) * 100)}% acima da FIPE` });
    for (const [kind, due, label] of [['IPVA', v.ipva_in, 'IPVA'], ['LICENSING', v.lic_in, 'Licenciamento']] as const) {
      if (due == null || Number(due) > 30) continue;
      alerts.push({ kind, severity: Number(due) < 0 ? 'high' : 'medium', vehicleId: v.id, label: name(v), detail: Number(due) < 0 ? `${label} vencido há ${-Number(due)} dias` : `${label} vence em ${due} dias` });
    }
  }
  const values: unknown[] = [ctx.store.id];
  const scope = leadScope(ctx, values);
  const lq = await pool.query(`SELECT l.id,l.name,l.stage,l.assigned_to,l.next_contact_at,l.created_at FROM dealer_leads l WHERE l.dealership_id=$1 AND l.stage IN ('NEW','CONTACT','PROPOSAL','VISIT')${scope}
    AND (l.next_contact_at <= now() OR (l.assigned_to IS NULL AND l.created_at < now() - interval '1 hour'))`, values);
  for (const l of lq.rows) {
    if (l.next_contact_at && new Date(l.next_contact_at) <= new Date()) alerts.push({ kind: 'FOLLOW_UP', severity: 'high', leadId: l.id, label: l.name, detail: 'Retorno combinado atrasado' });
    else if (!l.assigned_to) alerts.push({ kind: 'UNASSIGNED', severity: 'medium', leadId: l.id, label: l.name, detail: 'Lead sem responsável' });
  }
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  res.json({ total: alerts.length, items: alerts.slice(0, 100) });
}));

dealerOpsRouter.get('/dealer/summary', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const manage = can.manage(ctx);
  const lv: unknown[] = [ctx.store.id];
  const scope = leadScope(ctx, lv);
  const [stock, funnel, month, sold, rank] = await Promise.all([
    pool.query(`SELECT status, count(*)::int AS n, COALESCE(sum(price_cents),0)::bigint AS price, COALESCE(sum(cost_cents),0)::bigint AS cost FROM stock_vehicles WHERE dealership_id=$1 GROUP BY status`, [ctx.store.id]),
    pool.query(`SELECT l.stage, count(*)::int AS n FROM dealer_leads l WHERE l.dealership_id=$1${scope} GROUP BY l.stage`, lv),
    pool.query(`SELECT count(*)::int AS created, count(*) FILTER (WHERE l.stage='WON' AND l.closed_at >= now()-interval '30 days')::int AS won,
        count(*) FILTER (WHERE l.stage='LOST' AND l.closed_at >= now()-interval '30 days')::int AS lost
      FROM dealer_leads l WHERE l.dealership_id=$1${scope} AND (l.created_at >= now()-interval '30 days' OR l.closed_at >= now()-interval '30 days')`, lv),
    manage ? pool.query(`SELECT count(*)::int AS n, COALESCE(sum(sold_price_cents),0)::bigint AS revenue, COALESCE(sum(sold_price_cents-cost_cents) FILTER (WHERE cost_cents IS NOT NULL),0)::bigint AS profit,
        avg(EXTRACT(EPOCH FROM (sold_at - entered_on::timestamptz))/86400) AS avg_days
      FROM stock_vehicles WHERE dealership_id=$1 AND status='SOLD' AND sold_at >= now()-interval '30 days'`, [ctx.store.id]) : Promise.resolve(null),
    manage ? pool.query(`SELECT u.id,u.name,count(*) FILTER (WHERE l.stage='WON' AND l.closed_at >= now()-interval '30 days')::int AS won,
        COALESCE(sum(l.value_cents) FILTER (WHERE l.stage='WON' AND l.closed_at >= now()-interval '30 days'),0)::bigint AS value,
        count(*) FILTER (WHERE l.stage IN ('NEW','CONTACT','PROPOSAL','VISIT'))::int AS open
      FROM dealership_members m JOIN users u ON u.id=m.user_id LEFT JOIN dealer_leads l ON l.assigned_to=u.id AND l.dealership_id=m.dealership_id
      WHERE m.dealership_id=$1 AND m.active GROUP BY u.id,u.name ORDER BY won DESC, value DESC`, [ctx.store.id]) : Promise.resolve(null)
  ]);
  const byStatus = Object.fromEntries(stock.rows.map((r) => [r.status, { count: r.n, priceCents: Number(r.price), costCents: manage ? Number(r.cost) : null }]));
  const open = ['AVAILABLE', 'RESERVED'].reduce((a, k) => ({ count: a.count + (byStatus[k]?.count ?? 0), priceCents: a.priceCents + (byStatus[k]?.priceCents ?? 0), costCents: manage ? (a.costCents ?? 0) + (byStatus[k]?.costCents ?? 0) : null }), { count: 0, priceCents: 0, costCents: manage ? 0 : null as number | null });
  const stages: Record<string, number> = { NEW: 0, CONTACT: 0, PROPOSAL: 0, VISIT: 0, WON: 0, LOST: 0 };
  for (const r of funnel.rows) stages[String(r.stage)] = r.n;
  const m = month.rows[0]; const closed = m.won + m.lost;
  const s = sold?.rows[0];
  res.json({
    stock: { open, sold: byStatus.SOLD?.count ?? 0, available: byStatus.AVAILABLE?.count ?? 0, reserved: byStatus.RESERVED?.count ?? 0 },
    funnel: stages,
    last30: { leads: m.created, won: m.won, lost: m.lost, conversionPct: closed ? Math.round((m.won / closed) * 100) : null,
      sold: s ? s.n : null, revenueCents: s ? Number(s.revenue) : null, profitCents: s ? Number(s.profit) : null, avgDaysToSell: s && s.avg_days != null ? Math.round(Number(s.avg_days)) : null },
    sellers: rank ? rank.rows.map((x) => ({ userId: x.id, name: x.name, won: x.won, valueCents: Number(x.value), open: x.open })) : null
  });
}));
