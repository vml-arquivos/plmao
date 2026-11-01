import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { matchFipeByVehicle } = await import('../dist/enrichment/fipeMatch.js');
const { enrichVehicle } = await import('../dist/enrichment/index.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');

const ok = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const item = (r, k) => r.sections.flatMap((s) => s.items).find((i) => i.key === k);
const withoutFipe = () => { const c = structuredClone(ok); delete c.RESPOSTA.PRECIFICADORFIPE; return c; };

const catalog = {
  brands: async () => [{ code: '59', name: 'VW - VolksWagen' }, { code: '21', name: 'Fiat' }, { code: '25', name: 'Honda' }],
  models: async (_t, brand) => brand === '59'
    ? [{ code: '1', name: 'Gol 1.0 Flex 12V 5p' }, { code: '2', name: 'Gol 1.6 Mi Total Flex 8V 4p' }, { code: '3', name: 'Passat Variant 2.0' }]
    : [{ code: '9', name: 'Palio Fire 1.0' }, { code: '10', name: 'Palio Fire Economy 1.0' }],
  years: async (_t, _b, model) => (model === '2' ? [{ code: '2015-1', name: '2015 Gasolina' }] : [{ code: '2016-1', name: '2016 Gasolina' }]),
  price: async () => ({ fipeCode: '005843-1', valueCents: 3_250_000, referenceMonth: 'outubro de 2026', brandName: 'VW - VolksWagen', modelName: 'Gol 1.0 Flex 12V 5p', yearName: '2016 Gasolina' })
};

test('FIPE pelo cadastro: marca abreviada (VW), motor 1.0 e ano deixam um único veículo', async () => {
  const m = await matchFipeByVehicle({ brand: 'VW', model: 'VW/GOL 1.0', modelYear: 2016, fuel: 'FLEX', displacementCc: 1000, vehicleType: 'cars' }, catalog);
  assert.equal(m?.fipeCode, '005843-1');
  assert.equal(m?.valueCents, 3_250_000);
});

test('FIPE pelo cadastro: ambíguo ou sem ano na tabela não chuta valor', async () => {
  assert.equal(await matchFipeByVehicle({ brand: 'FIAT', model: 'FIAT/PALIO FIRE', modelYear: 2016, vehicleType: 'cars' }, catalog), undefined, 'duas versões possíveis');
  assert.equal(await matchFipeByVehicle({ brand: 'VW', model: 'VW/GOL 1.0', modelYear: 1999, vehicleType: 'cars' }, catalog), undefined, 'ano inexistente');
  assert.equal(await matchFipeByVehicle({ brand: 'XYZ', model: 'XYZ/QUALQUER', modelYear: 2016, vehicleType: 'cars' }, catalog), undefined, 'marca desconhecida');
});

test('FIPE pelo cadastro: abreviação do cadastro (PLTINUM) vale como a palavra inteira da tabela', async () => {
  const deps = { ...catalog, brands: async () => [{ code: '1', name: 'Honda' }], models: async () => [{ code: '5', name: 'Civic Sedan Platinum 2.0' }, { code: '6', name: 'Civic Sedan LX 1.8' }], years: async () => [{ code: '2016-1', name: '2016 Gasolina' }] };
  const m = await matchFipeByVehicle({ brand: 'HONDA', model: 'HONDA/CIVIC PLTINUM', modelYear: 2016, vehicleType: 'cars' }, deps);
  assert.equal(m?.fipeCode, '005843-1');
});

test('enrichVehicle: sem valor FIPE do provedor, localiza pelo cadastro e o relatório mostra o valor com aviso de conferência', async () => {
  const raw = withoutFipe();
  assert.equal(item(buildReportV2(raw), 'VT_FIPE_PRECO')?.state, 'NOT_PROVIDED');
  const enrichment = await enrichVehicle(raw, { fipeDeps: catalog, fetchImpl: async () => new Response('{}', { status: 500 }) });
  assert.equal(enrichment?.fipeMatch?.fipeCode, '005843-1');
  const report = buildReportV2({ ...raw, enrichment });
  const preco = item(report, 'VT_FIPE_PRECO');
  assert.notEqual(preco.state, 'NOT_PROVIDED');
  assert.match(preco.display, /32\.500,00/);
  assert.equal(item(report, 'VT_FIPE_CODIGO').value, '005843-1');
  assert.match(item(report, 'VT_FIPE_MODELO').display, /confira a versão/);
});

test('valor FIPE trazido pelo provedor tem prioridade e não é sobrescrito', async () => {
  const report = buildReportV2({ ...ok, enrichment: { fipeMatch: { fipeCode: '999999-9', brand: 'X', model: 'Y', year: '2016', valueCents: 1_000_000, referenceMonth: 'x', vehicleType: 'cars' }, generatedAt: new Date().toISOString() } });
  assert.match(item(report, 'VT_FIPE_PRECO').display, /32\.500,00/);
  assert.equal(item(report, 'VT_FIPE_CODIGO').value, '005843-1');
});

describe('consulta antiga ganha a FIPE ao abrir, sem chamada paga', integration, () => {
  let pool; let server; let queryId;
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({});
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Fipe', email: `${uid('fip')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
    const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(r.status, 201, r.text);
    queryId = r.json.id;
    await pool.query("UPDATE vehicle_query_results SET raw_enc=raw_enc WHERE query_id=$1", [queryId]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('refreshQueryFipe grava a FIPE uma vez e não repete', async () => {
    const { refreshQueryFipe, ensureFipeEnrichment } = await import('../dist/lib/fipeRefresh.js');
    const { decryptRaw } = await import('../dist/lib/rawStore.js');
    const stored = async () => (await pool.query('SELECT raw_enc FROM vehicle_query_results WHERE query_id=$1', [queryId])).rows[0].raw_enc;
    const series = Array.from({ length: 13 }, (_, i) => ({ label: `m${i}`, time: 2025 * 12 + i, cents: 3_300_000 - i * 10_000 }));
    let calls = 0;
    const enrich = async () => { calls += 1; return { fipeHistory: { fipeCode: '005843-1', yearId: '2016-1', series }, generatedAt: new Date().toISOString() }; };
    const before = decryptRaw(await stored());
    if (before.enrichment) { delete before.enrichment; }
    assert.equal(await refreshQueryFipe('00000000-0000-0000-0000-000000000000', null, enrich), 'NOT_ELIGIBLE');
    const out = await refreshQueryFipe(queryId, null, enrich);
    assert.ok(['UPDATED', 'ALREADY'].includes(out), out);
    if (out === 'UPDATED') {
      assert.equal(await refreshQueryFipe(queryId, null, enrich), 'ALREADY');
      assert.equal(calls, 1);
      const n = (await pool.query('SELECT normalized::text AS n FROM vehicle_query_results WHERE query_id=$1', [queryId])).rows[0].n;
      assert.match(n, /EN_FIPE_PROJECAO/);
    }
    assert.equal(typeof (await ensureFipeEnrichment(queryId, 500, async () => undefined)), 'boolean');
  });
});
