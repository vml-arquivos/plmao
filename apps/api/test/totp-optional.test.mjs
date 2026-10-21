import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('2FA opcional da equipe e senha mínima de 8', integration, () => {
  let server; let pool; let totp; let bcrypt;
  const email = `opt-${Math.random().toString(36).slice(2, 8)}@painel.local`;
  const password = 'Senha123';
  const call = (path, opts = {}) => hostRequest(server.base, path, { host: 'admin.placanamao.test', ...opts });
  before(async () => {
    ({ pool } = await loadCore());
    totp = await import('../dist/totp.js');
    bcrypt = (await import('bcryptjs')).default;
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', TEAM_TOTP_REQUIRED: 'false' });
    await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Opcional','SUPER_ADMIN')`, [email, await bcrypt.hash(password, 4)]);
  });
  after(async () => { await server?.stop(); });
  let token; let secret; let recovery;

  it('sem 2FA ativado, a senha basta para entrar', async () => {
    const r = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200);
    assert.equal(r.json.totpRequired, 'NONE');
    assert.ok(r.json.token);
    token = r.json.token;
    const me = await call('/api/admin/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.json.totpEnabled, false);
    assert.equal(me.json.totpRequired, false);
    assert.equal((await call('/api/admin/overview', { token })).status, 200);
  });

  it('ativar: gera chave, exige código válido, devolve códigos de recuperação e mantém a sessão atual', async () => {
    const setup = await call('/api/admin/auth/totp/setup', { method: 'POST', token, body: {} });
    assert.equal(setup.status, 200);
    secret = setup.json.setup.secret;
    assert.match(setup.json.setup.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.equal((await call('/api/admin/auth/totp/enable', { method: 'POST', token, body: { code: '000000' } })).status, 401);
    // outra sessão aberta antes de ativar
    const other = (await call('/api/admin/auth/login', { method: 'POST', body: { email, password } })).json.token;
    const ok = await call('/api/admin/auth/totp/enable', { method: 'POST', token, body: { code: totp.totpCodeAt(secret) } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.recoveryCodes.length, 8);
    recovery = ok.json.recoveryCodes[0];
    assert.equal((await call('/api/admin/overview', { token })).status, 200, 'sessão atual continua');
    assert.equal((await call('/api/admin/overview', { token: other })).status, 401, 'outras sessões são encerradas');
    assert.equal((await call('/api/admin/auth/me', { token })).json.totpEnabled, true);
    assert.equal((await call('/api/admin/auth/totp/setup', { method: 'POST', token, body: {} })).status, 409);
  });

  it('com o 2FA ativado, o login volta a exigir o código', async () => {
    const step = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(step.json.totpRequired, 'VERIFY');
    assert.equal(step.json.token, undefined);
    const ok = await call('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: step.json.challenge, code: totp.totpCodeAt(secret) } });
    assert.equal(ok.status, 200);
    token = ok.json.token;
  });

  it('desativar exige senha e código (aplicativo ou recuperação) e a pessoa volta a entrar só com a senha', async () => {
    assert.equal((await call('/api/admin/auth/totp/disable', { method: 'POST', token, body: { password: 'errada123', code: totp.totpCodeAt(secret) } })).status, 401);
    assert.equal((await call('/api/admin/auth/totp/disable', { method: 'POST', token, body: { password, code: '000000' } })).status, 401);
    assert.equal((await call('/api/admin/auth/totp/disable', { method: 'POST', token, body: { password, code: recovery } })).status, 204);
    assert.equal((await call('/api/admin/auth/me', { token })).json.totpEnabled, false);
    const r = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(r.json.totpRequired, 'NONE');
    assert.equal((await pool.query(`SELECT 1 FROM team_totp t JOIN users u ON u.id=t.user_id WHERE u.email=$1`, [email])).rowCount, 0);
  });

  it('senha nova: 8 caracteres bastam, 7 não', async () => {
    const t = (await call('/api/admin/auth/login', { method: 'POST', body: { email, password } })).json.token;
    assert.equal((await call('/api/admin/auth/change-password', { method: 'POST', token: t, body: { currentPassword: password, newPassword: 'curta12' } })).status, 400);
    assert.equal((await call('/api/admin/auth/change-password', { method: 'POST', token: t, body: { currentPassword: password, newPassword: 'novaSenha' } })).status, 204);
  });

  it('cadastro do cliente aceita senha de 8 e recusa 7', async () => {
    const reg = (n, pw) => fetch(`${server.base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cliente Teste', email: `c-${n}-${Math.random().toString(36).slice(2, 7)}@example.com`, password: pw, acceptTerms: true, acceptPrivacy: true }) });
    assert.equal((await reg(1, 'abcdef1')).status, 400);
    assert.equal((await reg(2, 'abcdefg1')).status, 201);
  });
});

describe('2FA obrigatório por política (TEAM_TOTP_REQUIRED=true)', integration, () => {
  it('quem não tem aplicativo é obrigado a cadastrar e ninguém consegue desativar', async () => {
    useTestEnv();
    const { pool } = await loadCore();
    const bcrypt = (await import('bcryptjs')).default;
    const server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', TEAM_TOTP_REQUIRED: 'true' });
    const email = `req-${Math.random().toString(36).slice(2, 8)}@painel.local`;
    try {
      await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Obrig','SUPER_ADMIN')`, [email, await bcrypt.hash('Senha123', 4)]);
      const r = await hostRequest(server.base, '/api/admin/auth/login', { host: 'admin.placanamao.test', method: 'POST', body: { email, password: 'Senha123' } });
      assert.equal(r.json.totpRequired, 'ENROLL');
      assert.equal(r.json.token, undefined);
    } finally { await server.stop(); await pool.end(); }
  });
});
