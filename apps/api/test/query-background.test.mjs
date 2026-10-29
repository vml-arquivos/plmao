import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('consulta lenta segue em segundo plano', integration, () => {
  let pool; let server; let token; let userId;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ QUERY_SYNC_WAIT_MS: '300' });
    const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente lento', email: `${uid('slow')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    token = r.json.token; userId = r.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const balance = async () => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [userId])).rows[0].balance_cents);
  const post = (plate) => hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate, productId: 'LIEN', acceptContract: true, acceptPrivacy: true } });

  it('fonte lenta: responde 202 em seguida, cobra uma vez e a consulta conclui sozinha', async () => {
    const before = await balance();
    const t0 = Date.now();
    const r = await post('SLW0E00');
    assert.equal(r.status, 202, r.text); assert.equal(r.json.status, 'PROCESSING'); assert.ok(r.json.id);
    assert.ok(Date.now() - t0 < 1100, 'a tela não fica esperando a fonte');
    const debited = before - await balance(); assert.ok(debited > 0);
    let status = 'PROCESSING';
    for (let i = 0; i < 40 && status === 'PROCESSING'; i += 1) {
      await new Promise((res) => setTimeout(res, 250));
      status = (await hostRequest(server.base, `/api/queries/${r.json.id}`, { token })).json.status;
    }
    assert.equal(status, 'SUCCESS');
    assert.equal(before - await balance(), debited, 'cobrança única');
  });

  it('fonte lenta com falha: a consulta em segundo plano estorna', async () => {
    const before = await balance();
    const r = await post('TIM0E00');
    assert.ok([424, 202].includes(r.status), r.text);
    if (r.status === 202) {
      for (let i = 0; i < 40; i += 1) { await new Promise((res) => setTimeout(res, 250)); if ((await hostRequest(server.base, `/api/queries/${r.json.id}`, { token })).json.status !== 'PROCESSING') break; }
    }
    assert.equal(await balance(), before, 'valor estornado');
  });

  it('aquecer o login: exige entrar na conta e responde 204 sem custo', async () => {
    assert.equal((await hostRequest(server.base, '/api/queries/warm', { method: 'POST', body: {} })).status, 401);
    const ok = await hostRequest(server.base, '/api/queries/warm', { method: 'POST', token, body: {} });
    assert.equal(ok.status, 204);
  });
});
