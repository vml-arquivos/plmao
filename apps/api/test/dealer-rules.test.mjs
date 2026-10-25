import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';

describe('avaliação de troca: contas', () => {
  it('parte da FIPE, tira margem e condição, ajusta pela quilometragem e dá faixa de 3%', async () => {
    useTestEnv();
    const { computeTradeIn } = await import('../dist/dealer/tradeIn.js');
    const base = { fipeCents: 10_000_000, yearModel: 2020, storeDiscountBps: 800, currentYear: 2025 };
    const ok = computeTradeIn({ ...base, mileageKm: 60_000, condition: 'EXCELENTE' }); // esperado 60.000 km: sem ajuste de km
    assert.equal(ok.expectedKm, 60_000);
    assert.equal(ok.suggestedCents, 9_200_000);
    assert.equal(ok.minCents, Math.round(9_200_000 * 0.97)); assert.equal(ok.maxCents, Math.round(9_200_000 * 1.03));
    const bom = computeTradeIn({ ...base, mileageKm: 60_000, condition: 'BOM' });
    assert.equal(bom.suggestedCents, 9_000_000);
    const rodado = computeTradeIn({ ...base, mileageKm: 100_000, condition: 'EXCELENTE' }); // 40.000 km a mais: -4%
    assert.equal(rodado.suggestedCents, 8_800_000);
    const pouco = computeTradeIn({ ...base, mileageKm: 20_000, condition: 'EXCELENTE' }); // 40.000 km a menos: +2%
    assert.equal(pouco.suggestedCents, 9_400_000);
    const extremo = computeTradeIn({ ...base, mileageKm: 900_000, condition: 'REGULAR' }); // teto de -15% no km
    assert.equal(extremo.suggestedCents, Math.round(10_000_000 * (1 - 0.08 - 0.06 - 0.15)));
  });
});

