import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { emailAllowed } = await import('../dist/siteAccess.js');

it('lista de e-mails aceita endereço completo e @domínio, sem diferenciar maiúsculas', () => {
  assert.equal(emailAllowed('Dono@Exemplo.com', 'dono@exemplo.com'), true);
  assert.equal(emailAllowed('ana@equipe.com.br', '@equipe.com.br, outro@x.com'), true);
  assert.equal(emailAllowed('ana@outra.com', '@equipe.com.br'), false);
  assert.equal(emailAllowed('xana@equipe.com.br.fake.com', '@equipe.com.br'), false);
  assert.equal(emailAllowed('qualquer@x.com', ''), false);
});

describe('modo pré-lançamento: sem indexação e sem cadastro/pagamento público', integration, () => {
  let pool; let closed; let open;
  const reg = (srv, email) => hostRequest(srv.base, '/api/auth/register', { method: 'POST', body: { name: 'Pessoa Teste', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    closed = await startServer({ SITE_MODE: 'prelaunch', PRELAUNCH_ALLOWED_EMAILS: 'dono@placa.test,@equipe.test' });
    open = await startServer();
  });
  after(async () => { await closed.stop(); await open.stop(); await pool.end(); });

  it('robots.txt bloqueia tudo, sitemap some e toda resposta leva noindex', async () => {
    const robots = await fetch(`${closed.base}/robots.txt`);
    assert.match(await robots.text(), /Disallow: \/\n/);
    assert.equal((await fetch(`${closed.base}/sitemap.xml`)).status, 404);
    const health = await fetch(`${closed.base}/health`);
    assert.match(health.headers.get('x-robots-tag') ?? '', /noindex/);
    const home = await fetch(`${closed.base}/`);
    assert.match(home.headers.get('x-robots-tag') ?? '', /noindex/);
    const html = await home.text();
    if (html.includes('<meta name="robots"')) assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive" \/>/);
  });

  it('site aberto continua indexável', async () => {
    assert.match(await (await fetch(`${open.base}/robots.txt`)).text(), /Allow: \//);
    assert.equal((await fetch(`${open.base}/health`)).headers.get('x-robots-tag'), null);
  });

  it('cadastro só para a lista; quem está fora recebe aviso e nada é criado', async () => {
    const outsider = `${uid('fora')}@cliente.local`;
    const no = await reg(closed, outsider);
    assert.equal(no.status, 403); assert.equal(no.json.error, 'SITE_NOT_OPEN');
    assert.match(no.json.message, /ainda não está aberto/);
    assert.equal((await pool.query('SELECT 1 FROM users WHERE email=$1', [outsider])).rowCount, 0);
    const byDomain = await reg(closed, `${uid('t')}@equipe.test`);
    assert.equal(byDomain.status, 201, byDomain.text);
  });

  it('conta que não está na lista não paga nem consulta, mesmo já existindo', async () => {
    const created = await reg(open, `${uid('antigo')}@cliente.local`);
    assert.equal(created.status, 201, created.text);
    await pool.query('UPDATE wallets SET balance_cents=50000 WHERE user_id=$1', [created.json.user.id]);
    const token = created.json.token;
    const q = await hostRequest(closed.base, '/api/queries', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(q.status, 403); assert.equal(q.json.error, 'SITE_NOT_OPEN');
    const c = await hostRequest(closed.base, '/api/payments/query/checkout', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(c.status, 403);
    const p = await hostRequest(closed.base, '/api/payments/checkout', { method: 'POST', token, body: { packageSlug: 'essencial' } });
    assert.equal(p.status, 403);
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [created.json.user.id])).rows[0].balance_cents), 50000);
    // a mesma conta, no site aberto, consulta normalmente
    const ok = await hostRequest(open.base, '/api/queries', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(ok.status, 201, ok.text);
  });

  it('conta da lista consulta normalmente', async () => {
    const mine = await reg(closed, `${uid('eq')}@equipe.test`);
    await pool.query('UPDATE wallets SET balance_cents=50000 WHERE user_id=$1', [mine.json.user.id]);
    const ok = await hostRequest(closed.base, '/api/queries', { method: 'POST', token: mine.json.token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(ok.status, 201, ok.text);
  });
});
