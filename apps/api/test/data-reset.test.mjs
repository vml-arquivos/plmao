import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

const PHRASE = 'APAGAR DADOS DE TESTE';
const PW = 'Senha-Forte-123!';

describe('limpeza de dados de teste: só super admin, com senha e frase', integration, () => {
  let pool; let server; let sa; let adm; let clientId; let orderId; let queryId;
  const count = async (sql, p = []) => Number((await pool.query(sql, p)).rows[0].n);

  async function seed() {
    const email = `${uid('rst')}@cliente.local`;
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Reset', email, password: PW, acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    clientId = reg.json.user.id;
    await pool.query('UPDATE wallets SET balance=5,balance_cents=12345 WHERE user_id=$1', [clientId]);
    const o = await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,credits,provider,external_reference,purchase_type,product_id,query_plate) VALUES($1,'PAID',2490,0,'mercadopago',$2,'QUERY','COMPLETE','RST1A11') RETURNING id`, [clientId, uid('ref')]);
    orderId = o.rows[0].id;
    await pool.query(`INSERT INTO payments(user_id,order_id,provider,status,amount_cents) VALUES($1,$2,'mercadopago','PAID',2490)`, [clientId, orderId]);
    await pool.query(`INSERT INTO payment_webhook_events(provider,provider_event_id,event_type,order_id) VALUES('mercadopago',$1,'payment',$2)`, [uid('ev'), orderId]);
    await pool.query(`INSERT INTO payment_refunds(order_id,provider,external_payment_id,reason) VALUES($1,'mercadopago','123','teste de limpeza')`, [orderId]);
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,payment_order_id) VALUES($1,'RST1A11','COMPLETE','SUCCESS',0,2490,'DIRECT','mock-bdrp',$2) RETURNING id`, [clientId, orderId]);
    queryId = q.rows[0].id;
    await pool.query(`INSERT INTO vehicle_query_results(query_id,normalized,raw_response) VALUES($1,'{}','{}')`, [queryId]);
    await pool.query(`INSERT INTO query_payment_entitlements(order_id,user_id,product_id,plate,query_id) VALUES($1,$2,'COMPLETE','RST1A11',$3)`, [orderId, clientId, queryId]);
    await pool.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,description,query_id) VALUES($1,'QUERY',-1,5,4,'teste',$2)`, [clientId, queryId]);
    const cp = await pool.query(`INSERT INTO coupons(code,discount_type,discount_value,redeemed_count) VALUES($1,'PERCENT',10,3) RETURNING id`, [uid('CUP').toUpperCase()]);
    await pool.query(`INSERT INTO coupon_redemptions(coupon_id,payment_order_id) VALUES($1,$2)`, [cp.rows[0].id, orderId]);
  }

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    adm = await adminSession({ server, pool, role: 'ADMIN' });
    await pool.query(`DELETE FROM platform_settings WHERE key='data_reset_lock'`);
  });
  after(async () => { await pool.query(`DELETE FROM platform_settings WHERE key='data_reset_lock'`); await server.stop(); await pool.end(); });

  it('quem não é super admin não vê nem apaga nada', async () => {
    assert.equal((await adm.call('/api/admin/data-reset')).status, 403);
    assert.equal((await adm.call('/api/admin/data-reset/run', { method: 'POST', body: { scopes: ['consultas'], password: PW, confirm: PHRASE } })).status, 403);
    assert.equal((await adm.call(`/api/admin/data-reset/queries/${crypto.randomUUID()}/delete`, { method: 'POST', body: { confirm: true } })).status, 403);
    assert.equal((await hostRequest(server.base, '/api/admin/data-reset', { host: 'admin.placanamao.test' })).status, 401);
  });

  it('senha errada, frase errada e clientes sem consultas/pagamentos são recusados sem apagar', async () => {
    await seed();
    const before = await count('SELECT count(*)::int AS n FROM vehicle_queries');
    const bad = (body) => sa.call('/api/admin/data-reset/run', { method: 'POST', body });
    assert.equal((await bad({ scopes: ['consultas'], password: 'errada-errada', confirm: PHRASE })).status, 401);
    assert.equal((await bad({ scopes: ['consultas'], password: PW, confirm: 'apagar' })).status, 400);
    const only = await bad({ scopes: ['clientes'], password: PW, confirm: PHRASE });
    assert.equal(only.status, 400); assert.match(only.text, /CLIENTS_REQUIRE_QUERIES_AND_PAYMENTS/);
    assert.equal((await bad({ scopes: [], password: PW, confirm: PHRASE })).status, 400);
    assert.equal(await count('SELECT count(*)::int AS n FROM vehicle_queries'), before);
  });

  it('apagar uma consulta e um pagamento avulsos', async () => {
    const delQ = await sa.call(`/api/admin/data-reset/queries/${queryId}/delete`, { method: 'POST', body: { confirm: true } });
    assert.equal(delQ.status, 204, delQ.text);
    assert.equal(await count('SELECT count(*)::int AS n FROM vehicle_queries WHERE id=$1', [queryId]), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM vehicle_query_results WHERE query_id=$1', [queryId]), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id=$1', [clientId]), 1, 'extrato fica, só perde o vínculo');
    assert.equal((await sa.call(`/api/admin/data-reset/queries/${queryId}/delete`, { method: 'POST', body: { confirm: true } })).status, 404);
    assert.equal((await sa.call(`/api/admin/data-reset/payment-orders/${orderId}/delete`, { method: 'POST', body: {} })).status, 400);
    const delO = await sa.call(`/api/admin/data-reset/payment-orders/${orderId}/delete`, { method: 'POST', body: { confirm: true } });
    assert.equal(delO.status, 204, delO.text);
    for (const t of ['payments', 'payment_webhook_events', 'payment_refunds', 'query_payment_entitlements']) assert.equal(await count(`SELECT count(*)::int AS n FROM ${t} WHERE order_id=$1`, [orderId]), 0, t);
    assert.equal(await count('SELECT count(*)::int AS n FROM payment_orders WHERE id=$1', [orderId]), 0);
  });

  it('limpeza total zera movimento e preserva configuração, equipe e auditoria', async () => {
    await seed();
    await pool.query(`INSERT INTO site_leads(email,name,source,stage) VALUES('lead-reset@teste.local','Lead','CADASTRO','CADASTRADO')`).catch(() => undefined);
    const keep = {
      products: await count('SELECT count(*)::int AS n FROM query_products'),
      seo: await count('SELECT count(*)::int AS n FROM seo_pages'),
      staff: await count(`SELECT count(*)::int AS n FROM users WHERE role<>'CLIENTE'`),
      settings: await count('SELECT count(*)::int AS n FROM platform_settings'),
      packages: await count('SELECT count(*)::int AS n FROM credit_packages')
    };
    const preview = await sa.call('/api/admin/data-reset');
    assert.equal(preview.status, 200); assert.equal(preview.json.phrase, PHRASE); assert.ok(preview.json.counts.orders >= 1);
    const run = await sa.call('/api/admin/data-reset/run', { method: 'POST', body: { scopes: ['consultas', 'pagamentos', 'clientes', 'atividade'], password: PW, confirm: PHRASE } });
    assert.equal(run.status, 200, run.text);
    for (const t of ['vehicle_queries', 'vehicle_query_results', 'payment_orders', 'payments', 'payment_webhook_events', 'payment_refunds', 'wallet_transactions', 'coupon_redemptions', 'query_payment_entitlements', 'site_leads', 'funnel_events']) assert.equal(await count(`SELECT count(*)::int AS n FROM ${t}`), 0, t);
    assert.equal(await count(`SELECT count(*)::int AS n FROM users WHERE role='CLIENTE'`), 0);
    assert.equal(await count('SELECT coalesce(sum(balance_cents),0)::int AS n FROM wallets'), 0);
    assert.equal(await count('SELECT coalesce(max(redeemed_count),0)::int AS n FROM coupons'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM query_products'), keep.products);
    assert.equal(await count('SELECT count(*)::int AS n FROM seo_pages'), keep.seo);
    assert.equal(await count(`SELECT count(*)::int AS n FROM users WHERE role<>'CLIENTE'`), keep.staff);
    assert.equal(await count('SELECT count(*)::int AS n FROM credit_packages'), keep.packages);
    assert.ok(await count('SELECT count(*)::int AS n FROM platform_settings') >= keep.settings);
    assert.ok(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action='DATA_RESET_EXECUTED'`) >= 1);
    // a sessão do super admin continua valendo
    assert.equal((await sa.call('/api/admin/data-reset')).status, 200);
  });

  it('trava impede a limpeza até ser liberada com a senha', async () => {
    assert.equal((await sa.call('/api/admin/data-reset/lock', { method: 'POST', body: { locked: true, password: 'errada-errada' } })).status, 401);
    assert.equal((await sa.call('/api/admin/data-reset/lock', { method: 'POST', body: { locked: true, password: PW } })).status, 200);
    assert.equal((await sa.call('/api/admin/data-reset')).json.locked, true);
    const blocked = await sa.call('/api/admin/data-reset/run', { method: 'POST', body: { scopes: ['atividade'], password: PW, confirm: PHRASE } });
    assert.equal(blocked.status, 423);
    assert.equal((await sa.call(`/api/admin/data-reset/queries/${crypto.randomUUID()}/delete`, { method: 'POST', body: { confirm: true } })).status, 423);
    assert.equal((await sa.call('/api/admin/data-reset/lock', { method: 'POST', body: { locked: false, password: PW } })).status, 200);
    assert.equal((await sa.call('/api/admin/data-reset/run', { method: 'POST', body: { scopes: ['atividade'], password: PW, confirm: PHRASE } })).status, 200);
  });

  it('tela Sistema: pagamento e provedor aparecem configurados pelas variáveis reais', async () => {
    const r = await sa.call('/api/admin/settings');
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.configured.payment, 'boolean');
    assert.equal(typeof r.json.configured.vehicleProvider, 'boolean');
  });
});
