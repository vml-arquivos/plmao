import { pool } from './db.js';
import type { BankConfig, BcbBankRate } from './lib/bankRates.js';
import type { Modality, PersonType } from './lib/financing.js';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadBanks(onlyActive = true): Promise<BankConfig[]> {
  const r = await pool.query(`SELECT * FROM financing_banks ${onlyActive ? 'WHERE active' : ''} ORDER BY display_order, name`);
  return r.rows.map((b) => ({
    id: b.id, name: b.name, bcbMatch: b.bcb_match,
    cdcPfPct: num(b.cdc_pf_pct), cdcPjPct: num(b.cdc_pj_pct), leasingPjPct: num(b.leasing_pj_pct),
    fees: { cadastroCents: num(b.fee_cadastro_cents), avaliacaoCents: num(b.fee_avaliacao_cents), registroCents: num(b.fee_registro_cents) },
    notes: b.notes, active: b.active, displayOrder: b.display_order, updatedAt: new Date(b.updated_at).toISOString()
  }));
}

export async function loadBcbBankRates(): Promise<BcbBankRate[]> {
  const r = await pool.query('SELECT segment, modality, institution, monthly_pct, annual_pct, position, period FROM financing_bank_rates');
  return r.rows.map((x) => ({
    segment: x.segment as PersonType, modality: x.modality as Modality, institution: x.institution,
    monthlyPct: Number(x.monthly_pct), annualPct: num(x.annual_pct), position: x.position, period: x.period
  }));
}
