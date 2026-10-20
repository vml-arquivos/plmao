/**
 * Dinheiro sempre em CENTAVOS INTEIROS; percentuais sempre em BASIS POINTS (1% = 100 bps).
 * Nenhum valor monetário trafega como float fora das bordas de exibição.
 */

export type Cents = number;
export type Bps = number;

export function assertCents(value: number, label = 'valor'): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} deve ser inteiro (centavos)`);
  return value;
}

/** Converte "29,90", "R$ 29,90", "1.234,56", "29.9" ou número em reais para centavos. */
export function parseBRLToCents(input: string | number): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError('valor inválido');
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) throw new RangeError('valor inválido');
  let normalized = cleaned;
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new RangeError('valor inválido');
  return Math.round(value * 100);
}

export function formatBRL(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

export function formatBps(bps: Bps): string {
  return `${(bps / 100).toFixed(2).replace('.', ',')}%`;
}

/** Divisão inteira com arredondamento "meio para cima" (half-up) para valores não negativos e simétrico para negativos. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('divisão por zero');
  const sign = (numerator < 0) !== (denominator < 0) ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

export function divCeil(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('denominador inválido');
  return Math.ceil(numerator / denominator);
}

/** cents × bps / 10000 com half-up. */
export function applyBps(cents: Cents, bps: Bps): Cents {
  return divRound(cents * bps, 10_000);
}

/** Divide `total` em partes proporcionais sem perder centavo (maior resto). */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}
