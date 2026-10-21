import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

describe('guia de veículos: carga inicial (dados de referência)', () => {
  it('todas as fichas passam pela mesma validação do painel e não trazem opinião inventada', async () => {
    const { VEHICLE_SEED, SEED_SOURCE } = await import('../dist/data/vehicleSeed.js');
    const { cleanSpecs, SPEC_BY_KEY } = await import('../dist/lib/vehicleSpecs.js');
    assert.ok(VEHICLE_SEED.length >= 20);
    assert.match(SEED_SOURCE, /Confirme/);
    const slugs = new Set();
    for (const model of VEHICLE_SEED) {
      assert.ok(!slugs.has(model.slug), `slug repetido: ${model.slug}`); slugs.add(model.slug);
      assert.ok(model.versions.length >= 1);
      for (const v of model.versions) {
        const { specs, errors } = cleanSpecs(v.specs);
        assert.deepEqual(errors, [], `${model.slug} ${v.name}`);
        assert.deepEqual(Object.keys(specs).sort(), Object.keys(v.specs).sort(), `${model.slug} ${v.name}: chave desconhecida`);
        for (const k of Object.keys(v.specs)) assert.ok(SPEC_BY_KEY.has(k), k);
        // sanidade física: potência, torque e dimensões plausíveis
        assert.ok(specs.power_hp >= 40 && specs.power_hp <= 400, `${model.slug} potência`);
        assert.ok(specs.length_mm > specs.wheelbase_mm, `${model.slug} entre-eixos maior que o comprimento`);
        assert.ok(specs.weight_kg > 500 && specs.weight_kg < 3000, `${model.slug} peso`);
        // consumo: flex traz gasolina+etanol; diesel traz diesel
        if (v.fuel === 'Diesel') assert.ok(specs.cons_city_diesel_kml && specs.cons_road_diesel_kml);
        else assert.ok(specs.cons_city_gas_kml && specs.cons_city_eth_kml && specs.cons_city_gas_kml > specs.cons_city_eth_kml, `${model.slug} etanol rende menos`);
      }
    }
  });
});

describe('guia de veículos: migration 020 no banco', integration, () => {
  let server; let pool; let seed;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    seed = (await import('../dist/data/vehicleSeed.js')).VEHICLE_SEED;
    server = await startServer();
  });
  after(async () => { await server?.stop(); await pool?.end(); });

  it('modelos publicados, com fonte e sem opiniões', async () => {
    const r = await pool.query(`SELECT slug, status, spec_source, review, pros, cons FROM vehicle_models WHERE slug = ANY($1)`, [seed.map((m) => m.slug)]);
    assert.equal(r.rowCount, seed.length);
    for (const row of r.rows) {
      assert.equal(row.status, 'PUBLISHED');
      assert.match(row.spec_source, /fichacompleta/);
      assert.equal(row.review, '');
      assert.deepEqual(row.pros, []);
      assert.deepEqual(row.cons, []);
    }
    const ops = await pool.query(`SELECT count(*)::int AS n FROM vehicle_opinions o JOIN vehicle_models m ON m.id=o.model_id WHERE m.slug = ANY($1)`, [seed.map((m) => m.slug)]);
    assert.equal(ops.rows[0].n, 0);
  });

  it('a API pública lista, busca por marca e devolve a fonte na ficha', async () => {
    const list = await (await server.request('/api/vehicles?search=toyota')).json();
    assert.ok(list.items.some((m) => m.slug === 'toyota-corolla'));
    assert.ok(list.items.some((m) => m.slug === 'toyota-hilux'));
    const detail = await (await server.request('/api/vehicles/fiat-toro')).json();
    assert.match(detail.specSource, /Confirme/);
    assert.equal(detail.versions.length, 1);
    assert.equal(detail.versions[0].highlights.power_hp, 180);
  });

  it('reaplicar a carga não duplica nem sobrescreve o que a equipe editou', async () => {
    await pool.query(`UPDATE vehicle_models SET summary='Editado pela equipe' WHERE slug='fiat-mobi'`);
    const { placaMigrations } = await import('../dist/migrations.placanamao.js');
    const m = placaMigrations.find((x) => x.id === '020_vehicle_seed');
    const client = await pool.connect();
    try { await m.up(client); await m.up(client); } finally { client.release(); }
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM vehicle_models WHERE slug = ANY($1)`, [seed.map((x) => x.slug)])).rows[0].n, seed.length);
    assert.equal((await pool.query(`SELECT summary FROM vehicle_models WHERE slug='fiat-mobi'`)).rows[0].summary, 'Editado pela equipe');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE m.slug='chevrolet-onix'`)).rows[0].n, 2);
  });
});

describe('SEO do simulador', () => {
  it('páginas do simulador têm título próprio e entram no sitemap', async () => {
    const { renderSeoHtml, renderSitemapXml, SITEMAP_PATHS } = await import('../dist/seo.js');
    const tpl = '<html><head><title>x</title><meta name="description" content="x" /><link rel="canonical" href="x" /><meta name="robots" content="x" /></head><body></body></html>';
    for (const p of ['/simulador', '/simulador/carro', '/simulador/moto', '/simulador/caminhao', '/simulador/utilitario']) {
      assert.ok(SITEMAP_PATHS.includes(p), p);
      const html = renderSeoHtml(tpl, p, 'https://placanamao.com.br');
      assert.match(html, /<title>[^<]*imulador de financiamento/i);
      assert.match(html, new RegExp(`canonical" href="https://placanamao.com.br${p}"`));
      assert.match(html, /index,follow/);
    }
    assert.match(renderSitemapXml('https://placanamao.com.br'), /\/simulador\/caminhao/);
  });
});
