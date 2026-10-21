import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();

describe('catálogo de frota (Senatran): arquivo de carga e regras de texto', () => {
  it('o seed embutido bate com o arquivo público (nomes, frota total, ano de fabricação separado)', async () => {
    const { readBundledSnapshot } = await import('../dist/lib/catalog.js');
    const snap = readBundledSnapshot();
    assert.equal(snap.snapshot, '2026-09');
    assert.equal(snap.rows.length, 40571);
    assert.equal(snap.total, 136424856);
    assert.equal(snap.rows.reduce((s, r) => s + r.years.reduce((a, [, q]) => a + q, 0), 0), snap.total);
    const gol = snap.rows.find((r) => r.name === 'VW/GOL 1.0');
    assert.ok(gol && gol.years.some(([y]) => y >= 2000 && y <= 2026));
    // ano 0 = "sem ano informado"; nenhum ano fora de 1900–2100
    assert.ok(snap.rows.every((r) => r.years.every(([y]) => y === 0 || (y >= 1900 && y <= 2100))));
  });

  it('normalização de busca: sem acento, "/" e "-" viram espaço, 1,0 vira 1.0', async () => {
    const { normalizeCatalog, searchTerms, likeEscape } = await import('../dist/lib/catalog.js');
    assert.equal(normalizeCatalog('CHEV/ONIX 10MT LT2'), 'chev onix 10mt lt2');
    assert.equal(normalizeCatalog('HONDA/HR-V EXL CVT'), 'honda hr v exl cvt');
    assert.equal(normalizeCatalog('Citroën C3 1,0'), 'citroen c3 1.0');
    assert.deepEqual(searchTerms('  onix   lt  '), ['onix', 'lt']);
    assert.equal(searchTerms('%%__').length, 0);
    assert.equal(likeEscape('50%_x'), '50\\%\\_x');
  });

  it('leitor do CSV: cabeçalho errado e linhas inválidas viram erro, nada é corrigido em silêncio', async () => {
    const { parseSenatranCsv } = await import('../dist/lib/catalog.js');
    const { parseCsv } = await import('../dist/lib/csvParse.js');
    assert.equal(parseSenatranCsv(parseCsv('a;b;c\nX;2020;1')).errors.length, 1);
    const ok = parseSenatranCsv(parseCsv('marca_modelo_original;ano_fabricacao_original;quantidade_veiculos_frota_set_2026\nVW/GOL 1.0;2010;5\nVW/GOL 1.0;Não Identificado;2\nVW/GOL 1.0;2011;x\n;2011;3'));
    assert.equal(ok.errors.length, 2);
    assert.equal(ok.snapshot.total, 7);
    assert.deepEqual(ok.snapshot.rows[0].years, [[0, 2], [2010, 5]]);
  });
});

