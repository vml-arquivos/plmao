import assert from 'node:assert/strict';
import http from 'node:http';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const bot = await import('../dist/lib/supportBot.js');

test('redação: mascara cartão válido (Luhn) e preserva números comuns', () => {
  const r = bot.redactSensitive('meu cartão é 4111 1111 1111 1111 ok');
  assert.equal(r.redacted, true); assert.match(r.text, /\*\*\*\* 1111/); assert.doesNotMatch(r.text, /4111 1111/);
  const n = bot.redactSensitive('protocolo 1234567890123 e telefone 61999998888');
  assert.equal(n.redacted, false); assert.equal(n.text, 'protocolo 1234567890123 e telefone 61999998888');
});

test('assuntos sensíveis nunca ficam com o bot', () => {
  for (const [t, p] of [['quero reembolso do meu pagamento', 'ALTA'], ['isso foi golpe, fraude', 'URGENTE'], ['quero apagar meus dados pela LGPD', 'ALTA'], ['esqueci minha senha', 'NORMAL']]) assert.equal(bot.sensitiveTopic(t)?.priority, p, t);
  assert.equal(bot.sensitiveTopic('como funciona a consulta completa'), null);
});

test('FAQ só casa com forte sobreposição e nunca inventa', () => {
  const faqs = [{ id: '1', question: 'Quanto tempo leva para receber o relatório da consulta?', answer: 'Em segundos.' }, { id: '2', question: 'Quais formas de pagamento são aceitas?', answer: 'Pix e cartão.' }];
  assert.equal(bot.matchFaq('quanto tempo leva o relatório da consulta', faqs)?.id, '1');
  assert.equal(bot.matchFaq('formas de pagamento aceitas', faqs)?.id, '2');
  assert.equal(bot.matchFaq('qual o prazo do meu processo judicial', faqs), null);
  assert.equal(bot.matchFaq('oi', faqs), null);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
function upload(base, path, token, buf, type, host) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: { 'content-type': type, 'content-length': buf.length, authorization: `Bearer ${token}`, ...(host ? { host } : {}) } }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch { /* */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); r.write(buf); r.end();
  });
}
function download(base, path, token, host) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => http.get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { authorization: `Bearer ${token}`, ...(host ? { host } : {}) } }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); }).on('error', reject));
}

