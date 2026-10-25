import assert from 'node:assert/strict';
import http from 'node:http';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

// Mercado Pago simulado: só a busca por referência é usada aqui.
const state = { search: {}, fail: false, calls: 0 };
const stub = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
  if (url.pathname === '/v1/payments/search') { state.calls++; return state.fail ? send(500, {}) : send(200, { results: state.search[url.searchParams.get('external_reference')] ?? [] }); }
  send(404, {});
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;
const MP = { PAYMENT_PROVIDER: 'mercadopago', MP_ACCESS_TOKEN: 'TEST-token-simulado', MP_WEBHOOK_SECRET: 'segredo-webhook-mp-teste-123456', MP_API_BASE_URL: stubUrl };
useTestEnv(MP);
test.after(() => new Promise((r) => stub.close(r)));

describe('conferência de pagamentos sem webhook', integration, () => {
  let server, pool, token, userId, otherToken, productId, sweep;
  const password = 'Senha-Forte-123!';
  const call = (path, { method = 'GET', body, tk } = {}) => server.request(path, { method, body, token: tk }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

  before(async () => {
    ({ pool } = await loadCore());
    ({ sweepOpenOrders: sweep } = await import('../dist/lib/paymentSync.js'));
    server = await startServer(MP);
    const mk = async (tag) => {
      const email = `${uid(tag)}@cliente.local`;
      const r = await call('/api/auth/register', { method: 'POST', body: { name: `Cliente ${tag}`, email, password, acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201);
      return { token: r.json.token, id: (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id };
    };
    const a = await mk('a'); const b = await mk('b');
    token = a.token; userId = a.id; otherToken = b.token;
    productId = `T${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost,provider_cost_cents,price_cents,slug,active) VALUES($1,'Produto','d',1,100,2490,$2,true)`, [productId, productId.toLowerCase()]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  const mkOrder = async (uid_, { status = 'CHECKOUT_ACTIVE', ageMinutes = 10 } = {}) => {
    const ref = `pnm_${uid('o')}`;
    const r = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate,created_at) VALUES($1,$2,2490,0,'mercadopago',$3,'QUERY',$4,'ABC1D23', now() - ($5::int * interval '1 minute')) RETURNING id`, [uid_, status, ref, productId, ageMinutes]);
    return { id: r.rows[0].id, ref };
  };
  const approved = (ref, id) => { state.search[ref] = [{ id, status: 'approved', external_reference: ref, payment_type_id: 'pix', fee_details: [], transaction_details: {} }]; };
  const statusOf = async (id) => (await pool.query('SELECT status FROM payment_orders WHERE id=$1', [id])).rows[0].status;

  it('a pessoa confere os próprios pedidos abertos ao voltar do checkout', async () => {
    const o = await mkOrder(userId); approved(o.ref, uid('9'));
    const r = await call('/api/payments/sync', { method: 'POST', body: {}, tk: token });
    assert.equal(r.status, 200); assert.equal(r.json.paid, 1);
    assert.equal(await statusOf(o.id), 'PAID');
  });

  it('não confere pedido de outra pessoa nem repete a consulta em menos de 3 segundos', async () => {
    const mine = await mkOrder(userId); approved(mine.ref, uid('8'));
    const before = state.calls;
    const second = await call('/api/payments/sync', { method: 'POST', body: {}, tk: token });
    assert.equal(second.json.throttled, true);
    assert.equal(state.calls, before);
    assert.equal(await statusOf(mine.id), 'CHECKOUT_ACTIVE');
    const other = await call('/api/payments/sync', { method: 'POST', body: {}, tk: otherToken });
    assert.equal(other.json.checked, 0);
    assert.equal(await statusOf(mine.id), 'CHECKOUT_ACTIVE');
    assert.equal((await call('/api/payments/sync', { method: 'POST', body: {} })).status, 401);
  });

  it('erro do Mercado Pago volta como falha clara e não altera o pedido', async () => {
    await new Promise((r) => setTimeout(r, 3100));
    const o = await mkOrder(userId); state.fail = true;
    const r = await call('/api/payments/sync', { method: 'POST', body: {}, tk: token });
    state.fail = false;
    assert.equal(r.status, 502);
    assert.equal(await statusOf(o.id), 'CHECKOUT_ACTIVE');
  });

  it('a varredura liquida pedidos abertos há mais de 2 minutos e ignora os recentes e os antigos demais', async () => {
    const old = await mkOrder(userId, { ageMinutes: 10 }); approved(old.ref, uid('7'));
    const fresh = await mkOrder(userId, { ageMinutes: 0 }); approved(fresh.ref, uid('6'));
    const ancient = await mkOrder(userId, { ageMinutes: 60 * 24 * 4 }); approved(ancient.ref, uid('5'));
    const paid = await sweep();
    assert.ok(paid >= 1);
    assert.equal(await statusOf(old.id), 'PAID');
    assert.equal(await statusOf(fresh.id), 'CHECKOUT_ACTIVE');
    assert.equal(await statusOf(ancient.id), 'CHECKOUT_ACTIVE');
  });

  it('varrer duas vezes não duplica o direito de consulta', async () => {
    const o = await mkOrder(userId); approved(o.ref, uid('4'));
    await sweep(); await sweep();
    const ent = await pool.query('SELECT count(*)::int AS n FROM query_payment_entitlements WHERE order_id=$1', [o.id]);
    assert.equal(ent.rows[0].n, 1);
  });
});
