import { env } from '../config.js';
import { pool, tx } from '../db.js';
import { MercadoPagoProvider } from '../payments/mercadopago.js';
import { settlePaymentEvent } from '../payments/settle.js';
import { log } from './http.js';
import { sendPurchaseReceipt } from '../purchaseContract.js';

export type SyncedPayment = { paymentId: string; status: string; outcome: string };
const OPEN = ['CREATED', 'CHECKOUT_ACTIVE'];

/**
 * Pergunta ao Mercado Pago pelos pagamentos de um pedido e aplica cada situação com o mesmo identificador do webhook
 * (idempotente: o que o webhook já aplicou volta como DUPLICATE). É a rede de segurança caso o aviso do webhook não chegue.
 */
export async function syncOrderByReference(reference: string): Promise<SyncedPayment[]> {
  const mp = new MercadoPagoProvider();
  const found = await mp.searchPaymentsByReference(reference);
  const out: SyncedPayment[] = [];
  for (const p of found) {
    const settled = await tx((client) => settlePaymentEvent(client, {
      provider: 'mercadopago', eventId: `payment:${p.id}:${p.status}`, eventType: `payment.${p.status}`, rawStatus: p.status,
      externalPaymentId: p.id, reference, paymentType: p.paymentType ?? null, feeCents: p.feeCents ?? null, netCents: p.netCents ?? null
    }));
    if (settled.outcome === 'PAID' && settled.orderId) void sendPurchaseReceipt(settled.orderId);
    out.push({ paymentId: p.id, status: p.status, outcome: settled.outcome });
  }
  return out;
}

function mpActive(): boolean {
  return env.PAYMENT_PROVIDER === 'mercadopago' && Boolean(env.MP_ACCESS_TOKEN);
}

/** Pedidos em aberto de uma pessoa (últimos 3 dias, no máximo 5), para conferir logo ao voltar do checkout. */
export async function syncUserOpenOrders(userId: string): Promise<{ checked: number; paid: number }> {
  if (!mpActive()) return { checked: 0, paid: 0 };
  const r = await pool.query(`SELECT external_reference FROM payment_orders WHERE user_id=$1 AND provider='mercadopago' AND status = ANY($2) AND created_at > now() - interval '3 days' ORDER BY created_at DESC LIMIT 5`, [userId, OPEN]);
  let paid = 0;
  for (const row of r.rows) {
    const res = await syncOrderByReference(String(row.external_reference));
    paid += res.filter((x) => x.outcome === 'PAID').length;
  }
  return { checked: r.rowCount ?? 0, paid };
}

/** Varredura periódica de pedidos abertos há mais de 2 minutos. Pega pagamento aprovado cujo aviso se perdeu. */
export async function sweepOpenOrders(): Promise<number> {
  if (!mpActive()) return 0;
  const r = await pool.query(`SELECT external_reference FROM payment_orders WHERE provider='mercadopago' AND status = ANY($1)
      AND created_at < now() - interval '2 minutes' AND created_at > now() - interval '3 days' ORDER BY created_at LIMIT 25`, [OPEN]);
  let paid = 0;
  for (const row of r.rows) {
    try {
      const res = await syncOrderByReference(String(row.external_reference));
      paid += res.filter((x) => x.outcome === 'PAID').length;
    } catch (error) { log('warn', 'payment_sweep_item_failed', { message: error instanceof Error ? error.message : 'unknown' }); }
  }
  if (paid > 0) log('info', 'payment_sweep_settled', { paid });
  return paid;
}

let timer: NodeJS.Timeout | null = null;
export function startPaymentSyncWorker(): void {
  if (timer || !env.PAYMENT_SYNC_WORKER) return;
  timer = setInterval(() => { sweepOpenOrders().catch((error) => log('error', 'payment_sweep_failed', { message: error instanceof Error ? error.message : 'unknown' })); }, 3 * 60_000);
  timer.unref();
}
