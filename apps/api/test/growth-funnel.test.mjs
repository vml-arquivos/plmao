import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { renderRobotsTxt, renderSeoHtml, renderSitemapXml, SITEMAP_PATHS } from '../dist/seo.js';

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
const seoPages = await readFile(new URL('../../web/src/client/content/seoPages.ts', import.meta.url), 'utf8');
const seoPage = await readFile(new URL('../../web/src/client/pages/SeoPage.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../../web/src/client/App.tsx', import.meta.url), 'utf8');
const funnel = await readFile(new URL('../../web/src/client/funnel.ts', import.meta.url), 'utf8');
const adminDashboard = await readFile(new URL('../../web/src/admin/pages/Dashboard.tsx', import.meta.url), 'utf8');

test('HTML entregue pelo servidor possui SEO específico por rota', () => {
  const template = '<html><head><title>Antigo</title><meta name="description" content="antiga" /><link rel="canonical" href="https://example.com/" /><meta property="og:title" content="antigo" /><meta property="og:description" content="antiga" /><meta property="og:url" content="https://example.com/" /><meta name="twitter:title" content="antigo" /><meta name="twitter:description" content="antiga" /></head><body></body></html>';
  const output = renderSeoHtml(template, '/consultar-gravame', 'https://placanamao.com.br/');
  assert.match(output, /<title>Consultar gravame de veículo \| Placa na Mão<\/title>/);
  assert.match(output, /rel="canonical" href="https:\/\/placanamao\.com\.br\/consultar-gravame"/);
  assert.match(output, /property="og:title" content="Consultar gravame de veículo \| Placa na Mão"/);
  assert.match(output, /name="twitter:description"/);
  assert.match(output, /id="pnm-route-schema"/);
  assert.match(output, /application\/ld\+json/);
});

test('catálogo frontend contém as páginas de intenção, roteadas e com evento de visualização', () => {
  const routes = ['/consulta-placa', '/consulta-veicular', '/consultar-gravame', '/consultar-sinistro-veiculo', '/consultar-leilao-veiculo', '/consultar-debitos-veiculo', '/consultar-multas-veiculo', '/consultar-recall', '/historico-veicular', '/para-lojistas', '/para-concessionarias'];
  for (const route of routes) {
    assert.ok(seoPages.includes(`path: '${route}'`), `conteúdo SEO ausente: ${route}`);
    assert.ok(SITEMAP_PATHS.includes(route), `sitemap sem ${route}`);
  }
  assert.match(app, /SeoPage/);
  assert.match(seoPage, /SEO_PAGE_VIEW/);
});

test('funil público aceita somente eventos conhecidos e não armazena PII direta', () => {
  assert.match(server, /api\.post\('\/funnel\/events'/);
  assert.match(server, /event: z\.enum\(\['HOME_PAGE_VIEW'/);
  assert.match(server, /metadata: z\.record\(z\.string\(\)\.max\(60\)/);
  assert.match(server, /res\.status\(202\)\.json\(\{ accepted: true \}\)/);
  assert.match(server, /publicFunnelMetadataKeys/);
  assert.match(server, /sanitizePublicFunnelMetadata/);
  assert.match(server, /count\(DISTINCT session_key\) FROM funnel_events WHERE event_type='ACCOUNT_CREATED'/);
  assert.match(funnel, /keepalive: true/);
  assert.doesNotMatch(funnel, /plate\s*:/i);
  assert.doesNotMatch(server, /recordFunnelEvent\([^\n]*email:/);
});

test('overview expõe indicadores do funil em 30 dias', () => {
  for (const field of ['funnel_visitors_30d', 'seo_visitors_30d', 'cta_visitors_30d', 'checkout_starts_30d', 'visitor_registration_rate_pct']) {
    assert.match(server, new RegExp(`AS ${field}`));
    assert.match(adminDashboard, new RegExp(field));
  }
});

test('sitemap e robots dinâmicos incluem páginas públicas, bloqueiam API/app e escondem o painel', () => {
  const sitemap = renderSitemapXml('https://placanamao.com.br/');
  for (const route of SITEMAP_PATHS) assert.ok(sitemap.includes(`<loc>https://placanamao.com.br${route === '/' ? '/' : route}</loc>`));
  assert.ok(!sitemap.includes('/entrar') && !sitemap.includes('/criar-conta') && !sitemap.includes('/app'));
  const robots = renderRobotsTxt('https://placanamao.com.br', false);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/app\//);
  assert.match(robots, /Sitemap: https:\/\/placanamao\.com\.br\/sitemap\.xml/);
  assert.equal(renderRobotsTxt('https://admin.placanamao.com.br', true), 'User-agent: *\nDisallow: /\n');
  assert.match(server, /app\.get\('\/robots\.txt'/);
  assert.match(server, /app\.get\('\/sitemap\.xml'/);
});

test('telas de conta e app recebem noindex e as demais indexação', () => {
  const template = '<html><head><title>x</title><meta name="robots" content="index,follow" /></head></html>';
  assert.match(renderSeoHtml(template, '/entrar', 'https://placanamao.com.br'), /content="noindex,nofollow"/);
  assert.match(renderSeoHtml(template, '/app/consultar', 'https://placanamao.com.br'), /content="noindex,nofollow"/);
  assert.match(renderSeoHtml(template, '/consultar-gravame', 'https://placanamao.com.br'), /content="index,follow/);
});
