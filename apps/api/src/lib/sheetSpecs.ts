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
    // A versão tem que bater com o que o cadastro diz (ex.: EXL 2.0). Sem versão compatível, não mostra ficha: ficha de outra versão engana.
    const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const tokens = (t: string) => new Set(fold(t).split(/[^A-Z0-9.]+/).filter((x) => x.length > 1));
    const vehicleTokens = tokens(`${model} ${full}`);
    const modelTokens = tokens(`${best.c.brand} ${best.c.name}`);
    const GENERIC = new Set(['FLEX', 'FLEXONE', 'AUT', 'AUTOMATICO', 'MANUAL', 'MEC', 'SEDAN', 'HATCH', '4P', '5P', '2P', 'COMPLETO', 'GASOLINA', 'ALCOOL']);
    const distinct = new Set(versions.rows.map((v) => fold(String(v.name))));
    const compatible = versions.rows.filter((v) => {
      const own = [...tokens(String(v.name))].filter((x) => !modelTokens.has(x) && !GENERIC.has(x));
      return own.length > 0 ? own.every((x) => vehicleTokens.has(x)) : distinct.size === 1;
    });
    const eligible = compatible;
    if (!eligible.length) return undefined;
    const sameYear = year ? eligible.filter((v) => Number(v.year_model) === year) : [];
    const pick = sameYear[0] ?? (year ? [...eligible].sort((a, b) => Math.abs(Number(a.year_model ?? 0) - year) - Math.abs(Number(b.year_model ?? 0) - year))[0] : eligible[0]);
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
    return { title: `${best.c.brand} ${best.c.name} ${pick!.name}${pick!.year_model ? ` ${pick!.year_model}` : ''}${exact ? '' : ' (ano aproximado)'}`.replace(/\s+/g, ' ').trim(), rows };
  } catch {
    return undefined;
  }
}
