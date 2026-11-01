import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const P = await import('../dist/lib/profiles.js');

describe('perfis de uso: regras puras', () => {
  it('todo mundo é cliente; loja e link de indicação acrescentam perfis', () => {
    assert.deepEqual(P.availableProfiles({ hasStore: false, hasAffiliate: false }), ['CLIENTE']);
    assert.deepEqual(P.availableProfiles({ hasStore: true, hasAffiliate: false }), ['CLIENTE', 'LOJISTA']);
    assert.deepEqual(P.availableProfiles({ hasStore: true, hasAffiliate: true }), ['CLIENTE', 'LOJISTA', 'AFILIADO']);
  });
  it('perfil guardado que não existe mais volta para cliente', () => {
    assert.equal(P.resolveActive('LOJISTA', ['CLIENTE', 'LOJISTA']), 'LOJISTA');
    assert.equal(P.resolveActive('LOJISTA', ['CLIENTE']), 'CLIENTE');
    assert.equal(P.resolveActive('QUALQUER', ['CLIENTE', 'AFILIADO']), 'CLIENTE');
    assert.equal(P.resolveActive(null, ['CLIENTE']), 'CLIENTE');
  });
});

describe('perfis de uso: servidor (integração)', integration, () => {
  let pool; let server; let token; let userId; let other;
  const me = (t = token) => hostRequest(server.base, '/api/me', { token: t });
  const put = (profile, t = token) => hostRequest(server.base, '/api/me/profile', { method: 'PUT', token: t, body: { profile } });
  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer();
    const mk = async (name) => {
      const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('prf')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
      assert.equal(reg.status, 201, reg.text); return reg.json;
    };
    const a = await mk('Cliente Perfis'); token = a.token; userId = a.user.id;
    const b = await mk('Outro Cliente'); other = b.token;
  });
  after(async () => { await pool.query('DELETE FROM dealerships WHERE owner_user_id=$1', [userId]).catch(() => undefined); await server.stop(); await pool.end(); });

  it('conta nova é só cliente e não consegue se dar outro perfil', async () => {
    const r = await me();
    assert.deepEqual(r.json.profiles, ['CLIENTE']); assert.equal(r.json.activeProfile, 'CLIENTE');
    assert.equal((await put('LOJISTA')).status, 403, 'sem loja não vira lojista');
    assert.equal((await put('AFILIADO')).status, 403, 'sem link de indicação não vira afiliado');
    assert.equal((await put('ADMIN')).status, 400);
    assert.equal((await put('CLIENTE')).status, 200);
    assert.equal((await hostRequest(server.base, '/api/me/profile', { method: 'PUT', body: { profile: 'CLIENTE' } })).status, 401, 'exige login');
  });

  it('ativar o Indique e ganhe libera o perfil afiliado, que fica guardado', async () => {
    assert.equal((await hostRequest(server.base, '/api/affiliate/activate', { method: 'POST', token, body: {} })).status, 201);
    assert.deepEqual((await me()).json.profiles, ['CLIENTE', 'AFILIADO']);
    assert.equal((await put('AFILIADO')).status, 200);
    assert.equal((await me()).json.activeProfile, 'AFILIADO');
    assert.equal((await me(other)).json.activeProfile, 'CLIENTE', 'não mexe em outras contas');
    const a = await pool.query(`SELECT meta FROM audit_logs WHERE user_id=$1 AND action='PROFILE_SWITCHED' ORDER BY created_at DESC LIMIT 1`, [userId]).catch(() => ({ rows: [] }));
    if (a.rows[0]) assert.equal(a.rows[0].meta.to, 'AFILIADO');
  });

  it('link desativado: o perfil some e a conta volta a ser cliente', async () => {
    await pool.query('UPDATE affiliates SET active=false WHERE user_id=$1', [userId]);
    const r = await me();
    assert.deepEqual(r.json.profiles, ['CLIENTE']); assert.equal(r.json.activeProfile, 'CLIENTE');
    assert.equal((await put('AFILIADO')).status, 403);
  });

  it('participar de uma loja ativa libera o perfil lojista; loja suspensa tira', async () => {
    const store = await pool.query(`INSERT INTO dealerships(owner_user_id,name,slug) VALUES($1,'Loja Perfis',$2) RETURNING id`, [userId, uid('lojaperfis').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30)]);
    await pool.query(`INSERT INTO dealership_members(dealership_id,user_id,role) VALUES($1,$2,'OWNER')`, [store.rows[0].id, userId]);
    assert.deepEqual((await me()).json.profiles, ['CLIENTE', 'LOJISTA']);
    assert.equal((await put('LOJISTA')).status, 200);
    assert.equal((await me()).json.activeProfile, 'LOJISTA');
    await pool.query('UPDATE dealerships SET active=false WHERE id=$1', [store.rows[0].id]);
    const r = await me();
    assert.deepEqual(r.json.profiles, ['CLIENTE']); assert.equal(r.json.activeProfile, 'CLIENTE');
    assert.equal((await put('LOJISTA')).status, 403);
  });
});
