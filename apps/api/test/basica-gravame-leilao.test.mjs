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

  it('Segura (ex-Básica): cadastro, débitos, restrições, sinistro e leilão; sem proprietários e sem gravame detalhado', async () => {
    const b = (await pool.query(`SELECT name,data_sources,report_sections,active,commercial_status,features,price_cents FROM query_products WHERE id='BASIC'`)).rows[0];
    assert.equal(b.name, 'Consulta Segura');
    assert.deepEqual(b.data_sources, ['SINISTRO', 'NATIONAL', 'AUCTION']);
    assert.ok(b.report_sections.includes('HISTORICO') && b.report_sections.includes('DEBITOS') && b.report_sections.includes('ANALISES'));
    assert.ok(!b.report_sections.includes('PROPRIETARIO'));
    assert.equal(b.active, true);
    assert.equal(b.price_cents, 3290);
    assert.match(JSON.stringify(b.features), /Aceitação em seguro/);
    assert.doesNotMatch(JSON.stringify(b.features), /propriet/i);
    const det = await (await fetch(`${server.base}/api/catalog/details`)).json();
    const secs = det.products.find((p) => p.id === 'BASIC').sections.map((s) => s.key);
    assert.ok(secs.includes('DEBITOS') && secs.includes('HISTORICO') && secs.includes('ANALISES') && !secs.includes('PROPRIETARIO'), JSON.stringify(secs));
  });

  it('Leilão e Dados do Veículo: à venda, com regra de fonte, cadastro nacional, restrições, leilão e análises; sem débitos e sem gravame', async () => {
    const a = (await pool.query(`SELECT name,active,commercial_status,report_sections,data_sources,coverage,long_description,price_cents FROM query_products WHERE id='AUCTION'`)).rows[0];
    assert.equal(a.name, 'Leilão e Dados do Veículo');
    assert.equal(a.active, true);
    assert.equal(a.commercial_status, 'ACTIVE');
    assert.deepEqual(a.data_sources, ['NATIONAL', 'AUCTION']);
    assert.deepEqual(a.report_sections, ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO', 'RESTRICOES', 'HISTORICO', 'ANALISES']);
    assert.equal(a.price_cents, 2990);
    assert.doesNotMatch(`${a.coverage} ${a.long_description}`, /em breve|ainda não está disponível/i);
    const rule = await pool.query(`SELECT 1 FROM query_source_rules WHERE product_id='AUCTION' AND active=true`);
    assert.equal(rule.rowCount, 1);
    const det = await (await fetch(`${server.base}/api/catalog/details`)).json();
    const keys = det.products.find((p) => p.id === 'AUCTION').sections.map((s) => s.key);
    assert.ok(!keys.includes('DEBITOS') && !keys.includes('GRAVAME') && !keys.includes('PROPRIETARIO'), JSON.stringify(keys));
    assert.ok(keys.includes('RESTRICOES') && keys.includes('ANALISES') && keys.includes('HISTORICO'), JSON.stringify(keys));
    const itens = det.products.find((p) => p.id === 'AUCTION').sections.find((s) => s.key === 'HISTORICO').items.join('|');
    assert.match(itens, /leilão/i);
    assert.doesNotMatch(itens, /sinistro|roubo|recall|propriet/i, 'o relatório de leilão não promete o que não compra');
    const { validateScopeConfig } = await import('../dist/lib/reportScope.js');
    const tpl = (await pool.query(`SELECT config FROM report_templates t JOIN report_template_publications p ON p.template_id=t.id WHERE p.product_id='AUCTION' AND p.superseded_at IS NULL`)).rows[0].config;
    assert.equal(validateScopeConfig(tpl).ok, true, JSON.stringify(validateScopeConfig(tpl)));
    const tplBasic = (await pool.query(`SELECT config FROM report_templates t JOIN report_template_publications p ON p.template_id=t.id WHERE p.product_id='BASIC' AND p.superseded_at IS NULL`)).rows[0].config;
    assert.equal(validateScopeConfig(tplBasic).ok, true, JSON.stringify(validateScopeConfig(tplBasic)));
  });

  it('vitrine pública: Leilão aparece como ativo e a Segura traz leilão e sinistro na comparação', async () => {
    const cat = await (await fetch(`${server.base}/api/catalog`)).json();
    const auction = cat.products.find((p) => p.id === 'AUCTION');
    assert.equal(auction.commercialStatus, 'ACTIVE');
    const feat = (key) => cat.features.find((f) => f.key === key)?.id;
    assert.equal(auction.matrix[feat('leilao')], 'INCLUDED');
    const basic = cat.products.find((p) => p.id === 'BASIC');
    assert.equal(basic.matrix[feat('gravame')], 'INCLUDED');
    assert.equal(basic.matrix[feat('leilao')], 'INCLUDED');
    assert.equal(basic.matrix[feat('score-leilao')], 'INCLUDED');
    assert.notEqual(basic.matrix[feat('gravame-detalhado')], 'INCLUDED');
  });

  it('preços dentro da média de mercado, em escada, e nenhum abaixo do piso de margem', async () => {
    const rows = (await pool.query(`SELECT id,price_cents,floor_price_cents FROM query_products WHERE id IN ('CADASTRAL','LIEN','AUCTION','BASIC','COMPLETE','PREMIUM')`)).rows;
    const p = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.ok(p.CADASTRAL.price_cents < p.LIEN.price_cents && p.LIEN.price_cents < p.AUCTION.price_cents);
    assert.ok(p.AUCTION.price_cents < p.BASIC.price_cents && p.BASIC.price_cents < p.COMPLETE.price_cents && p.COMPLETE.price_cents < p.PREMIUM.price_cents);
    // Teto de mercado: Dados Cadastrais R$ 13,90, Gravame R$ 14,90, Essencial R$ 34,90.
    assert.ok(p.CADASTRAL.price_cents <= 1390 && p.LIEN.price_cents <= 1490 && p.BASIC.price_cents <= 3490);
    for (const r of rows) if (r.floor_price_cents != null) assert.ok(Number(r.price_cents) >= Number(r.floor_price_cents), `${r.id} abaixo do piso`);
  });

  it('o histórico de preços registra a mudança', async () => {
    const h = await pool.query(`SELECT product_id,new_price_cents FROM product_price_history WHERE reason LIKE 'Consulta Segura%' OR reason LIKE 'Leilão e Dados%'`);
    assert.ok(h.rows.length >= 1);
  });

  it('o catálogo público mostra a escada com os nomes novos e a matriz de análises', async () => {
    const cat = await (await fetch(`${server.base}/api/catalog`)).json();
    const names = Object.fromEntries(cat.products.map((x) => [x.id, x.name]));
    assert.equal(names.BASIC, 'Consulta Segura');
    assert.equal(names.AUCTION, 'Leilão e Dados do Veículo');
    const feat = (key) => cat.features.find((f) => f.key === key)?.id;
    for (const id of ['BASIC', 'AUCTION', 'COMPLETE', 'PREMIUM']) {
      const prod = cat.products.find((x) => x.id === id);
      assert.equal(prod.matrix[feat('score-leilao')], 'INCLUDED', id);
      assert.equal(prod.matrix[feat('seguro-revenda')], 'INCLUDED', id);
    }
    assert.notEqual(cat.products.find((x) => x.id === 'CADASTRAL').matrix[feat('score-leilao')], 'INCLUDED');
  });

  it('o relatório de exemplo da Segura e da Leilão traz o nível de risco, e o da Leilão não traz débitos', async () => {
    const det = await (await fetch(`${server.base}/api/catalog/details`)).json();
    for (const id of ['BASIC', 'AUCTION', 'COMPLETE', 'PREMIUM']) {
      const an = det.products.find((x) => x.id === id).sections.find((s) => s.key === 'ANALISES');
      assert.ok(an && an.items.some((l) => /risco de leilão/i.test(l)), `${id}: ${JSON.stringify(an)}`);
    }
    const keys = det.products.find((x) => x.id === 'AUCTION').sections.map((s) => s.key);
    assert.ok(!keys.includes('DEBITOS'));
  });
});
