/**
 * Placa na Mão — Motor de precificação (centavos inteiros + basis points).
 *
 * Porte do motor do PermuPay Vendas (cálculo reverso de margem por forma de pagamento,
 * juros compostos, diagnóstico financeiro) para aritmética inteira: toda entrada e saída
 * monetária é em CENTAVOS e todo percentual em BASIS POINTS (1% = 100 bps).
 *
 * AVISO FISCAL: as alíquotas padrão são apenas sugestões. Confirme o regime tributário,
 * a classificação do serviço e eventual retenção com o seu contador antes de usar em produção.
 */
import { divCeil, divRound } from '../lib/money.js';

export type PaymentMethod = 'PIX' | 'BOLETO' | 'DEBITO' | 'CREDITO_A_VISTA' | 'CREDITO_PARCELADO';
export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MANUAL';
export type DiagnosticStatus = 'EXCELENTE' | 'SAUDAVEL' | 'ATENCAO' | 'RISCO' | 'PREJUIZO';
export type MarginBase = 'COST_PRICE' | 'TOTAL_COST';

export interface TaxRatesBps { cash: number; boleto: number; debit: number; creditCash: number; creditInstallment: number }

export interface BoletoConfig {
  months: number;
  monthlyInterestBps: number;
  fixedFeeCents: number;
  defaultRiskBps: number;
  customerPaysInterest: boolean;
}

export interface CardConfig {
  debitFeeBps: number;
  creditCashFeeBps: number;
  creditInstallmentFeeBps: number;
  installments: number;
  anticipationBps: number;
  monthlyInterestBps: number;
  customerPaysInterest: boolean;
}

export interface PixConfig { feeBps: number; fixedFeeCents: number }

export interface PricingInput {
  productName: string;
  /** Custo direto do provedor de dados por consulta. */
  costPriceCents: number;
  /** Outros custos unitários (infraestrutura, suporte, operação). */
  otherCostsCents: number;
  /** Margem desejada em bps (3000 = 30%). */
  desiredMarginBps: number;
  /** Sobre o que a margem incide. Padrão: preço de custo (paridade com o PermuPay). */
  marginBase?: MarginBase;
  taxRegime: TaxRegime;
  taxRates: TaxRatesBps;
  pix?: PixConfig;
  boleto: BoletoConfig;
  card: CardConfig;
}

export interface PaymentResult {
  method: PaymentMethod;
  methodLabel: string;
  suggestedPriceCents: number;
  psychologicalPriceCents: number;
  installmentValueCents: number;
  installments: number;
  totalTaxCents: number;
  totalFeesCents: number;
  totalInterestCents: number;
  netProfitCents: number;
  realMarginBps: number;
  markupOnCostBps: number;
  diagnostic: DiagnosticStatus;
  minPriceNoLossCents: number;
  minPriceWithMarginCents: number;
  baseCostCents: number;
  marginValueCents: number;
  subtotalWithMarginCents: number;
  otherCostsCents: number;
}

export interface PricingResult {
  input: PricingInput;
  totalCostCents: number;
  results: PaymentResult[];
  bestMethod: PaymentMethod;
  worstMethod: PaymentMethod;
  promotionMinPriceCents: number;
  /** Menor preço que mantém a margem desejada em TODAS as formas de pagamento. */
  safePriceCents: number;
  hasUnhealthyProduct: boolean;
  unhealthyAlert?: string;
  fiscalWarning: string;
}

export interface PricingError {
  code: 'INVALID_PERCENTAGES' | 'NEGATIVE_COST' | 'NEGATIVE_MARGIN' | 'INVALID_PERIODS' | 'INVALID_NUMBER' | 'CALCULATION_ERROR';
  message: string;
}

export const FISCAL_WARNING = 'Alíquotas sugeridas, não são consultoria tributária. Confirme regime, classificação do serviço e retenções com o seu contador.';

export const SUGGESTED_TAX_RATES_BPS: Record<TaxRegime, TaxRatesBps> = {
  SIMPLES_NACIONAL: { cash: 600, boleto: 600, debit: 600, creditCash: 600, creditInstallment: 600 },
  LUCRO_PRESUMIDO: { cash: 1133, boleto: 1133, debit: 1133, creditCash: 1133, creditInstallment: 1133 },
  LUCRO_REAL: { cash: 1325, boleto: 1325, debit: 1325, creditCash: 1325, creditInstallment: 1325 },
  MANUAL: { cash: 0, boleto: 0, debit: 0, creditCash: 0, creditInstallment: 0 }
};

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional', LUCRO_PRESUMIDO: 'Lucro Presumido', LUCRO_REAL: 'Lucro Real', MANUAL: 'Manual'
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: 'Pix / À vista', BOLETO: 'Boleto bancário', DEBITO: 'Cartão de débito', CREDITO_A_VISTA: 'Crédito à vista', CREDITO_PARCELADO: 'Crédito parcelado'
};

