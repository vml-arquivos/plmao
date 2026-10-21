import { env } from '../config.js';
import { pool } from '../db.js';
import { getFipeProvider } from '../providers/fipeProvider.js';
import type { FipeSelectionItem, FipeVehicleType } from '../types.js';
import { normalizeCatalog } from './catalog.js';

/**
 * Listas da Tabela FIPE (marcas, modelos, anos) para o seletor do site.
 * - Cache em memória por 6 horas (a tabela só muda uma vez por mês) para não gastar a cota do provedor.
 * - Se o provedor principal falhar, tenta o secundário (os códigos FIPE são os mesmos); com mês de referência explícito não há troca.
 * - Busca por texto: marca e/ou modelo digitados ("onix", "chevrolet onix 2020", "cg 160"), sempre sobre dados da própria FIPE.
 */
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 1500;
type Entry = { at: number; value: FipeSelectionItem[] };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<FipeSelectionItem[]>>();

export function clearFipeListCache(): void { store.clear(); inflight.clear(); }

async function cached(key: string, load: () => Promise<FipeSelectionItem[]>): Promise<FipeSelectionItem[]> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const p = load().then((value) => {
    if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
    store.set(key, { at: Date.now(), value });
    return value;
  }).finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

async function withFallback<T>(reference: string | undefined, run: (name: 'parallelum' | 'brasilapi') => Promise<T>): Promise<T> {
  try { return await run('parallelum'); } catch (error) {
    if (reference) throw error;
    try { return await run('brasilapi'); } catch { throw error; }
  }
}

export const fipeBrands = (vt: FipeVehicleType, reference?: string) =>
  cached(`b:${vt}:${reference ?? ''}`, () => withFallback(reference, (n) => getFipeProvider(n).brands(vt, reference)));
export const fipeModels = (vt: FipeVehicleType, brandCode: string, reference?: string) =>
  cached(`m:${vt}:${brandCode}:${reference ?? ''}`, () => withFallback(reference, (n) => getFipeProvider(n).models(vt, { code: brandCode, name: 'selected' }, reference)));
export const fipeYears = (vt: FipeVehicleType, brandCode: string, modelCode: string, reference?: string) =>
  cached(`y:${vt}:${brandCode}:${modelCode}:${reference ?? ''}`, () => withFallback(reference, (n) => getFipeProvider(n).years(vt, { code: brandCode, name: 'selected' }, { code: modelCode, name: 'selected' }, reference)));

/** Apelidos de marca que as pessoas digitam. */
const BRAND_WORDS: Record<string, string> = { vw: 'volkswagen', chev: 'chevrolet', gm: 'chevrolet', mb: 'mercedes', merc: 'mercedes' };
/** Quando a pessoa não digita a marca, procuramos nas marcas mais comuns (cada lista fica em cache). */
const POPULAR: Record<FipeVehicleType, string[]> = {
  cars: ['chevrolet', 'fiat', 'volkswagen', 'ford', 'hyundai', 'toyota', 'honda', 'renault', 'jeep', 'nissan'],
  motorcycles: ['honda', 'yamaha', 'suzuki', 'kawasaki', 'bmw', 'harley', 'triumph', 'shineray'],
  trucks: ['volvo', 'scania', 'mercedes', 'iveco', 'volkswagen', 'daf', 'ford']
};
const YEAR_RE = /^(19[5-9]\d|20[0-4]\d)$/;

export interface FipeSearchHit { brand: FipeSelectionItem; model: FipeSelectionItem }
export interface FipeSearchResult { items: FipeSearchHit[]; year: number | null; truncated: boolean }

const words = (s: string) => normalizeCatalog(s).split(' ').filter(Boolean);

