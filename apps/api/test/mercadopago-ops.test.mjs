import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

// Servidor simulado do Mercado Pago: nenhum teste toca a API real.
const state = { payments: {}, search: {}, refundMode: 'ok', calls: [], preference: null };
const stub = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    state.calls.push({ method: req.method, url: req.url, headers: req.headers, body });
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/checkout/preferences') { state.preference = JSON.parse(body); return send(201, { id: 'pref-1', init_point: 'https://prod.example/pay', sandbox_init_point: 'https://sandbox.example/pay' }); }
    if (req.method === 'POST' && /\/v1\/payments\/[^/]+\/refunds$/.test(url.pathname)) return state.refundMode === 'ok' ? send(201, { id: 777, status: 'approved' }) : send(400, { message: 'rejected' });
    if (url.pathname === '/v1/payments/search') return send(200, { results: state.search[url.searchParams.get('external_reference')] ?? [] });
    const m = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (m) return state.payments[m[1]] ? send(200, state.payments[m[1]]) : send(404, {});
    send(404, {});
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;
const SECRET = 'segredo-webhook-mp-teste-123456';

useTestEnv({ MP_ACCESS_TOKEN: 'TEST-token-simulado', MP_WEBHOOK_SECRET: SECRET, MP_API_BASE_URL: stubUrl, MP_EXPIRES_MINUTES: '30', MP_STATEMENT_DESCRIPTOR: 'PLACANAMAO', MP_BINARY_MODE: 'true', PAYMENT_PROVIDER: 'mercadopago' });
const { MercadoPagoProvider } = await import('../dist/payments/mercadopago.js');
const { classifyPaymentStatus } = await import('../dist/payments/settle.js');

test.after(() => new Promise((r) => stub.close(r)));

test('classificação: estorno parcial e disputa não são estorno total', () => {
  assert.equal(classifyPaymentStatus('mercadopago', 'approved'), 'PAID');
  assert.equal(classifyPaymentStatus('mercadopago', 'refunded'), 'REFUND');
  assert.equal(classifyPaymentStatus('mercadopago', 'charged_back'), 'CHARGEBACK');
  assert.equal(classifyPaymentStatus('mercadopago', 'partially_refunded'), 'PARTIAL_REFUND');
  assert.equal(classifyPaymentStatus('mercadopago', 'in_process'), 'OTHER');
  assert.equal(classifyPaymentStatus('mercadopago', 'rejected'), 'OTHER');
});

test('preferência de checkout leva validade, descritor, modo binário e usa link de sandbox com credencial de teste', async () => {
  const out = await new MercadoPagoProvider().createCheckout({ orderId: 'o-1', itemName: 'Consulta', itemDescription: 'd', amountCents: 2490, customer: { name: 'A', email: 'a@b.co' } });
  assert.equal(out.link, 'https://sandbox.example/pay');
  assert.equal(state.preference.binary_mode, true); assert.equal(state.preference.statement_descriptor, 'PLACANAMAO'); assert.equal(state.preference.expires, true);
  const span = Date.parse(state.preference.expiration_date_to) - Date.parse(state.preference.expiration_date_from);
  assert.equal(Math.round(span / 60000), 30);
});

