import { pool } from '../db.js';
import { normalizeBdrp } from '../normalizer.js';
import { NORMALIZER_VERSION } from '../report/normalizeV2.js';
import { audit, log } from './http.js';
import { env } from '../config.js';
import { runExclusive } from './providerGuard.js';
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

const retryAfter = new Map<string, number>();
/**
 * Ao abrir o relatório de uma consulta antiga (Completa, Premium ou Gravame) que acusa gravame mas não tem banco, contrato e datas,
 * busca o /gravame uma única vez e refaz o relatório. Falha da fonte nunca impede a abertura: o relatório sai como estava e uma
 * nova tentativa só acontece depois de 30 minutos. Desligue com CREDIFY_GRAVAME_BACKFILL=false.
 */
export async function ensureLienDetail(queryId: string, source: unknown, waitMs = 26_000): Promise<boolean> {
  if (!env.CREDIFY_GRAVAME_BACKFILL || !canFetchSupplement(source)) return false;
  if ((retryAfter.get(queryId) ?? 0) > Date.now()) return false;
  try {
    const eligible = await pool.query(`SELECT 1 FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id
      WHERE q.id=$1 AND q.status='SUCCESS' AND q.product_id IN ('COMPLETE','PREMIUM','LIEN') AND r.raw_enc IS NOT NULL AND r.normalized ? 'v2'
        AND jsonb_path_exists(r.normalized, '$.v2.sections[*].items[*] ? (@.key=="RESTRICAOFINAN" && @.state=="ALERT")')`, [queryId]);
    if (!eligible.rowCount) return false;
    const run = runExclusive(`lien-refresh:${queryId}`, () => refreshQueryGravame(queryId, source, null));
    const out = await Promise.race([run, new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), waitMs))]);
    if (out === 'TIMEOUT') { retryAfter.set(queryId, Date.now() + 30 * 60_000); run.catch(() => undefined); return false; }
    return out === 'UPDATED';
  } catch (e) {
    retryAfter.set(queryId, Date.now() + 30 * 60_000);
    log('warn', 'lien_backfill_failed', { queryId, code: (e as { code?: string }).code ?? null });
    return false;
  }
}
