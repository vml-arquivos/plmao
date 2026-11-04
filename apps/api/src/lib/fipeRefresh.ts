import { pool } from '../db.js';
import { normalizeBdrp } from '../normalizer.js';
import { NORMALIZER_VERSION } from '../report/normalizeV2.js';
import { type Enrichment } from '../enrichment/index.js';
import { enrichWithSheet } from './sheetEnrich.js';
import { audit, log } from './http.js';
import { env } from '../config.js';
import { runExclusive } from './providerGuard.js';
import { decryptRaw, encryptRaw } from './rawStore.js';

type Rec = Record<string, unknown>;
export type FipeRefreshOutcome = 'UPDATED' | 'ALREADY' | 'NOTHING' | 'NO_RAW' | 'NOT_ELIGIBLE';
type Enricher = (raw: unknown) => Promise<Enrichment | undefined>;

/** Produtos que recebem a ficha gratuita (mesma lista do servidor). */
export const SHEET_PRODUCTS = ['BASIC', 'CADASTRAL', 'COMPLETE', 'PREMIUM'];
const hasFipe = (raw: Rec): boolean => { const e = raw.enrichment as Rec | undefined; return Boolean(e && (e.fipeHistory || e.fipeMatch)); };

/**
 * Completa uma consulta já feita com a FIPE (valor, histórico e projeção) e refaz o relatório.
 * Usa só o dado bruto guardado e a Tabela FIPE pública: não gasta chamada paga ao provedor.
 */
export async function refreshQueryFipe(queryId: string, by: string | null, enrich?: Enricher): Promise<FipeRefreshOutcome> {
  // Com o complemento padrão, a consulta também precisa da ficha gratuita; um complemento injetado (testes) segue a regra antiga.
  const withSheet = !enrich;
  const run: Enricher = enrich ?? ((raw) => enrichWithSheet(raw));
  const row = await pool.query(`SELECT q.plate,q.status,q.product_id,r.raw_enc FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1`, [queryId]);
  if (!row.rowCount) return 'NOT_ELIGIBLE';
  const q = row.rows[0] as { plate: string; status: string; product_id: string; raw_enc: string | null };
  if (q.status !== 'SUCCESS' || !SHEET_PRODUCTS.includes(q.product_id)) return 'NOT_ELIGIBLE';
  if (!q.raw_enc) return 'NO_RAW';
  const raw = decryptRaw(q.raw_enc) as Rec;
  const hasSheet = Boolean((raw.enrichment as Rec | undefined)?.sheet);
  if (hasFipe(raw) && (!withSheet || hasSheet)) return 'ALREADY';
  const enrichment = await run(raw);
  if (!enrichment) return 'NOTHING';
  // Complemento que falhou agora não apaga a ficha ou a FIPE já guardadas.
  const next = { ...raw, enrichment: { ...((raw.enrichment as Rec | undefined) ?? {}), ...enrichment } };
  const fresh = normalizeBdrp(next);
  await pool.query('UPDATE vehicle_query_results SET normalized=$2::jsonb, raw_enc=$3, normalizer_version=$4 WHERE query_id=$1', [queryId, JSON.stringify(fresh), encryptRaw(next), NORMALIZER_VERSION]);
  await audit(by, 'QUERY_FIPE_REFRESHED', 'VEHICLE_QUERY', queryId, { plate: q.plate });
  return 'UPDATED';
}

const retryAfter = new Map<string, number>();
/**
 * Ao abrir o relatório de uma consulta Completa/Premium antiga, sem FIPE guardada, busca o valor e a projeção uma vez.
 * Falha ou demora nunca impedem a abertura; nova tentativa só depois de 30 minutos.
 */
export async function ensureFipeEnrichment(queryId: string, waitMs = 9_000, enrich?: Enricher): Promise<boolean> {
  if (!env.ENRICH_FIPE_HISTORY) return false;
  if ((retryAfter.get(queryId) ?? 0) > Date.now()) return false;
  try {
    const run = runExclusive(`fipe-refresh:${queryId}`, () => refreshQueryFipe(queryId, null, enrich));
    const out = await Promise.race([run, new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), waitMs).unref())]);
    if (out === 'TIMEOUT') { retryAfter.set(queryId, Date.now() + 30 * 60_000); run.catch(() => undefined); return false; }
    if (out === 'NOTHING') retryAfter.set(queryId, Date.now() + 30 * 60_000);
    return out === 'UPDATED';
  } catch (e) {
    retryAfter.set(queryId, Date.now() + 30 * 60_000);
    log('warn', 'fipe_backfill_failed', { queryId, code: (e as { code?: string }).code ?? null });
    return false;
  }
}
