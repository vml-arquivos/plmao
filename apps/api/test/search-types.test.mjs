import assert from 'node:assert/strict';
import fs from 'node:fs';
import test, { describe, before, after, it } from 'node:test';
import { integration, loadCore, uid, useTestEnv } from './helpers/db.mjs';
import { checkoutWithContract } from './helpers/contract.mjs';
import { hostRequest, startServer } from './helpers/server.mjs';

useTestEnv();
const { normalizeSearchKey, isValidRenavam, resolveSearchInput, parseSearchTypes, maskSearchValue } = await import('../dist/searchKey.js');
const { ConsultarPlacaVehicleProvider } = await import('../dist/providers/consultarPlacaProvider.js');
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { providerSupports } = await import('../dist/vehicleLookup.js');
const { normalizeBdrp } = await import('../dist/normalizer.js');
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));

test('valida e normaliza cada tipo de chave', () => {
  assert.equal(normalizeSearchKey('PLATE', 'abc-1d23'), 'ABC1D23');
  assert.equal(normalizeSearchKey('PLATE', '123'), null);
  assert.equal(normalizeSearchKey('CHASSIS', '9bw zzz377vt004251'), '9BWZZZ377VT004251');
  assert.equal(normalizeSearchKey('CHASSIS', '9BWZZZ377VT00425I'), null, 'chassi de 17 não usa I, O, Q');
  assert.equal(normalizeSearchKey('CHASSIS', 'AB123'), null);
  assert.equal(normalizeSearchKey('CHASSIS', 'ABC12345'), 'ABC12345', 'chassi curto de veículo antigo');
  assert.equal(normalizeSearchKey('RENAVAM', '639884962'), '00639884962', 'completa com zeros à esquerda');
  assert.equal(normalizeSearchKey('RENAVAM', '00639884963'), null, 'dígito verificador errado');
  assert.equal(normalizeSearchKey('OWNER_DOC', '529.982.247-25'), '52998224725');
  assert.equal(normalizeSearchKey('OWNER_DOC', '11.222.333/0001-81'), '11222333000181');
  assert.equal(normalizeSearchKey('OWNER_DOC', '111.111.111-11'), null);
  assert.equal(isValidRenavam('00639884962'), true);
});

test('aceita o formato antigo (plate) e o novo (searchType + searchValue)', () => {
  assert.deepEqual(resolveSearchInput({ plate: 'abc1d23' }), { type: 'PLATE', value: 'ABC1D23' });
  assert.deepEqual(resolveSearchInput({ searchType: 'CHASSIS', searchValue: '9bwzzz377vt004251' }), { type: 'CHASSIS', value: '9BWZZZ377VT004251' });
  assert.equal(resolveSearchInput({ searchType: 'RENAVAM', searchValue: 'abc' }), null);
  assert.deepEqual(parseSearchTypes('chassis, renavam'), ['PLATE', 'CHASSIS', 'RENAVAM']);
  assert.deepEqual(parseSearchTypes(undefined), ['PLATE']);
  assert.equal(maskSearchValue('OWNER_DOC', '52998224725'), '***.982.***-25');
});

const okBody = (placa) => ({ status: 'ok', dados: { informacoes_veiculo: { dados_veiculo: { placa, chassi: '9BWZZZ377VT004251', marca: 'VW', modelo: 'VW/GOL 1.0', ano_fabricacao: '2014', ano_modelo: '2015' } } } });
const fakeFetch = (status, body) => { const calls = []; const fn = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }; fn.calls = calls; return fn; };
const cp = (f) => new ConsultarPlacaVehicleProvider({ baseUrl: 'https://api.consultarplaca.test', email: 'a@b.c', apiKey: 'k', fetchImpl: f, timeoutMs: 2000 });
const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

test('ConsultarPlaca: busca por chassi usa /v2/consultarChassi e devolve a placa da resposta', async () => {
  const f = fakeFetch(200, okBody('ABC1D23'));
  const out = await cp(f).queryBy('CHASSIS', '9BWZZZ377VT004251');
  assert.equal(f.calls[0].url, 'https://api.consultarplaca.test/v2/consultarChassi?chassi=9BWZZZ377VT004251');
  assert.equal(out.raw.placa, 'ABC1D23');
  assert.equal(normalizeBdrp(out.raw).identification.plate, 'ABC1D23');
});

test('ConsultarPlaca: Renavam e documento não são atendidos e nada é chamado', async () => {
  const f = fakeFetch(200, okBody('ABC1D23'));
  const p = cp(f);
  assert.equal(await code(p.queryBy('RENAVAM', '00639884962')), 'SEARCH_TYPE_NOT_SUPPORTED');
  assert.equal(await code(p.queryBy('OWNER_DOC', '52998224725')), 'SEARCH_TYPE_NOT_SUPPORTED');
  assert.equal(f.calls.length, 0);
  assert.equal(providerSupports(p, 'CHASSIS'), true);
  assert.equal(providerSupports(p, 'RENAVAM'), false);
});

