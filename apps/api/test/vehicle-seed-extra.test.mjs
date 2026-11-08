import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

describe('guia de veículos: segunda carga (mais marcas e modelos)', () => {
  it('todas as fichas passam pela validação do painel e respeitam a regra de não estimar', async () => {
    const { EXTRA_VEHICLE_SEED, EXTRA_SEED_SOURCE } = await import('../dist/data/vehicleSeedExtra.js');
    const { VEHICLE_SEED } = await import('../dist/data/vehicleSeed.js');
    const { cleanSpecs, SPEC_BY_KEY } = await import('../dist/lib/vehicleSpecs.js');
    assert.ok(EXTRA_VEHICLE_SEED.length >= 30);
    assert.match(EXTRA_SEED_SOURCE, /Confirme/);
    const slugs = new Set(VEHICLE_SEED.map((m) => m.slug));
    for (const model of EXTRA_VEHICLE_SEED) {
      assert.ok(!slugs.has(model.slug), `slug repetido: ${model.slug}`); slugs.add(model.slug);
      assert.ok(model.versions.length >= 1);
      const names = new Set();
      for (const v of model.versions) {
        const tag = `${model.slug} ${v.name}`;
        assert.ok(!names.has(`${v.name}|${v.yearModel}`), `versão repetida: ${tag}`); names.add(`${v.name}|${v.yearModel}`);
        assert.ok(v.yearModel >= 2020 && v.yearModel <= 2027, `${tag} ano`);
        const { specs, errors } = cleanSpecs(v.specs);
        assert.deepEqual(errors, [], tag);
        assert.deepEqual(Object.keys(specs).sort(), Object.keys(v.specs).sort(), `${tag}: chave descartada na validação`);
        for (const k of Object.keys(v.specs)) assert.ok(SPEC_BY_KEY.has(k), k);
        assert.ok(specs.power_hp >= 40 && specs.power_hp <= 400, `${tag} potência`);
        assert.ok(specs.length_mm > specs.wheelbase_mm, `${tag} entre-eixos`);
        assert.ok(specs.weight_kg > 500 && specs.weight_kg < 3000, `${tag} peso`);
        // itens de série não são presumidos: só entram quando a fonte os lista
        for (const k of ['abs', 'esc', 'isofix', 'air_conditioning']) assert.ok(!(k in specs), `${tag}: ${k} não consta na fonte`);
        if (v.fuel === 'Diesel') assert.ok(specs.cons_city_diesel_kml && specs.cons_road_diesel_kml, tag);
        else if (v.fuel === 'Flex') assert.ok(specs.cons_city_gas_kml && specs.cons_city_eth_kml && specs.cons_city_gas_kml > specs.cons_city_eth_kml, `${tag} etanol rende menos`);
        else if (v.fuel === 'Elétrico') assert.ok(specs.battery_kwh && specs.range_km, tag);
      }
    }
  });
});

describe('migração 072: mais veículos no guia', integration, () => {
  let server; let pool; let extra;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    extra = (await import('../dist/data/vehicleSeedExtra.js')).EXTRA_VEHICLE_SEED;
    server = await startServer();
  });
  after(async () => { await server?.stop(); await pool?.end(); });

  it('modelos novos publicados, com fonte e sem opinião inventada', async () => {
    const r = await pool.query(`SELECT slug,status,spec_source,review,pros,cons FROM vehicle_models WHERE slug = ANY($1)`, [extra.map((m) => m.slug)]);
    assert.equal(r.rowCount, extra.length);
    for (const row of r.rows) { assert.equal(row.status, 'PUBLISHED'); assert.match(row.spec_source, /fichacompleta/); assert.equal(row.review, ''); assert.deepEqual(row.pros, []); }
    const v = await pool.query(`SELECT count(*)::int AS n FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE m.slug = ANY($1)`, [extra.map((m) => m.slug)]);
    assert.equal(v.rows[0].n, extra.reduce((a, m) => a + m.versions.length, 0));
  });

  it('o guia passa a listar as marcas novas e a busca por marca encontra', async () => {
    const all = await (await server.request('/api/vehicles?limit=60')).json();
    assert.ok(all.total >= 50, `total ${all.total}`);
    for (const brand of ['byd', 'gwm', 'nissan', 'peugeot', 'renault', 'mitsubishi']) {
      const r = await (await server.request(`/api/vehicles?search=${brand}`)).json();
      assert.ok(r.items.length >= 1, brand);
    }
  });

  it('elétrico e híbrido mostram bateria e autonomia; diferentes versões e anos aparecem', async () => {
    const rows = (slug) => pool.query(`SELECT v.year_model, v.fuel, v.specs FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE m.slug=$1 ORDER BY v.display_order`, [slug]).then((r) => r.rows);
    const d = await rows('byd-dolphin-mini');
    assert.equal(d[0].year_model, 2025);
    assert.equal(d[0].fuel, 'Elétrico');
    assert.equal(d[0].specs.battery_kwh, 38);
    assert.equal(d[0].specs.range_km, 280);
    const gol = await rows('volkswagen-gol');
    assert.equal(gol[0].year_model, 2023);
    assert.equal((await rows('chevrolet-s10')).length, 2);
    // a ficha pública mostra as versões do modelo novo
    const pubD = await (await server.request('/api/vehicles/byd-dolphin-mini')).json();
    assert.equal(pubD.versions.length, d.length);
  });

  it('a comparação aceita versões das cargas diferentes lado a lado', async () => {
    const ids = [];
    for (const slug of ['volkswagen-taos', 'jeep-renegade', 'fiat-pulse']) {
      const row = (await pool.query(`SELECT v.id FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE m.slug=$1 ORDER BY v.display_order LIMIT 1`, [slug])).rows[0];
      ids.push(row.id);
    }
    const reg = await server.request('/api/auth/register', { method: 'POST', body: { name: 'Ana Clara Souza', email: `${uid('se')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const token = (await reg.json()).token;
    const r = await server.request(`/api/vehicles/compare?ids=${ids.join(',')}`, { token });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.items.length, 3);
    assert.ok(j.fields.some((f) => f.key === 'range_km'));
  });

  it('reaplicar não duplica nem sobrescreve o que a equipe editou', async () => {
    await pool.query(`UPDATE vehicle_models SET summary='Editado pela equipe' WHERE slug='fiat-fastback'`);
    const { placaMigrations } = await import('../dist/migrations.placanamao.js');
    const m = placaMigrations.find((x) => x.id === '072_guia_mais_veiculos');
    const client = await pool.connect();
    try { await m.up(client); await m.up(client); } finally { client.release(); }
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM vehicle_models WHERE slug = ANY($1)`, [extra.map((x) => x.slug)])).rows[0].n, extra.length);
    assert.equal((await pool.query(`SELECT summary FROM vehicle_models WHERE slug='fiat-fastback'`)).rows[0].summary, 'Editado pela equipe');
  });
});
