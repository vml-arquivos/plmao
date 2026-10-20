import { applyBps } from '../lib/money.js';
import type { CommissionBase, PaymentSettings } from '../pricing/settings.js';
import type { PaymentMethod } from '../pricing/engine.js';

export function methodFromProviderType(type: string | null | undefined): PaymentMethod {
  switch ((type ?? '').toLowerCase()) {
    case 'bank_transfer': case 'pix': return 'PIX';
    case 'ticket': case 'boleto': case 'bolbradesco': return 'BOLETO';
    case 'debit_card': return 'DEBITO';
    case 'credit_card': return 'CREDITO_A_VISTA';
    default: return 'CREDITO_A_VISTA'; // desconhecido: assume a taxa mais conservadora
  }
}

/** Estimativa de taxa do gateway e imposto quando o provedor não informa o líquido. */
export function estimateCharges(settings: PaymentSettings, method: PaymentMethod, grossCents: number): { feeCents: number; taxCents: number } {
  switch (method) {
    case 'PIX': return { feeCents: applyBps(grossCents, settings.pix.feeBps) + settings.pix.fixedFeeCents, taxCents: applyBps(grossCents, settings.taxRates.cash) };
    case 'BOLETO': return { feeCents: settings.boleto.fixedFeeCents, taxCents: applyBps(grossCents, settings.taxRates.boleto) };
    case 'DEBITO': return { feeCents: applyBps(grossCents, settings.card.debitFeeBps), taxCents: applyBps(grossCents, settings.taxRates.debit) };
    case 'CREDITO_PARCELADO': return { feeCents: applyBps(grossCents, settings.card.creditInstallmentFeeBps + settings.card.anticipationBps), taxCents: applyBps(grossCents, settings.taxRates.creditInstallment) };
    default: return { feeCents: applyBps(grossCents, settings.card.creditCashFeeBps), taxCents: applyBps(grossCents, settings.taxRates.creditCash) };
  }
}

export interface CommissionInput {
  base: CommissionBase;
  rateBps: number;
  grossCents: number;
  gatewayFeeCents: number;
  taxCents: number;
  providerCostCents: number;
}

export interface CommissionResult { baseType: CommissionBase; baseCents: number; rateBps: number; amountCents: number }

/**
 * GROSS  = valor pago · NET = pago − taxa do gateway − imposto · MARGIN = NET − custo do provedor.
 * A base nunca é negativa; a comissão é arredondada half-up em centavos.
 */
export function computeCommission(input: CommissionInput): CommissionResult {
  let baseCents = input.grossCents;
  if (input.base === 'NET') baseCents = input.grossCents - input.gatewayFeeCents - input.taxCents;
  if (input.base === 'MARGIN') baseCents = input.grossCents - input.gatewayFeeCents - input.taxCents - input.providerCostCents;
  baseCents = Math.max(0, baseCents);
  return { baseType: input.base, baseCents, rateBps: input.rateBps, amountCents: applyBps(baseCents, input.rateBps) };
}
