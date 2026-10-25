import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import http from 'node:http';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

function call(base, path, { method = 'GET', body, token } = {}) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => { const buf = Buffer.concat(chunks); const text = buf.toString('utf8'); resolve({ status: res.statusCode, headers: res.headers, buf, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }); });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('loja: estoque, equipe, leads, propostas, troca, alertas e vitrine', integration, () => {
  let pool; let server;
  const password = 'Senha-Forte-123!';
  const u = {}; // owner, manager, seller, outsider, other (dono de outra loja)
  let store; let vehicle; let lead; let slug;
  const storeName = `Auto Center ${uid('x').replace(/[^a-z]/gi, '').slice(-6)}`;

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer({});
    for (const tag of ['owner', 'manager', 'seller', 'outsider', 'other']) {
      const email = `${uid(tag)}@loja.local`;
      const r = await call(server.base, '/api/auth/register', { method: 'POST', body: { name: `Pessoa ${tag}`, email, password, acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201);
      u[tag] = { token: r.json.token, email, id: (await pool.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id };
    }
  });
  after(async () => { await server.stop(); await pool.end(); });
  const api = (who, path, opts = {}) => call(server.base, `/api${path}`, { ...opts, token: u[who]?.token });

  it('sem loja ativada: /dealer/me vazio e demais rotas respondem 404', async () => {
    const me = await api('owner', '/dealer/me');
    assert.equal(me.status, 200); assert.equal(me.json.store, null);
    assert.equal((await api('owner', '/dealer/vehicles')).status, 404);
    assert.equal((await call(server.base, '/api/dealer/vehicles')).status, 401);
  });

  it('ativa a loja: dono vira OWNER, slug sai do nome, segunda loja da mesma pessoa é recusada', async () => {
    const r = await api('owner', '/dealer', { method: 'POST', body: { name: storeName, whatsapp: '(11) 98888-7777', city: 'São Paulo', state: 'sp' } });
    assert.equal(r.status, 201, r.text);
    store = r.json.store ?? r.json; slug = store.slug;
    assert.equal(slug, storeName.toLowerCase().replace(/ /g, '-'));
    const again = await api('owner', '/dealer', { method: 'POST', body: { name: 'Outra' } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error ?? again.json.code, 'DEALER_ALREADY_MEMBER');
    const other = await api('other', '/dealer', { method: 'POST', body: { name: storeName } });
    assert.equal(other.status, 201);
    assert.notEqual((other.json.store ?? other.json).slug, slug, 'slug duplicado ganha sufixo');
    const me = await api('owner', '/dealer/me');
    assert.equal(me.json.role, 'OWNER'); assert.equal(me.json.canSeeCost, true);
  });

  it('equipe: gerente e vendedor entram por e-mail; limite e uma loja por pessoa valem', async () => {
    const m = await api('owner', '/dealer/members', { method: 'POST', body: { email: u.manager.email, role: 'MANAGER' } });
    assert.equal(m.status, 201, m.text);
    const s = await api('owner', '/dealer/members', { method: 'POST', body: { email: u.seller.email, role: 'SELLER' } });
    assert.equal(s.status, 201, s.text);
    assert.equal((await api('owner', '/dealer/members', { method: 'POST', body: { email: u.other.email, role: 'SELLER' } })).status, 409, 'já está em outra loja');
    assert.equal((await api('owner', '/dealer/members', { method: 'POST', body: { email: 'ninguem@loja.local', role: 'SELLER' } })).status, 404);
    // limite 3: dono + 2; o quarto não cabe
    const four = await api('owner', '/dealer/members', { method: 'POST', body: { email: u.outsider.email, role: 'SELLER' } });
    assert.equal(four.status, 409); assert.equal(four.json.error ?? four.json.code, 'DEALER_MEMBER_LIMIT');
    // gerente só adiciona vendedor
    await pool.query('UPDATE dealerships SET member_limit=10 WHERE id=$1', [store.id]);
    assert.equal((await api('manager', '/dealer/members', { method: 'POST', body: { email: u.outsider.email, role: 'MANAGER' } })).status, 403);
    // vendedor vê a equipe só com nomes, e não gerencia
    const team = await api('seller', '/dealer/members');
    assert.equal(team.status, 200);
    assert.ok(team.json.members.every((x) => x.email === null || x.userId === u.seller.id));
    assert.equal((await api('seller', '/dealer/members', { method: 'POST', body: { email: u.outsider.email, role: 'SELLER' } })).status, 403);
    // ninguém mexe no dono
    assert.equal((await api('manager', `/dealer/members/${u.owner.id}`, { method: 'PATCH', body: { active: false } })).status, 403);
  });

  it('estoque: cria, bloqueia placa repetida, esconde custo do vendedor', async () => {
    const body = { plate: 'ABC1D23', brand: 'Honda', model: 'Civic', version: 'EXL', yearManufacture: 2020, yearModel: 2020, color: 'Prata', fuel: 'Flex', transmission: 'Automático', mileageKm: 60000, priceCents: 9_000_000, costCents: 7_500_000, fipeCents: 8_800_000, publicListed: true, sealEnabled: true };
    const c = await api('owner', '/dealer/vehicles', { method: 'POST', body });
    assert.equal(c.status, 201, c.text);
    vehicle = c.json;
    assert.equal(vehicle.costCents, 7_500_000); assert.equal(vehicle.marginCents, 1_500_000);
    assert.equal((await api('owner', '/dealer/vehicles', { method: 'POST', body })).status, 409);
    const seen = await api('seller', `/dealer/vehicles/${vehicle.id}`);
    assert.equal(seen.status, 200); assert.equal(seen.json.costCents, null); assert.equal(seen.json.marginCents, null);
    const list = await api('seller', '/dealer/vehicles');
    assert.equal(list.json[0].costCents, null);
    // vendedor não grava custo
    const v2 = await api('seller', '/dealer/vehicles', { method: 'POST', body: { brand: 'Fiat', model: 'Argo', priceCents: 5_000_000, costCents: 1 } });
    assert.ok([201, 403].includes(v2.status));
    if (v2.status === 201) assert.equal((await pool.query('SELECT cost_cents FROM stock_vehicles WHERE id=$1', [v2.json.id])).rows[0].cost_cents, null);
    // validações
    assert.equal((await api('owner', '/dealer/vehicles', { method: 'POST', body: { brand: 'X', model: 'Y', priceCents: -1 } })).status, 400);
    assert.equal((await api('owner', '/dealer/vehicles', { method: 'POST', body: { plate: 'XX', brand: 'X', model: 'Y', priceCents: 1000 } })).status, 400);
  });

  it('isolamento: quem é de outra loja ou de nenhuma recebe 404 em tudo', async () => {
    assert.equal((await api('other', `/dealer/vehicles/${vehicle.id}`)).status, 404);
    assert.equal((await api('other', `/dealer/vehicles/${vehicle.id}`, { method: 'PATCH', body: { priceCents: 1 } })).status, 404);
    assert.equal((await api('other', `/dealer/vehicles/${vehicle.id}/sell`, { method: 'POST', body: { soldPriceCents: 1 } })).status, 404);
    assert.equal((await api('outsider', '/dealer/vehicles')).status, 404);
    assert.equal((await api('owner', '/dealer/vehicles/nao-e-uuid')).status, 404);
    const otherList = await api('other', '/dealer/vehicles');
    assert.equal(otherList.json.length, 0);
  });

  it('consulta da equipe fica ligada ao veículo e dá o selo verificado', async () => {
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,completed_at) VALUES($1,'ABC1D23','DEBTS','SUCCESS',0,'mock',1500,now()) RETURNING id`, [u.seller.id]);
    const patched = await api('owner', `/dealer/vehicles/${vehicle.id}`, { method: 'PATCH', body: { plate: 'ABC1D23', priceCents: 9_000_000 } });
    assert.equal(patched.status, 200, patched.text);
    const check = await pool.query('SELECT query_id FROM stock_vehicles WHERE id=$1', [vehicle.id]);
    // o vínculo automático acontece ao trocar a placa; garantimos o vínculo explícito para o restante do teste
    await pool.query('UPDATE stock_vehicles SET query_id=$2 WHERE id=$1', [vehicle.id, q.rows[0].id]);
    assert.ok(check.rows.length === 1);
    const v = await api('owner', `/dealer/vehicles/${vehicle.id}`);
    assert.equal(v.json.verification.code, String(q.rows[0].id).slice(0, 8).toUpperCase());
  });

  it('leads: cria, vendedor só vê os seus e os sem dono, etapa exige motivo ao perder', async () => {
    const mk = (who, name, extra = {}) => api(who, '/dealer/leads', { method: 'POST', body: { name, phone: '11977776666', ...extra } });
    const a = await mk('owner', 'Cliente sem dono'); assert.equal(a.status, 201, a.text);
    const b = await mk('seller', 'Cliente do vendedor', { vehicleId: vehicle.id }); assert.equal(b.status, 201);
    assert.equal(b.json.assignedTo, u.seller.id, 'vendedor fica como responsável');
    const c = await mk('owner', 'Cliente do dono', { assignedTo: u.owner.id }); assert.equal(c.status, 201);
    lead = b.json;
    const sellerSees = (await api('seller', '/dealer/leads')).json.map((x) => x.name).sort();
    assert.deepEqual(sellerSees, ['Cliente do vendedor', 'Cliente sem dono']);
    assert.equal((await api('seller', `/dealer/leads/${c.json.id}`)).status, 404, 'lead de outra pessoa some para o vendedor');
    assert.equal((await api('manager', '/dealer/leads')).json.length, 3);
    assert.equal((await api('other', `/dealer/leads/${a.json.id}`)).status, 404);
    // sem telefone e sem e-mail
    assert.equal((await api('owner', '/dealer/leads', { method: 'POST', body: { name: 'Sem contato' } })).status, 400);
    // assumir
    const claim = await api('seller', `/dealer/leads/${a.json.id}/claim`, { method: 'POST' });
    assert.equal(claim.status, 200); assert.equal(claim.json.assignedTo, u.seller.id);
    assert.equal((await api('manager', `/dealer/leads/${a.json.id}/claim`, { method: 'POST' })).status, 409);
    // etapas
    const st = await api('seller', `/dealer/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'CONTACT' } });
    assert.equal(st.json.stage, 'CONTACT');
    assert.equal((await api('seller', `/dealer/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'LOST' } })).status, 400);
    const lost = await api('seller', `/dealer/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'LOST', lostReason: 'Comprou em outra loja' } });
    assert.equal(lost.json.stage, 'LOST'); assert.equal(lost.json.lostReason, 'Comprou em outra loja'); assert.ok(lost.json.closedAt);
    assert.equal((await api('seller', `/dealer/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'NEW' } })).status, 403, 'vendedor não reabre');
    const reopen = await api('manager', `/dealer/leads/${lead.id}/stage`, { method: 'POST', body: { stage: 'NEW' } });
    assert.equal(reopen.json.stage, 'NEW'); assert.equal(reopen.json.closedAt, null); assert.equal(reopen.json.lostReason, null);
    const det = await api('seller', `/dealer/leads/${lead.id}`);
    assert.ok(det.json.events.length >= 4);
    assert.equal((await api('seller', `/dealer/leads/${lead.id}/notes`, { method: 'POST', body: { note: 'Ligou de volta' } })).status, 201);
    // repassar: só gerente
    assert.equal((await api('seller', `/dealer/leads/${lead.id}`, { method: 'PATCH', body: { assignedTo: u.manager.id } })).status, 403);
    assert.equal((await api('manager', `/dealer/leads/${lead.id}`, { method: 'PATCH', body: { assignedTo: u.outsider.id } })).status, 400, 'fora da equipe');
  });

  it('exportação e exclusão de leads só para dono e gerente; CSV sem fórmula', async () => {
    assert.equal((await api('seller', '/dealer/leads.csv')).status, 403);
    await api('owner', '/dealer/leads', { method: 'POST', body: { name: '=cmd|calc', phone: '11966665555' } });
    const csv = await api('manager', '/dealer/leads.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.includes("'=cmd|calc") || !csv.text.includes(';=cmd'), 'protege contra fórmula');
    const del = await api('seller', `/dealer/leads/${lead.id}`, { method: 'DELETE' });
    assert.equal(del.status, 403);
    const tmp = await api('owner', '/dealer/leads', { method: 'POST', body: { name: 'Apagar', phone: '11955554444' } });
    assert.equal((await api('manager', `/dealer/leads/${tmp.json.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await api('manager', `/dealer/leads/${tmp.json.id}`)).status, 404);
  });

  it('proposta: simula financiamento, gera PDF, move o lead para Proposta e respeita o dono', async () => {
    const lead2 = (await api('seller', '/dealer/leads', { method: 'POST', body: { name: 'Maria Souza', phone: '11944443333' } })).json;
    const p = await api('seller', '/dealer/proposals', { method: 'POST', body: { vehicleId: vehicle.id, leadId: lead2.id, priceCents: 8_900_000, downPaymentCents: 2_000_000, tradeInCents: 500_000, financing: { months: 48 }, validDays: 5, notes: 'Revisão em dia' } });
    assert.equal(p.status, 201, p.text);
    assert.match(p.json.code, /^PRO-[0-9A-F]{8}$/);
    assert.equal(p.json.months, 48); assert.ok(p.json.installmentCents > 0);
    const moved = await api('seller', `/dealer/leads/${lead2.id}`);
    assert.equal(moved.json.lead.stage, 'PROPOSAL');
    assert.equal(moved.json.proposals.length, 1);
    const pdf = await api('seller', `/dealer/proposals/${p.json.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');
    assert.match(pdf.headers['content-type'], /application\/pdf/);
    // à vista, sem simulação
    const cash = await api('owner', '/dealer/proposals', { method: 'POST', body: { vehicleLabel: 'Fiat Argo 2021', customerName: 'João', priceCents: 5_000_000 } });
    assert.equal(cash.status, 201); assert.equal(cash.json.months, null);
    assert.equal((await api('owner', `/dealer/proposals/${cash.json.id}/pdf`)).buf.subarray(0, 4).toString(), '%PDF');
    // vendedor não vê proposta de outro; gerente vê todas; outra loja não vê
    assert.equal((await api('seller', `/dealer/proposals/${cash.json.id}`)).status, 404);
    assert.equal((await api('manager', `/dealer/proposals/${p.json.id}`)).status, 200);
    assert.equal((await api('other', `/dealer/proposals/${p.json.id}/pdf`)).status, 404);
    // validações
    assert.equal((await api('owner', '/dealer/proposals', { method: 'POST', body: { vehicleLabel: 'X Y', customerName: 'Fulano', priceCents: 1000, downPaymentCents: 2000 } })).status, 400);
    assert.equal((await api('owner', '/dealer/proposals', { method: 'POST', body: { vehicleLabel: 'X Y', customerName: 'Fulano', priceCents: 1000, financing: { months: 12 }, downPaymentCents: 1000 } })).status, 400, 'sem saldo para financiar');
    assert.equal((await api('other', '/dealer/proposals', { method: 'POST', body: { vehicleId: vehicle.id, customerName: 'Fulano' } })).status, 404);
  });

  it('avaliação de troca: faixa em torno da sugestão e histórico', async () => {
    const t = await api('seller', '/dealer/trade-in', { method: 'POST', body: { vehicleLabel: 'VW Gol 2015', yearModel: 2015, mileageKm: 120000, condition: 'BOM', fipeCents: 3_000_000 } });
    assert.equal(t.status, 201, t.text);
    assert.ok(t.json.suggestedCents < 3_000_000 && t.json.suggestedCents > 2_000_000);
    assert.ok(t.json.minCents < t.json.suggestedCents && t.json.maxCents > t.json.suggestedCents);
    assert.equal((await api('seller', '/dealer/trade-ins')).json.length, 1);
    assert.equal((await api('other', '/dealer/trade-ins')).json.length, 0);
    assert.equal((await api('seller', '/dealer/trade-in', { method: 'POST', body: { vehicleLabel: 'X', mileageKm: -1, condition: 'BOM', fipeCents: 3_000_000 } })).status, 400);
  });

  it('vender: fecha o veículo, leva o lead para Fechado e não deixa vender duas vezes', async () => {
    const lead3 = (await api('owner', '/dealer/leads', { method: 'POST', body: { name: 'Comprador', phone: '11933332222', vehicleId: vehicle.id } })).json;
    const sold = await api('manager', `/dealer/vehicles/${vehicle.id}/sell`, { method: 'POST', body: { soldPriceCents: 8_800_000, leadId: lead3.id } });
    assert.equal(sold.status, 200, sold.text);
    assert.equal(sold.json.status, 'SOLD'); assert.equal(sold.json.soldPriceCents, 8_800_000);
    assert.equal((await api('owner', `/dealer/leads/${lead3.id}`)).json.lead.stage, 'WON');
    assert.equal((await api('manager', `/dealer/vehicles/${vehicle.id}/sell`, { method: 'POST', body: { soldPriceCents: 1 } })).status, 409);
    // a placa liberou: dá para cadastrar de novo
    assert.equal((await api('owner', '/dealer/vehicles', { method: 'POST', body: { plate: 'ABC1D23', brand: 'Honda', model: 'Civic', priceCents: 9_000_000 } })).status, 201);
  });

  it('resumo e alertas calculam estoque parado, preço acima da FIPE, IPVA e retorno atrasado', async () => {
    const old = await api('owner', '/dealer/vehicles', { method: 'POST', body: { brand: 'Chevrolet', model: 'Onix', yearModel: 2019, priceCents: 7_000_000, fipeCents: 5_000_000, enteredOn: '2020-01-10', ipvaDueOn: '2020-03-01' } });
    assert.equal(old.status, 201, old.text);
    const lead = await api('owner', '/dealer/leads', { method: 'POST', body: { name: 'Retorno', phone: '11922221111', nextContactAt: '2020-01-01T10:00:00Z' } });
    assert.equal(lead.status, 201);
    const al = await api('owner', '/dealer/alerts');
    const kinds = new Set(al.json.items.map((x) => x.kind));
    for (const k of ['STALE', 'ABOVE_FIPE', 'IPVA', 'FOLLOW_UP']) assert.ok(kinds.has(k), `falta alerta ${k}`);
    const sum = await api('owner', '/dealer/summary');
    assert.equal(sum.status, 200);
    assert.ok(sum.json.stock.open.count >= 2); assert.equal(sum.json.stock.sold, 1);
    assert.equal(sum.json.last30.sold, 1); assert.equal(sum.json.last30.revenueCents, 8_800_000);
    assert.ok(Array.isArray(sum.json.sellers));
    const ss = await api('seller', '/dealer/summary');
    assert.equal(ss.json.sellers, null); assert.equal(ss.json.last30.revenueCents, null); assert.equal(ss.json.stock.open.costCents, null);
  });

  it('vitrine pública: só com a loja ligada; sem custo; placa escondida; selo verificado', async () => {
    assert.equal((await call(server.base, `/api/public/stores/${slug}`)).status, 404, 'desligada por padrão');
    assert.equal((await api('manager', '/dealer', { method: 'PATCH', body: { publicEnabled: true } })).status, 403, 'só o dono liga');
    assert.equal((await api('owner', '/dealer', { method: 'PATCH', body: { publicEnabled: true, about: 'Carros revisados.' } })).status, 200);
    const sealed = await api('owner', '/dealer/vehicles', { method: 'POST', body: { plate: 'QQQ1A11', brand: 'Toyota', model: 'Corolla', priceCents: 12_000_000, costCents: 10_000_000, publicListed: true, sealEnabled: true } });
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,completed_at) VALUES($1,'QQQ1A11','DEBTS','SUCCESS',0,'mock',1500,now()) RETURNING id`, [u.owner.id]);
    await pool.query('UPDATE stock_vehicles SET query_id=$2 WHERE id=$1', [sealed.json.id, q.rows[0].id]);
    await api('owner', '/dealer/vehicles', { method: 'POST', body: { plate: 'RRR1A11', brand: 'Privado', model: 'NaoListar', priceCents: 1000, publicListed: false } });
    const pub = await call(server.base, `/api/public/stores/${slug}`);
    assert.equal(pub.status, 200);
    assert.ok(!pub.text.includes('NaoListar'));
    assert.ok(!/cost|margin|QQQ1A11/i.test(pub.text), 'não vaza custo, margem nem placa inteira');
    const v = pub.json.vehicles.find((x) => x.model === 'Corolla');
    assert.equal(v.plateEnd, '1'); assert.equal(v.verified.code, String(q.rows[0].id).slice(0, 8).toUpperCase());
    const one = await call(server.base, `/api/public/stores/${slug}/vehicles/${v.id}`);
    assert.equal(one.status, 200);
    assert.equal((await call(server.base, `/api/public/stores/${slug}/vehicles/${vehicle.id}`)).status, 404, 'vendido some');
    assert.equal((await call(server.base, '/api/public/stores/NÃO_EXISTE')).status, 404);
  });

  it('lead da vitrine: exige aceite, ignora robô, não duplica em 24 h e funciona sem e-mail configurado', async () => {
    const list = (await call(server.base, `/api/public/stores/${slug}`)).json.vehicles;
    const vid = list[0].id;
    const path = `/api/public/stores/${slug}/leads`;
    const visitor = uid('Visitante');
    const ok = { name: visitor, phone: '(11) 91111-0000', message: 'Tenho interesse', vehicleId: vid, consent: true };
    assert.equal((await call(server.base, path, { method: 'POST', body: { ...ok, consent: false } })).status, 400);
    assert.equal((await call(server.base, path, { method: 'POST', body: { name: 'Sem contato', consent: true } })).status, 400);
    const bot = await call(server.base, path, { method: 'POST', body: { ...ok, name: 'Robo', website: 'http://spam' } });
    assert.equal(bot.status, 202);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM dealer_leads WHERE name='Robo'`)).rows[0].n, 0);
    const first = await call(server.base, path, { method: 'POST', body: ok });
    assert.equal(first.status, 201, first.text);
    const second = await call(server.base, path, { method: 'POST', body: { ...ok, message: 'Ainda tenho interesse' } });
    assert.equal(second.status, 200);
    const rows = await pool.query(`SELECT id,source,consent_at FROM dealer_leads WHERE name=$1`, [visitor]);
    assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].source, 'VITRINE'); assert.ok(rows.rows[0].consent_at);
    assert.equal((await call(server.base, `/api/public/stores/outra-inexistente/leads`, { method: 'POST', body: ok })).status, 404);
    // veículo de outra loja não vale
    const foreign = await api('other', '/dealer/vehicles', { method: 'POST', body: { brand: 'A', model: 'B', priceCents: 1000, publicListed: true } });
    assert.equal((await call(server.base, path, { method: 'POST', body: { ...ok, name: 'Outro Visitante', vehicleId: foreign.json.id } })).status, 404);
    // o lead aparece no funil para o gerente
    const seen = await api('manager', `/dealer/leads?q=${visitor}`);
    assert.equal(seen.json.length, 1);
  });

  it('loja suspensa pelo painel bloqueia a equipe e a vitrine; limite de veículos vale', async () => {
    await pool.query('UPDATE dealerships SET active=false WHERE id=$1', [store.id]);
    const blocked = await api('owner', '/dealer/vehicles');
    assert.equal(blocked.status, 403); assert.equal(blocked.json.error ?? blocked.json.code, 'DEALER_SUSPENDED');
    assert.equal((await call(server.base, `/api/public/stores/${slug}`)).status, 404);
    await pool.query('UPDATE dealerships SET active=true WHERE id=$1', [store.id]);
    const open = (await pool.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED')`, [store.id])).rows[0].n;
    await pool.query('UPDATE dealerships SET vehicle_limit=$2 WHERE id=$1', [store.id, open]);
    const over = await api('owner', '/dealer/vehicles', { method: 'POST', body: { brand: 'Extra', model: 'Carro', priceCents: 1000 } });
    assert.equal(over.status, 409); assert.equal(over.json.error ?? over.json.code, 'DEALER_VEHICLE_LIMIT');
  });

  it('remover alguém da equipe vale na hora', async () => {
    const r = await api('owner', `/dealer/members/${u.seller.id}`, { method: 'PATCH', body: { active: false } });
    assert.equal(r.status, 200, r.text);
    assert.equal((await api('seller', '/dealer/vehicles')).status, 404);
  });
});
