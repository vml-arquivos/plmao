import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { seoChecks } = await import('../dist/seoStore.js');
const { SEO_SEED } = await import('../dist/seoSeed.js');
const { SITEMAP_PATHS } = await import('../dist/seo.js');

describe('SEO por página', () => {
  it('texto de fábrica: toda página tem palavra-chave no título, na descrição e 3+ perguntas', () => {
    const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const s of SEO_SEED) {
      assert.ok(SITEMAP_PATHS.includes(s.path), `${s.path} precisa estar no sitemap`);
      assert.ok(s.faq.length >= 3, `${s.path}: poucas perguntas`);
      if (s.title) { assert.ok(s.title.length <= 65, `${s.path}: título longo (${s.title.length})`); assert.ok(norm(s.title).includes(norm(s.keyword)) || s.path.startsWith('/simulador/'), `${s.path}: palavra-chave fora do título`); }
      if (s.description) assert.ok(s.description.length >= 70 && s.description.length <= 165, `${s.path}: descrição fora do tamanho (${s.description.length})`);
    }
    for (const p of ['/fipe', '/simulador', '/simulador/carro', '/simulador/moto', '/consultar-gravame', '/consulta-placa']) assert.ok(SEO_SEED.some((s) => s.path === p), p);
  });

  it('lista de verificação aponta o que ajustar', () => {
    const bad = seoChecks({ title: 'Curto', description: 'x', keyword: null, sections: [], faq: [], noindex: true, hasContent: false });
    assert.ok(bad.filter((c) => !c.ok).length >= 4);
    const good = seoChecks({ title: 'Tabela FIPE grátis: preço de carro e moto | Placa na Mão', description: 'Consulte a Tabela FIPE grátis: valor médio de carros, motos e caminhões por marca, modelo e ano, com histórico de preços.', keyword: 'tabela fipe', sections: [{ h: 'O que é a Tabela FIPE', p: 'texto' }], faq: [{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }, { q: 'e', a: 'f' }], noindex: false, hasContent: true });
    assert.ok(good.every((c) => c.ok), JSON.stringify(good.filter((c) => !c.ok)));
  });
});

describe('SEO por página (integração)', integration, () => {
  let server, pool, adm;
  const html = async (path) => (await fetch(`${server.base}${path}`, { headers: { accept: 'text/html' } })).text();
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('migração deixa as páginas principais prontas', async () => {
    const r = await pool.query(`SELECT path,jsonb_array_length(faq) AS f FROM seo_pages WHERE path IN ('/fipe','/simulador','/simulador/carro','/consultar-gravame')`);
    assert.equal(r.rowCount, 4); assert.ok(r.rows.every((x) => x.f >= 3));
  });

  it('o HTML inicial já traz título, descrição, texto, perguntas e dados estruturados', async () => {
    const h = await html('/fipe');
    if (!h.includes('<div id="root">')) return; // build do front ausente neste ambiente
    assert.match(h, /<title>Tabela FIPE grátis: preço de carro e moto \| Placa na Mão<\/title>/);
    assert.match(h, /<h2>O que é a Tabela FIPE<\/h2>/); assert.match(h, /"@type":"FAQPage"/); assert.match(h, /"@type":"WebApplication"/); assert.match(h, /A consulta da Tabela FIPE é grátis\?/);
    const g = await html('/consultar-gravame'); assert.match(g, /O que é gravame de veículo\?/); assert.match(g, /"@type":"FAQPage"/);
  });

  it('API pública entrega textos e perguntas para a tela mostrar o mesmo conteúdo', async () => {
    const r = await hostRequest(server.base, '/api/seo/page?path=/simulador'); assert.equal(r.status, 200); assert.ok(r.json.faq.length >= 5); assert.ok(r.json.sections.length >= 3);
    const none = await hostRequest(server.base, '/api/seo/page?path=/nao-existe'); assert.deepEqual(none.json, { sections: [], faq: [] });
  });

  it('painel: lista com nota, edita, reflete no HTML e no sitemap, exclui da indexação e restaura o padrão', async () => {
    const call = (path, opts = {}) => adm.call(`/api${path}`, opts);
    const list = await call('/admin/content/seo/pages'); assert.equal(list.status, 200);
    assert.equal(list.json.items.length, SITEMAP_PATHS.length);
    const fipe = list.json.items.find((i) => i.path === '/fipe'); assert.ok(fipe.score >= fipe.total - 1, 'FIPE pronta de fábrica');
    const body = { path: '/fipe', title: 'Tabela FIPE de teste hoje | Placa na Mão', description: fipe.description, keyword: 'tabela fipe', sections: [{ h: 'Seção nova', p: 'Texto novo da seção.' }], faq: fipe.faq, noindex: false };
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body })).status, 200);
    const h = await html('/fipe');
    if (h.includes('<div id="root">')) { assert.match(h, /Tabela FIPE de teste hoje/); assert.match(h, /<h2>Seção nova<\/h2>/); }
    const site = await (await fetch(`${server.base}/sitemap.xml`)).text(); assert.match(site, /\/fipe<\/loc><lastmod>\d{4}-\d{2}-\d{2}/);
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body: { ...body, noindex: true } })).status, 200);
    const site2 = await (await fetch(`${server.base}/sitemap.xml`)).text(); assert.doesNotMatch(site2, /\/fipe<\/loc>/);
    const h2 = await html('/fipe'); if (h2.includes('<div id="root">')) assert.match(h2, /noindex,nofollow/);
    assert.equal((await call('/admin/content/seo/pages/reset', { method: 'POST', body: { path: '/fipe' } })).status, 200);
    const h3 = await html('/fipe'); if (h3.includes('<div id="root">')) { assert.match(h3, /Tabela FIPE grátis: preço de carro e moto/); assert.match(h3, /index,follow/); }
  });

  it('validações e permissão: caminho inventado, campos extras e cliente comum', async () => {
    const call = (path, opts = {}) => adm.call(`/api${path}`, opts);
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body: { path: '/qualquer-coisa', title: 'x' } })).status, 422);
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body: { path: '/fipe', extra: 1 } })).status, 400);
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body: { path: '/fipe', faq: Array.from({ length: 30 }, () => ({ q: 'a', a: 'b' })) } })).status, 400);
    assert.ok([401, 403, 404].includes((await hostRequest(server.base, '/api/admin/content/seo/pages')).status));
    const conteudo = await adminSession({ server, pool, role: 'SUPORTE' });
    assert.equal((await conteudo.call('/api/admin/content/seo/pages')).status, 403);
  });
});
