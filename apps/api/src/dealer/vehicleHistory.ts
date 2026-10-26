import type { PoolClient } from 'pg';
import { pool } from '../db.js';

/**
 * Dados de veículo que a equipe da loja já tem no sistema: consultas concluídas, FIPE consultada,
 * garagem de quem é da equipe e estoque anterior da própria loja. Nada aqui chama fonte externa nem cobra.
 */
type Db = Pick<PoolClient, 'query'>;
export interface VehicleFields { brand: string; model: string; version: string; yearManufacture: number | null; yearModel: number | null; color: string; fuel: string; transmission: string; mileageKm: number | null; fipeCents: number | null }
export interface VehicleSource { kind: 'CONSULTA' | 'FIPE' | 'GARAGEM' | 'ESTOQUE'; at: string | null; code?: string }
export interface VehicleSuggestion { plate: string; fields: Partial<VehicleFields>; sources: VehicleSource[] }

const EMPTY_KEYS: Array<keyof VehicleFields> = ['brand', 'model', 'version', 'yearManufacture', 'yearModel', 'color', 'fuel', 'transmission', 'mileageKm', 'fipeCents'];

/** "VW/GOL 1.0 MI" vira "VW/Gol 1.0 MI": palavras longas em maiúsculas ganham só a primeira letra maiúscula. */
const KEEP_UPPER = new Set(['VW', 'GM', 'BMW', 'BYD', 'JAC', 'MI', 'TSI', 'TDI', 'GTI', 'LTZ', 'SUV', 'CVT', 'XLS', 'XLT', 'TFSI', 'FSI', 'HDI', 'MPI', 'AMG', 'CDI', 'JTD', 'AWD', 'GLI', 'GLS', 'WRX', 'STI', 'ABS']);
/** "VW/GOL 1.0 MI" vira "VW/Gol 1.0 MI": só mexe em texto todo em maiúsculas; siglas e palavras com número ficam como estão. */
export function tidy(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text !== text.toUpperCase()) return text;
  const word = (w: string) => (w.length <= 2 || /\d/.test(w) || KEEP_UPPER.has(w) || !/^[A-ZÀ-Ú]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase());
  return text.split(' ').map((w) => w.split('/').map(word).join('/')).join(' ');
}
const year = (v: unknown): number | null => { const n = Number(String(v ?? '').match(/\d{4}/)?.[0]); return n >= 1950 && n <= 2100 ? n : null; };
const text = (v: unknown, max: number): string => tidy(v).slice(0, max);

/** Junta fontes pela ordem de confiança: o primeiro valor preenchido de cada campo vale. */
function merge(parts: Array<{ fields: Partial<VehicleFields>; source: VehicleSource }>): { fields: Partial<VehicleFields>; sources: VehicleSource[] } {
  const fields: Partial<VehicleFields> = {}; const sources: VehicleSource[] = [];
  for (const p of parts) {
    let used = false;
    for (const k of EMPTY_KEYS) {
      const v = p.fields[k];
      if (v === undefined || v === null || v === '') continue;
      if (fields[k] === undefined || fields[k] === null || fields[k] === '') { (fields as Record<string, unknown>)[k] = v; used = true; }
    }
    if (used) sources.push(p.source);
  }
  return { fields, sources };
}

function fromReport(n: Record<string, any>): Partial<VehicleFields> {
  const id = n.identification ?? {}; const ch = n.characteristics ?? {};
  const model = text(id.model, 60); const full = text(id.fullModel, 80);
  const brandFull = text(id.brand, 40);
  const version = full && full.toLowerCase() !== model.toLowerCase() ? full.replace(new RegExp(`^${brandFull.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/ ]+`, 'i'), '').replace(new RegExp(`^${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/ ]*`, 'i'), '').trim() : '';
  return { brand: brandFull.split('/')[0]!, model: model || full.split(' ')[0] || '', version: version.slice(0, 80), yearManufacture: year(ch.manufactureYear), yearModel: year(ch.modelYear), color: text(ch.color, 30), fuel: text(ch.fuel, 30) };
}
function fromFipe(q: Record<string, any>): Partial<VehicleFields> {
  const d = q.vehicleDetails ?? {};
  return { brand: text(q.brand?.name ?? d.brand, 40), model: text(d.model ?? String(q.model?.name ?? '').split(' ')[0], 60), version: '', yearModel: year(q.modelYear ?? q.year?.name ?? d.modelYear), yearManufacture: year(d.manufactureYear), color: text(d.color, 30), fuel: text(q.fuel ?? d.fuel, 30), fipeCents: Number.isFinite(Number(q.valueCents)) && Number(q.valueCents) > 0 ? Number(q.valueCents) : null };
}

const PLATE_EXPR = `upper(COALESCE(NULLIF(r.normalized->'identification'->>'plate',''), NULLIF(r.normalized->'quote'->>'plate',''), q.plate))`;

