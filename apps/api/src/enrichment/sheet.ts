import { decodeChassis } from './chassis.js';
import type { FipeHistory } from './fipeHistory.js';
import { annualPoints } from './annual.js';

/**
 * Ficha do veículo gratuita: decodificador de chassi, tabela FIPE (por ano e dos últimos 24 meses), simulação de financiamento
 * e ficha técnica do nosso guia. Tudo vem de dados públicos ou do próprio sistema e aparece igual na consulta gratuita e nas pagas.
 * Nada aqui é inventado: o que não tem fonte fica de fora.
 */
export interface SheetRow { label: string; value: string }
export interface SheetFipe {
  code: string;
  model?: string;
  currentCents: number;
  referenceLabel?: string;
  /** mais recente primeiro; pct = variação real sobre o ano anterior */
  annual: Array<{ year: number; cents: number; pct: number | null }>;
  /** mais recente primeiro; pctMonth = sobre o mês anterior, pctPeriod = sobre o primeiro mês da tabela */
  monthly: Array<{ label: string; cents: number; pctMonth: number | null; pctPeriod: number | null }>;
}
export interface SheetFinancing { vehicleCents: number; downPaymentCents: number; months: number; installmentCents: number }
export interface VehicleSheet {
  decoder: SheetRow[];
  fipe?: SheetFipe;
  financing?: SheetFinancing;
  specs?: { title: string; rows: SheetRow[] };
}

export interface SheetInput {
  chassis?: string | null;
  engine?: string | null;
  gearbox?: string | null;
  brand?: string | null;
  fullModel?: string | null;
  fuel?: string | null;
  modelYear?: number | string | null;
  manufactureYear?: number | string | null;
  fipeCode?: string | null;
  fipeModel?: string | null;
  fipeCurrentCents?: number | null;
  history?: FipeHistory | null;
  financing?: SheetFinancing | null;
  specs?: VehicleSheet['specs'] | null;
}

const num = (v: unknown): number => { const n = Number(String(v ?? '').replace(/\D/g, '')); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;
const pctChange = (from: number, to: number): number | null => (from > 0 ? round2(((to - from) / from) * 100) : null);

/** Motor, portas e câmbio lidos do nome do modelo (ex.: "C 180 CGI 1.8 16V Turbo Gas. 4P"). Só o que o nome diz. */
export function parseModelName(text: string): { engine?: string; doors?: string; gearbox?: string } {
  const t = ` ${text} `;
  const out: { engine?: string; doors?: string; gearbox?: string } = {};
  const eng = t.match(/\b(\d\.\d)\b\s*((?:\d{1,2}V)?)\s*((?:Turbo|TSI|TFSI|Bi-?Turbo)?)/i);
  if (eng) out.engine = [eng[1], eng[2]?.toUpperCase(), eng[3] ? eng[3][0]!.toUpperCase() + eng[3].slice(1).toLowerCase() : ''].filter(Boolean).join(' ');
  const doors = t.match(/\b([2-5])\s?[Pp]\b/);
  if (doors) out.doors = doors[1];
  if (/\b(aut\.?|autom[aá]tic[oa]|at|cvt|dsg|tiptronic|dct)\b/i.test(t)) out.gearbox = 'Automático';
  else if (/\b(mec\.?|mec[aâ]nic[oa]|manual|mt)\b/i.test(t)) out.gearbox = 'Manual';
  return out;
}

export function buildFipeTables(history: FipeHistory | null | undefined, fallbackCurrentCents?: number | null): Pick<SheetFipe, 'annual' | 'monthly' | 'currentCents' | 'referenceLabel'> | undefined {
  const series = history?.series ?? [];
  if (series.length < 2) return undefined;
  const sorted = [...series].sort((a, b) => a.time - b.time);
  const first = sorted[0]!;
  const monthly = sorted.map((p, i) => ({ label: p.label, cents: p.cents, pctMonth: i > 0 ? pctChange(sorted[i - 1]!.cents, p.cents) : null, pctPeriod: i > 0 ? pctChange(first.cents, p.cents) : null })).reverse();
  const annual = (history?.annual?.length ? history.annual : annualPoints(sorted));
  const last = sorted[sorted.length - 1]!;
  return { annual, monthly, currentCents: fallbackCurrentCents && fallbackCurrentCents > 0 ? fallbackCurrentCents : last.cents, referenceLabel: last.label };
}

export function buildVehicleSheet(input: SheetInput): VehicleSheet {
  const hints = [num(input.modelYear), num(input.manufactureYear)].filter((n) => n > 1900);
  const vin = decodeChassis(String(input.chassis ?? ''), hints);
  const parsed = parseModelName(`${input.fipeModel ?? ''} ${input.fullModel ?? ''}`);
  const rows: SheetRow[] = [];
  const add = (label: string, value: string | undefined | null) => { const v = String(value ?? '').trim(); if (v) rows.push({ label, value: v }); };
  add('Fabricante', vin.manufacturer ?? (input.brand ? String(input.brand) : undefined));
  add('Modelo', input.fipeModel || input.fullModel || undefined);
  if (vin.valid) {
    add('Chave do chassi', vin.key);
    if (vin.modelYear) add('Ano pelo chassi', `${vin.modelYear}${hints.includes(vin.modelYear) ? '' : ' (difere do ano do registro; pode ocorrer conforme o critério do fabricante)'}`);
    add('Região', vin.region);
    add('País de fabricação', vin.country);
    add('Formato do chassi', 'Padrão de 17 caracteres válido');
  } else if (String(input.chassis ?? '').trim()) add('Formato do chassi', 'Fora do padrão de 17 caracteres (comum em veículos antigos)');
  add('Motor', parsed.engine);
  add('Portas', parsed.doors);
  add('Câmbio', input.gearbox && !/N[ÃA]O INFORMADO/i.test(String(input.gearbox)) ? String(input.gearbox) : parsed.gearbox);
  add('Combustível', input.fuel ?? undefined);
  const sheet: VehicleSheet = { decoder: rows };
  const tables = buildFipeTables(input.history, input.fipeCurrentCents);
  const code = String(input.fipeCode ?? input.history?.fipeCode ?? '').trim();
  if (tables && code) sheet.fipe = { code, ...(input.fipeModel ? { model: input.fipeModel } : {}), ...tables };
  else if (code && input.fipeCurrentCents && input.fipeCurrentCents > 0) sheet.fipe = { code, ...(input.fipeModel ? { model: input.fipeModel } : {}), currentCents: input.fipeCurrentCents, annual: [], monthly: [] };
  if (input.financing && input.financing.installmentCents > 0) sheet.financing = input.financing;
  if (input.specs?.rows.length) sheet.specs = input.specs;
  return sheet;
}

/** Remove o que não é dado de ficha (defesa contra snapshot antigo/corrompido) antes de mostrar. */
export function readSheet(value: unknown): VehicleSheet | undefined {
  const s = value as VehicleSheet | null | undefined;
  if (!s || typeof s !== 'object' || !Array.isArray(s.decoder)) return undefined;
  return s;
}
