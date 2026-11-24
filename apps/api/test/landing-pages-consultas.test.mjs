import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { renderSeoHtml, SITEMAP_PATHS, isKnownPath } = await import('../dist/seo.js');
const { SEO_SEED } = await import('../dist/seoSeed.js');
const web = (f) => readFileSync(new URL(`../../web/${f}`, import.meta.url), 'utf8');

const SLUGS = ['cadastral', 'gravame', 'leilao', 'avancada', 'completa', 'premium'];
const PRODUCT = { cadastral: 'CADASTRAL', gravame: 'LIEN', leilao: 'AUCTION', avancada: 'BASIC', completa: 'COMPLETE', premium: 'PREMIUM' };
const PROMISE = /em segundos|tempo real|poucos segundos|aprovação garantida|garantid[oa]|qualquer veículo|todos os bancos/i;

describe('landing page de cada consulta', () => {
  const tpl = web('index.html');
  it('as seis rotas existem, entram no sitemap e têm texto de SEO próprio', () => {
    for (const s of SLUGS) {
      const p = `/consulta/${s}`;
      assert.ok(isKnownPath(p), p);
      assert.ok(SITEMAP_PATHS.includes(p), `${p} no sitemap`);
      const seed = SEO_SEED.find((x) => x.path === p);
      assert.ok(seed, `${p} no SEO_SEED`);
      assert.ok((seed.sections ?? []).length >= 3, `${p}: blocos de texto`);
      assert.ok(seed.faq.length >= 4, `${p}: perguntas`);
      assert.doesNotMatch(JSON.stringify(seed), PROMISE, `${p}: sem promessa`);
    }
    assert.equal(isKnownPath('/consulta/inexistente'), false);
  });
  it('cada página sai do servidor com título, descrição, H1 e canonical próprios', () => {
    const titles = new Set(); const h1s = new Set();
    for (const s of SLUGS) {
      const p = `/consulta/${s}`;
      const h = renderSeoHtml(tpl, p, 'https://placanamao.com.br', {});
      assert.deepEqual([...h.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]), [`https://placanamao.com.br${p}`]);
      const title = h.match(/<title>([^<]*)<\/title>/)?.[1];
      assert.ok(title && title.length >= 30 && title.length <= 65, `${p}: título ${title}`);
      titles.add(title);
      const h1 = h.match(/<h1[^>]*>([^<]*)/)?.[1];
      assert.ok(h1, `${p}: H1`);
      h1s.add(h1);
    }
    assert.equal(titles.size, SLUGS.length, 'títulos únicos');
    assert.equal(h1s.size, SLUGS.length, 'H1 únicos');
  });
  it('o conteúdo da landing aponta para o produto certo e não promete o que a fonte não entrega', () => {
    const src = web('src/client/content/landingPages.ts');
    for (const s of SLUGS) {
      assert.match(src, new RegExp(`slug: '${s}', productId: '${PRODUCT[s]}', path: '/consulta/${s}'`), s);
    }
    assert.doesNotMatch(src, PROMISE);
    assert.doesNotMatch(src, /R\$\s?\d/, 'preço vem do catálogo, nunca fixo no texto');
    assert.match(src, /saldo devedor/i, 'gravame diz que não mostra saldo devedor');
  });
  it('a rota existe no app e a página manda a placa direto para a consulta do produto', () => {
    const app = web('src/client/App.tsx');
    assert.match(app, /path="\/consulta\/:slug"/);
    assert.match(app, /LANDING_BY_SLUG\.has\(slug\)/);
    const page = web('src/client/pages/ProductLanding.tsx');
    assert.match(page, /produto=\$\{encodeURIComponent\(c\.productId\)\}/);
    assert.match(page, /\/criar-conta\?next=/);
    assert.match(page, /useCatalog/, 'preço vem do catálogo');
  });
});

describe('home: FIPE grátis em destaque, consultas e simulador', () => {
  const home = web('src/client/pages/Landing.tsx');
  const choice = web('src/client/components/PlateChoice.tsx');
  it('botão grande leva à FIPE grátis e abre a consulta sozinho depois do login', () => {
    assert.match(choice, /Ver FIPE grátis \+ dados do veículo/);
    assert.match(choice, /\?placa=\$\{p\}&go=1/);
    assert.match(web('src/client/pages/Fipe.tsx'), /params\.get\('go'\) !== '1'/);
    assert.match(home, /<PlateChoice authed=\{status === 'authed'\} placement="hero"/);
  });
  it('a home mostra consultas, simulador e links de cada consulta, sem prometer tempo', () => {
    assert.match(home, /HomeSimulator/);
    assert.match(home, /LANDINGS\.map/);
    assert.match(home, /<ProductCards homeOnly \/>/);
    assert.doesNotMatch(home, /em segundos|Resultado em segundos/);
  });
});
