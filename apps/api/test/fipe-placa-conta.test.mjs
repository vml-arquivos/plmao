import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

/** FIPE grátis: pela placa só com conta; por marca, modelo e ano segue aberta; PDF e impressão seguem exigindo conta. */
describe('FIPE pela placa exige conta', integration, () => {
  let pool; let server;
  before(async () => { useTestEnv(); ({ pool } = await loadCore()); server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', FEATURE_FREE_FIPE: 'true' }); });
  after(async () => { await server.stop(); await pool.end(); });
  const quote = (body, token) => hostRequest(server.base, '/api/fipe/quote', { method: 'POST', body, token });

  it('visitante sem conta: placa é recusada antes de gastar cota ou consultar fonte', async () => {
    const before = (await pool.query(`SELECT coalesce(sum(count),0)::int n FROM fipe_usage`)).rows[0].n;
    for (const plate of ['ABC1D23', 'abc-1d23', 'DEV1B11']) {
      const r = await quote({ plate });
      assert.equal(r.status, 401, r.text);
      assert.equal(r.json.code ?? r.json.error, 'FIPE_PLATE_LOGIN_REQUIRED');
      assert.match(r.json.message ?? '', /conta/);
    }
    const after = (await pool.query(`SELECT coalesce(sum(count),0)::int n FROM fipe_usage`)).rows[0].n;
    assert.equal(after, before, 'nenhuma cota consumida');
    // placa junto com marca/modelo também não vale sem conta (a placa é o que abre os dados do veículo)
    const mixed = await quote({ plate: 'ABC1D23', vehicleType: 'cars', brand: { code: '1', name: 'X' }, model: { code: '1', name: 'Y' }, year: { code: '2020-1', name: '2020' } });
    assert.equal(mixed.status, 401);
  });

  it('visitante sem conta: marca, modelo e ano não pedem login', async () => {
    const r = await quote({ vehicleType: 'cars', brand: { code: '59', name: 'VW' }, model: { code: '5940', name: 'Gol' }, year: { code: '2020-1', name: '2020 Gasolina' } });
    assert.notEqual(r.status, 401, r.text);
    assert.notEqual(r.json?.code, 'FIPE_PLATE_LOGIN_REQUIRED');
  });

  it('placa inválida continua dando erro de placa e PDF/impressão exigem conta', async () => {
    assert.equal((await quote({ plate: '123' })).json.error ?? '', 'INVALID_PLATE');
    for (const p of ['/api/fipe/reports/ABCDEF12/pdf', '/api/fipe/reports/ABCDEF12/print']) assert.equal((await hostRequest(server.base, p)).status, 401);
    assert.equal((await hostRequest(server.base, '/api/fipe/quotes/ABCDEF12/save', { method: 'POST', body: {} })).status, 401);
  });

  it('com conta, a placa passa do portão (o resultado depende da fonte, mas nunca é o bloqueio de login)', async () => {
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Com Conta', email: `${uid('fp')}@c.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const r = await quote({ plate: 'DEV1B11' }, reg.json.token);
    assert.notEqual(r.json?.code, 'FIPE_PLATE_LOGIN_REQUIRED', r.text);
  });
});
