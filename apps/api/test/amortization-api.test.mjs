import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('simulador: parcelas decrescentes pela API e perguntas e respostas', integration, () => {
  let pool; let server; let token;
  const pub = (path, opts = {}) => hostRequest(server.base, path, opts);
  const body = (patch = {}) => ({ modality: 'BOTH', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 9_000_000, downPaymentCents: 2_000_000, months: 48, residualPct: 20, ...patch });

  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({});
    token = (await pub('/api/auth/register', { method: 'POST', body: { name: 'Carla Dias', email: `${uid('am')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } })).json.token;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('padrão é parcela fixa; SAC devolve primeira maior e última menor nas duas modalidades', async () => {
    const fixed = await pub('/api/simulator/calculate', { method: 'POST', body: body() });
    assert.equal(fixed.status, 200);
    for (const k of ['cdc', 'leasing']) {
      const r = fixed.json.results[k];
      assert.equal(r.amortization, 'PRICE');
      assert.equal(r.firstInstallmentCents, r.lastInstallmentCents);
    }
    const sac = await pub('/api/simulator/calculate', { method: 'POST', body: body({ amortization: 'SAC' }) });
    assert.equal(sac.status, 200);
    for (const k of ['cdc', 'leasing']) {
      const r = sac.json.results[k];
      assert.equal(r.amortization, 'SAC');
      assert.ok(r.firstInstallmentCents > fixed.json.results[k].installmentCents);
      assert.ok(r.lastInstallmentCents < r.firstInstallmentCents);
      assert.equal(r.installmentCents, r.firstInstallmentCents);
    }
    assert.equal((await pub('/api/simulator/calculate', { method: 'POST', body: body({ amortization: 'XYZ' }) })).status, 400);
  });

  it('PDF com parcelas decrescentes é gerado', async () => {
    const res = await server.request('/api/simulator/pdf', { method: 'POST', token, body: body({ amortization: 'SAC' }) });
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });

  it('perguntas e respostas sobre CDC x leasing estão no FAQ público, sem duplicar', async () => {
    const r = await pub('/api/faqs');
    const list = (r.json.faqs ?? []).filter((f) => f.category === 'Financiamento');
    assert.equal(list.length, 7);
    assert.ok(list.some((f) => /atrasar/i.test(f.question) && /busca e apreensão/i.test(f.answer)));
    assert.equal(new Set(list.map((f) => f.question)).size, 7);
  });
});
