import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('consulta repetida enquanto a anterior processa', integration, () => {
  let pool; let server; let token; let userId;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ QUERY_SYNC_WAIT_MS: '300' });
    const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente repetido', email: `${uid('dup')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = r.json.token; userId = r.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const balance = async () => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
  const post = (plate, key) => hostRequest(server.base, '/api/queries', { method: 'POST', token, headers: key ? { 'idempotency-key': key } : undefined, body: { plate, productId: 'LIEN', acceptContract: true, acceptPrivacy: true } });

  it('segunda consulta da mesma placa durante o processamento dá 409 e não cobra de novo', async () => {
    const before = await balance();
    const first = await post('SLW0E00');
    assert.equal(first.status, 202, first.text);
    const debited = before - await balance();
    assert.ok(debited > 0);
    const again = await post('SLW0E00');
    assert.equal(again.status, 409, again.text);
    assert.equal(again.json.error, 'QUERY_IN_PROGRESS');
    const otherKey = await post('SLW0E00', uid('k'));
    assert.equal(otherKey.status, 409, otherKey.text);
    assert.equal(before - await balance(), debited, 'cobrou uma única vez');
    const count = await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE user_id=$1 AND plate='SLW0E00'`, [userId]);
    assert.equal(count.rows[0].n, 1);
    let status = 'PROCESSING';
    for (let i = 0; i < 40 && status === 'PROCESSING'; i += 1) {
      await new Promise((res) => setTimeout(res, 250));
      status = (await hostRequest(server.base, `/api/queries/${first.json.id}`, { token })).json.status;
    }
    assert.equal(status, 'SUCCESS');
  });
});