/** Menor valor terminado em ,90 que seja >= preço (em centavos). */
export function psychologicalPriceCents(priceCents: number, endingCents = 90): number {
  const whole = Math.floor(priceCents / 100);
  const candidate = whole * 100 + endingCents;
  return candidate >= priceCents ? candidate : candidate + 100;
}

/** valor × (1 + taxa)^períodos, em centavos. */
export function compoundInterestCents(baseCents: number, monthlyBps: number, periods: number): number {
  if (monthlyBps === 0 || periods <= 1) return baseCents;
  return Math.round(baseCents * Math.pow(1 + monthlyBps / 10_000, periods));
}

/**
 * EXCELENTE >= desejada + 10 p.p. · SAUDÁVEL >= desejada · ATENÇÃO < desejada (>= 10%) · RISCO < 10% · PREJUÍZO lucro < 0.
 */
export function getDiagnostic(realMarginBps: number, netProfitCents: number, desiredMarginBps = 1000): DiagnosticStatus {
  if (netProfitCents < 0) return 'PREJUIZO';
  if (realMarginBps < 1000) return 'RISCO';
  if (realMarginBps < desiredMarginBps) return 'ATENCAO';
  if (realMarginBps >= desiredMarginBps + 1000) return 'EXCELENTE';
  return 'SAUDAVEL';
}

export function validatePricingInput(input: PricingInput): PricingError | null {
  const numbers = [input.costPriceCents, input.otherCostsCents, input.desiredMarginBps, input.boleto.months, input.boleto.fixedFeeCents, input.card.installments];
  if (numbers.some((n) => !Number.isFinite(n) || !Number.isInteger(n))) return { code: 'INVALID_NUMBER', message: 'Valores monetários devem ser inteiros em centavos e percentuais inteiros em basis points.' };
  if (input.costPriceCents < 0 || input.otherCostsCents < 0) return { code: 'NEGATIVE_COST', message: 'O custo não pode ser negativo.' };
  if (input.desiredMarginBps < 0) return { code: 'NEGATIVE_MARGIN', message: 'A margem desejada não pode ser negativa.' };
  if (input.boleto.months < 1) return { code: 'INVALID_PERIODS', message: 'A quantidade de meses do boleto deve ser no mínimo 1.' };
  if (input.card.installments < 1) return { code: 'INVALID_PERIODS', message: 'O número de parcelas deve ser no mínimo 1.' };
  const pix = input.pix ?? { feeBps: 0, fixedFeeCents: 0 };
  const sums: Array<[string, number]> = [
    ['Pix', input.taxRates.cash + pix.feeBps],
    ['Boleto', input.taxRates.boleto + input.boleto.defaultRiskBps],
    ['Débito', input.taxRates.debit + input.card.debitFeeBps],
    ['Crédito à vista', input.taxRates.creditCash + input.card.creditCashFeeBps],
    ['Crédito parcelado', input.taxRates.creditInstallment + input.card.creditInstallmentFeeBps + input.card.anticipationBps]
  ];
  for (const [method, sum] of sums) {
    // a margem é aplicada sobre o custo (não sobre o preço), logo o limite de viabilidade é apenas as taxas variáveis < 100%.
    if (sum >= 10_000) return { code: 'INVALID_PERCENTAGES', message: `A soma dos percentuais variáveis para "${method}" atingiu ${(sum / 100).toFixed(2)}%, o que tornaria o cálculo inviável. Reduza as alíquotas ou taxas.` };
  }
  return null;
}

interface Core {
  method: PaymentMethod;
  variableBps: { tax: number; fee: number; risk: number };
  fixedFeeCents: number;
  installments: number;
  interestBps: number;
  interestPeriods: number;
  customerPaysInterest: boolean;
}

