import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';
import { startSmtpSink } from './helpers/smtp.mjs';

describe('e-mail automático: remetente com nome e Reply-To', integration, () => {
  let pool; let server; let smtp;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    smtp = await startSmtpSink();
    server = await startServer({ ...smtp.env(), EMAIL_FROM: 'no-reply@placanamao.test', EMAIL_REPLY_TO: 'placanamao@gmail.com' });
  });
  after(async () => { await server.stop(); await smtp.stop(); await pool.end(); });

  it('link de senha sai como "Placa na Mão <endereço verificado>" e responde para o Gmail', async () => {
    const email = `${uid('rt')}@cli.local`;
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Teste Reply', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    assert.equal((await hostRequest(server.base, '/api/auth/forgot-password', { method: 'POST', body: { email } })).status, 202);
    const mail = smtp.mails.find((m) => m.to.includes(email));
    assert.ok(mail, 'e-mail não chegou ao servidor SMTP');
    assert.match(mail.raw, /^From: .*Placa.*<no-reply@placanamao\.test>/mi);
    assert.match(mail.raw, /^Reply-To: placanamao@gmail\.com/mi);
  });
});
