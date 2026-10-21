import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('lembretes: situação por data e quilometragem', () => {
  it('vencido, em breve, em aberto e feito', async () => {
    const { reminderStatus } = await import('../dist/routes/garage.js');
    const now = '2026-10-21'; const soon = '2026-11-20';
    assert.equal(reminderStatus({ done_at: new Date(), due_date: '2020-01-01', due_km: null }, null, now, soon), 'DONE');
    assert.equal(reminderStatus({ done_at: null, due_date: '2026-10-20', due_km: null }, null, now, soon), 'OVERDUE');
    assert.equal(reminderStatus({ done_at: null, due_date: '2026-11-10', due_km: null }, null, now, soon), 'SOON');
    assert.equal(reminderStatus({ done_at: null, due_date: '2027-03-01', due_km: null }, null, now, soon), 'OPEN');
    assert.equal(reminderStatus({ done_at: null, due_date: null, due_km: 50000 }, 50000, now, soon), 'OVERDUE');
    assert.equal(reminderStatus({ done_at: null, due_date: null, due_km: 50000 }, 49600, now, soon), 'SOON');
    assert.equal(reminderStatus({ done_at: null, due_date: null, due_km: 50000 }, 30000, now, soon), 'OPEN');
    assert.equal(reminderStatus({ done_at: null, due_date: null, due_km: 50000 }, null, now, soon), 'OPEN');
  });
});

