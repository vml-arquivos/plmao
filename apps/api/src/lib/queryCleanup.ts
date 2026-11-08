import type { PoolClient } from 'pg';

/**
 * Limpeza do que não gerou receita nem entrega: consultas que falharam, consultas travadas em processamento
 * e pedidos de pagamento que não foram pagos (checkout abandonado, cancelado, expirado ou com falha).
 * Nunca apaga consulta bem-sucedida, pedido pago ou estornado, nem nada que tenha lançamento financeiro ou direito de uso pendente.
 */
export type CleanupKind = 'FAILED' | 'STUCK' | 'UNPAID_ORDERS';
export const CLEANUP_KINDS: readonly CleanupKind[] = ['FAILED', 'STUCK', 'UNPAID_ORDERS'];

/** Pedidos em aberto só entram depois deste tempo, para não derrubar um checkout que o cliente ainda está pagando. */
export const OPEN_CHECKOUT_HOURS = 24;
/** Consulta em processamento só é considerada travada depois deste tempo. */
export const STUCK_HOURS = 2;

export interface CleanupCount { kind: CleanupKind; label: string; deletable: number; kept: number; keptReason: string }

const QUERY_SAFE = `
  NOT EXISTS (SELECT 1 FROM payment_orders o WHERE o.id=q.payment_order_id AND o.status IN ('PAID','REFUNDED'))
  AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.query_id=q.id)
  AND NOT EXISTS (SELECT 1 FROM query_payment_entitlements e WHERE e.query_id=q.id AND e.status IN ('READY','CONSUMED'))`;

const SQL: Record<CleanupKind, { all: string; safe: string; label: string; keptReason: string }> = {
  FAILED: {
    label: 'Consultas que falharam',
    all: `SELECT q.id FROM vehicle_queries q WHERE q.status='FAILED'`,
    safe: `SELECT q.id FROM vehicle_queries q WHERE q.status='FAILED' AND ${QUERY_SAFE}`,
    keptReason: 'têm pagamento, lançamento na carteira ou direito de uso'
  },
  STUCK: {
    label: 'Consultas travadas em processamento',
    all: `SELECT q.id FROM vehicle_queries q WHERE q.status='PROCESSING' AND q.created_at < now() - interval '${STUCK_HOURS} hours'`,
    safe: `SELECT q.id FROM vehicle_queries q WHERE q.status='PROCESSING' AND q.created_at < now() - interval '${STUCK_HOURS} hours' AND ${QUERY_SAFE}`,
    keptReason: 'têm pagamento, lançamento na carteira ou direito de uso'
  },
  UNPAID_ORDERS: {
    label: 'Pedidos sem pagamento (checkout abandonado, cancelado, expirado ou com falha)',
    all: `SELECT o.id FROM payment_orders o WHERE o.status IN ('CREATED','CHECKOUT_ACTIVE','CANCELLED','EXPIRED','FAILED')
            AND (o.status IN ('CANCELLED','EXPIRED','FAILED') OR o.created_at < now() - interval '${OPEN_CHECKOUT_HOURS} hours')`,
    safe: `SELECT o.id FROM payment_orders o WHERE o.status IN ('CREATED','CHECKOUT_ACTIVE','CANCELLED','EXPIRED','FAILED')
            AND (o.status IN ('CANCELLED','EXPIRED','FAILED') OR o.created_at < now() - interval '${OPEN_CHECKOUT_HOURS} hours')
            AND o.paid_at IS NULL AND o.refunded_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status IN ('PAID','REFUNDED'))
            AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.order_id=o.id)
            AND NOT EXISTS (SELECT 1 FROM affiliate_commissions c WHERE c.order_id=o.id)
            AND NOT EXISTS (SELECT 1 FROM purchase_contracts pc WHERE pc.order_id=o.id)
            AND NOT EXISTS (SELECT 1 FROM vehicle_queries q WHERE q.payment_order_id=o.id AND q.status='SUCCESS')
            AND NOT EXISTS (SELECT 1 FROM query_payment_entitlements e WHERE e.order_id=o.id AND e.status IN ('READY','CONSUMED'))`,
    keptReason: 'têm pagamento, estorno, comissão, contrato ou consulta entregue'
  }
};

export async function previewCleanup(client: Pick<PoolClient, 'query'>, kinds: readonly CleanupKind[]): Promise<CleanupCount[]> {
  const out: CleanupCount[] = [];
  for (const kind of kinds) {
    const d = SQL[kind];
    const r = await client.query(`SELECT (SELECT count(*) FROM (${d.safe}) s)::int AS deletable, (SELECT count(*) FROM (${d.all}) a)::int AS total`);
    const deletable = Number(r.rows[0].deletable); const total = Number(r.rows[0].total);
    out.push({ kind, label: d.label, deletable, kept: Math.max(0, total - deletable), keptReason: d.keptReason });
  }
  return out;
}

/** Apaga, na ordem certa, o que as consultas e os pedidos sem receita deixaram para trás. Roda dentro de uma transação aberta pelo chamador. */
export async function runCleanup(client: Pick<PoolClient, 'query'>, kinds: readonly CleanupKind[]): Promise<Record<CleanupKind, number>> {
  const done: Record<CleanupKind, number> = { FAILED: 0, STUCK: 0, UNPAID_ORDERS: 0 };
  const deleteQueries = async (ids: string[]): Promise<number> => {
    if (!ids.length) return 0;
    await client.query(`DELETE FROM query_payment_entitlements WHERE query_id = ANY($1::uuid[]) AND status IN ('FAILED','REVOKED')`, [ids]);
    const r = await client.query(`DELETE FROM vehicle_queries WHERE id = ANY($1::uuid[])`, [ids]);
    return r.rowCount ?? 0;
  };
  for (const kind of kinds) {
    if (kind === 'FAILED' || kind === 'STUCK') {
      const ids = (await client.query(`${SQL[kind].safe} LIMIT 5000`)).rows.map((r) => String(r.id));
      done[kind] = await deleteQueries(ids);
    }
  }
  if (kinds.includes('UNPAID_ORDERS')) {
    const ids = (await client.query(`${SQL.UNPAID_ORDERS.safe} LIMIT 5000`)).rows.map((r) => String(r.id));
    if (ids.length) {
      // Consultas ligadas ao pedido (nunca bem-sucedidas, pela regra acima) saem primeiro.
      const qs = (await client.query(`SELECT id FROM vehicle_queries WHERE payment_order_id = ANY($1::uuid[])`, [ids])).rows.map((r) => String(r.id));
      await deleteQueries(qs);
      await client.query(`DELETE FROM query_payment_entitlements WHERE order_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM payment_webhook_events WHERE order_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM coupon_redemptions WHERE payment_order_id = ANY($1::uuid[])`, [ids]);
      const r = await client.query(`DELETE FROM payment_orders WHERE id = ANY($1::uuid[])`, [ids]);
      done.UNPAID_ORDERS = r.rowCount ?? 0;
    }
  }
  return done;
}
