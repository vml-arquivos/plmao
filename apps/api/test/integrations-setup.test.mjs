import assert from 'node:assert/strict';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const C = await import('../dist/lib/contracts.js');
const M = await import('../dist/lib/contractModels.js');
const Bot = await import('../dist/lib/supportBot.js');
const Seed = await import('../dist/content.seed.js');

test('valor por extenso em reais', () => {
  const t = [[0, 'zero reais'], [100, 'um real'], [150, 'um real e cinquenta centavos'], [180000, 'mil e oitocentos reais'], [125000, 'mil duzentos e cinquenta reais'], [200100, 'dois mil e um reais'], [10000, 'cem reais'], [101, 'um real e um centavo'], [3990, 'trinta e nove reais e noventa centavos'], [123456700, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais']];
  for (const [c, w] of t) assert.equal(C.brlExtenso(c), w, String(c));
});

test('variáveis de minuta: catálogo único, sem duplicadas, todas com exemplo e renderizáveis', () => {
  const keys = M.CONTRACT_VARIABLE_DOCS.map((v) => v.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['valor.total', 'valor.total_extenso', 'desconto.total', 'vigencia.meses', 'comissao.percentual', 'signatario.nome', 'data_extenso']) assert.ok(keys.includes(k), k);
  const out = C.renderBody('Total {{valor.total}} ({{ valor.total_extenso }}) em {{vigencia.meses}} meses.', C.sampleVars());
  assert.match(out, /Total R\$ 1\.800,00 \(mil e oitocentos reais\) em 12 meses\./);
  assert.deepEqual(C.unknownVariables('{{numero}} {{inventada}} {{valor.total}}'), ['inventada']);
  for (const m of M.CONTRACT_MODELS) assert.deepEqual(C.unknownVariables(`${m.title}\n${m.body}`), [], m.code);
});

test('perguntas do atendimento: cada uma casa com a própria pergunta e nenhuma é assunto sensível', () => {
  const faqs = Seed.SUPPORT_FAQS.map((f, i) => ({ id: String(i), question: f.question, answer: f.answer }));
  assert.ok(faqs.length >= 12);
  for (const f of faqs) {
    assert.equal(Bot.matchFaq(f.question, faqs)?.id, f.id, f.question);
    const sens = Bot.sensitiveTopic(f.question); assert.ok(!sens || sens.why === 'credenciais', f.question);
    assert.ok(f.answer.length > 40 && !/R\$\s?\d/.test(f.answer), `resposta sem preço fixo: ${f.question}`);
  }
  const q = (t) => faqs.find((f) => f.id === Bot.matchFaq(t, faqs)?.id)?.question;
  assert.match(q('esqueci minha senha preciso recuperar') ?? '', /^Esqueci minha senha/);
  assert.equal(q('quero falar com uma pessoa da equipe'), 'Como falar com uma pessoa da equipe?');
});

describe('integrações (integração)', integration, () => {
  let server, pool, adm, cont, mockMp;
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ EMAIL_WEBHOOK_SECRET: 'segredo-do-webhook-brevo-0123456789' });
    adm = await adminSession({ server, pool, role: 'ADMIN' }); cont = await adminSession({ server, pool, role: 'CONTEUDO' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('migração 035 publicou as perguntas do atendimento', async () => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM faqs WHERE category IN ('Atendimento','Conta','Empresas','Parceiros') AND active=true`);
    assert.ok(r.rows[0].n >= 6);
  });

  it('painel de integrações: só quem gerencia provedores; mostra estado sem vazar valores', async () => {
    assert.equal((await cont.call('/api/admin/integrations')).status, 403);
    const r = await adm.call('/api/admin/integrations'); assert.equal(r.status, 200);
    const keys = r.json.items.map((i) => i.key); for (const k of ['mercadopago', 'email', 'email-webhook', 'vehicle', 'cnpj', 'esign', 'fiscal']) assert.ok(keys.includes(k), k);
    const hook = r.json.items.find((i) => i.key === 'email-webhook'); assert.equal(hook.state, 'READY'); assert.match(hook.webhookUrl, /\/api\/webhooks\/email\/brevo$/);
    assert.doesNotMatch(JSON.stringify(r.json), /segredo-do-webhook-brevo/);
    const mp = r.json.items.find((i) => i.key === 'mercadopago'); assert.match(mp.webhookUrl, /\/api\/payments\/mercadopago\/webhook$/); assert.notEqual(mp.state, 'READY');
  });

  it('testes de conexão sem chaves respondem erro claro e não chamam ninguém', async () => {
    assert.equal((await cont.call('/api/admin/integrations/mercadopago/test', { method: 'POST' })).status, 403);
    const mp = await adm.call('/api/admin/integrations/mercadopago/test', { method: 'POST' }); assert.equal(mp.status, 409); assert.equal(mp.json.error, 'INTEGRATION_NOT_CONFIGURED');
    const em = await adm.call('/api/admin/integrations/email/test', { method: 'POST' }); assert.equal(em.status, 409);
  });

  const hook = (body, headers = {}) => hostRequest(server.base, '/api/webhooks/email/brevo', { method: 'POST', body, headers });
  it('webhook do Brevo: exige token (x-webhook-token, Bearer ou Basic) e aplica entrega e bounce pelo cabeçalho do envio', async () => {
    const mk = async (suffix) => (await pool.query(`INSERT INTO email_outbox(idempotency_key,template,to_email,subject,payload,status,sent_at,message_id) VALUES($1,'GENERIC_NOTICE','x@exemplo.local','t','{}'::jsonb,'ENVIADO',now(),$2) RETURNING id`, [uid('k'), `<brevo-${suffix}@smtp-relay.brevo.com>`])).rows[0].id;
    const a = await mk(uid()); const b = await mk(uid()); const c = await mk(uid());
    const secret = 'segredo-do-webhook-brevo-0123456789';
    assert.equal((await hook({ event: 'delivered' })).status, 401);
    assert.equal((await hook({ event: 'delivered' }, { 'x-webhook-token': 'errado' })).status, 401);
    const ok = await hook([{ event: 'delivered', 'X-Mailin-custom': `outbox-${a}`, email: 'x@exemplo.local' }, { event: 'hard_bounce', 'X-Mailin-custom': `outbox-${b}`, reason: 'caixa inexistente' }, { event: 'opened', 'X-Mailin-custom': `outbox-${a}` }], { 'x-webhook-token': secret });
    assert.equal(ok.status, 200); assert.equal(ok.json.received, 3); assert.equal(ok.json.applied, 2);
    const st = async (id) => (await pool.query('SELECT status,last_error FROM email_outbox WHERE id=$1', [id])).rows[0];
    assert.equal((await st(a)).status, 'ENTREGUE'); assert.equal((await st(b)).status, 'BOUNCED'); assert.match((await st(b)).last_error, /caixa inexistente/);
    // Bearer e Basic; correlação pelo message-id quando não há cabeçalho custom
    const bearer = await hook({ event: 'spam', 'message-id': (await pool.query('SELECT message_id FROM email_outbox WHERE id=$1', [c])).rows[0].message_id }, { authorization: `Bearer ${secret}` });
    assert.equal(bearer.json.applied, 1); assert.equal((await st(c)).status, 'BOUNCED');
    const basic = await hook({ event: 'soft_bounce', 'X-Mailin-custom': `outbox-${a}`, reason: 'cheia' }, { authorization: `Basic ${Buffer.from(`brevo:${secret}`).toString('base64')}` });
    assert.equal(basic.status, 200); assert.equal((await st(a)).status, 'ENTREGUE', 'soft bounce não derruba um envio já entregue');
    const ev = await pool.query(`SELECT event FROM email_events WHERE outbox_id=$1`, [a]).catch(() => ({ rows: [] }));
    if (ev.rows.length) assert.ok(ev.rows.map((r) => r.event).includes('SOFT_BOUNCE'));
    await pool.query('DELETE FROM email_outbox WHERE id = ANY($1)', [[a, b, c]]);
  });

  it('webhook do Brevo é 404 quando não há segredo configurado', async () => {
    const s2 = await startServer({ EMAIL_WEBHOOK_SECRET: '' });
    try { assert.equal((await hostRequest(s2.base, '/api/webhooks/email/brevo', { method: 'POST', body: {} })).status, 404); } finally { await s2.stop(); }
  });

  it('pré-visualização de minuta com dados de exemplo e catálogo de variáveis', async () => {
    assert.equal((await cont.call('/api/admin/contract-variables')).status, 403);
    const cat = await adm.call('/api/admin/contract-variables'); assert.equal(cat.status, 200); assert.ok(cat.json.items.some((v) => v.key === 'valor.total_extenso'));
    const ok = await adm.call('/api/admin/contract-models/preview', { method: 'POST', body: { title: 'Contrato {{numero}}', body: `${'Texto da cláusula. '.repeat(5)}Total {{valor.total}} por extenso {{valor.total_extenso}}.` } });
    assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.match(ok.json.text, /mil e oitocentos reais/);
    const bad = await adm.call('/api/admin/contract-models/preview', { method: 'POST', body: { title: 'Contrato {{numero}}', body: `${'Texto da cláusula. '.repeat(5)}{{nao_existe}}` } });
    assert.equal(bad.json.ok, false); assert.deepEqual(bad.json.unknown, ['nao_existe']);
    const tpl = (await adm.call('/api/admin/contract-models')).json.items[0];
    const up = await adm.call(`/api/admin/contract-models/${tpl.id}/versions`, { method: 'POST', body: { title: 'Minuta enviada', body: `${'Cláusula com variável. '.repeat(5)}{{inventada}}` } });
    assert.equal(up.status, 400);
  });
});