export async function fipeSearch(vt: FipeVehicleType, q: string, limit = 20): Promise<FipeSearchResult> {
  const tokens = words(q).slice(0, 8);
  const yearToken = tokens.find((t) => YEAR_RE.test(t));
  const rest = tokens.filter((t) => t !== yearToken);
  const year = yearToken ? Number(yearToken) : null;
  if (!rest.length) return { items: [], year, truncated: false };

  const brands = await fipeBrands(vt);
  const brandWords = brands.map((b) => ({ b, w: new Set(words(b.name)) }));
  const used = new Set<string>();
  const matched = new Map<string, FipeSelectionItem>();
  for (const t of rest) {
    const want = BRAND_WORDS[t] ?? t;
    if (want.length < 2) continue;
    for (const { b, w } of brandWords) if (w.has(want)) { matched.set(b.code, b); used.add(t); }
  }
  let candidates = [...matched.values()];
  let modelTokens = rest.filter((t) => !used.has(t));
  if (!candidates.length) {
    const pop = POPULAR[vt];
    candidates = brandWords.filter(({ w }) => pop.some((p) => w.has(p))).map(({ b }) => b).slice(0, 12);
    modelTokens = rest;
  }
  if (!candidates.length) return { items: [], year, truncated: false };

  const lists = await Promise.all(candidates.map(async (b) => ({ b, models: await fipeModels(vt, b.code).catch(() => [] as FipeSelectionItem[]) })));
  const hits: Array<FipeSearchHit & { rank: number }> = [];
  for (const { b, models } of lists) {
    for (const m of models) {
      const n = normalizeCatalog(m.name);
      if (!modelTokens.every((t) => n.includes(t))) continue;
      const first = n.split(' ')[0] ?? '';
      hits.push({ brand: b, model: m, rank: (modelTokens[0] && first === modelTokens[0] ? 0 : 1) * 1000 + n.length });
    }
  }
  hits.sort((a, c) => a.rank - c.rank);
  return { items: hits.slice(0, limit).map(({ brand, model }) => ({ brand, model })), year, truncated: hits.length > limit };
}

/** O ano da FIPE vem como "2020 Gasolina" com código "2020-1"; "32000" é zero km. Devolve o item do ano escolhido pelo número. */
export function pickYear(years: FipeSelectionItem[], year: number | null): FipeSelectionItem | null {
  if (!year) return null;
  const hits = years.filter((y) => y.code.startsWith(`${year}-`) || y.name.startsWith(String(year)));
  return hits.length === 1 ? hits[0]! : null;
}

/** Valor FIPE de um veículo escolhido (cache do mês; principal e depois secundário). "Não existe" no principal vale como resposta final. */
export async function getFipePrice(vt: FipeVehicleType, brandCode: string, modelCode: string, yearCode: string) {
  const input = { vehicleType: vt, brand: { code: brandCode, name: 'selected' }, model: { code: modelCode, name: 'selected' }, year: { code: yearCode, name: 'selected' } };
  const prefix = `parallelum:${vt}:${brandCode}:${modelCode}:${yearCode}:%`;
  const hit = await pool.query('SELECT payload FROM fipe_cache WHERE cache_key LIKE $1 AND expires_at > now() ORDER BY updated_at DESC LIMIT 1', [prefix]);
  type Result = Awaited<ReturnType<ReturnType<typeof getFipeProvider>['quote']>>;
  if (hit.rowCount) return { result: hit.rows[0].payload as Result, cached: true };
  const result = await getFipeProvider('parallelum').quote(input).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'FIPE_NOT_FOUND') throw error;
    return getFipeProvider('brasilapi').quote(input).catch(() => { throw error; });
  });
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ttl = new Date(now.getTime() + env.FIPE_CACHE_TTL_DAYS * 86400000);
  await pool.query(`INSERT INTO fipe_cache(cache_key,provider,vehicle_type,brand_id,model_id,year_id,reference_code,reference_month,payload,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,reference_code=EXCLUDED.reference_code,reference_month=EXCLUDED.reference_month,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [result.cacheKey, result.provider, result.vehicleType, result.brand.code, result.model.code, result.year.code, result.referenceCode ?? null, result.referenceMonth, JSON.stringify(result), ttl < nextMonth ? ttl : nextMonth]);
  return { result, cached: false };
}
