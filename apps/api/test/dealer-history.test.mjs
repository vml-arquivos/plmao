import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

const LIMIT_PLATES = ['HST1A11', 'HST2B22', 'HST3C33', 'HST4D44'];

describe('estoque da loja: preencher pela placa e importar do histórico', integration, () => {
  let pool; let server; let storeId;
  const u = {};
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    server = await startServer();
    for (const tag of ['owner', 'seller', 'outsider']) {
      const email = `${uid(tag)}@loja.local`;
      const r = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: `Pessoa ${tag}`, email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
      assert.equal(r.status, 201, r.text);
      u[tag] = { token: r.json.token, id: r.json.user.id, email };
    }
    const st = await call('owner', '/dealer', 'POST', { name: `Loja Histórico ${uid('h')}` });
    assert.equal(st.status, 201, st.text);
    storeId = (st.json.store ?? st.json).id;
    assert.equal((await call('owner', '/dealer/members', 'POST', { email: u.seller.email, role: 'SELLER' })).status, 201);
  });
  after(async () => { await server.stop(); await pool.end(); });
  const call = (who, path, method = 'GET', body) => hostRequest(server.base, `/api${path}`, { method, token: u[who].token, body });
  const query = async (who, plate, normalized, product = 'COMPLETE') => {
    const q = await pool.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,price_cents,completed_at) VALUES($1,$2,$3,'SUCCESS',0,'mock',1500,now()) RETURNING id`, [u[who].id, plate, product]);
    await pool.query(`INSERT INTO vehicle_query_results(query_id,normalized,raw_response) VALUES($1,$2::jsonb,'{}'::jsonb)`, [q.rows[0].id, JSON.stringify(normalized)]);
    return q.rows[0].id;
  };
  const report = (plate) => ({ identification: { plate, brand: 'VW', model: 'GOL', fullModel: 'VW/GOL 1.0 MI' }, characteristics: { manufactureYear: '2019', modelYear: '2020', color: 'PRATA', fuel: 'ALCOOL/GASOLINA' }, registration: {}, owner: {}, debts: [], restrictions: [] });

  it('placa com consulta da equipe preenche marca, modelo, versão, anos, cor e combustível', async () => {
    await query('seller', 'HST1A11', report('HST1A11'));
    const r = await call('owner', '/dealer/vehicle-lookup?plate=hst1a11');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.found, true); assert.equal(r.json.inStock, null);
    assert.deepEqual([r.json.fields.brand, r.json.fields.model, r.json.fields.yearManufacture, r.json.fields.yearModel, r.json.fields.color], ['VW', 'Gol', 2019, 2020, 'Prata']);
    assert.equal(r.json.fields.version, '1.0 MI'); assert.equal(r.json.fields.fuel, 'Alcool/Gasolina');
    assert.equal(r.json.sources[0].kind, 'CONSULTA');
  });

  it('placa sem nenhum dado salvo volta found=false; placa inválida é recusada', async () => {
    const r = await call('owner', '/dealer/vehicle-lookup?plate=ZZZ9Z99');
    assert.equal(r.json.found, false); assert.deepEqual(r.json.fields, {});
    assert.equal((await call('owner', '/dealer/vehicle-lookup?plate=12')).status, 400);
  });

  it('só enxerga consulta de quem é da equipe da loja', async () => {
    await query('outsider', 'HST9Z99', report('HST9Z99'));
    const r = await call('owner', '/dealer/vehicle-lookup?plate=HST9Z99');
    assert.equal(r.json.found, false);
    assert.equal((await call('outsider', '/dealer/vehicle-lookup?plate=HST9Z99')).status, 404, 'sem loja não usa');
  });

  it('FIPE da placa preenche o valor FIPE; garagem da equipe traz km', async () => {
    await query('owner', 'HST2B22', { __type: 'FIPE_QUOTE', quote: { brand: { code: '1', name: 'Fiat' }, model: { code: '2', name: 'Uno Way 1.0' }, year: { code: '3', name: '2018' }, modelYear: 2018, fuel: 'Flex', valueCents: 4_500_000, plate: 'HST2B22', vehicleDetails: { model: 'UNO' } } }, 'COMPLETE');
    await pool.query(`INSERT INTO saved_vehicles(user_id,plate,model_label,model_year,km) VALUES($1,'HST2B22','Uno Way',2018,64000)`, [u.seller.id]);
    const r = await call('owner', '/dealer/vehicle-lookup?plate=HST2B22');
    assert.equal(r.json.fields.fipeCents, 4_500_000); assert.equal(r.json.fields.brand, 'Fiat'); assert.equal(r.json.fields.mileageKm, 64000);
    assert.deepEqual(r.json.sources.map((s) => s.kind).sort(), ['FIPE', 'GARAGEM']);
  });

  it('candidatos a importar: consultas e garagem da equipe, sem placas já em estoque, com busca', async () => {
    const list = await call('owner', '/dealer/import-candidates');
    assert.equal(list.status, 200, list.text);
    const plates = list.json.items.map((c) => c.plate);
    assert.ok(plates.includes('HST1A11') && plates.includes('HST2B22'));
    assert.ok(!plates.includes('HST9Z99'), 'consulta de fora da equipe não entra');
    assert.ok(list.json.room > 0);
    assert.equal(list.json.items.find((c) => c.plate === 'HST1A11').label, 'VW Gol 1.0 MI 2020');
    const one = await call('owner', '/dealer/import-candidates?q=hst2');
    assert.deepEqual(one.json.items.map((c) => c.plate), ['HST2B22']);
    assert.equal((await call('outsider', '/dealer/import-candidates')).status, 404);
  });

  it('importa em rascunho: sem preço, fora da vitrine, ligado à consulta; repetir não duplica', async () => {
    const r = await call('seller', '/dealer/vehicles/import', 'POST', { plates: ['HST1A11', 'HST2B22', 'NAO1A11'] });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.imported, 2); assert.equal(r.json.skipped, 1);
    const rows = (await pool.query(`SELECT plate,brand,model,version,price_cents,public_listed,query_id,mileage_km,fipe_cents FROM stock_vehicles WHERE dealership_id=$1 ORDER BY plate`, [storeId])).rows;
    assert.equal(rows.length, 2);
    const gol = rows.find((x) => x.plate === 'HST1A11');
    assert.equal(gol.brand, 'VW'); assert.equal(gol.model, 'Gol'); assert.equal(gol.price_cents, 0); assert.equal(gol.public_listed, false); assert.ok(gol.query_id);
    assert.equal(rows.find((x) => x.plate === 'HST2B22').fipe_cents, 4_500_000);
    const again = await call('seller', '/dealer/vehicles/import', 'POST', { plates: ['HST1A11'] });
    assert.equal(again.json.imported, 0); assert.equal(again.json.skipped, 1);
    const cands = (await call('owner', '/dealer/import-candidates')).json.items.map((c) => c.plate);
    assert.ok(!cands.includes('HST1A11'), 'depois de importado sai da lista');
    const lk = await call('owner', '/dealer/vehicle-lookup?plate=HST1A11');
    assert.ok(lk.json.inStock);
  });

  it('vitrine só liga com preço; importado ganha preço e vai para a vitrine', async () => {
    const id = (await pool.query(`SELECT id FROM stock_vehicles WHERE dealership_id=$1 AND plate='HST1A11'`, [storeId])).rows[0].id;
    const no = await call('owner', `/dealer/vehicles/${id}`, 'PATCH', { publicListed: true });
    assert.equal(no.status, 400); assert.match(no.json.message, /preço para mostrar na vitrine/);
    assert.equal((await call('owner', '/dealer/vehicles', 'POST', { brand: 'A', model: 'B', priceCents: 0, publicListed: true })).status, 400);
    const ok = await call('owner', `/dealer/vehicles/${id}`, 'PATCH', { priceCents: 5_500_000, publicListed: true });
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.publicListed, true);
  });

  it('importação respeita o limite do estoque e não cria nada pela metade', async () => {
    for (const p of ['HST3C33', 'HST4D44']) await query('owner', p, report(p));
    await pool.query('UPDATE dealerships SET vehicle_limit=3 WHERE id=$1', [storeId]);
    const r = await call('owner', '/dealer/vehicles/import', 'POST', { plates: ['HST3C33', 'HST4D44'] });
    assert.equal(r.status, 409); assert.equal(r.json.error ?? r.json.code, 'DEALER_VEHICLE_LIMIT');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1`, [storeId])).rows[0].n, 2);
    assert.equal((await call('owner', '/dealer/vehicles/import', 'POST', { plates: [] })).status, 400);
  });
});
