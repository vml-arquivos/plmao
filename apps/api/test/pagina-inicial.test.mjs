import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const { homeConfigSchema, EMPTY_HOME } = await import('../dist/routes/siteHome.js');

function fakePng(w, h, extra = 1500) {
  const b = Buffer.alloc(33 + extra, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

describe('página inicial editável: regras dos campos', () => {
  it('sem nada configurado, tudo cai no padrão (null) e as seções ficam ligadas', () => {
    assert.equal(EMPTY_HOME.heroLead, null);
    assert.deepEqual(EMPTY_HOME.showcaseBullets, []);
    assert.deepEqual(EMPTY_HOME.show, { steps: true, tools: true, testimonials: true, lojista: true });
    assert.equal(EMPTY_HOME.announce.enabled, false);
  });
  it('texto vazio vira padrão e espaços sobrando são cortados', () => {
    const p = homeConfigSchema.parse({ heroLead: '   ', finalTitle: '  Consulte já  ' });
    assert.equal(p.heroLead, null); assert.equal(p.finalTitle, 'Consulte já');
  });
  it('recusa texto acima do limite e campo desconhecido', () => {
    assert.equal(homeConfigSchema.safeParse({ heroTag: 'x'.repeat(91) }).success, false);
    assert.equal(homeConfigSchema.safeParse({ outraCoisa: 1 }).success, false);
    assert.equal(homeConfigSchema.safeParse({ showcaseBullets: ['a', 'b', 'c', 'd', 'e', 'f'] }).success, false);
  });
  it('link do aviso: só caminho interno ou https', () => {
    const ok = (linkTo) => homeConfigSchema.safeParse({ announce: { enabled: true, text: 'Oferta', linkLabel: 'Ver', linkTo } }).success;
    assert.equal(ok('/planos'), true);
    assert.equal(ok('/consultar?placa=ABC1D23'), true);
    assert.equal(ok('https://placanamao.com.br/planos'), true);
    assert.equal(ok('javascript:alert(1)'), false);
    assert.equal(ok('//evil.com'), false);
    assert.equal(ok('http://x.com'), false);
    assert.equal(ok('data:text/html,x'), false);
  });
});

describe('página inicial editável (integração)', integration, () => {
  let server, pool, adm;
  const up = (slot, body, type = 'image/png', auth = true) => fetch(`${server.base}/api/admin/content/home/image?slot=${slot}`, { method: 'POST', headers: { 'content-type': type, ...(auth ? { authorization: `Bearer ${adm.token}`, host: 'admin.placanamao.test' } : {}) }, body });
  before(async () => { ({ pool } = await loadCore()); server = await startServer(); adm = await adminSession({ server, pool, role: 'ADMIN' }); });
  after(async () => { await pool.query('DELETE FROM site_home_images'); await pool.query('DELETE FROM site_home'); await server.stop(); await pool.end(); });

  it('público: sem configuração devolve o padrão e nenhuma imagem', async () => {
    const r = await fetch(`${server.base}/api/public/home`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.config.heroLead, null);
    assert.deepEqual(j.images, {});
    assert.match(r.headers.get('cache-control') ?? '', /max-age/);
  });

  it('painel exige sessão de admin', async () => {
    assert.equal((await fetch(`${server.base}/api/admin/content/home`)).status, 401);
    assert.equal((await up('hero', fakePng(800, 600), 'image/png', false)).status, 401);
  });

  it('salva textos e aviso, e o site público passa a mostrá-los', async () => {
    const put = await adm.call('/api/admin/content/home', { method: 'PUT', body: { heroLead: 'Texto novo da campanha', finalTitle: '', announce: { enabled: true, text: 'Preço de lançamento', linkLabel: 'Ver', linkTo: '/planos' }, show: { steps: false, tools: true, testimonials: true, lojista: true } } });
    assert.equal(put.status, 200, put.text);
    const pub = await (await fetch(`${server.base}/api/public/home`)).json();
    assert.equal(pub.config.heroLead, 'Texto novo da campanha');
    assert.equal(pub.config.finalTitle, null);
    assert.equal(pub.config.announce.enabled, true);
    assert.equal(pub.config.show.steps, false);
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action='UPDATE_SITE_HOME'`);
    assert.ok(audit.rowCount >= 1, 'fica na auditoria');
  });

  it('recusa aviso ligado sem texto, link perigoso e link sem rótulo', async () => {
    const put = (body) => adm.call('/api/admin/content/home', { method: 'PUT', body });
    assert.equal((await put({ announce: { enabled: true, text: '', linkLabel: null, linkTo: null } })).status, 400);
    assert.equal((await put({ announce: { enabled: true, text: 'Oi', linkLabel: 'Ver', linkTo: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await put({ announce: { enabled: true, text: 'Oi', linkLabel: null, linkTo: '/planos' } })).status, 400);
    assert.equal((await put({ heroTag: 'x'.repeat(200) })).status, 400);
    const pub = await (await fetch(`${server.base}/api/public/home`)).json();
    assert.equal(pub.config.heroLead, 'Texto novo da campanha', 'tentativas recusadas não alteram nada');
  });

  it('imagem: valida, grava, serve com cache e remove', async () => {
    assert.equal((await up('banner', fakePng(800, 600))).status, 400, 'slot inexistente');
    assert.equal((await up('hero', fakePng(200, 200))).status, 422, 'menor que 300 px');
    assert.equal((await up('hero', Buffer.from('%PDF-1.7 isto não é imagem, mas é bem comprido para passar do mínimo de bytes'.repeat(30)))).status, 415);
    assert.equal((await up('hero', Buffer.alloc(3.5 * 1024 * 1024, 1))).status, 413);
    const png = fakePng(1200, 900);
    const r = await up('hero', png);
    assert.equal(r.status, 200, await r.clone().text());
    const j = await r.json();
    assert.match(j.image.url, /^\/api\/public\/home-img\/hero\?v=[0-9a-f]{12}$/);
    assert.equal(j.image.width, 1200);
    const got = await fetch(`${server.base}${j.image.url}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(png));
    assert.equal((await fetch(`${server.base}/api/public/home-img/hero`, { headers: { 'if-none-match': got.headers.get('etag') } })).status, 304);
    assert.equal((await fetch(`${server.base}/api/public/home-img/final`)).status, 404, 'slot sem imagem');
    assert.equal((await fetch(`${server.base}/api/public/home-img/qualquer`)).status, 404);
    const pub = await (await fetch(`${server.base}/api/public/home`)).json();
    assert.equal(pub.images.hero.url, j.image.url);
    assert.equal((await adm.call('/api/admin/content/home/image?slot=hero', { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${server.base}${j.image.url}`)).status, 404);
    assert.deepEqual((await (await fetch(`${server.base}/api/public/home`)).json()).images, {});
  });
});
