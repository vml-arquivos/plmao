import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('consulta → relatório v2: LGPD, planos, PDF/HTML e revelação auditada', integration, () => {
  let pool; let server; let clientToken; let clientId; let premiumQuery; let basicQuery; let sa; let op;
  const call = (path, opts = {}) => hostRequest(server.base, path, { token: clientToken, ...opts });

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    const reg = await call('/api/auth/register', { method: 'POST', token: undefined, body: { name: 'Cliente Relatório', email: `${uid('rel')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201);
    clientToken = reg.json.token; clientId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [clientId]);
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('consulta Premium devolve relatório v2 sem dados do proprietário', async () => {
    const r = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'PREMIUM' } });
    assert.equal(r.status, 201, r.text);
    premiumQuery = r.json.id;
    const v2 = r.json.result.v2;
    assert.equal(v2.schema, 'placanamao.vehicle.report.v2');
    assert.equal(r.json.result.owner, undefined);
    assert.ok(!r.text.includes('PROPRIETARIO FICTICIO'));
    assert.ok(!r.text.includes('9ZZSANDBOXDEV1B11'.slice(0, 12) + 'DEV1B11'));
    const keys = v2.sections.flatMap((s) => s.items.map((i) => i.key));
    assert.ok(!keys.includes('PRONOME') && !keys.includes('CPF_CNPJ_PROPRIETARIO'));
    assert.equal(v2.debts.totalCents, 29347 + 16022);
    assert.equal(r.json.result.diagnostic.level, 'HIGH_RISK');
  });

  it('banco: bruto do provedor só criptografado; normalizado só com dados mascarados', async () => {
    const row = (await pool.query('SELECT raw_response,raw_enc,normalized::text AS n,normalizer_version FROM vehicle_query_results WHERE query_id=$1', [premiumQuery])).rows[0];
    assert.ok(row.raw_enc && row.raw_enc.startsWith('v1.'));
    assert.ok(!row.raw_enc.includes('FICTICIO'));
    assert.deepEqual(row.raw_response, { stored: true, encrypted: true });
    assert.ok(!row.n.includes('PROPRIETARIO FICTICIO'));
    assert.equal(row.normalizer_version, 2);
    const { decryptRaw } = await import('../dist/lib/rawStore.js');
    assert.match(JSON.stringify(decryptRaw(row.raw_enc)), /PROPRIETARIO FICTICIO SANDBOX/);
  });

  it('plano Básico não expõe débitos/restrições e sinaliza pontos fora do plano', async () => {
    const r = await call('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'BASIC' } });
    assert.equal(r.status, 201, r.text);
    basicQuery = r.json.id;
    const v2 = r.json.result.v2;
    const keys = v2.sections.flatMap((s) => s.items.map((i) => i.key));
    assert.ok(keys.includes('MARCA'));
    assert.ok(!keys.includes('DEBIPVA') && !keys.includes('RESJUDICIAL') && !keys.includes('RESFURTO'));
    assert.equal(v2.debts.totalCents, 0);
    assert.ok(v2.lockedAlertCount > 0);
    assert.ok(!/Restrição judicial/.test(r.text));
  });

  it('relatório JSON, PDF e HTML de impressão do próprio cliente', async () => {
    const j = await call(`/api/queries/${premiumQuery}/report`);
    assert.equal(j.status, 200);
    assert.equal(j.json.verificationCode, premiumQuery.slice(0, 8).toUpperCase());
    const pdf = await fetch(`${server.base}/api/queries/${premiumQuery}/report/pdf`, { headers: { authorization: `Bearer ${clientToken}` } });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 10000);
    const html = await call(`/api/queries/${premiumQuery}/report/print`);
    assert.equal(html.status, 200);
    assert.match(html.text, /DEV1B11/);
    assert.match(html.text, /R\$ 453,69/);
    assert.ok(!html.text.includes('PROPRIETARIO'));
    assert.ok(!/<script>/.test(html.text)); // CSP: sem script inline
    const other = await hostRequest(server.base, `/api/queries/${premiumQuery}/report`, { token: 'invalido' });
    assert.equal(other.status, 401);
  });

  it('validação pública do código do relatório', async () => {
    const r = await hostRequest(server.base, `/api/validar-relatorio/${premiumQuery.slice(0, 8).toUpperCase()}`);
    assert.equal(r.status, 200); assert.equal(r.json.authentic, true);
    assert.match(r.json.plate, /^DEV\*\*\*11$/);
  });

  it('equipe vê relatório mascarado; revelar exige permissão, motivo e fica auditado', async () => {
    const view = await sa.call(`/api/admin/queries/${premiumQuery}`);
    assert.equal(view.status, 200);
    const items = view.json.report.sections.flatMap((s) => s.items);
    const nome = items.find((i) => i.key === 'PRONOME');
    assert.ok(nome && nome.masked && !nome.value.includes('FICTICIO'));
    assert.ok(items.some((i) => i.key === 'CHAVERETORNO'));
    const noReason = await sa.call(`/api/admin/queries/${premiumQuery}/reveal`, { method: 'POST', body: { field: 'PRONOME', reason: 'curto' } });
    assert.equal(noReason.status, 400);
    const denied = await op.call(`/api/admin/queries/${premiumQuery}/reveal`, { method: 'POST', body: { field: 'PRONOME', reason: 'investigação de fraude no pedido' } });
    assert.equal(denied.status, 403);
    const clientTry = await hostRequest(server.base, `/api/admin/queries/${premiumQuery}/reveal`, { method: 'POST', token: clientToken, host: 'admin.placanamao.test', body: { field: 'PRONOME', reason: 'investigação de fraude no pedido' } });
    assert.ok([401, 403].includes(clientTry.status));
    const ok = await sa.call(`/api/admin/queries/${premiumQuery}/reveal`, { method: 'POST', body: { field: 'PRONOME', reason: 'investigação de fraude no pedido' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.value, 'PROPRIETARIO FICTICIO SANDBOX');
    const log = (await pool.query('SELECT field,reason FROM pii_reveals WHERE query_id=$1', [premiumQuery])).rows;
    assert.equal(log.length, 1); assert.equal(log[0].field, 'PRONOME');
    const audits = (await pool.query(`SELECT metadata::text AS m FROM audit_logs WHERE action='PII_REVEAL' AND entity_id=$1`, [premiumQuery])).rows;
    assert.equal(audits.length, 1); assert.ok(!audits[0].m.includes('FICTICIO'));
    const list = await sa.call(`/api/admin/queries/${premiumQuery}/reveals`);
    assert.equal(list.json.length, 1);
  });
});
