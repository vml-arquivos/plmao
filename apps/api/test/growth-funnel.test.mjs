import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { renderSeoHtml } from '../dist/seo.js';

const server = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
const web = await readFile(new URL('../../web/src/main.tsx', import.meta.url), 'utf8');
const auth = await readFile(new URL('../../web/src/AccountAuthScreen.tsx', import.meta.url), 'utf8');
const seo = await readFile(new URL('../../web/src/seo.tsx', import.meta.url), 'utf8');
const funnel = await readFile(new URL('../../web/src/funnel.ts', import.meta.url), 'utf8');
const sitemap = await readFile(new URL('../../web/public/sitemap.xml', import.meta.url), 'utf8');
const robots = await readFile(new URL('../../web/public/robots.txt', import.meta.url), 'utf8');

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

test('catálogo frontend contém as 12 páginas de intenção e CTA progressivo', () => {
  const routes = ['/consulta-placa', '/consulta-veicular', '/consultar-gravame', '/consultar-sinistro-veiculo', '/consultar-leilao-veiculo', '/consultar-debitos-veiculo', '/consultar-multas-veiculo', '/consultar-recall', '/historico-veicular', '/planos', '/para-lojistas', '/para-concessionarias'];
  for (const route of routes) assert.match(seo, new RegExp(`page\\('${route.replaceAll('/', '\\/')}`));
  assert.match(web, /SeoLandingPage/);
  assert.match(seo, /SEO_PAGE_VIEW/);
  assert.match(seo, /window\.location\.assign\('\/fipe'\)/);
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
  assert.match(web, /plateFormat:/);
  assert.doesNotMatch(web, /pnm_signup_plate/);
  assert.doesNotMatch(server, /recordFunnelEvent\([^\n]*email:/);
});

test('falha isolada de painel não encerra uma sessão válida', () => {
  assert.match(web, /reason instanceof ApiRequestError && reason\.status === 401/);
  assert.match(web, /A sessão atual permanece ativa/);
  assert.match(web, /Promise\.allSettled/);
  assert.match(web, /AdminPasswordCard/);
  assert.match(auth, /cache: 'no-store'/);
  assert.match(server, /Cache-Control', 'no-store, private'/);
});

test('overview expõe indicadores do funil em 30 dias', () => {
  for (const field of ['funnel_visitors_30d', 'seo_visitors_30d', 'cta_visitors_30d', 'checkout_starts_30d', 'visitor_registration_rate_pct']) {
    assert.match(server, new RegExp(`AS ${field}`));
    assert.match(web, new RegExp(field));
  }
});

test('sitemap e robots incluem as páginas públicas indexáveis e bloqueiam API', () => {
  for (const route of ['/consulta-placa', '/consulta-veicular', '/consultar-gravame', '/consultar-sinistro-veiculo', '/consultar-leilao-veiculo', '/consultar-debitos-veiculo', '/consultar-multas-veiculo', '/consultar-recall', '/historico-veicular', '/planos', '/para-lojistas', '/para-concessionarias']) {
    assert.match(sitemap, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap:/);
});
