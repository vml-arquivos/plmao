import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, describe, it, test } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv({ ANYCAR_API_KEY: 'chave-de-teste-anycar' });
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { validateDataSources, sourcesSignature } = await import('../dist/lib/dataSources.js');
const { defaultSourcesFor } = await import('../dist/lib/dataSourceDefaults.js');
const { queryAnycarAuction, toAuctionPiece, upperSnake } = await import('../dist/providers/anycarProvider.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    return new Response(JSON.stringify(h), { status: 200 });
  };
  fn.paid = () => calls.filter((c) => c !== '/auth');
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });

const ANYCAR_COM_LEILAO = { status: true, dados: [{ dataLeilao: '2023-05-10', leiloeiro: 'Leiloeiro Teste', lote: '123', condicao: 'Recuperável', comitente: 'Seguradora X', cidadeUF: 'São Paulo/SP', valorArremate: '18500.00' }] };
const anycarFetch = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('validação das fontes: padrão, desconhecida, conflito de leilão, Veículo Total e só a base', () => {
  assert.deepEqual(validateDataSources(null), { ok: true, sources: null });
  assert.deepEqual(validateDataSources([]), { ok: true, sources: null });
  assert.equal(validateDataSources(['COISA']).ok, false);
  assert.equal(validateDataSources(['AUCTION', 'AUCTION_SIMPLE']).ok, false);
  assert.deepEqual(validateDataSources(['TOTAL', 'RECALL']), { ok: true, sources: ['TOTAL'] });
  assert.deepEqual(validateDataSources(['BASE']), { ok: true, sources: ['BASE'] });
  assert.deepEqual(validateDataSources(['BASE', 'SINISTRO']), { ok: true, sources: ['SINISTRO'] });
  assert.deepEqual(validateDataSources(['sinistro', 'SINISTRO', 'RECALL']), { ok: true, sources: ['SINISTRO', 'RECALL'] });
  assert.equal(sourcesSignature(['RECALL', 'SINISTRO']), 'RECALL+SINISTRO');
  assert.equal(sourcesSignature(null), '');
  assert.ok(defaultSourcesFor('COMPLETE').includes('AUCTION'));
});

test('com fontes escolhidas o produto compra só a base e o que foi marcado', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }) });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'MEU_PRODUTO', sources: ['SINISTRO'] });
  assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/indiciosinistro']);
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_SINISTRO').state, 'CLEAR');
  assert.equal(buildReportV2(out.raw).plate, 'AAA0000');
});

test('escolha "só a base" não chama nenhuma fonte opcional', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['BASE'] });
  assert.deepEqual(f.paid(), ['/debitosrestricoesproprietarios']);
});

test('Veículo Total escolhido: uma compra só, sem as camadas', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/veiculototal': sample });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'MEU_PRODUTO', sources: ['TOTAL'] });
  assert.deepEqual(f.paid(), ['/veiculototal']);
});

test('sem escolha, a Completa segue o padrão de antes (camadas completas)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({
    '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }),
    '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }),
    '/leilaoconjugado': { CONSULTA: consulta('448'), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.' } }
  });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/indiciosinistro', '/leilaoconjugado', '/veicularbnacionalonline']);
});

test('AnyCar: nomes dos campos e leitura de registros de leilão', () => {
  assert.equal(upperSnake('dataLeilao'), 'DATA_LEILAO');
  assert.equal(upperSnake('cidadeUF'), 'CIDADE_UF');
  assert.equal(upperSnake('valorArremate'), 'VALOR_ARREMATE');
  const piece = toAuctionPiece(ANYCAR_COM_LEILAO);
  assert.equal(piece.kind, 'data');
  assert.equal(piece.resposta.REGISTRO_1.LEILOEIRO, 'Leiloeiro Teste');
  assert.equal(toAuctionPiece({ status: true, dados: [] }).kind, 'notFound');
  assert.equal(toAuctionPiece({ status: true, dados: { leiloes: [] } }).kind, 'notFound');
  assert.equal(toAuctionPiece({ status: false, mensagem: 'Nenhum registro de leilão encontrado' }).kind, 'notFound');
  assert.throws(() => toAuctionPiece({ status: false, mensagem: 'erro interno' }), (e) => e.code === 'DATA_PROVIDER_INVALID_RESPONSE');
  assert.throws(() => toAuctionPiece('texto'), (e) => e.code === 'DATA_PROVIDER_INVALID_RESPONSE');
});

test('AnyCar: chamada usa POST /api/consultar com x-api-key e trata recusas', async () => {
  let seen;
  const f = async (url, init) => { seen = { url: String(url), init }; return new Response(JSON.stringify(ANYCAR_COM_LEILAO), { status: 200 }); };
  const piece = await queryAnycarAuction('abc1d23', { fetchImpl: f, apiKey: 'k1', baseUrl: 'https://anycar.test' });
  assert.equal(piece.kind, 'data');
  assert.equal(seen.url, 'https://anycar.test/api/consultar');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['x-api-key'], 'k1');
  assert.deepEqual(JSON.parse(seen.init.body), { tipo: 'veicular-leilao-1', placa: 'ABC1D23' });
  for (const [status, code] of [[401, 'DATA_PROVIDER_AUTH_FAILED'], [402, 'DATA_PROVIDER_QUOTA_EXHAUSTED'], [429, 'DATA_PROVIDER_RATE_LIMITED'], [503, 'DATA_PROVIDER_UNAVAILABLE']]) {
    await assert.rejects(queryAnycarAuction('ABC1D23', { fetchImpl: anycarFetch({}, status), apiKey: 'k1' }), (e) => e.code === code, String(status));
  }
  assert.equal((await queryAnycarAuction('ABC1D23', { fetchImpl: anycarFetch({}, 404), apiKey: 'k1' })).kind, 'notFound');
  await assert.rejects(queryAnycarAuction('ABC1D23', { apiKey: '   ' }), (e) => e.code === 'DATA_PROVIDER_NOT_CONFIGURED');
});

