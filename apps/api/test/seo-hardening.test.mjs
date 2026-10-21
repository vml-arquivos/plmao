import assert from 'node:assert/strict';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';
import { SITEMAP_PATHS, isKnownPath, renderRobotsTxt, renderSeoHtml } from '../dist/seo.js';

useTestEnv();
const tpl = '<html><head><title>x</title><meta name="robots" content="index,follow" /></head><body><div id="root"></div></body></html>';
const base = 'https://placanamao.com.br';

test('/comparar é indexável: está no sitemap, fora do Disallow e sem noindex; só a versão com parâmetros é bloqueada', () => {
  assert.ok(SITEMAP_PATHS.includes('/comparar'));
  const robots = renderRobotsTxt(base, false);
  assert.ok(!/Disallow: \/comparar\n/.test(robots)); assert.match(robots, /Disallow: \/comparar\?/);
  const html = renderSeoHtml(tpl, '/comparar', base);
  assert.match(html, /content="index,follow/);
  assert.match(renderSeoHtml(tpl.replace('</head>', '<link rel="canonical" href="x" /></head>'), '/comparar', base), /rel="canonical" href="https:\/\/placanamao\.com\.br\/comparar"/);
});

test('HTML inicial traz conteúdo semântico (h1, descrição, navegação) para quem não executa JavaScript', () => {
  const html = renderSeoHtml(tpl, '/fipe', base);
  assert.match(html, /<div id="root"><main><h1>Consulta FIPE grátis e em tempo real<\/h1><p>/);
  assert.match(html, /<nav aria-label="Principal"><ul><li><a href="\/fipe">/);
  const withBody = renderSeoHtml(tpl, '/perguntas-frequentes', base, { bodyHtml: '<section><h2>Custa R$ 5?</h2><p>Sim, $& vale.</p></section>' });
  assert.match(withBody, /Custa R\$ 5\?/); assert.match(withBody, /Sim, \$& vale\./);
});

test('rotas desconhecidas e modelos inexistentes: noindex, título próprio e sem conteúdo indexável', () => {
  assert.equal(isKnownPath('/fipe'), true); assert.equal(isKnownPath('/blog/qualquer-slug'), true); assert.equal(isKnownPath('/nao-existe'), false);
  const html = renderSeoHtml(tpl, '/nao-existe', base);
  assert.match(html, /content="noindex,nofollow"/); assert.match(html, /<title>Página não encontrada \| Placa na Mão<\/title>/); assert.match(html, /<h1>Página não encontrada<\/h1>/);
  const model = renderSeoHtml(tpl, '/veiculos/modelo-que-nao-existe', base, { notFound: true });
  assert.match(model, /content="noindex,nofollow"/); assert.doesNotMatch(model, /ficha técnica e opinião/i);
});

test('páginas privadas não recebem corpo pré-renderizado e continuam noindex', () => {
  const html = renderSeoHtml(tpl, '/app/suporte', base);
  assert.match(html, /noindex,nofollow/); assert.match(html, /<div id="root"><\/div>/);
});

describe('servidor: status HTTP das páginas', integration, () => {
  let server;
  before(async () => { await loadCore(); server = await startServer(); });
  after(async () => { await server.stop(); });
  it('rota desconhecida responde 404 com noindex; página real responde 200', async () => {
    const miss = await fetch(`${server.base}/pagina-inexistente`, { headers: { accept: 'text/html' } });
    const real = await fetch(`${server.base}/planos`, { headers: { accept: 'text/html' } });
    if (!(real.headers.get('content-type') ?? '').includes('html')) return; // build do front ausente neste ambiente
    assert.equal(miss.status, 404); assert.match(await miss.text(), /noindex,nofollow/);
    assert.equal(real.status, 200);
  });
});