describe('catálogo de frota: API pública, destaques, interesse e painel', integration, () => {
  let server; let pool; let cont; let op;
  const pub = (path, opts) => hostRequest(server.base, path, opts);
  const sid = (n) => `test-session-${String(n).padStart(8, '0')}`;
  before(async () => {
    useTestEnv();
    ({ pool } = await loadCore());
    await pool.query(`DELETE FROM vehicle_interest_events`);
    server = await startServer({ ADMIN_HOSTS: 'admin.placanamao.test' });
    cont = await adminSession({ server, pool, role: 'CONTEUDO' });
    op = await adminSession({ server, pool, role: 'OPERADOR' });
  });
  after(async () => {
    await pool?.query(`DELETE FROM vehicle_interest_events`);
    await pool?.query(`DELETE FROM vehicle_catalog WHERE snapshot='2099-01'`);
    await pool?.query(`DELETE FROM vehicle_catalog_snapshots WHERE snapshot='2099-01'`);
    await pool?.query(`UPDATE vehicle_models SET featured=false, featured_order=NULL WHERE slug='fiat-mobi'`);
    await server?.stop(); await pool?.end();
  });

  it('a migration carregou o catálogo inteiro e ligou os modelos certos (Onix sem Onix Plus, Corolla sem Corolla Cross)', async () => {
    const t = (await pool.query(`SELECT count(*)::int AS n, sum(fleet_total)::bigint AS f FROM vehicle_catalog WHERE snapshot='2026-09'`)).rows[0];
    assert.equal(t.n, 40571); assert.equal(String(t.f), '136424856');
    const plus = await pool.query(`SELECT m.slug FROM vehicle_catalog c JOIN vehicle_models m ON m.id=c.model_id WHERE c.search_text LIKE '% onix plus %'`);
    assert.ok(plus.rowCount > 0 && plus.rows.every((r) => r.slug === 'chevrolet-onix-sedan'));
    const cross = await pool.query(`SELECT 1 FROM vehicle_catalog c JOIN vehicle_models m ON m.id=c.model_id WHERE m.slug='toyota-corolla' AND c.search_text ~ ' corolla cross'`);
    assert.equal(cross.rowCount, 0);
    const hb = await pool.query(`SELECT 1 FROM vehicle_catalog c JOIN vehicle_models m ON m.id=c.model_id WHERE m.slug='hyundai-hb20' AND c.search_text ~ ' hb20[sx]'`);
    assert.equal(hb.rowCount, 0);
  });

  it('busca: casa por início de palavra, ordena pela frota, mostra o que tem ficha e ignora curinga', async () => {
    const r = await pub('/api/vehicles/catalog/search?q=onix%20lt&limit=10');
    assert.equal(r.status, 200);
    assert.ok(r.json.items.length >= 3 && r.json.items.length <= 10);
    assert.ok(r.json.items.every((i) => /onix/i.test(i.name) && /lt/i.test(i.name)));
    const fleets = r.json.items.map((i) => i.fleet);
    assert.deepEqual(fleets, [...fleets].sort((a, b) => b - a));
    assert.equal(r.json.items[0].guide.slug, 'chevrolet-onix');
    assert.equal(r.json.snapshot.id, '2026-09');
    const gol = (await pub('/api/vehicles/catalog/search?q=gol')).json.items;
    assert.ok(gol.length > 0 && gol.some((i) => i.guide === null));
    assert.deepEqual((await pub('/api/vehicles/catalog/search?q=a')).json.items, []);
    assert.deepEqual((await pub('/api/vehicles/catalog/search?q=%25%25')).json.items, []);
    assert.deepEqual((await pub('/api/vehicles/catalog/search?q=zzzxqj')).json.items, []);
  });

  it('detalhe do veículo da frota: anos de fabricação, fonte e licença; id inválido ou inexistente falha direito', async () => {
    const first = (await pub('/api/vehicles/catalog/search?q=gol%201.0')).json.items[0];
    const d = await pub(`/api/vehicles/catalog/${first.id}`);
    assert.equal(d.status, 200);
    assert.equal(d.json.name, first.name);
    assert.equal(d.json.years.reduce((s, y) => s + y.quantity, 0) + d.json.withoutYear, d.json.fleet);
    assert.ok(d.json.years.every((y, i, a) => i === 0 || a[i - 1].year > y.year));
    assert.match(d.json.source.license, /Domínio Público/);
    assert.equal((await pub('/api/vehicles/catalog/abc')).status, 400);
    assert.equal((await pub('/api/vehicles/catalog/999999999')).status, 404);
  });

  it('destaques: no máximo 6, ordem pela frota, só critérios com dado de verdade, foto com crédito', async () => {
    const r = (await pub('/api/vehicles/featured')).json;
    const frota = r.lists.find((l) => l.key === 'FROTA');
    assert.ok(frota && frota.items.length === 6);
    const fleets = frota.items.map((i) => i.fleet);
    assert.deepEqual(fleets, [...fleets].sort((a, b) => b - a));
    assert.equal(frota.items[0].slug, 'fiat-strada');
    for (const slug of ['fiat-strada', 'chevrolet-onix', 'hyundai-hb20']) {
      const it = frota.items.find((i) => i.slug === slug);
      assert.match(it.imageUrl, /^https:\/\/commons\.wikimedia\.org\//);
      assert.ok(it.imageCredit && it.imageLicense);
    }
    // sem visitas nem opiniões suficientes, não inventamos "mais consultados" nem "mais bem avaliados"
    assert.ok(!r.lists.some((l) => l.key === 'CONSULTADOS' || l.key === 'AVALIADOS'));
    assert.equal((await pub('/api/vehicles/featured?limit=2')).json.lists[0].items.length, 2);
  });

  it('destaque editorial no painel vem primeiro; só quem gerencia conteúdo altera', async () => {
    const mobi = (await pool.query(`SELECT id FROM vehicle_models WHERE slug='fiat-mobi'`)).rows[0].id;
    assert.equal((await op.call(`/api/admin/vehicles/${mobi}`, { method: 'PATCH', body: { featured: true, featuredOrder: 1 } })).status, 403);
    const ok = await cont.call(`/api/admin/vehicles/${mobi}`, { method: 'PATCH', body: { featured: true, featuredOrder: 1 } });
    assert.equal(ok.status, 200, ok.text);
    const frota = (await pub('/api/vehicles/featured')).json.lists[0];
    assert.equal(frota.items[0].slug, 'fiat-mobi'); assert.equal(frota.items[0].editorial, true);
    assert.equal(frota.items.length, 6);
    await cont.call(`/api/admin/vehicles/${mobi}`, { method: 'PATCH', body: { featured: false } });
    assert.equal((await pub('/api/vehicles/featured')).json.lists[0].items[0].slug, 'fiat-strada');
  });

  it('a ficha do modelo traz a frota (Senatran) e o crédito da foto', async () => {
    const j = (await pub('/api/vehicles/fiat-strada')).json;
    assert.ok(j.fleet.total > 2_000_000 && j.fleet.names > 50);
    assert.equal(j.fleet.snapshot, '2026-09');
    assert.equal(j.imageLicense, 'CC BY-SA 4.0');
    assert.match(j.imageSourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  });

  it('interesse: registra escolha e visita, não conta repetição, descarta termo pessoal e valida a entrada', async () => {
    const hit = (await pub('/api/vehicles/catalog/search?q=gol%201.0')).json.items[0];
    const post = (body) => pub('/api/vehicles/interest', { method: 'POST', body });
    assert.equal((await post({ type: 'SIMULATOR_PICK', catalogId: hit.id, sessionId: sid(1) })).status, 202);
    await post({ type: 'SIMULATOR_PICK', catalogId: hit.id, sessionId: sid(1) }); // repetição na mesma visita
    await post({ type: 'SIMULATOR_PICK', catalogId: hit.id, sessionId: sid(2) });
    await post({ type: 'MODEL_VIEW', modelSlug: 'fiat-strada', sessionId: sid(1) });
    await post({ type: 'SEARCH_NO_RESULT', term: 'Fusca Elétrico', sessionId: sid(1) });
    for (const term of ['ABC1D23', 'abc 1234', 'fulano@mail.com', 'ab']) await post({ type: 'SEARCH_NO_RESULT', term, sessionId: sid(3) });
    assert.equal((await post({ type: 'OUTRO', sessionId: sid(1) })).status, 400);
    assert.equal((await post({ type: 'SEARCH_PICK', sessionId: sid(1) })).status, 400);
    assert.equal((await post({ type: 'MODEL_VIEW', modelSlug: 'fiat-strada', sessionId: 'curto' })).status, 400);
    assert.equal((await post({ type: 'MODEL_VIEW', modelSlug: 'fiat-strada', sessionId: sid(1), extra: 1 })).status, 400);
    const rows = (await pool.query(`SELECT event_type, count(*)::int AS n FROM vehicle_interest_events GROUP BY 1`)).rows;
    const n = Object.fromEntries(rows.map((r) => [r.event_type, r.n]));
    assert.deepEqual([n.SIMULATOR_PICK, n.MODEL_VIEW, n.SEARCH_NO_RESULT], [2, 1, 1]);
    assert.equal((await pool.query(`SELECT term FROM vehicle_interest_events WHERE event_type='SEARCH_NO_RESULT'`)).rows[0].term, 'fusca eletrico');
    // sem identificação direta: só o hash da visita
    assert.ok((await pool.query(`SELECT session_key FROM vehicle_interest_events`)).rows.every((r) => /^[0-9a-f]{64}$/.test(r.session_key)));

    assert.equal((await op.call('/api/admin/vehicles/interest')).status, 403);
    const rep = (await cont.call('/api/admin/vehicles/interest?days=30')).json;
    assert.equal(rep.picks[0].count, 2); assert.equal(rep.picks[0].name, hit.name);
    assert.equal(rep.models[0].slug, 'fiat-strada');
    assert.deepEqual(rep.noResult, [{ term: 'fusca eletrico', count: 1 }]);
  });

  it('"mais consultados" só aparece com volume mínimo de visitas em modelos suficientes', async () => {
    const ids = (await pool.query(`SELECT id FROM vehicle_models WHERE slug IN ('fiat-argo','fiat-mobi','fiat-toro') ORDER BY slug`)).rows.map((r) => r.id);
    for (const id of ids) await pool.query(`INSERT INTO vehicle_interest_events(event_type,model_id,session_key) SELECT 'MODEL_VIEW',$1,'s'||g FROM generate_series(1,21) g`, [id]);
    const lists = (await pub('/api/vehicles/featured')).json.lists;
    const c = lists.find((l) => l.key === 'CONSULTADOS');
    assert.ok(c && c.items.length === 3 && c.items.every((i) => i.views >= 20));
    await pool.query(`DELETE FROM vehicle_interest_events`);
    assert.ok(!(await pub('/api/vehicles/featured')).json.lists.some((l) => l.key === 'CONSULTADOS'));
  });

  it('importar snapshot novo: prévia não grava, erros bloqueiam, importação atualiza e religa os modelos', async () => {
    const header = 'marca_modelo_original;ano_fabricacao_original;quantidade_veiculos_frota_jan_2099';
    const good = [header, 'FIAT/STRADA TESTE 2099;2099;10', 'FIAT/STRADA TESTE 2099;2098;5', 'TESTE/NOME NOVO 2099;Não Identificado;3'].join('\n');
    const call = (body) => cont.call('/api/admin/vehicles/catalog/import', { method: 'POST', body });
    assert.equal((await op.call('/api/admin/vehicles/catalog/import', { method: 'POST', body: { csv: good, snapshot: '2099-01', dryRun: true } })).status, 403);
    assert.equal((await call({ csv: good, snapshot: '99-1', dryRun: true })).status, 400);
    const dry = await call({ csv: good, snapshot: '2099-01', dryRun: true });
    assert.equal(dry.status, 200, dry.text);
    assert.deepEqual([dry.json.names, dry.json.fleet, dry.json.newNames, dry.json.errors.length], [2, 18, 2, 0]);
    assert.equal((await pool.query(`SELECT 1 FROM vehicle_catalog WHERE snapshot='2099-01'`)).rowCount, 0);
    const bad = await call({ csv: `${header}\nVW/GOL;2010;abc\nVW/GOL;2011;4`, snapshot: '2099-01', dryRun: false });
    assert.equal(bad.status, 400);
    assert.equal((await pool.query(`SELECT 1 FROM vehicle_catalog WHERE snapshot='2099-01'`)).rowCount, 0);
    const real = await call({ csv: good, snapshot: '2099-01', dryRun: false });
    assert.equal(real.status, 200, real.text);
    const row = (await pool.query(`SELECT c.fleet_total, c.year_min, c.year_max, m.slug FROM vehicle_catalog c LEFT JOIN vehicle_models m ON m.id=c.model_id WHERE c.raw_name='FIAT/STRADA TESTE 2099'`)).rows[0];
    assert.deepEqual([String(row.fleet_total), row.year_min, row.year_max, row.slug], ['15', 2098, 2099, 'fiat-strada']);
    const sum = (await cont.call('/api/admin/vehicles/catalog/summary')).json;
    assert.ok(sum.snapshots.some((s) => s.snapshot === '2099-01'));
    assert.ok(sum.models.find((m) => m.slug === 'fiat-strada').names > 100);
    assert.equal((await cont.call('/api/admin/vehicles/catalog/rematch', { method: 'POST', body: {} })).status, 200);
  });
  it('painel: lista paginada de todos os veículos, filtros, exportação CSV e permissão', async () => {
    assert.equal((await op.call('/api/admin/vehicles/catalog/list')).status, 403);
    assert.equal((await op.call('/api/admin/vehicles/catalog/export')).status, 403);
    const all = (await cont.call('/api/admin/vehicles/catalog/list?pageSize=50')).json;
    assert.ok(all.total >= 40571);
    assert.equal(all.items.length, 50);
    assert.ok(all.items[0].fleet >= all.items[1].fleet, 'padrão: maior frota primeiro');
    assert.ok(all.items[0].years && all.items[0].snapshot);
    const onix = (await cont.call('/api/admin/vehicles/catalog/list?q=' + encodeURIComponent('chev onix') + '&matched=yes')).json;
    assert.ok(onix.total > 5 && onix.items.every((i) => i.guide && /onix/i.test(i.name)));
    const unmatched = (await cont.call('/api/admin/vehicles/catalog/list?matched=no&sort=name&pageSize=10')).json;
    assert.ok(unmatched.items.every((i) => i.guide === null));
    assert.ok(unmatched.items[0].name <= unmatched.items[1].name);
    const page2 = (await cont.call('/api/admin/vehicles/catalog/list?page=2&pageSize=50')).json;
    assert.notEqual(page2.items[0].id, all.items[0].id);
    const csv = await cont.call('/api/admin/vehicles/catalog/export?q=' + encodeURIComponent('chev onix'));
    assert.equal(csv.status, 200);
    assert.match(csv.text, /nome_senatran;frota_total;fabricacao_de/);
    assert.match(csv.text, /CHEV\/ONIX/);
  });

  it('comparador: árvore marca > modelo > versão do guia', async () => {
    const r = await pub('/api/vehicles/version-tree');
    assert.equal(r.status, 200);
    const brands = r.json.brands;
    assert.ok(brands.length > 3);
    const any = brands[0].models[0];
    assert.ok(any.slug && any.versions.length > 0 && any.versions[0].id);
  });
});