test('leilão simples (AnyCar) entra no relatório no lugar do leilão da Credify, e o leilão da Credify não é comprado', async () => {
  resetCredifyTokenCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = anycarFetch(ANYCAR_COM_LEILAO);
  try {
    const f = fakeFetch({ '/debitosrestricoesproprietarios': sample });
    const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'LEILAO_SIMPLES', sources: ['AUCTION_SIMPLE'] });
    assert.deepEqual(f.paid(), ['/debitosrestricoesproprietarios']);
    const v2 = buildReportV2(out.raw);
    const items = new Map(v2.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
    assert.equal(items.get('VT_LEILAO').state, 'ALERT');
    assert.equal(out.raw.parcial, undefined);
  } finally { globalThis.fetch = realFetch; }
});

test('leilão simples sem registro vira "nada consta"; falha da AnyCar em produto com outras fontes deixa o resultado parcial', async () => {
  resetCredifyTokenCache();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = anycarFetch({ status: true, dados: [] });
    const f1 = fakeFetch({ '/debitosrestricoesproprietarios': sample });
    const limpo = await new CredifyVehicleProvider(opts(f1)).queryByPlate('AAA0000', { productId: 'LEILAO_SIMPLES', sources: ['AUCTION_SIMPLE'] });
    const items = new Map(buildReportV2(limpo.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
    assert.equal(items.get('VT_LEILAO').state, 'CLEAR');

    globalThis.fetch = anycarFetch({}, 503);
    const f2 = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }) });
    const parcial = await new CredifyVehicleProvider(opts(f2)).queryByPlate('AAA0000', { productId: 'X', sources: ['SINISTRO', 'AUCTION_SIMPLE'] });
    assert.equal(parcial.raw.parcial, true);

    const f3 = fakeFetch({ '/debitosrestricoesproprietarios': sample });
    await assert.rejects(new CredifyVehicleProvider(opts(f3)).queryByPlate('AAA0000', { productId: 'LEILAO_SIMPLES', sources: ['AUCTION_SIMPLE'] }), (e) => e.code === 'DATA_PROVIDER_UNAVAILABLE');
  } finally { globalThis.fetch = realFetch; }
});

describe('painel: fontes de dados por produto', integration, () => {
  let pool; let server; let sa; let op;
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', ANYCAR_API_KEY: 'chave-de-teste-anycar' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('lista as fontes, grava a escolha, valida e volta ao padrão', async () => {
    const cat = await sa.call('/api/admin/data-sources');
    assert.equal(cat.status, 200, cat.text);
    assert.ok(cat.json.sources.some((s) => s.key === 'AUCTION_SIMPLE' && s.configured === true));
    assert.ok(Array.isArray(cat.json.defaults.COMPLETE));
    assert.equal((await op.call('/api/admin/data-sources')).status, 403);

    const list = await sa.call('/api/admin/products');
    assert.deepEqual(list.json.find((p) => p.id === 'BASIC').dataSources, ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'GRAVAME', 'RENAJUD', 'FIPE', 'RENAINF', 'OWNER_PLATE'], 'Avançada: Completa + gravame, Renajud e multas (075)');

    const bad = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { dataSources: ['NAO_EXISTE'] } });
    assert.equal(bad.status, 400);
    const conflict = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { dataSources: ['AUCTION', 'AUCTION_SIMPLE'] } });
    assert.equal(conflict.status, 400);

    const set = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { dataSources: ['SINISTRO', 'AUCTION_SIMPLE'] } });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.json.dataSources, ['SINISTRO', 'AUCTION_SIMPLE']);
    const row = await pool.query(`SELECT data_sources FROM query_products WHERE id='BASIC'`);
    assert.deepEqual(row.rows[0].data_sources, ['SINISTRO', 'AUCTION_SIMPLE']);

    const scope = await sa.call('/api/admin/products/BASIC/report-scope');
    assert.equal(scope.status, 200, scope.text);
    assert.ok(scope.json.fieldsOutsideSources.includes('VT_RECALL'));
    assert.ok(!scope.json.fieldsOutsideSources.includes('VT_SINISTRO'));
    assert.ok(!scope.json.fieldsOutsideSources.includes('VT_LEILAO'), 'leilão simples cobre os campos de leilão');

    const reset = await sa.call('/api/admin/products/BASIC', { method: 'PATCH', body: { dataSources: null } });
    assert.equal(reset.status, 200, reset.text);
    assert.equal(reset.json.dataSources, null);
  });
});
