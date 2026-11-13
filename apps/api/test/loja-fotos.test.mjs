import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import zlib from 'node:zlib';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
/** PNG cinza real, w x h. */
function png(w, h, shade = 120) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w, shade)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function call(base, path, { method = 'GET', body, raw, type, token, headers = {} } = {}) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const h = { ...(raw ? { 'content-type': type } : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers };
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: h }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => { const buf = Buffer.concat(chunks); const text = buf.toString('utf8'); resolve({ status: res.statusCode, headers: res.headers, buf, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }); });
    });
    req.on('error', reject);
    if (raw) req.write(raw); else if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('loja: envio de fotos pelo botão de carregar', integration, () => {
  let pool; let server; let slug;
  const u = {};
  const password = 'Senha-Forte-123!';
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    for (const tag of ['dono', 'vendedor', 'outro']) {
      const email = `${uid(tag)}@loja.local`;
      const r = await call(server.base, '/api/auth/register', { method: 'POST', body: { name: `Pessoa ${tag}`, email, password, acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201);
      u[tag] = { token: r.json.token, email, id: (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id };
    }
    const a = await call(server.base, '/api/dealer', { method: 'POST', token: u.dono.token, body: { name: `Auto Fotos ${uid('x').replace(/[^a-z]/gi, '').slice(-6)}`, whatsapp: '(11) 98888-7777', city: 'São Paulo', state: 'sp' } });
    assert.equal(a.status, 201, a.text); slug = a.json.store.slug;
    await pool.query('UPDATE dealerships SET member_limit=10 WHERE id=$1', [a.json.store.id]);
    const m = await call(server.base, '/api/dealer/members', { method: 'POST', token: u.dono.token, body: { email: u.vendedor.email, role: 'SELLER' } });
    assert.equal(m.status, 201, m.text);
    const b = await call(server.base, '/api/dealer', { method: 'POST', token: u.outro.token, body: { name: `Outra Loja ${uid('y').replace(/[^a-z]/gi, '').slice(-6)}` } });
    assert.equal(b.status, 201, b.text);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const send = (who, buf, type = 'image/png', kind) => call(server.base, `/api/dealer/photos${kind ? `?kind=${kind}` : ''}`, { method: 'POST', raw: buf, type, token: u[who]?.token });

  it('envia a foto, devolve o endereço e a vitrine serve a imagem com cache', async () => {
    const img = png(640, 480);
    const r = await send('vendedor', img);
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.url, /^\/api\/public\/store-photos\/[0-9a-f-]{36}$/);
    assert.equal(r.json.width, 640); assert.equal(r.json.height, 480);
    const v = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'Fiat', model: 'Argo', priceCents: 5_000_000, publicListed: true, photos: [r.json.url] } });
    assert.equal(v.status, 201, v.text);
    assert.deepEqual(v.json.photos, [r.json.url]);
    await call(server.base, '/api/dealer', { method: 'PATCH', token: u.dono.token, body: { publicEnabled: true } });
    const pub = await call(server.base, `/api/public/stores/${slug}`);
    assert.equal(pub.json.vehicles[0].photos[0], r.json.url);
    const g = await call(server.base, r.json.url);
    assert.equal(g.status, 200);
    assert.equal(g.headers['content-type'], 'image/png');
    assert.equal(g.headers['x-content-type-options'], 'nosniff');
    assert.equal(g.headers['cross-origin-resource-policy'], 'cross-origin');
    assert.match(String(g.headers['cache-control']), /immutable/);
    assert.ok(g.buf.equals(img), 'devolve exatamente a imagem enviada');
    const again = await call(server.base, r.json.url, { headers: { 'if-none-match': g.headers.etag } });
    assert.equal(again.status, 304);
  });

  it('rejeita arquivo que não é imagem, imagem pequena e sem login', async () => {
    assert.equal((await send('dono', Buffer.from('<html>nao sou imagem</html>'), 'image/png')).status, 415, 'conteúdo não é PNG');
    assert.equal((await send('dono', png(640, 480), 'image/jpeg')).status, 415, 'tipo declarado diferente do real');
    assert.equal((await send('dono', Buffer.from('texto'), 'text/plain')).status, 415);
    const small = await send('dono', png(100, 100));
    assert.equal(small.status, 422); assert.equal(small.json.error, 'DEALER_PHOTO_TOO_SMALL');
    assert.equal((await send('dono', png(100, 100), 'image/png', 'logo')).status, 201, 'logo pode ser pequena');
    assert.equal((await call(server.base, '/api/dealer/photos', { method: 'POST', raw: png(640, 480), type: 'image/png' })).status, 401);
    assert.equal((await send('outro', png(640, 480))).status, 201, 'a outra loja também envia na própria loja');
    const stranger = await call(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Sem loja', email: `${uid('s')}@loja.local`, password, acceptTerms: true, acceptPrivacy: true } });
    assert.equal((await call(server.base, '/api/dealer/photos', { method: 'POST', raw: png(640, 480), type: 'image/png', token: stranger.json.token })).status, 404, 'quem não tem loja não envia');
  });

  it('foto de outra loja não pode ser usada; link https antigo continua valendo', async () => {
    const mine = await send('outro', png(640, 480, 200));
    assert.equal(mine.status, 201);
    const steal = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'VW', model: 'Gol', priceCents: 3_000_000, photos: [mine.json.url] } });
    assert.equal(steal.status, 400); assert.equal(steal.json.error, 'DEALER_PHOTO_NOT_FOUND');
    const fake = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'VW', model: 'Gol', priceCents: 3_000_000, photos: ['/api/public/store-photos/00000000-0000-4000-8000-000000000000'] } });
    assert.equal(fake.status, 400);
    const other = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'VW', model: 'Gol', priceCents: 3_000_000, photos: ['/etc/passwd'] } });
    assert.equal(other.status, 400, 'caminho qualquer não vale');
    const legacy = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'VW', model: 'Gol', priceCents: 3_000_000, photos: ['https://exemplo.com.br/gol.jpg'] } });
    assert.equal(legacy.status, 201, legacy.text);
    assert.deepEqual(legacy.json.photos, ['https://exemplo.com.br/gol.jpg']);
    const http = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { brand: 'VW', model: 'Gol', priceCents: 3_000_000, photos: ['http://exemplo.com.br/gol.jpg'] } });
    assert.equal(http.status, 400, 'http simples continua recusado');
  });

  it('logo e capa aceitam foto enviada (só da própria loja) e o link https antigo', async () => {
    const logo = await send('dono', png(200, 200), 'image/png', 'logo');
    const cover = await send('dono', png(1200, 500), 'image/png', 'cover');
    assert.equal(cover.status, 201, cover.text);
    const ok = await call(server.base, '/api/dealer', { method: 'PATCH', token: u.dono.token, body: { logoUrl: logo.json.url, coverUrl: cover.json.url } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.store.logoUrl, logo.json.url);
    const pub = await call(server.base, `/api/public/stores/${slug}`);
    assert.equal(pub.json.store.coverUrl, cover.json.url);
    const foreign = await send('outro', png(200, 200), 'image/png', 'logo');
    assert.equal((await call(server.base, '/api/dealer', { method: 'PATCH', token: u.dono.token, body: { logoUrl: foreign.json.url } })).status, 400);
    assert.equal((await call(server.base, '/api/dealer', { method: 'PATCH', token: u.dono.token, body: { logoUrl: 'https://exemplo.com.br/logo.png' } })).status, 200);
    assert.equal((await call(server.base, '/api/dealer', { method: 'PATCH', token: u.dono.token, body: { logoUrl: null } })).status, 200);
  });

  it('a vitrine nunca mostra a placa inteira; id inválido de foto responde 404', async () => {
    const r = await call(server.base, '/api/dealer/vehicles', { method: 'POST', token: u.dono.token, body: { plate: 'JKL4M56', brand: 'Honda', model: 'City', priceCents: 8_000_000, publicListed: true } });
    assert.equal(r.status, 201, r.text);
    const pub = await call(server.base, `/api/public/stores/${slug}`);
    assert.ok(!/JKL4M56|JKL4/.test(pub.text));
    const one = await call(server.base, `/api/public/stores/${slug}/vehicles/${r.json.id}`);
    assert.ok(!/JKL4M56|JKL4/.test(one.text));
    assert.equal((await call(server.base, '/api/public/store-photos/nao-e-uuid')).status, 404);
    assert.equal((await call(server.base, '/api/public/store-photos/00000000-0000-4000-8000-000000000000')).status, 404);
  });
});
