import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('estorno de consultas: falha do provedor e consultas presas', integration, () => {
  let pool; let server; let token; let userId; let refund;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    refund = await import('../dist/lib/queryRefund.js');
    server = await startServer();
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Estorno', email: `${uid('est')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = reg.json.token; userId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=50000 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const balance = async () => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);

  it('falha do provedor (timeout) estorna o saldo e marca REFUNDED', async () => {
    const before = await balance();
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate: 'TIM0E00', productId: 'COMPLETE' } });
    assert.ok(r.status >= 400, r.text);
    assert.equal(await balance(), before);
    const q = (await pool.query(`SELECT status,error_code FROM vehicle_queries WHERE user_id=$1 AND plate='TIM0E00'`, [userId])).rows[0];
    assert.equal(q.status, 'REFUNDED');
    const tr = await pool.query(`SELECT kind FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at`, [userId]);
    assert.deepEqual(tr.rows.map((x) => x.kind), ['QUERY', 'REFUND']);
  });

  it('placa inexistente também estorna', async () => {
    const before = await balance();
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate: 'ZZZ9Z99', productId: 'BASIC' } });
    assert.ok(r.status >= 400);
    assert.equal(await balance(), before);
  });

  it('sweeper estorna consulta presa em PROCESSING uma única vez', async () => {
    await refund.sweepStuckQueries(10); // esvazia resíduos de execuções anteriores no banco de teste compartilhado
    const before = await balance();
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,created_at)
      VALUES($1,'STK1A11','COMPLETE','PROCESSING',0,2490,'WALLET_MONEY','mock-bdrp', now() - interval '30 minutes') RETURNING id`, [userId]);
    await pool.query('UPDATE wallets SET balance_cents=balance_cents-2490 WHERE user_id=$1', [userId]);
    assert.equal(await balance(), before - 2490);
    assert.equal(await refund.sweepStuckQueries(10), 1);
    assert.equal(await balance(), before);
    assert.equal(await refund.sweepStuckQueries(10), 0);
    assert.equal(await balance(), before);
    const row = (await pool.query('SELECT status,error_code FROM vehicle_queries WHERE id=$1', [q.rows[0].id])).rows[0];
    assert.equal(row.status, 'REFUNDED'); assert.equal(row.error_code, 'QUERY_STUCK_TIMEOUT');
  });

  it('consulta recente em PROCESSING não é tocada', async () => {
    await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider) VALUES($1,'NEW1A11','BASIC','PROCESSING',0,990,'WALLET_MONEY','mock-bdrp')`, [userId]);
    assert.equal(await refund.sweepStuckQueries(10), 0);
  });

  it('pagamento direto: o direito volta a READY', async () => {
    const order = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate) VALUES($1,'PAID',2490,0,'asaas',$2,'QUERY','COMPLETE','DIR1A11') RETURNING id`, [userId, uid('pnm')]);
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,payment_order_id,created_at) VALUES($1,'DIR1A11','COMPLETE','PROCESSING',0,2490,'DIRECT_PAYMENT','mock-bdrp',$2, now() - interval '1 hour') RETURNING id`, [userId, order.rows[0].id]);
    await pool.query(`INSERT INTO query_payment_entitlements(order_id,user_id,product_id,plate,status,query_id,consumed_at) VALUES($1,$2,'COMPLETE','DIR1A11','CONSUMED',$3,now())`, [order.rows[0].id, userId, q.rows[0].id]);
    assert.equal(await refund.sweepStuckQueries(10), 1);
    const e = (await pool.query('SELECT status,query_id FROM query_payment_entitlements WHERE order_id=$1', [order.rows[0].id])).rows[0];
    assert.equal(e.status, 'READY'); assert.equal(e.query_id, null);
  });
});
