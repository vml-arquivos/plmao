/**
 * Campos que o sistema calcula ou completa por conta própria (não vêm do provedor de dados do veículo):
 * decodificação do chassi, quilometragem de referência pela idade e histórico/projeção da FIPE.
 * Tudo aparece rotulado como análise/estimativa; nada é apresentado como dado de órgão oficial.
 */
import { decodeChassis } from '../enrichment/chassis.js';
import { expectedKm, priceTrend, projectPrice, type PricePoint } from '../enrichment/estimates.js';
import { brlFromCents } from './format.js';
import type { VtValue } from './vehicleTotal.js';

const NONE: VtValue = { state: 'NOT_PROVIDED', value: null };
const info = (text: string | undefined): VtValue => (text ? { state: 'INFO', value: text, display: text } : NONE);
const km = (n: number) => `${Math.round(n / 1000)} mil km`;
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1).replace('.', ',')}%`;
const num = (v: unknown): number => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0; };

export function readFipeSeries(raw: unknown): PricePoint[] {
  const h = (raw as { enrichment?: { fipeHistory?: { series?: unknown } } } | null)?.enrichment?.fipeHistory?.series;
  if (!Array.isArray(h)) return [];
  return h.filter((p): p is PricePoint => Boolean(p) && typeof p.label === 'string' && Number.isFinite(p.time) && Number.isFinite(p.cents) && p.cents > 0).sort((a, b) => a.time - b.time);
}

export function enrichmentExtras(upper: Record<string, unknown>, raw: unknown, now = new Date()): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const years = [num(upper.VEIANOMODELO), num(upper.VEIANOFABR)].filter((n) => n > 1900);

  const chassis = decodeChassis(String(upper.CHASSI ?? ''), years);
  out.set('EN_CHASSI_FABRICANTE', chassis.valid ? info(chassis.manufacturer) : NONE);
  out.set('EN_CHASSI_ORIGEM', chassis.valid ? info(chassis.country) : NONE);
  if (chassis.valid && chassis.modelYear) {
    const same = years.includes(chassis.modelYear);
    out.set('EN_CHASSI_ANO', info(`${chassis.modelYear} — ${same ? 'confere com o ano do registro' : 'diferente do ano do registro (pode ocorrer conforme o critério do fabricante)'}`));
  } else out.set('EN_CHASSI_ANO', NONE);

  const modelYear = num(upper.VEIANOMODELO) || num(upper.VEIANOFABR);
  const ref = modelYear ? expectedKm(modelYear, now) : undefined;
  out.set('EN_KM_REFERENCIA', ref ? info(`${km(ref.low)} a ${km(ref.high)} (média de mercado: 12 mil km por ano, ${ref.ageYears} ${ref.ageYears === 1 ? 'ano' : 'anos'} de uso). Estimativa pela idade; não é a quilometragem real do veículo.`) : NONE);

  const series = readFipeSeries(raw);
  const trend12 = priceTrend(series, 12);
  const trend24 = priceTrend(series, 24);
  const line = (t: NonNullable<typeof trend12>, label: string) => `${pct(t.pct)} em ${t.months === 1 ? '1 mês' : `${t.months} meses`} (de ${brlFromCents(t.fromCents)} para ${brlFromCents(t.toCents)}) — ${label}`;
  out.set('EN_FIPE_VAR_12M', trend12 ? info(line(trend12, 'tabela FIPE')) : NONE);
  out.set('EN_FIPE_VAR_24M', trend24 && trend24.months > (trend12?.months ?? 0) ? info(line(trend24, 'tabela FIPE')) : NONE);
  out.set('EN_FIPE_SERIE', series.length >= 2 ? info([...series].reverse().map((p) => `${p.label} ${brlFromCents(p.cents)}`).join(' · ')) : NONE);
  const proj = projectPrice(series, 6);
  out.set('EN_FIPE_PROJECAO', proj ? info(`${brlFromCents(proj.cents)} em 6 meses (${proj.perMonthCents >= 0 ? '+' : '-'}${brlFromCents(Math.abs(proj.perMonthCents))} por mês). Projeção simples da variação dos últimos 12 meses; estimativa, não garantia de preço.`) : NONE);
  return out;
}
