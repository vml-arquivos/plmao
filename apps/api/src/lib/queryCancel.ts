import { pool, tx } from '../db.js';
import { appError, audit } from './http.js';
import { refundProcessingQuery } from './queryRefund.js';
import { MercadoPagoProvider } from '../payments/mercadopago.js';

const err = (code: string, http = 409) => appError(code, { code, http, expose: true });

/** Cancela uma consulta do próprio cliente que ainda está em andamento. O valor volta (saldo) ou a consulta paga volta a ficar disponível. */
export async function cancelProcessingQuery(userId: string, queryId: string): Promise<{ status: string; chargeSource: string }> {
  return tx(async (client) => {
    const q = await client.query('SELECT user_id,status,charge_source FROM vehicle_queries WHERE id=$1 FOR UPDATE', [queryId]);
    if (!q.rowCount || String(q.rows[0].user_id) !== userId) throw err('QUERY_NOT_FOUND', 404);
    const row = q.rows[0] as { status: string; charge_source: string };
    if (row.status === 'REFUNDED' || row.status === 'FAILED') return { status: row.status, chargeSource: row.charge_source };
    if (row.status !== 'PROCESSING') throw err('QUERY_NOT_CANCELLABLE');
    await refundProcessingQuery(client, queryId, 'QUERY_CANCELLED', 'Cancelada pelo cliente.');
    return { status: 'REFUNDED', chargeSource: row.charge_source };
  });
}

/** Cancela todas as consultas em andamento do cliente (a tela de "Consultando…" ainda não tem o id). Devolve quantas foram canceladas. */
export async function cancelAllProcessing(userId: string): Promise<number> {
  const rows = await pool.query(`SELECT id FROM vehicle_queries WHERE user_id=$1 AND status='PROCESSING' AND created_at > now() - interval '1 day' ORDER BY created_at`, [userId]);
  let n = 0;
  for (const r of rows.rows as Array<{ id: string }>) {
    const out = await tx(async (client) => refundProcessingQuery(client, r.id, 'QUERY_CANCELLED', 'Cancelada pelo cliente.'));
    if (out) { n += 1; await audit(userId, 'QUERY_CANCELLED', 'VEHICLE_QUERY', r.id, {}); }
  }
  return n;
}

export interface RefundGateway { refundPayment(externalPaymentId: string, idempotencyKey: string): Promise<{ refundId: string | null; status: string | null }>; isConfigured(): boolean }

/**
 * Cancela uma consulta já paga (Pix/cartão) que ainda não foi usada e pede o estorno total ao Mercado Pago.
 * O direito de consulta é revogado antes do pedido de estorno (não dá para usar e estornar ao mesmo tempo);
 * se o provedor recusar, o direito volta a ficar disponível.
 */
export async function cancelPaidQuery(userId: string, orderId: string, gateway: RefundGateway = new MercadoPagoProvider()): Promise<{ status: 'REFUND_REQUESTED' | 'ALREADY_CANCELLED' | 'CANCELLED' }> {
  const found = await pool.query(`SELECT o.id,o.status AS order_status,o.amount_cents,e.id AS entitlement_id,e.status AS entitlement_status
    FROM payment_orders o LEFT JOIN query_payment_entitlements e ON e.order_id=o.id
    WHERE o.id=$1 AND o.user_id=$2 AND o.purchase_type='QUERY'`, [orderId, userId]);
  if (!found.rowCount) throw err('PAYMENT_ORDER_NOT_FOUND', 404);
  const row = found.rows[0] as { order_status: string; amount_cents: number; entitlement_id: string | null; entitlement_status: string | null };
  if (row.order_status === 'REFUNDED' || row.entitlement_status === 'REVOKED') return { status: 'ALREADY_CANCELLED' };
  if (row.order_status !== 'PAID' || !row.entitlement_id) throw err('PAYMENT_NOT_PAID');
  if (row.entitlement_status !== 'READY') throw err('QUERY_PAYMENT_ALREADY_USED');
  if (Number(row.amount_cents) === 0) {
    // Consulta grátis (cupom de 100%): não há dinheiro a devolver, só encerra o direito de uso.
    const done = await pool.query(`UPDATE query_payment_entitlements SET status='REVOKED' WHERE id=$1 AND status='READY' RETURNING id`, [row.entitlement_id]);
    if (!done.rowCount) throw err('QUERY_PAYMENT_ALREADY_USED');
    await audit(userId, 'QUERY_ENTITLEMENT_CANCELLED', 'PAYMENT_ORDER', orderId, { free: true });
    return { status: 'CANCELLED' };
  }
  const pay = await pool.query(`SELECT external_id FROM payments WHERE order_id=$1 AND provider='mercadopago' AND status='PAID' ORDER BY paid_at DESC LIMIT 1`, [orderId]);
  const externalId = pay.rows[0]?.external_id as string | undefined;
  if (!externalId) throw err('PAYMENT_NOT_REFUNDABLE');
  if (!gateway.isConfigured()) throw appError('PAYMENT_PROVIDER_NOT_CONFIGURED', { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', http: 503, expose: true });

  const refundId = await tx(async (client) => {
    const revoked = await client.query(`UPDATE query_payment_entitlements SET status='REVOKED' WHERE id=$1 AND status='READY' RETURNING id`, [row.entitlement_id]);
    if (!revoked.rowCount) throw err('QUERY_PAYMENT_ALREADY_USED');
    try {
      const ins = await client.query(`INSERT INTO payment_refunds(order_id,provider,external_payment_id,reason,requested_by) VALUES($1,'mercadopago',$2,$3,$4) RETURNING id`, [orderId, externalId, 'Cancelamento pelo cliente (consulta não utilizada)', userId]);
      return String(ins.rows[0].id);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw err('PAYMENT_REFUND_IN_PROGRESS');
      throw e;
    }
  });
  try {
    const out = await gateway.refundPayment(externalId, `refund:${refundId}`);
    await pool.query(`UPDATE payment_refunds SET status='CONFIRMED',provider_refund_id=$2,updated_at=now() WHERE id=$1`, [refundId, out.refundId]);
    await audit(userId, 'PAYMENT_REFUND_REQUESTED', 'PAYMENT_ORDER', orderId, { refundId, by: 'CUSTOMER' });
    return { status: 'REFUND_REQUESTED' };
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'PAYMENT_PROVIDER_REQUEST_FAILED';
    await tx(async (client) => {
      await client.query(`UPDATE payment_refunds SET status='FAILED',error_code=$2,updated_at=now() WHERE id=$1`, [refundId, code]);
      await client.query(`UPDATE query_payment_entitlements SET status='READY' WHERE id=$1 AND status='REVOKED'`, [row.entitlement_id]);
    });
    await audit(userId, 'PAYMENT_REFUND_FAILED', 'PAYMENT_ORDER', orderId, { refundId, code, by: 'CUSTOMER' });
    throw appError(code, { code: code === 'PAYMENT_REFUND_REJECTED' ? 'PAYMENT_REFUND_REJECTED' : 'PAYMENT_REFUND_FAILED', http: code === 'PAYMENT_REFUND_REJECTED' ? 422 : 502, expose: true });
  }
}
