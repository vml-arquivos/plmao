import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { isVehicleTotal } = await import('../dist/report/vehicleTotal.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
const absent = (id, text) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: text } });

/** Resposta por caminho; registra cada chamada. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    if (h.status && h.status >= 400) return new Response('{}', { status: h.status });
    return new Response(JSON.stringify(h.body ?? h), { status: 200 });
  };
  fn.calls = calls;
  fn.paid = () => calls.filter((c) => c !== '/auth');
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });
const withFlags = (flags) => { const c = structuredClone(sample); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, flags); return c; };

const SINISTRO_LIMPO = ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' });
const SINISTRO_ALERTA = ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '1' });
const NACIONAL = ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', MARCA: 'VW', MODELO: 'GOL', RESTRICAO1: 'SEM RESTRICAO', RESTRICAO2: 'SEM RESTRICAO', SITUACAO_CHASSI: 'NORMAL', ULTIMA_ATUALIZACAO: '07/06/2026' });
const LEILAO_NADA = absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.');

test('Completa em camadas: placa limpa chama só base, sinistro, cadastro nacional e leilão (sem recall nem roubo/furto)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/indiciosinistro', '/leilaoconjugado', '/veicularbnacionalonline']);
  assert.ok(isVehicleTotal(out.raw.data), 'mesmo formato do Veículo Total');
  assert.ok(!f.paid().includes('/veiculototal'));
  const v2 = buildReportV2(out.raw);
  const items = new Map(v2.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_SINISTRO').state, 'CLEAR');
  assert.equal(items.get('VT_LEILAO').state, 'CLEAR');
  assert.equal(items.get('VT_ROUBOFURTO').state, 'CLEAR');
  assert.match(items.get('VT_ROUBOFURTO').display, /no cadastro/);
  assert.equal(items.get('VT_RECALL').state, 'CLEAR');
  assert.equal(items.get('VN_SITUACAO_CHASSI').state, 'CLEAR');
  assert.equal(v2.plate, 'AAA0000');
});

test('marcador do cadastro acusando recall e roubo/furto: só então consulta os detalhes', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({
    '/debitosrestricoesproprietarios': withFlags({ RECALL: 'POSSUI RECALL', RESFURTO: 'CONSTA OCORRENCIA' }),
    '/indiciosinistro': SINISTRO_ALERTA, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA,
    '/recall': ok('452', { DESCRICAORETORNO: 'SUCESSO', MONTADORA: 'VW', DATAINICIOCAMPANHA: '2020-08-03' }),
    '/historicoroubofurto': ok('456', { DESCRICAORETORNO: 'SUCESSO', OCORRENCIA: 'FURTO', UF_DUT: 'DF' })
  });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(f.paid().includes('/recall') && f.paid().includes('/historicoroubofurto'));
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_SINISTRO').state, 'ALERT');
  assert.equal(items.get('VT_ROUBOFURTO').state, 'ALERT');
  assert.equal(items.get('VT_RECALL').state, 'ALERT');
});

test('extra que falha não derruba o relatório: vira "não consultado", nunca "nada consta"', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': { status: 500 }, '/veicularbnacionalonline': { status: 500 }, '/leilaoconjugado': { status: 500 } });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_SINISTRO').state, 'NOT_PROVIDED');
  assert.equal(items.get('VT_LEILAO').state, 'NOT_PROVIDED');
});

test('placa que a base principal não encontra falha como na Básica (sem gastar nas outras consultas)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': { status: 404 } });
  await assert.rejects(() => new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' }), (e) => e.code === 'NOT_FOUND');
  assert.deepEqual(f.paid(), ['/debitosrestricoesproprietarios']);
});

test('Completa com fonte Veículo Total compra o pacote inteiro e a Básica fica na consulta base', async () => {
  resetCredifyTokenCache();
  const vt = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
  const fp = fakeFetch({ '/veiculototal': vt });
  await new CredifyVehicleProvider(opts(fp)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['TOTAL'] });
  assert.deepEqual(fp.paid(), ['/veiculototal']);
  const fb = fakeFetch({ '/debitosrestricoesproprietarios': sample });
  await new CredifyVehicleProvider(opts(fb)).queryByPlate('AAA0000', { productId: 'BASIC' });
  assert.deepEqual(fb.paid(), ['/debitosrestricoesproprietarios']);
});

const ALIENADO = { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: [], NUMEROCONTRATOFINANCEIRA: [], RESTRICAODATAINCLUSAO: [], CGCFINANCEIRA: [] };
const GRAVAME = ok('533', { GRAVAME: { PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', GRAVAMES: { REGISTRO_1: { NUMERO_RESTRICAO: '123456', DATA_RESTRICAO: '2023-03-15', ESTADO_RESTRICAO: 'SP', STATUS: 'ATIVO', NOME_AGENTE: 'BANCO ITAU S.A.', DOCUMENTO_AGENTE: '60701190000104', NUMERO_CONTRATO: 'CT-998877' } } } });

test('Completa em camadas traz o gravame completo (banco, CNPJ, contrato) quando há alienação', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': withFlags(ALIENADO), '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/gravame': GRAVAME });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(f.paid().includes('/gravame'));
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('RESTRICAOFINAN').state, 'ALERT');
  assert.equal(items.get('RESTRICAONOMEAGENTE').value, 'BANCO ITAU S.A.');
  assert.equal(items.get('NUMEROCONTRATOFINANCEIRA').value, 'CT-998877');
});

test('sem alienação, o gravame não gera chamada extra e o relatório diz que não há gravame', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(!f.paid().includes('/gravame'));
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('RESTRICAOFINAN').state, 'CLEAR');
});

test('resposta com os campos dentro do bloco de mesmo nome (formato da documentação) é lida igual à direta', async () => {
  resetCredifyTokenCache();
  const aninhado = { CONSULTA: consulta('450'), RESPOSTA: { CODIGO: '1', INDICIOSINISTROVEICULAR: { DESCRICAORETORNO: 'SUCESSO', INDICIODESINISTRO: '1' } } };
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': aninhado, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_SINISTRO').state, 'ALERT');
});

test('Completa com as fontes do painel (sem gravame marcado) ainda mostra a alienação do cadastro, sem chamada extra', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': withFlags(ALIENADO), '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/gravame': GRAVAME });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'] });
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.ok(!f.paid().includes('/gravame'), 'sem gravame marcado, não compra a consulta de gravame');
  assert.equal(items.get('RESTRICAOFINAN').state, 'ALERT');
  assert.match(String(items.get('GR_SITUACAO').value), /alienação|gravame/i);
});
