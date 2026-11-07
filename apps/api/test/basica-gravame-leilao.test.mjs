import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, after, describe, it, test } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');

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
const withFlags = (flags) => { const c = structuredClone(sample); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, flags); return c; };
const LIMPO = { RESTRICAOFINAN: 'NADA CONSTA', RESTRICAONOMEAGENTE: [], NUMEROCONTRATOFINANCEIRA: [], RESTRICAODATAINCLUSAO: [], CGCFINANCEIRA: [] };
const ALIENADO = { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: [], NUMEROCONTRATOFINANCEIRA: [], RESTRICAODATAINCLUSAO: [], CGCFINANCEIRA: [] };
const GRAVAME = ok('533', { GRAVAME: { PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', GRAVAMES: { REGISTRO_1: { NUMERO_RESTRICAO: '123456', DATA_RESTRICAO: '2023-03-15', ESTADO_RESTRICAO: 'SP', STATUS: 'ATIVO', NOME_AGENTE: 'BANCO ITAU S.A.', DOCUMENTO_AGENTE: '60701190000104', NUMERO_CONTRATO: 'CT-998877' } } } });
const SO_GRAVAME = ['GRAVAME'];

test('Básica: veículo sem financiamento compra só a base (nada de leilão, proprietários ou sinistro)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': withFlags(LIMPO) });
  await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'BASIC', sources: SO_GRAVAME });
  assert.deepEqual(f.paid(), ['/debitosrestricoesproprietarios']);
});

test('Básica: veículo alienado compra a base e o gravame, e só isso', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch({ '/debitosrestricoesproprietarios': withFlags(ALIENADO), '/gravame': GRAVAME });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'BASIC', sources: SO_GRAVAME });
  assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/gravame']);
  for (const nunca of ['/leilaoconjugado', '/historicoproprietario', '/indiciosinistro', '/veicularbnacionalonline', '/farolleilao']) assert.ok(!f.paid().includes(nunca), nunca);
  const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  assert.equal(items.get('RESTRICAOFINAN').state, 'ALERT');
  assert.match(JSON.stringify(items.get('GR_DETALHES')), /ITAU/);
});

describe('migração 069: Básica com gravame e Leilão ativo', integration, () => {
  let pool; let server; let sa;
  before(async () => { ({ pool } = await loadCore()); server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' }); sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('painel: salvar Completa, Premium, Básica e Leilão devolvendo as seções já gravadas funciona', async () => {
    for (const id of ['COMPLETE', 'PREMIUM', 'BASIC', 'AUCTION']) {
      const row = (await pool.query('SELECT name,report_sections FROM query_products WHERE id=$1', [id])).rows[0];
      const r = await sa.call(`/api/admin/products/${id}`, { method: 'PATCH', body: { name: row.name, reportSections: row.report_sections } });
      assert.equal(r.status, 200, `${id}: ${r.text}`);
    }
  });

  it('Básica compra base + gravame e mostra a seção de financiamento; sem leilão e sem proprietários', async () => {
    const b = (await pool.query(`SELECT data_sources,report_sections,active,commercial_status,features,tagline FROM query_products WHERE id='BASIC'`)).rows[0];
    assert.deepEqual(b.data_sources, ['GRAVAME']);
    assert.ok(b.report_sections.includes('GRAVAME') && b.report_sections.includes('DEBITOS'));
    assert.ok(!b.report_sections.includes('HISTORICO') && !b.report_sections.includes('PROPRIETARIO'));
    assert.equal(b.active, true);
    assert.match(JSON.stringify(b.features), /Financiamento: gravame/);
    assert.doesNotMatch(JSON.stringify(b.features), /leil|propriet/i);
    const det = await (await fetch(`${server.base}/api/catalog/details`)).json();
    const secs = det.products.find((p) => p.id === 'BASIC').sections.map((s) => s.key);
    assert.ok(secs.includes('GRAVAME') && secs.includes('DEBITOS') && !secs.includes('HISTORICO') && !secs.includes('PROPRIETARIO'), JSON.stringify(secs));
  });

  it('Leilão ativo: à venda, com regra de fonte, seções só de identificação e histórico', async () => {
    const a = (await pool.query(`SELECT active,commercial_status,report_sections,coverage,long_description FROM query_products WHERE id='AUCTION'`)).rows[0];
    assert.equal(a.active, true);
    assert.equal(a.commercial_status, 'ACTIVE');
    assert.deepEqual(a.report_sections, ['IDENTIFICACAO', 'CARACTERISTICAS', 'HISTORICO']);
    assert.doesNotMatch(`${a.coverage} ${a.long_description}`, /em breve|ainda não está disponível/i);
    const rule = await pool.query(`SELECT 1 FROM query_source_rules WHERE product_id='AUCTION' AND active=true`);
    assert.equal(rule.rowCount, 1);
    const det = await (await fetch(`${server.base}/api/catalog/details`)).json();
    const keys = det.products.find((p) => p.id === 'AUCTION').sections.map((s) => s.key);
    assert.ok(!keys.includes('DEBITOS') && !keys.includes('GRAVAME') && !keys.includes('PROPRIETARIO'), JSON.stringify(keys));
    const itens = det.products.find((p) => p.id === 'AUCTION').sections.find((s) => s.key === 'HISTORICO').items.join('|');
    assert.match(itens, /leilão/i);
    assert.doesNotMatch(itens, /sinistro|roubo|recall|propriet/i, 'o relatório de leilão não promete o que não compra');
    const { validateScopeConfig } = await import('../dist/lib/reportScope.js');
    const tpl = (await pool.query(`SELECT config FROM report_templates t JOIN report_template_publications p ON p.template_id=t.id WHERE p.product_id='AUCTION' AND p.superseded_at IS NULL`)).rows[0].config;
    assert.equal(validateScopeConfig(tpl).ok, true, JSON.stringify(validateScopeConfig(tpl)));
  });

  it('vitrine pública: Leilão aparece como ativo e a Básica traz o gravame na comparação', async () => {
    const cat = await (await fetch(`${server.base}/api/catalog`)).json();
    const auction = cat.products.find((p) => p.id === 'AUCTION');
    assert.equal(auction.commercialStatus, 'ACTIVE');
    const feat = (key) => cat.features.find((f) => f.key === key)?.id;
    assert.equal(auction.matrix[feat('leilao')], 'INCLUDED');
    const basic = cat.products.find((p) => p.id === 'BASIC');
    assert.equal(basic.matrix[feat('gravame')], 'INCLUDED');
    assert.notEqual(basic.matrix[feat('leilao')], 'INCLUDED');
  });
});
