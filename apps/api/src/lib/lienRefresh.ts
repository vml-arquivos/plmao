import { pool } from '../db.js';
import { normalizeBdrp } from '../normalizer.js';
import { NORMALIZER_VERSION } from '../report/normalizeV2.js';
import { audit, log } from './http.js';
import { decryptRaw, encryptRaw } from './rawStore.js';

/** Provedor capaz de buscar uma base complementar avulsa (hoje, a Credify). */
export interface SupplementSource { fetchSupplement(plate: string, kind: 'gravame' | 'renajud' | 'leilao'): Promise<Record<string, unknown>> }
export const canFetchSupplement = (p: unknown): p is SupplementSource => Boolean(p) && typeof (p as SupplementSource).fetchSupplement === 'function';

export type RefreshOutcome = 'UPDATED' | 'ALREADY' | 'NO_RAW' | 'NOT_ELIGIBLE';
type Rec = Record<string, unknown>;
const hasLienAnswer = (raw: Rec): boolean => { const g = raw.gravame; return Boolean(g) && typeof g === 'object' && !(g as Rec).unavailable; };

/**
 * Completa uma consulta já feita com a base de gravames (/gravame: banco, CNPJ, contrato, datas, UF e histórico) e refaz o relatório.
 * Usa o dado bruto cifrado guardado na consulta e gasta uma chamada paga. Não repete se a consulta já tem a resposta do /gravame.
 * Se a fonte falhar, lança o erro e nada é alterado.
 */
export async function refreshQueryGravame(queryId: string, source: SupplementSource, by: string | null): Promise<RefreshOutcome> {
  const row = await pool.query(`SELECT q.plate,q.status,r.raw_enc FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1`, [queryId]);
  if (!row.rowCount) return 'NOT_ELIGIBLE';
  const q = row.rows[0] as { plate: string; status: string; raw_enc: string | null };
  if (q.status !== 'SUCCESS') return 'NOT_ELIGIBLE';
  if (!q.raw_enc) return 'NO_RAW';
  const raw = decryptRaw(q.raw_enc) as Rec;
  if (hasLienAnswer(raw)) return 'ALREADY';
  const value = await source.fetchSupplement(q.plate, 'gravame');
  const next = { ...raw, gravame: value };
  const fresh = normalizeBdrp(next);
  await pool.query('UPDATE vehicle_query_results SET normalized=$2::jsonb, raw_enc=$3, normalizer_version=$4 WHERE query_id=$1', [queryId, JSON.stringify(fresh), encryptRaw(next), NORMALIZER_VERSION]);
  await audit(by, 'QUERY_GRAVAME_REFRESHED', 'VEHICLE_QUERY', queryId, { plate: q.plate });
  return 'UPDATED';
}

/** Consultas com gravame mas sem a resposta do /gravame guardada: as que ainda não têm banco, contrato e datas completos. */
export async function queriesMissingLien(max = 500): Promise<string[]> {
  const rows = await pool.query(`SELECT r.query_id, r.raw_enc FROM vehicle_query_results r JOIN vehicle_queries q ON q.id=r.query_id
      WHERE q.status='SUCCESS' AND r.raw_enc IS NOT NULL AND r.normalized ? 'v2'
        AND (q.product_id IN ('LIEN') OR jsonb_path_exists(r.normalized, '$.v2.sections[*].items[*] ? (@.key=="RESTRICAOFINAN" && @.state=="ALERT")'))
      ORDER BY q.created_at DESC LIMIT $1`, [max]);
  const out: string[] = [];
  for (const r of rows.rows as Array<{ query_id: string; raw_enc: string }>) {
    try { if (!hasLienAnswer(decryptRaw(r.raw_enc) as Rec)) out.push(r.query_id); } catch (e) { log('warn', 'lien_missing_scan_failed', { queryId: r.query_id, error: e instanceof Error ? e.message : 'unknown' }); }
  }
  return out;
}
