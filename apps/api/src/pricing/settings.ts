import type { Pool, PoolClient } from 'pg';
import { pool } from '../db.js';
import type { CardConfig, BoletoConfig, PaymentMethod, PixConfig, TaxRatesBps, TaxRegime, MarginBase } from './engine.js';

export type CommissionBase = 'GROSS' | 'NET' | 'MARGIN';

export interface PaymentSettings {
  taxRegime: TaxRegime;
  taxRates: TaxRatesBps;
  pix: PixConfig;
  boleto: BoletoConfig;
  card: CardConfig;
  enabledMethods: PaymentMethod[];
  operationalCostCents: number;
  desiredMarginBps: number;
  minMarginBps: number;
  marginBase: MarginBase;
  referenceDiscountBps: number;
  priceEndingCents: number;
  commissionBase: CommissionBase;
  commissionDefaultBps: number;
  commissionHoldDays: number;
  payoutMinCents: number;
  receiverName: string | null;
  receiverDocument: string | null;
  receiverPixKey: string | null;
  receiverBankNotes: string | null;
  receiptFooter: string | null;
  fiscalAcknowledgedAt: string | null;
  updatedAt: string | null;
}

type Queryable = Pool | PoolClient;

export async function loadPaymentSettings(db: Queryable = pool): Promise<PaymentSettings> {
  const result = await db.query('SELECT * FROM payment_settings WHERE id=1');
  const r = result.rows[0] as Record<string, unknown>;
  const n = (k: string) => Number(r[k]);
  return {
    taxRegime: String(r.tax_regime) as TaxRegime,
    taxRates: { cash: n('tax_cash_bps'), boleto: n('tax_boleto_bps'), debit: n('tax_debit_bps'), creditCash: n('tax_credit_cash_bps'), creditInstallment: n('tax_credit_installment_bps') },
    pix: { feeBps: n('pix_fee_bps'), fixedFeeCents: n('pix_fixed_fee_cents') },
    boleto: { months: n('boleto_months'), monthlyInterestBps: n('boleto_monthly_interest_bps'), fixedFeeCents: n('boleto_fixed_fee_cents'), defaultRiskBps: n('boleto_default_risk_bps'), customerPaysInterest: true },
    card: { debitFeeBps: n('debit_fee_bps'), creditCashFeeBps: n('credit_cash_fee_bps'), creditInstallmentFeeBps: n('credit_installment_fee_bps'), installments: n('installments_max'), anticipationBps: n('anticipation_bps'), monthlyInterestBps: n('card_monthly_interest_bps'), customerPaysInterest: Boolean(r.customer_pays_interest) },
    enabledMethods: (r.enabled_methods as string[]) as PaymentMethod[],
    operationalCostCents: n('operational_cost_cents'),
    desiredMarginBps: n('desired_margin_bps'),
    minMarginBps: n('min_margin_bps'),
    marginBase: String(r.margin_base) as MarginBase,
    referenceDiscountBps: n('reference_discount_bps'),
    priceEndingCents: n('price_ending_cents'),
    commissionBase: String(r.commission_base) as CommissionBase,
    commissionDefaultBps: n('commission_default_bps'),
    commissionHoldDays: n('commission_hold_days'),
    payoutMinCents: n('payout_min_cents'),
    receiverName: (r.receiver_name as string | null) ?? null,
    receiverDocument: (r.receiver_document as string | null) ?? null,
    receiverPixKey: (r.receiver_pix_key as string | null) ?? null,
    receiverBankNotes: (r.receiver_bank_notes as string | null) ?? null,
    receiptFooter: (r.receipt_footer as string | null) ?? null,
    fiscalAcknowledgedAt: r.fiscal_acknowledged_at ? new Date(String(r.fiscal_acknowledged_at)).toISOString() : null,
    updatedAt: r.updated_at ? new Date(String(r.updated_at)).toISOString() : null
  };
}

/** Mascara dados de recebimento para exibição (a chave Pix/documento completos só no formulário de edição do super admin). */
export function maskTail(value: string | null, visible = 4): string | null {
  if (!value) return null;
  const clean = value.trim();
  if (clean.length <= visible) return '•'.repeat(clean.length);
  return `${'•'.repeat(Math.min(clean.length - visible, 8))}${clean.slice(-visible)}`;
}
