import type { PoolClient } from 'pg';
import { appError } from '../lib/http.js';
import { loadPaymentSettings } from '../pricing/settings.js';
import { computeCommission, estimateCharges, methodFromProviderType } from './commissions.js';

export type PaymentEventFacts = {
  provider: 'asaas' | 'mercadopago';
  eventId: string;
  eventType: string;
  rawStatus: string | null;
  externalPaymentId: string | null;
  reference: string | null;
  paymentType?: string | null;
  feeCents?: number | null;
  netCents?: number | null;
};

export type SettleOutcome = 'DUPLICATE' | 'ORDER_NOT_FOUND' | 'PAID' | 'ALREADY_PAID' | 'REVERSED' | 'LATE_PAID_IGNORED' | 'STATUS_UPDATED';

export function classifyPaymentStatus(provider: string, rawStatus: string | null): 'PAID' | 'REFUND' | 'PARTIAL_REFUND' | 'CHARGEBACK' | 'OTHER' {
  const status = String(rawStatus ?? '').toUpperCase();
  if (status.includes('CHARGEBACK') || status.includes('CHARGED_BACK')) return 'CHARGEBACK';
  if (status.includes('PARTIALLY_REFUNDED') || status.includes('PARTIAL_REFUND')) return 'PARTIAL_REFUND';
  if (status.includes('REFUND')) return 'REFUND';
  const paid = provider === 'mercadopago' ? status === 'APPROVED' : status === 'CHECKOUT_PAID' || status === 'PAYMENT_RECEIVED';
  return paid ? 'PAID' : 'OTHER';
}

/**
 * Aplica um evento de pagamento de forma idempotente e transacional (o chamador fornece a transação).
 * - PAID: registra pagamento, libera consulta/saldo, resgata cupom e cria a comissão (base/alíquota configuráveis).
 * - REFUND/CHARGEBACK de pedido pago: reverte direito de consulta/saldo e estorna ou marca para recuperação a comissão.
 */
export async function settlePaymentEvent(client: PoolClient, facts: PaymentEventFacts): Promise<{ outcome: SettleOutcome; orderId?: string }> {
  const inserted = await client.query(`INSERT INTO payment_webhook_events(provider,provider_event_id,event_type,payload)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`, [facts.provider, facts.eventId, facts.eventType, JSON.stringify({ id: facts.eventId, event: facts.eventType, reference: facts.reference, externalId: facts.externalPaymentId })]);
  if (!inserted.rowCount) return { outcome: 'DUPLICATE' };
  const eventRowId = String(inserted.rows[0].id);

  const order = facts.reference
    ? await client.query('SELECT * FROM payment_orders WHERE external_reference=$1 FOR UPDATE', [facts.reference])
    : await client.query('SELECT * FROM payment_orders WHERE provider_checkout_id=$1 FOR UPDATE', [facts.externalPaymentId]);
  if (!order.rowCount) {
    await client.query('UPDATE payment_webhook_events SET processing_error=$2,processed_at=now() WHERE id=$1', [eventRowId, 'ORDER_NOT_FOUND']);
    return { outcome: 'ORDER_NOT_FOUND' };
  }
  const current = order.rows[0] as Record<string, unknown>;
  const orderId = String(current.id);
  await client.query('UPDATE payment_webhook_events SET order_id=$2 WHERE id=$1', [eventRowId, orderId]);

  const kind = classifyPaymentStatus(facts.provider, facts.rawStatus);
  const normalizedStatus = String(facts.rawStatus ?? '').toUpperCase();
  // Só pedido estornado/chargeback é barreira: PAID depois de EXPIRED/FAILED continua creditando (o cliente pagou de fato).
  const terminalOrder = String(current.status) === 'REFUNDED';
  let outcome: SettleOutcome = 'STATUS_UPDATED';

  if (kind === 'PARTIAL_REFUND' || normalizedStatus === 'IN_MEDIATION') {
    // Estorno parcial ou disputa aberta: não reverte consulta/saldo/comissão automaticamente. Fica marcado para revisão manual.
    await client.query('UPDATE payment_webhook_events SET processing_error=$2 WHERE id=$1', [eventRowId, kind === 'PARTIAL_REFUND' ? 'PARTIAL_REFUND_MANUAL_REVIEW' : 'DISPUTE_OPEN_MANUAL_REVIEW']);
  } else if (kind === 'PAID' && terminalOrder) {
    await client.query('UPDATE payment_webhook_events SET processing_error=$2 WHERE id=$1', [eventRowId, 'LATE_PAID_AFTER_TERMINAL_ORDER']);
    outcome = 'LATE_PAID_IGNORED';
  } else if (kind === 'PAID' && current.status !== 'PAID') {
    await creditPaidOrder(client, current, facts, eventRowId);
    outcome = 'PAID';
  } else if (kind === 'PAID') {
    outcome = 'ALREADY_PAID';
  } else if ((kind === 'REFUND' || kind === 'CHARGEBACK') && current.status === 'PAID') {
    await reversePaidOrder(client, current, kind, eventRowId);
    outcome = 'REVERSED';
  } else if (current.status !== 'PAID') {
    const mapped = normalizedStatus.includes('EXPIRED') ? 'EXPIRED'
      : normalizedStatus.includes('CANCEL') || normalizedStatus.includes('REJECT') ? 'CANCELLED'
        : kind === 'REFUND' || kind === 'CHARGEBACK' ? 'REFUNDED' : 'CHECKOUT_ACTIVE';
    await client.query('UPDATE payment_orders SET status=$2,updated_at=now() WHERE id=$1', [orderId, mapped]);
    if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(mapped)) await client.query(`UPDATE coupon_redemptions SET status='RELEASED',updated_at=now() WHERE payment_order_id=$1 AND status='RESERVED'`, [orderId]);
  }
  await client.query('UPDATE payment_webhook_events SET processed_at=now() WHERE id=$1', [eventRowId]);
  return { outcome, orderId };
}

