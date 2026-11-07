import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, describe, it, test } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { defaultSourcesFor } = await import('../dist/lib/dataSourceDefaults.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const total = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
const absent = (id, text) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: text } });

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

test('fonte Veículo Total compra uma consulta só: o pacote inteiro', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/veiculototal': total });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['TOTAL'] });
  assert.deepEqual(f.paid(), ['/veiculototal']);
});

test('Completa em camadas: base + sinistro + nacional + leilão, sem o pacote fechado nem gravame/Renajud pagos', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({
    '/debitosrestricoesproprietarios': sample,
    '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '1' }),
    '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }),
    '/leilaoconjugado': absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.')
  });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'] });
  const paid = f.paid();
  assert.ok(!paid.includes('/veiculototal') && !paid.includes('/gravame') && !paid.includes('/renajud'));
  for (const p of ['/debitosrestricoesproprietarios', '/indiciosinistro', '/veicularbnacionalonline', '/leilaoconjugado']) assert.ok(paid.includes(p), p);
});

test('Premium usa as camadas (base + sinistro + base nacional + leilão), nunca o pacote fechado', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({
    '/debitosrestricoesproprietarios': sample,
    '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }),
    '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }),
    '/leilaoconjugado': absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.')
  });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'PREMIUM' });
  assert.ok(!f.paid().includes('/veiculototal'));
  assert.ok(f.paid().includes('/debitosrestricoesproprietarios') && f.paid().includes('/leilaoconjugado'));
});

test('fontes padrão mostradas no painel: Premium herda as camadas', () => {
  assert.ok(defaultSourcesFor('PREMIUM').includes('AUCTION'));
  assert.ok(defaultSourcesFor('PREMIUM').includes('SINISTRO'));
});

describe('migração 062: Completa e Premium', integration, () => {
  let pool; let server;
  before(async () => { ({ pool } = await loadCore()); server = await startServer({}); });
  after(async () => { await server.stop(); await pool.end(); });

  it('Completa a R$ 32,99 com Veículo Total; Premium acima; Básica intacta', async () => {
    const rows = (await pool.query(`SELECT id,name,price_cents,credit_cost,active,featured,commercial_status,data_sources,report_sections FROM query_products WHERE id IN ('COMPLETE','PREMIUM','BASIC')`)).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(by.COMPLETE.name, 'Consulta Completa');
    assert.equal(by.COMPLETE.price_cents, 3299);
    assert.equal(by.COMPLETE.credit_cost, 33);
    assert.deepEqual(by.COMPLETE.data_sources, ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'], 'Completa montada em camadas (063)');
    assert.ok(by.COMPLETE.report_sections.includes('HISTORICO') && by.COMPLETE.report_sections.includes('FIPE'));
    assert.equal(by.PREMIUM.name, 'Consulta Premium');
    assert.equal(by.PREMIUM.active, true);
    assert.ok(by.PREMIUM.price_cents > by.COMPLETE.price_cents);
    assert.deepEqual(by.PREMIUM.data_sources, ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'GRAVAME', 'RENAJUD', 'OWNERS'], 'Premium: camadas + gravame, Renajud e proprietários fixos');
    assert.equal(by.BASIC.active, true, 'Básica segue ativa para a API e links antigos');
    const hist = await pool.query(`SELECT product_id FROM product_price_history WHERE reason LIKE 'Nova Consulta%'`);
    assert.deepEqual(hist.rows.map((r) => r.product_id).sort(), ['COMPLETE', 'PREMIUM']);
  });

  it('vitrine pública: Completa e Premium aparecem, com leilão incluso e Premium com gravame/Renajud detalhados', async () => {
    const res = await fetch(`${server.base}/api/catalog`);
    assert.equal(res.status, 200);
    const cat = await res.json();
    const ids = cat.products.map((p) => p.id);
    assert.ok(ids.includes('COMPLETE') && ids.includes('PREMIUM'));
    const feat = (key) => cat.features.find((f) => f.key === key)?.id;
    const complete = cat.products.find((p) => p.id === 'COMPLETE');
    const premium = cat.products.find((p) => p.id === 'PREMIUM');
    assert.equal(complete.matrix[feat('leilao')], 'INCLUDED');
    assert.equal(complete.matrix[feat('renajud')], 'NOT_INCLUDED');
    assert.equal(premium.matrix[feat('renajud')], 'INCLUDED');
    assert.equal(premium.matrix[feat('gravame-detalhado')], 'INCLUDED');
    assert.equal(complete.priceCents, 3299);
    // A vitrine só promete o que o modo em camadas entrega: nada de histórico de proprietários.
    assert.doesNotMatch(JSON.stringify([complete.description, complete.longDescription, complete.features, complete.coverage]), /propriet/i);
    assert.match(JSON.stringify(premium.features), /propriet/i);
    assert.equal(complete.matrix[feat('proprietarios')], 'NOT_INCLUDED');
    assert.equal(premium.matrix[feat('proprietarios')], 'INCLUDED');
    const details = await (await fetch(`${server.base}/api/catalog/details`)).json();
    for (const id of ['COMPLETE', 'PREMIUM']) {
      const items = details.products.find((p) => p.id === id).sections.flatMap((s) => s.items);
      assert.equal(items.includes('Histórico de proprietários'), id === 'PREMIUM', `${id}: histórico de proprietários só na Premium`);
      assert.ok(items.includes('Indício de sinistro') && items.includes('Participação em leilão'), `${id}: modelo com sinistro e leilão`);
    }
  });
});

test('registro de leilão, roubo/furto e recall: o relatório diz o que foi encontrado, nunca "Sucesso"', async () => {
  const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
  const leilao = ok('448', { LEILAOCONJUGADO: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { LOTE: '12', PLACA: 'NWM3031', CONDICAOGERALDOVEICULO: 'SUCATA', PATIO: 'SP', LEILOEIRO: 'LEILOES BRASIL', DATALEILAO: '30/10/2013', COMITENTE: 'BANCO X' } } });
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '1' }), '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }), '/leilaoconjugado': leilao });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'] });
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('VT_LEILAO').state, 'ALERT');
  assert.equal(items.get('VT_LEILAO').display, 'Consta passagem por leilão');
  assert.equal(items.get('VT_LEILAO_DETALHES').table.rows.length, 1);
  assert.equal(items.get('VT_SINISTRO').display, 'Há indício de sinistro');
});

test('Premium com fonte de proprietários compra a consulta própria e entrega a linha do tempo', async () => {
  const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
  const owners = JSON.parse(JSON.stringify(total.RESPOSTA.HISTORICOPROPRIETARIO));
  resetCredifyTokenCache();
  const f = fakeFetch({
    '/debitosrestricoesproprietarios': sample,
    '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }),
    '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }),
    '/leilaoconjugado': absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.'),
    '/historicoproprietario': ok('458', { HISTORICOPROPRIETARIO: owners })
  });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'PREMIUM', sources: ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'OWNERS'] });
  assert.ok(f.paid().includes('/historicoproprietario'));
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.ok(Number(items.get('VT_PROPRIETARIOS_QTD').value) >= 1, 'quantidade de proprietários');
  assert.match(String(items.get('VT_PROPRIETARIOS_HISTORICO').value), /atual/);
  // Sem a fonte, a consulta própria não é comprada.
  resetCredifyTokenCache();
  const g = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' }), '/veicularbnacionalonline': ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000' }), '/leilaoconjugado': absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.') });
  await new CredifyVehicleProvider(opts(g)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION'] });
  assert.ok(!g.paid().includes('/historicoproprietario'));
});