describe('loja: regras garantidas pelo banco', integration, () => {
  let pool; let a; let b;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    const mk = async (tag) => (await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,'x','CLIENTE') RETURNING id`, [tag, `${uid(tag)}@rules.local`])).rows[0].id;
    a = await mk('dono a'); b = await mk('dono b');
  });
  after(async () => { await pool.end(); });
  const store = async (owner) => (await pool.query(`INSERT INTO dealerships(owner_user_id,name,slug) VALUES($1,'Loja',$2) RETURNING id`, [owner, uid('loja')])).rows[0].id;
  const fails = (p, code) => assert.rejects(p, (e) => e.code === code, `esperava ${code}`);

  it('slug inválido, WhatsApp inválido e dono repetido são recusados', async () => {
    await fails(pool.query(`INSERT INTO dealerships(owner_user_id,name,slug) VALUES($1,'X','Slug Ruim')`, [a]), '23514');
    const id = await store(a);
    await fails(store(a), '23505');
    await fails(pool.query('UPDATE dealerships SET whatsapp=$2 WHERE id=$1', [id, '123']), '23514');
  });

  it('uma pessoa só pode estar ativa em uma loja', async () => {
    const s1 = await store(b);
    const other = (await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('x',$1,'x','CLIENTE') RETURNING id`, [`${uid('x')}@rules.local`])).rows[0].id;
    const s2 = await store(other);
    await pool.query(`INSERT INTO dealership_members(dealership_id,user_id,role) VALUES($1,$2,'OWNER')`, [s1, b]);
    await fails(pool.query(`INSERT INTO dealership_members(dealership_id,user_id,role) VALUES($1,$2,'SELLER')`, [s2, b]), '23505');
    await pool.query(`UPDATE dealership_members SET active=false WHERE dealership_id=$1 AND user_id=$2`, [s1, b]);
    await pool.query(`INSERT INTO dealership_members(dealership_id,user_id,role) VALUES($1,$2,'SELLER')`, [s2, b]);
  });

  it('veículo: placa única só enquanto está em estoque, vendido exige data, preço não negativo', async () => {
    const id = await store(a === null ? b : (await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('y',$1,'x','CLIENTE') RETURNING id`, [`${uid('y')}@rules.local`])).rows[0].id);
    const ins = (plate, status = 'AVAILABLE', extra = '') => pool.query(`INSERT INTO stock_vehicles(dealership_id,plate,brand,model,price_cents,status${extra ? ',sold_at' : ''}) VALUES($1,$2,'A','B',1000,$3${extra ? ',now()' : ''}) RETURNING id`, [id, plate, status]);
    await ins('AAA1A11');
    await fails(ins('AAA1A11'), '23505');
    await fails(ins('AAA1A11', 'RESERVED'), '23505');
    await ins('AAA1A11', 'SOLD', 'x'); await ins('AAA1A11', 'SOLD', 'x'); await ins('AAA1A11', 'ARCHIVED');
    await fails(ins('BBB1B22', 'SOLD'), '23514');
    await fails(pool.query(`INSERT INTO stock_vehicles(dealership_id,brand,model,price_cents) VALUES($1,'A','B',-1)`, [id]), '23514');
    await fails(pool.query(`INSERT INTO stock_vehicles(dealership_id,plate,brand,model,price_cents) VALUES($1,'12345','A','B',1)`, [id]), '23514');
  });

  it('lead: precisa de contato e só fica encerrado com data de encerramento', async () => {
    const id = await store((await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('z',$1,'x','CLIENTE') RETURNING id`, [`${uid('z')}@rules.local`])).rows[0].id);
    await fails(pool.query(`INSERT INTO dealer_leads(dealership_id,name) VALUES($1,'Sem contato')`, [id]), '23514');
    const l = (await pool.query(`INSERT INTO dealer_leads(dealership_id,name,phone) VALUES($1,'Com contato','11999998888') RETURNING id`, [id])).rows[0].id;
    await fails(pool.query(`UPDATE dealer_leads SET stage='WON' WHERE id=$1`, [l]), '23514');
    await fails(pool.query(`UPDATE dealer_leads SET closed_at=now() WHERE id=$1`, [l]), '23514');
    await fails(pool.query(`UPDATE dealer_leads SET stage='QUALQUER' WHERE id=$1`, [l]), '23514');
    await pool.query(`UPDATE dealer_leads SET stage='WON',closed_at=now() WHERE id=$1`, [l]);
  });

  it('proposta: entrada mais troca não passa do preço; excluir lead e veículo mantém a proposta', async () => {
    const owner = (await pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES('w',$1,'x','CLIENTE') RETURNING id`, [`${uid('w')}@rules.local`])).rows[0].id;
    const id = await store(owner);
    const prop = (down, trade) => pool.query(`INSERT INTO dealer_proposals(dealership_id,code,customer_name,vehicle_label,price_cents,down_payment_cents,trade_in_cents,valid_until) VALUES($1,$2,'Cliente','Veículo',1000,$3,$4,current_date) RETURNING id`, [id, uid('PRO'), down, trade]);
    await fails(prop(800, 300), '23514');
    const lead = (await pool.query(`INSERT INTO dealer_leads(dealership_id,name,phone) VALUES($1,'Lead','11999998888') RETURNING id`, [id])).rows[0].id;
    const p = (await prop(500, 500)).rows[0].id;
    await pool.query('UPDATE dealer_proposals SET lead_id=$2 WHERE id=$1', [p, lead]);
    await pool.query('DELETE FROM dealer_leads WHERE id=$1', [lead]);
    assert.equal((await pool.query('SELECT lead_id FROM dealer_proposals WHERE id=$1', [p])).rows[0].lead_id, null);
    // apagar a loja leva tudo junto
    await pool.query('DELETE FROM dealerships WHERE id=$1', [id]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dealer_proposals WHERE id=$1', [p])).rows[0].n, 0);
  });
});
