import { pool } from '../db.js';
import { SPEC_FIELDS, scoreModelMatch } from './vehicleSpecs.js';
import type { SheetRow, VehicleSheet } from '../enrichment/sheet.js';

/**
 * Ficha técnica do veículo a partir do guia de veículos da própria plataforma (modelos publicados, revisados pela equipe).
 * Só devolve quando o modelo (e, se possível, a versão do mesmo ano) bate; nunca monta ficha por palpite.
 * Falha de banco ou ausência de modelo: devolve undefined e a ficha sai sem esta parte.
 */
export async function catalogSpecsFor(input: { brand?: string | null; model?: string | null; fullModel?: string | null; year?: number | null }): Promise<VehicleSheet['specs'] | undefined> {
  try {
    const brand = String(input.brand ?? '').trim();
    const model = String(input.model ?? '').trim();
    const full = String(input.fullModel ?? model).trim();
    if (!brand || !(model || full)) return undefined;
    const candidates = await pool.query(`SELECT m.id,m.brand,m.name FROM vehicle_models m WHERE m.status='PUBLISHED' AND m.archived_at IS NULL AND m.brand ILIKE $1`, [`%${brand.split(/\s+/)[0]!.replace(/[%_\\]/g, '')}%`]);
    const best = candidates.rows
      .map((c) => ({ c, score: Math.max(scoreModelMatch({ brand, model }, { brand: String(c.brand), name: String(c.name) }), scoreModelMatch({ brand, model: full }, { brand: String(c.brand), name: String(c.name) })) }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score)[0];
    if (!best) return undefined;
    const versions = await pool.query('SELECT name,year_model,specs FROM vehicle_versions WHERE model_id=$1 AND active ORDER BY year_model DESC NULLS LAST, display_order, name', [best.c.id]);
    if (!versions.rowCount) return undefined;
    const year = input.year ?? null;
    const sameYear = year ? versions.rows.filter((v) => Number(v.year_model) === year) : [];
    // Mesma versão do ano quando existir; senão a mais próxima do ano, avisando que é aproximada.
    const pick = sameYear[0] ?? (year ? [...versions.rows].sort((a, b) => Math.abs(Number(a.year_model ?? 0) - year) - Math.abs(Number(b.year_model ?? 0) - year))[0] : versions.rows[0]);
    const specs = (pick?.specs ?? {}) as Record<string, unknown>;
    const rows: SheetRow[] = [];
    for (const f of SPEC_FIELDS) {
      const v = specs[f.key];
      if (v == null || v === '' || v === false) continue;
      rows.push({ label: f.label, value: f.kind === 'bool' ? 'Sim' : `${v}${f.unit ? ` ${f.unit}` : ''}` });
      if (rows.length >= 24) break;
    }
    if (!rows.length) return undefined;
    const exact = sameYear.length > 0;
    return { title: `${best.c.brand} ${best.c.name} ${pick!.name}${pick!.year_model ? ` ${pick!.year_model}` : ''}${exact ? '' : ' (modelo aproximado)'}`.replace(/\s+/g, ' ').trim(), rows };
  } catch {
    return undefined;
  }
}
