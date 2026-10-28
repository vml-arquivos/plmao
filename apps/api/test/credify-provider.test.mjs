import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { normalizeBdrp } = await import('../dist/normalizer.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = (expSeconds) => `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;

function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const h = handlers.shift();
    if (!h) throw new Error('chamada inesperada');
    if (h instanceof Error) throw h;
    return new Response(JSON.stringify(h.body ?? {}), { status: h.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const base = { baseUrl: 'https://api.credify.test', clientId: 'cid-teste', clientSecret: 'segredo-teste', path: '/debitosrestricoesproprietarios', method: 'post', bodyTemplate: '{"placa":"{{plate}}"}', timeoutMs: 2000 };

test('autentica em /auth, usa o JWT como Bearer e reaproveita o token até perto do vencimento', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const token = jwt(Math.floor(now / 1000) + 24 * 3600);
  const f = fakeFetch([{ body: { Success: true, Message: 'ok', Dados: token } }, { body: sample }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now });
  const out = await p.queryByPlate('AAA0000');
  assert.equal(f.calls[0].url, 'https://api.credify.test/auth');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { ClientID: 'cid-teste', ClientSecret: 'segredo-teste' });
  assert.equal(f.calls[1].url, 'https://api.credify.test/debitosrestricoesproprietarios');
  assert.equal(f.calls[1].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { placa: 'AAA0000' });
  assert.equal(out.providerQueryId, '51727690');
  assert.equal(out.raw.placa, 'AAA0000');
  await p.queryByPlate('AAA0000'); // segunda chamada sem novo /auth
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 1);
});

test('o retorno real do fornecedor passa pelo normalizador v2 sem adaptação', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([{ body: { Success: true, Dados: jwt(Math.floor(Date.now() / 1000) + 86400) } }, { body: sample }]);
  const out = await new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000');
  const v2 = normalizeBdrp(out.raw).v2;
  assert.equal(v2.plate, 'AAA0000');
  assert.ok(v2.coverage.provided > 40);
  assert.equal(buildReportV2(out.raw).plate, 'AAA0000');
});

test('token recusado no meio: renova uma vez e repete a consulta; credencial inválida vira erro de autenticação', async () => {
  resetCredifyTokenCache();
  const t1 = jwt(Math.floor(Date.now() / 1000) + 86400);
  const f = fakeFetch([{ body: { Success: true, Dados: t1 } }, { status: 401 }, { status: 401 }, { body: { Success: true, Dados: `${t1}x` } }, { body: sample }]);
  const out = await new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000');
  assert.equal(out.providerQueryId, '51727690');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 2);
  resetCredifyTokenCache();
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: fakeFetch([{ status: 401, body: { Message: 'LOGON OU SENHA INVALIDOS' } }]) }).queryByPlate('AAA0000'), { code: 'DATA_PROVIDER_AUTH_FAILED' });
});

test('cabeçalho Authorization: se "Bearer token" é recusado, tenta o token puro e passa a usar o formato que funcionou', async () => {
  resetCredifyTokenCache();
  const t = jwt(Math.floor(Date.now() / 1000) + 86400);
  const f = fakeFetch([{ body: { Success: true, Dados: t } }, { status: 401 }, { body: sample }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f });
  const out = await p.queryByPlate('AAA0000');
  assert.equal(out.providerQueryId, '51727690');
  assert.equal(f.calls[1].init.headers.authorization, `Bearer ${t}`);
  assert.equal(f.calls[2].init.headers.authorization, t);
  await p.queryByPlate('AAA0000');
  assert.equal(f.calls[3].init.headers.authorization, t);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 1);
  resetCredifyTokenCache();
});

test('mapeia erros do fornecedor para códigos internos e nunca devolve segredo', async () => {
  const run = async (status, body) => {
    resetCredifyTokenCache();
    const f = fakeFetch([{ body: { Success: true, Dados: jwt(Math.floor(Date.now() / 1000) + 86400) } }, { status, body }]);
    return new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000');
  };
  await assert.rejects(run(404), { code: 'NOT_FOUND' });
  await assert.rejects(run(429), { code: 'DATA_PROVIDER_RATE_LIMITED' });
  await assert.rejects(run(402), { code: 'DATA_PROVIDER_QUOTA_EXHAUSTED' });
  await assert.rejects(run(500), { code: 'DATA_PROVIDER_UNAVAILABLE' });
  const bad = structuredClone(sample); bad.RESPOSTA.VEICULOSBDRP.DESCRICAORETORNO = 'ERRO';
  await assert.rejects(run(200, bad), { code: 'DATA_PROVIDER_INVALID_RESPONSE' });
  resetCredifyTokenCache();
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: fakeFetch([new Error('timeout')]) }).queryByPlate('AAA0000'), { code: 'PROVIDER_TIMEOUT' });
});

test('sem credenciais ou sem corpo configurado não chama o fornecedor (consulta falha antes de cobrar o provedor)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, clientId: '', fetchImpl: f }).queryByPlate('AAA0000'), { code: 'DATA_PROVIDER_NOT_CONFIGURED' });
  await assert.rejects(new CredifyVehicleProvider({ ...base, bodyTemplate: undefined, fetchImpl: f }).queryByPlate('AAA0000'), { code: 'DATA_PROVIDER_NOT_CONFIGURED' });
  assert.equal(f.calls.length, 0);
});

