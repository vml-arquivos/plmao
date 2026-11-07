import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('convite de parceiro e painel do parceiro', integration, () => {
  let pool; let server; let sa;
  const mk = async (name, email = `${uid('par')}@cliente.local`) => {
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(reg.status, 201, reg.text);
    return { token: reg.json.token, id: reg.json.user.id, email };
  };
  const tokenOf = (link) => link.split('/parceiro/convite/')[1];
  const api = (path, opts = {}) => hostRequest(server.base, `/api${path}`, opts);

  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('o painel gera o link, a pessoa cria a conta, aceita e já nasce parceira com a comissão combinada', async () => {
    const created = await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { name: 'Maria Parceira', partnerType: 'INFLUENCER', commissionBps: 1500, expiresInDays: 7 } });
    assert.equal(created.status, 201, created.text);
    assert.match(created.json.link, /\/parceiro\/convite\/[A-Za-z0-9_-]{20,}$/);
    const token = tokenOf(created.json.link);

    const pub = await api(`/partner-invites/${token}`);
    assert.equal(pub.status, 200); assert.equal(pub.json.valid, true); assert.equal(pub.json.name, 'Maria Parceira');
    assert.ok(!JSON.stringify(pub.json).includes('1500'), 'a página pública não mostra a comissão');
    assert.equal((await api('/partner-invites/token-que-nao-existe-123456')).status, 404);

    const user = await mk('Maria Silva');
    assert.equal((await api('/affiliate/panel', { token: user.token })).json.affiliate, null);
    assert.equal((await api('/affiliate/accept-invite', { method: 'POST', body: { token } })).status, 401, 'precisa estar logada');
    const ok = await api('/affiliate/accept-invite', { method: 'POST', token: user.token, body: { token } });
    assert.equal(ok.status, 201, ok.text);

    const panel = await api('/affiliate/panel', { token: user.token });
    assert.equal(panel.json.affiliate.commissionBps, 1500);
    assert.equal(panel.json.affiliate.partnerType, 'INFLUENCER');
    assert.equal(panel.json.totals.salesCount, 0);
    const prof = (await api('/me', { token: user.token })).json;
    assert.equal(prof.activeProfile, 'AFILIADO', 'abre direto no painel do parceiro');
    assert.ok(prof.profiles.includes('AFILIADO'));

    const again = await api('/affiliate/accept-invite', { method: 'POST', token: (await mk('Outra Pessoa')).token, body: { token } });
    assert.equal(again.status, 410); assert.equal(again.json.error, 'INVITE_USED');

    const list = await sa.call('/api/admin/finance/partner-invites');
    const row = list.json.find((i) => i.id === created.json.id);
    assert.equal(row.status, 'USED'); assert.equal(row.link, null); assert.equal(row.usedByName, 'Maria Silva');
    const partners = await sa.call('/api/admin/finance/partners');
    assert.ok(partners.json.some((p) => p.commissionBps === 1500 && p.partnerType === 'INFLUENCER'));
  });

  it('convite preso a um e-mail só vale para ele; convite cancelado ou vencido não vale', async () => {
    const mine = await mk('Dono do Email', `${uid('dono')}@cliente.local`);
    const bound = await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { email: mine.email, commissionBps: 1000 } });
    const t1 = tokenOf(bound.json.link);
    const stranger = await mk('Intruso');
    const bad = await api('/affiliate/accept-invite', { method: 'POST', token: stranger.token, body: { token: t1 } });
    assert.equal(bad.status, 403); assert.equal(bad.json.error, 'INVITE_EMAIL_MISMATCH');
    assert.equal((await api('/affiliate/accept-invite', { method: 'POST', token: mine.token, body: { token: t1 } })).status, 201);

    const revoked = await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { commissionBps: 1000 } });
    assert.equal((await sa.call(`/api/admin/finance/partner-invites/${revoked.json.id}`, { method: 'DELETE' })).status, 204);
    const t2 = tokenOf(revoked.json.link);
    assert.equal((await api(`/partner-invites/${t2}`)).json.valid, false);
    assert.equal((await api('/affiliate/accept-invite', { method: 'POST', token: stranger.token, body: { token: t2 } })).json.error, 'INVITE_REVOKED');

    const expired = await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { commissionBps: 1000 } });
    await pool.query(`UPDATE partner_invites SET expires_at=now() - interval '1 day' WHERE id=$1`, [expired.json.id]);
    assert.equal((await api('/affiliate/accept-invite', { method: 'POST', token: stranger.token, body: { token: tokenOf(expired.json.link) } })).json.error, 'INVITE_EXPIRED');
    assert.equal((await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { commissionBps: 9000 } })).status, 400, 'comissão acima do limite');
  });

  it('painel: receita, comissões, clientes e consultas dos indicados, sempre mascarados', async () => {
    const partner = await mk('Paulo Parceiro');
    const inv = await sa.call('/api/admin/finance/partner-invites', { method: 'POST', body: { commissionBps: 1000, code: 'PAULO10' } });
    assert.equal(inv.json.code, 'PAULO10');
    assert.equal((await api('/affiliate/accept-invite', { method: 'POST', token: partner.token, body: { token: tokenOf(inv.json.link) } })).status, 201);
    const aff = (await pool.query('SELECT id FROM affiliates WHERE user_id=$1', [partner.id])).rows[0].id;
    assert.equal((await pool.query('SELECT code FROM affiliates WHERE id=$1', [aff])).rows[0].code, 'PAULO10');

    const client = await mk('Carlos Eduardo Souza', 'carlos.souza@cliente.local');
    await pool.query('UPDATE users SET affiliate_id=$2 WHERE id=$1', [client.id, aff]);
    const pkg = (await pool.query('SELECT id FROM credit_packages LIMIT 1')).rows[0].id;
    const order = (await pool.query(`INSERT INTO payment_orders(user_id,package_id,status,amount_cents,credits,provider,external_reference,affiliate_id,paid_at) VALUES($1,$2,'PAID',3459,35,'test',$3,$4,now()) RETURNING id`, [client.id, pkg, uid('ord'), aff])).rows[0].id;
    await pool.query(`INSERT INTO affiliate_commissions(affiliate_id,order_id,amount_cents,status,base_type,base_cents,rate_bps,available_at) VALUES($1,$2,346,'PENDING','GROSS',3459,1000,now()+interval '7 days')`, [aff, order]);
    await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider) VALUES($1,'ABC1D23','COMPLETE','SUCCESS',35,'test')`, [client.id]);

    const p = (await api('/affiliate/panel', { token: partner.token })).json;
    assert.equal(p.totals.revenueCents, 3459);
    assert.equal(p.totals.salesCount, 1);
    assert.equal(p.totals.clientsCount, 1);
    assert.equal(p.totals.queriesCount, 1);
    assert.equal(p.totals.pendingCents, 346);
    assert.equal(p.totals.earnedCents, 346);
    assert.equal(p.clients[0].name, 'Carlos'); assert.match(p.clients[0].email, /^c\*+@cliente\.local$/); assert.equal(p.clients[0].spentCents, 3459);
    assert.equal(p.queries[0].plate, 'ABC****'); assert.equal(p.queries[0].product, 'Consulta Completa');
    assert.equal(p.sales[0].commissionCents, 346); assert.equal(p.sales[0].orderCents, 3459);
    const raw = JSON.stringify(p);
    assert.ok(!raw.includes('carlos.souza') && !raw.includes('Souza') && !raw.includes('ABC1D23'), 'sem dados pessoais completos');

    const stranger = await mk('Sem Parceria');
    assert.equal((await api('/affiliate/panel', { token: stranger.token })).json.affiliate, null);
  });
});
