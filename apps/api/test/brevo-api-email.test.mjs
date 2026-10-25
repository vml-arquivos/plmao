import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it, before, after } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

/** API do Brevo falsa: só aceita a chave "boa" e guarda o que recebe. */
function fakeBrevo() {
  const sent = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const ok = req.headers['api-key'] === 'chave-boa';
      res.setHeader('content-type', 'application/json');
      if (!ok) { res.statusCode = 401; res.end('{"message":"Key not found"}'); return; }
      if (req.method === 'GET' && req.url === '/v3/account') { res.end('{"email":"x@y.z"}'); return; }
      if (req.method === 'POST' && req.url === '/v3/smtp/email') { sent.push(JSON.parse(body)); res.statusCode = 201; res.end('{"messageId":"<abc@smtp-relay.mailin.fr>"}'); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    sent, base: `http://127.0.0.1:${server.address().port}/v3`, stop: () => new Promise((r) => server.close(r))
  })));
}

describe('e-mail pela API do Brevo (porta 443, sem SMTP)', integration, () => {
  let pool; let api; let good; let bad; let admGood; let admBad;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    api = await fakeBrevo();
    const common = { ADMIN_HOSTS: 'admin.placanamao.test', EMAIL_PROVIDER: 'brevo_api', BREVO_API_BASE_URL: api.base, EMAIL_FROM: 'no-reply@placanamao.test', EMAIL_REPLY_TO: 'placanamao@gmail.com' };
    good = await startServer({ ...common, BREVO_API_KEY: 'chave-boa' });
    bad = await startServer({ ...common, BREVO_API_KEY: 'chave-ruim' });
    admGood = await adminSession({ server: good, pool, role: 'ADMIN' });
    admBad = await adminSession({ server: bad, pool, role: 'ADMIN' });
  });
  after(async () => { await good.stop(); await bad.stop(); await api.stop(); await pool.end(); });

  it('link de senha vai pela API com remetente, nome, Reply-To e assunto', async () => {
    const email = `${uid('api')}@cli.local`;
    assert.equal((await hostRequest(good.base, '/api/auth/register', { method: 'POST', body: { name: 'Teste Api', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } })).status, 201);
    assert.equal((await hostRequest(good.base, '/api/auth/forgot-password', { method: 'POST', body: { email } })).status, 202);
    const m = api.sent.find((x) => x.to?.some((t) => t.email === email));
    assert.ok(m, 'a API do Brevo não recebeu o e-mail');
    assert.equal(m.sender.email, 'no-reply@placanamao.test');
    assert.match(m.sender.name, /Placa/);
    assert.equal(m.replyTo.email, 'placanamao@gmail.com');
    assert.match(m.subject, /senha/i);
    assert.match(m.htmlContent, /reset_token=/);
  });

  it('teste do painel: chave boa passa; chave errada vira "credenciais recusadas" (422)', async () => {
    const ok = await admGood.call('/api/admin/integrations/email/test', { method: 'POST' });
    assert.equal(ok.status, 200, ok.text);
    const no = await admBad.call('/api/admin/integrations/email/test', { method: 'POST' });
    assert.equal(no.status, 422, no.text);
    assert.equal(no.json.error, 'INTEGRATION_CREDENTIALS_REJECTED');
  });
});
