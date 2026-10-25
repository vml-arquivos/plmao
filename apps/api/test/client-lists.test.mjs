import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

function call(base, path, { method = 'GET', body, token } = {}) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let data = ''; res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data, json: (() => { try { return JSON.parse(data); } catch { return null; } })() }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('listas do cliente: consultas, extrato, notas e comissões por mês', integration, () => {
  let pool; let server; let token; let other; let userId;
  const password = 'Senha-Forte-123!';

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    const mk = async (tag) => {
      const r = await call(server.base, '/api/auth/register', { method: 'POST', body: { name: `Cliente ${tag}`, email: `${uid(tag)}@cliente.local`, password, acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201);
      return r.json;
    };
    const a = await mk('a'); const b = await mk('b');
    token = a.token; other = b.token;
    userId = (await pool.query('SELECT id FROM users WHERE email=$1', [a.user.email])).rows[0].id;
    const otherId = (await pool.query('SELECT id FROM users WHERE email=$1', [b.user.email])).rows[0].id;
    const q = (uid_, plate, product, status, price, daysAgo) => pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,created_at) VALUES($1,$2,$3,$4,0,'mock',$5, now() - ($6::int * interval '1 day'))`, [uid_, plate, product, status, price, daysAgo]);
    await q(userId, 'ABC1D23', 'DEBTS', 'SUCCESS', 1500, 1);
    await q(userId, 'ABC1D24', 'LIEN', 'FAILED', 900, 10);
    await q(userId, 'XYZ9K88', 'DEBTS', 'PROCESSING', 1500, 45);
    await q(userId, 'QWE1R22', 'DEBTS', 'SUCCESS', 1500, 120);
    await q(otherId, 'ZZZ0Z00', 'DEBTS', 'SUCCESS', 1500, 1);
    const tx = (daysAgo, cents, desc) => pool.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,description,created_at) VALUES($1,'PURCHASE',0,0,0,$2,0,$2,$3, now() - ($4::int * interval '1 day'))`, [userId, cents, desc, daysAgo]);
    await tx(2, 5000, 'Recarga recente'); await tx(40, 3000, 'Recarga antiga'); await tx(200, 1000, 'Recarga muito antiga');
    await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,amount_cents,description,number,issued_at,pdf_url) VALUES('NFSE','ISSUED',$1,5000,'Recarga','123',now(),'https://notas.example/123.pdf')`, [userId]);
    await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,amount_cents,description) VALUES('NFSE','PENDING',$1,3000,'Pendente')`, [userId]);
    await pool.query(`INSERT INTO fiscal_documents(kind,status,user_id,amount_cents,description,issued_at,pdf_url) VALUES('NFSE','ISSUED',$1,1000,'Da outra pessoa',now(),'javascript:alert(1)')`, [otherId]);
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('lista só as consultas de quem está logado e filtra por situação, tipo, placa e período', async () => {
    const all = await call(server.base, '/api/queries', { token });
    assert.equal(all.status, 200);
    assert.equal(all.json.length, 4);
    assert.ok(all.json.every((x) => x.plate !== 'ZZZ0Z00'));
    const ok = await call(server.base, '/api/queries?status=SUCCESS', { token });
    assert.deepEqual(ok.json.map((x) => x.plate).sort(), ['ABC1D23', 'QWE1R22']);
    const type = await call(server.base, '/api/queries?product=LIEN', { token });
    assert.deepEqual(type.json.map((x) => x.plate), ['ABC1D24']);
    const plate = await call(server.base, '/api/queries?plate=abc1', { token });
    assert.equal(plate.json.length, 2);
    const d30 = await call(server.base, '/api/queries?days=30', { token });
    assert.equal(d30.json.length, 2);
    const d90 = await call(server.base, '/api/queries?days=90', { token });
    assert.equal(d90.json.length, 3);
    const day = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const range = await call(server.base, `/api/queries?from=${day}&to=${day}`, { token });
    assert.deepEqual(range.json.map((x) => x.plate), ['ABC1D24']);
  });

  it('pagina e recusa filtros inválidos', async () => {
    const p1 = await call(server.base, '/api/queries?limit=3&offset=0', { token });
    const p2 = await call(server.base, '/api/queries?limit=3&offset=3', { token });
    assert.equal(p1.json.length, 3); assert.equal(p2.json.length, 1);
    assert.equal((await call(server.base, '/api/queries?days=5', { token })).status, 400);
    assert.equal((await call(server.base, '/api/queries?status=XX', { token })).status, 400);
    assert.equal((await call(server.base, '/api/queries?from=ontem', { token })).status, 400);
    assert.equal((await call(server.base, '/api/queries?product=x%27%20or%201=1', { token })).status, 400);
    assert.equal((await call(server.base, '/api/queries')).status, 401);
  });

  it('tipos usados e exportação CSV respeitam o dono e os filtros', async () => {
    const types = await call(server.base, '/api/queries/types', { token });
    assert.deepEqual(types.json.map((t) => t.id).sort(), ['DEBTS', 'LIEN']);
    const csv = await call(server.base, '/api/queries.csv?status=SUCCESS', { token });
    assert.equal(csv.status, 200);
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /consultas\.csv/);
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Data;Placa;Consulta;Situação/);
    assert.ok(!csv.text.includes('ZZZ0Z00'));
    assert.equal((await call(server.base, '/api/queries.csv')).status, 401);
  });

  it('extrato e pagamentos aceitam período e exportam CSV', async () => {
    const all = await call(server.base, '/api/wallet/transactions', { token });
    assert.equal(all.json.length, 3);
    const d60 = await call(server.base, '/api/wallet/transactions?days=60', { token });
    assert.equal(d60.json.length, 2);
    const csv = await call(server.base, '/api/wallet/transactions.csv?days=60', { token });
    assert.equal(csv.status, 200);
    assert.equal(csv.text.replace(/^﻿/, '').trim().split('\r\n').length, 3);
    assert.match(csv.text, /50,00/);
    const orders = await call(server.base, '/api/payments/orders?days=30', { token });
    assert.equal(orders.status, 200);
    assert.equal((await call(server.base, '/api/wallet/transactions?days=3', { token })).status, 400);
  });

  it('notas fiscais: só as emitidas para a própria pessoa e só links https', async () => {
    const docs = await call(server.base, '/api/account/fiscal-documents', { token });
    assert.equal(docs.status, 200);
    assert.equal(docs.json.length, 1);
    assert.equal(docs.json[0].number, '123');
    assert.equal(docs.json[0].pdfUrl, 'https://notas.example/123.pdf');
    const theirs = await call(server.base, '/api/account/fiscal-documents', { token: other });
    assert.equal(theirs.json.length, 1);
    assert.equal(theirs.json[0].pdfUrl, null);
    assert.equal((await call(server.base, '/api/account/fiscal-documents')).status, 401);
  });

  it('parceiro: comissões agrupadas por mês', async () => {
    const act = await call(server.base, '/api/affiliate/activate', { method: 'POST', body: {}, token });
    assert.ok(act.status < 300);
    const aff = (await pool.query('SELECT id FROM affiliates WHERE user_id=$1', [userId])).rows[0].id;
    await pool.query(`INSERT INTO affiliate_commissions(affiliate_id,amount_cents,status,created_at) VALUES($1,500,'PENDING',now()),($1,700,'PAID',now()),($1,900,'CANCELLED',now()),($1,400,'PAID', now() - interval '40 days')`, [aff]);
    const st = await call(server.base, '/api/affiliate/stats', { token });
    assert.equal(st.status, 200);
    assert.ok(Array.isArray(st.json.monthly) && st.json.monthly.length >= 2);
    const first = st.json.monthly[0];
    assert.equal(first.cents, 1200);
    assert.ok(/^\d{4}-\d{2}$/.test(first.month));
  });
});
