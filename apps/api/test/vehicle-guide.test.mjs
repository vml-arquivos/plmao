import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

describe('guia de veículos: regras de ficha, comparação e placa→modelo', () => {
  it('cleanSpecs normaliza números/booleanos e descarta o que não é campo', async () => {
    const { cleanSpecs } = await import('../dist/lib/vehicleSpecs.js');
    const { specs, errors } = cleanSpecs({ power_hp: '150,5', trunk_l: 'abc', abs: 'Sim', esc: 'não', engine: ' 1.4 Turbo ', inexistente: 'x', gears: '' });
    assert.deepEqual(specs, { power_hp: 150.5, abs: true, esc: false, engine: '1.4 Turbo' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Porta-malas/);
    assert.equal(cleanSpecs({ cons_city_gas_kml: '1.234,5' }).errors.length, 1); // 1234,5 km/l passa do limite do campo
  });

  it('computeWinners: menor é melhor em aceleração, empate e valor ausente não geram vencedor', async () => {
    const { computeWinners, bestIndexes } = await import('../dist/lib/vehicleSpecs.js');
    const w = computeWinners([
      { power_hp: 120, accel_0_100_s: 11, trunk_l: 300, abs: true },
      { power_hp: 150, accel_0_100_s: 9.5, trunk_l: 300, abs: true },
      { power_hp: 150 }
    ]);
    assert.deepEqual(w.power_hp, [1, 2]);
    assert.deepEqual(w.accel_0_100_s, [1]);
    assert.equal(w.trunk_l, undefined); // empate total
    assert.equal(w.abs, undefined);
    assert.deepEqual(bestIndexes([4.5, null, 3.9], 'high'), [0]);
    assert.deepEqual(bestIndexes([4.5], 'high'), []);
  });

  it('scoreModelMatch: a marca precisa bater e o nome do modelo precisa estar contido', async () => {
    const { scoreModelMatch } = await import('../dist/lib/vehicleSpecs.js');
    const target = { brand: 'CHEVROLET', model: 'TRACKER PREMIER 1.4 TURBO' };
    assert.ok(scoreModelMatch(target, { brand: 'Chevrolet', name: 'Tracker' }) > 0);
    assert.equal(scoreModelMatch(target, { brand: 'Fiat', name: 'Tracker' }), 0);
    assert.equal(scoreModelMatch(target, { brand: 'Chevrolet', name: 'Onix' }), 0);
    assert.ok(scoreModelMatch(target, { brand: 'Chevrolet', name: 'Tracker Premier' }) > scoreModelMatch(target, { brand: 'Chevrolet', name: 'Tracker' }));
  });

  it('publicAuthorName mostra só o primeiro nome e a inicial do último', async () => {
    useTestEnv();
    const { publicAuthorName } = await import('../dist/routes/vehicles.js');
    assert.equal(publicAuthorName('maria da SILVA santos'), 'Maria S.');
    assert.equal(publicAuthorName('Pedro'), 'Pedro');
    assert.equal(publicAuthorName(''), 'Dono verificado');
  });
});

describe('guia de veículos: API pública e painel', integration, () => {
  let pool; let server; let cont; let op; let tokenA; let tokenB;
  const pub = (path, opts = {}) => hostRequest(server.base, path, opts);
  let modelA; let modelB; let verA; let verB; let verC; let slugA;

  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    await pool.query(`DELETE FROM vehicle_models WHERE brand LIKE 'TESTE%'`);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    cont = await adminSession({ server, pool, role: 'CONTEUDO' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
    const reg = (n) => pub('/api/auth/register', { method: 'POST', body: { name: n, email: `${uid('vg')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    tokenA = (await reg('Ana Clara Souza')).json.token;
    tokenB = (await reg('Bruno Lima')).json.token;
  });
  after(async () => { await pool.query(`DELETE FROM vehicle_models WHERE brand LIKE 'TESTE%'`); await server.stop(); await pool.end(); });

  it('só quem tem MANAGE_CONTENT mexe no guia', async () => {
    assert.equal((await op.call('/api/admin/vehicles')).status, 403);
    assert.equal((await op.call('/api/admin/vehicles/opinions')).status, 403);
    assert.equal((await cont.call('/api/admin/vehicles')).status, 200);
    assert.equal((await pub('/api/admin/vehicles', { host: 'www.placanamao.test' })).status, 404);
  });

  it('cria modelos e versões com ficha, valida specs e URL de imagem, e rascunho não aparece no público', async () => {
    const a = await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'TESTE Chevrolet', name: 'Tracker', vehicleType: 'CAR', bodyType: 'SUV', yearFrom: 2013, summary: 'SUV compacto de teste.', review: '## Resumo\nTexto de teste do review.', pros: ['Espaçoso', 'Bom custo-benefício'], cons: ['Consumo'], buyerTips: 'Veja o histórico de revisões.' } });
    assert.equal(a.status, 201, a.text);
    modelA = a.json.model.id; slugA = a.json.model.slug;
    assert.equal(slugA, 'teste-chevrolet-tracker');
    // slug único mesmo repetindo o nome
    const again = await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'TESTE Chevrolet', name: 'Tracker' } });
    assert.equal(again.json.model.slug, 'teste-chevrolet-tracker-2');
    await cont.call(`/api/admin/vehicles/${again.json.model.id}`, { method: 'DELETE' });
    assert.equal((await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'TESTE X', name: 'Y', imageUrl: 'http://inseguro.com/a.jpg' } })).status, 400);

    const b = await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'TESTE Hyundai', name: 'Creta', bodyType: 'SUV', summary: 'Outro SUV de teste.', status: 'PUBLISHED' } });
    modelB = b.json.model.id;

    const bad = await cont.call(`/api/admin/vehicles/${modelA}/versions`, { method: 'POST', body: { name: 'Ruim', specs: { power_hp: 'x', trunk_l: 'y' } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, 'INVALID_SPECS');
    assert.equal(bad.json.details.length, 2);

    const mk = async (model, body) => { const r = await cont.call(`/api/admin/vehicles/${model}/versions`, { method: 'POST', body }); assert.equal(r.status, 201, r.text); return r.json.version.id; };
    verA = await mk(modelA, { name: 'Premier 1.4 Turbo', yearModel: 2018, fuel: 'Flex', fipeCode: '004000-0', specs: { engine: '1.4 Turbo', power_hp: 153, torque_kgfm: 24.5, accel_0_100_s: '9,2', cons_city_gas_kml: 10.8, trunk_l: 306, abs: 'sim', airbags: 6 } });
    verB = await mk(modelB, { name: 'Pulse 1.0 Turbo', yearModel: 2022, specs: { engine: '1.0 Turbo', power_hp: 125, accel_0_100_s: 10.4, cons_city_gas_kml: 11.9, trunk_l: 431, abs: true, airbags: 2 } });
    verC = await mk(modelB, { name: 'Limited 1.6', yearModel: 2020, specs: { power_hp: 123, trunk_l: 431 } });
    // versão repetida
    assert.equal((await cont.call(`/api/admin/vehicles/${modelA}/versions`, { method: 'POST', body: { name: 'premier 1.4 turbo', yearModel: 2018 } })).status, 409);

    const list = await pub('/api/vehicles');
    assert.ok(!list.json.items.some((i) => i.slug === slugA)); // ainda rascunho
    assert.ok(list.json.items.some((i) => i.brand === 'TESTE Hyundai'));
  });

  it('fipe-match liga o nome da FIPE à ficha (marca e começo do modelo) e a ficha do Civic tem descrição', async () => {
    const hit = await pub('/api/vehicles/fipe-match?brand=Honda&model=Civic Sedan Hybrid 2.0 16V');
    assert.equal(hit.status, 200);
    assert.deepEqual(hit.json.items.map((i) => i.slug), ['honda-civic']);
    assert.match(hit.json.items[0].summary, /18,3 km\/l/);
    assert.deepEqual((await pub('/api/vehicles/fipe-match?brand=GM - Chevrolet&model=Civic 2.0')).json.items, []);
    assert.deepEqual((await pub('/api/vehicles/fipe-match?brand=Honda&model=Civics 2.0')).json.items, []); // palavra inteira, não prefixo
    assert.equal((await pub('/api/vehicles/fipe-match?brand=Honda')).status, 400);
  });

  it('publicar libera busca por texto, marca e tipo; visitante vê só o resumo da ficha', async () => {
    assert.equal((await cont.call(`/api/admin/vehicles/${modelA}`, { method: 'PATCH', body: { status: 'PUBLISHED' } })).status, 200);
    const byText = await pub('/api/vehicles?search=tracker premier');
    assert.deepEqual(byText.json.items.map((i) => i.slug).filter((x) => x.startsWith('teste-')), [slugA]); // casa pelo nome da versão (a carga inicial tem outro Tracker)
    assert.equal((await pub('/api/vehicles?brand=teste hyundai')).json.items.length, 1);
    assert.equal((await pub('/api/vehicles?type=MOTORCYCLE&search=TESTE')).json.items.length, 0);
    assert.equal((await pub('/api/vehicles?search=%25')).status, 200); // curinga literal, sem erro
    const brands = await pub('/api/vehicles/brands');
    assert.ok(brands.json.brands.some((b) => b.brand === 'TESTE Chevrolet'));

    const guest = await pub(`/api/vehicles/${slugA}`);
    assert.equal(guest.status, 200);
    assert.equal(guest.json.locked, true);
    assert.equal(guest.json.review, undefined);
    assert.equal(guest.json.buyerTips, undefined);
    assert.equal(guest.json.versions[0].specs, undefined);
    assert.equal(guest.json.versions[0].highlights.power_hp, 153);
    assert.equal(guest.json.pros.length, 2);

    const full = await pub(`/api/vehicles/${slugA}`, { token: tokenA });
    assert.equal(full.json.locked, false);
    assert.match(full.json.review, /Texto de teste/);
    assert.equal(full.json.versions[0].specs.accel_0_100_s, 9.2);
    assert.equal(full.json.versions[0].specs.abs, true);
    assert.equal((await pub('/api/vehicles/nao-existe')).status, 404);
  });

  it('opinões: exigem conta, passam por moderação, só entram na nota quando aprovadas e escondem dados pessoais', async () => {
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`)).status, 401);
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', body: { rating: 5 } })).status, 401);
    const body = { rating: 4, versionId: verA, ratings: { comfort: 5, economy: 3 }, title: 'Muito bom', liked: 'Espaço e conforto na estrada.', disliked: 'Consome um pouco na cidade.', ownerSince: 2019, km: 45000 };
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body: { ...body, liked: 'curto', disliked: '' } })).json.error, 'OPINION_TOO_SHORT');
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body: { ...body, comment: 'veja www.golpe.com' } })).json.error, 'OPINION_LINKS_NOT_ALLOWED');
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body: { ...body, rating: 6 } })).status, 400);
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body: { ...body, versionId: verB } })).json.error, 'VERSION_NOT_FOUND'); // versão de outro modelo
    const sent = await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body });
    assert.equal(sent.status, 201, sent.text);
    assert.equal(sent.json.opinion.status, 'PENDING');

    // pendente: não aparece na lista nem na nota
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { token: tokenB })).json.total, 0);
    assert.equal((await pub(`/api/vehicles/${slugA}`, { token: tokenB })).json.rating.count, 0);
    assert.equal((await pub(`/api/vehicles/${slugA}`, { token: tokenA })).json.myOpinion.status, 'PENDING');

    // moderação
    const queue = await cont.call('/api/admin/vehicles/opinions?status=PENDING');
    const item = queue.json.items.find((i) => i.model.id === modelA);
    assert.ok(item);
    assert.equal(item.author.name, 'Ana Clara Souza');
    assert.equal((await op.call(`/api/admin/vehicles/opinions/${item.id}/approve`, { method: 'POST' })).status, 403);
    assert.equal((await cont.call(`/api/admin/vehicles/opinions/${item.id}/approve`, { method: 'POST' })).status, 200);

    const shown = await pub(`/api/vehicles/${slugA}/opinions`, { token: tokenB });
    assert.equal(shown.json.total, 1);
    assert.equal(shown.json.items[0].author, 'Ana S.');
    assert.equal(JSON.stringify(shown.json).includes('cliente.local'), false);
    assert.equal(shown.json.items[0].versionName, 'Premier 1.4 Turbo');
    const detail = await pub(`/api/vehicles/${slugA}`, { token: tokenB });
    assert.equal(detail.json.rating.count, 1);
    assert.equal(detail.json.rating.average, 4);
    assert.equal(detail.json.rating.categories.comfort, 5);
    assert.equal(detail.json.rating.categories.economy, 3);
    assert.equal(detail.json.rating.categories.finish, null);

    // editar volta para a fila; segunda opinião do mesmo usuário substitui a primeira
    const edit = await pub(`/api/vehicles/${slugA}/opinions`, { method: 'POST', token: tokenA, body: { ...body, rating: 2 } });
    assert.equal(edit.json.opinion.status, 'PENDING');
    assert.equal((await pub(`/api/vehicles/${slugA}`, { token: tokenB })).json.rating.count, 0);
    const rows = await pool.query('SELECT count(*)::int AS n FROM vehicle_opinions WHERE model_id=$1', [modelA]);
    assert.equal(rows.rows[0].n, 1);

    // rejeitar com motivo: o dono vê o motivo, o público não vê
    const again = (await cont.call('/api/admin/vehicles/opinions?status=PENDING')).json.items.find((i) => i.model.id === modelA);
    assert.equal((await cont.call(`/api/admin/vehicles/opinions/${again.id}/reject`, { method: 'POST', body: { reason: 'Fora do tema' } })).status, 200);
    const mine = (await pub(`/api/vehicles/${slugA}`, { token: tokenA })).json.myOpinion;
    assert.equal(mine.status, 'REJECTED');
    assert.equal(mine.rejectReason, 'Fora do tema');
    assert.equal((await pub(`/api/vehicles/${slugA}/opinions`, { token: tokenB })).json.total, 0);
    // não dá para apagar modelo com opiniões; arquivar tira do público
    assert.equal((await cont.call(`/api/admin/vehicles/${modelA}`, { method: 'DELETE' })).json.error, 'VEHICLE_HAS_OPINIONS');
  });

  it('comparador: exige conta, 2 a 3 versões distintas, destaca vencedores e inclui notas dos donos', async () => {
    // reaprova uma opinião para ter nota no modelo A
    const pend = (await cont.call('/api/admin/vehicles/opinions?status=REJECTED')).json.items.find((i) => i.model.id === modelA);
    await pool.query(`UPDATE vehicle_opinions SET status='APPROVED', rating=5 WHERE id=$1`, [pend.id]);
    const q = (ids, token = tokenA) => pub(`/api/vehicles/compare?ids=${ids.join(',')}`, { token });
    const anon = (ids) => pub(`/api/vehicles/compare?ids=${ids.join(',')}`);
    assert.equal((await anon([verA, verB])).status, 401);
    assert.equal((await q([verA])).json.error, 'COMPARE_NEEDS_2_OR_3');
    assert.equal((await q([verA, verA])).json.error, 'COMPARE_NEEDS_2_OR_3');
    assert.equal((await q([verA, 'nao-e-uuid'])).json.error, 'COMPARE_NEEDS_2_OR_3');
    const r = await q([verA, verB, verC]);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.items.length, 3);
    assert.equal(r.json.items[0].label, 'TESTE Chevrolet Tracker Premier 1.4 Turbo 2018');
    assert.deepEqual(r.json.winners.power_hp, [0]);          // 153 cv
    assert.deepEqual(r.json.winners.accel_0_100_s, [0]);      // C não informou; entre A (9,2) e B (10,4) vence o menor
    assert.deepEqual(r.json.winners.trunk_l, [1, 2]);         // empate no maior porta-malas
    assert.deepEqual(r.json.winners.cons_city_gas_kml, [1]);  // maior km/l
    assert.deepEqual(r.json.winners.airbags, [0]);
    assert.equal(r.json.winners.engine, undefined);           // texto não tem vencedor
    assert.equal(r.json.items[0].rating.average, 5);
    assert.equal(r.json.ratingWinners.overall, undefined);    // só A tem nota
    assert.equal(r.json.items[2].specs.power_hp, 123);
    assert.equal((await q([verA, '00000000-0000-4000-8000-000000000000'])).json.error, 'COMPARE_VEHICLE_NOT_FOUND');
  });

  it('busca de versões para o comparador e dicas públicas', async () => {
    const s = await pub('/api/vehicles/search-versions?q=creta pulse');
    assert.equal(s.json.items.length, 1);
    assert.equal(s.json.items[0].versionId, verB);
    const all = await pub('/api/vehicles/search-versions?q=teste');
    assert.ok(all.json.items.length >= 3);

    const lab = await pub(`/api/vehicles/version-labels?ids=${verB}`);
    assert.equal(lab.json.items.length, 1);
    assert.equal(lab.json.items[0].versionId, verB);
    assert.match(lab.json.items[0].label, /Pulse/i);
    assert.ok(lab.json.items[0].slug);
    assert.equal((await pub('/api/vehicles/version-labels?ids=nao-e-uuid')).status, 400);
    assert.deepEqual((await pub('/api/vehicles/version-labels')).json.items, []);

    const t = await cont.call('/api/admin/vehicles/tips', { method: 'POST', body: { category: 'CUIDADOS', title: 'TESTE Troque o óleo no prazo', body: 'Siga o **manual**.', status: 'PUBLISHED' } });
    assert.equal(t.status, 201, t.text);
    const draft = await cont.call('/api/admin/vehicles/tips', { method: 'POST', body: { category: 'COMPRA', title: 'TESTE rascunho' } });
    const tips = await pub('/api/vehicles/tips');
    assert.ok(tips.json.tips.some((x) => x.title === 'TESTE Troque o óleo no prazo'));
    assert.ok(!tips.json.tips.some((x) => x.title === 'TESTE rascunho'));
    assert.equal(tips.json.tips.find((x) => x.id === t.json.tip.id).categoryLabel, 'Cuidados no dia a dia');
    assert.equal((await cont.call(`/api/admin/vehicles/tips/${t.json.tip.id}/archive`, { method: 'POST', body: { archived: true } })).status, 200);
    assert.ok(!(await pub('/api/vehicles/tips')).json.tips.some((x) => x.id === t.json.tip.id));
    assert.equal((await cont.call(`/api/admin/vehicles/tips/${t.json.tip.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await cont.call(`/api/admin/vehicles/tips/${draft.json.tip.id}`, { method: 'DELETE' })).status, 200);
  });

  it('importação por planilha: prévia não grava, confirmação grava como rascunho e relata erros por linha', async () => {
    const csv = [
      'marca;modelo;tipo;carroceria;versao;ano;combustivel;engine;power_hp;trunk_l;abs',
      'TESTE Importada;Alfa;carro;Hatch;1.0 Flex;2021;Flex;1.0 12V;77;285;sim',
      'TESTE Importada;Alfa;carro;Hatch;1.6 Flex;2021;Flex;1.6 16V;120;285;não',
      'TESTE Importada;Beta;moto;Street;150;2020;Gasolina;;12,5;;',
      'TESTE Importada;Gama;carro;Sedã;Sem ano;abc;;;;;',
      'TESTE Importada;Delta;carro;Sedã;Ruim;2020;;;mil;;'
    ].join('\r\n');
    const dry = await cont.call('/api/admin/vehicles/import', { method: 'POST', body: { csv, dryRun: true } });
    assert.equal(dry.status, 200, dry.text);
    assert.equal(dry.json.modelsNew, 2);
    assert.equal(dry.json.versionsNew, 3);
    assert.equal(dry.json.errors.length, 2);
    assert.deepEqual(dry.json.errors.map((e) => e.line), [5, 6]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM vehicle_models WHERE brand='TESTE Importada'`)).rows[0].n, 0);

    const real = await cont.call('/api/admin/vehicles/import', { method: 'POST', body: { csv, dryRun: false } });
    assert.equal(real.json.versionsNew, 3);
    const rows = await pool.query(`SELECT m.status, m.vehicle_type, v.name, v.specs FROM vehicle_models m JOIN vehicle_versions v ON v.model_id=m.id WHERE m.brand='TESTE Importada' ORDER BY v.name`);
    assert.equal(rows.rowCount, 3);
    assert.ok(rows.rows.every((r) => r.status === 'DRAFT'));
    assert.equal(rows.rows.find((r) => r.name === '150').vehicle_type, 'MOTORCYCLE');
    assert.equal(rows.rows.find((r) => r.name === '150').specs.power_hp, 12.5);
    assert.equal(rows.rows.find((r) => r.name === '1.6 Flex').specs.abs, false);
    // reimportar atualiza em vez de duplicar
    const second = await cont.call('/api/admin/vehicles/import', { method: 'POST', body: { csv, dryRun: false } });
    assert.equal(second.json.versionsNew, 0);
    assert.equal(second.json.versionsUpdated, 3);
    assert.equal((await cont.call('/api/admin/vehicles/import', { method: 'POST', body: { csv: 'marca;outra\r\nFulana;coisa', dryRun: true } })).json.error, 'IMPORT_MISSING_COLUMNS');
    const tpl = await cont.call('/api/admin/vehicles/import/template.csv');
    assert.match(tpl.text, /marca;modelo;tipo;carroceria;versao;ano/);
  });

  it('por placa: exige conta, valida formato e devolve o veículo identificado com possíveis fichas', async () => {
    assert.equal((await pub('/api/vehicles/by-plate', { method: 'POST', body: { plate: 'ABC1D23' } })).status, 401);
    assert.equal((await pub('/api/vehicles/by-plate', { method: 'POST', token: tokenA, body: { plate: '123' } })).json.error, 'INVALID_PLATE');
    // placa fora da base de teste
    assert.equal((await pub('/api/vehicles/by-plate', { method: 'POST', token: tokenB, body: { plate: 'ZZZ9Z99' } })).json.error, 'FIPE_PLATE_NOT_FOUND');
    // placa do sandbox (ALFA AUTO / URBAN 1.6): casa com a ficha cadastrada da mesma marca/modelo
    await pool.query(`DELETE FROM vehicle_models WHERE brand='ALFA AUTO' AND name='Urban'`);
    const m = await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'ALFA AUTO', name: 'Urban', status: 'PUBLISHED' } });
    const other = await cont.call('/api/admin/vehicles', { method: 'POST', body: { brand: 'ALFA AUTO', name: 'Outro', status: 'PUBLISHED' } });
    await cont.call(`/api/admin/vehicles/${m.json.model.id}/versions`, { method: 'POST', body: { name: '1.6 Flex', yearModel: 2020 } });
    try {
      const r = await pub('/api/vehicles/by-plate', { method: 'POST', token: tokenB, body: { plate: 'DEV1B11' } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.vehicle.plate, 'DEV1B11');
      assert.deepEqual(r.json.matches.map((x) => x.name), ['Urban']);
      assert.equal(r.json.matches[0].versions.length, 1);
    } finally {
      await pool.query(`DELETE FROM vehicle_models WHERE id = ANY($1::uuid[])`, [[m.json.model.id, other.json.model.id]]);
    }
  });

  it('arquivar tira do público; restaurar não republica sozinho; apagar só sem opiniões; sitemap lista só publicados', async () => {
    assert.equal((await cont.call(`/api/admin/vehicles/${modelB}/archive`, { method: 'POST', body: { archived: true } })).status, 200);
    assert.equal((await pub('/api/vehicles/teste-hyundai-creta')).status, 404);
    assert.ok(!(await pub('/api/vehicles?search=creta')).json.items.some((i) => i.slug.startsWith('teste-')));
    const archivedList = await cont.call('/api/admin/vehicles?view=archived');
    assert.ok(archivedList.json.items.some((i) => i.id === modelB));
    assert.equal((await cont.call(`/api/admin/vehicles/${modelB}/archive`, { method: 'POST', body: { archived: false } })).status, 200);
    assert.equal((await pub('/api/vehicles/teste-hyundai-creta')).status, 404); // voltou como rascunho
    assert.equal((await cont.call(`/api/admin/vehicles/${modelB}`, { method: 'PATCH', body: { status: 'PUBLISHED' } })).status, 200);
    const sm = await hostRequest(server.base, '/sitemap.xml');
    assert.match(sm.text, /\/veiculos\/teste-hyundai-creta/);
    assert.doesNotMatch(sm.text, /teste-importada/);
    assert.equal((await cont.call(`/api/admin/vehicles/${modelB}`, { method: 'DELETE' })).status, 200);
    assert.equal((await pub('/api/vehicles/teste-hyundai-creta')).status, 404);
    // versões somem junto
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM vehicle_versions WHERE id=$1', [verB])).rows[0].n, 0);
  });
});
