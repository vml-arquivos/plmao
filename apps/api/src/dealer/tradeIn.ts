export type Condition = 'EXCELENTE' | 'BOM' | 'REGULAR';
export interface TradeInInput { fipeCents: number; mileageKm: number; yearModel: number | null; condition: Condition; storeDiscountBps: number; currentYear?: number }
export interface TradeInLine { label: string; bps: number; cents: number }
export interface TradeInResult { suggestedCents: number; minCents: number; maxCents: number; lines: TradeInLine[]; expectedKm: number | null }

const CONDITION_BPS: Record<Condition, number> = { EXCELENTE: 0, BOM: -200, REGULAR: -600 };
/** Quilometragem esperada: 12.000 km por ano de uso. */
export const KM_PER_YEAR = 12_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Estimativa interna da loja para a compra de um carro de troca. Parte da Tabela FIPE informada, tira a margem da loja
 * (configurável), ajusta pela condição e pela quilometragem em relação ao esperado e devolve uma faixa de ±3%.
 * Não é laudo nem avaliação oficial: serve de ponto de partida para a negociação.
 */
export function computeTradeIn(i: TradeInInput): TradeInResult {
  const year = i.currentYear ?? new Date().getFullYear();
  const lines: TradeInLine[] = [{ label: 'Tabela FIPE informada', bps: 0, cents: i.fipeCents }];
  let bpsTotal = 0;
  const add = (label: string, bps: number) => { if (bps !== 0) { bpsTotal += bps; lines.push({ label, bps, cents: Math.round((i.fipeCents * bps) / 10_000) }); } };
  add('Margem da loja', -i.storeDiscountBps);
  add(`Condição: ${i.condition.toLowerCase()}`, CONDITION_BPS[i.condition]);
  let expectedKm: number | null = null;
  if (i.yearModel) {
    expectedKm = Math.max(0, year - i.yearModel) * KM_PER_YEAR;
    const diff = i.mileageKm - expectedKm;
    // acima do esperado: -1% a cada 10 mil km (até -15%); abaixo: +0,5% a cada 10 mil km (até +3%)
    const km = diff > 0 ? -clamp(Math.round((diff / 10_000) * 100), 0, 1500) : clamp(Math.round((-diff / 10_000) * 50), 0, 300);
    add(diff > 0 ? 'Quilometragem acima do esperado' : 'Quilometragem abaixo do esperado', km);
  }
  const suggested = Math.max(0, Math.round((i.fipeCents * (10_000 + bpsTotal)) / 10_000));
  return { suggestedCents: suggested, minCents: Math.round(suggested * 0.97), maxCents: Math.round(suggested * 1.03), lines, expectedKm };
}
