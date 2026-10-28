import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('cancelamento de consulta (em andamento e já paga) e falhas visíveis', integration, () => {
  let pool; let server; let token; let userId; let otherToken; let cancel;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    cancel = await import('../dist/lib/queryCancel.js');
    server = await startServer();
    const mk = (n) => hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: `Cliente ${n}`, email: `${uid(n)}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const a = await mk('can'); const b = await mk('out');
    token = a.json.token; userId = a.json.user.id; otherToken = b.json.token;
    await pool.query('UPDATE wallets SET balance_cents=50000 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const balance = async () => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
  const proc = async (plate, key = null) => {
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,idempotency_key) VALUES($1,$2,'COMPLETE','PROCESSING',0,2490,'WALLET_MONEY','mock-bdrp',$3) RETURNING id`, [userId, plate, key]);
    await pool.query('UPDATE wallets SET balance_cents=balance_cents-2490 WHERE user_id=$1', [userId]);
    return q.rows[0].id;
  };
  const order = async ({ status = 'PAID', amount = 2490, ent = 'READY', paid = true } = {}) => {
    const o = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate) VALUES($1,$2,$3,0,'mercadopago',$4,'QUERY','COMPLETE','CAN1A11') RETURNING id`, [userId, status, amount, `pnm_query_${uid('r')}`]);
    const id = o.rows[0].id;
    await pool.query(`INSERT INTO query_payment_entitlements(order_id,user_id,product_id,plate,status) VALUES($1,$2,'COMPLETE','CAN1A11',$3)`, [id, userId, ent]);
    if (paid) await pool.query(`INSERT INTO payments(user_id,order_id,provider,status,amount_cents,credits,external_id,paid_at) VALUES($1,$2,'mercadopago','PAID',$3,0,$4,now())`, [userId, id, amount, uid('mp')]);
    return id;
  };
  const gateway = (fail) => { const calls = []; return { calls, isConfigured: () => true, refundPayment: async (id, key) => { calls.push({ id, key }); if (fail) throw Object.assign(new Error('x'), { code: 'PAYMENT_REFUND_REJECTED' }); return { refundId: 'rf-1', status: 'approved' }; } }; };

  it('cancela consulta em andamento: devolve o saldo, libera a chave de idempotência e é idempotente', async () => {
    const before = await balance();
    const id = await proc('CAN0A00', 'chave-cancel-0001');
    assert.equal(await balance(), before - 2490);
    const r = await hostRequest(server.base, `/api/queries/${id}/cancel`, { method: 'POST', token, body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.cancelled, true);
    assert.equal(await balance(), before);
    const row = (await pool.query('SELECT status,error_code,idempotency_key FROM vehicle_queries WHERE id=$1', [id])).rows[0];
    assert.equal(row.status, 'REFUNDED'); assert.equal(row.error_code, 'QUERY_CANCELLED'); assert.equal(row.idempotency_key, null);
    const again = await hostRequest(server.base, `/api/queries/${id}/cancel`, { method: 'POST', token, body: {} });
    assert.equal(again.status, 200);
    assert.equal(await balance(), before);
  });

  it('não cancela consulta de outra pessoa nem consulta já concluída', async () => {
    const id = await proc('CAN0B00');
    const other = await hostRequest(server.base, `/api/queries/${id}/cancel`, { method: 'POST', token: otherToken, body: {} });
    assert.equal(other.status, 404);
    await pool.query(`UPDATE vehicle_queries SET status='SUCCESS' WHERE id=$1`, [id]);
    const done = await hostRequest(server.base, `/api/queries/${id}/cancel`, { method: 'POST', token, body: {} });
    assert.equal(done.status, 409); assert.equal(done.json.error, 'QUERY_NOT_CANCELLABLE');
    assert.equal((await hostRequest(server.base, `/api/queries/${id}/cancel`, { method: 'POST', body: {} })).status, 401);
  });

  it('cancel-processing cancela todas as consultas em andamento do cliente', async () => {
    await pool.query(`UPDATE vehicle_queries SET status='SUCCESS' WHERE user_id=$1 AND status='PROCESSING'`, [userId]);
    const before = await balance();
    await proc('CAN1B00'); await proc('CAN1C00');
    const r = await hostRequest(server.base, '/api/queries/cancel-processing', { method: 'POST', token, body: {} });
    assert.equal(r.status, 200); assert.equal(r.json.cancelled, 2);
    assert.equal(await balance(), before);
    assert.equal((await hostRequest(server.base, '/api/queries/cancel-processing', { method: 'POST', token, body: {} })).json.cancelled, 0);
  });

  it('consulta paga em andamento cancelada volta a ficar disponível (READY)', async () => {
    const o = await order({ ent: 'CONSUMED' });
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,payment_order_id) VALUES($1,'CAN2A11','COMPLETE','PROCESSING',0,2490,'DIRECT_PAYMENT','mock-bdrp',$2) RETURNING id`, [userId, o]);
    await pool.query(`UPDATE query_payment_entitlements SET query_id=$2 WHERE order_id=$1`, [o, q.rows[0].id]);
    const r = await hostRequest(server.base, `/api/queries/${q.rows[0].id}/cancel`, { method: 'POST', token, body: {} });
    assert.equal(r.status, 200);
    const e = (await pool.query('SELECT status,query_id FROM query_payment_entitlements WHERE order_id=$1', [o])).rows[0];
    assert.equal(e.status, 'READY'); assert.equal(e.query_id, null);
  });

  it('cancelar consulta paga e não usada: revoga o direito e pede o estorno ao provedor uma única vez', async () => {
    const o = await order();
    const g = gateway(false);
    const out = await cancel.cancelPaidQuery(userId, o, g);
    assert.equal(out.status, 'REFUND_REQUESTED');
    assert.equal(g.calls.length, 1); assert.match(g.calls[0].key, /^refund:/);
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [o])).rows[0].status, 'REVOKED');
    const refund = (await pool.query('SELECT status,requested_by,provider_refund_id FROM payment_refunds WHERE order_id=$1', [o])).rows[0];
    assert.equal(refund.status, 'CONFIRMED'); assert.equal(refund.requested_by, userId); assert.equal(refund.provider_refund_id, 'rf-1');
    assert.equal((await cancel.cancelPaidQuery(userId, o, g)).status, 'ALREADY_CANCELLED');
    assert.equal(g.calls.length, 1);
  });

  it('se o provedor recusar o estorno, a consulta paga continua disponível', async () => {
    const o = await order();
    await assert.rejects(cancel.cancelPaidQuery(userId, o, gateway(true)), (e) => e.code === 'PAYMENT_REFUND_REJECTED');
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [o])).rows[0].status, 'READY');
    assert.equal((await pool.query('SELECT status FROM payment_refunds WHERE order_id=$1', [o])).rows[0].status, 'FAILED');
    const g = gateway(false);
    assert.equal((await cancel.cancelPaidQuery(userId, o, g)).status, 'REFUND_REQUESTED');
  });

  it('não cancela consulta já usada, pedido sem pagamento ou pedido de outra pessoa', async () => {
    const used = await order({ ent: 'CONSUMED' });
    await assert.rejects(cancel.cancelPaidQuery(userId, used, gateway(false)), (e) => e.code === 'QUERY_PAYMENT_ALREADY_USED');
    const pending = await order({ status: 'CANCELLED', paid: false });
    await assert.rejects(cancel.cancelPaidQuery(userId, pending, gateway(false)), (e) => e.code === 'PAYMENT_NOT_PAID');
    const mine = await order();
    const r = await hostRequest(server.base, `/api/payments/query/${mine}/cancel`, { method: 'POST', token: otherToken, body: {} });
    assert.equal(r.status, 404);
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [mine])).rows[0].status, 'READY');
  });

  it('consulta grátis (valor zero): só encerra o direito, sem chamar o provedor', async () => {
    const o = await order({ amount: 0, paid: false });
    const g = gateway(false);
    assert.equal((await cancel.cancelPaidQuery(userId, o, g)).status, 'CANCELLED');
    assert.equal(g.calls.length, 0);
    assert.equal((await pool.query('SELECT status FROM query_payment_entitlements WHERE order_id=$1', [o])).rows[0].status, 'REVOKED');
  });

  it('falha do provedor responde 424 com mensagem legível, guarda o motivo e libera a chave para nova tentativa', async () => {
    const key = `retry-${uid('k')}-0001`;
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token, headers: { 'idempotency-key': key }, body: { plate: 'TIM0E00', productId: 'COMPLETE' } });
    assert.equal(r.status, 424, r.text);
    assert.equal(r.json.error, 'QUERY_RETRY_AVAILABLE');
    assert.match(r.json.message, /Nada foi perdido/);
    const row = (await pool.query(`SELECT status,error_code,error_message,idempotency_key FROM vehicle_queries WHERE user_id=$1 AND plate='TIM0E00' ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0];
    assert.equal(row.status, 'REFUNDED'); assert.ok(row.error_message && row.error_message.length > 3); assert.equal(row.idempotency_key, null);
    const again = await hostRequest(server.base, '/api/queries', { method: 'POST', token, headers: { 'idempotency-key': key }, body: { plate: 'TIM0E00', productId: 'COMPLETE' } });
    assert.equal(again.status, 424, again.text); // roda de novo (não fica preso em QUERY_IN_PROGRESS)
  });

  it('arquivar: esconde da lista, restaura, não mexe em consulta em andamento nem em consulta de outra pessoa', async () => {
    const a = (await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider) VALUES($1,'ARQ1A11','COMPLETE','REFUNDED',0,2490,'WALLET_MONEY','mock-bdrp') RETURNING id`, [userId])).rows[0].id;
    const b = (await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider) VALUES($1,'ARQ2B22','COMPLETE','FAILED',0,2490,'WALLET_MONEY','mock-bdrp') RETURNING id`, [userId])).rows[0].id;
    const run = (await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider) VALUES($1,'ARQ3C33','COMPLETE','PROCESSING',0,2490,'WALLET_MONEY','mock-bdrp') RETURNING id`, [userId])).rows[0].id;
    const list = async (q = '') => (await hostRequest(server.base, `/api/queries?plate=ARQ${q}`, { token })).json.map((x) => x.plate).sort();
    assert.deepEqual(await list(), ['ARQ1A11', 'ARQ2B22', 'ARQ3C33']);
    assert.equal((await hostRequest(server.base, `/api/queries/${a}/archive`, { method: 'POST', token: otherToken, body: {} })).status, 404);
    assert.equal((await hostRequest(server.base, `/api/queries/${run}/archive`, { method: 'POST', token, body: {} })).status, 409);
    assert.equal((await hostRequest(server.base, `/api/queries/${a}/archive`, { method: 'POST', token, body: {} })).status, 200);
    assert.deepEqual(await list(), ['ARQ2B22', 'ARQ3C33']);
    assert.deepEqual(await list('&archived=1'), ['ARQ1A11']);
    const all = await hostRequest(server.base, '/api/queries/archive-failed', { method: 'POST', token, body: {} });
    assert.equal(all.status, 200); assert.ok(all.json.archived >= 1);
    assert.deepEqual(await list(), ['ARQ3C33']);
    assert.equal((await hostRequest(server.base, `/api/queries/${b}/unarchive`, { method: 'POST', token, body: {} })).status, 200);
    assert.deepEqual(await list(), ['ARQ2B22', 'ARQ3C33']);
    // o registro continua no banco (cobrança e auditoria)
    assert.equal(Number((await pool.query('SELECT count(*) FROM vehicle_queries WHERE id=ANY($1)', [[a, b]])).rows[0].count), 2);
  });
});
