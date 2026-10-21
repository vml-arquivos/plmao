import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { loadBanks, loadBcbBankRates } from '../financingBanks.js';
import { pickBankRate } from '../lib/bankRates.js';
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

// ---------------------------------------------------------------- bancos
const optRate = z.number().min(0.05).max(15).nullable();
const optFee = z.number().int().min(0).max(5_000_000).nullable();
const bankFields = {
  name: z.string().trim().min(2).max(60),
  bcbMatch: z.string().trim().max(80).default(''),
  cdcPfPct: optRate.default(null), cdcPjPct: optRate.default(null), leasingPjPct: optRate.default(null),
  feeCadastroCents: optFee.default(null), feeAvaliacaoCents: optFee.default(null), feeRegistroCents: optFee.default(null),
  notes: z.string().trim().max(300).default(''),
  active: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(1000).default(0)
};
const bankCreate = z.object(bankFields).strict();
const bankUpdate = z.object(bankFields).partial().strict();

adminSimulatorRouter.get('/banks', asyncRoute(async (_req, res) => {
  const [banks, bcb, settings] = await Promise.all([loadBanks(false), loadBcbBankRates(), loadFinancingSettings()]);
  res.json({
    items: banks.map((b) => ({
      ...b,
      // taxa que o simulador usa hoje para cada combinação (informada ou média do Banco Central)
      current: {
        cdcPf: pickBankRate(b, 'CDC', 'PF', bcb), cdcPj: pickBankRate(b, 'CDC', 'PJ', bcb), leasingPj: pickBankRate(b, 'LEASING', 'PJ', bcb)
      }
    })),
    bcb: { institutions: new Set(bcb.map((r) => r.institution)).size, refreshedAt: settings.banksRefreshedAt, error: settings.banksRefreshError }
  });
}));

/** Instituições que o Banco Central informou (ajuda a achar o texto para o campo "nome no Banco Central"). */
adminSimulatorRouter.get('/banks/bcb-institutions', asyncRoute(async (_req, res) => {
  const rows = await loadBcbBankRates();
  const names = [...new Set(rows.map((r) => r.institution))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  res.json({ items: names });
}));

adminSimulatorRouter.post('/banks', asyncRoute(async (req, res) => {
  const p = bankCreate.safeParse(req.body);
  if (!p.success) throw bad();
  const d = p.data;
  if ((await pool.query('SELECT 1 FROM financing_banks WHERE lower(name)=lower($1)', [d.name])).rowCount) throw appError('BANK_EXISTS', { code: 'BANK_EXISTS', http: 409, expose: true });
  const r = await pool.query(
    `INSERT INTO financing_banks(name,bcb_match,cdc_pf_pct,cdc_pj_pct,leasing_pj_pct,fee_cadastro_cents,fee_avaliacao_cents,fee_registro_cents,notes,active,display_order)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [d.name, d.bcbMatch, d.cdcPfPct, d.cdcPjPct, d.leasingPjPct, d.feeCadastroCents, d.feeAvaliacaoCents, d.feeRegistroCents, d.notes, d.active, d.displayOrder]);
  await audit(req.user!.id, 'FINANCING_BANK_CREATED', 'financing_bank', r.rows[0].id, { name: d.name });
  res.status(201).json({ id: r.rows[0].id });
}));

adminSimulatorRouter.put('/banks/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw appError('BANK_NOT_FOUND', { code: 'BANK_NOT_FOUND', http: 404, expose: true });
  const p = bankUpdate.safeParse(req.body);
  if (!p.success) throw bad();
  const d = p.data;
  const cols: Record<string, string> = {
    name: 'name', bcbMatch: 'bcb_match', cdcPfPct: 'cdc_pf_pct', cdcPjPct: 'cdc_pj_pct', leasingPjPct: 'leasing_pj_pct',
    feeCadastroCents: 'fee_cadastro_cents', feeAvaliacaoCents: 'fee_avaliacao_cents', feeRegistroCents: 'fee_registro_cents', notes: 'notes', active: 'active', displayOrder: 'display_order'
  };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, col] of Object.entries(cols)) {
    const v = (d as Record<string, unknown>)[k];
    if (v !== undefined) { vals.push(v); sets.push(`${col}=$${vals.length}`); }
  }
  if (!sets.length) throw bad();
  if (d.name !== undefined && (await pool.query('SELECT 1 FROM financing_banks WHERE lower(name)=lower($1) AND id<>$2', [d.name, id])).rowCount) throw appError('BANK_EXISTS', { code: 'BANK_EXISTS', http: 409, expose: true });
  vals.push(id);
  const r = await pool.query(`UPDATE financing_banks SET ${sets.join(', ')}, updated_at=now() WHERE id=$${vals.length} RETURNING id`, vals);
  if (!r.rowCount) throw appError('BANK_NOT_FOUND', { code: 'BANK_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'FINANCING_BANK_UPDATED', 'financing_bank', id, { fields: Object.keys(d) });
  res.json({ ok: true });
}));

adminSimulatorRouter.delete('/banks/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw appError('BANK_NOT_FOUND', { code: 'BANK_NOT_FOUND', http: 404, expose: true });
  const r = await pool.query('DELETE FROM financing_banks WHERE id=$1 RETURNING name', [id]);
  if (!r.rowCount) throw appError('BANK_NOT_FOUND', { code: 'BANK_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'FINANCING_BANK_DELETED', 'financing_bank', id, { name: r.rows[0].name });
  res.json({ ok: true });
}));