async function creditPaidOrder(client: PoolClient, current: Record<string, unknown>, facts: PaymentEventFacts, eventRowId: string): Promise<void> {
  const orderId = String(current.id);
  const purchaseType = String(current.purchase_type ?? 'CREDIT_PACKAGE');
  const credits = Number(current.credits ?? 0);
  const grossCents = Number(current.amount_cents);
  const payment = await client.query(`INSERT INTO payments(user_id,provider,status,amount_cents,credits,external_id,order_id,paid_at,provider_status,metadata)
    VALUES($1,$2,'PAID',$3,$4,$5,$6,now(),$7,$8::jsonb) RETURNING id`, [current.user_id, facts.provider, grossCents, purchaseType === 'QUERY' ? 0 : credits, facts.externalPaymentId, orderId, facts.rawStatus, JSON.stringify({ eventId: facts.eventId, purchaseType })]);
  const paymentId = String(payment.rows[0].id);

  if (purchaseType === 'QUERY') {
    if (!current.product_id || !current.query_plate) {
      await client.query('UPDATE payment_webhook_events SET processing_error=$2 WHERE id=$1', [eventRowId, 'QUERY_ORDER_MISSING_PRODUCT_OR_PLATE']);
      throw appError('QUERY_ORDER_INVALID', { code: 'QUERY_ORDER_INVALID', http: 500, expose: false });
    }
    await client.query(`INSERT INTO query_payment_entitlements(order_id,user_id,product_id,plate,search_type,status)
      VALUES($1,$2,$3,$4,$5,'READY') ON CONFLICT(order_id) DO UPDATE SET user_id=EXCLUDED.user_id,product_id=EXCLUDED.product_id,plate=EXCLUDED.plate,search_type=EXCLUDED.search_type,status='READY'`, [orderId, current.user_id, current.product_id, current.query_plate, current.query_search_type ?? 'PLATE']);
  } else {
    const wallet = await client.query('SELECT balance,balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [current.user_id]);
    const before = Number(wallet.rows[0]?.balance ?? 0); const after = before + credits;
    const purchasedCents = credits * 100;
    const beforeCents = Number(wallet.rows[0]?.balance_cents ?? before * 100); const afterCents = beforeCents + purchasedCents;
    await client.query('INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET balance=wallets.balance + EXCLUDED.balance, balance_cents=wallets.balance_cents + EXCLUDED.balance_cents,updated_at=now()', [current.user_id, credits, purchasedCents]);
    await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,payment_id,description,metadata)
      VALUES($1,'PURCHASE',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [current.user_id, credits, before, after, purchasedCents, beforeCents, afterCents, paymentId, `Saldo pré-pago adquirido via ${facts.provider}`, JSON.stringify({ orderId, eventId: facts.eventId, purchaseType, credits })]);
  }

  if (current.coupon_id) {
    const redemption = await client.query(`UPDATE coupon_redemptions SET status='REDEEMED',redeemed_at=now(),updated_at=now()
      WHERE payment_order_id=$1 AND status='RESERVED' RETURNING id`, [orderId]);
    if (redemption.rowCount) await client.query('UPDATE coupons SET redeemed_count=redeemed_count+1,updated_at=now() WHERE id=$1', [current.coupon_id]);
  }

  const settings = await loadPaymentSettings(client);
  const method = methodFromProviderType(facts.paymentType);
  const estimated = estimateCharges(settings, method, grossCents);
  const feeCents = facts.feeCents ?? estimated.feeCents;
  const netCents = facts.netCents ?? (grossCents - feeCents);

  if (current.affiliate_id) {
    const partner = await client.query('SELECT id,user_id,active,commission_base FROM affiliates WHERE id=$1', [current.affiliate_id]);
    const row = partner.rows[0] as { id: string; user_id: string | null; active: boolean; commission_base: string | null } | undefined;
    const selfReferral = Boolean(row?.user_id && String(row.user_id) === String(current.user_id));
    if (row && !selfReferral) {
      let providerCostCents = 0;
      if (purchaseType === 'QUERY' && current.product_id) {
        const product = await client.query('SELECT provider_cost_cents,supplier_cost_cents FROM query_products WHERE id=$1', [current.product_id]);
        providerCostCents = Number(product.rows[0]?.provider_cost_cents ?? 0) + Number(product.rows[0]?.supplier_cost_cents ?? 0);
      }
      const base = (row.commission_base as 'GROSS' | 'NET' | 'MARGIN' | null) ?? settings.commissionBase;
      const rateBps = current.affiliate_commission_bps == null ? settings.commissionDefaultBps : Number(current.affiliate_commission_bps);
      const commission = computeCommission({ base, rateBps, grossCents, gatewayFeeCents: feeCents, taxCents: estimated.taxCents, providerCostCents });
      await client.query(`INSERT INTO affiliate_commissions(affiliate_id,payment_id,order_id,amount_cents,status,base_type,base_cents,rate_bps,available_at)
        VALUES($1,$2,$3,$4,'PENDING',$5,$6,$7,now() + make_interval(days => $8)) ON CONFLICT DO NOTHING`, [row.id, paymentId, orderId, commission.amountCents, commission.baseType, commission.baseCents, commission.rateBps, settings.commissionHoldDays]);
    } else if (selfReferral) {
      await client.query('UPDATE payment_webhook_events SET processing_error=$2 WHERE id=$1', [eventRowId, 'AFFILIATE_SELF_REFERRAL_IGNORED']);
    }
  }

  await client.query(`UPDATE payment_orders SET status='PAID',paid_at=now(),updated_at=now(),payment_method=$2,gateway_fee_cents=$3,net_cents=$4 WHERE id=$1`, [orderId, method, feeCents, netCents]);
}