describe('operações Mercado Pago (integração)', integration, () => {
  let server, pool, adm, fin, sup, userId, productId;
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-token-simulado', MP_WEBHOOK_SECRET: SECRET, MP_API_BASE_URL: stubUrl });
    adm = await adminSession({ server, pool, role: 'ADMIN' }); fin = await adminSession({ server, pool, role: 'FINANCEIRO' }); sup = await adminSession({ server, pool, role: 'SUPORTE' });
    userId = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Cliente MP','CLIENTE') RETURNING id`, [`${uid('c')}@teste.local`])).rows[0].id;
    await pool.query('INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,0,0)', [userId]);
    productId = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost,provider_cost_cents,price_cents,slug,active) VALUES($1,'Produto','d',1,100,2490,$2,true)`, [productId, productId.toLowerCase()]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  const mkOrder = async (status = 'CHECKOUT_ACTIVE') => {
    const ref = `pnm_${uid('o')}`;
    const r = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate) VALUES($1,$2,2490,0,'mercadopago',$3,'QUERY',$4,'ABC1D23') RETURNING id`, [userId, status, ref, productId]);
    return { id: r.rows[0].id, ref };
  };
  const pay = (id, ref, status) => { state.payments[id] = { status, external_reference: ref, payment_type_id: 'bank_transfer', fee_details: [{ amount: 1.5, type: 'mercadopago_fee' }], transaction_details: { net_received_amount: 23.4 } }; };
  const webhook = (paymentId, { type = 'payment' } = {}) => {
    const ts = String(Math.floor(Date.now() / 1000)); const reqId = uid('req');
    const hash = crypto.createHmac('sha256', SECRET).update(`id:${paymentId};request-id:${reqId};ts:${ts};`).digest('hex');
    const body = JSON.stringify({ type, data: { id: paymentId } }); const url = new URL(server.base + '/api/payments/mercadopago/webhook');
    return new Promise((resolve, reject) => {
      const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${hash}`, 'x-request-id': reqId } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, json: d ? JSON.parse(d) : null })); });
      r.on('error', reject); r.write(body); r.end();
    });
  };
  const status = async (id) => (await pool.query('SELECT status FROM payment_orders WHERE id=$1', [id])).rows[0].status;

  it('webhook de pagamento aprovado liquida o pedido; aviso de outro assunto é ignorado sem consultar a API', async () => {
    const o = await mkOrder(); const pid = uid('9'); pay(pid, o.ref, 'approved');
    const before = state.calls.length;
    const ignored = await webhook('M-123', { type: 'merchant_order' });
    assert.equal(ignored.status, 200); assert.equal(ignored.json.ignored, true);
    assert.equal(state.calls.slice(before).filter((c) => c.url.includes('M-123')).length, 0);
    assert.equal((await webhook(pid)).status, 200);
    assert.equal(await status(o.id), 'PAID');
    assert.equal((await webhook(pid)).json.duplicate, true);
  });

  it('estorno parcial não reverte o pedido e fica marcado para revisão', async () => {
    const o = await mkOrder(); const pid = uid('8'); pay(pid, o.ref, 'approved'); await webhook(pid);
    pay(pid, o.ref, 'partially_refunded'); await webhook(pid);
    assert.equal(await status(o.id), 'PAID');
    const ev = await pool.query(`SELECT processing_error FROM payment_webhook_events WHERE provider_event_id=$1`, [`payment:${pid}:partially_refunded`]);
    assert.equal(ev.rows[0].processing_error, 'PARTIAL_REFUND_MANUAL_REVIEW');
    const ent = await pool.query(`SELECT status FROM query_payment_entitlements WHERE order_id=$1`, [o.id]);
    assert.equal(ent.rows[0].status, 'READY');
  });

  it('conciliação traz o pagamento aprovado de um pedido que ficou pendente e é idempotente', async () => {
    const o = await mkOrder(); const pid = uid('7');
    state.search[o.ref] = [{ id: pid, status: 'approved', external_reference: o.ref, payment_type_id: 'pix', fee_details: [], transaction_details: {} }];
    assert.equal((await sup.call(`/api/admin/payment-orders/${o.id}/reconcile`, { method: 'POST' })).status, 403);
    const r = await fin.call(`/api/admin/payment-orders/${o.id}/reconcile`, { method: 'POST' });
    assert.equal(r.status, 200); assert.equal(r.json.orderStatus, 'PAID'); assert.equal(r.json.payments[0].outcome, 'PAID');
    const again = await fin.call(`/api/admin/payment-orders/${o.id}/reconcile`, { method: 'POST' });
    assert.equal(again.json.payments[0].outcome, 'DUPLICATE');
    assert.equal((await fin.call(`/api/admin/payment-orders/${uid('x')}/reconcile`, { method: 'POST' })).status, 400);
  });

  it('estorno total pela API: exige confirmação e motivo, é idempotente, só reverte quando o webhook chega', async () => {
    const o = await mkOrder(); const pid = uid('6'); pay(pid, o.ref, 'approved'); await webhook(pid);
    const url = `/api/admin/payment-orders/${o.id}/refund`;
    assert.equal((await sup.call(url, { method: 'POST', body: { reason: 'cliente pediu estorno', confirm: true } })).status, 403);
    assert.equal((await fin.call(url, { method: 'POST', body: { reason: 'curto', confirm: true } })).status, 400);
    assert.equal((await fin.call(url, { method: 'POST', body: { reason: 'cliente pediu estorno', confirm: false } })).status, 400);
    const ok = await fin.call(url, { method: 'POST', body: { reason: 'cliente pediu estorno em 24h', confirm: true } });
    assert.equal(ok.status, 202);
    const call = state.calls.filter((c) => c.url.endsWith('/refunds')).at(-1);
    assert.equal(call.headers['x-idempotency-key'], `refund:${ok.json.refundId}`);
    assert.equal(await status(o.id), 'PAID', 'pedido só reverte com a confirmação do provedor');
    assert.equal((await fin.call(url, { method: 'POST', body: { reason: 'cliente pediu estorno em 24h', confirm: true } })).status, 409);
    pay(pid, o.ref, 'refunded'); await webhook(pid);
    assert.equal(await status(o.id), 'REFUNDED');
    assert.equal((await fin.call(url, { method: 'POST', body: { reason: 'cliente pediu estorno em 24h', confirm: true } })).status, 409, 'não estorna pedido já revertido');
  });

  it('estorno recusado pelo provedor fica FAILED e pode ser tentado de novo', async () => {
    const o = await mkOrder(); const pid = uid('5'); pay(pid, o.ref, 'approved'); await webhook(pid);
    const url = `/api/admin/payment-orders/${o.id}/refund`;
    state.refundMode = 'reject';
    const bad = await adm.call(url, { method: 'POST', body: { reason: 'tentativa que será recusada', confirm: true } });
    assert.equal(bad.status, 422); assert.equal(bad.json.error, 'PAYMENT_REFUND_REJECTED');
    assert.equal((await pool.query(`SELECT status FROM payment_refunds WHERE order_id=$1`, [o.id])).rows[0].status, 'FAILED');
    state.refundMode = 'ok';
    assert.equal((await adm.call(url, { method: 'POST', body: { reason: 'nova tentativa após recusa', confirm: true } })).status, 202);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY created_at`, [o.id]);
    assert.deepEqual(audit.rows.map((a) => a.action), ['PAYMENT_REFUND_FAILED', 'PAYMENT_REFUND_REQUESTED']);
  });

  it('pedido não pago não pode ser estornado', async () => {
    const o = await mkOrder();
    assert.equal((await adm.call(`/api/admin/payment-orders/${o.id}/refund`, { method: 'POST', body: { reason: 'pedido ainda pendente', confirm: true } })).status, 409);
    assert.equal((await hostRequest(server.base, `/api/admin/payment-orders/${o.id}/refund`, { method: 'POST', host: 'admin.placanamao.test', body: {} })).status, 401);
  });
});
