import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';

describe('liquidação de pagamentos: comissões, idempotência, estornos e chargebacks', integration, () => {
  let db; let settle; let pool;
  before(async () => {
    useTestEnv();
    db = await loadCore();
    pool = db.pool;
    settle = await import('../dist/payments/settle.js');
    // banco de teste compartilhado: volta às configurações padrão para o cálculo ser determinístico
    await pool.query('DELETE FROM payment_settings');
    await pool.query('INSERT INTO payment_settings(id) VALUES (1)');
  });
  after(async () => { await pool.end(); });

  async function mkUser(role = 'CLIENTE') {
    const r = await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Teste',$2) RETURNING id`, [`${uid('c')}@teste.local`, role]);
    await pool.query('INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,0,0)', [r.rows[0].id]);
    return r.rows[0].id;
  }
  async function mkPartner({ userId = null, bps = 1000, base = null } = {}) {
    const r = await pool.query(`INSERT INTO affiliates(user_id,name,code,commission_bps,commission_base) VALUES($1,'Parceiro',$2,$3,$4) RETURNING id`, [userId, uid('PNM').toUpperCase(), bps, base]);
    return r.rows[0].id;
  }
  async function mkProduct(costCents = 1000) {
    const id = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost,provider_cost_cents,price_cents,slug,active) VALUES($1,'Produto','d',1,$2,2490,$3,true)`, [id, costCents, id.toLowerCase()]);
    return id;
  }
  async function mkOrder({ userId, partnerId = null, amount = 10000, type = 'QUERY', productId = null, credits = 0, bps = 1000 }) {
    const ref = `pnm_${uid('o')}`;
    const r = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate,affiliate_id,affiliate_commission_bps)
      VALUES($1,'CHECKOUT_ACTIVE',$2,$3,'asaas',$4,$5,$6,$7,$8,$9) RETURNING id`, [userId, amount, credits, ref, type, productId, type === 'QUERY' ? 'ABC1D23' : null, partnerId, bps]);
    return { id: r.rows[0].id, ref };
  }
  const run = (facts) => pool.connect().then(async (c) => { try { await c.query('BEGIN'); const r = await settle.settlePaymentEvent(c, facts); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } });
  const facts = (ref, status, extra = {}) => ({ provider: 'asaas', eventId: uid('evt'), eventType: status, rawStatus: status, externalPaymentId: uid('pay'), reference: ref, ...extra });

  it('PAID cria direito de consulta e comissão PENDING com base NET e carência', async () => {
    const buyer = await mkUser(); const partner = await mkPartner({ bps: 1000 });
    const product = await mkProduct(1000);
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product, amount: 10000 });
    const result = await run(facts(order.ref, 'PAYMENT_RECEIVED', { paymentType: 'bank_transfer', feeCents: 99 }));
    assert.equal(result.outcome, 'PAID');
    const ent = await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [order.id]);
    assert.equal(ent.rows[0].status, 'READY');
    const com = (await pool.query('SELECT * FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0];
    // NET = 10000 - 99 (taxa real informada) - 600 (imposto 6% estimado) = 9301 -> 10% = 930
    assert.equal(com.base_type, 'NET');
    assert.equal(Number(com.base_cents), 9301);
    assert.equal(Number(com.amount_cents), 930);
    assert.equal(com.status, 'PENDING');
    assert.ok(new Date(com.available_at).getTime() > Date.now() + 6 * 86400_000);
    const o = (await pool.query('SELECT status,payment_method,gateway_fee_cents,net_cents FROM payment_orders WHERE id=$1', [order.id])).rows[0];
    assert.equal(o.status, 'PAID'); assert.equal(o.payment_method, 'PIX'); assert.equal(Number(o.gateway_fee_cents), 99);
  });

  it('é idempotente: o mesmo evento e a repetição de PAID não duplicam nada', async () => {
    const buyer = await mkUser(); const partner = await mkPartner(); const product = await mkProduct();
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product });
    const f = facts(order.ref, 'PAYMENT_RECEIVED');
    assert.equal((await run(f)).outcome, 'PAID');
    assert.equal((await run(f)).outcome, 'DUPLICATE');
    assert.equal((await run({ ...f, eventId: uid('evt2') })).outcome, 'ALREADY_PAID');
    assert.equal((await pool.query('SELECT count(*)::int n FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM payments WHERE order_id=$1', [order.id])).rows[0].n, 1);
  });

  it('base MARGIN desconta custo do provedor; override por parceiro prevalece', async () => {
    const buyer = await mkUser(); const partner = await mkPartner({ bps: 2000, base: 'MARGIN' }); const product = await mkProduct(2000);
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product, amount: 10000, bps: 2000 });
    await run(facts(order.ref, 'PAYMENT_RECEIVED', { paymentType: 'credit_card', feeCents: 449 }));
    const com = (await pool.query('SELECT * FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0];
    assert.equal(com.base_type, 'MARGIN');
    assert.equal(Number(com.base_cents), 10000 - 449 - 600 - 2000);
    assert.equal(Number(com.amount_cents), Math.round((10000 - 449 - 600 - 2000) * 0.2));
  });

  it('auto-indicação não gera comissão', async () => {
    const buyer = await mkUser(); const partner = await mkPartner({ userId: buyer }); const product = await mkProduct();
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product });
    await run(facts(order.ref, 'PAYMENT_RECEIVED'));
    assert.equal((await pool.query('SELECT count(*)::int n FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0].n, 0);
  });

  it('estorno de pedido pago revoga o direito de consulta e reverte a comissão pendente', async () => {
    const buyer = await mkUser(); const partner = await mkPartner(); const product = await mkProduct();
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product });
    await run(facts(order.ref, 'PAYMENT_RECEIVED'));
    const r = await run(facts(order.ref, 'PAYMENT_REFUNDED'));
    assert.equal(r.outcome, 'REVERSED');
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [order.id])).rows[0].status, 'REVOKED');
    const com = (await pool.query('SELECT status,reversal_reason FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0];
    assert.equal(com.status, 'REVERSED'); assert.equal(com.reversal_reason, 'REFUND');
    const o = (await pool.query('SELECT status,reversal_kind FROM payment_orders WHERE id=$1', [order.id])).rows[0];
    assert.equal(o.status, 'REFUNDED'); assert.equal(o.reversal_kind, 'REFUND');
  });

  it('chargeback após repasse marca a comissão como CLAWBACK_DUE', async () => {
    const buyer = await mkUser(); const partner = await mkPartner(); const product = await mkProduct();
    const order = await mkOrder({ userId: buyer, partnerId: partner, productId: product });
    await run(facts(order.ref, 'PAYMENT_RECEIVED'));
    await pool.query(`UPDATE affiliate_commissions SET status='PAID',paid_at=now() WHERE order_id=$1`, [order.id]);
    await run(facts(order.ref, 'PAYMENT_CHARGEBACK_REQUESTED'));
    const com = (await pool.query('SELECT status,reversal_reason FROM affiliate_commissions WHERE order_id=$1', [order.id])).rows[0];
    assert.equal(com.status, 'CLAWBACK_DUE'); assert.equal(com.reversal_reason, 'CHARGEBACK');
  });

  it('estorno de pacote de saldo debita o saldo disponível e registra a transação', async () => {
    const buyer = await mkUser();
    const order = await mkOrder({ userId: buyer, type: 'CREDIT_PACKAGE', credits: 50, amount: 5000 });
    await run(facts(order.ref, 'PAYMENT_RECEIVED'));
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [buyer])).rows[0].balance_cents), 5000);
    await pool.query('UPDATE wallets SET balance_cents=balance_cents-2000,balance=balance-20 WHERE user_id=$1', [buyer]); // parte já gasta
    await run(facts(order.ref, 'PAYMENT_REFUNDED'));
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [buyer])).rows[0].balance_cents), 0);
    const tx = await pool.query(`SELECT amount_cents FROM wallet_transactions WHERE user_id=$1 AND kind='REFUND'`, [buyer]);
    assert.equal(Number(tx.rows[0].amount_cents), -3000);
    const ev = await pool.query(`SELECT processing_error FROM payment_webhook_events WHERE order_id=$1 AND processing_error IS NOT NULL`, [order.id]);
    assert.match(ev.rows[0].processing_error, /WALLET_PARTIALLY_SPENT:2000/);
  });

  it('pedido inexistente é registrado sem quebrar', async () => {
    const r = await run(facts('pnm_nao_existe', 'PAYMENT_RECEIVED'));
    assert.equal(r.outcome, 'ORDER_NOT_FOUND');
  });

  it('classificação de status por provedor', () => {
    assert.equal(settle.classifyPaymentStatus('mercadopago', 'approved'), 'PAID');
    assert.equal(settle.classifyPaymentStatus('mercadopago', 'charged_back'), 'CHARGEBACK');
    assert.equal(settle.classifyPaymentStatus('mercadopago', 'refunded'), 'REFUND');
    assert.equal(settle.classifyPaymentStatus('mercadopago', 'pending'), 'OTHER');
    assert.equal(settle.classifyPaymentStatus('asaas', 'CHECKOUT_PAID'), 'PAID');
    assert.equal(settle.classifyPaymentStatus('asaas', 'PAYMENT_OVERDUE'), 'OTHER');
  });
});
