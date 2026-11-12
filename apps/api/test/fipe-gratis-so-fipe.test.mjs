import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it, test } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { adminSession, startServer } from './helpers/server.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { parseFipeByPlate, fipeMoneyToCents, fipeReference } = await import('../dist/fipePlate.js');

const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const fipeOk = (extra = {}) => ({ CONSULTA: consulta('454'), RESPOSTA: { CODIGO: '1', PRECIFICADORFIPE: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { STATUS: '1', CHASSI: '9BWZZZ377VT004251', CODIGOFIPE: '005004-1', FABRICANTEFIPE: 'VW - VOLKSWAGEN', MODELOFIPE: 'GOL 1.0 FLEX 4P', ANOMODELOFIPE: '2020', COMBUSTIVELFIPE: 'F', PRECOFIPE: '45.000,00', PRECOMEDIO: '44.000,00', VIGENCIA: '11/2026', ...extra } } } });
const generic = (id) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', VEICULOSBDRP: { DESCRICAORETORNO: 'SUCESSO', RETORNO: { PLACA: 'AAA0000', MARCA: 'VW' } } } });

/** Credify de mentira: anota cada caminho pago chamado. */
function fakeFetch(answer = () => fipeOk()) {
  const calls = [];
  const fn = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    return new Response(JSON.stringify(answer(path)), { status: 200 });
  };
  fn.paid = () => calls.filter((c) => c !== '/auth');
  return fn;
}
const opts = (fetchImpl, extra = {}) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl, ...extra });

describe('direcionamento: cada produto chama só a consulta da sua descrição', () => {
  it('FIPE grátis: UMA consulta, a de FIPE (454), em qualquer configuração', async () => {
    for (const extra of [{}, { path: '/veiculototal', consultaId: '467' }, { path: '/debitosrestricoesproprietarios' }]) {
      for (const sources of [undefined, null, ['TOTAL'], ['SINISTRO', 'NATIONAL', 'GRAVAME', 'RENAJUD'], []]) {
        resetCredifyTokenCache();
        const f = fakeFetch();
        await new CredifyVehicleProvider(opts(f, extra)).queryByPlate('AAA0000', { productId: 'FIPE_FREE', sources });
        assert.deepEqual(f.paid(), ['/precificadorfipe'], `config ${JSON.stringify(extra)} fontes ${JSON.stringify(sources)}`);
      }
    }
    resetCredifyTokenCache();
    const g = fakeFetch();
    await new CredifyVehicleProvider(opts(g)).queryByPlate('AAA0000', { productId: 'fipe_free' });
    assert.deepEqual(g.paid(), ['/precificadorfipe'], 'maiúsculas e minúsculas');
  });

  it('Básica e Cadastral: só débitos e restrições (487); Gravame soma a consulta de gravame; nada de Veículo Total', async () => {
    for (const [pid, esperado] of [['BASIC', ['/debitosrestricoesproprietarios']], ['CADASTRAL', ['/debitosrestricoesproprietarios']], ['LIEN', ['/debitosrestricoesproprietarios', '/gravame']]]) {
      resetCredifyTokenCache();
      const f = fakeFetch((p) => generic(p === '/gravame' ? '533' : '487'));
      await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: pid }).catch(() => undefined);
      assert.ok(!f.paid().includes('/veiculototal'), `${pid} nunca chama o Veículo Total`);
      assert.ok(!f.paid().includes('/precificadorfipe'), `${pid} não chama a FIPE`);
      assert.deepEqual([...new Set(f.paid())].sort(), [...esperado].sort(), pid);
    }
  });

  it('produto sem consulta definida falha antes de chamar a Credify (não cai no Veículo Total)', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch((p) => generic('467'));
    await assert.rejects(() => new CredifyVehicleProvider(opts(f, { path: undefined })).queryByPlate('AAA0000', { productId: 'PRODUTO_NOVO' }), (e) => e.code === 'DATA_PROVIDER_PRODUCT_NOT_ROUTED');
    assert.deepEqual(f.paid(), [], 'nenhuma consulta paga');
  });

  it('Completa e Premium continuam como antes (Veículo Total quando a fonte é TOTAL)', async () => {
    resetCredifyTokenCache();
    const f = fakeFetch((p) => generic('467'));
    await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE', sources: ['TOTAL'] }).catch(() => undefined);
    assert.deepEqual(f.paid(), ['/veiculototal']);
  });
});

