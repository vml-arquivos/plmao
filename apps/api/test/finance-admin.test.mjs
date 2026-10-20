import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

describe('painel financeiro: configurações, trava de margem, referências, repasses', integration, () => {
  let pool; let server; let sa; let adm; let settle;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    settle = await import('../dist/payments/settle.js');
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    adm = await adminSession({ server, pool, role: 'ADMIN' });
    // estado conhecido
    await pool.query(`UPDATE payment_settings SET tax_regime='SIMPLES_NACIONAL',tax_cash_bps=600,tax_boleto_bps=600,tax_debit_bps=600,tax_credit_cash_bps=600,tax_credit_installment_bps=600,pix_fee_bps=99,pix_fixed_fee_cents=0,boleto_fixed_fee_cents=350,boleto_default_risk_bps=300,debit_fee_bps=150,credit_cash_fee_bps=449,credit_installment_fee_bps=549,anticipation_bps=150,min_margin_bps=1000,desired_margin_bps=3000,margin_base='TOTAL_COST',reference_discount_bps=500,price_ending_cents=90,operational_cost_cents=0,enabled_methods=ARRAY['PIX','CREDITO_A_VISTA','BOLETO'],commission_base='NET',commission_default_bps=1000,commission_hold_days=0,payout_min_cents=1000 WHERE id=1`);
  });
  after(async () => { await server.stop(); await pool.end(); });

  const mkProduct = async (cost = 1000, price = 3990, ref = null) => {
    const id = `F${Math.random().toString(36).slice(2, 9).toUpperCase()}`;
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost,provider_cost_cents,price_cents,reference_price_cents,slug,active,pricing_mode) VALUES($1,'Produto F','d',1,$2,$3,$4,$5,true,'REFERENCE')`, [id, cost, price, ref, id.toLowerCase()]);
    return id;
  };

  it('configurações: leitura, edição e dados de recebimento mascarados para ADMIN e abertos para SUPER_ADMIN', async () => {
    const put = await sa.call('/api/admin/finance/settings', { method: 'PUT', body: { receiverName: 'Placa na Mão Ltda', receiverPixKey: 'chave-pix-secreta-1234', receiverDocument: '12345678000199' } });
    assert.equal(put.status, 200);
    assert.equal(put.json.settings.receiverPixKey, 'chave-pix-secreta-1234');
    const read = await adm.call('/api/admin/finance/settings');
    assert.equal(read.status, 200);
    assert.notEqual(read.json.settings.receiverPixKey, 'chave-pix-secreta-1234');
    assert.match(read.json.settings.receiverPixKey, /1234$/);
    assert.match(read.json.settings.fiscalWarning, /contador/);
    const denied = await adm.call('/api/admin/finance/settings', { method: 'PUT', body: { receiverPixKey: 'outra' } });
    assert.equal(denied.status, 403);
  });

  it('configuração inválida (fora dos limites) e margem mínima acima da desejada são rejeitadas e revertidas', async () => {
    const bad = await sa.call('/api/admin/finance/settings', { method: 'PUT', body: { taxCashBps: 6000 } });
    assert.equal(bad.status, 400);
    const bad2 = await sa.call('/api/admin/finance/settings', { method: 'PUT', body: { minMarginBps: 9000 } });
    assert.equal(bad2.status, 422);
    const after = await sa.call('/api/admin/finance/settings');
    assert.equal(after.json.settings.minMarginBps, 1000);
    assert.equal(after.json.settings.taxRates.cash, 600);
  });

  it('simulador devolve as 5 formas, piso e aviso fiscal', async () => {
    const r = await sa.call('/api/admin/finance/simulate', { method: 'POST', body: { providerCostCents: 1000, priceCents: 3990 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.results.length, 5);
    assert.ok(r.json.floorCents > 1000);
    assert.equal(r.json.atPrice.length, 5);
    assert.match(r.json.fiscalWarning, /contador/);
  });

  it('trava de margem: preço abaixo do piso é recusado; override só com super admin e justificativa', async () => {
    const id = await mkProduct(1000, 3990);
    const floor = (await sa.call('/api/admin/finance/simulate', { method: 'POST', body: { providerCostCents: 1000 } })).json.floorCents;
    const low = await adm.call(`/api/admin/finance/products/${id}/pricing`, { method: 'PATCH', body: { priceCents: floor - 100 } });
    assert.equal(low.status, 422);
    assert.equal(low.json.error, 'MARGIN_LOCK');
    const legacy = await adm.call(`/api/admin/products/${id}`, { method: 'PATCH', body: { priceCents: floor - 100 } });
    assert.equal(legacy.status, 422);
    const overrideByAdmin = await adm.call(`/api/admin/finance/products/${id}/pricing`, { method: 'PATCH', body: { priceCents: floor - 100, overrideMarginLock: { reason: 'campanha promocional aprovada' } } });
    assert.equal(overrideByAdmin.status, 422);
    const ok = await sa.call(`/api/admin/finance/products/${id}/pricing`, { method: 'PATCH', body: { priceCents: floor - 100, overrideMarginLock: { reason: 'campanha promocional aprovada' } } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.priceCents, floor - 100);
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action='UPDATE_PRODUCT_PRICING' AND entity_id=$1 AND (metadata->>'overrideUsed')='true'`, [id]);
    assert.equal(audit.rowCount, 1);
  });

  it('referências → mediana vira referência; regra 5% abaixo com ,90; histórico e versão', async () => {
    const id = await mkProduct(500, 1000);
    for (const price of [6490, 7990, 6490]) {
      const r = await adm.call(`/api/admin/finance/products/${id}/references`, { method: 'POST', body: { sourceLabel: 'Concorrente interno', priceCents: price } });
      assert.equal(r.status, 201);
    }
    const prod = (await pool.query('SELECT reference_price_cents FROM query_products WHERE id=$1', [id])).rows[0];
    assert.equal(Number(prod.reference_price_cents), 6490);
    const dry = await adm.call('/api/admin/finance/recalculate', { method: 'POST', body: { apply: false, productIds: [id] } });
    assert.equal(dry.json.proposals[0].finalCents, 6090);
    assert.equal(dry.json.proposals[0].marginLocked, false);
    assert.equal(Number((await pool.query('SELECT price_cents FROM query_products WHERE id=$1', [id])).rows[0].price_cents), 1000, 'simulação não grava');
    const applied = await adm.call('/api/admin/finance/recalculate', { method: 'POST', body: { apply: true, productIds: [id] } });
    assert.equal(applied.status, 200);
    const row = (await pool.query('SELECT price_cents,price_version,margin_locked FROM query_products WHERE id=$1', [id])).rows[0];
    assert.equal(Number(row.price_cents), 6090);
    assert.equal(Number(row.price_version), 2);
    const hist = await adm.call(`/api/admin/finance/products/${id}/history`);
    assert.equal(hist.json.history[0].newPriceCents, 6090);
    assert.equal(hist.json.history[0].oldPriceCents, 1000);
  });

  it('referência de mercado muito baixa aciona a trava (preço fica no piso, sinalizado)', async () => {
    const id = await mkProduct(3000, 9990); // custo alto
    await adm.call(`/api/admin/finance/products/${id}/references`, { method: 'POST', body: { sourceLabel: 'Fonte A', priceCents: 3490 } });
    const r = await adm.call('/api/admin/finance/recalculate', { method: 'POST', body: { apply: true, productIds: [id] } });
    const p = r.json.proposals.find((x) => x.productId === id);
    assert.equal(p.marginLocked, true);
    assert.ok(p.finalCents >= p.floorCents);
    assert.equal(p.finalCents % 100, 90);
    const row = (await pool.query('SELECT margin_locked FROM query_products WHERE id=$1', [id])).rows[0];
    assert.equal(row.margin_locked, true);
  });

  it('lista de produtos mostra margem por forma de pagamento e alerta abaixo do piso', async () => {
    const id = await mkProduct(2000, 2090);
    const r = await adm.call('/api/admin/finance/products');
    const p = r.json.products.find((x) => x.id === id);
    assert.equal(p.belowFloor, true);
    assert.equal(p.margins.length, 5);
  });

  it('repasses: criação líquida de clawbacks, aprovação, pagamento só por super admin, cancelamento devolve', async () => {
    const buyer = (await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Comprador','CLIENTE') RETURNING id`, [`${uid('b')}@t.local`])).rows[0].id;
    await pool.query('INSERT INTO wallets(user_id) VALUES($1)', [buyer]);
    const partner = (await sa.call('/api/admin/finance/partners', { method: 'POST', body: { name: 'Parceiro Pix', code: uid('PX'), commissionBps: 1000, pixKey: 'pix-parceiro@banco.com', document: '11122233344' } }));
    assert.equal(partner.status, 201);
    const pid = partner.json.id;
    const product = await mkProduct(500, 2490);
    const run = async (ref, status) => { const c = await pool.connect(); try { await c.query('BEGIN'); await settle.settlePaymentEvent(c, { provider: 'asaas', eventId: uid('e'), eventType: status, rawStatus: status, externalPaymentId: uid('p'), reference: ref }); await c.query('COMMIT'); } finally { c.release(); } };
    const mk = async (amount) => { const ref = `pnm_${uid('o')}`; await pool.query(`INSERT INTO payment_orders(user_id,status,amount_cents,provider,external_reference,purchase_type,product_id,query_plate,affiliate_id,affiliate_commission_bps) VALUES($1,'CHECKOUT_ACTIVE',$2,'asaas',$3,'QUERY',$4,'ABC1D23',$5,1000)`, [buyer, amount, ref, product, pid]); return ref; };
    const r1 = await mk(20000); const r2 = await mk(20000); const r3 = await mk(20000);
    for (const r of [r1, r2, r3]) await run(r, 'PAYMENT_RECEIVED');
    // um pedido já repassado anteriormente sofre chargeback -> clawback devido
    await pool.query(`UPDATE affiliate_commissions SET status='PAID',paid_at=now() WHERE order_id=(SELECT id FROM payment_orders WHERE external_reference=$1)`, [r3]);
    await run(r3, 'PAYMENT_CHARGEBACK_REQUESTED');
    const list = await sa.call('/api/admin/finance/commissions');
    const clawback = list.json.find((c) => c.status === 'CLAWBACK_DUE');
    assert.ok(clawback);
    const created = await adm.call('/api/admin/finance/payouts', { method: 'POST', body: { partnerId: pid } });
    assert.equal(created.status, 201);
    assert.equal(created.json.clawbackCents, clawback.amountCents);
    assert.equal(created.json.amountCents, created.json.grossCents - created.json.clawbackCents);
    const payoutId = created.json.id;
    assert.equal((await adm.call(`/api/admin/finance/payouts/${payoutId}`, { method: 'PATCH', body: { action: 'MARK_PAID' } })).status, 403);
    assert.equal((await adm.call(`/api/admin/finance/payouts/${payoutId}`, { method: 'PATCH', body: { action: 'MARK_PAID' } })).status, 403);
    assert.equal((await sa.call(`/api/admin/finance/payouts/${payoutId}`, { method: 'PATCH', body: { action: 'MARK_PAID' } })).status, 409, 'só paga depois de aprovado');
    assert.equal((await adm.call(`/api/admin/finance/payouts/${payoutId}`, { method: 'PATCH', body: { action: 'APPROVE' } })).status, 200);
    // cancelar devolve as comissões ao saldo, inclusive o clawback
    assert.equal((await adm.call(`/api/admin/finance/payouts/${payoutId}`, { method: 'PATCH', body: { action: 'CANCEL' } })).status, 200);
    const after = await sa.call('/api/admin/finance/commissions');
    assert.ok(after.json.some((c) => c.status === 'CLAWBACK_DUE' && c.payoutId === null));
    assert.equal(after.json.filter((c) => c.partner.code === partner.json.code && c.status === 'AVAILABLE' && c.payoutId === null).length, 2);
    // novo repasse, aprovado e pago pelo super admin
    const again = await adm.call('/api/admin/finance/payouts', { method: 'POST', body: { partnerId: pid } });
    assert.equal(again.status, 201);
    assert.equal((await adm.call(`/api/admin/finance/payouts/${again.json.id}`, { method: 'PATCH', body: { action: 'APPROVE' } })).status, 200);
    const paid = await sa.call(`/api/admin/finance/payouts/${again.json.id}`, { method: 'PATCH', body: { action: 'MARK_PAID', receiptReference: 'E2E-123' } });
    assert.equal(paid.status, 200);
    const paidRows = await pool.query(`SELECT count(*)::int n FROM affiliate_commissions WHERE payout_id=$1 AND status='PAID'`, [again.json.id]);
    assert.equal(paidRows.rows[0].n, 2);
    assert.equal((await sa.call(`/api/admin/finance/payouts/${again.json.id}`, { method: 'PATCH', body: { action: 'CANCEL' } })).status, 409, 'repasse pago é imutável');
    const receipt = await sa.call(`/api/admin/finance/payouts/${again.json.id}/receipt`);
    assert.equal(receipt.status, 200);
    assert.match(receipt.text, /Recibo de repasse/);
    assert.match(receipt.text, /E2E-123/);
    const csv = await sa.call('/api/admin/finance/commissions/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
  });

  it('visão financeira consolida receita, taxas, custo, comissões e estornos', async () => {
    const r = await adm.call('/api/admin/finance/overview?days=30');
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.grossCents, 'number');
    assert.equal(r.json.taxIsEstimate, true);
    assert.ok(r.json.chargebacks >= 1);
  });

  it('sem 2FA/sem token nenhuma rota financeira responde', async () => {
    const { hostRequest } = await import('./helpers/server.mjs');
    const r = await hostRequest(server.base, '/api/admin/finance/settings', { host: 'admin.placanamao.test' });
    assert.equal(r.status, 401);
  });
});
