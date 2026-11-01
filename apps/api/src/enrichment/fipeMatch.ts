import { normalizeCatalog } from '../lib/catalog.js';
import { fipeBrands, fipeModels, fipeYears, getFipePrice } from '../lib/fipeLookup.js';
import type { FipeSelectionItem, FipeVehicleType } from '../types.js';
import { pickYearId } from './fipeHistory.js';

/**
 * Localiza o veículo na Tabela FIPE pelo cadastro (marca, modelo, ano e cilindrada) quando o provedor de dados não trouxe o código FIPE.
 * Só devolve resultado quando a correspondência é única; versão ambígua = sem resultado (nunca chuta um valor).
 * O relatório marca esse valor como "localizado pelo modelo e ano".
 */
export interface FipeMatch { fipeCode: string; brand: string; model: string; year: string; valueCents: number; referenceMonth: string; vehicleType: FipeVehicleType }
export interface FipeVehicleInput { brand: string; model: string; modelYear: number; fuel?: string; displacementCc?: number; vehicleType: FipeVehicleType }
export interface FipeDeps {
  brands: (vt: FipeVehicleType) => Promise<FipeSelectionItem[]>;
  models: (vt: FipeVehicleType, brandCode: string) => Promise<FipeSelectionItem[]>;
  years: (vt: FipeVehicleType, brandCode: string, modelCode: string) => Promise<FipeSelectionItem[]>;
  price: (vt: FipeVehicleType, brandCode: string, modelCode: string, yearCode: string) => Promise<{ fipeCode: string; valueCents: number; referenceMonth: string; brandName: string; modelName: string; yearName: string }>;
}
const defaults: FipeDeps = {
  brands: (vt) => fipeBrands(vt), models: (vt, b) => fipeModels(vt, b), years: (vt, b, m) => fipeYears(vt, b, m),
  price: async (vt, b, m, y) => { const { result } = await getFipePrice(vt, b, m, y); return { fipeCode: result.fipeCode, valueCents: result.valueCents, referenceMonth: result.referenceMonth, brandName: result.brand.name, modelName: result.model.name, yearName: result.year.name }; }
};

const BRAND_ALIAS: Record<string, string> = { vw: 'volkswagen', gm: 'chevrolet', chev: 'chevrolet', mbenz: 'mercedes', mb: 'mercedes', merc: 'mercedes', 'i': 'i' };
const words = (s: string) => normalizeCatalog(s).split(' ').filter(Boolean);
const isSubsequence = (small: string, big: string) => { let i = 0; for (const c of big) if (c === small[i]) i += 1; return i === small.length; };
/** Abreviações do cadastro ("PLTINUM") valem como a palavra inteira da FIPE ("platinum"): mesma inicial e letras na ordem. */
const tokenMatches = (token: string, word: string) => word.startsWith(token) || (token.length >= 4 && token[0] === word[0] && isSubsequence(token, word));

export async function matchFipeByVehicle(v: FipeVehicleInput, deps: FipeDeps = defaults): Promise<FipeMatch | undefined> {
  const [rawBrand, ...restParts] = v.model.includes('/') ? [v.model.split('/')[0]!, v.model.split('/').slice(1).join(' ')] : [v.brand, v.model];
  const brandWord = (words(v.brand || rawBrand)[0] ?? '');
  const want = BRAND_ALIAS[brandWord] ?? brandWord;
  if (!want || !v.modelYear) return undefined;
  const brands = await deps.brands(v.vehicleType);
  const brand = brands.find((b) => words(b.name).includes(want)) ?? brands.find((b) => words(b.name).some((w) => w.startsWith(want)));
  if (!brand) return undefined;
  const tokens = words(restParts.join(' ')).filter((t) => t !== want && t.length >= 2);
  if (!tokens.length) return undefined;
  const models = await deps.models(v.vehicleType, brand.code);
  const [first, ...others] = tokens;
  let cand = models.map((m) => ({ m, w: words(m.name) })).filter(({ w }) => w.some((x) => tokenMatches(first!, x)));
  if (!cand.length) return undefined;
  // quanto mais palavras do cadastro batem com o nome da FIPE, melhor
  const score = (w: string[]) => others.filter((t) => w.some((x) => tokenMatches(t, x))).length;
  const best = Math.max(...cand.map(({ w }) => score(w)));
  cand = cand.filter(({ w }) => score(w) === best);
  if (v.displacementCc && v.displacementCc > 300) {
    const liters = (Math.round(v.displacementCc / 100) / 10).toFixed(1);
    const byEngine = cand.filter(({ w }) => w.includes(liters));
    if (byEngine.length) cand = byEngine;
  }
  if (cand.length > 6) return undefined;
  const withYear: Array<{ m: FipeSelectionItem; yearCode: string }> = [];
  for (const { m } of cand) {
    const years = await deps.years(v.vehicleType, brand.code, m.code).catch(() => [] as FipeSelectionItem[]);
    const yearCode = pickYearId(years, v.modelYear, v.fuel);
    if (yearCode) withYear.push({ m, yearCode });
  }
  if (withYear.length !== 1) return undefined;
  const hit = withYear[0]!;
  const p = await deps.price(v.vehicleType, brand.code, hit.m.code, hit.yearCode);
  if (!p.fipeCode || p.valueCents <= 0) return undefined;
  return { fipeCode: p.fipeCode, brand: p.brandName === 'selected' ? brand.name : p.brandName, model: p.modelName === 'selected' ? hit.m.name : p.modelName, year: p.yearName === 'selected' ? hit.yearCode : p.yearName, valueCents: p.valueCents, referenceMonth: p.referenceMonth, vehicleType: v.vehicleType };
}
