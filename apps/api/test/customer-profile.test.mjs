import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

const purchase = { cpfCnpj: '529.982.247-25', city: 'São Paulo', state: 'SP' };
const phone = '(11) 99999-0000';
const base = { name: 'Cliente Simples', password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true };

/** Conta simples (nome, e-mail, telefone); CPF, cidade, estado e aceite só na primeira compra; chave PIX opcional no cadastro. */
describe('cadastro por etapas do cliente', integration, () => {
  let pool; let server;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ CUSTOMER_PROFILE_REQUIRED: 'true', FEATURE_FREE_FIPE: 'true' });
  });
  after(async () => { await server.stop(); }); // o pool é compartilhado com o próximo bloco; quem fecha é o último
  const register = (body) => hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { ...base, email: `${uid('cad')}@cliente.local`, ...body } });
  const me = (token) => hostRequest(server.base, '/api/me', { token });

  it('criar conta pede só nome, e-mail, telefone e senha (CPF e endereço não)', async () => {
    assert.equal((await register({})).json.error, 'INVALID_PHONE', 'sem telefone não cria');
    assert.equal((await register({ phone: '123' })).json.error, 'INVALID_PHONE');
    const r = await register({ phone });
    assert.equal(r.status, 201, r.text);
    const p = (await me(r.json.token)).json.profile;
    assert.equal(p.phone, phone);
    assert.equal(p.cpfCnpj, '');
    assert.deepEqual(p.accessMissing, []);
    assert.deepEqual([...p.profileMissing].sort(), ['CPF', 'aceite dos termos', 'cidade', 'estado'].sort());
    assert.equal(p.profileComplete, false);
    assert.equal(p.pixKeyMissing, true);
  });

  it('CPF informado no cadastro, se vier, precisa ser válido; o formulário antigo (completo) continua valendo', async () => {
    assert.equal((await register({ phone, cpfCnpj: '111.111.111-11' })).json.error, 'INVALID_OWNER_DOC');
    const old = await register({ phone, ...purchase, zip: '01310-100', street: 'Avenida Paulista', streetNumber: '1000', district: 'Bela Vista', acceptResponsibility: true });
    assert.equal(old.status, 201, old.text);
    const p = (await me(old.json.token)).json.profile;
    assert.equal(p.profileComplete, true);
    assert.equal(p.responsibilityAccepted, true);
    assert.equal(p.zip, '01310100');
  });

  it('conta de loja/empresa também nasce simples', async () => {
    assert.equal((await register({ phone, accountType: 'EMPRESA' })).status, 201);
  });

  it('conta simples usa o que é grátis (FIPE pela placa) sem completar cadastro', async () => {
    const reg = await register({ phone });
    const q = await hostRequest(server.base, '/api/fipe/quote', { method: 'POST', token: reg.json.token, body: { plate: 'DEV1B11' } });
    assert.notEqual(q.json?.error, 'PROFILE_INCOMPLETE', q.text);
    assert.notEqual(q.status, 409, q.text);
    assert.notEqual(q.json?.error, 'FIPE_PLATE_LOGIN_REQUIRED');
  });

  it('comprar consulta: bloqueia até completar os dados de compra, uma vez só', async () => {
    const reg = await register({ phone });
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
    const body = { plate: 'SLW0E00', productId: 'LIEN', acceptContract: true, acceptPrivacy: true };
    const blocked = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body });
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(blocked.json.error, 'PROFILE_INCOMPLETE');
    assert.match(blocked.json.message, /primeira compra/);
    const checkout = await hostRequest(server.base, '/api/payments/query/checkout', { method: 'POST', token: reg.json.token, body });
    assert.equal(checkout.status, 409, checkout.text);
    assert.equal(checkout.json.error, 'PROFILE_INCOMPLETE');
    assert.equal(Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [reg.json.user.id])).rows[0].balance_cents), 100000, 'nada foi cobrado');

    const saved = await hostRequest(server.base, '/api/profile', { method: 'PUT', token: reg.json.token, body: { name: 'Cliente Simples', phone, ...purchase, acceptResponsibility: true } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.profile.profileComplete, true);
    const ok = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body });
    assert.ok([200, 201, 202].includes(ok.status), ok.text);
    // segunda compra: não pede nada de novo
    const again = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body: { ...body, plate: 'SLW0E01' } });
    assert.notEqual(again.json?.error, 'PROFILE_INCOMPLETE', again.text);
  });

  it('produto gratuito não pede cadastro de compra', async () => {
    const reg = await register({ phone });
    const prev = (await pool.query(`SELECT is_free FROM query_products WHERE id='LIEN'`)).rows[0]?.is_free;
    await pool.query(`UPDATE query_products SET is_free=true WHERE id='LIEN'`);
    try {
      const r = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body: { plate: 'SLW0E00', productId: 'LIEN' } });
      assert.notEqual(r.json?.error, 'PROFILE_INCOMPLETE', r.text);
    } finally { await pool.query(`UPDATE query_products SET is_free=$1 WHERE id='LIEN'`, [prev ?? false]); }
  });

  it('dados inválidos no perfil são recusados na hora', async () => {
    const reg = await register({ phone });
    const bad = await hostRequest(server.base, '/api/profile', { method: 'PUT', token: reg.json.token, body: { name: 'Cliente', cpfCnpj: '123' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'INVALID_OWNER_DOC');
  });
});