function compute(input: PricingInput, core: Core): PaymentResult {
  const costPrice = input.costPriceCents;
  const totalCost = costPrice + input.otherCostsCents;
  const marginBase = input.marginBase === 'TOTAL_COST' ? totalCost : costPrice;
  const marginValue = divRound(marginBase * input.desiredMarginBps, 10_000);
  const priceBase = costPrice + marginValue;
  const variable = core.variableBps.tax + core.variableBps.fee + core.variableBps.risk;
  const denom = 10_000 - variable;
  // com margem sobre o preço de custo, "outros custos" saem do lucro (comportamento do PermuPay);
  // com TOTAL_COST eles já entram na base da margem, mas continuam sendo custo.
  const withoutInterest = divCeil((priceBase + (input.marginBase === 'TOTAL_COST' ? input.otherCostsCents : 0) + core.fixedFeeCents) * 10_000, denom);
  const grown = compoundInterestCents(withoutInterest, core.interestBps, core.interestPeriods);
  const suggested = core.customerPaysInterest ? withoutInterest : grown;
  const interest = core.customerPaysInterest
    ? grown - withoutInterest
    : suggested - withoutInterest;
  // quando o cliente paga os juros o preço-base não muda (juros são cobrados à parte); quando a empresa embute, o preço sobe.
  const priceForTax = suggested;
  const totalTax = divRound(priceForTax * core.variableBps.tax, 10_000);
  const totalFees = core.fixedFeeCents + divRound(priceForTax * (core.variableBps.fee + core.variableBps.risk), 10_000);
  const otherCosts = totalCost - costPrice;
  const absorbedInterest = core.customerPaysInterest ? 0 : interest;
  const netProfit = priceForTax - totalCost - totalTax - totalFees - absorbedInterest;
  const realMarginBps = priceForTax > 0 ? divRound(netProfit * 10_000, priceForTax) : 0;
  const markup = costPrice > 0 ? divRound((priceForTax - costPrice) * 10_000, costPrice) : 0;
  const minNoLoss = divCeil((totalCost + core.fixedFeeCents) * 10_000, denom);
  return {
    method: core.method,
    methodLabel: PAYMENT_METHOD_LABELS[core.method],
    suggestedPriceCents: priceForTax,
    psychologicalPriceCents: psychologicalPriceCents(priceForTax),
    installmentValueCents: divRound(priceForTax, core.installments),
    installments: core.installments,
    totalTaxCents: totalTax,
    totalFeesCents: totalFees,
    totalInterestCents: interest,
    netProfitCents: netProfit,
    realMarginBps,
    markupOnCostBps: markup,
    diagnostic: getDiagnostic(realMarginBps, netProfit, input.desiredMarginBps),
    minPriceNoLossCents: minNoLoss,
    minPriceWithMarginCents: priceForTax,
    baseCostCents: costPrice,
    marginValueCents: marginValue,
    subtotalWithMarginCents: priceBase,
    otherCostsCents: otherCosts
  };
}

export function calculatePricing(input: PricingInput): PricingResult | PricingError {
  const invalid = validatePricingInput(input);
  if (invalid) return invalid;
  const pix = input.pix ?? { feeBps: 0, fixedFeeCents: 0 };
  const totalCost = input.costPriceCents + input.otherCostsCents;
  const results: PaymentResult[] = [
    compute(input, { method: 'PIX', variableBps: { tax: input.taxRates.cash, fee: pix.feeBps, risk: 0 }, fixedFeeCents: pix.fixedFeeCents, installments: 1, interestBps: 0, interestPeriods: 1, customerPaysInterest: false }),
    compute(input, { method: 'BOLETO', variableBps: { tax: input.taxRates.boleto, fee: 0, risk: input.boleto.defaultRiskBps }, fixedFeeCents: input.boleto.fixedFeeCents, installments: input.boleto.months, interestBps: input.boleto.monthlyInterestBps, interestPeriods: input.boleto.months, customerPaysInterest: input.boleto.customerPaysInterest }),
    compute(input, { method: 'DEBITO', variableBps: { tax: input.taxRates.debit, fee: input.card.debitFeeBps, risk: 0 }, fixedFeeCents: 0, installments: 1, interestBps: 0, interestPeriods: 1, customerPaysInterest: false }),
    compute(input, { method: 'CREDITO_A_VISTA', variableBps: { tax: input.taxRates.creditCash, fee: input.card.creditCashFeeBps, risk: 0 }, fixedFeeCents: 0, installments: 1, interestBps: 0, interestPeriods: 1, customerPaysInterest: false }),
    compute(input, { method: 'CREDITO_PARCELADO', variableBps: { tax: input.taxRates.creditInstallment, fee: input.card.creditInstallmentFeeBps + input.card.anticipationBps, risk: 0 }, fixedFeeCents: 0, installments: input.card.installments, interestBps: input.card.monthlyInterestBps, interestPeriods: input.card.installments, customerPaysInterest: input.card.customerPaysInterest })
  ];
  const sorted = [...results].sort((a, b) => b.realMarginBps - a.realMarginBps);
  const unhealthy = results.every((r) => r.diagnostic === 'PREJUIZO' || r.diagnostic === 'RISCO');
  return {
    input,
    totalCostCents: totalCost,
    results,
    bestMethod: sorted[0]!.method,
    worstMethod: sorted[sorted.length - 1]!.method,
    promotionMinPriceCents: Math.min(...results.map((r) => r.minPriceNoLossCents)),
    safePriceCents: Math.max(...results.map((r) => r.suggestedPriceCents)),
    hasUnhealthyProduct: unhealthy,
    unhealthyAlert: unhealthy ? 'Atenção: margem crítica ou prejuízo em todas as formas de pagamento. Revise custos, taxas e margem desejada.' : undefined,
    fiscalWarning: FISCAL_WARNING
  };
}

export function isPricingError(result: PricingResult | PricingError): result is PricingError {
  return 'code' in result && 'message' in result;
}
