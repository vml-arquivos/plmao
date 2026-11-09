import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';

useTestEnv({ OAUTH_GOOGLE_CLIENT_ID: 'teste.apps.googleusercontent.com', OAUTH_GOOGLE_CLIENT_SECRET: 'segredo-de-teste' });
const oauth = await import('../dist/oauth.js');

const config = { id: 'google', displayName: 'Google', clientId: 'x', issuer: 'https://accounts.google.com' };
const identity = (email, sub = uid('sub')) => ({ providerAccountId: sub, email, name: 'Maria Teste', emailVerified: true, profile: { sub } });

describe('entrar com Google', integration, () => {
  let db;
  before(async () => { db = await loadCore(); });
  after(async () => { await db.pool.end(); });

  it('o botão só aparece com ID e chave configurados', () => {
    const google = oauth.socialProviderStatus().find((p) => p.id === 'google');
    assert.equal(google.enabled, true);
    assert.equal(oauth.socialProviderStatus().find((p) => p.id === 'microsoft').enabled, false);
  });

  it('cliente novo: cria conta CLIENTE com carteira e registra o aceite dos termos', async () => {
    const email = `${uid('g')}@example.com`;
    const { user, created } = await oauth.upsertSocialUser('google', config, identity(email));
    assert.equal(created, true); assert.equal(user.role, 'CLIENTE'); assert.equal(user.email, email);
    const wallet = await db.pool.query('SELECT balance FROM wallets WHERE user_id=$1', [user.id]);
    assert.equal(wallet.rowCount, 1);
    const consents = await db.pool.query('SELECT consent_type,granted,source FROM user_consents WHERE user_id=$1 ORDER BY consent_type', [user.id]);
    const by = Object.fromEntries(consents.rows.map((r) => [r.consent_type, r]));
    assert.equal(by.TERMS_OF_SERVICE.granted, true); assert.equal(by.PRIVACY_POLICY.granted, true);
    assert.equal(by.MARKETING_EMAIL.granted, false); assert.equal(by.TERMS_OF_SERVICE.source, 'oauth_google');
    const u = await db.pool.query('SELECT password_enabled FROM users WHERE id=$1', [user.id]);
    assert.equal(u.rows[0].password_enabled, false);
  });

  it('segundo acesso com a mesma conta Google não cria outra conta', async () => {
    const email = `${uid('g')}@example.com`; const id = identity(email);
    const a = await oauth.upsertSocialUser('google', config, id);
    const b = await oauth.upsertSocialUser('google', config, id);
    assert.equal(b.created, false); assert.equal(b.user.id, a.user.id);
  });

  it('cliente que já tem conta com o mesmo e-mail é ligado, sem duplicar', async () => {
    const email = `${uid('g')}@example.com`;
    const row = await db.pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Cliente Antigo','CLIENTE') RETURNING id`, [email.toUpperCase()]);
    const r = await oauth.upsertSocialUser('google', config, identity(email));
    assert.equal(r.created, false); assert.equal(r.user.id, row.rows[0].id);
  });

  it('conta da equipe nunca entra nem é ligada pelo Google', async () => {
    const email = `${uid('staff')}@example.com`;
    const row = await db.pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,'x','Equipe','ADMIN') RETURNING id`, [email]);
    await assert.rejects(oauth.upsertSocialUser('google', config, identity(email)), { code: 'OAUTH_ACCOUNT_UNAVAILABLE' });
    const linked = await db.pool.query('SELECT 1 FROM user_identities WHERE user_id=$1', [row.rows[0].id]);
    assert.equal(linked.rowCount, 0);
  });

  it('conta desativada não entra', async () => {
    const email = `${uid('off')}@example.com`;
    await db.pool.query(`INSERT INTO users(email,password_hash,name,role,active) VALUES($1,'x','Inativo','CLIENTE',false)`, [email]);
    await assert.rejects(oauth.upsertSocialUser('google', config, identity(email)), { code: 'OAUTH_ACCOUNT_UNAVAILABLE' });
  });
});
