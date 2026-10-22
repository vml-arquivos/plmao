import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

describe('teste de SMTP no painel: erro de conexão é diferente de credencial recusada', integration, () => {
  let pool; let server; let adm;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    // porta fechada: nada escuta em 127.0.0.1:1
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test', EMAIL_PROVIDER: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    adm = await adminSession({ server, pool, role: 'ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('servidor inalcançável responde SMTP_CONNECTION_FAILED (502), não "credenciais recusadas"', async () => {
    const r = await adm.call('/api/admin/integrations/email/test', { method: 'POST' });
    assert.equal(r.status, 502, r.text);
    assert.equal(r.json.error, 'SMTP_CONNECTION_FAILED');
  });
});
