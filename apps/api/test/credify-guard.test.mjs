import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache, credifyBudgetUsage } = await import('../dist/providers/credifyProvider.js');
const { describeShape } = await import('../dist/report/vehicleTotal.js');

const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const h = handlers.shift();
    if (!h) throw new Error('chamada inesperada');
    if (h instanceof Error) throw h;
    return new Response(JSON.stringify(h.body ?? {}), { status: h.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const login = () => ({ body: { Success: true, Dados: jwt() } });
const base = { baseUrl: 'https://api.credify.test', clientId: 'cid-teste', clientSecret: 'segredo-teste', path: '/veiculototal', method: 'post', bodyTemplate: '{"placa":"{{plate}}"}', timeoutMs: 2000 };
const paid = (f) => f.calls.filter((c) => !c.url.endsWith('/auth')).length;

test('teto de segurança: ao atingir o limite a Credify nem é chamada', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([login(), { status: 404 }, { status: 404 }, { status: 404 }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, maxPerHour: 2, maxPerDay: 0 });
  await assert.rejects(p.queryByPlate('AAA0000'), { code: 'NOT_FOUND' });
  await assert.rejects(p.queryByPlate('AAA0000'), { code: 'NOT_FOUND' });
  await assert.rejects(p.queryByPlate('AAA0000'), (e) => e.code === 'PROVIDER_BUDGET_EXCEEDED' && /máximo 2/.test(e.detail));
  assert.equal(paid(f), 2, 'a terceira consulta não saiu');
  assert.equal(credifyBudgetUsage().lastHour, 2);
  resetCredifyTokenCache();
  assert.equal(credifyBudgetUsage().lastHour, 0);
});

test('erro 5xx e tempo esgotado da consulta paga não são repetidos automaticamente', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([login(), { status: 500 }]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f, maxPerHour: 0, maxPerDay: 0 }).queryByPlate('AAA0000'), { code: 'DATA_PROVIDER_UNAVAILABLE' });
  assert.equal(paid(f), 1);
  resetCredifyTokenCache();
  const g = fakeFetch([login(), new Error('timeout')]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: g, maxPerHour: 0, maxPerDay: 0 }).queryByPlate('AAA0000'), { code: 'PROVIDER_TIMEOUT' });
  assert.equal(paid(g), 1);
});

const vt = (codesVec, bdrp) => ({
  CONSULTA: { IDCONSULTA: 467 },
  RESPOSTA: {
    CODIGO: codesVec,
    VEICULARBNACIONAL: { DESCRICAORETORNO: 'SUCESSO', RETORNO: { PROPRIETARIO: 'FULANO DE TAL SECRETO', CPF: '12345678909' } },
    VEICULOSBDRP: { DESCRICAORETORNO: bdrp, RETORNO: { PLACA: 'AAA0000', NOME: 'FULANO DE TAL SECRETO' } }
  }
});

test('describeShape mostra blocos, códigos e descrição curta, sem nenhum dado de pessoa', () => {
  const shape = describeShape(vt(['2', '2', '2', '2', '2', '1', '2', '3'], 'PLACA NAO LOCALIZADA NA BASE'));
  assert.match(shape, /BASE_NACIONAL=1/);
  assert.match(shape, /BDRP=3 "PLACA NAO LOCALIZADA NA BASE"/);
  for (const secret of ['FULANO', 'SECRETO', '12345678909', 'AAA0000']) assert.ok(!shape.includes(secret), `vazou ${secret}`);
  assert.ok(shape.length <= 380);
  assert.match(describeShape({ Message: 'x' }), /sem bloco RESPOSTA/);
  assert.match(describeShape('texto'), /sem bloco RESPOSTA/);
});

test('resposta recusada pelo sistema traz a estrutura no detalhe do erro (para diagnosticar sem refazer a consulta)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([login(), { body: vt(['2', '2', '2', '2', '2', '1', '2', '3'], 'ERRO NA BASE') }]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f, maxPerHour: 0, maxPerDay: 0 }).queryByPlate('AAA0000'), (e) => {
    assert.equal(e.code, 'DATA_PROVIDER_INVALID_RESPONSE');
    assert.match(e.detail, /Estrutura:/);
    assert.ok(!e.detail.includes('FULANO'));
    assert.ok(!e.detail.includes('segredo-teste'));
    return true;
  });
  resetCredifyTokenCache();
});
