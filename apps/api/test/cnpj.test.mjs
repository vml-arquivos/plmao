import assert from 'node:assert/strict';
import test, { before, after, describe, it } from 'node:test';
import { integration, loadCore, useTestEnv } from './helpers/db.mjs';
import { adminSession, hostRequest, startServer } from './helpers/server.mjs';

useTestEnv({ CNPJ_PROVIDER: 'brasilapi', CNPJ_CACHE_TTL_HOURS: '24' });
const cnpjLib = await import('../dist/lib/cnpj.js');

const VALID = '11222333000181';
const brasilApi = {
  cnpj: VALID, razao_social: 'EMPRESA EXEMPLO LTDA', nome_fantasia: 'Exemplo', descricao_situacao_cadastral: 'ATIVA', data_inicio_atividade: '2015-03-02',
  cnae_fiscal: 4511101, cnae_fiscal_descricao: 'Comércio a varejo de automóveis', natureza_juridica: 'Sociedade Empresária Limitada',
  cep: '70040010', descricao_tipo_de_logradouro: 'AVENIDA', logradouro: 'EXEMPLO', numero: '10', complemento: 'SALA 2', bairro: 'CENTRO', municipio: 'BRASILIA', uf: 'df',
  email: 'contador@exemplo.com', ddd_telefone_1: '6133334444', qsa: [{ nome_socio: 'FULANO DE TAL', cnpj_cpf_do_socio: '***123456**' }]
};
const okFetch = (calls) => async (url) => { calls.push(String(url)); return new Response(JSON.stringify(brasilApi), { status: 200 }); };

test('normaliza o mínimo: sem e-mail, telefone nem sócios; UF em maiúsculas; campos ausentes viram null', () => {
  const d = cnpjLib.normalizeBrasilApi(brasilApi, VALID);
  assert.equal(d.legalName, 'EMPRESA EXEMPLO LTDA');
  assert.equal(d.address.state, 'DF'); assert.equal(d.address.street, 'AVENIDA EXEMPLO'); assert.equal(d.address.zip, '70040010');
  assert.equal(d.mainActivity.code, '4511101');
  const json = JSON.stringify(d);
  assert.doesNotMatch(json, /contador@|6133334444|FULANO|qsa/);
  const empty = cnpjLib.normalizeBrasilApi({}, VALID);
  assert.equal(empty.legalName, null); assert.equal(empty.address.city, null); assert.equal(empty.openedAt, null);
});

test('limite por solicitante', () => {
  const k = `t-${Math.random()}`;
  for (let i = 0; i < 20; i++) assert.equal(cnpjLib.cnpjRateLimit(k, 1000), true);
  assert.equal(cnpjLib.cnpjRateLimit(k, 2000), false);
  assert.equal(cnpjLib.cnpjRateLimit(k, 1000 + 600_001), true);
});

