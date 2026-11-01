import { pool } from '../db.js';
import { normalizeBdrp } from '../normalizer.js';
import { NORMALIZER_VERSION } from '../report/normalizeV2.js';
import { ownerIdentityEnabled } from '../report/mask.js';
import { audit, log } from './http.js';
import { decryptRaw } from './rawStore.js';

/**
 * Relatórios gravados quando ainda havia máscara são refeitos a partir do dado bruto cifrado da fonte, agora sem máscara.
 * Só mexe em relatório que tem item mascarado e bruto guardado; rodar de novo não faz nada (idempotente).
 * Relatório sem bruto guardado não tem como ser refeito e continua como está.
 */
export async function refreshMaskedReports(batch = 100): Promise<{ refreshed: number; failed: number }> {
  if (!ownerIdentityEnabled()) return { refreshed: 0, failed: 0 };
  let refreshed = 0; let failed = 0; let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await pool.query(
      `SELECT query_id, raw_enc FROM vehicle_query_results
        WHERE raw_enc IS NOT NULL AND query_id > $1
          AND jsonb_path_exists(normalized, '$.v2.sections[*].items[*] ? (@.masked == true)')
        ORDER BY query_id LIMIT $2`, [last, batch]);
    if (!rows.rowCount) break;
    for (const row of rows.rows as Array<{ query_id: string; raw_enc: string }>) {
      last = row.query_id;
      try {
        const fresh = normalizeBdrp(decryptRaw(row.raw_enc));
        await pool.query('UPDATE vehicle_query_results SET normalized=$2::jsonb, normalizer_version=$3 WHERE query_id=$1', [row.query_id, JSON.stringify(fresh), NORMALIZER_VERSION]);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        log('warn', 'report_refresh_failed', { queryId: row.query_id, error: error instanceof Error ? error.message : 'unknown' });
      }
    }
  }
  if (refreshed || failed) {
    await audit(null, 'REPORTS_UNMASKED', 'VEHICLE_QUERY_RESULT', null, { refreshed, failed });
    log('info', 'reports_unmasked', { refreshed, failed });
  }
  return { refreshed, failed };
}
