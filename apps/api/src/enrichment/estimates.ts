/** Estimativas calculadas pelo sistema. Sempre apresentadas como estimativa; nunca como dado de órgão oficial. */

/** Média de mercado usada como referência: 12 mil km/ano, faixa de 8 a 16 mil. */
export const KM_PER_YEAR = { low: 8000, mid: 12000, high: 16000 } as const;

export interface KmReference { ageYears: number; low: number; mid: number; high: number }

export function expectedKm(modelYear: number, now = new Date()): KmReference | undefined {
  const year = now.getFullYear();
  if (!Number.isFinite(modelYear) || modelYear < 1950 || modelYear > year + 2) return undefined;
  const age = Math.max(0, year - modelYear);
  // O ano do modelo costuma vir antes do ano de fabricação: carro do ano corrente conta meio ano de uso.
  const effective = age === 0 ? 0.5 : age;
  const round = (n: number) => Math.round(n / 1000) * 1000;
  return { ageYears: age, low: round(effective * KM_PER_YEAR.low), mid: round(effective * KM_PER_YEAR.mid), high: round(effective * KM_PER_YEAR.high) };
}

export interface PricePoint { label: string; time: number; cents: number }
export interface Trend { fromCents: number; toCents: number; pct: number; months: number }

const sorted = (series: PricePoint[]) => [...series].sort((a, b) => a.time - b.time);

/** Variação entre o ponto de N meses atrás (ou o mais antigo disponível, se tiver ao menos metade) e o mais recente. */
export function priceTrend(series: PricePoint[], months: number): Trend | undefined {
  const s = sorted(series);
  if (s.length < 2) return undefined;
  const last = s[s.length - 1]!;
  const wanted = s[Math.max(0, s.length - 1 - months)]!;
  const span = s.indexOf(last) - s.indexOf(wanted);
  if (span < Math.ceil(months / 2) || wanted.cents <= 0) return undefined;
  return { fromCents: wanted.cents, toCents: last.cents, pct: ((last.cents - wanted.cents) / wanted.cents) * 100, months: span };
}

/** Projeção linear simples a partir da variação média dos últimos 12 meses. Não é garantia nem previsão de mercado. */
export function projectPrice(series: PricePoint[], horizonMonths = 6): { cents: number; perMonthCents: number } | undefined {
  const t = priceTrend(series, 12);
  if (!t) return undefined;
  const perMonth = (t.toCents - t.fromCents) / t.months;
  return { cents: Math.max(0, Math.round(t.toCents + perMonth * horizonMonths)), perMonthCents: Math.round(perMonth) };
}
