import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

// IA simulada: servidor local no formato OpenAI. O texto "ZZHUMANO" faz a IA pedir uma pessoa.
let llmMode = 'ok';
const llm = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (llmMode === 'down') { res.statusCode = 500; return res.end('x'); }
    const last = JSON.parse(body).messages.at(-1).content;
    const content = /ZZHUMANO/.test(last) ? '[[HUMANO]]' : 'Resposta da IA sobre o assunto.';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise((r) => llm.listen(0, '127.0.0.1', r));
useTestEnv({ SUPPORT_LLM_PROVIDER: 'openai', SUPPORT_LLM_API_KEY: 'chave-de-teste', SUPPORT_LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}/v1`, SUPPORT_ASSISTANT_NAME: 'Renata' });
const A = await import('../dist/lib/supportAssistant.js');
const X = await import('../dist/lib/supportExtras.js');

describe('assistente Renata', integration, () => {
  let pool; let userId; let server;
  before(async () => {
    ({ pool } = await loadCore());
    await pool.query('DELETE FROM support_problem_reports');
    server = await startServer();
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Renata', email: `${uid('r')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201); userId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=12345 WHERE user_id=$1', [userId]);
  });
  after(async () => { await server?.stop(); llm.close(); });

  it('se apresenta na primeira mensagem e oferece atalhos', async () => {
    const r = await A.assistantReply('oi', { userId, first: true });
    assert.equal(r.kind, 'GREETING'); assert.match(r.text, /Sou Renata/); assert.ok(r.suggestions.length >= 3);
  });

  it('preços e conteúdo vêm do catálogo real, sem inventar', async () => {
    const r = await A.assistantReply('quanto custa a consulta?', { userId: null });
    assert.equal(r.kind, 'CATALOG'); assert.match(r.text, /R\$ \d+,\d{2}/);
    const one = await A.assistantReply('o que vem na consulta completa?', { userId: null });
    assert.equal(one.kind, 'CATALOG'); assert.match(one.text, /Traz:/);
  });

  it('é honesta sobre o que não existe (km e fotos)', async () => {
    const r = await A.assistantReply('vocês mostram a quilometragem e fotos do carro?', { userId: null });
    assert.match(r.text, /ainda não são retornados/);
  });

  it('assunto sensível vai para pessoa; visitante sem conta é convidado a entrar', async () => {
    const s = await A.assistantReply('quero meu dinheiro de volta, reembolso', { userId });
    assert.equal(s.escalate, true); assert.equal(s.kind, 'HANDOFF');
    const v = await A.assistantReply('minha consulta não chegou', { userId: null });
    assert.match(v.text, /entre na sua conta/);
  });

  it('conta: saldo, consulta travada vira relato e encaminha para pessoa', async () => {
    const bal = await A.assistantReply('qual o meu saldo?', { userId });
    assert.equal(bal.kind, 'ACCOUNT'); assert.match(bal.text, /R\$ 123,45/);
    const prod = (await pool.query(`SELECT id FROM query_products WHERE active=true AND NOT is_free LIMIT 1`)).rows[0].id;
    await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,created_at) VALUES($1,'ABC1D23',$2,'PROCESSING',1,'mock',now() - interval '30 minutes')`, [userId, prod]);
    const r = await A.assistantReply('minha consulta não chegou', { userId });
    assert.equal(r.escalate, true); assert.equal(r.priority, 'ALTA'); assert.match(r.text, /ABC\*\*\*3/);
    const rep = await pool.query(`SELECT occurrences FROM support_problem_reports WHERE source='CONSULTA' AND status='ABERTO'`);
    assert.ok(rep.rowCount >= 1);
    const again = await A.assistantReply('minha consulta não chegou', { userId });
    assert.equal(again.escalate, true);
    const rep2 = await pool.query(`SELECT occurrences FROM support_problem_reports WHERE source='CONSULTA' AND status='ABERTO'`);
    assert.equal(rep2.rows[0].occurrences, 2, 'repetição soma ocorrências, não abre outro relato');
  });

  it('IA opcional: responde o que as regras não cobrem, pede pessoa quando precisa e cai nas regras se falhar', async () => {
    assert.equal(A.llmEnabled(), true);
    llmMode = 'ok';
    const ok = await A.assistantReply('qual a capital da frança', { userId });
    assert.equal(ok.kind, 'LLM'); assert.match(ok.text, /Resposta da IA/);
    const h = await A.assistantReply('ZZHUMANO quero algo estranho', { userId });
    assert.equal(h.kind, 'HANDOFF'); assert.equal(h.escalate, true);
    llmMode = 'down';
    const down = await A.assistantReply('qual a capital da frança', { userId });
    assert.equal(down.kind, 'TRIAGE'); assert.equal(down.escalate, false);
    llmMode = 'ok';
  });

  it('erros do navegador: dados pessoais saem do texto e repetição agrupa', async () => {
    await X.recordClientError({ message: 'Falha em joao@email.com placa ABC1D23 https://x.com/a?token=segredo', route: '/app/historico/123e4567-e89b-12d3-a456-426614174000?x=1', kind: 'error' });
    await X.recordClientError({ message: 'Falha em maria@email.com placa XYZ9K88 https://x.com/a?token=outro', route: '/app/historico/123e4567-e89b-12d3-a456-426614174111', kind: 'error' });
    const r = await pool.query(`SELECT title,route,detail,occurrences FROM support_problem_reports WHERE source='NAVEGADOR' ORDER BY last_seen DESC LIMIT 1`);
    const row = r.rows[0]; const all = JSON.stringify(row);
    assert.doesNotMatch(all, /@email|ABC1D23|XYZ9K88|segredo|outro|token/); assert.equal(row.route, '/app/historico/:id'); assert.equal(row.occurrences, 2);
  });

  it('API pública: visitante conversa sem login, erro do navegador é aceito e o resto do chat segue protegido', async () => {
    const info = await hostRequest(server.base, '/api/support/assistant/info'); assert.equal(info.json.name, 'Renata');
    const q = await hostRequest(server.base, '/api/support/assistant', { method: 'POST', body: { message: 'qual o preço das consultas?' } });
    assert.equal(q.status, 200); assert.match(q.json.text, /R\$/);
    const sens = await hostRequest(server.base, '/api/support/assistant', { method: 'POST', body: { message: 'quero reembolso' } });
    assert.equal(sens.json.needsLogin, true); assert.match(sens.json.text, /Entre na sua conta/);
    const err = await hostRequest(server.base, '/api/support/client-error', { method: 'POST', body: { message: 'boom', route: '/fipe' } });
    assert.equal(err.status, 204);
    assert.equal((await hostRequest(server.base, '/api/support/client-error', { method: 'POST', body: { message: 'x', extra: 1 } })).status, 400);
    assert.equal((await hostRequest(server.base, '/api/support/conversations')).status, 401);
  });

  it('painel: respostas prontas (criar, duplicar, editar, apagar), relatos e estatísticas; cliente não acessa', async () => {
    const adm = await adminSession({ server, pool });
    const call = (path, opts = {}) => adm.call(`/api${path}`, opts);
    const list = await call('/admin/support/canned'); assert.equal(list.status, 200); assert.ok(list.json.items.length >= 10);
    const t = uid('Resposta');
    const c = await call('/admin/support/canned', { method: 'POST', body: { title: t, body: 'Texto pronto', category: 'GERAL' } }); assert.equal(c.status, 201);
    assert.equal((await call('/admin/support/canned', { method: 'POST', body: { title: t.toUpperCase(), body: 'x', category: 'GERAL' } })).status, 409);
    assert.equal((await call(`/admin/support/canned/${c.json.id}`, { method: 'PATCH', body: { body: 'Novo texto', active: false } })).status, 200);
    assert.equal((await call(`/admin/support/canned/${c.json.id}`, { method: 'DELETE' })).status, 200);
    const pr = await call('/admin/support/problems?status=ABERTO'); assert.equal(pr.status, 200); assert.ok(pr.json.items.length >= 1);
    assert.equal((await call(`/admin/support/problems/${pr.json.items[0].id}`, { method: 'PATCH', body: { status: 'EM_ANALISE', note: 'olhando' } })).status, 200);
    const st = await call('/admin/support/stats'); assert.equal(st.status, 200); assert.ok(st.json.openProblems >= 1);
    const client = await hostRequest(server.base, '/api/admin/support/canned'); assert.ok([401, 403, 404].includes(client.status));
  });
});
