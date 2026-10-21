import assert from 'node:assert/strict';
import test, { before, after, describe, it } from 'node:test';
import http from 'node:http';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const F = await import('../dist/lib/fiscal.js');
const { decryptRaw } = await import('../dist/lib/rawStore.js');

describe('fila fiscal (integração)', integration, () => {
  let pool, server, adm, fin, sup, userId;
  const docs = [];
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ FISCAL_PROVIDER: 'mock' });
    adm = await adminSession({ server, pool, role: 'ADMIN' }); fin = await adminSession({ server, pool, role: 'FINANCEIRO' }); sup = await adminSession({ server, pool, role: 'SUPORTE' });
    userId = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Cliente Fiscal','CLIENTE') RETURNING id`, [`${uid('f')}@teste.local`])).rows[0].id;
  });
  after(async () => {
    await pool.query('DELETE FROM email_outbox WHERE related_type=$1 AND related_id = ANY($2::text[])', ['FISCAL_DOCUMENT', docs.map(String)]).catch(() => undefined);
    await server.stop(); await pool.end();
  });

  const snap = (over = {}) => ({ name: 'Cliente Fiscal', document: '52998224725', documentKind: 'CPF', email: 'cliente@teste.local', street: 'Rua A', city: 'Brasília', state: 'DF', zip: '70000000', ...over });
  async function mkDoc({ paid = true, customer = snap(), status = 'PENDING' } = {}) {
    const p = await pool.query(`INSERT INTO payments(user_id,provider,status,amount_cents,credits,external_id,paid_at) VALUES($1,'mercadopago',$2,2490,0,$3,now()) RETURNING id`, [userId, paid ? 'PAID' : 'PENDING', uid('pay')]);
    const d = await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,payment_id,amount_cents,description,customer_snapshot) VALUES('NFSE',$1,$2,$3,2490,'Consulta veicular',$4::jsonb) RETURNING id`, [status, userId, p.rows[0].id, JSON.stringify(customer)]);
    docs.push(d.rows[0].id); return d.rows[0].id;
  };
  const prov = (name, handlers) => { const calls = []; return { name, calls, isConfigured: () => true, emit: async (i) => { calls.push(i); return handlers.shift()(i); }, poll: async (ref, i) => { calls.push({ poll: ref }); return handlers.shift()(i); } }; };
  const job = async (id) => (await pool.query('SELECT * FROM fiscal_jobs WHERE document_id=$1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0];
  const due = (id) => pool.query(`UPDATE fiscal_jobs SET next_attempt_at=now() - interval '1 second' WHERE document_id=$1`, [id]);

  it('recusa documento com pagamento não confirmado, cliente incompleto ou sem provedor', async () => {
    const p = prov('t1', []);
    await assert.rejects(async () => F.enqueueFiscalEmission(await mkDoc({ paid: false }), null, p), (e) => e.code === 'FISCAL_PAYMENT_NOT_CONFIRMED');
    await assert.rejects(async () => F.enqueueFiscalEmission(await mkDoc({ customer: snap({ street: null }) }), null, p), (e) => e.code === 'FISCAL_CUSTOMER_INCOMPLETE');
    await assert.rejects(async () => F.enqueueFiscalEmission(await mkDoc(), null, null), (e) => e.code === 'FISCAL_PROVIDER_NOT_CONFIGURED');
    await assert.rejects(async () => F.enqueueFiscalEmission(await mkDoc({ status: 'ISSUED' }), null, p), (e) => e.code === 'FISCAL_DOCUMENT_NOT_PENDING');
  });

  it('emite uma vez: enfileirar duas vezes não duplica; nota fica EMITIDA e o e-mail só sai depois', async () => {
    const id = await mkDoc(); const p = prov('t2', [() => ({ status: 'ISSUED', number: uid('N'), series: '1', verificationCode: 'ABC123' })]);
    const a = await F.enqueueFiscalEmission(id, null, p); const b = await F.enqueueFiscalEmission(id, null, p);
    assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(a.id, b.id);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE related_id=$1`, [id])).rows[0].n, 0, 'sem e-mail antes da emissão');
    const r = await F.processFiscalJobs({ provider: p, limit: 50 });
    assert.ok(r.issued >= 1);
    assert.equal(p.calls[0].idempotencyKey, `fiscal-emit:${id}`);
    assert.equal((await pool.query('SELECT status FROM fiscal_documents WHERE id=$1', [id])).rows[0].status, 'ISSUED');
    assert.equal((await job(id)).status, 'EMITIDO');
    const mail = (await pool.query(`SELECT template,to_email,payload FROM email_outbox WHERE related_type='FISCAL_DOCUMENT' AND related_id=$1`, [id])).rows;
    assert.equal(mail.length, 1); assert.equal(mail[0].template, 'FISCAL_DOCUMENT_READY');
    assert.doesNotMatch(JSON.stringify(mail[0].payload), /52998224725|529\.982/, 'e-mail sem CPF');
    const again = await F.processFiscalJobs({ provider: p, limit: 50 });
    assert.equal(p.calls.length, 1, 'não emite de novo'); assert.equal(again.issued, 0);
  });

  it('falha transitória tenta de novo com atraso; esgotadas as tentativas vira FALHOU e pode ser reaberta', async () => {
    const id = await mkDoc(); const boom = () => { throw new F.FiscalProviderError('timeout do provedor', true); };
    const p = prov('t3', [boom, boom, boom, boom, boom, boom, () => ({ status: 'ISSUED', number: uid('N') })]);
    await F.enqueueFiscalEmission(id, null, p);
    for (let i = 0; i < 6; i++) { await due(id); await F.processFiscalJobs({ provider: p, limit: 50 }); }
    const failed = await job(id);
    assert.equal(failed.status, 'FALHOU'); assert.equal(failed.attempts, 6);
    assert.equal((await pool.query('SELECT status FROM fiscal_documents WHERE id=$1', [id])).rows[0].status, 'PENDING');
    assert.equal(await F.retryFiscalJob(failed.id), true);
    await F.processFiscalJobs({ provider: p, limit: 50 });
    assert.equal((await job(id)).status, 'EMITIDO');
    assert.equal(await F.retryFiscalJob(failed.id), false, 'emitido não reabre');
  });

  it('rejeição do provedor não repete e deixa o motivo; provedor assíncrono usa consulta posterior', async () => {
    const rej = await mkDoc(); const p1 = prov('t4', [() => ({ status: 'REJECTED', reason: 'Inscrição municipal inválida' })]);
    await F.enqueueFiscalEmission(rej, null, p1); await F.processFiscalJobs({ provider: p1, limit: 50 });
    assert.equal((await job(rej)).status, 'REJEITADO'); assert.match((await job(rej)).last_error, /municipal/);
    const asy = await mkDoc(); const p2 = prov('t5', [() => ({ status: 'PENDING', providerRef: 'ref-9' }), () => ({ status: 'ISSUED', number: uid('N') })]);
    await F.enqueueFiscalEmission(asy, null, p2); await F.processFiscalJobs({ provider: p2, limit: 50 });
    assert.equal((await job(asy)).status, 'AGUARDANDO_PROVEDOR');
    await due(asy); await F.processFiscalJobs({ provider: p2, limit: 50 });
    assert.deepEqual(p2.calls.map((c) => c.poll ?? 'emit'), ['emit', 'ref-9']);
    assert.equal((await job(asy)).status, 'EMITIDO');
  });

  it('pagamento estornado antes da emissão cancela o job sem emitir', async () => {
    const id = await mkDoc(); const p = prov('t6', [() => ({ status: 'ISSUED', number: 'X' })]);
    await F.enqueueFiscalEmission(id, null, p);
    await pool.query(`UPDATE payments SET status='REFUNDED' WHERE id=(SELECT payment_id FROM fiscal_documents WHERE id=$1)`, [id]);
    await F.processFiscalJobs({ provider: p, limit: 50 });
    assert.equal((await job(id)).status, 'CANCELADO'); assert.equal(p.calls.length, 0);
  });

  it('API: permissões, enfileirar, envio por e-mail e página pública com link seguro', async () => {
    const id = await mkDoc();
    assert.equal((await sup.call(`/api/admin/fiscal/documents/${id}/enqueue`, { method: 'POST' })).status, 403);
    const q = await fin.call(`/api/admin/fiscal/documents/${id}/enqueue`, { method: 'POST' });
    assert.equal(q.status, 202);
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${id}/send-email`, { method: 'POST' })).status, 409, 'só nota emitida');
    await F.processFiscalJobs({ provider: F.mockFiscalProvider, limit: 50 });
    assert.equal((await pool.query('SELECT status FROM fiscal_documents WHERE id=$1', [id])).rows[0].status, 'ISSUED');
    const first = (await pool.query(`SELECT payload FROM email_outbox WHERE related_id=$1`, [id])).rows[0];
    const token = decryptRaw(first.payload.tokenEnc);
    const url = new URL(server.base + `/api/fiscal/documents/${token}`);
    const get = (t) => new Promise((resolve, reject) => http.get({ hostname: url.hostname, port: url.port, path: `/api/fiscal/documents/${t}` }, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d), headers: res.headers })); }).on('error', reject));
    const pub = await get(token);
    assert.equal(pub.status, 200); assert.equal(pub.json.amountCents, 2490); assert.match(pub.headers['x-robots-tag'], /noindex/);
    assert.ok(!('customer' in pub.json) && !JSON.stringify(pub.json).includes('52998224725'));
    assert.equal((await get('x'.repeat(43))).status, 404);
    for (const n of [2, 3]) assert.equal((await fin.call(`/api/admin/fiscal/documents/${id}/send-email`, { method: 'POST' })).status, 202, `envio ${n}`);
    assert.equal((await fin.call(`/api/admin/fiscal/documents/${id}/send-email`, { method: 'POST' })).status, 409, 'limite de envios');
    assert.equal((await hostRequest(server.base, '/api/admin/fiscal/jobs', { host: 'admin.placanamao.test' })).status, 401);
    assert.equal((await fin.call('/api/admin/fiscal/jobs')).status, 200);
  });
});