test('ConsultarPlaca: chassi sem placa na resposta é recusado', async () => {
  const f = fakeFetch(200, okBody(''));
  assert.equal(await code(cp(f).queryBy('CHASSIS', '9BWZZZ377VT004251')), 'DATA_PROVIDER_INVALID_RESPONSE');
});

describe('Credify: tipos de busca vêm do contrato', () => {
  const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
  const mk = (extra, calls) => {
    resetCredifyTokenCache();
    const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); if (String(url).endsWith('/auth')) return new Response(JSON.stringify({ Success: true, Dados: jwt }), { status: 200 }); return new Response(JSON.stringify(sample), { status: 200 }); };
    return new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: 's', path: '/consulta', method: 'post', timeoutMs: 2000, fetchImpl, ...extra });
  };
  it('sem VEHICLE_SEARCH_TYPES só atende placa', async () => {
    const calls = [];
    const p = mk({ bodyTemplate: '{"chassi":"{{chassis}}"}' }, calls);
    assert.deepEqual([...p.supportedSearchTypes], ['PLATE']);
    assert.equal(await code(Promise.resolve().then(() => p.queryBy('CHASSIS', '9BWZZZ377VT004251'))), 'SEARCH_TYPE_NOT_SUPPORTED');
    assert.equal(calls.length, 0);
  });
  it('com o tipo liberado e o modelo com {{chassis}}, a chave entra no corpo', async () => {
    const calls = [];
    const p = mk({ searchTypes: 'CHASSIS', bodyTemplate: '{"placa":"{{plate}}","chassi":"{{chassis}}"}' }, calls);
    const out = await p.queryBy('CHASSIS', '9BWZZZ377VT004251');
    const call = calls.find((c) => !c.url.endsWith('/auth'));
    assert.deepEqual(JSON.parse(call.init.body), { placa: '', chassi: '9BWZZZ377VT004251' });
    assert.equal(out.raw.placa, undefined);
  });
  it('tipo liberado mas modelo sem o marcador: não chama', async () => {
    const calls = [];
    const p = mk({ searchTypes: 'RENAVAM', bodyTemplate: '{"placa":"{{plate}}"}' }, calls);
    assert.equal(await code(Promise.resolve().then(() => p.queryBy('RENAVAM', '00639884962'))), 'SEARCH_TYPE_NOT_SUPPORTED');
    assert.equal(calls.length, 0);
  });
});

