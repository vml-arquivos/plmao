import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

const register = async (server, pool, balance = 20000) => {
  const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente API', email: `${uid('api')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
  await pool.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [reg.json.user.id, balance]);
  return { token: reg.json.token, id: reg.json.user.id };
};

describe('API pública v1: chaves, autenticação, cobrança e revogação', integration, () => {
  let pool; let off; let on;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    off = await startServer();
    on = await startServer({ PUBLIC_API_ENABLED: 'true' });
  });
  after(async () => { await off.stop(); await on.stop(); await pool.end(); });

  it('desligada por padrão: rotas não existem', async () => {
    const c = await register(off, pool);
    assert.equal((await hostRequest(off.base, '/api/account/api-keys', { token: c.token })).status, 404);
    assert.equal((await hostRequest(off.base, '/api/v1/balance')).status, 404);
  });

  it('cria chave (exibida uma vez), consulta por chave, cobra o saldo e registra origem API', async () => {
    const c = await register(on, pool);
    const created = await hostRequest(on.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: 'ERP loja' } });
    assert.equal(created.status, 201);
    const key = created.json.key;
    assert.match(key, /^pnm_live_/);
    const row = (await pool.query('SELECT key_hash,key_prefix FROM api_keys WHERE user_id=$1', [c.id])).rows[0];
    assert.notEqual(row.key_hash, key); assert.ok(!JSON.stringify(row).includes(key.slice(12)));
    const list = await hostRequest(on.base, '/api/account/api-keys', { token: c.token });
    assert.equal(list.json.length, 1); assert.equal(list.json[0].key, undefined);

    const bal = await hostRequest(on.base, '/api/v1/balance', { token: key });
    assert.equal(bal.status, 200); assert.equal(bal.json.balanceCents, 20000);
    const prods = await hostRequest(on.base, '/api/v1/products', { token: key });
    assert.ok(prods.json.data.some((p) => p.id === 'COMPLETE'));

    const q = await hostRequest(on.base, '/api/v1/vehicles', { method: 'POST', token: key, body: { plate: 'DEV1B11', product: 'COMPLETE' } });
    assert.equal(q.status, 201, q.text);
    assert.equal(q.json.object, 'vehicle_query');
    assert.ok(q.json.result.v2); assert.equal(q.json.result.owner, undefined);
    assert.ok(!q.text.includes('PROPRIETARIO FICTICIO'));
    const src = (await pool.query('SELECT source,price_cents FROM vehicle_queries WHERE id=$1', [q.json.id])).rows[0];
    assert.equal(src.source, 'API');
    assert.equal((await hostRequest(on.base, '/api/v1/balance', { token: key })).json.balanceCents, 20000 - Number(src.price_cents));
    const get = await hostRequest(on.base, `/api/v1/vehicles/${q.json.id}`, { token: key });
    assert.equal(get.status, 200);
  });

  it('chave inválida, revogada ou de equipe é recusada; idempotência evita cobrança dupla', async () => {
    const c = await register(on, pool);
    const { json } = await hostRequest(on.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: 'k1' } });
    assert.equal((await hostRequest(on.base, '/api/v1/balance', { token: 'pnm_live_invalida_invalida_invalida' })).status, 401);
    assert.equal((await hostRequest(on.base, '/api/v1/balance', { token: c.token })).status, 401); // JWT não vale como chave
    const body = { plate: 'TST0A00', product: 'BASIC' };
    const headers = { 'x-api-key': json.key };
    const call = (extra = {}) => fetch(`${on.base}/api/v1/vehicles`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers, ...extra }, body: JSON.stringify(body) });
    const a = await call({ 'idempotency-key': 'idem-key-123456789' });
    const b = await call({ 'idempotency-key': 'idem-key-123456789' });
    assert.equal(a.status, 201); assert.equal(b.status, 200);
    const n = (await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE user_id=$1 AND status='SUCCESS'`, [c.id])).rows[0].n;
    assert.equal(n, 1);
    await hostRequest(on.base, `/api/account/api-keys/${json.id}`, { method: 'DELETE', token: c.token });
    assert.equal((await hostRequest(on.base, '/api/v1/balance', { token: json.key })).status, 401);
    // limite de chaves ativas
    for (let i = 0; i < 5; i += 1) assert.equal((await hostRequest(on.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: `k${i}` } })).status, 201);
    assert.equal((await hostRequest(on.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: 'extra' } })).status, 409);
  });

  it('sem saldo: 402 e nada é cobrado', async () => {
    const c = await register(on, pool, 100);
    const { json } = await hostRequest(on.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: 'chave' } });
    assert.ok(json.key, JSON.stringify(json));
    const q = await hostRequest(on.base, '/api/v1/vehicles', { method: 'POST', token: json.key, body: { plate: 'TST0A00', product: 'COMPLETE' } });
    assert.equal(q.status, 402);
  });
});