test('o modelo do corpo coloca a placa como valor JSON (sem quebrar o JSON)', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([{ body: { Success: true, Dados: jwt(Math.floor(Date.now() / 1000) + 86400) } }, { body: sample }]);
  await new CredifyVehicleProvider({ ...base, bodyTemplate: '{"consulta":{"placa":"{{plate}}"},"tipo":"x"}', fetchImpl: f }).queryByPlate('ABC1D23');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { consulta: { placa: 'ABC1D23' }, tipo: 'x' });
});

test('configuração de produção da Credify exige credenciais e corpo com {{plate}}', async () => {
  const { credifyBodyTemplateValid } = await import('../dist/config.js');
  assert.equal(credifyBodyTemplateValid('{"placa":"{{plate}}"}'), true);
  assert.equal(credifyBodyTemplateValid('{"placa":"fixa"}'), false);
  assert.equal(credifyBodyTemplateValid('nao-json'), false);
  assert.equal(credifyBodyTemplateValid(undefined), false);
});

test('falha de login guarda o motivo técnico (status e mensagem) sem expor chaves', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([{ status: 401, body: { Success: false, Message: 'IP nao autorizado' } }]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000'), (e) => {
    assert.equal(e.code, 'DATA_PROVIDER_AUTH_FAILED');
    assert.match(e.detail, /HTTP 401/); assert.match(e.detail, /IP nao autorizado/); assert.match(e.detail, /IPs Autorizados/);
    assert.ok(!e.detail.includes('segredo-teste')); return true;
  });
});

test('resposta que não é JSON ou sem o bloco RESPOSTA vira DATA_PROVIDER_INVALID_RESPONSE com detalhe', async () => {
  resetCredifyTokenCache();
  const tk = { body: { Success: true, Dados: jwt(Math.floor(Date.now() / 1000) + 86400) } };
  const html = async () => new Response('<html>Bad gateway</html>', { status: 200 });
  let n = 0;
  const f1 = async (url) => (String(url).endsWith('/auth') ? new Response(JSON.stringify(tk.body), { status: 200 }) : html());
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f1 }).queryByPlate('AAA0000'), (e) => { n++; assert.equal(e.code, 'DATA_PROVIDER_INVALID_RESPONSE'); assert.match(e.detail, /não é JSON/); return true; });
  resetCredifyTokenCache();
  const f2 = fakeFetch([tk, { body: { Message: 'Sem permissao' } }]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f2 }).queryByPlate('AAA0000'), (e) => { n++; assert.match(e.detail, /sem o bloco RESPOSTA/); assert.match(e.detail, /Sem permissao/); return true; });
  assert.equal(n, 2);
});

test('testConnection só faz o login e informa a validade do token', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const f = fakeFetch([{ body: { Success: true, Dados: jwt(Math.floor(now / 1000) + 24 * 3600) } }]);
  const out = await new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now }).testConnection();
  assert.equal(out.ok, true); assert.ok(out.expiresInMinutes > 1000);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].url.endsWith('/auth'));
  resetCredifyTokenCache();
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: fakeFetch([{ status: 403, body: {} }]) }).testConnection(), (e) => e.code === 'DATA_PROVIDER_AUTH_FAILED');
});

test('login: segredo só com dígitos recusado como texto (200 sem token) é reenviado como número', async () => {
  resetCredifyTokenCache();
  const t = jwt(Math.floor(Date.now() / 1000) + 86400);
  const f = fakeFetch([{ body: { Success: false, Message: 'LOGON OU SENHA INVALIDOS', Dados: false } }, { body: { Success: true, Dados: t } }]);
  const out = await new CredifyVehicleProvider({ ...base, clientSecret: '123456', fetchImpl: f }).testConnection();
  assert.equal(out.ok, true);
  assert.equal(JSON.parse(f.calls[0].init.body).ClientSecret, '123456');
  assert.equal(JSON.parse(f.calls[1].init.body).ClientSecret, 123456);
  resetCredifyTokenCache();
});

test('após 24 h o token vence e o próximo pedido faz um novo login sozinho', async () => {
  resetCredifyTokenCache();
  let now = Date.parse('2026-10-21T12:00:00Z');
  const t1 = jwt(Math.floor(now / 1000) + 24 * 3600);
  const t2 = jwt(Math.floor(now / 1000) + 48 * 3600);
  const f = fakeFetch([{ body: { Success: true, Dados: t1 } }, { body: sample }, { body: { Success: true, Dados: t2 } }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now });
  await p.queryByPlate('AAA0000');
  now += 23 * 3600_000 + 56 * 60_000; // faltam menos de 5 min: já renova
  await p.queryByPlate('AAA0000');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 2);
  assert.equal(f.calls[3].init.headers.authorization, `Bearer ${t2}`);
  resetCredifyTokenCache();
});

test('consultas simultâneas com token vencido fazem um único login', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const t = jwt(Math.floor(now / 1000) + 24 * 3600);
  const f = fakeFetch([{ body: { Success: true, Dados: t } }, { body: sample }, { body: sample }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now });
  await Promise.all([p.queryByPlate('AAA0000'), p.queryByPlate('BBB1111'), p.queryByPlate('CCC2222')]);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 1);
  resetCredifyTokenCache();
});

test('credenciais com espaço, quebra de linha ou aspas coladas são limpas antes do login', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const f = fakeFetch([{ body: { Success: true, Dados: jwt(Math.floor(now / 1000) + 24 * 3600) } }]);
  await new CredifyVehicleProvider({ ...base, clientId: ' "46905"\n', clientSecret: "  'abc123' \n", fetchImpl: f, now: () => now }).testConnection();
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { ClientID: '46905', ClientSecret: 'abc123' });
  resetCredifyTokenCache();
});
