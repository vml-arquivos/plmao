import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

/** CRM em quadro: origem pelo utm, qualificação automática pelo consumo (tipo e nível) e etapa que sobe sozinha. */
describe('CRM: qualificação por consumo e origem', integration, () => {
  let pool; let server; let sa;
  const pub = (p, o = {}) => hostRequest(server.base, p, o);
  const email = (p = 'q') => `${uid(p)}@lead.local`;
  const leadOf = async (e) => (await pool.query('SELECT * FROM site_leads WHERE lower(email)=$1', [e.toLowerCase()])).rows[0];
  const listOne = async (e, extra = '') => (await sa.call(`/api/admin/crm/leads?q=${encodeURIComponent(e)}${extra}`)).json.leads.find((l) => l.email === e.toLowerCase());
  const register = async (e) => {
    const r = await pub('/api/auth/register', { method: 'POST', body: { name: 'Pessoa Teste', email: e, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    assert.equal(r.status, 201, r.text);
    return r.json.user.id;
  };
  const query = (userId, { status = 'SUCCESS', price = 3000, source = 'WEB', daysAgo = 1, product = 'LIEN' } = {}) =>
    pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,source,created_at) VALUES($1,'ABC1D23',$2,$3,0,'mock',$4,$5, now() - ($6::int * interval '1 day'))`, [userId, product, status, price, source, daysAgo]);

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    sa = await adminSession({ server, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await server.stop(); await pool.end(); });

  it('quem só simulou fica em “não qualificado” (NOVO), sem consumo e com origem do site', async () => {
    const e = email();
    assert.equal((await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'SIMULADOR' } })).status, 201);
    const l = await listOne(e);
    assert.equal(l.stage, 'NOVO'); assert.equal(l.profile, null); assert.equal(l.level, null);
    assert.equal(l.queries, 0); assert.equal(l.origin.channel, 'SITE');
  });

  it('origem: lê utm_source e campanha; filtra por canal e aparece no resumo', async () => {
    const e = email('ig'); const g = email('gg'); const r = email('ref');
    await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'FIPE', utm: { utm_source: 'Instagram', utm_medium: 'bio', utm_campaign: 'black-friday' } } });
    await pub('/api/leads/capture', { method: 'POST', body: { email: g, tool: 'FIPE', utm: { utm_source: 'google', utm_medium: 'cpc' } } });
    await pub('/api/leads/capture', { method: 'POST', body: { email: r, tool: 'FIPE', utm: { ref: 'AMIGO1' } } });
    const l = await listOne(e);
    assert.equal(l.origin.channel, 'INSTAGRAM'); assert.equal(l.origin.campaign, 'black-friday');
    assert.equal((await listOne(g)).origin.channel, 'GOOGLE');
    assert.equal((await listOne(r)).origin.channel, 'INDICACAO');
    const onlyIg = (await sa.call('/api/admin/crm/leads?channel=INSTAGRAM&limit=200')).json.leads;
    assert.ok(onlyIg.some((x) => x.email === e) && onlyIg.every((x) => x.origin.channel === 'INSTAGRAM'));
    const sum = (await sa.call('/api/admin/crm/summary')).json;
    assert.ok(sum.channels.some((c) => c.channel === 'INSTAGRAM' && c.n >= 1));
    assert.match(sum.siteUrl, /^https?:\/\//);
    assert.equal((await sa.call('/api/admin/crm/leads?channel=QUALQUER')).status, 200, 'canal desconhecido é ignorado, não quebra');
  });

  it('cliente com conta e sem consulta paga fica em Cadastrado; ao consultar sobe sozinho para Cliente esporádico (bronze)', async () => {
    const e = email('cli');
    await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'SIMULADOR' } });
    const userId = await register(e);
    let l = await listOne(e);
    assert.equal(l.stage, 'CADASTRADO'); assert.equal(l.profile, null);
    await query(userId, { price: 2990, product: 'LIEN' });
    l = await listOne(e);
    assert.equal(l.stage, 'CLIENTE');
    assert.equal(l.profile, 'ESPORADICO'); assert.equal(l.level, 'BRONZE');
    assert.equal(l.queries, 1); assert.equal(l.spentCents, 2990);
    assert.ok(l.products.length === 1, 'diz qual consulta fez');
    const det = (await sa.call(`/api/admin/crm/leads/${l.id}`)).json;
    assert.equal(det.account.profile, 'ESPORADICO'); assert.equal(det.account.level, 'BRONZE'); assert.deepEqual(det.account.products, l.products);
  });

  it('consome sempre: 2+ consultas nos últimos 90 dias vira recorrente; gasto define prata e ouro', async () => {
    const e = email('rec');
    const userId = await register(e);
    await query(userId, { price: 5000, daysAgo: 3 }); await query(userId, { price: 5000, daysAgo: 10, product: 'DEBTS' });
    let l = await listOne(e);
    assert.equal(l.profile, 'RECORRENTE'); assert.equal(l.level, 'PRATA'); assert.equal(l.spentCents, 10000);
    await query(userId, { price: 20000, daysAgo: 20 });
    l = await listOne(e);
    assert.equal(l.level, 'OURO');
    const rec = (await sa.call('/api/admin/crm/leads?profile=RECORRENTE&limit=200')).json.leads;
    assert.ok(rec.some((x) => x.email === e) && rec.every((x) => x.profile === 'RECORRENTE'));
    const gold = (await sa.call('/api/admin/crm/leads?level=OURO&limit=200')).json.leads;
    assert.ok(gold.some((x) => x.email === e));
    const notRec = (await sa.call('/api/admin/crm/leads?stage=CLIENTE&notprofile=RECORRENTE&limit=200')).json.leads;
    assert.ok(!notRec.some((x) => x.email === e));
    const sum = (await sa.call('/api/admin/crm/summary')).json;
    assert.ok(sum.profiles.RECORRENTE >= 1 && sum.levels.OURO >= 1);
  });

  it('consultas antigas e espaçadas seguem esporádicas (só 1 nos últimos 90 dias)', async () => {
    const e = email('esp');
    const userId = await register(e);
    await query(userId, { price: 3000, daysAgo: 200 }); await query(userId, { price: 3000, daysAgo: 150 }); await query(userId, { price: 3000, daysAgo: 5 });
    const l = await listOne(e);
    assert.equal(l.queries, 3); assert.equal(l.profile, 'ESPORADICO');
    await query(userId, { price: 3000, daysAgo: 100 });
    assert.equal((await listOne(e)).profile, 'RECORRENTE', '4 ou mais no total é recorrente');
  });

  it('não conta: estornada, falha, consulta interna da equipe nem consulta sem valor', async () => {
    const e = email('nao');
    const userId = await register(e);
    await query(userId, { status: 'REFUNDED', price: 9000 }); await query(userId, { status: 'FAILED', price: 9000 });
    await query(userId, { source: 'ADMIN', price: 9000 }); await query(userId, { price: 0 });
    const l = await listOne(e);
    assert.equal(l.queries, 0); assert.equal(l.spentCents, 0); assert.equal(l.profile, null); assert.equal(l.level, null);
    assert.equal(l.stage, 'CADASTRADO', 'sem consulta paga concluída continua cadastrado');
  });

  it('arrastar no quadro (mudar etapa) funciona entre as colunas manuais e fica no histórico', async () => {
    const e = email('mov');
    await pub('/api/leads/capture', { method: 'POST', body: { email: e, tool: 'SIMULADOR' } });
    const l = await leadOf(e);
    assert.equal((await sa.call(`/api/admin/crm/leads/${l.id}`, { method: 'PATCH', body: { stage: 'CONTATADO' } })).status, 200);
    assert.equal((await leadOf(e)).stage, 'CONTATADO');
    assert.equal((await sa.call(`/api/admin/crm/leads/${l.id}`, { method: 'PATCH', body: { stage: 'PERDIDO' } })).status, 200);
    const ev = (await pool.query(`SELECT detail FROM site_lead_events WHERE lead_id=$1 AND kind='STAGE' ORDER BY id`, [l.id])).rows;
    assert.deepEqual(ev.map((x) => x.detail.to), ['CONTATADO', 'PERDIDO']);
  });
});
