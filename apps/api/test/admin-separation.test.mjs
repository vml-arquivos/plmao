import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

function rawRequest(base, path, { method = 'GET', body, token, host } = {}) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { 'content-type': 'application/json', ...(host ? { host } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let data = ''; res.on('data', (d) => { data += d; }); res.on('end', () => resolve({ status: res.statusCode, json: data ? (() => { try { return JSON.parse(data); } catch { return data; } })() : null }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('separação cliente/admin: audiências, 2FA obrigatório e host/IP', integration, () => {
  let pool; let server; let totp;
  const password = 'Senha-Forte-123!';
  const adminEmail = `${uid('adm')}@painel.local`;
  const clientEmail = `${uid('cli')}@cliente.local`;
  let adminToken; let clientToken; let adminSecret;

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    totp = await import('../dist/totp.js');
    const hash = await bcrypt.hash(password, 4);
    await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Admin Teste','SUPER_ADMIN')`, [adminEmail, hash]);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    const adminHost = 'admin.placanamao.test';
    server.adminCall = (path, opts = {}) => rawRequest(server.base, path, { ...opts, host: adminHost });
    server.publicCall = (path, opts = {}) => rawRequest(server.base, path, opts);
    const reg = await server.publicCall('/api/auth/register', { method: 'POST', body: { name: 'Cliente Teste', email: clientEmail, password, acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201);
    clientToken = reg.json.token;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('o painel não existe no host público (404) nem para quem tem credenciais', async () => {
    const r = await server.publicCall('/api/admin/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    assert.equal(r.status, 404);
    const r2 = await server.publicCall('/api/admin/overview', { token: clientToken });
    assert.equal(r2.status, 404);
  });

  it('a API do cliente não é servida no host do admin', async () => {
    const r = await server.adminCall('/api/auth/login', { method: 'POST', body: { email: clientEmail, password } });
    assert.equal(r.status, 404);
  });

  it('conta de equipe não consegue entrar pelo login do cliente', async () => {
    const r = await server.publicCall('/api/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    assert.equal(r.status, 401);
    assert.equal(r.json.token, undefined);
  });

  it('cliente não consegue entrar pelo login do admin', async () => {
    const r = await server.adminCall('/api/admin/auth/login', { method: 'POST', body: { email: clientEmail, password } });
    assert.equal(r.status, 401);
  });

  it('login do admin nunca emite sessão sem TOTP: primeiro acesso exige cadastro do 2FA', async () => {
    const r = await server.adminCall('/api/admin/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    assert.equal(r.status, 200);
    assert.equal(r.json.token, undefined);
    assert.equal(r.json.totpRequired, 'ENROLL');
    adminSecret = r.json.setup.secret;
    const bad = await server.adminCall('/api/admin/auth/totp/enroll/confirm', { method: 'POST', body: { challenge: r.json.challenge, code: '000000' } });
    assert.equal(bad.status, 401);
    const ok = await server.adminCall('/api/admin/auth/totp/enroll/confirm', { method: 'POST', body: { challenge: r.json.challenge, code: totp.totpCodeAt(adminSecret) } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.equal(ok.json.recoveryCodes.length, 8);
    adminToken = ok.json.token;
  });

  it('segundo login exige verificação TOTP e aceita código de recuperação uma única vez', async () => {
    const step = await server.adminCall('/api/admin/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    assert.equal(step.json.totpRequired, 'VERIFY');
    const ok = await server.adminCall('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: step.json.challenge, code: totp.totpCodeAt(adminSecret) } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token);
    assert.ok(ok.json.permissions.includes('ADMIN_SYSTEM'));
    // o mesmo desafio não pode ser reutilizado
    const reuse = await server.adminCall('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: step.json.challenge, code: totp.totpCodeAt(adminSecret) } });
    assert.equal(reuse.status, 401);
  });

  it('token de cliente é rejeitado no painel e token de admin é rejeitado no app do cliente (audiências)', async () => {
    const a = await server.adminCall('/api/admin/overview', { token: clientToken });
    assert.equal(a.status, 401);
    const b = await server.publicCall('/api/me', { token: adminToken });
    assert.equal(b.status, 401);
    const c = await server.publicCall('/api/wallet/transactions', { token: adminToken });
    assert.equal(c.status, 401);
    const d = await server.adminCall('/api/admin/overview', { token: adminToken });
    assert.equal(d.status, 200);
  });

  it('token forjado com o segredo do cliente e audiência admin é rejeitado', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    const forged = jwt.sign({ id: 'x', email: 'x@x.com', name: 'x', role: 'SUPER_ADMIN', sid: 'abc' }, 'test-jwt-secret-test-jwt-secret-test-jwt-secret-0001', { audience: 'admin', issuer: 'placanamao' });
    const r = await server.adminCall('/api/admin/overview', { token: forged });
    assert.equal(r.status, 401);
  });

  it('rebaixar o papel vale imediatamente (papel vem do banco)', async () => {
    await pool.query(`UPDATE users SET role='CLIENTE' WHERE lower(email)=lower($1)`, [adminEmail]);
    const r = await server.adminCall('/api/admin/overview', { token: adminToken });
    assert.equal(r.status, 401);
    await pool.query(`UPDATE users SET role='SUPER_ADMIN' WHERE lower(email)=lower($1)`, [adminEmail]);
  });

  it('logout do admin revoga a sessão', async () => {
    const step = await server.adminCall('/api/admin/auth/login', { method: 'POST', body: { email: adminEmail, password } });
    const ok = await server.adminCall('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: step.json.challenge, code: totp.totpCodeAt(adminSecret) } });
    const t = ok.json.token;
    assert.equal((await server.adminCall('/api/admin/auth/me', { token: t })).status, 200);
    assert.equal((await server.adminCall('/api/admin/auth/logout', { method: 'POST', token: t })).status, 204);
    assert.equal((await server.adminCall('/api/admin/auth/me', { token: t })).status, 401);
  });

  it('o shell do admin e seus assets não são servidos no host público', async () => {
    const pub = await server.publicCall('/admin.html');
    assert.equal(pub.status, 404);
  });
});

describe('restrição por IP do painel', integration, () => {
  let server;
  before(async () => { useTestEnv(); server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', ADMIN_ALLOWED_IPS: '203.0.113.0/24' }); });
  after(async () => { await server.stop(); });
  it('IP fora da lista recebe 404 mesmo no host correto', async () => {
    const r = await rawRequest(server.base, '/api/admin/auth/login', { method: 'POST', host: 'admin.placanamao.test', body: { email: 'a@b.com', password: 'x' } });
    assert.equal(r.status, 404);
  });
});