async function reversePaidOrder(client: PoolClient, current: Record<string, unknown>, kind: 'REFUND' | 'CHARGEBACK', eventRowId: string): Promise<void> {
  const orderId = String(current.id);
  const purchaseType = String(current.purchase_type ?? 'CREDIT_PACKAGE');
  await client.query(`UPDATE payment_orders SET status='REFUNDED',refunded_at=now(),reversal_kind=$2,updated_at=now() WHERE id=$1`, [orderId, kind]);
  await client.query(`UPDATE payments SET status='REFUNDED' WHERE order_id=$1 AND status='PAID'`, [orderId]);
  const notes: string[] = [];

  if (purchaseType === 'QUERY') {
    const revoked = await client.query(`UPDATE query_payment_entitlements SET status='REVOKED' WHERE order_id=$1 AND status='READY' RETURNING id`, [orderId]);
    if (!revoked.rowCount) {
      const already = await client.query(`SELECT 1 FROM query_payment_entitlements WHERE order_id=$1 AND status='REVOKED'`, [orderId]);
      if (!already.rowCount) notes.push('REVERSED_AFTER_CONSUMPTION');
    }
  } else {
    const credits = Number(current.credits ?? 0);
    const wallet = await client.query('SELECT balance,balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [current.user_id]);
    if (wallet.rowCount) {
      const balanceCents = Number(wallet.rows[0].balance_cents);
      const balanceCredits = Number(wallet.rows[0].balance);
      const dCents = Math.min(balanceCents, credits * 100);
      const dCredits = Math.min(balanceCredits, credits);
      if (dCents > 0) {
        await client.query('UPDATE wallets SET balance=balance-$2,balance_cents=balance_cents-$3,updated_at=now() WHERE user_id=$1', [current.user_id, dCredits, dCents]);
        await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,description,metadata)
          VALUES($1,'REFUND',$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [current.user_id, -dCredits, balanceCredits, balanceCredits - dCredits, -dCents, balanceCents, balanceCents - dCents, `Estorno (${kind.toLowerCase()}) do pedido`, JSON.stringify({ orderId, kind })]);
      }
      if (dCents < credits * 100) notes.push(`WALLET_PARTIALLY_SPENT:${credits * 100 - dCents}`);
    }
  }

  const commission = await client.query('SELECT id,status FROM affiliate_commissions WHERE order_id=$1 FOR UPDATE', [orderId]);
  if (commission.rowCount) {
    const status = String(commission.rows[0].status);
    if (status === 'PAID') await client.query(`UPDATE affiliate_commissions SET status='CLAWBACK_DUE',reversed_at=now(),reversal_reason=$2 WHERE id=$1`, [commission.rows[0].id, kind]);
    else if (status === 'PENDING' || status === 'AVAILABLE') await client.query(`UPDATE affiliate_commissions SET status='REVERSED',reversed_at=now(),reversal_reason=$2 WHERE id=$1`, [commission.rows[0].id, kind]);
  }
  await client.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata) VALUES(NULL,'PAYMENT_REVERSED','PAYMENT_ORDER',$1,$2::jsonb)`, [orderId, JSON.stringify({ kind, notes })]);
  if (notes.length) await client.query('UPDATE payment_webhook_events SET processing_error=$2 WHERE id=$1', [eventRowId, notes.join(',')]);
}
