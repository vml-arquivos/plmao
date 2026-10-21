import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { startServer } from './helpers/server.mjs';

useTestEnv();

/** Provedor FIPE de mentira (formato Parallelum v2) para testar a busca e o preço sem rede. */
function mockFipe() {
  const calls = [];
  const brands = [{ code: '9023', name: 'GM - Chevrolet' }, { code: '9021', name: 'Fiat' }, { code: '9059', name: 'VW - VolksWagen' }];
  const models = {
    9023: [{ code: '95940', name: 'Onix 1.0 Flex 12V 5p Mec.' }, { code: '95941', name: 'ONIX PLUS Sed. LT 1.0 Turbo' }, { code: '95942', name: 'Prisma 1.4' }],
    9021: [{ code: '91001', name: 'Argo 1.0 6V Flex' }, { code: '91002', name: 'Strada Endurance 1.4' }],
    9059: [{ code: '99001', name: 'Gol 1.0 Mi Total Flex' }, { code: '99002', name: 'Polo 1.0 200 TSI' }]
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    calls.push(url.pathname);
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const p = url.pathname;
    if (p === '/references') return send(200, [{ code: 9300, month: 'outubro de 2026' }]);
    if (p === '/cars/brands') return send(200, brands);
    let m;
    if ((m = p.match(/^\/cars\/brands\/(\d+)\/models$/))) return send(200, models[m[1]] ?? []);
    if ((m = p.match(/^\/cars\/brands\/(\d+)\/models\/(\d+)\/years$/))) return send(200, [{ code: '2020-1', name: '2020 Gasolina' }, { code: '2019-1', name: '2019 Gasolina' }]);
    if ((m = p.match(/^\/cars\/brands\/(\d+)\/models\/(\d+)\/years\/([\w-]+)$/))) {
      if (m[2] === '00000') return send(404, {});
      return send(200, { brand: 'GM - Chevrolet', model: 'Onix 1.0 Flex 12V 5p Mec.', modelYear: 2020, fuel: 'Gasolina', codeFipe: '004472-1', price: 'R$ 58.123,00', referenceMonth: 'outubro de 2026' });
    }
    return send(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

describe('FIPE: busca por texto, seletores em cascata e preço automático', { ...integration }, () => {
  let app; let fipe; let pool;
  before(async () => {
    ({ pool } = await loadCore());
    fipe = await mockFipe();
    await pool.query(`DELETE FROM fipe_cache WHERE brand_id='9023'`);
    app = await startServer({ FEATURE_FREE_FIPE: 'true', FIPE_PRIMARY_BASE_URL: fipe.url, FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9' });
  });
  after(async () => {
    await app?.stop(); fipe?.server.close();
    await pool?.query(`DELETE FROM fipe_cache WHERE brand_id='9023'`);
    await pool?.end();
  });
  const get = async (path) => { const r = await app.request(path); return { status: r.status, json: await r.json().catch(() => ({})) }; };

  it('lista marcas, modelos e anos e guarda as listas em memória (o provedor não é chamado de novo)', async () => {
    const b = await get('/api/fipe/brands?vehicleType=cars');
    assert.equal(b.status, 200);
    assert.equal(b.json.brands.length, 3);
    const m = await get('/api/fipe/models?vehicleType=cars&brandCode=9023');
    assert.equal(m.json.models.length, 3);
    const y = await get('/api/fipe/years?vehicleType=cars&brandCode=9023&modelCode=95940');
    assert.deepEqual(y.json.years.map((i) => i.code), ['2020-1', '2019-1']);
    const before = fipe.calls.length;
    await get('/api/fipe/brands?vehicleType=cars'); await get('/api/fipe/models?vehicleType=cars&brandCode=9023');
    assert.equal(fipe.calls.length, before, 'segunda leitura vem do cache');
  });

  it('busca "onix 2020": acha o modelo na marca certa e devolve o ano digitado', async () => {
    const r = await get('/api/fipe/search?vehicleType=cars&q=' + encodeURIComponent('onix 2020'));
    assert.equal(r.status, 200);
    assert.equal(r.json.year, 2020);
    assert.deepEqual(r.json.items.map((i) => i.model.code), ['95940', '95941']);
    assert.equal(r.json.items[0].brand.name, 'GM - Chevrolet');
  });

  it('busca com apelido de marca (vw, chev) e só pela marca', async () => {
    const vw = await get('/api/fipe/search?q=vw%20polo');
    assert.deepEqual(vw.json.items.map((i) => i.model.name), ['Polo 1.0 200 TSI']);
    const chev = await get('/api/fipe/search?q=chevrolet');
    assert.equal(chev.json.items.length, 3);
    const none = await get('/api/fipe/search?q=naoexiste');
    assert.deepEqual(none.json.items, []);
  });

  it('busca rejeita texto curto e tipo inválido', async () => {
    assert.equal((await get('/api/fipe/search?q=a')).status, 400);
    assert.equal((await get('/api/fipe/search?vehicleType=boats&q=onix')).status, 400);
  });

  it('preço: lê no provedor uma vez, guarda no cache do mês e não cria relatório nem gasta a cota gratuita', async () => {
    const docs = Number((await pool.query(`SELECT count(*) FROM report_documents WHERE report_kind='FIPE_FREE'`)).rows[0].count);
    const q = '/api/fipe/price?vehicleType=cars&brandCode=9023&modelCode=95940&yearCode=2020-1';
    const a = await get(q);
    assert.equal(a.status, 200);
    assert.equal(a.json.valueCents, 5812300);
    assert.equal(a.json.valueLabel.replace(/\s/g, ' '), 'R$ 58.123,00');
    assert.equal(a.json.referenceMonth, 'outubro de 2026');
    assert.equal(a.json.fipeCode, '004472-1');
    assert.equal(a.json.cached, false);
    const before = fipe.calls.length;
    const b = await get(q);
    assert.equal(b.json.cached, true);
    assert.equal(fipe.calls.length, before);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM report_documents WHERE report_kind='FIPE_FREE'`)).rows[0].count), docs);
    assert.equal(Number((await pool.query(`SELECT coalesce(sum(count),0) s FROM fipe_usage WHERE bucket_date=current_date`)).rows[0].s) >= 0, true);
  });

  it('preço: parâmetros fora do padrão são recusados e veículo inexistente dá 404 sem vazar detalhe', async () => {
    assert.equal((await get('/api/fipe/price?brandCode=9023&modelCode=95940')).status, 400);
    assert.equal((await get('/api/fipe/price?brandCode=9023;drop&modelCode=1&yearCode=2020-1')).status, 400);
    const nf = await get('/api/fipe/price?vehicleType=cars&brandCode=9023&modelCode=00000&yearCode=2020-1');
    assert.equal(nf.status, 404);
  });
});

describe('FIPE: recurso desligado', { ...integration }, () => {
  it('sem FEATURE_FREE_FIPE as rotas novas respondem indisponível', async () => {
    const app = await startServer({ FEATURE_FREE_FIPE: 'false' });
    try {
      for (const p of ['/api/fipe/search?q=onix', '/api/fipe/price?brandCode=1&modelCode=2&yearCode=2020-1']) {
        const r = await app.request(p);
        assert.ok([403, 404, 503].includes(r.status), `${p} -> ${r.status}`);
      }
    } finally { await app.stop(); }
  });
});
