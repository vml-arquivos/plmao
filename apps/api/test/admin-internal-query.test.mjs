import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('consulta interna do painel fica salva, visível e pode ser entregue', integration, () => {
  let pool; let server; let adm; let customer; let customerEmail; let saved;
  const tokenOf = (url) => url.split('/r/')[1];
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
    adm = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    customerEmail = `${uid('int')}@cliente.local`;
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Interno', email: customerEmail, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    customer = reg.json;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('a consulta feita no painel é salva com origem interna, código de validação e sem dado bruto na resposta', async () => {
    const r = await adm.call('/api/admin/lookups', { method: 'POST', body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.saved, true);
    assert.match(r.json.queryId, /^[0-9a-f-]{36}$/);
    assert.equal(r.json.verificationCode, r.json.queryId.slice(0, 8).toUpperCase());
    assert.ok(!('raw' in r.json), 'o dado bruto da fonte não vai para a tela');
    assert.ok(r.json.pdfBase64);
    saved = r.json;

    const row = await pool.query(`SELECT q.status,q.source,q.price_cents,q.charge_source,q.result_hash,r.normalized IS NOT NULL AS has_result,r.raw_enc IS NOT NULL AS has_raw
      FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1`, [saved.queryId]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].status, 'SUCCESS');
    assert.equal(row.rows[0].source, 'ADMIN');
    assert.equal(Number(row.rows[0].price_cents), 0);
    assert.equal(row.rows[0].charge_source, 'ADMIN_INTERNAL');
    assert.ok(row.rows[0].result_hash);
    assert.equal(row.rows[0].has_result, true);
    const audits = await pool.query(`SELECT 1 FROM audit_logs WHERE action='ADMIN_LOOKUP' AND entity_id=$1`, [saved.queryId]);
    assert.equal(audits.rowCount, 1, 'a auditoria aponta para a consulta salva');
  });

  it('aparece na lista do painel, com filtro por origem, e abre com relatório e PDF', async () => {
    const all = await adm.call('/api/admin/queries');
    const mine = all.json.find((x) => x.id === saved.queryId);
    assert.ok(mine, 'a consulta interna está na lista');
    assert.equal(mine.source, 'ADMIN');
    assert.equal(mine.sentToCustomer, false);
    const internal = await adm.call('/api/admin/queries?source=ADMIN');
    assert.ok(internal.json.length >= 1 && internal.json.every((x) => x.source === 'ADMIN'));
    const web = await adm.call('/api/admin/queries?source=WEB');
    assert.ok(!web.json.some((x) => x.id === saved.queryId));
    const detail = await adm.call(`/api/admin/queries/${saved.queryId}`);
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.source, 'ADMIN');
    assert.ok(detail.json.report.sections.length > 0);
    const pdf = await adm.call(`/api/admin/queries/${saved.queryId}/report/pdf`);
    assert.equal(pdf.status, 200);
  });

  it('o código de validação do PDF confere com o relatório salvo', async () => {
    const v = await hostRequest(server.base, `/api/validar-relatorio/${saved.verificationCode}`);
    assert.equal(v.status, 200, v.text);
  });

  it('enviar ao cliente: aparece no histórico dele, sem cobrança, com e-mail; reenviar não duplica', async () => {
    const before = await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [customer.user.id]);
    const sent = await adm.call(`/api/admin/queries/${saved.queryId}/send`, { method: 'POST', body: { email: customerEmail.toUpperCase(), note: 'Segue o relatório combinado.' } });
    assert.equal(sent.status, 201, sent.text);
    assert.notEqual(sent.json.queryId, saved.queryId, 'o cliente recebe a sua própria cópia');
    const hist = await hostRequest(server.base, '/api/queries', { token: customer.token });
    assert.equal(hist.status, 200);
    const list = Array.isArray(hist.json) ? hist.json : hist.json.items ?? hist.json.queries ?? [];
    assert.ok(list.some((x) => x.id === sent.json.queryId), 'consulta no histórico do cliente');
    const rep = await hostRequest(server.base, `/api/queries/${sent.json.queryId}/report`, { token: customer.token });
    assert.equal(rep.status, 200, rep.text);
    const after = await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [customer.user.id]);
    assert.equal(Number(after.rows[0].balance_cents), Number(before.rows[0].balance_cents), 'nenhuma cobrança');
    const mail = await pool.query(`SELECT subject,payload FROM email_outbox WHERE related_type='ADMIN_QUERY_SEND' AND related_id=$1`, [sent.json.queryId]);
    assert.equal(mail.rowCount, 1);
    assert.ok(JSON.stringify(mail.rows[0].payload).includes(`/app/consulta/${sent.json.queryId}`));
    assert.ok(JSON.stringify(mail.rows[0].payload).includes('Segue o relatório combinado.'));
    const again = await adm.call(`/api/admin/queries/${saved.queryId}/send`, { method: 'POST', body: { email: customerEmail } });
    assert.equal(again.status, 201);
    assert.equal(again.json.queryId, sent.json.queryId, 'não duplica a consulta no histórico');
    const copies = await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE user_id=$1 AND request_metadata->>'sentFrom'=$2`, [customer.user.id, saved.queryId]);
    assert.equal(copies.rows[0].n, 1);
    const flagged = (await adm.call('/api/admin/queries')).json.find((x) => x.id === saved.queryId);
    assert.equal(flagged.sentToCustomer, false, 'a original continua interna; a cópia é a do cliente');
  });

  it('enviar exige cliente ativo existente e e-mail válido', async () => {
    assert.equal((await adm.call(`/api/admin/queries/${saved.queryId}/send`, { method: 'POST', body: { email: 'ninguem@cliente.local' } })).status, 404);
    assert.equal((await adm.call(`/api/admin/queries/${saved.queryId}/send`, { method: 'POST', body: { email: 'nao-e-email' } })).status, 400);
    assert.equal((await adm.call('/api/admin/queries/inventado/send', { method: 'POST', body: { email: customerEmail } })).status, 404);
  });

  it('gerar link: o comprador abre sem conta; dá para listar e revogar; sem token na lista', async () => {
    const share = await adm.call(`/api/admin/queries/${saved.queryId}/share`, { method: 'POST', body: { days: 2 } });
    assert.equal(share.status, 201, share.text);
    assert.match(share.json.url, /\/r\/[A-Za-z0-9_-]{40,64}$/);
    const pub = await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`);
    assert.equal(pub.status, 200, pub.text);
    const list = await adm.call(`/api/admin/queries/${saved.queryId}/shares`);
    assert.ok(list.json.length >= 1);
    assert.ok(!list.text.includes(tokenOf(share.json.url)));
    assert.equal((await adm.call(`/api/admin/queries/${saved.queryId}/shares/${share.json.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`)).status, 404);
    assert.equal((await adm.call(`/api/admin/queries/${saved.queryId}/share`, { method: 'POST', body: { days: 99 } })).status, 400);
  });

  it('entregar exige permissão de consulta sensível e consulta concluída', async () => {
    const support = await adminSession({ server, pool, role: 'SUPORTE' });
    assert.equal((await support.call(`/api/admin/queries/${saved.queryId}/share`, { method: 'POST', body: {} })).status, 403);
    assert.equal((await support.call(`/api/admin/queries/${saved.queryId}/send`, { method: 'POST', body: { email: customerEmail } })).status, 403);
    const failed = await pool.query(`SELECT id FROM vehicle_queries WHERE status<>'SUCCESS' LIMIT 1`);
    if (failed.rowCount) assert.equal((await adm.call(`/api/admin/queries/${failed.rows[0].id}/share`, { method: 'POST', body: {} })).status, 404);
  });

  it('falha da fonte não deixa consulta salva', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE source='ADMIN' AND plate='TIM0E00'`);
    const r = await adm.call('/api/admin/lookups', { method: 'POST', body: { plate: 'TIM0E00', productId: 'LIEN' } });
    assert.equal(r.status, 424);
    const after = await pool.query(`SELECT count(*)::int AS n FROM vehicle_queries WHERE source='ADMIN' AND plate='TIM0E00'`);
    assert.equal(after.rows[0].n, before.rows[0].n);
  });
});
