import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { renderSeoHtml, SITEMAP_PATHS, productImageUrls, PRODUCT_IMAGE_FILES } = await import('../dist/seo.js');
const { placaMigrations } = await import('../dist/migrations.placanamao.js');
const web = (f) => readFileSync(new URL(`../../web/${f}`, import.meta.url), 'utf8');

describe('cabeçalho de SEO: o que o navegador e o Google recebem', () => {
  const tpl = web('index.html');
  it('o modelo do index.html não carrega schema nem canonical de outra página além do padrão da home', () => {
    assert.doesNotMatch(tpl, /"@type":"WebApplication"/, 'WebApplication genérico em toda página enganava o Google');
    assert.equal((tpl.match(/rel="canonical"/g) ?? []).length, 1);
  });
  it('service worker não serve a cópia do index.html para robots.txt, sitemap.xml nem arquivos', () => {
    const cfg = web('vite.config.ts');
    assert.match(cfg, /navigateFallbackDenylist:[^\]]*robots\\\.txt/);
    assert.match(cfg, /navigateFallbackDenylist:[^\]]*sitemap\\\.xml/);
  });
  it('as 30 rotas saem do servidor com uma canonical própria, uma descrição e sem WebApplication fora das ferramentas', () => {
    const tools = new Set(['/fipe', '/simulador', '/simulador/carro', '/simulador/moto', '/simulador/caminhao', '/simulador/utilitario', '/combustivel', '/comparar']);
    for (const p of SITEMAP_PATHS) {
      const h = renderSeoHtml(tpl, p, 'https://placanamao.com.br', {});
      const can = [...h.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(can, [`https://placanamao.com.br${p}`], p);
      assert.equal((h.match(/<meta name="description"/g) ?? []).length, 1, p);
      assert.equal(/"@type":"WebApplication"/.test(h), tools.has(p), `${p}: WebApplication só nas ferramentas`);
    }
  });
  it('imagem de cada consulta: arquivos existem, quadrada vem antes da capa e produto sem imagem usa a da marca', () => {
    assert.deepEqual(productImageUrls('https://x.com.br', 'CADASTRAL'), ['https://x.com.br/brand/produtos/consulta-cadastral.jpg', 'https://x.com.br/brand/produtos/consulta-cadastral.webp']);
    assert.deepEqual(productImageUrls('https://x.com.br', 'PREMIUM'), ['https://x.com.br/brand/produtos/consulta-premium.webp']);
    assert.deepEqual(productImageUrls('https://x.com.br', 'FIPE_FREE'), ['https://x.com.br/brand/og-image.png']);
    assert.equal(PRODUCT_IMAGE_FILES.length, 9);
    for (const f of PRODUCT_IMAGE_FILES) assert.ok(readFileSync(new URL(`../../web/public/brand/produtos/${f}`, import.meta.url)).length > 20000, f);
  });
  it('o app troca canonical, descrição e indexação ao mudar de tela', () => {
    const app = readFileSync(new URL('../../web/src/client/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /<HeadSync \/>/);
    const sync = readFileSync(new URL('../../web/src/client/components/HeadSync.tsx', import.meta.url), 'utf8');
    for (const k of ['link[rel="canonical"]', 'og:url', 'meta[name="description"]', 'noindex,nofollow']) assert.ok(sync.includes(k), k);
  });
});

describe('cabeçalho de SEO (integração)', integration, () => {
  let server, pool, adm;
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('/api/seo/page devolve a descrição do painel ou a de fábrica da página', async () => {
    const call = (path, opts = {}) => adm.call(`/api${path}`, opts);
    const r = await hostRequest(server.base, '/api/seo/page?path=/fipe');
    assert.equal(r.status, 200);
    assert.ok(r.json.description && r.json.description.length > 40);
    const item = (await call('/admin/content/seo/pages')).json.items.find((i) => i.path === '/fipe');
    const nova = 'Descrição própria do painel para a página da Tabela FIPE, escrita pela equipe.';
    assert.equal((await call('/admin/content/seo/pages', { method: 'PUT', body: { path: '/fipe', h1: item.h1, title: item.title, description: nova, keyword: item.keyword, sections: item.sections, faq: item.faq, noindex: false } })).status, 200);
    const r2 = await hostRequest(server.base, '/api/seo/page?path=/fipe');
    assert.equal(r2.json.description, nova);
    assert.equal((await call('/admin/content/seo/pages/reset', { method: 'POST', body: { path: '/fipe' } })).status, 200);
    const none = await hostRequest(server.base, '/api/seo/page?path=/nao-existe');
    assert.equal(none.json.description, null);
  });

  it('home: cada Product do schema tem imagem (exigência das listagens do comerciante)', async () => {
    const h = await (await fetch(`${server.base}/`, { headers: { accept: 'text/html' } })).text();
    if (!h.includes('<div id="root">')) return; // build do front ausente neste ambiente
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    const list = blocks.find((b) => b['@type'] === 'ItemList');
    assert.ok(list && list.itemListElement.length > 0);
    for (const it of list.itemListElement) { assert.equal(it.item['@type'], 'Product'); assert.ok(Array.isArray(it.item.image) && it.item.image.length > 0); for (const u of it.item.image) assert.match(u, /^https?:\/\/.+\/brand\/(og-image\.png|produtos\/[a-z-]+\.(jpg|webp))$/); assert.ok(it.item.offers.price); }
  });

  it('migração 078: corrige a pergunta de leilão só se o texto ainda for o de fábrica', async () => {
    const mig = placaMigrations.find((m) => m.id === '078_seo_leilao_faq_ativa');
    assert.ok(mig);
    const antigo = 'Em algumas consultas a passagem por leilão aparece como indício. A consulta avulsa de leilão será liberada quando a fonte de dados for ativada.';
    const pergunta = 'A consulta de leilão já está disponível?';
    const faqDe = async () => (await pool.query(`SELECT faq FROM seo_pages WHERE path='/consultar-leilao-veiculo'`)).rows[0].faq;
    const run = async () => { const c = await pool.connect(); try { await mig.up(c); } finally { c.release(); } };
    const base = await faqDe();
    const mk = (a) => base.map((f) => (f.q === pergunta ? { ...f, a } : f));
    // texto de fábrica antigo → corrigido
    await pool.query(`UPDATE seo_pages SET faq=$1::jsonb WHERE path='/consultar-leilao-veiculo'`, [JSON.stringify(mk(antigo))]);
    await run();
    let f = (await faqDe()).find((x) => x.q === pergunta);
    assert.match(f.a, /^Sim\. A consulta Leilão e Dados do Veículo está ativa/);
    assert.equal((await faqDe()).length, base.length, 'não perde nem repete perguntas');
    // texto editado pela equipe → preservado
    await pool.query(`UPDATE seo_pages SET faq=$1::jsonb WHERE path='/consultar-leilao-veiculo'`, [JSON.stringify(mk('Texto escrito pela equipe.'))]);
    await run();
    f = (await faqDe()).find((x) => x.q === pergunta);
    assert.equal(f.a, 'Texto escrito pela equipe.');
  });
});
