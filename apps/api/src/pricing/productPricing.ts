import { applyBps } from '../lib/money.js';
import { calculatePricing, isPricingError, type PaymentMethod, type PricingInput, type PricingResult } from './engine.js';
import { decideReferencePrice, type ReferencePriceDecision } from './referencePrice.js';
import type { PaymentSettings } from './settings.js';

export interface ProductCostInput { id: string; name: string; providerCostCents: number; supplierCostCents?: number }

/** Monta a entrada do motor a partir das configurações globais de pagamento e do custo do produto. */
export function pricingInputFor(settings: PaymentSettings, product: ProductCostInput, margin: { desiredMarginBps?: number } = {}): PricingInput {
  return {
    productName: product.name,
    costPriceCents: product.providerCostCents + (product.supplierCostCents ?? 0),
    otherCostsCents: settings.operationalCostCents,
    desiredMarginBps: margin.desiredMarginBps ?? settings.desiredMarginBps,
    marginBase: settings.marginBase,
    taxRegime: settings.taxRegime,
    taxRates: settings.taxRates,
    pix: settings.pix,
    boleto: settings.boleto,
    card: settings.card
  };
}

/**
 * Piso de preço do produto = menor preço que garante a MARGEM MÍNIMA configurada em TODAS as formas de
 * pagamento habilitadas (a pior forma define o piso). Parcelamento/juros respeitam o que o cliente paga.
 */
export function floorPriceFor(settings: PaymentSettings, product: ProductCostInput): { floorCents: number; result: PricingResult | null; worstMethod: PaymentMethod | null } {
  if (product.providerCostCents + (product.supplierCostCents ?? 0) <= 0) return { floorCents: 0, result: null, worstMethod: null };
  const input = pricingInputFor(settings, product, { desiredMarginBps: settings.minMarginBps });
  const result = calculatePricing(input);
  if (isPricingError(result)) return { floorCents: 0, result: null, worstMethod: null };
  const enabled = result.results.filter((r) => settings.enabledMethods.includes(r.method));
  const considered = enabled.length ? enabled : result.results;
  const worst = considered.reduce((a, b) => (b.suggestedPriceCents > a.suggestedPriceCents ? b : a));
  return { floorCents: worst.suggestedPriceCents, result, worstMethod: worst.method };
}

export interface ProductPriceProposal extends ReferencePriceDecision {
  productId: string;
  currentCents: number;
  changed: boolean;
}

export function proposeProductPrice(settings: PaymentSettings, product: ProductCostInput & { referenceCents: number | null; currentCents: number; isFree?: boolean }): ProductPriceProposal {
  const { floorCents } = floorPriceFor(settings, product);
  const decision = decideReferencePrice({
    referenceCents: product.referenceCents,
    discountBps: settings.referenceDiscountBps,
    endingCents: settings.priceEndingCents,
    floorCents: floorCents || null,
    currentCents: product.currentCents,
    isFree: product.isFree
  });
  return { ...decision, productId: product.id, currentCents: product.currentCents, changed: decision.finalCents !== product.currentCents };
}

/** Margem efetiva (bps do preço) por forma de pagamento para um preço praticado. */
export function marginAtPrice(settings: PaymentSettings, product: ProductCostInput, priceCents: number): Array<{ method: PaymentMethod; netProfitCents: number; marginBps: number }> {
  const cost = product.providerCostCents + (product.supplierCostCents ?? 0) + settings.operationalCostCents;
  const rows: Array<{ method: PaymentMethod; taxBps: number; feeBps: number; fixed: number }> = [
    { method: 'PIX', taxBps: settings.taxRates.cash, feeBps: settings.pix.feeBps, fixed: settings.pix.fixedFeeCents },
    { method: 'BOLETO', taxBps: settings.taxRates.boleto, feeBps: settings.boleto.defaultRiskBps, fixed: settings.boleto.fixedFeeCents },
    { method: 'DEBITO', taxBps: settings.taxRates.debit, feeBps: settings.card.debitFeeBps, fixed: 0 },
    { method: 'CREDITO_A_VISTA', taxBps: settings.taxRates.creditCash, feeBps: settings.card.creditCashFeeBps, fixed: 0 },
    { method: 'CREDITO_PARCELADO', taxBps: settings.taxRates.creditInstallment, feeBps: settings.card.creditInstallmentFeeBps + settings.card.anticipationBps, fixed: 0 }
  ];
  return rows.map((row) => {
    const net = priceCents - cost - applyBps(priceCents, row.taxBps) - applyBps(priceCents, row.feeBps) - row.fixed;
    return { method: row.method, netProfitCents: net, marginBps: priceCents > 0 ? Math.round((net * 10_000) / priceCents) : 0 };
  });
}
