import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

const address = { phone: '(11) 99999-0000', cpfCnpj: '529.982.247-25', city: 'São Paulo', state: 'SP' };
const base = { name: 'Cliente Completo', password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true };

describe('cadastro completo do cliente', integration, () => {
  let pool; let server;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ CUSTOMER_PROFILE_REQUIRED: 'true' });
  });
  after(async () => { await server.stop(); await pool.end(); });
  const register = (body) => hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { ...base, email: `${uid('cad')}@cliente.local`, ...body } });

  it('criar conta sem os dados completos ou sem aceite é recusado', async () => {
    assert.equal((await register({})).status, 400);
    const noAccept = await register({ ...address });
    assert.equal(noAccept.status, 400);
    assert.equal(noAccept.json.error, 'RESPONSIBILITY_REQUIRED');
    assert.equal((await register({ ...address, acceptResponsibility: true, cpfCnpj: '111.111.111-11' })).json.error, 'INVALID_OWNER_DOC');
    assert.equal((await register({ ...address, acceptResponsibility: true, phone: '123' })).json.error, 'INVALID_PHONE');
    assert.equal((await register({ ...address, acceptResponsibility: true, city: '' })).json.error, 'PROFILE_INCOMPLETE');
    assert.equal((await register({ ...address, acceptResponsibility: true, state: undefined })).json.error, 'PROFILE_INCOMPLETE');
  });

  it('cadastro enxuto: sem endereço, CEP nem documento anexado, a conta nasce completa', async () => {
    const r = await register({ ...address, acceptResponsibility: true });
    assert.equal(r.status, 201, r.text);
    const me = await hostRequest(server.base, '/api/me', { token: r.json.token });
    assert.equal(me.json.profile.profileComplete, true);
    assert.equal(me.json.profile.responsibilityAccepted, true);
    assert.equal(me.json.profile.zip, '');
    assert.equal(me.json.profile.street, '');
    assert.equal(me.json.profile.city, 'São Paulo');
    const row = (await pool.query('SELECT responsibility_accepted_at,responsibility_version FROM user_profiles WHERE user_id=$1', [r.json.user.id])).rows[0];
    assert.ok(row.responsibility_accepted_at && row.responsibility_version);
  });

  it('formulário antigo, que ainda manda endereço, continua funcionando', async () => {
    const r = await register({ ...address, zip: '01310-100', street: 'Avenida Paulista', streetNumber: '1000', district: 'Bela Vista', acceptResponsibility: true });
    assert.equal(r.status, 201, r.text);
    const me = await hostRequest(server.base, '/api/me', { token: r.json.token });
    assert.equal(me.json.profile.zip, '01310100');
  });

  it('conta de loja/empresa também nasce só com os dados básicos (CNPJ vem depois, no portal do lojista)', async () => {
    const r = await register({ ...address, accountType: 'EMPRESA', acceptResponsibility: true });
    assert.equal(r.status, 201, r.text);
  });

  it('cliente com cadastro incompleto não consulta nem paga, até completar', async () => {
    const reg = await register({ ...address, acceptResponsibility: true });
    // usa a sessão de uma conta nova, esvaziando o perfil para simular cadastro antigo
    await pool.query('UPDATE user_profiles SET phone=NULL,city=NULL,responsibility_accepted_at=NULL WHERE user_id=$1', [reg.json.user.id]);
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [reg.json.user.id]);
    const blocked = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body: { plate: 'SLW0E00', productId: 'LIEN', acceptContract: true, acceptPrivacy: true } });
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(blocked.json.error, 'PROFILE_INCOMPLETE');
    const checkout = await hostRequest(server.base, '/api/payments/query/checkout', { method: 'POST', token: reg.json.token, body: { plate: 'SLW0E00', productId: 'LIEN', acceptContract: true, acceptPrivacy: true } });
    assert.equal(checkout.status, 409, checkout.text);
    assert.equal(checkout.json.error, 'PROFILE_INCOMPLETE');
    const charged = await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [reg.json.user.id]);
    assert.equal(Number(charged.rows[0].balance_cents), 100000, 'nada foi cobrado');

    const me = await hostRequest(server.base, '/api/me', { token: reg.json.token });
    assert.equal(me.json.profile.profileComplete, false);
    assert.deepEqual(me.json.profile.profileMissing.sort(), ['aceite dos termos', 'cidade', 'telefone'].sort());

    const saved = await hostRequest(server.base, '/api/profile', { method: 'PUT', token: reg.json.token, body: { name: 'Cliente Completo', cpfCnpj: address.cpfCnpj, phone: address.phone, city: address.city, state: address.state, acceptResponsibility: true } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.profile.profileComplete, true);
    const ok = await hostRequest(server.base, '/api/queries', { method: 'POST', token: reg.json.token, body: { plate: 'SLW0E00', productId: 'LIEN', acceptContract: true, acceptPrivacy: true } });
    assert.ok([200, 201, 202].includes(ok.status), ok.text);
  });

  it('dados inválidos no perfil são recusados na hora', async () => {
    const reg = await register({ ...address, acceptResponsibility: true });
    const bad = await hostRequest(server.base, '/api/profile', { method: 'PUT', token: reg.json.token, body: { name: 'Cliente', cpfCnpj: '123' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'INVALID_OWNER_DOC');
  });
});
