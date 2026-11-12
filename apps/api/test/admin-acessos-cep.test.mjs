import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const cep = await import('../dist/lib/cep.js');

const brasil = { cep: '70040010', state: 'DF', city: 'Brasília', neighborhood: 'Asa Norte', street: 'Via S1', service: 'open-cep' };
const via = { cep: '70040-010', logradouro: 'Via S1', complemento: '', bairro: 'Asa Norte', localidade: 'Brasília', uf: 'DF', ibge: '5300108' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

describe('busca de CEP (BrasilAPI com ViaCEP de reserva)', () => {
  it('CEP inválido não chama ninguém', async () => {
    const calls = [];
    const f = async (u) => { calls.push(String(u)); return json(brasil); };
    for (const bad of ['', '123', '00000000', 'abcdefgh', '1234567890']) await assert.rejects(() => cep.lookupCep(bad, { requester: 'a', fetchImpl: f }), (e) => e.code === 'CEP_INVALID');
    assert.equal(calls.length, 0);
  });
  it('fonte principal: devolve rua, bairro, cidade e UF; segunda busca vem do cache', async () => {
    cep.resetCepState();
    const calls = [];
    const f = async (u) => { calls.push(String(u)); return json(brasil); };
    const r = await cep.lookupCep('70040-010', { requester: 'a', fetchImpl: f });
    assert.deepEqual(r.data, { cep: '70040010', street: 'Via S1', district: 'Asa Norte', city: 'Brasília', state: 'DF', complement: null });
    assert.equal(r.source, 'BrasilAPI'); assert.equal(r.cached, false);
    assert.match(calls[0], /\/api\/cep\/v2\/70040010$/);
    const again = await cep.lookupCep('70040010', { requester: 'a', fetchImpl: f });
    assert.equal(again.cached, true); assert.equal(calls.length, 1);
  });
  it('principal fora do ar ou sem o CEP: a reserva responde', async () => {
    cep.resetCepState();
    const down = async (u) => (String(u).includes('/api/cep/') ? json({ message: 'erro' }, 500) : json(via));
    const r1 = await cep.lookupCep('70040010', { requester: 'a', fetchImpl: down });
    assert.equal(r1.source, 'ViaCEP'); assert.equal(r1.data.street, 'Via S1'); assert.equal(r1.data.state, 'DF');
    cep.resetCepState();
    const miss = async (u) => (String(u).includes('/api/cep/') ? json({ message: 'CEP NAO ENCONTRADO' }, 404) : json(via));
    assert.equal((await cep.lookupCep('70040010', { requester: 'b', fetchImpl: miss })).source, 'ViaCEP');
  });
  it('CEP que nenhuma fonte conhece: não encontrado; nenhuma fonte no ar: indisponível', async () => {
    cep.resetCepState();
    const none = async (u) => (String(u).includes('/api/cep/') ? json({}, 404) : json({ erro: true }));
    await assert.rejects(() => cep.lookupCep('99999999', { requester: 'a', fetchImpl: none }), (e) => e.code === 'CEP_NOT_FOUND');
    const dead = async () => { throw new Error('rede'); };
    await assert.rejects(() => cep.lookupCep('88888888', { requester: 'a', fetchImpl: dead }), (e) => e.code === 'CEP_UNAVAILABLE');
  });
  it('limite por solicitante', () => {
    const k = `c-${Math.random()}`; const now = 1_000_000;
    for (let i = 0; i < 60; i++) assert.equal(cep.cepRateLimit(k, now + i), true);
    assert.equal(cep.cepRateLimit(k, now + 61), false);
    assert.equal(cep.cepRateLimit(k, now + 700_000), true);
  });
});

describe('painel: CEP e CNPJ ligados por padrão, loja e acessos por cliente', integration, () => {
  let pool; let app; let fake; let sa; let adm;
  const calls = [];
  before(async () => {
    ({ pool } = await loadCore());
    fake = http.createServer((req, res) => {
      calls.push(req.url);
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/cep/v2/70040010') return send(200, brasil);
      if (req.url.startsWith('/api/cep/v2/')) return send(404, { message: 'CEP NAO ENCONTRADO' });
      if (req.url.startsWith('/ws/')) return send(200, { erro: true });
      if (req.url === '/api/cnpj/v1/11222333000181') return send(200, { cnpj: '11222333000181', razao_social: 'EMPRESA EXEMPLO LTDA', nome_fantasia: 'Exemplo Motors', descricao_situacao_cadastral: 'ATIVA', cep: '70040010', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'EXEMPLO', numero: '10', bairro: 'CENTRO', municipio: 'BRASILIA', uf: 'df' });
      return send(404, {});
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    // sem CNPJ_PROVIDER nem CEP_PROVIDER: o padrão já é ligado
    app = await startServer({ CNPJ_BASE_URL: base, CEP_BASE_URL: base, CEP_FALLBACK_BASE_URL: base });
    sa = await adminSession({ server: app, pool, role: 'SUPER_ADMIN' });
    adm = await adminSession({ server: app, pool, role: 'ADMIN' });
  });
  after(async () => { await app?.stop(); fake?.close(); await pool.end(); });

  async function cliente() {
    const email = `${uid('ac')}@cliente.local`;
    const r = await app.request('/api/auth/register', { method: 'POST', body: { name: 'Vilson Teste', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
    const id = (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
    return { token: j.token, id: String(id), email };
  }

  it('CEP e CNPJ já vêm ligados, sem variável de ambiente', async () => {
    assert.equal((await sa.call('/api/admin/cep/status')).json.enabled, true);
    assert.equal((await sa.call('/api/admin/cnpj/status')).json.enabled, true);
  });

  it('CEP no painel: preenche o endereço; inválido 400; desconhecido 404; exige login e permissão', async () => {
    const ok = await sa.call('/api/admin/cep/70040-010');
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.data.street, 'Via S1'); assert.equal(ok.json.data.city, 'Brasília'); assert.equal(ok.json.data.state, 'DF');
    assert.equal((await sa.call('/api/admin/cep/123')).status, 400);
    const nf = await sa.call('/api/admin/cep/12345678');
    assert.equal(nf.status, 404); assert.equal(nf.json.error, 'CEP_NOT_FOUND');
    const conteudo = await adminSession({ server: app, pool, role: 'CONTEUDO' });
    assert.equal((await conteudo.call('/api/admin/cep/70040010')).status, 403);
    const anon = await app.request('/api/account/cep/70040010');
    assert.equal(anon.status, 401);
    const c = await cliente();
    assert.equal((await app.request('/api/account/cep/70040010', { token: c.token })).status, 200);
  });

  it('CNPJ no painel: devolve razão social, fantasia e endereço para preencher o cadastro', async () => {
    const r = await sa.call('/api/admin/cnpj/11222333000181');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.data.legalName, 'EMPRESA EXEMPLO LTDA'); assert.equal(r.json.data.tradeName, 'Exemplo Motors');
    assert.equal(r.json.data.address.city, 'BRASILIA'); assert.equal(r.json.data.address.state, 'DF');
  });

  it('ativar a loja do cliente vale na hora: perfil de lojista, menu e vitrine, sem duplicar', async () => {
    const c = await cliente();
    await pool.query(`INSERT INTO user_profiles(user_id,customer_type,company_name,legal_name,phone,city,state) VALUES($1,'EMPRESA','Exemplo Motors','EXEMPLO LTDA','61999998888','Brasilia','DF')
      ON CONFLICT(user_id) DO UPDATE SET customer_type='EMPRESA',company_name='Exemplo Motors',legal_name='EXEMPLO LTDA',phone='61999998888',city='Brasilia',state='DF'`, [c.id]);
    const before = await sa.call(`/api/admin/customers/${c.id}/access`);
    assert.equal(before.status, 200);
    assert.equal(before.json.store, null); assert.equal(before.json.suggestedStoreName, 'Exemplo Motors');
    assert.ok(before.json.features.every((f) => f.enabled));
    const me0 = await (await app.request('/api/me', { token: c.token })).json();
    assert.deepEqual(me0.profiles, ['CLIENTE']);

    const on = await sa.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: { publicEnabled: true } });
    assert.equal(on.status, 201, JSON.stringify(on.json));
    assert.equal(on.json.store.name, 'Exemplo Motors'); assert.equal(on.json.store.active, true); assert.equal(on.json.store.publicEnabled, true);
    assert.equal(on.json.store.city, 'Brasilia'); assert.equal(on.json.store.state, 'DF');
    assert.deepEqual(on.json.profiles, ['CLIENTE', 'LOJISTA']); assert.equal(on.json.activeProfile, 'LOJISTA');
    const me = await (await app.request('/api/me', { token: c.token })).json();
    assert.ok(me.profiles.includes('LOJISTA')); assert.equal(me.activeProfile, 'LOJISTA'); assert.equal(me.storeAccess.active, true);

    const again = await sa.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.json.store.id, on.json.store.id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dealerships WHERE owner_user_id=$1', [c.id])).rows[0].n, 1);

    const off = await sa.call(`/api/admin/customers/${c.id}/store/disable`, { method: 'POST', body: {} });
    assert.equal(off.status, 200); assert.equal(off.json.store.active, false);
    assert.deepEqual(off.json.profiles, ['CLIENTE']); assert.equal(off.json.activeProfile, 'CLIENTE');
    const meOff = await (await app.request('/api/me', { token: c.token })).json();
    assert.deepEqual(meOff.profiles, ['CLIENTE']);

    const back = await sa.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: { vehicleLimit: 80, memberLimit: 5 } });
    assert.equal(back.status, 200); assert.equal(back.json.store.id, on.json.store.id); assert.equal(back.json.store.active, true);
    assert.equal(back.json.store.vehicleLimit, 80); assert.equal(back.json.store.memberLimit, 5);
    assert.ok(back.json.profiles.includes('LOJISTA'));
    const acts = (await pool.query(`SELECT action FROM audit_logs WHERE entity_id=$1 AND action LIKE 'ADMIN_STORE_%'`, [on.json.store.id])).rows.map((r) => r.action);
    assert.ok(acts.includes('ADMIN_STORE_ENABLED') && acts.includes('ADMIN_STORE_SUSPENDED') && acts.includes('ADMIN_STORE_REACTIVATED'), acts.join(','));
  });

  it('nome e dados da loja podem ser informados na criação; quem já está em outra loja não ganha uma segunda', async () => {
    const c = await cliente();
    const on = await sa.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: { name: 'Auto Brasil', slug: `auto-${uid('s').slice(-6).toLowerCase()}`, whatsapp: '(61) 98888-7777', city: 'Goiânia', state: 'go', publicEnabled: false } });
    assert.equal(on.status, 201, JSON.stringify(on.json));
    assert.equal(on.json.store.name, 'Auto Brasil'); assert.equal(on.json.store.city, 'Goiânia'); assert.equal(on.json.store.state, 'GO'); assert.equal(on.json.store.publicEnabled, false);
    const wa = (await pool.query('SELECT whatsapp FROM dealerships WHERE id=$1', [on.json.store.id])).rows[0].whatsapp;
    assert.equal(wa, '61988887777');
    const member = await cliente();
    await pool.query(`INSERT INTO dealership_members(dealership_id,user_id,role,active) VALUES($1,$2,'SELLER',true)`, [on.json.store.id, member.id]);
    const dup = await sa.call(`/api/admin/customers/${member.id}/store`, { method: 'POST', body: { name: 'Outra Loja' } });
    assert.equal(dup.status, 409, JSON.stringify(dup.json));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dealerships WHERE owner_user_id=$1', [member.id])).rows[0].n, 0);
  });

  it('permissões e entradas inválidas: só quem gerencia clientes altera; id ruim é 404; recurso desconhecido é 400', async () => {
    const c = await cliente();
    const fin = await adminSession({ server: app, pool, role: 'FINANCEIRO' });
    assert.equal((await fin.call(`/api/admin/customers/${c.id}/access`)).status, 200, 'ver pode');
    assert.equal((await fin.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: {} })).status, 403);
    assert.equal((await fin.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: { GARAGE: false } } })).status, 403);
    assert.equal((await sa.call('/api/admin/customers/nao-e-id/access')).status, 404);
    assert.equal((await sa.call('/api/admin/customers/00000000-0000-4000-8000-000000000000/access')).status, 404);
    assert.equal((await sa.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: { TUDO: false } } })).status, 400);
    assert.equal((await sa.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: {} } })).status, 400);
    assert.equal((await sa.call(`/api/admin/customers/${c.id}/store/disable`, { method: 'POST', body: {} })).status, 404, 'sem loja não há o que suspender');
    assert.equal((await adm.call(`/api/admin/customers/${c.id}/store`, { method: 'POST', body: { slug: 'x' } })).status, 400);
  });

  it('desligar um recurso esconde no /me e bloqueia no servidor; ligar devolve; os outros seguem abertos', async () => {
    const c = await cliente();
    assert.equal((await app.request('/api/garage', { token: c.token })).status, 200);
    assert.equal((await app.request('/api/watches', { token: c.token })).status, 200);
    const off = await sa.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: { GARAGE: false } } });
    assert.equal(off.status, 200, JSON.stringify(off.json));
    assert.equal(off.json.features.find((f) => f.key === 'GARAGE').enabled, false);
    assert.equal(off.json.features.find((f) => f.key === 'WATCHES').enabled, true);
    const me = await (await app.request('/api/me', { token: c.token })).json();
    assert.deepEqual(me.features, { GARAGE: false, WATCHES: true });
    const blocked = await app.request('/api/garage', { token: c.token });
    assert.equal(blocked.status, 403); assert.equal((await blocked.json()).error, 'FEATURE_DISABLED');
    assert.equal((await app.request('/api/watches', { token: c.token })).status, 200, 'o outro recurso continua aberto');
    const w = await sa.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: { WATCHES: false } } });
    assert.equal(w.json.features.find((f) => f.key === 'GARAGE').enabled, false, 'desligar um não religa o outro');
    assert.equal((await app.request('/api/watches', { token: c.token })).status, 403);
    const on = await sa.call(`/api/admin/customers/${c.id}/access`, { method: 'PUT', body: { features: { GARAGE: true, WATCHES: true } } });
    assert.ok(on.json.features.every((f) => f.enabled));
    assert.equal((await app.request('/api/garage', { token: c.token })).status, 200);
    assert.equal((await pool.query('SELECT access_overrides FROM users WHERE id=$1', [c.id])).rows[0].access_overrides && Object.keys((await pool.query('SELECT access_overrides FROM users WHERE id=$1', [c.id])).rows[0].access_overrides).length, 0, 'ligar apaga a marca');
    assert.ok((await pool.query(`SELECT 1 FROM audit_logs WHERE action='ADMIN_ACCESS_UPDATED' AND entity_id=$1`, [c.id])).rowCount >= 3);
  });

  it('conta sem nada guardado continua com tudo liberado, como antes', async () => {
    const c = await cliente();
    const me = await (await app.request('/api/me', { token: c.token })).json();
    assert.deepEqual(me.features, { GARAGE: true, WATCHES: true });
    assert.equal((await app.request('/api/garage', { token: c.token })).status, 200);
  });
});
