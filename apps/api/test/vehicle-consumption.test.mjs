import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('consumo oficial: dados de partida e carga', () => {
  it('a carga só tem linhas com fonte, rótulo literal e valores plausíveis', async () => {
    const { CONSUMPTION_SEED, HONDA_CIVIC_OBS, INMETRO_PBEV_2024_URL } = await import('../dist/data/consumptionSeed.js');
    const all = [...CONSUMPTION_SEED, HONDA_CIVIC_OBS];
    assert.ok(all.length >= 20);
    for (const o of all) {
      assert.ok(o.versionLabel.length > 2, o.versionLabel);
      assert.ok(o.cityKml > 0 && o.cityKml <= 60 && o.roadKml > 0 && o.roadKml <= 60, o.versionLabel);
      assert.match(o.sourceUrl ?? INMETRO_PBEV_2024_URL, /^https:\/\//);
      assert.ok(['Gasolina', 'Etanol'].includes(o.fuel));
    }
    // híbridos da pesquisa anexada
    const corolla = CONSUMPTION_SEED.find((o) => o.versionLabel.startsWith('ALTIS HV'));
    assert.deepEqual([corolla.fuel, corolla.cityKml, corolla.roadKml], ['Gasolina', 18.5, 15.7]);
    const civic = CONSUMPTION_SEED.find((o) => o.model === 'CIVIC HYBRID');
    assert.deepEqual([civic.cityKml, civic.roadKml], [18.3, 15.9]);
    assert.equal(HONDA_CIVIC_OBS.sourceKind, 'FABRICANTE');
    assert.equal(HONDA_CIVIC_OBS.cityKml, 18.4); // divergência registrada à parte, sem substituir o Inmetro
  });
});

describe('consumo oficial: API pública e painel', integration, () => {
  let server; let pool; let cont; let op;
  const pub = (path, opts) => hostRequest(server.base, path, opts);
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    await pool.query(`DELETE FROM vehicle_consumption_obs WHERE brand LIKE 'TESTE%'`);
    await pool.query(`DELETE FROM vehicle_models WHERE brand LIKE 'TESTE%'`);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    cont = await adminSession({ server, pool, role: 'CONTEUDO' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => {
    await pool?.query(`DELETE FROM vehicle_consumption_obs WHERE brand LIKE 'TESTE%'`);
    await pool?.query(`DELETE FROM vehicle_models WHERE brand LIKE 'TESTE%'`);
    await server?.stop(); await pool?.end();
  });

  it('a migration publica o Civic e o Corolla híbrido com o consumo do Inmetro e a divergência da Honda', async () => {
    const civic = await pub('/api/vehicles/honda-civic');
    assert.equal(civic.status, 200);
    const j = civic.json;
    const inm = j.consumption.find((o) => o.sourceKind === 'INMETRO');
    const hon = j.consumption.find((o) => o.sourceKind === 'FABRICANTE');
    assert.deepEqual([inm.fuel, inm.cityKml, inm.roadKml, inm.cycle], ['Gasolina', 18.3, 15.9, 'PBEV 2024']);
    assert.match(inm.sourceUrl, /^https:\/\/www\.gov\.br\/inmetro\//);
    assert.deepEqual([hon.cityKml, hon.roadKml], [18.4, 15.9]);
    assert.ok(j.versions.length >= 1);
    const corolla = (await pub('/api/vehicles/toyota-corolla')).json;
    const hv = corolla.consumption.find((o) => o.versionLabel.startsWith('ALTIS HV'));
    assert.deepEqual([hv.cityKml, hv.roadKml], [18.5, 15.7]);
    assert.ok(corolla.versions.some((v) => v.name === 'Altis Hybrid 1.8'));
  });

  it('o ranking de economia traz os números por versão e marca o que foi conferido com o Inmetro', async () => {
    const r = (await pub('/api/vehicles/economy')).json;
    const mobi = r.items.find((e) => e.slug === 'fiat-mobi');
    assert.equal(mobi.cityGasKml, 13.5); assert.equal(mobi.roadGasKml, 15); assert.equal(mobi.official, true);
    const xei = r.items.find((e) => e.slug === 'toyota-corolla' && e.version === 'XEi 2.0');
    assert.deepEqual([xei.cityGasKml, xei.roadGasKml, xei.cityEthKml, xei.roadEthKml], [12.3, 14.9, 8.6, 10.7]); // corrigido pelo Inmetro
    const hybrid = r.items.find((e) => e.version === 'Altis Hybrid 1.8');
    assert.equal(hybrid.cityGasKml, 18.5);
    assert.ok(r.items.every((e) => e.cityGasKml == null || (e.cityGasKml > 0 && e.cityGasKml <= 60)));
  });

  it('a lista do guia traz os destaques de cada modelo', async () => {
    const r = (await pub('/api/vehicles?limit=60')).json;
    const mobi = r.items.find((m) => m.slug === 'fiat-mobi');
    assert.equal(mobi.quick.cityGasKml, 13.5);
    assert.equal(mobi.officialConsumption, true);
    assert.ok(Object.hasOwn(mobi.quick, 'powerHp'));
  });

  it('importação: prévia não grava, nada entra no site antes da conferência, erros por linha', async () => {
    const m = await pool.query(`INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,status) VALUES('teste-consumo-modelo','TESTE Consumo','Modelo','CAR','Hatch','PUBLISHED') RETURNING id`);
    assert.ok(m.rowCount);
    const csv = [
      'id,marca,modelo,ano_modelo,versao_pbev,segmento_pbev,propulsao,combustivel_comparado,consumo_urbano_km_l,consumo_rodoviario_km_l,unidade_consumo,fonte_consumo,ciclo_pbev,observacoes',
      'T1,TESTE Consumo,Modelo,NA,"VERSÃO A 1.0",Compacto,Combustão,Gasolina,"13,5",15.0,km/l,https://www.gov.br/inmetro/pbe-teste.pdf,PBEV 2024,"observação"',
      'T2,TESTE Consumo,Modelo,NA,"VERSÃO B",Compacto,Combustão,Gasolina,abc,15.0,km/l,https://www.gov.br/inmetro/pbe-teste.pdf,PBEV 2024,',
      'T3,TESTE Consumo,Modelo,NA,"VERSÃO C",Compacto,Combustão,Gasolina,10,12,mpg,https://www.gov.br/inmetro/pbe-teste.pdf,PBEV 2024,',
      'T4,TESTE Consumo,Modelo,NA,"VERSÃO D",Compacto,Combustão,Gasolina,10,12,km/l,http://exemplo.com/x,PBEV 2024,',
      'T5,TESTE Consumo,Modelo,NA,"VERSÃO E",Compacto,Combustão,Hidrogênio,10,12,km/l,https://www.gov.br/inmetro/pbe-teste.pdf,PBEV 2024,',
      'T6,TESTE Consumo,Modelo,NA,"VERSÃO F",Compacto,Combustão,Etanol,NA,NA,km/l,https://www.gov.br/inmetro/pbe-teste.pdf,PBEV 2024,'
    ].join('\n');
    assert.equal((await op.call('/api/admin/vehicles/consumption/import', { method: 'POST', body: { csv, dryRun: true } })).status, 403);
    const dry = await cont.call('/api/admin/vehicles/consumption/import', { method: 'POST', body: { csv, dryRun: true } });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual([dry.json.created, dry.json.errors.length], [1, 5]);
    assert.equal((await pool.query(`SELECT 1 FROM vehicle_consumption_obs WHERE brand='TESTE Consumo'`)).rowCount, 0);

    const real = await cont.call('/api/admin/vehicles/consumption/import', { method: 'POST', body: { csv, dryRun: false } });
    assert.equal(real.json.created, 1);
    const row = (await pool.query(`SELECT * FROM vehicle_consumption_obs WHERE brand='TESTE Consumo'`)).rows[0];
    assert.equal(row.status, 'A_CONFERIR');
    assert.equal(row.source_kind, 'INMETRO');
    assert.equal(Number(row.city_kml), 13.5);
    assert.ok(row.model_id); // ligou ao modelo pelo slug marca-modelo
    assert.equal((await pub('/api/vehicles/teste-consumo-modelo')).json.consumption.length, 0);

    const patched = await cont.call(`/api/admin/vehicles/consumption/${row.id}`, { method: 'PATCH', body: { status: 'CONFERIDO' } });
    assert.equal(patched.status, 200, patched.text);
    const shown = (await pub('/api/vehicles/teste-consumo-modelo')).json.consumption;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].cityKml, 13.5);
    assert.equal(shown[0].note, 'observação');

    // reenviar não rebaixa nem sobrescreve o que já foi conferido
    const again = await cont.call('/api/admin/vehicles/consumption/import', { method: 'POST', body: { csv, dryRun: false } });
    assert.deepEqual([again.json.created, again.json.updated, again.json.keptConfirmed], [0, 0, 1]);
    assert.equal((await pool.query(`SELECT status FROM vehicle_consumption_obs WHERE id=$1`, [row.id])).rows[0].status, 'CONFERIDO');

    const list = await cont.call('/api/admin/vehicles/consumption?status=CONFERIDO&search=teste');
    assert.equal(list.json.items.length, 1);
    assert.equal((await cont.call(`/api/admin/vehicles/consumption/${row.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await cont.call(`/api/admin/vehicles/consumption/${row.id}`, { method: 'DELETE' })).status, 404);
  });

  it('a calculadora de combustível usa o consumo do próprio carro (ponto de equilíbrio, não 70% fixo)', async () => {
    // mesma regra da tela: etanol compensa se preço_etanol / preço_gasolina <= km/l etanol / km/l gasolina
    const mobi = (await pub('/api/vehicles/economy')).json.items.find((e) => e.slug === 'fiat-mobi');
    const ratio = mobi.cityEthKml / mobi.cityGasKml;
    assert.ok(ratio > 0.6 && ratio < 0.8);
    assert.notEqual(Math.round(ratio * 100), 70);
  });
});