describe('leitura da resposta da FIPE (só FIPE, sem dado de cadastro)', () => {
  it('lê preço, código, marca, modelo, ano, combustível e mês; nada de chassi', () => {
    const r = parseFipeByPlate({ placa: 'AAA0000', data: fipeOk() }, 'AAA0000', new Date('2026-11-12T12:00:00Z'));
    assert.equal(r.valueCents, 4500000);
    assert.equal(r.valueLabel.replace(/\s/g, ' '), 'R$ 45.000,00');
    assert.equal(r.fipeCode, '005004-1');
    assert.equal(r.brand.name, 'VW - VOLKSWAGEN');
    assert.equal(r.modelYear, 2020);
    assert.equal(r.fuel, 'Flex');
    assert.equal(r.referenceMonth, 'novembro/2026');
    assert.ok(!JSON.stringify(r).includes('9BWZZZ377VT004251'), 'o chassi que a fonte devolve não vai para o resultado');
  });
  it('ano com 2 dígitos vira 20xx ou 19xx; moeda sem vírgula não vira milhões', () => {
    assert.equal(parseFipeByPlate({ data: fipeOk({ ANOMODELOFIPE: '16' }) }, 'AAA0000', new Date('2026-11-12')).modelYear, 2016);
    assert.equal(parseFipeByPlate({ data: fipeOk({ ANOMODELOFIPE: '98' }) }, 'AAA0000', new Date('2026-11-12')).modelYear, 1998);
    assert.equal(fipeMoneyToCents('45000.00'), 4500000);
    assert.equal(fipeMoneyToCents('45.000,00'), 4500000);
    assert.equal(fipeReference('novembro de 2026'), 'novembro/2026');
  });
  it('placa sem FIPE: 404; dado incompleto: 422', () => {
    assert.throws(() => parseFipeByPlate({ data: { CONSULTA: consulta('454'), RESPOSTA: { CODIGO: '2' } } }, 'AAA0000'), (e) => e.code === 'FIPE_PLATE_NOT_FOUND');
    assert.throws(() => parseFipeByPlate({ data: fipeOk({ STATUS: '0' }) }, 'AAA0000'), (e) => e.code === 'FIPE_PLATE_NOT_FOUND');
    assert.throws(() => parseFipeByPlate({ data: fipeOk({ PRECOFIPE: '', PRECOMEDIO: '' }) }, 'AAA0000'), (e) => e.code === 'FIPE_PLATE_DATA_INVALID');
    assert.throws(() => parseFipeByPlate({ data: { RESPOSTA: { CODIGO: '1', VEICULOSBDRP: { RETORNO: { PLACA: 'AAA0000' } } } } }, 'AAA0000'), (e) => e.code === 'FIPE_PLATE_NOT_FOUND', 'resposta de outra consulta não vira FIPE');
  });
});

