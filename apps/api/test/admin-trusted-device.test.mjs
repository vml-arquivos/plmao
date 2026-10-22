import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('painel: 2FA opcional e computador confiável', integration, () => {
  let pool; let server; const email = `${uid('conf')}@painel.local`; const password = 'Senha-Forte-123!';
  const call = (path, opts = {}) => hostRequest(server.base, path, { host: 'admin.placanamao.test', ...opts });
  before(async () => { useTestEnv(); ({ pool } = await loadCore()); server = await startServer({ TEAM_TOTP_REQUIRED: 'false', ADMIN_HOSTS: 'admin.placanamao.test' }); });
  after(async () => { await server?.stop(); await pool?.end(); });

  it('sem 2FA ativado, entra só com a senha; depois ativa, e o computador confiável pula o código', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const { totpCodeAt } = await import('../dist/totp.js');
    await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,'Equipe Teste','SUPER_ADMIN')`, [email, await bcrypt.hash(password, 4)]);
    const first = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(first.json.totpRequired, 'NONE');
    assert.ok(first.json.token);
    // ativa o 2FA pela própria conta
    const setup = await call('/api/admin/auth/totp/setup', { method: 'POST', token: first.json.token, body: {} });
    const secret = setup.json.setup.secret;
    assert.equal((await call('/api/admin/auth/totp/enable', { method: 'POST', token: first.json.token, body: { code: totpCodeAt(secret) } })).status, 200);
    // agora pede o código; marca "confiar neste computador"
    const login = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(login.json.totpRequired, 'VERIFY');
    const ver = await call('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: login.json.challenge, code: totpCodeAt(secret), trustDevice: true } });
    assert.equal(ver.status, 200);
    assert.match(ver.json.deviceToken, /^[A-Za-z0-9_-]{30,100}$/);
    const saved = await pool.query('SELECT token_hash FROM admin_trusted_devices');
    assert.ok(saved.rows.every((r) => r.token_hash !== ver.json.deviceToken)); // só o hash fica guardado
    // com o token do aparelho, entra sem código; com token errado, pede o código
    const trusted = await call('/api/admin/auth/login', { method: 'POST', body: { email, password, deviceToken: ver.json.deviceToken } });
    assert.equal(trusted.json.totpRequired, 'NONE');
    assert.equal(trusted.json.trusted, true);
    const me = await call('/api/admin/auth/me', { token: trusted.json.token });
    assert.equal(me.status, 200);
    const wrong = await call('/api/admin/auth/login', { method: 'POST', body: { email, password, deviceToken: 'x'.repeat(48) } });
    assert.equal(wrong.json.totpRequired, 'VERIFY');
    // senha errada nunca é salva pelo token
    assert.equal((await call('/api/admin/auth/login', { method: 'POST', body: { email, password: 'errada-errada', deviceToken: ver.json.deviceToken } })).status, 401);
    // lista e remove
    const list = await call('/api/admin/auth/devices', { token: trusted.json.token });
    assert.equal(list.json.items.length, 1);
    assert.equal((await call(`/api/admin/auth/devices/${list.json.items[0].id}`, { method: 'DELETE', token: trusted.json.token })).status, 204);
    const after = await call('/api/admin/auth/login', { method: 'POST', body: { email, password, deviceToken: ver.json.deviceToken } });
    assert.equal(after.json.totpRequired, 'VERIFY');
  });

  it('trocar a senha remove os computadores confiáveis', async () => {
    const { totpCodeAt } = await import('../dist/totp.js');
    const { rows } = await pool.query(`SELECT t.encrypted_secret FROM team_totp t JOIN users u ON u.id=t.user_id WHERE u.email=$1`, [email]);
    const { decryptTotpSecret } = await import('../dist/totp.js');
    const secret = decryptTotpSecret(rows[0].encrypted_secret);
    const login = await call('/api/admin/auth/login', { method: 'POST', body: { email, password } });
    const ver = await call('/api/admin/auth/totp/verify', { method: 'POST', body: { challenge: login.json.challenge, code: totpCodeAt(secret), trustDevice: true } });
    assert.ok(ver.json.deviceToken);
    assert.equal((await call('/api/admin/auth/change-password', { method: 'POST', token: ver.json.token, body: { currentPassword: password, newPassword: 'Outra-Senha-456!' } })).status, 204);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM admin_trusted_devices')).rows[0].n, 0);
  });
});
