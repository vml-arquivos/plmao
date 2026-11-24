import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';
import { SCENARIOS, jwt } from './fixtures/credify-respostas.mjs';

useTestEnv();

describe('Cadastral grátis desligada', integration, () => {
  let pool; let app; let credify;
  before(async () => {
    ({ pool } = await loadCore());
    credify = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(req.url === '/auth' ? { Success: true, Dados: jwt() } : SCENARIOS['placa limpa'][req.url] ?? {})); }); });
    await new Promise((r) => credify.listen(0, '127.0.0.1', r));
    app = await startServer({
      DATA_PROVIDER: 'real', VEHICLE_API_PROVIDER: 'credify', CREDIFY_BASE_URL: `http://127.0.0.1:${credify.address().port}`, CREDIFY_CLIENT_ID: 'cid', CREDIFY_CLIENT_SECRET: 'sec',
      ENRICH_FIPE_HISTORY: 'false', PLATE_CACHE_HOURS: '0', PAYMENT_PROVIDER: 'disabled', FEATURE_FREE_CADASTRAL: 'false',
      FIPE_PRIMARY_BASE_URL: 'http://127.0.0.1:9', FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9'
    });
  });
  after(async () => { await app?.stop(); credify?.close(); await pool?.end(); });

  it('com a chave desligada ninguém ganha consulta grátis e a Cadastral custa o preço normal', async () => {
    const email = `${uid('off')}@cliente.local`;
    const r = await hostRequest(app.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Off', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const token = r.json.token;
    assert.equal((await hostRequest(app.base, '/api/fipe/status')).json.freeCadastral, false, 'sem a chave, o site não anuncia a Cadastral grátis');
    assert.equal((await hostRequest(app.base, '/api/me', { token })).json.freeCadastralAvailable, false);
    const q = await hostRequest(app.base, '/api/queries', { method: 'POST', token, headers: { 'Idempotency-Key': `off-${uid('k')}-0001` }, body: { searchType: 'PLATE', searchValue: 'AAA0000', productId: 'CADASTRAL' } });
    assert.equal(q.status, 402, q.text);
  });
});
