import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

describe('link do vendedor', integration, () => {
  let pool; let server; let token; let other; let queryId;
  const tokenOf = (url) => url.split('/r/')[1];
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    const mk = async (name) => {
      const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('shr')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
      await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
      return reg.json.token;
    };
    token = await mk('Vendedor Teste');
    other = await mk('Outro Cliente');
    const q = await hostRequest(server.base, '/api/queries', { method: 'POST', token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(q.status, 201, q.text);
    queryId = q.json.id;
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('cria o link, o comprador abre sem conta e vê o mesmo relatório completo', async () => {
    const own = await hostRequest(server.base, `/api/queries/${queryId}/report`, { token });
    assert.equal(own.status, 200);
    const share = await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: { days: 3 } });
    assert.equal(share.status, 201, share.text);
    assert.match(share.json.url, /\/r\/[A-Za-z0-9_-]{40,64}$/);
    const days = (new Date(share.json.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 2.9 && days <= 3.01, `expira em 3 dias (${days})`);
    const pub = await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`);
    assert.equal(pub.status, 200, pub.text);
    assert.equal(pub.json.report.plate, own.json.report.plate);
    assert.ok(pub.text.includes('PROPRIETARIO FICTICIO'), 'quem recebe vê o mesmo relatório, completo');
    assert.ok(!pub.json.report.sections.flatMap((s) => s.items).some((i) => i.masked), 'nada mascarado');
    assert.deepEqual(pub.json.report.sections.map((s) => s.key), own.json.report.sections.map((s) => s.key));
    assert.ok(pub.json.report.advice, 'o parecer e o checklist acompanham o relatório');
    assert.ok(pub.json.shared.expiresAt);
    const pdf = await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}/pdf`);
    assert.equal(pdf.status, 200);
  });

  it('só o dono da consulta cria, lista e revoga; link revogado deixa de abrir', async () => {
    assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token: other, body: {} })).status, 404);
    assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/shares`, { token: other })).status, 404);
    const share = await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: {} });
    assert.equal(share.status, 201);
    const list = await hostRequest(server.base, `/api/queries/${queryId}/shares`, { token });
    assert.ok(list.json.length >= 1);
    assert.ok(!list.text.includes(tokenOf(share.json.url)), 'a lista nunca devolve o token');
    assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/shares/${share.json.id}`, { method: 'DELETE', token: other })).status, 404);
    assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/shares/${share.json.id}`, { method: 'DELETE', token })).status, 200);
    assert.equal((await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`)).status, 404);
  });

  it('expirado, inventado e fora do formato não abrem; há limite de links ativos', async () => {
    assert.equal((await hostRequest(server.base, '/api/shared-report/inventado')).status, 404);
    const share = await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: { days: 1 } });
    await pool.query(`UPDATE secure_links SET expires_at = now() - interval '1 minute' WHERE id=$1`, [share.json.id]);
    assert.equal((await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`)).status, 404);
    assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: { days: 99 } })).status, 400);
    await pool.query(`UPDATE secure_links SET revoked_at=now() WHERE resource_id=$1`, [queryId]);
    for (let i = 0; i < 5; i += 1) assert.equal((await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: {} })).status, 201);
    const sixth = await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: {} });
    assert.equal(sixth.status, 409);
    assert.equal(sixth.json.code ?? sixth.json.error, 'SHARE_LIMIT');
  });

  it('limite de visualizações: depois de 100 acessos o link se encerra', async () => {
    await pool.query(`UPDATE secure_links SET revoked_at=now() WHERE resource_id=$1`, [queryId]);
    const share = await hostRequest(server.base, `/api/queries/${queryId}/share`, { method: 'POST', token, body: {} });
    await pool.query(`UPDATE secure_links SET uses=99 WHERE id=$1`, [share.json.id]);
    assert.equal((await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`)).status, 200);
    assert.equal((await hostRequest(server.base, `/api/shared-report/${tokenOf(share.json.url)}`)).status, 404);
  });
});
