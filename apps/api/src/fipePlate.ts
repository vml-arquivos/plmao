import type { FipeProviderResult } from './types.js';

/**
 * FIPE grátis pela placa: UMA consulta da Credify (código 454, só a FIPE) e nada mais.
 * Este arquivo só lê a resposta dessa consulta. Não mostra chassi, Renavam, proprietário, restrições nem outro dado do cadastro.
 */
export type FipePlateError = Error & { code: string; http: number };
const fail = (code: string, http: number): FipePlateError => Object.assign(new Error(code), { code, http });

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')).trim();

/** Procura o registro da FIPE (o que tem CODIGOFIPE) em qualquer nível da resposta, sem depender do nome do bloco. */
function findRecord(node: unknown, depth = 0): Rec | undefined {
  if (!isRec(node) || depth > 6) return undefined;
  if (Object.keys(node).some((k) => k.toUpperCase() === 'CODIGOFIPE')) return node;
  for (const v of Object.values(node)) {
    const hit = Array.isArray(v) ? v.map((x) => findRecord(x, depth + 1)).find(Boolean) : findRecord(v, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}
const pick = (r: Rec, key: string): string => { const k = Object.keys(r).find((x) => x.toUpperCase() === key); return k ? text(r[k]) : ''; };

/** "32.500,00" → 3250000 centavos. */
export function fipeMoneyToCents(v: string): number {
  const clean = v.replace(/[^\d,.-]/g, '');
  const n = Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** "06/2026", "6/2026" ou "novembro de 2026" → "junho/2026" (mesmo formato da tabela FIPE). Texto desconhecido segue como veio. */
export function fipeReference(v: string): string {
  const m = /^(\d{1,2})\s*[\/-]\s*(\d{4})$/.exec(v.trim());
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${MONTHS[Number(m[1]) - 1]}/${m[2]}`;
  const t = /^([a-zçã]+)\s+de\s+(\d{4})$/i.exec(v.trim());
  if (t) return `${t[1]!.toLowerCase()}/${t[2]}`;
  return v.trim();
}

const FUEL: Record<string, string> = { F: 'Flex', G: 'Gasolina', A: 'Álcool', D: 'Diesel', E: 'Elétrico', H: 'Híbrido' };
const fuelName = (v: string): string | undefined => (v ? (FUEL[v.toUpperCase()] ?? v) : undefined);

/** Ano com 4 dígitos vindo da fonte; com 2 dígitos assume o século mais próximo (até o ano que vem = 20xx). */
function modelYear(v: string, now = new Date()): number | undefined {
  const digits = v.replace(/\D/g, '');
  if (digits.length === 4) { const y = Number(digits); return y >= 1950 && y <= now.getFullYear() + 2 ? y : undefined; }
  if (digits.length === 2) { const yy = Number(digits); return yy <= (now.getFullYear() % 100) + 1 ? 2000 + yy : 1900 + yy; }
  return undefined;
}

/** Lê a resposta da consulta 454. Lança FIPE_PLATE_NOT_FOUND (404) ou FIPE_PLATE_DATA_INVALID (422); nunca devolve dado do cadastro. */
export function parseFipeByPlate(raw: unknown, plate: string, now = new Date()): FipeProviderResult {
  const data = isRec(raw) && isRec(raw.data) ? raw.data : raw;
  const resposta = isRec(data) && isRec(data.RESPOSTA) ? data.RESPOSTA : data;
  const code = isRec(resposta) ? text(resposta.CODIGO) : '';
  if (code === '2') throw fail('FIPE_PLATE_NOT_FOUND', 404);
  const record = findRecord(resposta);
  if (!record) throw fail('FIPE_PLATE_NOT_FOUND', 404);
  const status = pick(record, 'STATUS');
  if (status && status !== '1') throw fail('FIPE_PLATE_NOT_FOUND', 404);
  const fipeCode = pick(record, 'CODIGOFIPE');
  const valueCents = fipeMoneyToCents(pick(record, 'PRECOFIPE')) || fipeMoneyToCents(pick(record, 'PRECOMEDIO'));
  const brandName = pick(record, 'FABRICANTEFIPE');
  const modelName = pick(record, 'MODELOFIPE');
  const reference = fipeReference(pick(record, 'VIGENCIA'));
  const year = modelYear(pick(record, 'ANOMODELOFIPE'), now);
  if (!fipeCode || !valueCents || !brandName || !modelName || !reference || !year) throw fail('FIPE_PLATE_DATA_INVALID', 422);
  const fuel = fuelName(pick(record, 'COMBUSTIVELFIPE'));
  return {
    provider: 'credify',
    source: 'Tabela FIPE pela placa',
    consultedAt: now.toISOString(),
    referenceMonth: reference,
    vehicleType: 'cars',
    brand: { code: '', name: brandName },
    model: { code: '', name: modelName },
    year: { code: '', name: `${year}${fuel ? ` ${fuel}` : ''}` },
    fuel,
    modelYear: year,
    fipeCode,
    valueCents,
    valueLabel: `R$ ${(valueCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    cacheKey: `credify:fipe-plate:${plate.toUpperCase()}:${reference}`
  };
}
