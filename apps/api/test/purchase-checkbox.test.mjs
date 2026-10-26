import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';
import { prepareContractData } from './helpers/contract.mjs';

describe('aceite do contrato por caixinha (sem ler, sem código) e comprovante por e-mail', integration, () => {
  let pool; let server;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
  });
  after(async () => { await server.stop(); await pool.query(`DELETE FROM email_outbox WHERE related_type IN ('PURCHASE_CONTRACT','PURCHASE_RECEIPT')`); await pool.end(); });

  const register = async (name = 'Joana Souza') => {
    const email = `${uid('cb')}@cliente.local`;
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    return { token: reg.json.token, id: reg.json.user.id, email };
  };
  const coupon = async () => {
    const code = uid('CBX').toUpperCase().replace(/-/g, '');
    await pool.query(`INSERT INTO coupons(code,discount_type,discount_value) VALUES($1,'PERCENT',100)`, [code]);
    return code;
  };
  const post = (c, path, body) => hostRequest(server.base, path, { method: 'POST', token: c.token, body });
  const queryBody = (extra = {}) => ({ productId: 'COMPLETE', plate: 'DEV1B11', ...extra });

  it('marcar "Li e aceito" basta: cria o contrato já aceito, liga ao pedido e manda o comprovante, sem código', async () => {
    const c = await register(); await prepareContractData(pool, null);
    await pool.query(`UPDATE user_profiles SET cpf_cnpj=NULL WHERE user_id=$1`, [c.id]); // sem CPF no perfil: não trava a compra
    const code = await coupon();
    const r = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: true }));
    assert.equal(r.status, 201, r.text); assert.equal(r.json.free, true);
    const row = (await pool.query(`SELECT number,status,order_id,otp_channel,model_version,body,accepted_at,accept_ip_hash FROM purchase_contracts WHERE user_id=$1`, [c.id])).rows;
    assert.equal(row.length, 1);
    assert.equal(row[0].status, 'USADO'); assert.equal(row[0].order_id, r.json.orderId); assert.equal(row[0].otp_channel, 'CHECKBOX');
    assert.equal(row[0].model_version, '2026-10-c2'); assert.ok(row[0].accepted_at); assert.ok(row[0].accept_ip_hash);
    assert.match(row[0].body, /marcar a opção "Li e aceito"/); assert.match(row[0].body, /Joana Souza/);
    assert.equal((await pool.query(`SELECT 1 FROM email_outbox WHERE related_type='PURCHASE_CONTRACT' AND created_by=$1 AND template='PURCHASE_OTP'`, [c.id])).rowCount, 0, 'nenhum código por e-mail');
    // comprovante
    let mail;
    for (let i = 0; i < 20 && !mail; i += 1) { mail = (await pool.query(`SELECT to_email,subject,payload FROM email_outbox WHERE related_type='PURCHASE_RECEIPT' AND related_id=$1`, [r.json.orderId])).rows[0]; if (!mail) await new Promise((ok) => setTimeout(ok, 100)); }
    assert.ok(mail, 'comprovante enfileirado'); assert.equal(mail.to_email, c.email); assert.match(mail.subject, /Comprovante da sua consulta/);
    assert.match(mail.payload.data.message, /DEV1B11/); assert.match(mail.payload.data.message, new RegExp(row[0].number));
    assert.doesNotMatch(mail.payload.data.message, /CÓPIA DO CONTRATO/, 'consulta avulsa recebe comprovante, não o contrato inteiro');
    // aparece em Contratos
    const list = await hostRequest(server.base, '/api/purchase-contracts', { token: c.token });
    assert.equal(list.json.items.length, 1); assert.equal(list.json.items[0].number, row[0].number);
  });

  it('sem marcar nada, o checkout não cria pedido nem contrato', async () => {
    const c = await register(); await prepareContractData(pool, c.id); const code = await coupon();
    const r = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code }));
    assert.equal(r.status, 400); assert.equal(r.json.error, 'PURCHASE_CONTRACT_REQUIRED'); assert.match(r.json.message, /Marque a caixa/);
    assert.equal((await pool.query('SELECT 1 FROM payment_orders WHERE user_id=$1', [c.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM purchase_contracts WHERE user_id=$1', [c.id])).rowCount, 0);
  });

  it('ler o contrato é opcional: a prévia mostra o texto e não grava nada', async () => {
    const c = await register('Carlos Lima'); await prepareContractData(pool, c.id);
    const p = await post(c, '/api/purchase-contracts/preview', queryBody());
    assert.equal(p.status, 200, p.text);
    assert.match(p.json.text, /CONTRATO DE ADESÃO: CONSULTA VEICULAR AVULSA/); assert.match(p.json.text, /Carlos Lima/); assert.match(p.json.text, /marcar a opção "Li e aceito"/);
    assert.equal((await pool.query('SELECT 1 FROM purchase_contracts WHERE user_id=$1', [c.id])).rowCount, 0);
    const pack = (await pool.query(`SELECT slug FROM credit_packages WHERE active=true ORDER BY price_cents LIMIT 1`)).rows[0];
    const pp = await post(c, '/api/purchase-contracts/preview', { packageSlug: pack.slug });
    assert.equal(pp.status, 200); assert.match(pp.json.text, /COMPRA DE SALDO PRÉ-PAGO/);
  });

  it('o fluxo antigo (contractId com código) continua valendo', async () => {
    const c = await register(); await prepareContractData(pool, c.id);
    const d = await post(c, '/api/purchase-contracts/draft', queryBody());
    assert.equal(d.status, 201); assert.match(d.json.text, /código enviado ao e-mail/);
  });

  it('saldo pago: o e-mail traz o comprovante e a cópia do contrato; reenviar não duplica', async () => {
    const c = await register('Ana Prado'); await prepareContractData(pool, c.id);
    const pack = (await pool.query(`SELECT id,slug,name,credits,price_cents FROM credit_packages WHERE active=true ORDER BY price_cents LIMIT 1`)).rows[0];
    const order = (await pool.query(`INSERT INTO payment_orders(user_id,package_id,status,subtotal_cents,amount_cents,credits,provider,external_reference,paid_at)
      VALUES($1,$2,'PAID',$3,$3,$4,'mercadopago',$5,now()) RETURNING id`, [c.id, pack.id, pack.price_cents, pack.credits, `pnm_${uid('x')}`])).rows[0];
    await pool.query(`INSERT INTO purchase_contracts(number,user_id,kind,item_key,amount_cents,model_version,party,body,body_hash,otp_channel,status,accepted_at,expires_at,order_id)
      VALUES($1,$2,'PACKAGE',$3,$4,'2026-10-c2','{}'::jsonb,'TEXTO DO CONTRATO DE SALDO','h','CHECKBOX','USADO',now(),now(),$5)`, [`PNM-T-${uid('n')}`, c.id, pack.slug, pack.price_cents, order.id]);
    const { sendPurchaseReceipt } = await import('../dist/purchaseContract.js');
    await sendPurchaseReceipt(order.id); await sendPurchaseReceipt(order.id);
    const mails = (await pool.query(`SELECT subject,payload FROM email_outbox WHERE related_type='PURCHASE_RECEIPT' AND related_id=$1`, [order.id])).rows;
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Comprovante da sua compra/);
    assert.match(mails[0].payload.data.message, /Saldo lançado na carteira/); assert.match(mails[0].payload.data.message, /TEXTO DO CONTRATO DE SALDO/);
  });

  it('pedido que não está pago não gera comprovante', async () => {
    const c = await register();
    const pack = (await pool.query(`SELECT id,credits,price_cents FROM credit_packages WHERE active=true ORDER BY price_cents LIMIT 1`)).rows[0];
    const order = (await pool.query(`INSERT INTO payment_orders(user_id,package_id,status,subtotal_cents,amount_cents,credits,provider,external_reference)
      VALUES($1,$2,'CHECKOUT_ACTIVE',$3,$3,$4,'mercadopago',$5) RETURNING id`, [c.id, pack.id, pack.price_cents, pack.credits, `pnm_${uid('y')}`])).rows[0];
    const { sendPurchaseReceipt } = await import('../dist/purchaseContract.js');
    await sendPurchaseReceipt(order.id);
    assert.equal((await pool.query(`SELECT 1 FROM email_outbox WHERE related_type='PURCHASE_RECEIPT' AND related_id=$1`, [order.id])).rowCount, 0);
  });
});
