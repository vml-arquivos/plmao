import type { PoolClient } from 'pg';
import { pool, tx } from '../db.js';
import { audit, log } from './http.js';

/**
 * Estorna uma consulta que ficou em PROCESSING (falha do provedor, queda do servidor, timeout).
 * Idempotente: só age se a consulta ainda está PROCESSING (trava a linha). Saldo volta à carteira
 * (cobrança por saldo) ou o direito pago volta a READY (pagamento direto).
 */
export async function refundProcessingQuery(client: PoolClient, queryId: string, errorCode: string, detail?: string): Promise<boolean> {
  const q = await client.query('SELECT user_id,plate,status,price_cents,charge_source FROM vehicle_queries WHERE id=$1 FOR UPDATE', [queryId]);
  if (!q.rowCount || q.rows[0].status !== 'PROCESSING') return false;
  const row = q.rows[0] as { user_id: string; plate: string; price_cents: number; charge_source: string };
  if (row.charge_source === 'DIRECT_PAYMENT') {
    await client.query(`UPDATE query_payment_entitlements SET status='READY',query_id=NULL,consumed_at=NULL WHERE query_id=$1 AND status='CONSUMED'`, [queryId]);
  } else {
    const cost = Number(row.price_cents ?? 0);
    const wallet = await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [row.user_id]);
    const before = Number(wallet.rows[0]?.balance_cents ?? 0);
    const after = before + cost;
    await client.query('UPDATE wallets SET balance_cents=$2,updated_at=now() WHERE user_id=$1', [row.user_id, after]);
    await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,query_id,description,metadata)
      VALUES($1,'REFUND',0,0,0,$2,$3,$4,$5,$6,$7::jsonb)`, [row.user_id, cost, before, after, queryId, `Estorno consulta ${row.plate}`, JSON.stringify({ errorCode })]);
  }
  await client.query(`UPDATE vehicle_queries SET status='REFUNDED',error_code=$2,error_message=$3,completed_at=now(),idempotency_key=NULL WHERE id=$1`, [queryId, errorCode, (detail && detail.trim() ? detail.trim() : 'Consulta não concluída; cobrança estornada.').slice(0, 500)]);
  return true;
}

/** Varre consultas presas em PROCESSING há mais de `olderThanMinutes` e as estorna. */
export async function sweepStuckQueries(olderThanMinutes: number): Promise<number> {
  const stuck = await pool.query(`SELECT id,user_id,plate FROM vehicle_queries WHERE status='PROCESSING' AND created_at < now() - make_interval(mins => $1::int) ORDER BY created_at LIMIT 200`, [olderThanMinutes]);
  let refunded = 0;
  for (const row of stuck.rows as Array<{ id: string; user_id: string; plate: string }>) {
    const done = await tx((client) => refundProcessingQuery(client, row.id, 'QUERY_STUCK_TIMEOUT'));
    if (done) {
      refunded += 1;
      await audit(null, 'QUERY_REFUND_SWEEPER', 'VEHICLE_QUERY', row.id, { plate: row.plate });
    }
  }
  if (refunded) log('warn', 'stuck_queries_refunded', { count: refunded });
  return refunded;
}