describe('chat de suporte (integração)', integration, () => {
  let server, pool, A, B, sup, adm, conteudo, faqId;
  const register = async (name) => { const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('c')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } }); assert.equal(r.status, 201); return { token: r.json.token, id: r.json.user.id, call: (path, opts = {}) => hostRequest(server.base, path, { token: r.json.token, ...opts }) }; };
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer();
    A = await register('Ana Cliente'); B = await register('Beto Cliente');
    sup = await adminSession({ server, pool, role: 'SUPORTE' }); adm = await adminSession({ server, pool, role: 'ADMIN' }); conteudo = await adminSession({ server, pool, role: 'CONTEUDO' });
    faqId = (await pool.query(`INSERT INTO faqs(category,question,answer) VALUES('Teste','Quanto tempo leva para chegar o relatório da consulta veicular?','O relatório fica pronto em poucos segundos.') RETURNING id`)).rows[0].id;
  });
  after(async () => { await pool.query('DELETE FROM faqs WHERE id=$1', [faqId]); await server.stop(); await pool.end(); });

  const start = (c, message, extra = {}) => c.call('/api/support/conversations', { method: 'POST', body: { subject: 'Dúvida', category: 'DUVIDA', message, ...extra } });
  const botText = (conv) => conv.messages.filter((m) => m.sender_type === 'BOT').map((m) => m.body).join(' ');

  it('bot responde pela FAQ publicada, oferece falar com pessoa e não encaminha sozinho', async () => {
    const r = await start(A, 'quanto tempo leva o relatório da consulta veicular');
    assert.equal(r.status, 201); assert.equal(r.json.handler, 'BOT'); assert.match(botText(r.json), /poucos segundos/); assert.match(botText(r.json), /falar com uma pessoa/);
  });

  it('sem resposta pronta, o bot não inventa: orienta a falar com uma pessoa', async () => {
    const r = await start(A, 'qual a previsão de lançamento do aplicativo para televisores');
    assert.match(botText(r.json), /Não encontrei uma resposta pronta/); assert.equal(r.json.status, 'ABERTA');
  });

  it('reembolso/cobrança vai direto para uma pessoa, com prioridade alta, e nada é alterado', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM payment_orders WHERE user_id=$1', [A.id])).rows[0].n;
    const r = await start(A, 'quero reembolso da minha última cobrança', { category: 'PAGAMENTO' });
    assert.equal(r.json.handler, 'HUMAN'); assert.equal(r.json.status, 'AGUARDANDO_ATENDENTE');
    assert.match(botText(r.json), /não faz reembolsos, não altera cobranças/);
    const row = (await pool.query('SELECT priority FROM support_conversations WHERE id=$1', [r.json.id])).rows[0];
    assert.equal(row.priority, 'ALTA');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_orders WHERE user_id=$1', [A.id])).rows[0].n, before);
  });

  it('número de cartão é ocultado antes de gravar', async () => {
    const r = await start(A, 'paguei com 4111 1111 1111 1111 e deu erro');
    const first = r.json.messages.find((m) => m.sender_type === 'CLIENTE');
    assert.doesNotMatch(first.body, /4111 1111/); assert.match(first.body, /\*\*\*\* 1111/);
    assert.ok(r.json.messages.some((m) => m.sender_type === 'SISTEMA' && /ocultado/.test(m.body)));
    const raw = await pool.query(`SELECT count(*)::int AS n FROM support_messages WHERE conversation_id=$1 AND body LIKE '%4111 1111%'`, [r.json.id]);
    assert.equal(raw.rows[0].n, 0);
  });

  it('isolamento: outro cliente não lê, escreve, escala, resolve nem baixa anexo; listas só mostram o próprio', async () => {
    const c = await start(A, 'quanto tempo leva o relatório da consulta veicular'); const id = c.json.id;
    const up = await upload(server.base, `/api/support/conversations/${id}/attachments?name=comprovante.png`, A.token, PNG, 'image/png');
    assert.equal(up.status, 201);
    for (const [method, path, body] of [['GET', `/api/support/conversations/${id}`], ['POST', `/api/support/conversations/${id}/messages`, { body: 'oi' }], ['POST', `/api/support/conversations/${id}/human`], ['POST', `/api/support/conversations/${id}/resolve`], ['GET', `/api/support/attachments/${up.json.id}`]]) {
      const r = await B.call(path, { method, body }); assert.equal(r.status, 404, `${method} ${path}`);
    }
    assert.equal((await upload(server.base, `/api/support/conversations/${id}/attachments?name=x.png`, B.token, PNG, 'image/png')).status, 404);
    const list = await B.call('/api/support/conversations'); assert.ok(list.json.items.every((i) => i.id !== id));
    assert.equal((await hostRequest(server.base, `/api/support/conversations/${id}`)).status, 401);
  });

  it('vínculo com consulta/pedido só vale para itens da própria conta', async () => {
    const C = await register('Cliente V');
    const q = (await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider) SELECT $1,'ABC1D23',id,'SUCCESS',0,'mock' FROM query_products LIMIT 1 RETURNING id`, [C.id])).rows[0];
    const own = await start(C, 'dúvida sobre esta consulta', { related: { type: 'QUERY', id: q.id } });
    assert.equal(own.status, 201); assert.equal(own.json.relatedType, 'QUERY');
    const other = await start(B, 'dúvida sobre esta consulta', { related: { type: 'QUERY', id: q.id } });
    assert.equal(other.status, 404);
    await pool.query('DELETE FROM vehicle_queries WHERE id=$1', [q.id]);
  });

  it('equipe: permissão, nota interna invisível ao cliente, resposta, atribuição e transferência', async () => {
    const C = await register('Cliente '+Math.random());
    const c = await start(C, 'preciso de ajuda com minha conta', { category: 'CONTA' }); const id = c.json.id;
    assert.equal((await C.call(`/api/support/conversations/${id}/human`, { method: 'POST' })).status, 200);
    assert.equal((await C.call('/api/admin/support/conversations')).status, 401, 'token de cliente não abre o painel');
    assert.equal((await conteudo.call('/api/admin/support/conversations')).status, 403);
    const inbox = await sup.call('/api/admin/support/conversations?status=AGUARDANDO_ATENDENTE'); assert.ok(inbox.json.items.some((i) => i.id === id));
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'Cliente tem histórico de chargeback', internal: true } })).status, 201);
    const mid = await sup.call(`/api/admin/support/conversations/${id}`);
    assert.ok(mid.json.messages.some((m) => m.internal && /chargeback/.test(m.body)));
    const view = await C.call(`/api/support/conversations/${id}`);
    assert.ok(!JSON.stringify(view.json).includes('chargeback'), 'cliente não vê nota interna');
    assert.equal(view.json.status, 'AGUARDANDO_ATENDENTE', 'nota interna não muda o estado');
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'Olá! Já estou verificando.' } })).status, 201);
    const after1 = await sup.call(`/api/admin/support/conversations/${id}`);
    assert.equal(after1.json.status, 'AGUARDANDO_CLIENTE'); assert.ok(after1.json.assignedTo, 'quem responde assume');
    const mail = (await pool.query(`SELECT payload,to_email FROM email_outbox WHERE related_type='SUPPORT_CONVERSATION' AND related_id=$1`, [id])).rows;
    assert.ok(mail.length >= 1); assert.ok(!JSON.stringify(mail).includes('verificando'), 'e-mail não leva o conteúdo');
    await C.call(`/api/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'Obrigada' } });
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}`)).json.status, 'EM_ATENDIMENTO');
    // atribuição e transferência
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/assign`, { method: 'POST', body: { userId: C.id } })).status, 422, 'cliente não atende');
    const conteudoUser = (await pool.query(`SELECT id FROM users WHERE email=$1`, [conteudo.email])).rows[0].id;
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/assign`, { method: 'POST', body: { userId: conteudoUser } })).status, 422, 'conteúdo não atende');
    const admUser = (await pool.query(`SELECT id FROM users WHERE email=$1`, [adm.email])).rows[0].id;
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/assign`, { method: 'POST', body: { userId: admUser, note: 'caso de cobrança' } })).status, 200);
    const ev = (await sup.call(`/api/admin/support/conversations/${id}`)).json.events.map((e) => e.event);
    assert.ok(ev.includes('TRANSFERIDA')); assert.ok(ev.includes('RESPOSTA_DA_EQUIPE')); assert.ok(ev.includes('NOTA_INTERNA'));
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/priority`, { method: 'POST', body: { priority: 'URGENTE' } })).status, 200);
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE entity_id=$1`, [id]); assert.ok(audit.rows.some((a) => a.action === 'SUPPORT_ASSIGNED'));
  });

  it('estados: resolvida reabre pelo cliente; encerrada não aceita mensagem do cliente nem resposta pública', async () => {
    const C = await register('Cliente '+Math.random());
    const c = await start(C, 'preciso falar sobre minha consulta', { category: 'CONSULTA' }); const id = c.json.id;
    await C.call(`/api/support/conversations/${id}/human`, { method: 'POST' });
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/status`, { method: 'POST', body: { status: 'RESOLVIDA' } })).status, 200);
    await C.call(`/api/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'Ainda não resolveu' } });
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}`)).json.status, 'AGUARDANDO_ATENDENTE');
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/status`, { method: 'POST', body: { status: 'ENCERRADA' } })).status, 200);
    const w = await C.call(`/api/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'oi?' } });
    assert.equal(w.status, 409); assert.equal(w.json.error, 'SUPPORT_CONVERSATION_CLOSED');
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'resposta tardia' } })).status, 409);
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/messages`, { method: 'POST', body: { body: 'nota pós-encerramento', internal: true } })).status, 201);
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/status`, { method: 'POST', body: { status: 'EM_ATENDIMENTO' } })).status, 409, 'encerrada não reabre pela equipe');
    assert.equal((await sup.call(`/api/admin/support/conversations/${id}/status`, { method: 'POST', body: { status: 'INVALIDO' } })).status, 400);
  });

  it('anexos: só tipos permitidos pelo conteúdo real, até 2 MB, nome saneado e download protegido', async () => {
    const C = await register('Cliente '+Math.random());
    const c = await start(C, 'vou enviar um comprovante'); const id = c.json.id;
    const fake = await upload(server.base, `/api/support/conversations/${id}/attachments?name=virus.png`, C.token, Buffer.from('MZ\x90\x00 executável disfarçado'), 'image/png');
    assert.equal(fake.status, 415);
    assert.equal((await upload(server.base, `/api/support/conversations/${id}/attachments?name=x.exe`, C.token, PNG, 'application/octet-stream')).status, 415);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    assert.equal((await upload(server.base, `/api/support/conversations/${id}/attachments?name=grande.png`, C.token, big, 'image/png')).status, 413);
    const ok = await upload(server.base, `/api/support/conversations/${id}/attachments?name=${encodeURIComponent('../../etc/passwd<script>.png')}`, C.token, PNG, 'image/png');
    assert.equal(ok.status, 201);
    const stored = (await pool.query('SELECT file_name FROM support_attachments WHERE id=$1', [ok.json.id])).rows[0].file_name;
    assert.doesNotMatch(stored, /[\/<>]/);
    const mine = await download(server.base, `/api/support/attachments/${ok.json.id}`, C.token);
    assert.equal(mine.status, 200); assert.equal(mine.headers['x-content-type-options'], 'nosniff'); assert.match(mine.headers['content-disposition'], /^attachment/); assert.ok(mine.body.equals(PNG));
    assert.equal((await download(server.base, `/api/support/attachments/${ok.json.id}`, B.token)).status, 404);
    const staff = await download(server.base, `/api/admin/support/attachments/${ok.json.id}`, sup.token, 'admin.placanamao.test');
    assert.equal(staff.status, 200);
  });
});