describe('minha garagem, contestação de dado, funil e parceiro', integration, () => {
  let pool; let server; let a; let b; let aId; let adm;
  const call = (token) => (path, opts = {}) => hostRequest(server.base, path, { token, ...opts });
  const reg = async (name) => { const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name, email: `${uid('gar')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } }); assert.equal(r.status, 201); return r.json; };

  before(async () => {
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    const ra = await reg('Ana Garagem'); const rb = await reg('Beto Garagem');
    a = call(ra.token); b = call(rb.token); aId = ra.user.id;
    await pool.query('UPDATE wallets SET balance_cents=100000 WHERE user_id=$1', [aId]);
    adm = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('exige login', async () => {
    assert.equal((await hostRequest(server.base, '/api/garage')).status, 401);
  });

  it('guarda veículo, recusa duplicado e placa inválida, e isola por pessoa', async () => {
    const ok = await a('/api/garage/vehicles', { method: 'POST', body: { plate: 'abc-1d23', nickname: 'Carro da família', modelLabel: 'Onix 1.0', modelYear: 2020, km: 45000 } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.plate, 'ABC1D23');
    assert.equal(ok.json.km, 45000);
    assert.equal((await a('/api/garage/vehicles', { method: 'POST', body: { plate: 'ABC1D23' } })).status, 409);
    assert.equal((await a('/api/garage/vehicles', { method: 'POST', body: { plate: '123' } })).json.error ?? 'INVALID_PLATE', 'INVALID_PLATE');
    assert.equal((await a('/api/garage/vehicles', { method: 'POST', body: { plate: 'ABC1D23', admin: true } })).status, 400);
    // outra pessoa pode guardar a mesma placa e não enxerga a do outro
    assert.equal((await b('/api/garage/vehicles', { method: 'POST', body: { plate: 'ABC1D23' } })).status, 201);
    const mine = await a('/api/garage');
    assert.equal(mine.json.vehicles.length, 1);
    assert.equal((await b(`/api/garage/vehicles/${ok.json.id}`)).status, 404);
    assert.equal((await b(`/api/garage/vehicles/${ok.json.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await a('/api/garage/vehicles/nao-e-uuid')).status, 404);
  });

  it('lembretes por data e quilometragem, manutenção atualiza a km e gastos somam', async () => {
    const list = await a('/api/garage');
    const v = list.json.vehicles[0];
    const past = await a(`/api/garage/vehicles/${v.id}/items`, { method: 'POST', body: { kind: 'REMINDER', title: 'IPVA', dueDate: '2020-01-10' } });
    assert.equal(past.status, 201);
    assert.equal(past.json.status, 'OVERDUE');
    const byKm = await a(`/api/garage/vehicles/${v.id}/items`, { method: 'POST', body: { kind: 'REMINDER', title: 'Revisão', dueKm: 45300 } });
    assert.equal(byKm.json.status, 'SOON');
    assert.equal((await a(`/api/garage/vehicles/${v.id}/items`, { method: 'POST', body: { kind: 'REMINDER', title: 'Sem prazo' } })).status, 400);
    const oil = await a(`/api/garage/vehicles/${v.id}/items`, { method: 'POST', body: { kind: 'MAINTENANCE', title: 'Troca de óleo', eventDate: '2026-10-01', km: 46000, amountCents: 35000 } });
    assert.equal(oil.status, 201);
    await a(`/api/garage/vehicles/${v.id}/items`, { method: 'POST', body: { kind: 'EXPENSE', title: 'Pneus', amountCents: 120000 } });
    const detail = await a(`/api/garage/vehicles/${v.id}`);
    assert.equal(detail.json.vehicle.km, 46000);                 // km da manutenção maior que a do veículo atualiza o veículo
    assert.equal(detail.json.items.length, 4);
    assert.equal(detail.json.items.filter((i) => i.kind !== 'REMINDER').reduce((s, i) => s + (i.amountCents ?? 0), 0), 155000);
    // marcar como feito
    const done = await a(`/api/garage/items/${past.json.id}`, { method: 'PATCH', body: { done: true } });
    assert.equal(done.json.status, 'DONE');
    assert.equal((await b(`/api/garage/items/${past.json.id}`, { method: 'PATCH', body: { done: false } })).status, 404);
    const after = await a('/api/garage');
    assert.equal(after.json.vehicles[0].reminders.open, 1);
    assert.equal(after.json.vehicles[0].reminders.overdue, 1);   // a revisão por km já passou (46000 >= 45300)
  });

  it('exporta tudo e apagar o veículo leva os itens junto', async () => {
    const ex = await a('/api/garage/export');
    assert.equal(ex.status, 200);
    assert.match(ex.headers['content-disposition'], /minha-garagem\.json/);
    assert.equal(ex.json.vehicles[0].items.length, 4);
    const v = (await a('/api/garage')).json.vehicles[0];
    assert.equal((await a(`/api/garage/vehicles/${v.id}`, { method: 'DELETE' })).status, 204);
    const left = Number((await pool.query('SELECT count(*) FROM garage_items WHERE vehicle_id=$1', [v.id])).rows[0].count);
    assert.equal(left, 0);
    assert.equal((await a('/api/garage')).json.vehicles.length, 0);
  });

  it('limite de 10 veículos por pessoa', async () => {
    const plates = ['AAA1A11', 'AAA1A12', 'AAA1A13', 'AAA1A14', 'AAA1A15', 'AAA1A16', 'AAA1A17', 'AAA1A18', 'AAA1A19', 'AAA1B10'];
    for (const p of plates) assert.equal((await a('/api/garage/vehicles', { method: 'POST', body: { plate: p } })).status, 201);
    const over = await a('/api/garage/vehicles', { method: 'POST', body: { plate: 'AAA1B11' } });
    assert.equal(over.status, 400);
  });

  it('contesta dado do relatório: vira chamado no suporte e só o dono contesta', async () => {
    const q = await a('/api/queries', { method: 'POST', body: { plate: 'DEV1B11', productId: 'BASIC' } });
    assert.equal(q.status, 201, q.text);
    assert.equal((await a(`/api/queries/${q.json.id}/report/dispute`, { method: 'POST', body: { message: 'curto' } })).status, 400);
    assert.equal((await b(`/api/queries/${q.json.id}/report/dispute`, { method: 'POST', body: { message: 'A cor do veículo está errada neste relatório.' } })).status, 404);
    const ok = await a(`/api/queries/${q.json.id}/report/dispute`, { method: 'POST', body: { field: 'Cor', message: 'A cor do veículo está errada neste relatório.' } });
    assert.equal(ok.status, 201);
    const row = (await pool.query(`SELECT subject,message FROM contact_messages WHERE id=$1`, [ok.json.id])).rows[0];
    assert.match(row.subject, /Contestação de dado - placa DEV1B11 - código [A-Z0-9]{8}/);
    assert.match(row.message, /Campo: Cor/);
    // abrir o relatório conta como evento do funil
    assert.equal((await a(`/api/queries/${q.json.id}/report`)).status, 200);
    const f = await adm.call('/api/admin/funnel');
    assert.equal(f.status, 200);
    assert.ok(f.json.reports_opened >= 1 && f.json.disputes >= 1 && f.json.reports_delivered >= 1);
    assert.equal(typeof f.json.repeat_buyers, 'number');
  });

  it('parceiro vê links por destino com o código e as métricas do período', async () => {
    const act = await b('/api/affiliate/activate', { method: 'POST', body: { code: `GAR${Math.random().toString(36).slice(2, 7).toUpperCase()}` } });
    assert.equal(act.status, 201, act.text);
    const code = act.json.affiliate.code;
    const st = await b('/api/affiliate/stats');
    assert.equal(st.status, 200);
    assert.ok(st.json.links.length >= 5);
    for (const l of st.json.links) assert.ok(l.url.includes(`ref=${code}`), l.url);
    assert.ok(st.json.links.some((l) => l.url.includes('/simulador?ref=')));
    assert.deepEqual(Object.keys(st.json.performance).sort(), ['clicks30d', 'paidPayments', 'reversedCommissions']);
  });
});
