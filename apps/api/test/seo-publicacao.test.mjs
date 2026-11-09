import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const { SITEMAP_PATHS } = await import('../dist/seo.js');
const { compareHtmlWithPanel, verifyPublished, VERIFY_SCOPE } = await import('../dist/seoVerify.js');
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const meta = (h, re) => { const m = h.match(re); return m ? dec(m[1]) : null; };

describe('publicação do SEO: painel × HTML entregue pelo servidor, nas 30 rotas', integration, () => {
  let server, pool, adm;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await adm.call('/api/admin/content/seo/pages/reset', { method: 'POST', body: { path: '/contato' } }); await server.stop(); await pool.end(); });
  const html = async (p) => (await fetch(server.base + p, { headers: { accept: 'text/html' } })).text();

  it('título, descrição, canonical e indexação do HTML conferem com o painel; nada vaza de uma rota para outra', async () => {
    const items = (await adm.call('/api/admin/content/seo/pages')).json.items;
    assert.equal(SITEMAP_PATHS.length, 30, 'as 30 rotas do sitemap');
    const vistos = new Map();
    for (const p of SITEMAP_PATHS) {
      const h = await html(p);
      const row = items.find((i) => i.path === p);
      const title = meta(h, /<title>([^<]*)<\/title>/);
      const desc = meta(h, /<meta name="description" content="([^"]*)"/);
      const can = [...h.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
      assert.equal(can.length, 1, `${p}: um canonical só`);
      assert.ok(can[0].endsWith(p === '/' ? '/' : p), `${p}: canonical aponta para a própria rota (${can[0]})`);
      assert.equal((h.match(/<meta name="description"/g) ?? []).length, 1, `${p}: uma descrição só`);
      assert.match(h, /<meta name="robots" content="index,follow/, `${p}: indexável`);
      if (row?.title) assert.equal(title, row.title, `${p}: título do painel`);
      if (row?.description) assert.equal(desc, row.description, `${p}: descrição do painel`);
      assert.ok(!/Consulte a placa e receba um relatório veicular completo/.test(desc ?? '') || p === '/' || p === '/consulta-placa' || p === '/consulta-veicular', `${p}: descrição genérica de outra rota`);
      if (p !== '/') { assert.ok(!vistos.has(title), `${p}: título repetido de ${vistos.get(title)}`); vistos.set(title, p); }
    }
  });

  it('o HTML leva os textos do painel num bloco de dados marcado com a rota (primeira pintura sem salto de layout)', async () => {
    const h = await html('/sobre');
    const m = h.match(/<script id="seo-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m, 'bloco seo-data presente');
    assert.ok(!m[1].includes('<'), 'sem "<" cru');
    assert.equal(JSON.parse(m[1]).path, '/sobre');
    assert.ok(Array.isArray(JSON.parse(m[1]).sections));
    assert.ok(!(await html('/rota-que-nao-existe')).includes('id="seo-data"'), '404 não leva dados de página');
  });

  it('parâmetros da simulação não mudam o canonical, o título nem a descrição', async () => {
    const a = await html('/simulador'); const b = await html('/simulador?v=80000&e=20000&m=48&mod=CDC');
    for (const re of [/<link rel="canonical" href="([^"]*)"/, /<title>([^<]*)<\/title>/, /<meta name="description" content="([^"]*)"/]) assert.equal(meta(a, re), meta(b, re));
    assert.ok(meta(b, /<link rel="canonical" href="([^"]*)"/).endsWith('/simulador'));
  });

  it('texto cadastrado com tags e script sai escapado no HTML e no schema', async () => {
    const item = (await adm.call('/api/admin/content/seo/pages')).json.items.find((i) => i.path === '/contato');
    const mal = '</script><script>window.__x=1</script><img src=x onerror=alert(1)>';
    const r = await adm.call('/api/admin/content/seo/pages', { method: 'PUT', body: { path: '/contato', h1: item.h1, title: item.title, description: item.description, keyword: item.keyword, sections: [{ h: `Bloco ${mal}`, p: mal }], faq: [{ q: `Pergunta ${mal}?`, a: mal }], noindex: false } });
    assert.equal(r.status, 200);
    const h = await html('/contato');
    assert.ok(!h.includes('<script>window.__x=1</script>'), 'script cadastrado não vira script');
    assert.ok(!h.includes('<img src=x onerror'), 'tag cadastrada não vira tag');
    assert.ok(h.includes('&lt;script&gt;window.__x=1'), 'aparece como texto');
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const j of lds) { assert.ok(!j.includes('<'), 'JSON-LD sem "<" cru'); JSON.parse(j); }
  });

  it('verificação de publicação: confere o painel com o HTML, registra data e escopo, só aceita rotas do sistema', async () => {
    const r = await adm.call('/api/admin/content/seo/pages/verify', { method: 'POST', body: { path: '/fipe' } });
    assert.equal(r.status, 200);
    const v = r.json.results[0];
    assert.equal(v.path, '/fipe'); assert.equal(v.status, 'OK', JSON.stringify(v.checks.filter((c) => !c.ok)));
    assert.equal(v.scope, VERIFY_SCOPE); assert.ok(Date.parse(v.at) > 0);
    const item = (await adm.call('/api/admin/content/seo/pages')).json.items.find((i) => i.path === '/fipe');
    assert.equal(item.publication.status, 'OK', 'a lista mostra a última verificação');
    assert.equal((await adm.call('/api/admin/content/seo/pages/verify', { method: 'POST', body: { path: 'https://exemplo.com/fipe' } })).status, 422, 'endereço de fora não é aceito');
    assert.equal((await adm.call('/api/admin/content/seo/pages/verify', { method: 'POST', body: { path: '/admin/segredo' } })).status, 422);
    const anon = await fetch(`${server.base}/api/admin/content/seo/pages/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.ok([401, 403].includes(anon.status), 'sem login não verifica');
  });

  it('divergência: bloco do painel ausente do HTML, canonical errado e erro de rede são diferenciados', async () => {
    const exp = { path: '/sobre', baseUrl: 'https://placanamao.com.br', title: 'T', description: 'D', h1: '', sections: [{ h: 'Bloco salvo', p: 'x' }], faq: [{ q: 'Pergunta salva?', a: 'y' }], noindex: false };
    const html = '<title>T</title><meta name="description" content="D"/><link rel="canonical" href="https://placanamao.com.br/"/><meta name="robots" content="index,follow"/><main></main>';
    const c = compareHtmlWithPanel(html, exp);
    assert.equal(c.find((x) => x.label.startsWith('Canonical')).ok, false);
    assert.equal(c.find((x) => x.label.includes('bloco')).ok, false);
    assert.equal(c.find((x) => x.label.includes('pergunta')).ok, false);
    const err = await verifyPublished(exp, 1, async () => { throw new Error('rede'); });
    assert.equal(err.status, 'ERRO');
    const redir = await verifyPublished(exp, 1, async () => new Response('', { status: 302 }));
    assert.equal(redir.status, 'ERRO'); assert.match(redir.error, /302/);
    const nao = await verifyPublished({ ...exp, path: '/qualquer-coisa' }, 1, async () => new Response('x'));
    assert.equal(nao.status, 'ERRO');
  });
});
