import { pool } from '../db.js';
import { audit, log } from './http.js';

/**
 * Apaga o dado bruto cifrado do fornecedor depois do prazo (RAW_RETENTION_DAYS). O relatório normalizado
 * que o cliente vê fica intacto. Prazo 0 = não apaga nada. Lotes pequenos para não travar o banco.
 */
export async function purgeExpiredRaw(days: number, batch = 500): Promise<number> {
  if (!Number.isInteger(days) || days <= 0) return 0;
  const r = await pool.query(`UPDATE vehicle_query_results SET raw_enc=NULL
    WHERE query_id IN (SELECT query_id FROM vehicle_query_results WHERE raw_enc IS NOT NULL AND created_at < now() - make_interval(days => $1::int) ORDER BY created_at LIMIT $2)`, [days, batch]);
  const n = r.rowCount ?? 0;
  if (n > 0) { await audit(null, 'RAW_RETENTION_PURGE', 'VEHICLE_QUERY_RESULT', null, { rows: n, days }); log('info', 'raw_retention_purged', { rows: n, days }); }
  return n;
}
