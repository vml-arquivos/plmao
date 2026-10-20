/**
 * Regra de preço de referência: o preço de venda é o MAIOR valor terminado em ,90
 * que seja <= (preço de referência de mercado × (1 − desconto)). Padrão: 5% abaixo.
 * Exemplos: 64,90 → 60,90 · 79,90 → 75,90 · 13,90 → 12,90 · 45,90 → 42,90.
 *
 * Trava de margem: o preço nunca desce abaixo do piso que preserva a margem mínima
 * em todas as formas de pagamento habilitadas; nesse caso o preço é "travado" e o painel avisa.
 */
import { applyBps } from '../lib/money.js';
import { psychologicalPriceCents } from './engine.js';

/** Maior valor `X<ending>` (em centavos) menor ou igual a `maxCents`; null se não existir valor positivo. */
export function largestEndingAtOrBelow(maxCents: number, endingCents = 90): number | null {
  if (!Number.isFinite(maxCents) || maxCents < endingCents) return null;
  const k = Math.floor((maxCents - endingCents) / 100);
  return k * 100 + endingCents;
}

export function priceFromReference(referenceCents: number, discountBps = 500, endingCents = 90): number | null {
  if (!Number.isInteger(referenceCents) || referenceCents <= 0) return null;
  if (discountBps < 0 || discountBps >= 10_000) throw new RangeError('discountBps inválido');
  const ceiling = referenceCents - applyBps(referenceCents, discountBps);
  // evita erro de arredondamento half-up em centavos: usa o teto exato (floor) para nunca passar do alvo
  const exactCeiling = Math.floor((referenceCents * (10_000 - discountBps)) / 10_000);
  return largestEndingAtOrBelow(Math.min(ceiling, exactCeiling), endingCents);
}

export interface ReferencePriceDecision {
  referenceCents: number | null;
  ruleCents: number | null;
  floorCents: number | null;
  finalCents: number;
  marginLocked: boolean;
  belowMarketBps: number | null;
  reason: 'RULE' | 'MARGIN_LOCK' | 'NO_REFERENCE' | 'FREE';
}

export function decideReferencePrice(input: { referenceCents: number | null; discountBps?: number; endingCents?: number; floorCents?: number | null; currentCents?: number; isFree?: boolean }): ReferencePriceDecision {
  const ending = input.endingCents ?? 90;
  const floor = input.floorCents != null && input.floorCents > 0 ? psychologicalPriceCents(input.floorCents, ending) : null;
  if (input.isFree) return { referenceCents: input.referenceCents, ruleCents: null, floorCents: floor, finalCents: 0, marginLocked: false, belowMarketBps: null, reason: 'FREE' };
  const rule = input.referenceCents ? priceFromReference(input.referenceCents, input.discountBps ?? 500, ending) : null;
  if (rule == null) {
    const fallback = Math.max(input.currentCents ?? 0, floor ?? 0);
    return { referenceCents: input.referenceCents, ruleCents: null, floorCents: floor, finalCents: fallback, marginLocked: false, belowMarketBps: null, reason: 'NO_REFERENCE' };
  }
  const locked = floor != null && rule < floor;
  const finalCents = locked ? floor! : rule;
  const belowMarketBps = input.referenceCents ? Math.round(((input.referenceCents - finalCents) * 10_000) / input.referenceCents) : null;
  return { referenceCents: input.referenceCents, ruleCents: rule, floorCents: floor, finalCents, marginLocked: locked, belowMarketBps, reason: locked ? 'MARGIN_LOCK' : 'RULE' };
}