describe('chave PIX do cliente', integration, () => {
  let pool; let server;
  before(async () => { useTestEnv(); ({ pool } = await loadCore()); server = await startServer({ CUSTOMER_PROFILE_REQUIRED: 'true' }); });
  after(async () => { await server.stop(); await pool.end(); });
  const register = (body) => hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { ...base, email: `${uid('pix')}@cliente.local`, phone, ...body } });
  const put = (token, body) => hostRequest(server.base, '/api/profile', { method: 'PUT', token, body: { name: 'Cliente Pix', phone, ...body } });
  const stored = async (id) => (await pool.query('SELECT pix_key,pix_key_type,pix_key_updated_at FROM user_profiles WHERE user_id=$1', [id])).rows[0];

  it('no cadastro a chave é opcional, mas se vier precisa ser válida e é guardada normalizada', async () => {
    const none = await register({});
    assert.equal(none.status, 201);
    assert.equal((await stored(none.json.user.id)).pix_key, null);

    assert.equal((await register({ pixKey: '111.111.111-11', pixKeyType: 'CPF' })).json.error, 'INVALID_PIX_KEY');
    assert.equal((await register({ pixKey: 'isto-nao-e-chave' })).json.error, 'INVALID_PIX_KEY');

    const cpf = await register({ pixKey: '529.982.247-25', pixKeyType: 'CPF' });
    assert.equal(cpf.status, 201, cpf.text);
    const row = await stored(cpf.json.user.id);
    assert.equal(row.pix_key, '52998224725');
    assert.equal(row.pix_key_type, 'CPF');
    assert.ok(row.pix_key_updated_at);
    const p = (await hostRequest(server.base, '/api/me', { token: cpf.json.token })).json.profile;
    assert.equal(p.pixKeyMissing, false);
    assert.equal(p.pixKeyMasked, '***4725');

    const cel = await register({ pixKey: '(11) 98888-7777', pixKeyType: 'TELEFONE' });
    assert.equal((await stored(cel.json.user.id)).pix_key, '+5511988887777');
    const mail = await register({ pixKey: 'Fulano@Exemplo.com' });
    assert.deepEqual([(await stored(mail.json.user.id)).pix_key, (await stored(mail.json.user.id)).pix_key_type], ['fulano@exemplo.com', 'EMAIL']);
    const rnd = await register({ pixKey: '123e4567-e89b-12d3-a456-426614174000', pixKeyType: 'ALEATORIA' });
    assert.equal((await stored(rnd.json.user.id)).pix_key_type, 'ALEATORIA');
  });

  it('em Minha conta: troca, mantém quando não enviada e apaga quando enviada vazia', async () => {
    const reg = await register({});
    const set = await put(reg.json.token, { pixKey: 'cliente@exemplo.com', pixKeyType: 'EMAIL' });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.json.profile.pixKey, 'cliente@exemplo.com');
    // salvar outra coisa sem mandar a chave não mexe nela
    const keep = await put(reg.json.token, { marketingOptIn: true });
    assert.equal(keep.json.profile.pixKey, 'cliente@exemplo.com');
    // chave inválida é recusada e a antiga fica
    const bad = await put(reg.json.token, { pixKey: '123', pixKeyType: 'CNPJ' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'INVALID_PIX_KEY');
    assert.equal((await stored(reg.json.user.id)).pix_key, 'cliente@exemplo.com');
    // vazia apaga
    const clear = await put(reg.json.token, { pixKey: '' });
    assert.equal(clear.status, 200, clear.text);
    assert.equal((await stored(reg.json.user.id)).pix_key, null);
    assert.equal(clear.json.profile.pixKeyMissing, true);
  });

  it('a chave nunca vai para o registro de auditoria', async () => {
    const reg = await register({});
    await put(reg.json.token, { pixKey: 'segredo.pix@exemplo.com', pixKeyType: 'EMAIL' });
    const logs = await pool.query(`SELECT metadata::text AS m FROM audit_logs WHERE user_id=$1`, [reg.json.user.id]);
    assert.ok(logs.rows.length > 0);
    assert.ok(logs.rows.every((x) => !String(x.m).includes('segredo.pix')));
  });

  it('regras de detecção e máscara da chave', async () => {
    const { normalizePixKey, detectPixType, maskPixKey } = await import('../dist/lib/pix.js');
    assert.equal(detectPixType('529.982.247-25'), 'CPF');
    assert.equal(detectPixType('11.222.333/0001-81'), 'CNPJ');
    assert.equal(detectPixType('+55 11 98888-7777'), 'TELEFONE');
    assert.equal(detectPixType('a@b.co'), 'EMAIL');
    assert.equal(detectPixType('lixo'), null);
    assert.equal(normalizePixKey('', 'CPF'), null);
    assert.equal(normalizePixKey('529.982.247-25', 'CNPJ'), null);
    assert.equal(maskPixKey('fulano@exemplo.com', 'EMAIL'), 'fu***@exemplo.com');
    assert.equal(maskPixKey('52998224725', 'CPF'), '***4725');
    assert.equal(maskPixKey(null), null);
  });
});