describe('FIPE grátis no servidor com a Credify: só a consulta de FIPE, em todos os caminhos', { ...integration }, () => {
  let pool; let app; let credify; let sa; let mode = 'ok';
  const hits = [];
  before(async () => {
    ({ pool } = await loadCore());
    credify = http.createServer((req, res) => {
      let body = ''; req.on('data', (d) => { body += d; });
      req.on('end', () => {
        hits.push(req.url);
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (req.url === '/auth') return send(200, { Success: true, Dados: jwt() });
        if (mode === 'down') return send(500, { Message: 'erro interno' });
        if (mode === 'notfound') return send(200, { CONSULTA: consulta('454'), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: 'NAO ENCONTRADO' } });
        if (req.url === '/precificadorfipe') return send(200, fipeOk());
        return send(200, generic('467'));
      });
    });
    await new Promise((r) => credify.listen(0, '127.0.0.1', r));
    app = await startServer({
      DATA_PROVIDER: 'real', VEHICLE_API_PROVIDER: 'credify', CREDIFY_BASE_URL: `http://127.0.0.1:${credify.address().port}`, CREDIFY_CLIENT_ID: 'cid', CREDIFY_CLIENT_SECRET: 'sec',
      FEATURE_FREE_FIPE: 'true', FIPE_GUEST_DAILY_LIMIT: '100', FIPE_AUTH_DAILY_LIMIT: '100', ENRICH_FIPE_HISTORY: 'false', PLATE_CACHE_HOURS: '0',
      FIPE_PRIMARY_BASE_URL: 'http://127.0.0.1:9', FIPE_SECONDARY_BASE_URL: 'http://127.0.0.1:9'
    });
    sa = await adminSession({ server: app, pool, role: 'SUPER_ADMIN' });
  });
  after(async () => { await app?.stop(); credify?.close(); });
  const paid = () => hits.filter((h) => h !== '/auth');
  async function cliente() {
    const email = `${uid('fp')}@cliente.local`;
    const r = await app.request('/api/auth/register', { method: 'POST', body: { name: 'Cliente FIPE', email, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    const j = await r.json(); assert.equal(r.status, 201, JSON.stringify(j));
    return j.token;
  }

  it('tela pública por placa: uma consulta de FIPE e resposta sem dado do cadastro', async () => {
    const token = await cliente();
    hits.length = 0; mode = 'ok';
    const r = await app.request('/api/fipe/quote', { method: 'POST', token, body: { plate: 'AAA0A00' } });
    const j = await r.json();
    assert.equal(r.status, 201, JSON.stringify(j));
    assert.deepEqual(paid(), ['/precificadorfipe']);
    assert.equal(j.valueCents, 4500000);
    assert.equal(j.fipeCode, '005004-1');
    assert.equal(j.vehicleDetails, undefined, 'sem chassi, motor, Renavam nem proprietário');
    assert.ok(!JSON.stringify(j).includes('9BWZZZ377VT004251'));
  });

  it('por placa precisa de conta: sem login, a resposta pede cadastro e a Credify nem é chamada', async () => {
    hits.length = 0; mode = 'ok';
    const r = await app.request('/api/fipe/quote', { method: 'POST', body: { plate: 'AAA0A00' } });
    assert.equal(r.status, 401);
    assert.match(JSON.stringify(await r.json()), /FIPE_PLATE_LOGIN_REQUIRED|entre ou crie sua conta/);
    assert.deepEqual(paid(), []);
  });

  it('API de consultas: o produto FIPE grátis não roda por ali (não chama a Credify)', async () => {
    const token = await cliente();
    hits.length = 0;
    const r = await app.request('/api/queries', { method: 'POST', token, body: { searchType: 'PLATE', searchValue: 'AAA0A00', productId: 'FIPE_FREE' } });
    assert.ok([409, 403, 400].includes(r.status), `status ${r.status}`);
    assert.deepEqual(paid(), []);
  });

  it('consulta interna do painel: só FIPE, salva como FIPE grátis, PDF sem cadastro', async () => {
    hits.length = 0; mode = 'ok';
    const r = await sa.call('/api/admin/lookups', { method: 'POST', body: { plate: 'BBB1B11', productId: 'FIPE_FREE' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(paid(), ['/precificadorfipe']);
    assert.equal(r.json.productId, 'FIPE_FREE');
    assert.equal(r.json.result.valueCents, 4500000);
    assert.ok(r.json.pdfBase64 && r.json.pdfBase64.length > 100);
    const pdf = Buffer.from(r.json.pdfBase64, 'base64').toString('latin1');
    const hit = /9BWZZZ377VT004251|RENAVAM|Chassi/i.exec(pdf); assert.equal(hit, null, 'PDF só com FIPE: achou ' + (hit && pdf.slice(Math.max(0, hit.index - 60), hit.index + 60)));
    const row = await pool.query(`SELECT product_id,charge_source,price_cents FROM vehicle_queries WHERE id=$1`, [r.json.queryId]);
    assert.equal(row.rows[0].product_id, 'FIPE_FREE');
    assert.equal(Number(row.rows[0].price_cents), 0);
  });

  it('falha da Credify vira erro claro (502) e placa sem FIPE vira 404; nada fora da consulta de FIPE é chamado', async () => {
    const token = await cliente();
    hits.length = 0; mode = 'down';
    const down = await app.request('/api/fipe/quote', { method: 'POST', token, body: { plate: 'CCC2C22' } });
    assert.equal(down.status, 502);
    assert.equal((await down.json()).error, 'FIPE_PLATE_UNAVAILABLE');
    mode = 'notfound';
    const nf = await app.request('/api/fipe/quote', { method: 'POST', token, body: { plate: 'DDD3D33' } });
    assert.equal(nf.status, 404);
    assert.ok(paid().every((p) => p === '/precificadorfipe'), paid().join(','));
    mode = 'ok';
  });
});