describe('consulta de CNPJ (integração)', integration, () => {
  let pool;
  before(async () => { ({ pool } = await loadCore()); await pool.query('DELETE FROM cnpj_cache WHERE cnpj=$1', [VALID]); });
  after(async () => { await pool.query('DELETE FROM cnpj_cache WHERE cnpj=$1', [VALID]); });

  it('rejeita CNPJ com dígito verificador errado sem chamar o provedor', async () => {
    const calls = [];
    await assert.rejects(() => cnpjLib.lookupCnpj('11222333000182', { requester: 'a', fetchImpl: okFetch(calls) }), (e) => e.code === 'CNPJ_INVALID');
    assert.equal(calls.length, 0);
  });

  it('busca no provedor, grava em cache e responde a segunda vez sem nova chamada', async () => {
    const calls = [];
    const a = await cnpjLib.lookupCnpj('11.222.333/0001-81', { requester: 'c1', fetchImpl: okFetch(calls) });
    assert.equal(a.cached, false); assert.equal(a.source, 'BrasilAPI'); assert.equal(a.data.legalName, 'EMPRESA EXEMPLO LTDA');
    assert.match(calls[0], /\/api\/cnpj\/v1\/11222333000181$/);
    const stored = await pool.query('SELECT data FROM cnpj_cache WHERE cnpj=$1', [VALID]);
    assert.doesNotMatch(JSON.stringify(stored.rows[0].data), /contador@|FULANO/);
    const b = await cnpjLib.lookupCnpj(VALID, { requester: 'c1', fetchImpl: okFetch(calls) });
    assert.equal(b.cached, true); assert.equal(calls.length, 1);
  });

  it('mapeia 404, 429, erro de rede e resposta sem razão social', async () => {
    await pool.query('DELETE FROM cnpj_cache WHERE cnpj=$1', [VALID]);
    const mk = (status, body = '{}') => async () => new Response(body, { status });
    await assert.rejects(() => cnpjLib.lookupCnpj(VALID, { requester: 'e1', fetchImpl: mk(404) }), (e) => e.code === 'CNPJ_NOT_FOUND');
    await assert.rejects(() => cnpjLib.lookupCnpj(VALID, { requester: 'e1', fetchImpl: mk(429) }), (e) => e.code === 'CNPJ_RATE_LIMITED');
    await assert.rejects(() => cnpjLib.lookupCnpj(VALID, { requester: 'e1', fetchImpl: mk(500) }), (e) => e.code === 'CNPJ_UNAVAILABLE');
    await assert.rejects(() => cnpjLib.lookupCnpj(VALID, { requester: 'e1', fetchImpl: async () => { throw new Error('boom'); } }), (e) => e.code === 'CNPJ_UNAVAILABLE');
    await assert.rejects(() => cnpjLib.lookupCnpj(VALID, { requester: 'e1', fetchImpl: mk(200, '{}') }), (e) => e.code === 'CNPJ_UNAVAILABLE');
    const none = await pool.query('SELECT 1 FROM cnpj_cache WHERE cnpj=$1', [VALID]);
    assert.equal(none.rowCount, 0, 'falhas não entram no cache');
  });
});

describe('API de CNPJ (integração)', integration, () => {
  let server, pool;
  before(async () => { ({ pool } = await loadCore()); server = await startServer({ CNPJ_PROVIDER: 'disabled' }); });
  after(async () => { await server.stop(); await pool.end(); });

  it('desligada por padrão: status false e busca responde 503 sem chamada externa', async () => {
    const adm = await adminSession({ server, pool, role: 'ADMIN' });
    assert.equal((await adm.call('/api/admin/cnpj/status')).json.enabled, false);
    const r = await adm.call(`/api/admin/cnpj/${VALID}`);
    assert.equal(r.status, 503); assert.equal(r.json.error, 'CNPJ_LOOKUP_DISABLED');
  });

  it('exige login e permissão de clientes; CNPJ inválido é 400', async () => {
    assert.equal((await hostRequest(server.base, `/api/admin/cnpj/${VALID}`, { host: 'admin.placanamao.test' })).status, 401);
    assert.equal((await hostRequest(server.base, `/api/account/cnpj/${VALID}`)).status, 401);
    const conteudo = await adminSession({ server, pool, role: 'CONTEUDO' });
    assert.equal((await conteudo.call(`/api/admin/cnpj/${VALID}`)).status, 403);
    const adm = await adminSession({ server, pool, role: 'ADMIN' });
    assert.equal((await adm.call('/api/admin/cnpj/12345678000100')).status, 400);
  });

  it('confirmação do pré-preenchimento fica na auditoria com quem confirmou', async () => {
    const adm = await adminSession({ server, pool, role: 'ADMIN' });
    const r = await adm.call(`/api/admin/cnpj/${VALID}/confirm`, { method: 'POST', body: { edited: true, source: 'BrasilAPI', fetchedAt: new Date().toISOString() } });
    assert.equal(r.status, 200);
    const a = await pool.query(`SELECT user_id,metadata FROM audit_logs WHERE action='CNPJ_PREFILL_CONFIRMED' AND entity_id=$1 ORDER BY created_at DESC LIMIT 1`, [VALID]);
    assert.equal(a.rowCount, 1); assert.equal(a.rows[0].metadata.edited, true);
    const bad = await adm.call(`/api/admin/cnpj/${VALID}/confirm`, { method: 'POST', body: { edited: 'sim' } });
    assert.equal(bad.status, 400);
  });
});
