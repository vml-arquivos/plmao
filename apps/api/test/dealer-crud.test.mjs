import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('loja: criar, editar, arquivar, excluir e trocar o dono (admin e dono)', integration, () => {
  let pool; let server; let adm; let sup;
  const u = {};
  const password = 'Senha-Forte-123!';
  const api = (who, path, opts = {}) => hostRequest(server.base, `/api${path}`, { ...opts, token: u[who]?.token });
  const slug = uid('crud').toLowerCase().replace(/[^a-z0-9]/g, '');

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    adm = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    sup = await adminSession({ server, pool, role: 'SUPORTE' });
    for (const tag of ['dono', 'novo', 'gerente', 'vend', 'solto']) {
      const email = `${uid(tag)}@crud.local`;
      const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: `Pessoa ${tag}`, email, password, acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201);
      u[tag] = { token: r.json.token, email, id: (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id };
    }
  });
  after(async () => { await server.stop(); await pool.end(); });
  let storeId;

  it('admin cria a loja de um cliente (slug informado) e só quem pode gerenciar clientes consegue', async () => {
    const body = { ownerEmail: u.dono.email, name: 'Loja Criada', slug, whatsapp: '(62) 99999-0000', city: 'Goiânia', state: 'go', publicEnabled: true };
    assert.equal((await sup.call('/api/admin/dealerships', { method: 'POST', body })).status, 403);
    const r = await adm.call('/api/admin/dealerships', { method: 'POST', body });
    assert.equal(r.status, 201, r.text);
    storeId = r.json.id; assert.equal(r.json.slug, slug);
    assert.equal((await adm.call('/api/admin/dealerships', { method: 'POST', body: { ...body, ownerEmail: u.novo.email } })).status, 409, 'endereço repetido');
    assert.equal((await adm.call('/api/admin/dealerships', { method: 'POST', body: { ...body, slug: undefined, name: 'Outra' } })).status, 409, 'dono já tem loja');
    assert.equal((await adm.call('/api/admin/dealerships', { method: 'POST', body: { ownerEmail: 'ninguem@crud.local', name: 'Sem dono' } })).status, 404);
    const me = await api('dono', '/dealer/me');
    assert.equal(me.json.role, 'OWNER'); assert.equal(me.json.store.slug, slug); assert.equal(me.json.store.publicEnabled, true);
    const list = await adm.call(`/api/admin/dealerships?q=${slug}`);
    assert.equal(list.json.length, 1);
  });

  it('dono personaliza a vitrine: logo, capa, cor, Instagram, endereço e horário', async () => {
    const bad = [{ logoUrl: 'http://x.com/a.png' }, { accentColor: 'azul' }, { instagram: 'com espaço' }, { coverUrl: 'javascript:alert(1)' }];
    for (const b of bad) assert.equal((await api('dono', '/dealer', { method: 'PATCH', body: b })).status, 400, JSON.stringify(b));
    const ok = await api('dono', '/dealer', { method: 'PATCH', body: { logoUrl: 'https://img.exemplo.com/logo.png', coverUrl: 'https://img.exemplo.com/capa.jpg', accentColor: '#0E9F6E', instagram: '@minhaloja', address: 'Av. Brasil, 100', hours: 'Seg a sáb, 9h às 18h', about: 'Carros revisados' } });
    assert.equal(ok.status, 200, ok.text);
    const pub = await hostRequest(server.base, `/api/public/stores/${slug}`);
    assert.equal(pub.status, 200);
    assert.deepEqual([pub.json.store.logoUrl, pub.json.store.accentColor, pub.json.store.instagram, pub.json.store.hours], ['https://img.exemplo.com/logo.png', '#0E9F6E', 'minhaloja', 'Seg a sáb, 9h às 18h']);
    // limpar
    const clear = await api('dono', '/dealer', { method: 'PATCH', body: { logoUrl: null, accentColor: null } });
    assert.equal(clear.json.store.logoUrl, null);
  });

  it('admin edita todos os dados, limites e consegue ver o detalhe', async () => {
    const det = await adm.call(`/api/admin/dealerships/${storeId}`);
    assert.equal(det.status, 200); assert.equal(det.json.ownerEmail, u.dono.email); assert.equal(det.json.coverUrl, 'https://img.exemplo.com/capa.jpg');
    const p = await adm.call(`/api/admin/dealerships/${storeId}`, { method: 'PATCH', body: { name: 'Loja Editada', city: 'Anápolis', vehicleLimit: 50, memberLimit: 5, hours: null } });
    assert.equal(p.status, 200, p.text); assert.equal(p.json.vehicleLimit, 50);
    const me = await api('dono', '/dealer/me');
    assert.equal(me.json.store.name, 'Loja Editada'); assert.equal(me.json.store.city, 'Anápolis'); assert.equal(me.json.store.memberLimit, 5); assert.equal(me.json.store.hours, null);
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}`, { method: 'PATCH', body: { vehicleLimit: 0 } })).status, 400);
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}`, { method: 'PATCH', body: { slug: 'Slug Ruim' } })).status, 400);
    assert.equal((await adm.call(`/api/admin/dealerships/${uid('x')}`, { method: 'PATCH', body: { name: 'Aaa' } })).status, 400);
  });

  it('excluir veículo e proposta: dono e gerente; vendido não se exclui', async () => {
    assert.equal((await api('dono', '/dealer/members', { method: 'POST', body: { email: u.gerente.email, role: 'MANAGER' } })).status, 201);
    assert.equal((await api('dono', '/dealer/members', { method: 'POST', body: { email: u.vend.email, role: 'SELLER' } })).status, 201);
    const mk = async (b) => (await api('dono', '/dealer/vehicles', { method: 'POST', body: { brand: 'Fiat', model: 'Uno', priceCents: 3_000_000, ...b } })).json;
    const a = await mk({}); const b = await mk({});
    assert.equal((await api('vend', `/dealer/vehicles/${a.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await api('solto', `/dealer/vehicles/${a.id}`, { method: 'DELETE' })).status, 404);
    const prop = await api('vend', '/dealer/proposals', { method: 'POST', body: { vehicleId: a.id, customerName: 'Fulano', priceCents: 3_000_000 } });
    assert.equal(prop.status, 201);
    assert.equal((await api('gerente', `/dealer/vehicles/${a.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api('dono', `/dealer/vehicles/${a.id}`)).status, 404);
    const kept = await api('vend', `/dealer/proposals/${prop.json.id}`);
    assert.equal(kept.status, 200, 'proposta continua depois de excluir o veículo');
    assert.equal((await api('vend', `/dealer/proposals/${prop.json.id}`, { method: 'DELETE' })).status, 200, 'vendedor exclui a própria');
    assert.equal((await api('vend', `/dealer/proposals/${prop.json.id}`, { method: 'DELETE' })).status, 404);
    const sold = await api('dono', `/dealer/vehicles/${b.id}/sell`, { method: 'POST', body: { soldPriceCents: 2_900_000 } });
    assert.equal(sold.status, 200);
    const delSold = await api('dono', `/dealer/vehicles/${b.id}`, { method: 'DELETE' });
    assert.equal(delSold.status, 409);
    const t = await api('vend', '/dealer/trade-in', { method: 'POST', body: { vehicleLabel: 'Gol 2012', mileageKm: 90000, condition: 'BOM', fipeCents: 2_000_000 } });
    assert.equal((await api('dono', `/dealer/trade-ins/${t.json.id}`, { method: 'DELETE' })).status, 200);
  });

  it('dono arquiva: equipe e vitrine saem do ar, restaurar volta; só o dono arquiva', async () => {
    assert.equal((await api('gerente', '/dealer/archive', { method: 'POST' })).status, 403);
    assert.equal((await api('dono', '/dealer/archive', { method: 'POST' })).status, 200);
    const blocked = await api('gerente', '/dealer/vehicles');
    assert.equal(blocked.status, 403); assert.equal(blocked.json.error ?? blocked.json.code, 'DEALER_ARCHIVED');
    assert.equal((await api('dono', '/dealer/vehicles')).status, 403);
    assert.equal((await hostRequest(server.base, `/api/public/stores/${slug}`)).status, 404);
    const me = await api('dono', '/dealer/me');
    assert.equal(me.json.archived, true);
    assert.equal((await api('gerente', '/dealer/restore', { method: 'POST' })).status, 403);
    assert.equal((await api('dono', '/dealer/restore', { method: 'POST' })).status, 200);
    assert.equal((await api('dono', '/dealer/vehicles')).status, 200);
    assert.equal((await hostRequest(server.base, `/api/public/stores/${slug}`)).status, 200);
  });

  it('admin arquiva e restaura; excluir exige arquivar e confirmar o endereço', async () => {
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}`, { method: 'PATCH', body: { archived: true } })).json.archived, true);
    assert.equal((await api('vend', '/dealer/vehicles')).status, 403);
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}`, { method: 'PATCH', body: { archived: false } })).json.archived, false);
    // dono tenta excluir sem arquivar
    assert.equal((await api('dono', '/dealer', { method: 'DELETE', body: { confirm: slug } })).status, 409);
    assert.equal((await api('gerente', '/dealer', { method: 'DELETE', body: { confirm: slug } })).status, 403);
    await api('dono', '/dealer/archive', { method: 'POST' });
    assert.equal((await api('dono', '/dealer', { method: 'DELETE', body: { confirm: 'errado' } })).status, 400);
    assert.equal((await api('gerente', '/dealer/restore', { method: 'POST' })).status, 403);
    await api('dono', '/dealer/restore', { method: 'POST' });
  });

  it('admin troca o dono: o anterior vira gerente; quem já tem loja não recebe', async () => {
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}/transfer`, { method: 'POST', body: { ownerEmail: u.dono.email } })).status, 409, 'mesma pessoa');
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}/transfer`, { method: 'POST', body: { ownerEmail: 'ninguem@crud.local' } })).status, 404);
    // 'solto' cria loja própria e não pode receber outra
    assert.equal((await api('solto', '/dealer', { method: 'POST', body: { name: `Solta ${uid('s')}` } })).status, 201);
    assert.equal((await adm.call(`/api/admin/dealerships/${storeId}/transfer`, { method: 'POST', body: { ownerEmail: u.solto.email } })).status, 409);
    const ok = await adm.call(`/api/admin/dealerships/${storeId}/transfer`, { method: 'POST', body: { ownerEmail: u.novo.email } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await api('novo', '/dealer/me')).json.role, 'OWNER');
    assert.equal((await api('dono', '/dealer/me')).json.role, 'MANAGER');
    assert.equal((await api('dono', '/dealer/archive', { method: 'POST' })).status, 403, 'ex-dono não arquiva mais');
    const row = await pool.query('SELECT owner_user_id FROM dealerships WHERE id=$1', [storeId]);
    assert.equal(row.rows[0].owner_user_id, u.novo.id);
  });

  it('dono arquiva e exclui de vez; admin também exclui com confirmação', async () => {
    assert.equal((await api('novo', '/dealer/archive', { method: 'POST' })).status, 200);
    assert.equal((await api('novo', '/dealer', { method: 'DELETE', body: { confirm: slug } })).status, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dealerships WHERE id=$1', [storeId])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1', [storeId])).rows[0].n, 0);
    assert.equal((await api('novo', '/dealer/me')).json.store, null, 'volta ao estado sem loja');
    // admin
    const mk = await adm.call('/api/admin/dealerships', { method: 'POST', body: { ownerEmail: u.novo.email, name: 'Para Excluir' } });
    assert.equal(mk.status, 201);
    const slug2 = (await pool.query('SELECT slug FROM dealerships WHERE id=$1', [mk.json.id])).rows[0].slug;
    assert.equal((await sup.call(`/api/admin/dealerships/${mk.json.id}`, { method: 'DELETE', body: { confirm: slug2 } })).status, 403);
    assert.equal((await adm.call(`/api/admin/dealerships/${mk.json.id}`, { method: 'DELETE', body: { confirm: 'x' } })).status, 400);
    assert.equal((await adm.call(`/api/admin/dealerships/${mk.json.id}`, { method: 'DELETE', body: { confirm: slug2 } })).status, 200);
    assert.equal((await adm.call(`/api/admin/dealerships/${mk.json.id}`, { method: 'DELETE', body: { confirm: slug2 } })).status, 404);
  });
});
