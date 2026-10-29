import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';
import { renderSeoHtml, setGoogleTags } from '../dist/seo.js';

useTestEnv();
const tpl = '<html><head><title>x</title><meta name="robots" content="index,follow" /></head><body><div id="root"></div></body></html>';
const base = 'https://placanamao.com.br';

test('sem IDs configurados: nenhuma meta de medição é injetada', () => {
  setGoogleTags({});
  const html = renderSeoHtml(tpl, '/', base);
  assert.doesNotMatch(html, /pnm-ga|pnm-ads|google-site-verification|msvalidate/);
});

test('com IDs: metas de verificação e medição entram no head', () => {
  setGoogleTags({ gaId: 'G-ABC123XYZ9', adsId: 'AW-1234567890', adsPurchaseLabel: 'abcDEF_12', googleVerification: 'tok-123', bingVerification: 'bing-456' });
  const html = renderSeoHtml(tpl, '/', base);
  assert.match(html, /<meta name="pnm-ga" content="G-ABC123XYZ9"/);
  assert.match(html, /<meta name="pnm-ads" content="AW-1234567890"/);
  assert.match(html, /<meta name="pnm-ads-purchase" content="abcDEF_12"/);
  assert.match(html, /<meta name="google-site-verification" content="tok-123"/);
  assert.match(html, /<meta name="msvalidate\.01" content="bing-456"/);
  setGoogleTags({});
});

test('valores com aspas não quebram o atributo', () => {
  setGoogleTags({ googleVerification: 'a"><script>x</script>' });
  const html = renderSeoHtml(tpl, '/', base);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  setGoogleTags({});
});

test('ferramentas ganham WebApplication e BreadcrumbList', () => {
  for (const p of ['/fipe', '/simulador', '/simulador/carro', '/combustivel', '/comparar']) {
    const html = renderSeoHtml(tpl, p, base);
    assert.match(html, /"@type":"WebApplication"/, p);
    assert.match(html, /"@type":"BreadcrumbList"/, p);
  }
});

test('página comum não ganha WebApplication', () => {
  assert.doesNotMatch(renderSeoHtml(tpl, '/planos', base), /"@type":"WebApplication"/);
});