export async function suggestForPlate(dealershipId: string, plate: string, db: Db = pool): Promise<VehicleSuggestion> {
  const parts: Array<{ fields: Partial<VehicleFields>; source: VehicleSource }> = [];
  const own = await db.query(`SELECT brand,model,version,year_manufacture,year_model,color,fuel,transmission,fipe_cents,updated_at FROM stock_vehicles WHERE dealership_id=$1 AND plate=$2 ORDER BY updated_at DESC LIMIT 1`, [dealershipId, plate]);
  const reports = await db.query(`SELECT q.id,q.completed_at,r.normalized FROM vehicle_queries q JOIN dealership_members m ON m.user_id=q.user_id AND m.dealership_id=$1 AND m.active
      JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.status='SUCCESS' AND ${PLATE_EXPR}=$2 ORDER BY q.completed_at DESC NULLS LAST LIMIT 5`, [dealershipId, plate]);
  for (const r of reports.rows as Array<{ id: string; completed_at: Date | null; normalized: Record<string, any> }>) {
    const isFipe = r.normalized?.__type === 'FIPE_QUOTE';
    parts.push({ fields: isFipe ? fromFipe(r.normalized.quote ?? {}) : fromReport(r.normalized ?? {}), source: { kind: isFipe ? 'FIPE' : 'CONSULTA', at: r.completed_at ? r.completed_at.toISOString() : null, code: String(r.id).slice(0, 8).toUpperCase() } });
  }
  // consulta de relatório pesa mais que FIPE; FIPE preenche o valor
  parts.sort((a, b) => (a.source.kind === 'CONSULTA' ? 0 : 1) - (b.source.kind === 'CONSULTA' ? 0 : 1));
  const garage = await db.query(`SELECT s.model_label,s.model_year,s.km,s.created_at FROM saved_vehicles s JOIN dealership_members m ON m.user_id=s.user_id AND m.dealership_id=$1 AND m.active WHERE s.plate=$2 ORDER BY s.km_updated_at DESC NULLS LAST, s.created_at DESC LIMIT 1`, [dealershipId, plate]);
  if (garage.rowCount) {
    const g = garage.rows[0] as { model_label: string | null; model_year: number | null; km: number | null; created_at: Date };
    parts.push({ fields: { model: text(g.model_label, 60), yearModel: g.model_year ?? null, mileageKm: g.km ?? null }, source: { kind: 'GARAGEM', at: g.created_at.toISOString() } });
  }
  if (own.rowCount) {
    const o = own.rows[0] as Record<string, any>;
    parts.push({ fields: { brand: o.brand, model: o.model, version: o.version, yearManufacture: o.year_manufacture, yearModel: o.year_model, color: o.color, fuel: o.fuel, transmission: o.transmission, fipeCents: o.fipe_cents }, source: { kind: 'ESTOQUE', at: o.updated_at ? new Date(o.updated_at).toISOString() : null } });
  }
  const { fields, sources } = merge(parts);
  return { plate, fields, sources };
}

export interface Candidate { plate: string; label: string; sources: VehicleSource[]; lastAt: string | null; color: string }

/** Placas que a equipe já consultou ou guardou na garagem e que ainda não estão em estoque aberto. */
export async function importCandidates(dealershipId: string, search: string | undefined, limit = 100, db: Db = pool): Promise<Candidate[]> {
  const like = search ? `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db.query(`
    WITH team AS (SELECT user_id FROM dealership_members WHERE dealership_id=$1 AND active),
    from_q AS (
      SELECT ${PLATE_EXPR} AS plate, 'CONSULTA'::text AS kind, max(q.completed_at) AS at
      FROM vehicle_queries q JOIN team t ON t.user_id=q.user_id JOIN vehicle_query_results r ON r.query_id=q.id
      WHERE q.status='SUCCESS' GROUP BY 1, 2
    ), from_g AS (
      SELECT upper(s.plate) AS plate, 'GARAGEM'::text AS kind, max(s.created_at) AS at FROM saved_vehicles s JOIN team t ON t.user_id=s.user_id GROUP BY 1, 2
    ), all_src AS (SELECT * FROM from_q UNION ALL SELECT * FROM from_g)
    SELECT plate, max(at) AS last_at, array_agg(DISTINCT kind) AS kinds FROM all_src
    WHERE plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'
      AND NOT EXISTS (SELECT 1 FROM stock_vehicles v WHERE v.dealership_id=$1 AND v.plate=all_src.plate AND v.status IN ('AVAILABLE','RESERVED'))
      AND ($2::text IS NULL OR plate ILIKE $2)
    GROUP BY plate ORDER BY max(at) DESC NULLS LAST LIMIT $3`, [dealershipId, like, limit]);
  const out: Candidate[] = [];
  for (const r of rows.rows as Array<{ plate: string; last_at: Date | null; kinds: string[] }>) {
    const s = await suggestForPlate(dealershipId, r.plate, db);
    const f = s.fields;
    out.push({ plate: r.plate, label: [f.brand, f.model, f.version, f.yearModel].filter(Boolean).join(' ') || 'Sem detalhes', sources: s.sources, lastAt: r.last_at ? r.last_at.toISOString() : null, color: f.color ?? '' });
  }
  return out;
}
