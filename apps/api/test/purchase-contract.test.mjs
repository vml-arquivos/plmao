import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';
import { acceptPurchaseContract, lastOtp, prepareContractData } from './helpers/contract.mjs';

describe('contrato de adesão por compra: gerado, confirmado por código e ligado ao pedido', integration, () => {
  let pool; let server; let withPhone;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
    withPhone = await startServer({ SUPPORT_PHONE: '(62) 3333-4444', SUPPORT_WHATSAPP: '(62) 99999-0000', SUPPORT_HOURS: 'Seg a sex, 9h às 18h', SUPPORT_EMAIL: 'suporte@exemplo.test' });
  });
  after(async () => { await server.stop(); await withPhone.stop(); await pool.query(`DELETE FROM email_outbox WHERE related_type IN ('PURCHASE_CONTRACT','PURCHASE_RECEIPT')`); await pool.end(); });

  const register = async (name = 'Maria da Silva') => {
    const email = `${uid('ct')}@cliente.local`;
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    return { token: reg.json.token, id: reg.json.user.id, email };
  };
  const coupon = async (pct = 100) => {
    const code = uid('CTR').toUpperCase().replace(/-/g, '');
    await pool.query(`INSERT INTO coupons(code,discount_type,discount_value) VALUES($1,'PERCENT',$2)`, [code, pct]);
    return code;
  };
  const post = (c, path, body) => hostRequest(server.base, path, { method: 'POST', token: c.token, body });
  const queryBody = (extra = {}) => ({ productId: 'COMPLETE', plate: 'DEV1B11', ...extra });

  it('sem CPF/CNPJ no perfil o contrato não é gerado', async () => {
    const c = await register();
    await prepareContractData(pool, null);
    await pool.query(`UPDATE user_profiles SET cpf_cnpj=NULL WHERE user_id=$1`, [c.id]);
    const r = await post(c, '/api/purchase-contracts/draft', queryBody());
    assert.equal(r.status, 422); assert.equal(r.json.error, 'CONTRACT_PROFILE_INCOMPLETE');
    assert.match(r.json.message, /CPF ou CNPJ/);
  });

  it('contrato sai preenchido com cliente, empresa e pedido; texto e hash conferem; código vai por e-mail', async () => {
    const c = await register('Maria da Silva'); await prepareContractData(pool, c.id);
    const r = await post(c, '/api/purchase-contracts/draft', queryBody());
    assert.equal(r.status, 201, r.text);
    const t = r.json.text;
    assert.match(t, /CONTRATO DE ADESÃO: CONSULTA VEICULAR AVULSA/);
    assert.match(t, /Maria da Silva, CPF 529\.982\.247-25/);
    assert.match(t, new RegExp(c.email.replace('.', '\\.')));
    const f = (await pool.query('SELECT legal_name,cnpj FROM fiscal_settings WHERE id=1')).rows[0];
    assert.ok(t.includes(`${f.legal_name}, CNPJ ${f.cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')}`), 'dados da empresa vêm do cadastro fiscal');
    assert.match(t, /Total a pagar: R\$ [\d.,]+ \(/);
    assert.match(t, /ENTREGA E GARANTIA/); assert.match(t, /ACEITE ELETRÔNICO E PROVA/);
    assert.ok(r.json.number.startsWith('PNM-'));
    assert.equal(r.json.hash, crypto.createHash('sha256').update(t).digest('hex'));
    assert.match(r.json.email, /^\w\*+@cliente\.local$/);
    const mail = (await pool.query(`SELECT to_email,subject,payload FROM email_outbox WHERE related_id=$1 AND template='PURCHASE_OTP'`, [r.json.id])).rows;
    assert.equal(mail.length, 1); assert.equal(mail[0].to_email, c.email);
    const code = await lastOtp(pool, r.json.id);
    assert.match(code, /^\d{6}$/);
    assert.ok(!mail[0].subject.includes(code), 'código fora do assunto');
    assert.ok(!JSON.stringify(mail[0].payload).includes(code), 'código não fica em claro na fila');
  });

  it('contrato de saldo (pacote) descreve o valor creditado e o preço', async () => {
    const c = await register(); await prepareContractData(pool, c.id);
    const pack = (await pool.query(`SELECT slug,name,credits,price_cents FROM credit_packages WHERE active=true ORDER BY price_cents LIMIT 1`)).rows[0];
    const r = await post(c, '/api/purchase-contracts/draft', { packageSlug: pack.slug });
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.text, /COMPRA DE SALDO PRÉ-PAGO/);
    assert.ok(r.json.text.includes(pack.name));
    assert.ok(r.json.text.includes(`R$ ${(pack.credits).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`));
    assert.equal(r.json.amountCents, pack.price_cents);
  });

  it('checkout sem contrato, ou com contrato ainda não confirmado, não cria pedido', async () => {
    const c = await register(); await prepareContractData(pool, c.id); const code = await coupon();
    const none = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code }));
    assert.equal(none.status, 400); assert.equal(none.json.error, 'PURCHASE_CONTRACT_REQUIRED');
    assert.match(none.json.message, /Termos do Contrato de Uso/);
    const draft = await post(c, '/api/purchase-contracts/draft', queryBody({ couponCode: code }));
    const pending = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, contractId: draft.json.id }));
    assert.equal(pending.status, 409); assert.equal(pending.json.error, 'PURCHASE_CONTRACT_NOT_ACCEPTED');
    assert.equal((await pool.query('SELECT 1 FROM payment_orders WHERE user_id=$1', [c.id])).rowCount, 0);
  });

  it('código errado gasta tentativa; 5 erros travam; novo código destrava; código vencido é recusado', async () => {
    const c = await register(); await prepareContractData(pool, c.id);
    const d = (await post(c, '/api/purchase-contracts/draft', queryBody())).json;
    const good = await lastOtp(pool, d.id);
    const wrong = good === '000000' ? '111111' : '000000';
    const first = await post(c, `/api/purchase-contracts/${d.id}/confirm`, { code: wrong, accept: true });
    assert.equal(first.status, 400); assert.equal(first.json.error, 'PURCHASE_OTP_INVALID'); assert.equal(first.json.attemptsLeft, 4);
    for (let i = 0; i < 4; i += 1) await post(c, `/api/purchase-contracts/${d.id}/confirm`, { code: wrong, accept: true });
    const locked = await post(c, `/api/purchase-contracts/${d.id}/confirm`, { code: good, accept: true });
    assert.equal(locked.status, 429); assert.equal(locked.json.error, 'PURCHASE_OTP_LOCKED');
    const soon = await post(c, `/api/purchase-contracts/${d.id}/resend`, {});
    assert.equal(soon.status, 429); assert.equal(soon.json.error, 'PURCHASE_OTP_TOO_SOON');
    await pool.query(`UPDATE purchase_contracts SET otp_last_sent_at=now() - interval '2 minutes' WHERE id=$1`, [d.id]);
    assert.equal((await post(c, `/api/purchase-contracts/${d.id}/resend`, {})).status, 200);
    const fresh = await lastOtp(pool, d.id);
    await pool.query(`UPDATE purchase_contracts SET otp_expires_at=now() - interval '1 minute' WHERE id=$1`, [d.id]);
    const expired = await post(c, `/api/purchase-contracts/${d.id}/confirm`, { code: fresh, accept: true });
    assert.equal(expired.json.error, 'PURCHASE_OTP_EXPIRED');
    await pool.query(`UPDATE purchase_contracts SET otp_last_sent_at=now() - interval '2 minutes' WHERE id=$1`, [d.id]);
    await post(c, `/api/purchase-contracts/${d.id}/resend`, {});
    const ok = await post(c, `/api/purchase-contracts/${d.id}/confirm`, { code: await lastOtp(pool, d.id), accept: true });
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.accepted, true);
  });

  it('contrato aceito guarda as evidências, vira pedido uma vez só e não pode ser alterado', async () => {
    const c = await register(); const code = await coupon();
    const body = queryBody({ couponCode: code });
    const a = await acceptPurchaseContract(server.base, pool, c, body);
    assert.ok(a.contractId, JSON.stringify(a.failed?.json));
    const row = (await pool.query('SELECT status,accepted_at,accept_ip_hash,accept_user_agent,otp_hash,body_hash FROM purchase_contracts WHERE id=$1', [a.contractId])).rows[0];
    assert.equal(row.status, 'ACEITO'); assert.ok(row.accepted_at); assert.ok(row.accept_ip_hash); assert.equal(row.otp_hash, null, 'código descartado após o aceite');
    const copy = (await pool.query(`SELECT payload FROM email_outbox WHERE related_id=$1 AND template='GENERIC_NOTICE'`, [a.contractId])).rows;
    assert.equal(copy.length, 1); assert.doesNotMatch(JSON.stringify(copy[0].payload), /52998224725|529\.982/, 'sem CPF no e-mail de aviso');

    const order = await post(c, '/api/payments/query/checkout', { ...body, contractId: a.contractId });
    assert.equal(order.status, 201, order.text);
    const linked = (await pool.query('SELECT status,order_id FROM purchase_contracts WHERE id=$1', [a.contractId])).rows[0];
    assert.equal(linked.status, 'USADO'); assert.equal(linked.order_id, order.json.orderId);

    const code2 = await coupon();
    const again = await post(c, '/api/payments/query/checkout', { ...queryBody({ couponCode: code2 }), contractId: a.contractId });
    assert.equal(again.status, 409); assert.equal(again.json.error, 'PURCHASE_CONTRACT_USED');
    await assert.rejects(pool.query(`UPDATE purchase_contracts SET body='outro texto' WHERE id=$1`, [a.contractId]), /nao mudam/);
  });

  it('contrato de outro valor, de outro item ou de outro cliente não vale', async () => {
    const c = await register(); const other = await register(); const code = await coupon();
    const a = await acceptPurchaseContract(server.base, pool, c, queryBody()); // preço cheio
    assert.ok(a.contractId);
    const wrongAmount = await post(c, '/api/payments/query/checkout', queryBody({ couponCode: code, contractId: a.contractId }));
    assert.equal(wrongAmount.status, 409); assert.equal(wrongAmount.json.error, 'PURCHASE_CONTRACT_MISMATCH');
    await prepareContractData(pool, other.id);
    const stolen = await post(other, '/api/payments/query/checkout', queryBody({ couponCode: code, contractId: a.contractId }));
    assert.equal(stolen.status, 400); assert.equal(stolen.json.error, 'PURCHASE_CONTRACT_REQUIRED');
    assert.equal((await hostRequest(server.base, `/api/purchase-contracts/${a.contractId}`, { token: other.token })).status, 404);
  });

  it('"Meus contratos" lista só os aceitos e abre o texto', async () => {
    const c = await register(); await prepareContractData(pool, c.id);
    await post(c, '/api/purchase-contracts/draft', queryBody()); // sem aceite
    const a = await acceptPurchaseContract(server.base, pool, c, queryBody());
    const list = await hostRequest(server.base, '/api/purchase-contracts', { token: c.token });
    assert.equal(list.status, 200); assert.equal(list.json.items.length, 1); assert.equal(list.json.items[0].id, a.contractId);
    const one = await hostRequest(server.base, `/api/purchase-contracts/${a.contractId}`, { token: c.token });
    assert.equal(one.status, 200); assert.match(one.json.body, /CONTRATO DE ADESÃO/); assert.equal(one.json.body_hash.length, 64);
  });

  it('telefone, WhatsApp e e-mail de suporte entram no contrato só quando configurados', async () => {
    const none = await hostRequest(server.base, '/api/support-info');
    assert.deepEqual(none.json, { phone: null, whatsapp: null, whatsappUrl: null, hours: null });
    const set = await hostRequest(withPhone.base, '/api/support-info');
    assert.equal(set.json.phone, '(62) 3333-4444');
    assert.equal(set.json.whatsappUrl, 'https://wa.me/5562999990000');
    assert.equal(set.json.hours, 'Seg a sex, 9h às 18h');
    const reg = await hostRequest(withPhone.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Contato', email: `${uid('sp')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    await prepareContractData(pool, reg.json.user.id);
    const d = await hostRequest(withPhone.base, '/api/purchase-contracts/draft', { method: 'POST', token: reg.json.token, body: queryBody() });
    assert.match(d.json.text, /suporte@exemplo\.test/); assert.match(d.json.text, /\(62\) 99999-0000/);
  });

  it('painel: equipe vê os aceites com as evidências; cliente comum não acessa', async () => {
    const admin = await adminSession({ server, pool, role: 'ADMIN' });
    const c = await register('Cliente Painel'); const code = await coupon();
    const a = await acceptPurchaseContract(server.base, pool, c, queryBody({ couponCode: code }));
    const order = await post(c, '/api/payments/query/checkout', { ...queryBody({ couponCode: code }), contractId: a.contractId });
    assert.equal(order.status, 201);
    const list = await admin.call(`/api/admin/purchase-contracts?orderId=${order.json.orderId}`);
    assert.equal(list.status, 200); assert.equal(list.json.items.length, 1); assert.equal(list.json.items[0].order_status, 'PAID');
    const one = await admin.call(`/api/admin/purchase-contracts/${a.contractId}`);
    assert.equal(one.status, 200); assert.ok(one.json.accept_ip_hash); assert.match(one.json.otp_destination, /\*/); assert.match(one.json.body, /Cliente Painel/);
    const asClient = await hostRequest(server.base, `/api/admin/purchase-contracts/${a.contractId}`, { token: c.token });
    assert.ok([401, 403, 404].includes(asClient.status));
  });
});
