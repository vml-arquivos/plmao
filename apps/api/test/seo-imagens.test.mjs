import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { readImageInfo } = await import('../dist/lib/imageInfo.js');
const { renderSeoHtml, renderSitemapXml, seoImageSlug, pathFromSeoImageSlug, seoImageUrl, SITEMAP_PATHS } = await import('../dist/seo.js');

/** PNG com cabeçalho válido (só o IHDR importa para o teste) e enchimento para passar do tamanho mínimo. */
function fakePng(w, h, extra = 1500) {
  const b = Buffer.alloc(33 + extra, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function fakeJpeg(w, h) {
  const b = Buffer.alloc(1600, 0);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]).copy(b, 0); // APP0 curto
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 8); b.writeUInt16BE(h, 13); b.writeUInt16BE(w, 15);
  return b;
}

describe('imagens do SEO: leitura de tamanho e endereços', () => {
  it('lê tipo e tamanho de PNG e JPEG e recusa o que não é imagem', () => {
    assert.deepEqual(readImageInfo(fakePng(1200, 630)), { mime: 'image/png', width: 1200, height: 630 });
    assert.deepEqual(readImageInfo(fakeJpeg(1200, 1200)), { mime: 'image/jpeg', width: 1200, height: 1200 });
    assert.equal(readImageInfo(Buffer.from('%PDF-1.7 não é imagem, nem de longe, este texto é longo o bastante')), null);
    assert.equal(readImageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"></svg>')), null);
  });
  it('nome da imagem vem do caminho e volta para o caminho', () => {
    assert.equal(seoImageSlug('/'), 'inicio');
    assert.equal(seoImageSlug('/simulador/carro'), 'simulador-carro');
    for (const p of SITEMAP_PATHS) assert.equal(pathFromSeoImageSlug(seoImageSlug(p)), p);
    assert.equal(pathFromSeoImageSlug('../etc/passwd'), null);
    assert.equal(seoImageUrl('https://x.com.br/', '/fipe', 'image/jpeg', 'a'.repeat(64)), 'https://x.com.br/seo-img/fipe.jpg?v=aaaaaaaaaa');
  });
  it('HTML usa a imagem da página em og:image, twitter:image e schema; sem imagem, a da marca', () => {
    const tpl = '<html><head><meta property="og:image" content="https://placanamao.com.br/brand/og-image.png" /><meta name="twitter:card" content="summary_large_image" /><meta name="description" content="x" /><title>t</title></head><body><div id="root"></div></body></html>';
    const com = renderSeoHtml(tpl, '/fipe', 'https://placanamao.com.br', { image: 'https://placanamao.com.br/seo-img/fipe.jpg?v=abc', imageWidth: 1200, imageHeight: 630 });
    assert.match(com, /<meta property="og:image" content="https:\/\/placanamao\.com\.br\/seo-img\/fipe\.jpg\?v=abc" \/>/);
    assert.match(com, /og:image:width" content="1200"/); assert.match(com, /og:image:height" content="630"/);
    assert.match(com, /<meta name="twitter:image" content="https:\/\/placanamao\.com\.br\/seo-img\/fipe\.jpg\?v=abc" \/>/);
    assert.match(com, /"image":"https:\/\/placanamao\.com\.br\/seo-img\/fipe\.jpg\?v=abc"/);
    const sem = renderSeoHtml(tpl, '/fipe', 'https://placanamao.com.br', {});
    assert.match(sem, /og:image" content="https:\/\/placanamao\.com\.br\/brand\/og-image\.png"/);
    assert.doesNotMatch(sem, /og:image:width/);
  });
  it('sitemap leva a imagem da página', () => {
    const xml = renderSitemapXml('https://placanamao.com.br', [], new Map([['/fipe', { noindex: false, updatedAt: new Date('2026-11-08'), imageUrl: 'https://placanamao.com.br/seo-img/fipe.jpg?v=abc' }]]));
    assert.match(xml, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
    assert.match(xml, /\/fipe<\/loc><lastmod>2026-11-08<\/lastmod>.*<image:image><image:loc>https:\/\/placanamao\.com\.br\/seo-img\/fipe\.jpg\?v=abc<\/image:loc><\/image:image><\/url>/);
  });
});

describe('imagens do SEO (integração)', integration, () => {
  let server, pool, adm, adm2;
  const up = (path, body, type = 'image/png', host) => fetch(`${server.base}/api/admin/content/seo/pages/image?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { 'content-type': type, authorization: `Bearer ${adm.token}`, ...(host ? { host } : {}) }, body });
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('envia, serve, usa no HTML e no sitemap, e remove', async () => {
    const png = fakePng(1200, 630);
    const r = await up('/fipe', png);
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.match(j.image.url, /\/seo-img\/fipe\.png\?v=[0-9a-f]{10}$/);
    assert.equal(j.image.width, 1200);
    const file = j.image.url.replace(/^https?:\/\/[^/]+/, '');
    const got = await fetch(`${server.base}${file}`);
    assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(png));
    assert.equal((await fetch(`${server.base}/seo-img/fipe.png`, { headers: { 'if-none-match': got.headers.get('etag') } })).status, 304);
    assert.equal((await fetch(`${server.base}/seo-img/nao-existe.png`)).status, 404);
    // lista do painel e rota pública
    const list = await adm.call('/api/admin/content/seo/pages');
    assert.equal(list.json.items.find((i) => i.path === '/fipe').image.url, j.image.url);
    assert.equal(list.json.items.find((i) => i.path === '/planos').image, null);
    assert.equal((await hostRequest(server.base, '/api/seo/page?path=/fipe')).json.image, j.image.url);
    // HTML inicial e sitemap
    const html = await (await fetch(`${server.base}/fipe`, { headers: { accept: 'text/html' } })).text();
    if (html.includes('<div id="root">')) {
      assert.ok(html.includes(`<meta property="og:image" content="${j.image.url}" />`));
      assert.ok(html.includes(`<meta name="twitter:image" content="${j.image.url}" />`));
    }
    const site = await (await fetch(`${server.base}/sitemap.xml`)).text();
    assert.ok(site.includes(`<image:loc>${j.image.url}</image:loc>`));
    // trocar muda a versão
    const r2 = await up('/fipe', fakePng(1200, 1200, 2500));
    assert.notEqual((await r2.json()).image.url, j.image.url);
    // remover
    assert.equal((await adm.call('/api/admin/content/seo/pages/image?path=/fipe', { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${server.base}/seo-img/fipe.png`)).status, 404);
    const html2 = await (await fetch(`${server.base}/fipe`, { headers: { accept: 'text/html' } })).text();
    if (html2.includes('<div id="root">')) assert.match(html2, /og:image" content="[^"]*\/brand\/og-image\.png"/);
    assert.equal((await hostRequest(server.base, '/api/seo/page?path=/fipe')).json.image, null);
  });

  it('recusa arquivo falso, imagem pequena, tipo errado, página inventada e quem não é do painel', async () => {
    assert.equal((await up('/fipe', Buffer.from('%PDF-1.7 ' + 'x'.repeat(2000)), 'image/png')).status, 415);
    assert.equal((await up('/fipe', fakeJpeg(800, 800), 'image/png')).status, 415, 'tipo declarado diferente do real');
    assert.equal((await up('/fipe', fakePng(200, 200))).status, 422, 'menor que 300 px');
    assert.equal((await up('/fipe', fakePng(800, 800, 10))).status, 422, 'arquivo minúsculo');
    assert.equal((await up('/pagina-inventada', fakePng(800, 800))).status, 422);
    assert.equal((await up('/fipe', Buffer.alloc(3.5 * 1024 * 1024, 1), 'image/png')).status, 413);
    assert.equal((await fetch(`${server.base}/api/admin/content/seo/pages/image?path=/fipe`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: fakePng(800, 800) })).status, 401);
    const n = (await pool.query(`SELECT count(*)::int AS n FROM seo_images`)).rows[0].n;
    assert.equal(n, 0, 'nada foi gravado');
  });
});
