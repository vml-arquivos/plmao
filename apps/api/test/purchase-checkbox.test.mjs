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
    const r = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: true, acceptPrivacy: true }));
    assert.equal(r.status, 201, r.text); assert.equal(r.json.free, true);
    const row = (await pool.query(`SELECT number,status,order_id,otp_channel,model_version,body,accepted_at,accept_ip_hash FROM purchase_contracts WHERE user_id=$1`, [c.id])).rows;
    assert.equal(row.length, 1);
    assert.equal(row[0].status, 'USADO'); assert.equal(row[0].order_id, r.json.orderId); assert.equal(row[0].otp_channel, 'CHECKBOX');
    assert.equal(row[0].model_version, '2026-10-c3'); assert.ok(row[0].accepted_at); assert.ok(row[0].accept_ip_hash);
    assert.match(row[0].body, /Li e aceito os Termos do Contrato de Uso/); assert.match(row[0].body, /RESPONSABILIDADE DO CONTRATANTE PELO USO DOS DADOS/); assert.match(row[0].body, /Joana Souza/);
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
    assert.equal(r.status, 400); assert.equal(r.json.error, 'PURCHASE_CONTRACT_REQUIRED'); assert.match(r.json.message, /Termos do Contrato de Uso/);
    assert.equal((await pool.query('SELECT 1 FROM payment_orders WHERE user_id=$1', [c.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM purchase_contracts WHERE user_id=$1', [c.id])).rowCount, 0);
  });

  it('ler o contrato é opcional: a prévia mostra o texto e não grava nada', async () => {
    const c = await register('Carlos Lima'); await prepareContractData(pool, c.id);
    const p = await post(c, '/api/purchase-contracts/preview', queryBody());
    assert.equal(p.status, 200, p.text);
    assert.match(p.json.text, /CONTRATO DE ADESÃO: CONSULTA VEICULAR AVULSA/); assert.match(p.json.text, /Carlos Lima/); assert.match(p.json.text, /Estou ciente e concordo com a Política de Privacidade/); assert.match(p.json.text, /LIMITES DE RESPONSABILIDADE DA CONTRATADA/);
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
      VALUES($1,$2,'PACKAGE',$3,$4,'2026-10-c3','{}'::jsonb,'TEXTO DO CONTRATO DE SALDO','h','CHECKBOX','USADO',now(),now(),$5)`, [`PNM-T-${uid('n')}`, c.id, pack.slug, pack.price_cents, order.id]);
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
  it('só os Termos marcados, sem a Política de Privacidade: recusa e não cria nada', async () => {
    const c = await register(); await prepareContractData(pool, c.id); const code = await coupon();
    const r = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: true }));
    assert.equal(r.status, 400); assert.equal(r.json.error, 'PURCHASE_PRIVACY_REQUIRED'); assert.match(r.json.message, /Política de Privacidade/);
    assert.equal((await pool.query('SELECT 1 FROM payment_orders WHERE user_id=$1', [c.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM purchase_contracts WHERE user_id=$1', [c.id])).rowCount, 0);
    const bad = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: false, acceptPrivacy: true }));
    assert.equal(bad.status, 400);
  });

  it('o aceite grava data, IP, navegador e versão do contrato e da política, ligados ao pedido', async () => {
    const c = await register(); await prepareContractData(pool, c.id); const code = await coupon();
    const r = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: true, acceptPrivacy: true }));
    assert.equal(r.status, 201, r.text);
    const ct = (await pool.query('SELECT id,model_version,accept_ip,accept_ip_hash,accept_user_agent,accepted_at,privacy_accepted_at,privacy_version FROM purchase_contracts WHERE order_id=$1', [r.json.orderId])).rows[0];
    assert.ok(ct.accept_ip, 'IP gravado'); assert.ok(ct.accept_ip_hash); assert.ok(ct.accepted_at); assert.ok(ct.privacy_accepted_at); assert.equal(ct.privacy_version, '2026-08'); assert.equal(ct.model_version, '2026-10-c3');
    const cons = (await pool.query(`SELECT consent_type,policy_version,source,ip,related_type,related_id FROM user_consents WHERE user_id=$1 AND source='purchase' ORDER BY consent_type`, [c.id])).rows;
    assert.deepEqual(cons.map((x) => x.consent_type), ['PRIVACY_POLICY', 'TERMS_OF_SERVICE']);
    for (const x of cons) { assert.equal(x.policy_version, '2026-08'); assert.ok(x.ip); assert.equal(x.related_type, 'PURCHASE_CONTRACT'); assert.equal(x.related_id, ct.id); }
  });

  it('consulta com saldo: exige aceite vigente ou as duas caixas, e grava o que foi marcado', async () => {
    const c = await register();
    const status = await hostRequest(server.base, '/api/legal/acceptance', { token: c.token });
    assert.equal(status.status, 200); assert.equal(status.json.accepted, true); assert.equal(status.json.version, '2026-08');
    await pool.query(`DELETE FROM user_consents WHERE user_id=$1 AND consent_type IN ('TERMS_OF_SERVICE','PRIVACY_POLICY')`, [c.id]);
    assert.equal((await hostRequest(server.base, '/api/legal/acceptance', { token: c.token })).json.accepted, false);
    await pool.query(`UPDATE wallets SET balance=500,balance_cents=50000 WHERE user_id=$1`, [c.id]);
    const blocked = await post(c, '/api/queries', queryBody());
    assert.equal(blocked.status, 400); assert.equal(blocked.json.error, 'TERMS_ACCEPTANCE_REQUIRED'); assert.match(blocked.json.message, /Termos do Contrato de Uso e a Política de Privacidade/);
    const half = await post(c, '/api/queries', queryBody({ acceptContract: true }));
    assert.equal(half.status, 400); assert.equal(half.json.error, 'PURCHASE_PRIVACY_REQUIRED');
    assert.equal((await pool.query('SELECT 1 FROM vehicle_queries WHERE user_id=$1', [c.id])).rowCount, 0, 'nada foi cobrado nem consultado');
    const ok = await post(c, '/api/queries', queryBody({ acceptContract: true, acceptPrivacy: true }));
    assert.equal(ok.status, 201, ok.text);
    const rows = (await pool.query(`SELECT consent_type,source,ip FROM user_consents WHERE user_id=$1 AND source='query'`, [c.id])).rows;
    assert.equal(rows.length, 2); assert.ok(rows.every((x) => x.ip));
    assert.equal((await hostRequest(server.base, '/api/legal/acceptance', { token: c.token })).json.accepted, true);
    const again = await post(c, '/api/queries', queryBody()); // aceite vigente: não precisa marcar de novo
    assert.equal(again.status, 201, again.text);
  });

  it('sem razão social e CNPJ da empresa a compra não abre e a mensagem é clara; com COMPANY_* funciona', async () => {
    const old = (await pool.query('SELECT legal_name,cnpj FROM fiscal_settings WHERE id=1')).rows[0];
    const fb = await startServer({ COMPANY_LEGAL_NAME: 'EMPRESA TESTE LTDA', COMPANY_CNPJ: '11222333000181', COMPANY_ADDRESS: 'Rua A, 1, Goiânia, GO' });
    try {
      await pool.query(`UPDATE fiscal_settings SET legal_name='',cnpj='' WHERE id=1`);
      const c = await register(); const code = await coupon();
      const none = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, acceptContract: true, acceptPrivacy: true }));
      assert.equal(none.status, 503); assert.equal(none.json.error, 'PURCHASE_CONTRACTOR_MISSING'); assert.match(none.json.message, /temporariamente indisponível/);
      assert.equal((await pool.query('SELECT 1 FROM payment_orders WHERE user_id=$1', [c.id])).rowCount, 0);
      const code2 = await coupon();
      const reg = await hostRequest(fb.base, '/api/auth/register', { method: 'POST', body: { name: 'Pedro Alves', email: `${uid('fb')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
      const ok = await hostRequest(fb.base, '/api/payments/query/checkout', { method: 'POST', token: reg.json.token, body: queryBody({ couponCode: code2, acceptContract: true, acceptPrivacy: true }) });
      assert.equal(ok.status, 201, ok.text);
      const body = (await pool.query('SELECT body FROM purchase_contracts WHERE order_id=$1', [ok.json.orderId])).rows[0].body;
      assert.match(body, /EMPRESA TESTE LTDA, CNPJ 11\.222\.333\/0001-81, Rua A, 1, Goiânia, GO/);
    } finally {
      await pool.query(`UPDATE fiscal_settings SET legal_name=$1,cnpj=$2 WHERE id=1`, [old?.legal_name ?? null, old?.cnpj ?? null]);
      await fb.stop();
    }
  });
});
