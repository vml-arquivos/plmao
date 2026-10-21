import { Router } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool, tx } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { MercadoPagoProvider } from '../payments/mercadopago.js';
import { settlePaymentEvent } from '../payments/settle.js';
import { requirePermission } from '../permissions.js';

/** Operações de pagamento no Mercado Pago: conciliação por referência e estorno total pela API. */
export const adminPaymentOpsRouter = Router();
adminPaymentOpsRouter.use(adminAuth);
const guard = requirePermission('MANAGE_BILLING');
const idParam = z.string().uuid();

async function orderOf(rawId: unknown) {
  const id = idParam.safeParse(rawId);
  if (!id.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const r = await pool.query('SELECT id,status,external_reference,amount_cents FROM payment_orders WHERE id=$1', [id.data]);
  if (!r.rowCount) throw appError('PAYMENT_ORDER_NOT_FOUND', { code: 'PAYMENT_ORDER_NOT_FOUND', http: 404, expose: true });
  return r.rows[0] as { id: string; status: string; external_reference: string; amount_cents: number };
}
function provider() {
  const p = new MercadoPagoProvider();
  if (!p.isConfigured()) throw appError('PAYMENT_PROVIDER_NOT_CONFIGURED', { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', http: 503, expose: true });
  return p;
}

/** Busca no Mercado Pago os pagamentos do pedido e aplica cada situação com o mesmo identificador do webhook (idempotente). */
adminPaymentOpsRouter.post('/payment-orders/:id/reconcile', guard, asyncRoute(async (req, res) => {
  const order = await orderOf(req.params.id);
  const mp = provider();
  let found;
  try { found = await mp.searchPaymentsByReference(order.external_reference); } catch { throw appError('PAYMENT_PROVIDER_REQUEST_FAILED', { code: 'PAYMENT_PROVIDER_REQUEST_FAILED', http: 502, expose: true }); }
  const outcomes: Array<{ paymentId: string; status: string; outcome: string }> = [];
  for (const p of found) {
    const settled = await tx((client) => settlePaymentEvent(client, {
      provider: 'mercadopago', eventId: `payment:${p.id}:${p.status}`, eventType: `payment.${p.status}`, rawStatus: p.status,
      externalPaymentId: p.id, reference: order.external_reference, paymentType: p.paymentType ?? null, feeCents: p.feeCents ?? null, netCents: p.netCents ?? null
    }));
    outcomes.push({ paymentId: p.id, status: p.status, outcome: settled.outcome });
  }
  await audit(req.user!.id, 'PAYMENT_RECONCILED', 'PAYMENT_ORDER', order.id, { payments: outcomes.length, requestId: requestId(req) });
  const after = await pool.query('SELECT status FROM payment_orders WHERE id=$1', [order.id]);
  res.json({ orderStatus: after.rows[0].status, payments: outcomes });
}));

const refundBody = z.object({ reason: z.string().trim().min(10).max(300), confirm: z.literal(true) }).strict();

/**
 * Solicita estorno TOTAL ao Mercado Pago. Não altera o pedido: consulta, saldo e comissão só são revertidos
 * quando o webhook de estorno chegar (ou numa conciliação). Estorno parcial não é suportado.
 */
adminPaymentOpsRouter.post('/payment-orders/:id/refund', guard, asyncRoute(async (req, res) => {
  const body = refundBody.safeParse(req.body);
  if (!body.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const order = await orderOf(req.params.id);
  if (order.status !== 'PAID') throw appError('PAYMENT_NOT_REFUNDABLE', { code: 'PAYMENT_NOT_REFUNDABLE', http: 409, expose: true });
  const pay = await pool.query(`SELECT external_id FROM payments WHERE order_id=$1 AND provider='mercadopago' AND status='PAID' ORDER BY paid_at DESC LIMIT 1`, [order.id]);
  const externalId = pay.rows[0]?.external_id as string | undefined;
  if (!externalId) throw appError('PAYMENT_NOT_REFUNDABLE', { code: 'PAYMENT_NOT_REFUNDABLE', http: 409, expose: true });
  const mp = provider();
  let refundRow: { id: string };
  try {
    const ins = await pool.query(`INSERT INTO payment_refunds(order_id,provider,external_payment_id,reason,requested_by) VALUES($1,'mercadopago',$2,$3,$4) RETURNING id`, [order.id, externalId, body.data.reason, req.user!.id]);
    refundRow = ins.rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw appError('PAYMENT_REFUND_IN_PROGRESS', { code: 'PAYMENT_REFUND_IN_PROGRESS', http: 409, expose: true });
    throw e;
  }
  try {
    const out = await mp.refundPayment(externalId, `refund:${refundRow.id}`);
    await pool.query(`UPDATE payment_refunds SET status='CONFIRMED',provider_refund_id=$2,updated_at=now() WHERE id=$1`, [refundRow.id, out.refundId]);
    await audit(req.user!.id, 'PAYMENT_REFUND_REQUESTED', 'PAYMENT_ORDER', order.id, { refundId: refundRow.id, requestId: requestId(req) });
    res.status(202).json({ refundId: refundRow.id, status: 'CONFIRMED', note: 'Estorno aceito pelo provedor. O pedido será revertido quando a confirmação chegar.' });
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'PAYMENT_PROVIDER_REQUEST_FAILED';
    await pool.query(`UPDATE payment_refunds SET status='FAILED',error_code=$2,updated_at=now() WHERE id=$1`, [refundRow.id, code]);
    await audit(req.user!.id, 'PAYMENT_REFUND_FAILED', 'PAYMENT_ORDER', order.id, { refundId: refundRow.id, code, requestId: requestId(req) });
    throw appError(code, { code, http: code === 'PAYMENT_REFUND_REJECTED' ? 422 : 502, expose: true });
  }
}));
