import type { PricePoint } from './estimates.js';

/** Valor de fechamento de cada ano (último mês publicado) e variação sobre o ano anterior, calculada pelos valores reais da FIPE. */
export interface AnnualPoint { year: number; cents: number; pct: number | null }

/** Um valor por ano (o do último mês disponível) com a variação real sobre o ano anterior. Mais recente primeiro. */
export function annualPoints(points: PricePoint[]): AnnualPoint[] {
  const byYear = new Map<number, PricePoint>();
  for (const p of [...points].sort((a, b) => a.time - b.time)) byYear.set(Math.floor(p.time / 12), p);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const out: AnnualPoint[] = years.map((y, i) => {
    const cur = byYear.get(y)!;
    const prev = i > 0 ? byYear.get(years[i - 1]!) : undefined;
    return { year: y, cents: cur.cents, pct: prev && prev.cents > 0 ? Math.round(((cur.cents - prev.cents) / prev.cents) * 10000) / 100 : null };
  });
  return out.reverse();
}

