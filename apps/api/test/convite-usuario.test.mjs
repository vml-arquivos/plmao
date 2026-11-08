import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('convite por usuário: link próprio, rastreio de quem convidou quem', integration, () => {
  let pool; let server; let sa; let op;
  const api = (path, opts = {}) => hostRequest(server.base, `/api${path}`, opts);
  const reg = (name, extra = {}) => api('/auth/register', { method: 'POST', body: { name, email: `${uid('cv')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true, ...extra } });

  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('todo usuário ganha código e link; o código é estável e o link aponta para /convite', async () => {
    const a = await reg('Ana Convida');
    const me1 = await api('/me/invite', { token: a.json.token });
    assert.equal(me1.status, 200, me1.text);
    assert.match(me1.json.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.match(me1.json.url, new RegExp(`/convite/${me1.json.code}$`));
    assert.equal((await api('/me/invite', { token: a.json.token })).json.code, me1.json.code);
    assert.equal(me1.json.totals.signups, 0);
    assert.equal((await api('/me/invite')).status, 401);
    // equipe também tem o link, cada um o seu
    const s1 = await sa.call('/api/admin/me/invite'); const s2 = await op.call('/api/admin/me/invite');
    assert.equal(s1.status, 200, s1.text); assert.equal(s2.status, 200);
    assert.notEqual(s1.json.code, s2.json.code);
    assert.equal((await hostRequest(server.base, '/api/admin/me/invite', { host: 'admin.placanamao.test' })).status, 401);
  });

  it('abrir o link conta clique; cadastrar pelo link liga a conta a quem convidou, com data e caminho', async () => {
    const a = await reg('Ana Convida');
    const { code } = (await api('/me/invite', { token: a.json.token })).json;
    const pub = await api(`/invites/${code}`);
    assert.equal(pub.json.valid, true); assert.equal(pub.json.inviterName, 'Ana');
    assert.equal((await api('/invites/ZZZZZZZZ')).json.valid, false);
    assert.equal((await api(`/invites/${code}/click`, { method: 'POST', body: { via: 'LINK' } })).status, 200);
    assert.equal((await api(`/invites/${code}/click`, { method: 'POST', body: { via: 'REPORT' } })).status, 200);

    const b = await reg('Bruno Veio', { inviteCode: code, inviteVia: 'REPORT' });
    assert.equal(b.status, 201, b.text);
    const row = (await pool.query('SELECT invited_by,invited_at,invited_via FROM users WHERE id=$1', [b.json.user.id])).rows[0];
    assert.ok(row.invited_at); assert.equal(row.invited_via, 'REPORT');
    assert.equal((await pool.query('SELECT name FROM users WHERE id=$1', [row.invited_by])).rows[0].name, 'Ana Convida');

    const sum = (await api('/me/invite', { token: a.json.token })).json;
    assert.equal(sum.totals.clicks, 2); assert.equal(sum.totals.signups, 1); assert.equal(sum.totals.viaReport, 1);
    assert.equal(sum.invited.length, 1);
    assert.equal(sum.invited[0].name, 'Bruno'); assert.match(sum.invited[0].email, /^[a-z]\*+@cliente\.local$/);
    assert.ok(!JSON.stringify(sum).includes('Veio'), 'só o primeiro nome do convidado');
    const bme = (await api('/me/invite', { token: b.json.token })).json;
    assert.equal(bme.invitedBy.name, 'Ana');
  });

  it('código inválido não derruba o cadastro; ninguém convida a si mesmo; só a primeira ligação vale', async () => {
    const bad = await reg('Sem Convite', { inviteCode: 'ABCDEFGH' });
    assert.equal(bad.status, 201, bad.text);
    assert.equal((await pool.query('SELECT invited_by FROM users WHERE id=$1', [bad.json.user.id])).rows[0].invited_by, null);
    const a = await reg('Dona Um'); const b = await reg('Dona Dois');
    const ca = (await api('/me/invite', { token: a.json.token })).json.code;
    const cb = (await api('/me/invite', { token: b.json.token })).json.code;
    assert.equal((await api('/me/invite/claim', { method: 'POST', token: a.json.token, body: { code: ca } })).json.attached, false, 'a própria conta não conta');
    assert.equal((await api('/me/invite/claim', { method: 'POST', token: a.json.token, body: { code: cb } })).json.attached, true);
    assert.equal((await api('/me/invite/claim', { method: 'POST', token: a.json.token, body: { code: cb } })).json.attached, false, 'já tem quem convidou');
    // conta antiga não é ligada depois
    await pool.query(`UPDATE users SET created_at = now() - interval '10 days', invited_by=NULL WHERE id=$1`, [b.json.user.id]);
    assert.equal((await api('/me/invite/claim', { method: 'POST', token: b.json.token, body: { code: ca } })).json.attached, false);
  });

  it('o link da consulta enviada leva o convite de quem enviou', async () => {
    const a = await reg('Vendedor Ana');
    const code = (await api('/me/invite', { token: a.json.token })).json.code;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [a.json.user.id]);
    const q = await api('/queries', { method: 'POST', token: a.json.token, body: { plate: 'DEV1B11', productId: 'COMPLETE' } });
    assert.equal(q.status, 201, q.text);
    const sh = await api(`/queries/${q.json.id}/share`, { method: 'POST', token: a.json.token, body: { days: 3 } });
    assert.equal(sh.status, 201, sh.text);
    assert.match(sh.json.url, new RegExp(`/r/[A-Za-z0-9_-]+\\?convite=${code}$`));
    // o comprador que abre o link e se cadastra fica ligado a quem enviou a consulta
    const buyer = await reg('Comprador Novo', { inviteCode: code, inviteVia: 'REPORT' });
    assert.equal((await pool.query('SELECT invited_via FROM users WHERE id=$1', [buyer.json.user.id])).rows[0].invited_via, 'REPORT');
  });

  it('o painel mostra quem convidou quem, a ficha do cliente mostra quem o convidou e a equipe vê o ranking', async () => {
    const a = await reg('Carla Indica');
    const code = (await api('/me/invite', { token: a.json.token })).json.code;
    const b = await reg('Diego Entrou', { inviteCode: code });
    await api(`/invites/${code}/click`, { method: 'POST', body: {} });
    const list = await sa.call('/api/admin/invites');
    assert.equal(list.status, 200, list.text);
    const me = list.json.people.find((p) => p.code === code);
    assert.equal(me.signups, 1); assert.equal(me.clicks, 1);
    const rec = list.json.recent.find((r) => r.id === b.json.user.id);
    assert.equal(rec.inviterName, 'Carla Indica'); assert.ok(rec.joinedAt);
    const det = await sa.call(`/api/admin/customers/${b.json.user.id}`);
    assert.equal(det.json.invitedBy.name, 'Carla Indica');
    const det2 = await sa.call(`/api/admin/customers/${a.json.user.id}`);
    assert.equal(det2.json.invitedBy, null); assert.equal(det2.json.invitedCount, 1);
    // equipe convidando: o convidado aparece com o papel de quem convidou
    const staffCode = (await op.call('/api/admin/me/invite')).json.code;
    const c = await reg('Eva Do Operador', { inviteCode: staffCode });
    assert.equal(c.status, 201);
    const list2 = await sa.call('/api/admin/invites');
    assert.equal(list2.json.recent.find((r) => r.id === c.json.user.id).inviterRole, 'OPERADOR');
  });
});
