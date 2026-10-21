import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv({ EMAIL_MAX_ATTEMPTS: '3' });
const { renderEmail } = await import('../dist/lib/emailTemplates.js');
const outbox = await import('../dist/lib/emailOutbox.js');
const links = await import('../dist/lib/secureLinks.js');

test('backoff cresce e respeita o teto de 6 h', () => {
  assert.ok(outbox.backoffSeconds(1, 0.5) >= 25 && outbox.backoffSeconds(1, 0.5) <= 35);
  assert.ok(outbox.backoffSeconds(3, 0.5) > outbox.backoffSeconds(2, 0.5));
  assert.ok(outbox.backoffSeconds(30, 1) <= 6 * 3600);
});

test('modelos de e-mail não carregam CPF/CNPJ nem relatório e exigem link nos modelos com documento', () => {
  const mail = renderEmail('CONTRACT_SIGN_REQUEST', { name: 'Ana', documentNumber: 'CT-2026-0001', linkPath: '/assinar/{token}', token: 'T'.repeat(43), expiresAt: '2026-10-25T12:00:00Z' });
  assert.match(mail.text, /\/assinar\/T{43}/);
  assert.doesNotMatch(mail.text + mail.html, /\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  assert.throws(() => renderEmail('CONTRACT_SIGN_REQUEST', { name: 'Ana' }), /LINK_REQUIRED/);
  assert.match(renderEmail('GENERIC_NOTICE', { message: '<b>x</b>' }).html, /&lt;b&gt;/);
});

test('assinatura HMAC do webhook: aceita a correta, recusa adulterada e vazia', () => {
  const body = '{"messageId":"<a@b>","event":"delivered"}';
  const sig = createHmac('sha256', 'segredo-do-teste').update(body).digest('hex');
  assert.equal(outbox.verifyEmailWebhookSignature(body, sig, 'segredo-do-teste'), true);
  assert.equal(outbox.verifyEmailWebhookSignature(body, `sha256=${sig}`, 'segredo-do-teste'), true);
  assert.equal(outbox.verifyEmailWebhookSignature(body + ' ', sig, 'segredo-do-teste'), false);
  assert.equal(outbox.verifyEmailWebhookSignature(body, undefined, 'segredo-do-teste'), false);
  assert.equal(outbox.verifyEmailWebhookSignature(body, sig, undefined), false);
});

describe('fila de e-mail (integração)', integration, () => {
  let pool; const created = [];
  before(async () => { ({ pool } = await loadCore()); });
  after(async () => {
    await pool.query('DELETE FROM email_outbox WHERE id = ANY($1::uuid[])', [created]);
    await pool.query(`DELETE FROM secure_links WHERE resource_type='TESTE'`);
  });
  const enqueue = async (extra = {}) => {
    const r = await outbox.enqueueEmail({ idempotencyKey: uid('k'), template: 'CONTRACT_SIGN_REQUEST', toEmail: 'Cliente@Exemplo.com', toName: 'Cliente', data: { name: 'Cliente', documentNumber: 'CT-1', linkPath: '/assinar/{token}', token: 'A'.repeat(43) }, ...extra });
    created.push(r.id); return r;
  };
  const row = async (id) => (await pool.query('SELECT * FROM email_outbox WHERE id=$1', [id])).rows[0];
  const drain = () => pool.query(`UPDATE email_outbox SET next_attempt_at=now() - interval '1 second' WHERE status IN ('AGENDADO','RETRY') AND id = ANY($1::uuid[])`, [created]);

  it('é idempotente: mesma chave não duplica e o e-mail é normalizado', async () => {
    const key = uid('k');
    const a = await enqueue({ idempotencyKey: key }); const b = await enqueue({ idempotencyKey: key });
    assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(a.id, b.id);
    assert.equal((await row(a.id)).to_email, 'cliente@exemplo.com');
  });

  it('recusa destinatário inválido', async () => {
    await assert.rejects(() => outbox.enqueueEmail({ idempotencyKey: uid('k'), template: 'GENERIC_NOTICE', toEmail: 'nao-e-email', data: { message: 'x' } }), /EMAIL_RECIPIENT_INVALID/);
  });

  it('o payload guardado não contém o token em claro e é apagado após o envio', async () => {
    const { id } = await enqueue();
    const before = await row(id);
    assert.doesNotMatch(JSON.stringify(before.payload), /A{43}/);
    assert.ok(before.payload.tokenEnc);
    await drain();
    const sent = []; await outbox.processOutbox({ limit: 50, sender: async (m) => { sent.push(m); return { messageId: m.messageId }; } });
    const mine = sent.find((m) => m.to === 'cliente@exemplo.com' && m.text.includes('A'.repeat(43)));
    assert.ok(mine, 'e-mail enviado com o link');
    assert.match(mine.messageId, /^<outbox-.+@.+>$/);
    const after_ = await row(id);
    assert.equal(after_.status, 'ENVIADO'); assert.equal(after_.payload.tokenEnc, undefined); assert.equal(after_.attempts, 1);
  });

  it('falha transitória agenda nova tentativa e, esgotadas, marca FALHOU', async () => {
    const { id } = await enqueue();
    const failing = async () => { throw new Error('connect ETIMEDOUT'); };
    for (const expected of ['RETRY', 'RETRY', 'FALHOU']) {
      await drain(); await outbox.processOutbox({ limit: 50, sender: failing });
      assert.equal((await row(id)).status, expected);
    }
    const final = await row(id);
    assert.equal(final.attempts, 3); assert.equal(final.payload.tokenEnc, undefined);
    const ev = await pool.query('SELECT event FROM email_events WHERE outbox_id=$1 ORDER BY id', [id]);
    assert.deepEqual(ev.rows.map((e) => e.event), ['AGENDADO', 'RETRY', 'RETRY', 'FALHOU']);
  });

  it('erro permanente (endereço inexistente) falha na primeira tentativa', async () => {
    const { id } = await enqueue();
    await drain(); await outbox.processOutbox({ limit: 50, sender: async () => { throw new Error('550 5.1.1 User unknown'); } });
    assert.equal((await row(id)).status, 'FALHOU'); assert.equal((await row(id)).attempts, 1);
  });

  it('dois processadores concorrentes não enviam o mesmo e-mail duas vezes', async () => {
    const { id } = await enqueue(); await drain();
    let n = 0; const sender = async (m) => { if (m.messageId.includes(id)) n += 1; await new Promise((r) => setTimeout(r, 30)); return { messageId: m.messageId }; };
    await Promise.all([outbox.processOutbox({ limit: 50, sender }), outbox.processOutbox({ limit: 50, sender })]);
    assert.equal(n, 1);
  });

  it('envio travado em ENVIANDO volta para a fila', async () => {
    const { id } = await enqueue();
    await pool.query(`UPDATE email_outbox SET status='ENVIANDO',locked_at=now() - interval '30 minutes' WHERE id=$1`, [id]);
    let n = 0; await outbox.processOutbox({ limit: 50, sender: async (m) => { if (m.messageId.includes(id)) n += 1; return { messageId: m.messageId }; } });
    assert.equal(n, 1); assert.equal((await row(id)).status, 'ENVIADO');
  });

  it('cancelar impede o envio; reenvio só vale para falhos e respeita o limite', async () => {
    const c = await enqueue(); assert.equal(await outbox.cancelEmail(c.id, null), true);
    await drain(); let touched = false; await outbox.processOutbox({ limit: 50, sender: async (m) => { if (m.messageId.includes(c.id)) touched = true; return { messageId: m.messageId }; } });
    assert.equal(touched, false); assert.equal(await outbox.cancelEmail(c.id, null), false);
    const s = await enqueue(); assert.equal(await outbox.resendEmail(s.id, 'u'), 'NOT_ALLOWED');
    const g = await outbox.enqueueEmail({ idempotencyKey: uid('k'), template: 'GENERIC_NOTICE', toEmail: 'x@y.com', data: { message: 'oi' } }); created.push(g.id);
    await pool.query(`UPDATE email_outbox SET status='FALHOU' WHERE id=$1`, [g.id]);
    for (let i = 0; i < 3; i++) { assert.equal(await outbox.resendEmail(g.id, null), 'OK'); await pool.query(`UPDATE email_outbox SET status='FALHOU' WHERE id=$1`, [g.id]); }
    assert.equal(await outbox.resendEmail(g.id, null), 'LIMIT');
    assert.equal(await outbox.resendEmail('00000000-0000-0000-0000-000000000000', null), 'NOT_FOUND');
  });

  it('modelo com link não pode ser reenviado depois que o token foi apagado', async () => {
    const { id } = await enqueue(); await pool.query(`UPDATE email_outbox SET status='FALHOU',payload=payload - 'tokenEnc' WHERE id=$1`, [id]);
    assert.equal(await outbox.resendEmail(id, null), 'NOT_ALLOWED');
  });

  it('eventos de entrega atualizam o estado', async () => {
    const { id } = await enqueue(); await drain();
    await outbox.processOutbox({ limit: 50, sender: async (m) => ({ messageId: m.messageId }) });
    const mid = (await row(id)).message_id;
    assert.equal(await outbox.applyDeliveryEvent(mid, 'delivered'), true); assert.equal((await row(id)).status, 'ENTREGUE');
    assert.equal(await outbox.applyDeliveryEvent('<inexistente@x>', 'delivered'), false);
    assert.equal(await outbox.applyDeliveryEvent(mid, 'bounced', 'caixa cheia'), true); assert.equal((await row(id)).status, 'BOUNCED');
  });

  it('links seguros: expiram, têm limite de uso, podem ser revogados e guardam só o hash', async () => {
    const l = await links.createSecureLink({ purpose: 'CONTRACT_SIGN', resourceType: 'TESTE', resourceId: randomUUID(), maxUses: 2 });
    const stored = await pool.query('SELECT token_hash FROM secure_links WHERE id=$1', [l.id]);
    assert.notEqual(stored.rows[0].token_hash, l.token); assert.equal(stored.rows[0].token_hash, links.hashToken(l.token));
    assert.ok(await links.consumeSecureLink(l.token, ['CONTRACT_SIGN'])); assert.ok(await links.consumeSecureLink(l.token, ['CONTRACT_SIGN']));
    assert.equal(await links.consumeSecureLink(l.token, ['CONTRACT_SIGN']), null, 'limite de usos');
    const w = await links.createSecureLink({ purpose: 'CONTRACT_SIGN', resourceType: 'TESTE', resourceId: randomUUID() });
    assert.equal(await links.consumeSecureLink(w.token, ['FISCAL_DOCUMENT']), null, 'finalidade errada');
    assert.equal(await links.consumeSecureLink('curto', ['CONTRACT_SIGN']), null);
    await pool.query(`UPDATE secure_links SET expires_at=now() - interval '1 minute' WHERE id=$1`, [w.id]);
    assert.equal(await links.consumeSecureLink(w.token, ['CONTRACT_SIGN']), null, 'expirado');
    const r = await links.createSecureLink({ purpose: 'CONTRACT_VIEW', resourceType: 'TESTE', resourceId: randomUUID() });
    await pool.query(`UPDATE secure_links SET revoked_at=now() WHERE id=$1`, [r.id]);
    assert.equal(await links.consumeSecureLink(r.token, ['CONTRACT_VIEW']), null, 'revogado');
  });
});

describe('API da fila e webhook (integração)', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer({ EMAIL_WEBHOOK_SECRET: 'segredo-webhook-de-teste-1234567890' }); });
  after(async () => { await server.stop(); });

  it('só equipe com permissão financeira acessa a fila; cliente e suporte não', async () => {
    const anon = await hostRequest(server.base, '/api/admin/email-outbox', { host: 'admin.placanamao.test' });
    assert.equal(anon.status, 401);
    const suporte = await adminSession({ server, pool, role: 'SUPORTE' });
    assert.equal((await suporte.call('/api/admin/email-outbox')).status, 403);
    const fin = await adminSession({ server, pool, role: 'FINANCEIRO' });
    const list = await fin.call('/api/admin/email-outbox');
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.json).includes('tokenEnc'));
  });

  it('o guard da fila não bloqueia outras rotas /admin de quem tem outra permissão', async () => {
    const suporte = await adminSession({ server, pool, role: 'SUPORTE' });
    const r = await suporte.call('/api/admin/contact-messages');
    assert.notEqual(r.status, 403);
  });

  it('webhook: 401 sem assinatura válida, 200 com assinatura', async () => {
    const body = { messageId: '<nao-existe@x>', event: 'delivered' };
    const bad = await hostRequest(server.base, '/api/webhooks/email', { method: 'POST', body });
    assert.equal(bad.status, 401);
    const sig = createHmac('sha256', 'segredo-webhook-de-teste-1234567890').update(JSON.stringify(body)).digest('hex');
    const url = new URL(server.base + '/api/webhooks/email');
    const ok = await new Promise((resolve, reject) => {
      import('node:http').then(({ default: http }) => {
        const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) })); });
        req.on('error', reject); req.write(JSON.stringify(body)); req.end();
      });
    });
    assert.equal(ok.status, 200); assert.equal(ok.json.applied, false);
  });
});

describe('webhook desligado sem segredo (integração)', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer({ EMAIL_WEBHOOK_SECRET: '' }); });
  after(async () => { await server.stop(); await pool.end(); });
  it('responde 404', async () => {
    const r = await hostRequest(server.base, '/api/webhooks/email', { method: 'POST', body: { messageId: '<a@b>', event: 'delivered' } });
    assert.equal(r.status, 404);
  });
});
