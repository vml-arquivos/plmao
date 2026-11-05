import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

// Valores de custo e teto abaixo são fictícios, só para provar a regra.
useTestEnv({ CREDIFY_FAROL_QUERY_ID: '517', CREDIFY_COST_BUDGET_CENTS: '1000', CREDIFY_COST_CENTS: '{"/debitosrestricoesproprietarios":200,"/indiciosinistro":100,"/leilaoconjugado":900}' });
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { parseFarol } = await import('../dist/report/layers.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const farol = (parecer, semaforo) => ({ CONSULTA: consulta('517'), RESPOSTA: { CODIGO: '1', FAROLLEILAO: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { PARECERTECNICO: parecer, SEMAFORO: semaforo } } } });
const SINISTRO = { CONSULTA: consulta('450'), RESPOSTA: { CODIGO: '1', DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' } };
const NACIONAL = { CONSULTA: consulta('369'), RESPOSTA: { CODIGO: '1', DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', MARCA: 'VW', MODELO: 'GOL' } };
const LEILAO = { CONSULTA: consulta('448'), RESPOSTA: { CODIGO: '1', DESCRICAORETORNO: 'SUCESSO', IDLEILAO: '77', LOTE: '12', LEILOEIRO: 'LEILOES BRASIL', DATALEILAO: '2013-10-30', COMITENTE: 'NAO INFORMADO', CONDICAOGERALDOVEICULO: 'NAO INFORMADO' } };

function fakeFetch(routes) {
  const calls = [];
  const bodies = {};
  const fn = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (init?.body) bodies[path] = String(init.body);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    return new Response(JSON.stringify(h), { status: 200 });
  };
  fn.paid = () => calls.filter((c) => c !== '/auth');
  fn.bodies = bodies;
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });
const items = (out) => new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));

test('Farol: lê parecer e semáforo, aninhado ou na raiz', () => {
  assert.equal(parseFarol({ FAROLLEILAO: { REGISTRO_1: { PARECERTECNICO: '1', SEMAFORO: 'VERDE' } } }).level, 'GREEN');
  assert.equal(parseFarol({ PARECERTECNICO: '2', SEMAFORO: 'AMARELO' }).level, 'YELLOW');
  assert.equal(parseFarol({ SEMAFORO: 'Vermelho' }).level, 'RED');
  assert.equal(parseFarol({ FAROLLEILAO: {} }), undefined);
});

test('Farol verde: o leilão conjugado não é chamado e o relatório mostra leilão sem restrição', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': SINISTRO, '/veicularbnacionalonline': NACIONAL, '/farolleilao': farol('1', 'VERDE') });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(f.paid().includes('/farolleilao') && !f.paid().includes('/leilaoconjugado'));
  assert.equal(JSON.parse(f.bodies['/farolleilao']).Consulta.IdConsulta, '517');
  const it = items(out);
  assert.equal(it.get('VT_LEILAO').state, 'CLEAR');
  assert.match(it.get('VT_LEILAO').display, /Farol verde/);
});

test('Farol amarelo sem folga no teto de custo: não compra o detalhe e avisa que ele não foi incluído', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': SINISTRO, '/veicularbnacionalonline': NACIONAL, '/farolleilao': farol('2', 'AMARELO'), '/leilaoconjugado': LEILAO });
  // base (200) + sinistro (100) + leilão conjugado (900) passa do teto de 1000: o detalhe não cabe
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(!f.paid().includes('/leilaoconjugado'), 'teto de custo barrou o detalhe');
  const it = items(out);
  assert.equal(it.get('VT_LEILAO').state, 'ALERT');
  assert.match(it.get('VT_LEILAO').display, /Farol de leilão amarelo.*detalhes do leilão não incluídos/);
});
