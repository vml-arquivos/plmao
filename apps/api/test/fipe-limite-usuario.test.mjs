import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();

const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const fipeOk = (extra = {}) => ({ CONSULTA: consulta('454'), RESPOSTA: { CODIGO: '1', PRECIFICADORFIPE: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { STATUS: '1', CHASSI: '9BWZZZ377VT004251', CODIGOFIPE: '005004-1', FABRICANTEFIPE: 'VW - VOLKSWAGEN', MODELOFIPE: 'GOL 1.0 FLEX 4P', ANOMODELOFIPE: '2020', COMBUSTIVELFIPE: 'F', PRECOFIPE: '45.000,00', PRECOMEDIO: '44.000,00', VIGENCIA: '11/2026', ...extra } } } });

describe('FIPE grátis: limite diário por usuário (padrão 10, editável no Sistema e por conta)', integration, () => {
  let pool; let app; let credify; let sa;
  before(async () => {
    ({ pool } = await loadCore());
    credify = http.createServer((req, res) => {
      req.on('data', () => {}); req.on('end', () => {
        const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        send(req.url === '/auth' ? { Success: true, Dados: jwt() } : fipeOk());
      });
    });
    await new Promise((r) => credify.listen(0, '127.0.0.1', r));
    // sem FIPE_AUTH_DAILY_LIMIT: vale o padrão do sistema (10). O visitante segue em 2 por IP.
    app = await startServer({
      DATA_PROVIDER: 'real', VEHICLE_API_PROVIDER: 'credify', CREDIFY_BASE_URL: `http://127.0.0.1:${credify.address().port}`, CREDIFY_CLIENT_ID: 'cid', CREDIFY_CLIENT_SECRET: 'sec',
      FEATURE_FREE_FIPE: 'true', FIPE_GUEST_DAILY_LIMIT: '2', ENRICH_FIPE_HISTORY: 'false', PLATE_CACHE_HOURS: '0',
      FIPE_PRIMARY_BASE_URL: 'http://127.0.0.1:9', FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9'
    });
    sa = await adminSession({ server: app, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await app?.stop(); credify?.close(); await pool.end(); });

  async function cliente() {
    const email = `${uid('fl')}@cliente.local`;
    const r = await app.request('/api/auth/register', { method: 'POST', body: { name: 'Cliente Limite', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
    const id = String((await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id);
    return { token: j.token, id };
  }
  const quote = (token) => app.request('/api/fipe/quote', { method: 'POST', token, body: { plate: 'AAA0A00' } });
  async function times(token, n) { const out = []; for (let i = 0; i < n; i++) out.push((await quote(token)).status); return out; }

  it('padrão do sistema: 10 por dia por usuário logado (não os 2 do visitante), e a 11ª é barrada', async () => {
    const s = await sa.call('/api/admin/settings');
    assert.equal(s.json.safe.fipeAuthDailyLimit, 10);
    const c = await cliente();
    const first = await times(c.token, 10);
    assert.deepEqual(first, Array(10).fill(201), first.join(','));
    const over = await quote(c.token);
    assert.equal(over.status, 429); assert.equal((await over.json()).error, 'FIPE_DAILY_LIMIT');
  });

  it('o limite é de cada usuário: o uso de um não gasta o do outro', async () => {
    const a = await cliente(); const b = await cliente();
    await times(a.token, 10);
    assert.equal((await quote(a.token)).status, 429);
    assert.equal((await quote(b.token)).status, 201);
  });

  it('limite próprio da conta vale na hora, para mais ou para menos, e vazio volta ao padrão', async () => {
    const c = await cliente();
    const ficha = await sa.call(`/api/admin/customers/${c.id}/access`);
    assert.equal(ficha.json.fipeDailyLimit, null); assert.equal(ficha.json.fipeDefaultLimit, 10); assert.equal(ficha.json.fipeUsedToday, 0);
    const set3 = await sa.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit: 3 } });
    assert.equal(set3.status, 200, JSON.stringify(set3.json)); assert.equal(set3.json.fipeDailyLimit, 3);
    assert.deepEqual(await times(c.token, 3), [201, 201, 201]);
    assert.equal((await quote(c.token)).status, 429);
    assert.equal((await sa.call(`/api/admin/customers/${c.id}/access`)).json.fipeUsedToday, 3);
    const set20 = await sa.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit: 20 } });
    assert.equal(set20.json.fipeDailyLimit, 20);
    assert.equal((await quote(c.token)).status, 201, 'subir o limite libera na hora');
    const back = await sa.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit: null } });
    assert.equal(back.json.fipeDailyLimit, null);
    assert.ok((await pool.query(`SELECT 1 FROM audit_logs WHERE action='ADMIN_FIPE_LIMIT_UPDATED' AND entity_id=$1`, [c.id])).rowCount >= 3);
  });

  it('padrão global editável no Sistema: vale para quem não tem limite próprio; o limite próprio manda', async () => {
    const own = await cliente(); const plain = await cliente();
    await sa.call(`/api/admin/customers/${own.id}/fipe-limit`, { method: 'PUT', body: { limit: 5 } });
    const patch = await sa.call('/api/admin/settings', { method: 'PATCH', body: { fipeAuthDailyLimit: 2 } });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));
    try {
      assert.deepEqual(await times(plain.token, 2), [201, 201]);
      assert.equal((await quote(plain.token)).status, 429);
      assert.deepEqual(await times(own.token, 5), Array(5).fill(201));
      assert.equal((await quote(own.token)).status, 429);
    } finally { await sa.call('/api/admin/settings', { method: 'PATCH', body: { fipeAuthDailyLimit: 10 } }); }
  });

  it('entradas inválidas e permissão: limite fora de 1 a 100000 é 400; só quem gerencia clientes altera', async () => {
    const c = await cliente();
    for (const limit of [0, -1, 100001, 1.5, '5', undefined]) assert.equal((await sa.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit } })).status, 400, String(limit));
    const fin = await adminSession({ server: app, pool, role: 'FINANCEIRO' });
    assert.equal((await fin.call(`/api/admin/customers/${c.id}/fipe-limit`, { method: 'PUT', body: { limit: 4 } })).status, 403);
    assert.equal((await sa.call('/api/admin/customers/nao-e-id/fipe-limit', { method: 'PUT', body: { limit: 4 } })).status, 404);
    assert.equal((await sa.call('/api/admin/settings', { method: 'PATCH', body: { fipeAuthDailyLimit: 0 } })).status, 400);
  });
});