describe('API: consulta por chassi, Renavam e documento', integration, () => {
  let pool; let server;
  before(async () => { useTestEnv(); ({ pool } = await loadCore()); server = await startServer({ PUBLIC_API_ENABLED: 'true' }); });
  after(async () => { await server.stop(); await pool.query(`DELETE FROM email_outbox WHERE related_type='PURCHASE_CONTRACT'`); await pool.end(); });

  const register = async (balance = 50000) => {
    const reg = await hostRequest(server.base, '/api/auth/register', { method: 'POST', body: { name: 'Cliente Busca', email: `${uid('bs')}@cliente.local`, password: 'Senha-Forte-123!', acceptTerms: true, acceptPrivacy: true } });
    await pool.query('UPDATE wallets SET balance_cents=$2 WHERE user_id=$1', [reg.json.user.id, balance]);
    return { token: reg.json.token, id: reg.json.user.id };
  };
  const balanceOf = async (id) => Number((await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [id])).rows[0].balance_cents);
  const post = (c, body) => hostRequest(server.base, '/api/queries', { method: 'POST', token: c.token, body });

  it('lista os tipos atendidos pela fonte atual', async () => {
    const r = await hostRequest(server.base, '/api/search-types');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.json.types.map((t) => [t.id, t.available]));
    assert.deepEqual(by, { PLATE: true, CHASSIS: true, RENAVAM: false, OWNER_DOC: false });
  });

  it('chassi: cobra, grava o tipo e mostra a placa do resultado', async () => {
    const c = await register();
    const r = await post(c, { searchType: 'CHASSIS', searchValue: '9zzsandbxxdev1b11', productId: 'COMPLETE' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.searchType, 'CHASSIS');
    assert.equal(r.json.searchValue, '9ZZSANDBXXDEV1B11');
    assert.equal(r.json.plate, 'DEV1B11');
    const row = (await pool.query('SELECT search_type,plate,price_cents FROM vehicle_queries WHERE id=$1', [r.json.id])).rows[0];
    assert.equal(row.search_type, 'CHASSIS'); assert.equal(row.plate, '9ZZSANDBXXDEV1B11');
    assert.ok(Number(row.price_cents) > 0);
    assert.equal(await balanceOf(c.id), 50000 - Number(row.price_cents));
    const again = await hostRequest(server.base, `/api/queries/${r.json.id}`, { token: c.token });
    assert.equal(again.json.searchType, 'CHASSIS');
  });

  it('formato antigo com plate continua igual', async () => {
    const c = await register();
    const r = await post(c, { plate: 'dev1b11', productId: 'COMPLETE' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.searchType, 'PLATE'); assert.equal(r.json.plate, 'DEV1B11');
  });

  it('Renavam e documento: recusa antes de cobrar', async () => {
    const c = await register();
    const a = await post(c, { searchType: 'RENAVAM', searchValue: '00639884962', productId: 'COMPLETE' });
    assert.equal(a.status, 409); assert.equal(a.json.error, 'SEARCH_TYPE_NOT_SUPPORTED');
    assert.match(a.json.message, /Nada foi cobrado/);
    const b = await post(c, { searchType: 'OWNER_DOC', searchValue: '529.982.247-25', productId: 'COMPLETE' });
    assert.equal(b.status, 409);
    assert.equal(await balanceOf(c.id), 50000);
    assert.equal((await pool.query('SELECT 1 FROM vehicle_queries WHERE user_id=$1', [c.id])).rowCount, 0);
  });

  it('chave inválida devolve o erro do tipo, em português', async () => {
    const c = await register();
    const chassis = await post(c, { searchType: 'CHASSIS', searchValue: 'AB1', productId: 'COMPLETE' });
    assert.equal(chassis.status, 400); assert.equal(chassis.json.error, 'INVALID_CHASSIS'); assert.match(chassis.json.message, /chassi válido/);
    const ren = await post(c, { searchType: 'RENAVAM', searchValue: '12345678901', productId: 'COMPLETE' });
    assert.equal(ren.json.error, 'INVALID_RENAVAM');
    const plate = await post(c, { plate: 'XX', productId: 'COMPLETE' });
    assert.equal(plate.json.error, 'INVALID_PLATE');
    assert.equal(await balanceOf(c.id), 50000);
  });

  it('chassi não encontrado estorna', async () => {
    const c = await register();
    const r = await post(c, { searchType: 'CHASSIS', searchValue: '9ZZNAOEXISTE000001', productId: 'COMPLETE' });
    assert.ok(r.status >= 400);
    assert.equal(await balanceOf(c.id), 50000);
  });

  it('API pública v1: aceita chassis e exige uma única chave', async () => {
    const c = await register();
    const key = (await hostRequest(server.base, '/api/account/api-keys', { method: 'POST', token: c.token, body: { name: 'erp' } })).json.key;
    const ok = await hostRequest(server.base, '/api/v1/vehicles', { method: 'POST', token: key, body: { chassis: '9ZZSANDBXXDEV1B11', product: 'COMPLETE' } });
    assert.equal(ok.status, 201, ok.text);
    const both = await hostRequest(server.base, '/api/v1/vehicles', { method: 'POST', token: key, body: { plate: 'DEV1B11', chassis: '9ZZSANDBXXDEV1B11', product: 'COMPLETE' } });
    assert.equal(both.status, 400);
    const none = await hostRequest(server.base, '/api/v1/vehicles', { method: 'POST', token: key, body: { product: 'COMPLETE' } });
    assert.equal(none.status, 400);
  });

  it('consulta grátis por cupom de 100% vale para o tipo pedido (direito pago guarda o tipo)', async () => {
    const c = await register(0);
    const code = uid('BUSCA').toUpperCase().replace(/-/g, '');
    await pool.query(`INSERT INTO coupons(code,discount_type,discount_value) VALUES($1,'PERCENT',100)`, [code]);
    const body = { productId: 'COMPLETE', searchType: 'CHASSIS', searchValue: '9ZZSANDBXXDEV1B11', couponCode: code };
    const order = await checkoutWithContract(server.base, pool, c, '/api/payments/query/checkout', body);
    assert.equal(order.status, 201, order.text);
    assert.equal(order.json.searchType, 'CHASSIS');
    const ent = (await pool.query('SELECT search_type,plate FROM query_payment_entitlements WHERE order_id=$1', [order.json.orderId])).rows[0];
    assert.equal(ent.search_type, 'CHASSIS'); assert.equal(ent.plate, '9ZZSANDBXXDEV1B11');
    const wrongType = await post(c, { plate: '9ZZSANDBXXDEV1B11', productId: 'COMPLETE', paymentOrderId: order.json.orderId });
    assert.ok(wrongType.status >= 400, 'direito de chassi não vale para placa');
    const run = await post(c, { searchType: 'CHASSIS', searchValue: '9ZZSANDBXXDEV1B11', productId: 'COMPLETE', paymentOrderId: order.json.orderId });
    assert.equal(run.status, 201, run.text);
    assert.equal(run.json.plate, 'DEV1B11');
  });
});
