import { env } from '../config.js';
import type { PricePoint } from './estimates.js';

/**
 * Histórico de preços da FIPE por código FIPE e ano (fipe.parallelum.com.br/api/v2):
 *   GET /{tipo}/{codigoFipe}/years                    -> [{ code: "2011-1", name: "2011 Gasolina" }]
 *   GET /{tipo}/{codigoFipe}/years/{anoId}/history    -> { priceHistory: [{ month, price }] }
 * Os valores mensais da FIPE não mudam depois de publicados, então o resultado fica em cache por 24 h.
 * Qualquer falha devolve undefined: o relatório sai sem a seção, sem derrubar a consulta.
 */
export type FipeType = 'cars' | 'motorcycles' | 'trucks';
export interface FipeHistory { fipeCode: string; yearId: string; series: PricePoint[] }

const MONTHS: Record<string, number> = { janeiro: 1, jan: 1, january: 1, fevereiro: 2, fev: 2, february: 2, feb: 2, marco: 3, mar: 3, march: 3, abril: 4, abr: 4, april: 4, apr: 4, maio: 5, mai: 5, may: 5, junho: 6, jun: 6, june: 6, julho: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8, aug: 8, setembro: 9, set: 9, september: 9, sep: 9, outubro: 10, out: 10, october: 10, oct: 10, novembro: 11, nov: 11, november: 11, dezembro: 12, dez: 12, december: 12, dec: 12 };
const PT_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Aceita "2026-08", "08/2026", "agosto de 2026", "August 2026", "ago/2026". Devolve ano*12+mês ou undefined. */
export function parseMonth(value: unknown): { time: number; label: string } | undefined {
  const s = fold(String(value ?? '')).trim();
  let year: number | undefined; let month: number | undefined;
  let m = s.match(/^(\d{4})[-/](\d{1,2})/); if (m) { year = Number(m[1]); month = Number(m[2]); }
  if (!m) { m = s.match(/^(\d{1,2})[-/](\d{4})/); if (m) { month = Number(m[1]); year = Number(m[2]); } }
  if (!m) { m = s.match(/([a-z]+)\D{0,6}(\d{4})/); if (m && MONTHS[m[1]!]) { month = MONTHS[m[1]!]; year = Number(m[2]); } }
  if (!year || !month || month < 1 || month > 12) return undefined;
  return { time: year * 12 + (month - 1), label: `${PT_SHORT[month - 1]}/${year}` };
}

export function parsePriceCents(value: unknown): number {
  const s = String(value ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const cache = new Map<string, { at: number; value: FipeHistory | null }>();
const TTL_MS = 24 * 3600 * 1000;
export function resetFipeHistoryCache(): void { cache.clear(); }

type Fetch = typeof fetch;
async function getJson(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<any> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.FIPE_PRIMARY_TOKEN) headers['X-Subscription-Token'] = env.FIPE_PRIMARY_TOKEN;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`FIPE_HTTP_${response.status}`);
  return response.json();
}

/** Escolhe o ano-combustível da FIPE: o do ano do modelo; com mais de um (gasolina/álcool/diesel), prefere o do combustível informado. */
export function pickYearId(years: Array<{ code?: string; name?: string }>, modelYear: number, fuel = ''): string | undefined {
  const matches = years.filter((y) => String(y.code ?? '').startsWith(`${modelYear}-`));
  if (!matches.length) return undefined;
  if (matches.length === 1) return matches[0]!.code;
  const f = fold(fuel);
  const want = /diesel/.test(f) ? 'diesel' : /gasol|flex|alco/.test(f) ? 'gasolina' : /eletr/.test(f) ? 'eletric' : '';
  return (matches.find((y) => want && fold(String(y.name ?? '')).includes(want)) ?? matches[0])!.code;
}

export async function fetchFipeHistory(input: { fipeCode: string; modelYear: number; fuel?: string; type?: FipeType; fetchImpl?: Fetch; timeoutMs?: number; now?: () => number }): Promise<FipeHistory | undefined> {
  const code = input.fipeCode.trim();
  if (!/^\d{5,7}-\d$/.test(code) || !Number.isInteger(input.modelYear)) return undefined;
  const type = input.type ?? 'cars';
  const key = `${type}:${code}:${input.modelYear}:${input.fuel ?? ''}`;
  const now = (input.now ?? Date.now)();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value ?? undefined;
  const base = (env.FIPE_PRIMARY_BASE_URL ?? 'https://fipe.parallelum.com.br/api/v2').replace(/\/$/, '');
  const f = input.fetchImpl ?? fetch;
  const timeout = input.timeoutMs ?? 6000;
  try {
    const years = await getJson(f, `${base}/${type}/${encodeURIComponent(code)}/years`, timeout);
    const yearId = pickYearId(Array.isArray(years) ? years : [], input.modelYear, input.fuel);
    if (!yearId) { cache.set(key, { at: now, value: null }); return undefined; }
    const body = await getJson(f, `${base}/${type}/${encodeURIComponent(code)}/years/${encodeURIComponent(yearId)}/history`, timeout);
    const raw: any[] = Array.isArray(body?.priceHistory) ? body.priceHistory : [];
    const series: PricePoint[] = [];
    for (const p of raw) {
      const month = parseMonth(p?.month ?? p?.referenceMonth);
      const cents = parsePriceCents(p?.price);
      if (month && cents > 0) series.push({ label: month.label, time: month.time, cents });
    }
    const value = series.length >= 2 ? { fipeCode: code, yearId, series: series.sort((a, b) => a.time - b.time).slice(-24) } : null;
    cache.set(key, { at: now, value });
    return value ?? undefined;
  } catch {
    return undefined; // sem cache em erro: tenta de novo na próxima consulta
  }
}
