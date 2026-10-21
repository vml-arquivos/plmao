import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';

/**
 * Catálogo de frota (Senatran): nome de veículo como o órgão publicou + quantidade por ano de FABRICAÇÃO.
 * Regras de honestidade: o nome não é "limpo" por heurística (o próprio arquivo avisa que não há marca/modelo/versão separados),
 * o ano é de fabricação (não ano-modelo) e a coluna de tipo de veículo não existe, então nada é inferido.
 */
export type Db = Pick<PoolClient, 'query'>;

/** Texto de busca: minúsculo, sem acento, "/" e "-" viram espaço, "1,0" vira "1.0". */
export function normalizeCatalog(input: string): string {
  return String(input ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[/\-_]+/g, ' ')
    .replace(/[^a-z0-9. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CatalogRow { name: string; years: Array<[number, number]> }
export interface CatalogSnapshot { snapshot: string; total: number; rows: CatalogRow[] }

export const SNAPSHOT_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const SENATRAN_SOURCE_NAME = 'Senatran, frota de veículos por marca/modelo e ano de fabricação';
export const SENATRAN_LICENSE = 'Outra (Domínio Público), válida para este agregado; não se aplica a consultas individuais nem à FIPE';

const BUNDLED = new URL('../../assets/senatran/frota-2026-09.json.gz', import.meta.url);

export function readBundledSnapshot(): CatalogSnapshot {
  const raw = JSON.parse(gunzipSync(readFileSync(BUNDLED)).toString('utf8')) as { snapshot: string; total: number; rows: Array<[string, Array<[number, number]>]> };
  return { snapshot: raw.snapshot, total: raw.total, rows: raw.rows.map(([name, years]) => ({ name, years })) };
}

/** Lê o CSV público do Senatran (marca_modelo;ano_fabricacao;quantidade). Qualquer linha inconsistente vira erro, nunca é "corrigida". */
export function parseSenatranCsv(csvRows: string[][]): { snapshot: Omit<CatalogSnapshot, 'snapshot'>; errors: Array<{ line: number; message: string }> } {
  const errors: Array<{ line: number; message: string }> = [];
  const header = csvRows[0] ?? [];
  if (header.length < 3 || !/^marca_modelo/i.test(header[0]?.trim() ?? '') || !/^ano/i.test(header[1]?.trim() ?? '') || !/^quantidade/i.test(header[2]?.trim() ?? '')) {
    return { snapshot: { total: 0, rows: [] }, errors: [{ line: 1, message: 'Cabeçalho esperado: marca_modelo_original;ano_fabricacao_original;quantidade_veiculos_frota_…' }] };
  }
  const byName = new Map<string, Map<number, number>>();
  let total = 0;
  for (let i = 1; i < csvRows.length; i++) {
    const [nameRaw, yearRaw, qtyRaw] = csvRows[i]!;
    const name = (nameRaw ?? '').trim();
    const qty = Number((qtyRaw ?? '').trim());
    if (!name || name.length > 120 || !Number.isInteger(qty) || qty < 0) { if (errors.length < 50) errors.push({ line: i + 1, message: 'Linha inválida: nome ou quantidade fora do padrão.' }); continue; }
    const y = /^\d{4}$/.test((yearRaw ?? '').trim()) && Number(yearRaw) >= 1900 && Number(yearRaw) <= 2100 ? Number(yearRaw) : 0;
    const m = byName.get(name) ?? new Map<number, number>();
    m.set(y, (m.get(y) ?? 0) + qty);
    byName.set(name, m);
    total += qty;
  }
  const rows: CatalogRow[] = [...byName.entries()].map(([name, m]) => ({ name, years: [...m.entries()].sort((a, b) => a[0] - b[0]) }));
  return { snapshot: { total, rows }, errors };
}

/** Grava (insere ou atualiza) em lotes. Retorna quantos nomes eram novos e quantos já existiam. */
export async function upsertCatalog(db: Db, snap: CatalogSnapshot, opts: { batch?: number } = {}): Promise<{ created: number; updated: number }> {
  const size = opts.batch ?? 2000;
  let created = 0; let updated = 0;
  for (let i = 0; i < snap.rows.length; i += size) {
    const slice = snap.rows.slice(i, i + size);
    const names: string[] = []; const search: string[] = []; const totals: number[] = [];
    const ymin: Array<number | null> = []; const ymax: Array<number | null> = []; const years: string[] = [];
    for (const r of slice) {
      names.push(r.name); search.push(normalizeCatalog(r.name));
      totals.push(r.years.reduce((s, [, q]) => s + q, 0));
      const numeric = r.years.filter(([y]) => y > 0).map(([y]) => y);
      ymin.push(numeric.length ? Math.min(...numeric) : null); ymax.push(numeric.length ? Math.max(...numeric) : null);
      years.push(JSON.stringify(Object.fromEntries(r.years.map(([y, q]) => [String(y), q]))));
    }
    const res = await db.query(
      `INSERT INTO vehicle_catalog(raw_name,search_text,fleet_total,year_min,year_max,years,snapshot)
       SELECT u.n,u.s,u.t,u.a,u.b,u.y::jsonb,$7 FROM unnest($1::text[],$2::text[],$3::bigint[],$4::int[],$5::int[],$6::text[]) AS u(n,s,t,a,b,y)
       ON CONFLICT (raw_name) DO UPDATE SET search_text=EXCLUDED.search_text,fleet_total=EXCLUDED.fleet_total,year_min=EXCLUDED.year_min,
         year_max=EXCLUDED.year_max,years=EXCLUDED.years,snapshot=EXCLUDED.snapshot,updated_at=now()
       RETURNING (xmax = 0) AS inserted`,
      [names, search, totals, ymin, ymax, years, snap.snapshot]);
    for (const row of res.rows) { if (row.inserted) created++; else updated++; }
  }
  await db.query(
    `INSERT INTO vehicle_catalog_snapshots(snapshot,names,fleet_total,source_name,license) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (snapshot) DO UPDATE SET names=EXCLUDED.names,fleet_total=EXCLUDED.fleet_total,loaded_at=now()`,
    [snap.snapshot, snap.rows.length, snap.total, SENATRAN_SOURCE_NAME, SENATRAN_LICENSE]);
  return { created, updated };
}

/** Marcas que o Senatran escreve de mais de um jeito (abreviações do próprio cadastro). */
const BRAND_ALIASES: Record<string, string[]> = {
  chevrolet: ['chev', 'gm'],
  volkswagen: ['vw'],
  'mercedes benz': ['m benz', 'mbenz', 'mercedes'],
  'land rover': ['l rover', 'landrover']
};
const IMPORT_PREFIXES = '(?:i|imp|r|sr) ';
const esc = (s: string) => s.replace(/[^a-z0-9 ]/g, '');

interface MatchModel { id: string; brand: string; name: string; catalog_brands: string[] | null; catalog_names: string[] | null; catalog_exclude: string[] | null }

export function catalogTokens(m: MatchModel): { brands: string[]; names: string[]; exclude: string[] } {
  const brand = normalizeCatalog(m.brand);
  const brands = new Set<string>([brand, ...(BRAND_ALIASES[brand] ?? []), ...(m.catalog_brands ?? []).map(normalizeCatalog)]);
  const base = normalizeCatalog(m.name);
  const names = new Set<string>([...(m.catalog_names ?? []).map(normalizeCatalog).filter(Boolean)]);
  if (!names.size) { names.add(base); if (base.includes(' ')) names.add(base.replace(/ /g, '')); }
  return { brands: [...brands].filter(Boolean).map(esc), names: [...names].filter(Boolean).map(esc), exclude: (m.catalog_exclude ?? []).map(normalizeCatalog).filter(Boolean).map(esc) };
}

/**
 * Liga cada nome do catálogo a, no máximo, um modelo do guia. Vale o nome mais específico primeiro
 * (ex.: "onix plus" antes de "onix"). Padrão: [prefixo de importado] marca nome (fim ou espaço).
 */
export async function rematchCatalog(db: Db): Promise<{ matched: number; models: number }> {
  const models = (await db.query(`SELECT id,brand,name,catalog_brands,catalog_names,catalog_exclude FROM vehicle_models WHERE archived_at IS NULL`)).rows as MatchModel[];
  await db.query(`UPDATE vehicle_catalog SET model_id=NULL WHERE model_id IS NOT NULL`);
  const ordered = models.map((m) => ({ m, t: catalogTokens(m) })).filter((x) => x.t.brands.length && x.t.names.length)
    .sort((a, b) => Math.max(...b.t.names.map((n) => n.length)) - Math.max(...a.t.names.map((n) => n.length)));
  let matched = 0;
  for (const { m, t } of ordered) {
    const head = `^(?:${IMPORT_PREFIXES})?(?:${t.brands.join('|')}) (?:${t.names.join('|')})`;
    const params: unknown[] = [m.id, `${head}(?: |$)`];
    let sql = `UPDATE vehicle_catalog SET model_id=$1 WHERE model_id IS NULL AND search_text ~ $2`;
    if (t.exclude.length) { params.push(`${head} (?:${t.exclude.join('|')})(?: |$)`); sql += ` AND NOT (search_text ~ $3)`; }
    const r = await db.query(sql, params);
    matched += r.rowCount ?? 0;
  }
  return { matched, models: ordered.length };
}

/** Termos da busca: até 6 palavras, cada uma precisa aparecer no texto normalizado. */
export function searchTerms(q: string): string[] {
  return normalizeCatalog(q).split(' ').filter(Boolean).slice(0, 6);
}
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
