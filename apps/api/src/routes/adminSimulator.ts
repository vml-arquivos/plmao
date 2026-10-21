import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { BCB_SERIES, loadFinancingSettings, refreshRatesFromBcb } from '../financingSettings.js';

/** Painel: taxas de referência (Banco Central), tarifas de referência, IOF e simulações feitas pelos clientes. */
export const adminSimulatorRouter = Router();
adminSimulatorRouter.use(adminAuth, requirePermission('MANAGE_BILLING'));

const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const rate = z.number().min(0.05).max(15);
const feeCents = z.number().int().min(0).max(5_000_000);

const settingsBody = z.object({
  cdcPf: rate, cdcPj: rate, leasingPj: rate,
  leasingPf: rate.nullable(),
  autoRefresh: z.boolean(),
  fees: z.object({ cadastroCents: feeCents, avaliacaoCents: feeCents, registroCents: feeCents }).strict(),
  iof: z.object({ pfDailyPct: z.number().min(0).max(0.05), pjDailyPct: z.number().min(0).max(0.05), additionalPct: z.number().min(0).max(5), capDays: z.number().int().min(30).max(3650) }).strict()
}).partial().strict();

adminSimulatorRouter.get('/settings', asyncRoute(async (_req, res) => {
  res.json({ settings: await loadFinancingSettings(), series: BCB_SERIES });
}));

adminSimulatorRouter.put('/settings', asyncRoute(async (req, res) => {
  const p = settingsBody.safeParse(req.body);
  if (!p.success) throw bad();
  const d = p.data;
  const sets: string[] = []; const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (d.cdcPf !== undefined) add('cdc_pf_pct', d.cdcPf);
  if (d.cdcPj !== undefined) add('cdc_pj_pct', d.cdcPj);
  if (d.leasingPj !== undefined) add('leasing_pj_pct', d.leasingPj);
  if (d.leasingPf !== undefined) add('leasing_pf_pct', d.leasingPf);
  if (d.autoRefresh !== undefined) add('auto_refresh', d.autoRefresh);
  if (d.fees) { add('fee_cadastro_cents', d.fees.cadastroCents); add('fee_avaliacao_cents', d.fees.avaliacaoCents); add('fee_registro_cents', d.fees.registroCents); }
  if (d.iof) { add('iof_pf_daily_pct', d.iof.pfDailyPct); add('iof_pj_daily_pct', d.iof.pjDailyPct); add('iof_additional_pct', d.iof.additionalPct); add('iof_cap_days', d.iof.capDays); }
  const ratesTouched = d.cdcPf !== undefined || d.cdcPj !== undefined || d.leasingPj !== undefined || d.leasingPf !== undefined;
  if (ratesTouched) { sets.push(`rates_source='Informado pela equipe'`); sets.push(`rates_reference_month=to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM')`); }
  if (!sets.length) throw bad();
  vals.push(req.user!.id);
  await pool.query(`UPDATE financing_settings SET ${sets.join(', ')}, updated_by=$${vals.length}, updated_at=now() WHERE id=1`, vals);
  await audit(req.user!.id, 'FINANCING_SETTINGS_UPDATED', 'financing_settings', '1', { fields: Object.keys(d) });
  res.json({ settings: await loadFinancingSettings() });
}));

adminSimulatorRouter.post('/refresh', asyncRoute(async (req, res) => {
  const r = await refreshRatesFromBcb();
  await audit(req.user!.id, 'FINANCING_RATES_REFRESHED', 'financing_settings', '1', { ok: r.ok, error: r.error ?? null });
  if (!r.ok) throw appError('BCB_UNAVAILABLE', { code: 'BCB_UNAVAILABLE', http: 502, expose: true });
  res.json({ settings: await loadFinancingSettings() });
}));

adminSimulatorRouter.get('/simulations', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const [rows, stats] = await Promise.all([
    pool.query(
      `SELECT s.id, s.code, s.modality, s.vehicle_kind, s.person_type, s.vehicle_value_cents, s.down_payment_cents, s.months, s.monthly_rate_pct, s.installment_cents, s.total_paid_cents, s.cet_annual_pct, s.created_at, u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM financing_simulations s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30, COALESCE(sum(vehicle_value_cents - down_payment_cents) FILTER (WHERE created_at > now() - interval '30 days'),0)::bigint AS volume30 FROM financing_simulations`)
  ]);
  res.json({
    stats: { total: stats.rows[0].total, last30: stats.rows[0].last30, volume30Cents: Number(stats.rows[0].volume30) },
    items: rows.rows.map((r) => ({
      id: r.id, code: r.code, modality: r.modality, vehicleKind: r.vehicle_kind, personType: r.person_type,
      vehicleValueCents: Number(r.vehicle_value_cents), downPaymentCents: Number(r.down_payment_cents), months: r.months,
      monthlyRatePct: Number(r.monthly_rate_pct), installmentCents: Number(r.installment_cents), totalPaidCents: Number(r.total_paid_cents),
      cetAnnualPct: r.cet_annual_pct == null ? null : Number(r.cet_annual_pct), createdAt: r.created_at,
      customer: r.user_id ? { id: r.user_id, name: r.user_name, email: r.user_email } : null
    }))
  });
}));
