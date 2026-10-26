import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';
import { checkoutWithContract } from './helpers/contract.mjs';

describe('cupom de 100% em consulta avulsa: libera a consulta sem meio de pagamento', integration, () => {
  let pool; let server;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer(); // PAYMENT_PROVIDER=disabled: sem checkout configurado
  });
  after(async () => { await server.stop(); await pool.query(`DELETE FROM email_outbox WHERE related_type='PURCHASE_CONTRACT'`); await pool.end(); });

  const register = async () => {
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Cupom', email: `${uid('cp')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    return { token: reg.json.token, id: reg.json.user.id };
  };
  const mkCoupon = async (type, value, max = null) => {
    const code = uid('TESTE').toUpperCase().replace(/-/g, '');
    const r = await pool.query('INSERT INTO coupons(code,discount_type,discount_value,max_redemptions) VALUES($1,$2,$3,$4) RETURNING id', [code, type, value, max]);
    return { id: r.rows[0].id, code };
  };
  const body = (couponCode) => ({ productId: 'COMPLETE', plate: 'DEV1B11', couponCode });

  it('orçamento mostra total zero e não exige meio de pagamento', async () => {
    const c = await register(); const cp = await mkCoupon('PERCENT', 100);
    const q = await hostRequest(server.base, '/api/payments/query/quote', { method: 'POST', token: c.token, body: body(cp.code) });
    assert.equal(q.status, 200, q.text);
    assert.equal(q.json.amountCents, 0); assert.equal(q.json.free, true); assert.equal(q.json.paymentProviderConfigured, true);
    assert.ok(q.json.discountCents > 0);
  });

  it('checkout grátis: pedido PAID com valor zero, direito READY, cupom resgatado, sem comissão; consulta roda e consome o direito', async () => {
    const c = await register(); const cp = await mkCoupon('PERCENT', 100, 5);
    const r = await checkoutWithContract(server.base, pool, c, '/api/payments/query/checkout', body(cp.code));
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.free, true); assert.equal(r.json.checkoutUrl, null); assert.equal(r.json.amountCents, 0);
    const order = (await pool.query('SELECT status,amount_cents,provider,paid_at FROM payment_orders WHERE id=$1', [r.json.orderId])).rows[0];
    assert.equal(order.status, 'PAID'); assert.equal(Number(order.amount_cents), 0); assert.equal(order.provider, 'coupon'); assert.ok(order.paid_at);
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [r.json.orderId])).rows[0].status, 'READY');
    assert.equal((await pool.query('SELECT status FROM coupon_redemptions WHERE payment_order_id=$1', [r.json.orderId])).rows[0].status, 'REDEEMED');
    assert.equal(Number((await pool.query('SELECT redeemed_count FROM coupons WHERE id=$1', [cp.id])).rows[0].redeemed_count), 1);
    assert.equal((await pool.query('SELECT 1 FROM payments WHERE order_id=$1', [r.json.orderId])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM affiliate_commissions WHERE order_id=$1', [r.json.orderId])).rowCount, 0);

    const run = await hostRequest(server.base, '/api/queries', { method: 'POST', token: c.token, body: { plate: 'DEV1B11', productId: 'COMPLETE', paymentOrderId: r.json.orderId } });
    assert.equal(run.status, 201, run.text);
    const saved = (await pool.query('SELECT charge_source,price_cents FROM vehicle_queries WHERE id=$1', [run.json.id])).rows[0];
    assert.equal(saved.charge_source, 'DIRECT_PAYMENT'); assert.equal(Number(saved.price_cents), 0);
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [r.json.orderId])).rows[0].status, 'CONSUMED');
    const again = await hostRequest(server.base, '/api/queries', { method: 'POST', token: c.token, body: { plate: 'DEV1B11', productId: 'COMPLETE', paymentOrderId: r.json.orderId } });
    assert.equal(again.status, 409);
  });

  it('cada conta resgata o mesmo cupom grátis uma vez; outra conta ainda pode', async () => {
    const a = await register(); const b = await register(); const cp = await mkCoupon('PERCENT', 100);
    assert.equal((await checkoutWithContract(server.base, pool, a, '/api/payments/query/checkout', body(cp.code))).status, 201);
    const second = await checkoutWithContract(server.base, pool, a, '/api/payments/query/checkout', body(cp.code));
    assert.equal(second.status, 400); assert.equal(second.json.error, 'COUPON_ALREADY_USED');
    assert.match(second.json.message, /já usou este cupom/);
    const quote = await hostRequest(server.base, '/api/payments/query/quote', { method: 'POST', token: a.token, body: body(cp.code) });
    assert.equal(quote.json.error, 'COUPON_ALREADY_USED');
    assert.equal((await checkoutWithContract(server.base, pool, b, '/api/payments/query/checkout', body(cp.code))).status, 201);
  });

  it('respeita o limite de resgates do cupom', async () => {
    const a = await register(); const b = await register(); const cp = await mkCoupon('PERCENT', 100, 1);
    assert.equal((await checkoutWithContract(server.base, pool, a, '/api/payments/query/checkout', body(cp.code))).status, 201);
    const r = await checkoutWithContract(server.base, pool, b, '/api/payments/query/checkout', body(cp.code));
    assert.equal(r.status, 400); assert.equal(r.json.error, 'COUPON_UNAVAILABLE');
  });

  it('cupom parcial ou sem cupom continua exigindo o meio de pagamento, com mensagem clara', async () => {
    const c = await register(); const cp = await mkCoupon('PERCENT', 50);
    const partial = await checkoutWithContract(server.base, pool, c, '/api/payments/query/checkout', body(cp.code));
    assert.equal(partial.status, 503); assert.equal(partial.json.error, 'PAYMENT_PROVIDER_NOT_CONFIGURED');
    assert.match(partial.json.message, /checkout de pagamento ainda não foi configurado/);
    assert.equal((await pool.query(`SELECT 1 FROM payment_orders WHERE user_id=$1`, [c.id])).rowCount, 0);
    const none = await checkoutWithContract(server.base, pool, c, '/api/payments/query/checkout', { productId: 'COMPLETE', plate: 'DEV1B11' });
    assert.equal(none.status, 503);
  });

  it('erros de cupom aparecem em português, não como mensagem genérica', async () => {
    const c = await register();
    const missing = await hostRequest(server.base, '/api/payments/query/quote', { method: 'POST', token: c.token, body: body('NAOEXISTE99') });
    assert.equal(missing.status, 400); assert.equal(missing.json.error, 'COUPON_INVALID');
    assert.match(missing.json.message, /Cupom não encontrado/);
    const off = await mkCoupon('PERCENT', 100); await pool.query('UPDATE coupons SET active=false WHERE id=$1', [off.id]);
    const inactive = await hostRequest(server.base, '/api/payments/query/quote', { method: 'POST', token: c.token, body: body(off.code) });
    assert.equal(inactive.json.error, 'COUPON_UNAVAILABLE'); assert.match(inactive.json.message, /não está disponível/);
  });
});
