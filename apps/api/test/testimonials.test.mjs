import assert from 'node:assert/strict';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const T = await import('../dist/lib/testimonials.js');

test('conteúdo: bloqueia links, e-mails e números longos; hash muda com qualquer edição', () => {
  assert.ok(T.contentProblem('Ana', 'veja www.meusite.com'));
  assert.ok(T.contentProblem('Ana', 'me escreva em ana@x.com'));
  assert.ok(T.contentProblem('Ana', 'liga 61 99999-8888 agora'));
  assert.equal(T.contentProblem('Ana S.', 'Consulta rápida e relatório claro, recomendo.'), null);
  const h = T.contentHash('Ana', 'texto de teste ok', 'v1');
  assert.notEqual(h, T.contentHash('Ana', 'texto de teste ok!', 'v1'));
  assert.notEqual(h, T.contentHash('Ana', 'texto de teste ok', 'v2'));
});

describe('depoimentos (integração)', integration, () => {
  let server, pool, A, B, cont, cont2, sup;
  const register = async (name) => { const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('d')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } }); assert.equal(r.status, 201); return { token: r.json.token, id: r.json.user.id, call: (path, opts = {}) => hostRequest(server.base, path, { token: r.json.token, ...opts }) }; };
  const buy = (c) => pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider) SELECT $1,'ABC1D23',id,'SUCCESS',0,'mock' FROM query_products LIMIT 1`, [c.id]);
  const send = (c, over = {}) => c.call('/api/testimonials/mine', { method: 'PUT', body: { displayName: 'Ana S.', body: 'Consulta rápida e relatório bem claro. Recomendo.', rating: 5, consent: true, ...over } });
  const pub = async () => (await hostRequest(server.base, '/api/testimonials')).json.items;
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer();
    A = await register('Ana Cliente'); B = await register('Beto Cliente'); await buy(A);
    cont = await adminSession({ server, pool, role: 'CONTEUDO' }); cont2 = await adminSession({ server, pool, role: 'CONTEUDO' }); sup = await adminSession({ server, pool, role: 'SUPORTE' });
  });
  after(async () => { await pool.query(`DELETE FROM testimonials WHERE user_id = ANY($1) OR source='MANUAL'`, [[A.id, B.id]]); await server.stop(); await pool.end(); });

  it('só cliente verificado envia; exige consentimento explícito e texto válido', async () => {
    assert.equal((await send(B)).status, 403, 'sem consulta nem pagamento');
    assert.equal((await hostRequest(server.base, '/api/testimonials/mine', { method: 'PUT', body: {} })).status, 401);
    assert.equal((await send(A, { consent: false })).status, 400);
    assert.equal((await send(A, { consent: undefined })).status, 400);
    assert.equal((await send(A, { body: 'curto' })).status, 400);
    assert.equal((await send(A, { body: 'Ótimo, veja www.exemplo.com agora mesmo' })).status, 422);
    assert.equal((await send(A, { rating: 9 })).status, 400);
    assert.equal((await A.call('/api/testimonials/mine')).json.eligible, true);
    assert.equal((await B.call('/api/testimonials/mine')).json.eligible, false);
  });

  let id;
  it('envio fica pendente, não aparece no site e registra consentimento', async () => {
    const r = await send(A); assert.equal(r.status, 200); assert.equal(r.json.status, 'PENDENTE'); id = r.json.id;
    assert.ok(!(await pub()).some((t) => t.id === id));
    const row = (await pool.query('SELECT consent_text,consent_version,consent_at,consent_ip_hash,content_hash FROM testimonials WHERE id=$1', [id])).rows[0];
    assert.ok(row.consent_text && row.consent_version && row.consent_at && row.consent_ip_hash && row.content_hash);
    assert.doesNotMatch(row.consent_ip_hash, /127\.0|::1/);
  });

  it('painel: permissão MANAGE_CONTENT; suporte e cliente não acessam', async () => {
    assert.equal((await sup.call('/api/admin/testimonials')).status, 403);
    assert.equal((await A.call('/api/admin/testimonials')).status, 401);
    const l = await cont.call('/api/admin/testimonials?status=PENDENTE'); assert.equal(l.status, 200);
    const item = l.json.items.find((t) => t.id === id); assert.ok(item); assert.ok(!('email' in item) && !('user_id' in item));
    assert.equal((await sup.call(`/api/admin/testimonials/${id}/approve`, { method: 'POST' })).status, 403);
  });

  it('não publica sem aprovar; aprova, publica e aparece só então', async () => {
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' })).status, 409);
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/approve`, { method: 'POST' })).status, 200);
    assert.ok(!(await pub()).some((t) => t.id === id), 'aprovado ainda não é público');
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' })).status, 200);
    const shown = (await pub()).find((t) => t.id === id);
    assert.ok(shown); assert.equal(shown.name, 'Ana S.'); assert.deepEqual(Object.keys(shown).sort(), ['id', 'name', 'publishedAt', 'rating', 'text']);
  });

  it('editar o texto retira do ar e exige nova aprovação', async () => {
    const r = await send(A, { body: 'Consulta rápida e relatório bem claro. Muito bom mesmo.' }); assert.equal(r.json.id, id);
    assert.ok(!(await pub()).some((t) => t.id === id));
    assert.equal((await pool.query('SELECT status FROM testimonials WHERE id=$1', [id])).rows[0].status, 'PENDENTE');
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' })).status, 409);
    await cont.call(`/api/admin/testimonials/${id}/approve`, { method: 'POST' }); await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' });
    assert.ok((await pub()).some((t) => t.id === id));
  });

  it('adulteração direta no banco invalida a publicação (hash não confere)', async () => {
    await pool.query(`UPDATE testimonials SET body='Texto trocado por fora do fluxo, nunca autorizado.' WHERE id=$1`, [id]);
    assert.ok(!(await pub()).some((t) => t.id === id));
    await pool.query(`UPDATE testimonials SET body='Consulta rápida e relatório bem claro. Muito bom mesmo.' WHERE id=$1`, [id]);
    assert.ok((await pub()).some((t) => t.id === id));
  });

  it('ocultar exige motivo, tira do site e reexibir passa por aprovado → publicar', async () => {
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/hide`, { method: 'POST', body: {} })).status, 400);
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/hide`, { method: 'POST', body: { reason: 'revisão editorial' } })).status, 200);
    assert.ok(!(await pub()).some((t) => t.id === id));
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/unhide`, { method: 'POST' })).status, 200);
    assert.ok(!(await pub()).some((t) => t.id === id), 'reativado volta como aprovado, não publicado');
    await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' });
    assert.ok((await pub()).some((t) => t.id === id));
  });

  it('conta desativada tira o depoimento do ar', async () => {
    await pool.query('UPDATE users SET active=false WHERE id=$1', [A.id]);
    assert.ok(!(await pub()).some((t) => t.id === id));
    await pool.query('UPDATE users SET active=true WHERE id=$1', [A.id]);
    assert.ok((await pub()).some((t) => t.id === id));
  });

  it('cliente retira o consentimento: sai do ar e o texto é apagado', async () => {
    assert.equal((await B.call('/api/testimonials/mine', { method: 'DELETE' })).status, 404, 'outro cliente não retira o seu');
    assert.equal((await A.call('/api/testimonials/mine', { method: 'DELETE' })).status, 200);
    assert.ok(!(await pub()).some((t) => t.id === id));
    const row = (await pool.query('SELECT status,body,display_name,content_hash FROM testimonials WHERE id=$1', [id])).rows[0];
    assert.equal(row.status, 'REMOVIDO'); assert.equal(row.body, ''); assert.equal(row.display_name, ''); assert.equal(row.content_hash, null);
    assert.equal((await cont.call(`/api/admin/testimonials/${id}/publish`, { method: 'POST' })).status, 409);
    const ev = (await cont.call(`/api/admin/testimonials/${id}`)).json.events.map((e) => e.event);
    assert.ok(ev.includes('ENVIADO') && ev.includes('PUBLICADO') && ev.includes('CONSENTIMENTO_RETIRADO'));
    assert.equal((await send(A, { body: 'Novo depoimento depois de retirar, tudo certo.' })).status, 200, 'pode enviar outro depois');
  });

  it('cadastro manual: exige comprovante e consentimento; outra pessoa precisa aprovar', async () => {
    const base = { displayName: 'Carlos M.', body: 'Atendimento rápido e preço justo na consulta.', rating: 4 };
    assert.equal((await cont.call('/api/admin/testimonials', { method: 'POST', body: { ...base, consentConfirmed: true } })).status, 400, 'sem comprovante');
    assert.equal((await cont.call('/api/admin/testimonials', { method: 'POST', body: { ...base, proofRef: 'e-mail 2026-10-20 anexo #123', consentConfirmed: false } })).status, 400);
    const c = await cont.call('/api/admin/testimonials', { method: 'POST', body: { ...base, proofRef: 'e-mail 2026-10-20 anexo #123', consentConfirmed: true } });
    assert.equal(c.status, 201); const mid = c.json.id;
    assert.equal((await cont.call(`/api/admin/testimonials/${mid}/approve`, { method: 'POST' })).status, 403, 'quem cadastrou não aprova');
    assert.equal((await cont2.call(`/api/admin/testimonials/${mid}/approve`, { method: 'POST' })).status, 200);
    assert.equal((await cont2.call(`/api/admin/testimonials/${mid}/publish`, { method: 'POST' })).status, 200);
    assert.ok((await pub()).some((t) => t.id === mid));
    assert.equal((await cont.call(`/api/admin/testimonials/${mid}/remove`, { method: 'POST', body: { reason: 'pedido do autor' } })).status, 200);
    assert.ok(!(await pub()).some((t) => t.id === mid));
    assert.equal((await pool.query('SELECT body FROM testimonials WHERE id=$1', [mid])).rows[0].body, '');
  });

  it('auditoria registra as ações do painel', async () => {
    const a = await pool.query(`SELECT action FROM audit_logs WHERE entity='TESTIMONIAL' AND entity_id=$1`, [id]);
    const acts = a.rows.map((r) => r.action);
    for (const x of ['TESTIMONIAL_APPROVED', 'TESTIMONIAL_PUBLISHED', 'TESTIMONIAL_HIDDEN', 'TESTIMONIAL_UNHIDDEN']) assert.ok(acts.includes(x), x);
  });
});
