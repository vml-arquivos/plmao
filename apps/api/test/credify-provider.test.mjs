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
  await assert.rejects(new CredifyVehicleProvider({ ...base, path: '/outraconsulta', bodyTemplate: undefined, fetchImpl: f }).queryByPlate('AAA0000'), { code: 'DATA_PROVIDER_NOT_CONFIGURED' });
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

test('erro 400 da consulta mostra o corpo da Credify e o pedido enviado', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const tok = jwt(Math.floor(now / 1000) + 24 * 3600);
  const f = fakeFetch([{ body: { Success: true, Dados: tok } }, { status: 400, body: { queryId: 'x', errorMessage: 'O IdConsulta não é válido para este EndPoint' } }]);
  const p = new CredifyVehicleProvider({ ...base, path: '/veiculototal', bodyTemplate: undefined, fetchImpl: f, now: () => now });
  await assert.rejects(p.queryByPlate('AAA0000'), (e) => e.code === 'DATA_PROVIDER_UNAVAILABLE' && /HTTP 400/.test(e.detail) && /não é válido para este EndPoint/.test(e.detail) && /pedido enviado a \/veiculototal/.test(e.detail) && /"Placa":"AAA0000"/.test(e.detail));
  resetCredifyTokenCache();
});

test('IdConsulta é o código fixo de cada consulta da Credify; CREDIFY_QUERY_ID/consultaId troca o código; sem código conhecido não chama', async () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const tok = jwt(Math.floor(now / 1000) + 24 * 3600);
  const tpl = '{"Consulta":{"IdConsulta":"{{queryId}}","Placa":"{{plate}}"}}';
  const run = async (opts) => {
    resetCredifyTokenCache();
    const f = fakeFetch([{ body: { Success: true, Dados: tok } }, { body: sample }, { body: sample }]);
    const p = new CredifyVehicleProvider({ ...base, bodyTemplate: tpl, fetchImpl: f, now: () => now, ...opts });
    await p.queryByPlate('AAA0000'); await p.queryByPlate('BBB1111');
    return f.calls.filter((c) => !c.url.endsWith('/auth')).map((c) => JSON.parse(c.init.body).Consulta.IdConsulta);
  };
  assert.deepEqual(await run({ path: '/debitosrestricoesproprietarios' }), ['487', '487']); // não muda a cada consulta
  assert.deepEqual(await run({ path: '/veiculototal' }), ['467', '467']);
  assert.deepEqual(await run({ path: '/veicularbnacionalonline' }), ['369', '369']);
  assert.deepEqual(await run({ path: '/leilaoconjugado' }), ['448', '448']);
  assert.deepEqual(await run({ path: '/gravame' }), ['533', '533']);
  assert.deepEqual(await run({ path: '/debitosrestricoesproprietarios', consultaId: '999' }), ['999', '999']);
  resetCredifyTokenCache();
  const f = fakeFetch([]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, path: '/outraconsulta', bodyTemplate: tpl, fetchImpl: f }).queryByPlate('AAA0000'), (e) => e.code === 'DATA_PROVIDER_NOT_CONFIGURED' && /CREDIFY_QUERY_ID/.test(e.detail));
  assert.equal(f.calls.length, 0);
});

test('cada pacote usa a consulta certa da Credify: Completa = Veículo Total (467); Básica/Gravame/Cadastral = Débitos e Restrições (487); CREDIFY_QUERY_PATH global vale para todos', async () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const tok = jwt(Math.floor(now / 1000) + 24 * 3600);
  const run = async (productId, opts = {}) => {
    resetCredifyTokenCache();
    const f = fakeFetch([{ body: { Success: true, Dados: tok } }, { body: sample }]);
    const p = new CredifyVehicleProvider({ ...base, path: undefined, bodyTemplate: undefined, fetchImpl: f, now: () => now, ...opts });
    await p.queryByPlate('AAA0000', { productId });
    const c = f.calls.find((x) => !x.url.endsWith('/auth'));
    return { url: c.url.replace('https://api.credify.test', ''), body: JSON.parse(c.init.body) };
  };
  assert.deepEqual(await run('COMPLETE'), { url: '/veiculototal', body: { Consulta: { IdConsulta: '467', Placa: 'AAA0000' } } });
  for (const id of ['BASIC', 'LIEN', 'CADASTRAL']) assert.deepEqual(await run(id), { url: '/debitosrestricoesproprietarios', body: { Consulta: { IdConsulta: '487', Placa: 'AAA0000' } } });
  assert.equal((await run(undefined)).url, '/veiculototal'); // sem pacote: consulta padrão
  assert.equal((await run('COMPLETE', { path: '/debitosrestricoesproprietarios' })).body.Consulta.IdConsulta, '487'); // caminho global ganha
  resetCredifyTokenCache();
});

test('token com mais de 3 minutos é trocado por um login novo antes de consultar', async () => {
  resetCredifyTokenCache();
  let now = Date.parse('2026-10-21T12:00:00Z');
  const t1 = jwt(Math.floor(now / 1000) + 24 * 3600); const t2 = jwt(Math.floor(now / 1000) + 25 * 3600);
  const f = fakeFetch([{ body: { Success: true, Dados: t1 } }, { body: sample }, { body: { Success: true, Dados: t2 } }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now });
  await p.queryByPlate('AAA0000');
  now += 4 * 60_000;
  await p.queryByPlate('AAA0000');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 2);
  assert.equal(f.calls[3].init.headers.authorization, `Bearer ${t2}`);
  resetCredifyTokenCache();
});

test('login com falha de servidor é repetido e a consulta segue', async () => {
  resetCredifyTokenCache();
  const t = jwt(Math.floor(Date.now() / 1000) + 86400);
  const f = fakeFetch([{ status: 503, body: { Message: 'indisponível' } }, { body: { Success: true, Dados: t } }, { body: sample }]);
  const out = await new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000');
  assert.equal(out.raw.placa, 'AAA0000');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 2);
  resetCredifyTokenCache();
});

test('login fora do ar com token anterior ainda válido: a consulta usa o token anterior', async () => {
  resetCredifyTokenCache();
  let now = Date.parse('2026-10-21T12:00:00Z');
  const t = jwt(Math.floor(now / 1000) + 24 * 3600);
  const down = { status: 503, body: {} };
  const f = fakeFetch([{ body: { Success: true, Dados: t } }, { body: sample }, down, down, down, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now });
  await p.queryByPlate('AAA0000');
  now += 10 * 60_000;
  const out = await p.queryByPlate('AAA0000');
  assert.equal(out.raw.placa, 'AAA0000');
  assert.equal(f.calls[f.calls.length - 1].init.headers.authorization, `Bearer ${t}`);
  resetCredifyTokenCache();
});

test('200 com mensagem de token vencido: entra de novo e repete a consulta uma vez', async () => {
  resetCredifyTokenCache();
  const t1 = jwt(Math.floor(Date.now() / 1000) + 86400); const t2 = jwt(Math.floor(Date.now() / 1000) + 90000);
  const f = fakeFetch([{ body: { Success: true, Dados: t1 } }, { body: { Success: false, Message: 'Token expirado' } }, { body: { Success: true, Dados: t2 } }, { body: sample }]);
  const out = await new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000');
  assert.equal(out.raw.placa, 'AAA0000');
  assert.equal(f.calls[3].init.headers.authorization, `Bearer ${t2}`);
  resetCredifyTokenCache();
});

test('consulta sem resposta descarta o token: a próxima começa com login novo', async () => {
  resetCredifyTokenCache();
  const t1 = jwt(Math.floor(Date.now() / 1000) + 86400); const t2 = jwt(Math.floor(Date.now() / 1000) + 90000);
  const f = fakeFetch([{ body: { Success: true, Dados: t1 } }, new Error('timeout'), { body: { Success: true, Dados: t2 } }, { body: sample }]);
  const p = new CredifyVehicleProvider({ ...base, fetchImpl: f });
  await assert.rejects(p.queryByPlate('AAA0000'), (e) => e.code === 'PROVIDER_TIMEOUT');
  await p.queryByPlate('AAA0000');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/auth')).length, 2);
  resetCredifyTokenCache();
});

test('CODIGO=2 em consulta que não é Veículo Total é "nada encontrado" (estorna sem acusar falha técnica)', async () => {
  resetCredifyTokenCache();
  const now = Date.parse('2026-10-21T12:00:00Z');
  const token = jwt(Math.floor(now / 1000) + 24 * 3600);
  const none = { CONSULTA: { CODIGORESPOSTA: '1' }, RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: 'NAO ENCONTRADO' } };
  const f = fakeFetch([{ body: { Success: true, Dados: token } }, { body: none }]);
  await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f, now: () => now }).queryByPlate('AAA0000'), { code: 'NOT_FOUND' });
  resetCredifyTokenCache();
});

test('códigos 14 a 19 da Credify viram erro claro, sem tratar como resposta inválida genérica', async () => {
  const cases = [['14', 'DATA_PROVIDER_RATE_LIMITED'], ['15', 'DATA_PROVIDER_QUOTA_EXHAUSTED'], ['18', 'DATA_PROVIDER_QUOTA_EXHAUSTED'], ['19', 'DATA_PROVIDER_INVALID_RESPONSE']];
  for (const [codigo, esperado] of cases) {
    resetCredifyTokenCache();
    const t = jwt(Math.floor(Date.now() / 1000) + 86400);
    const f = fakeFetch([{ body: { Success: true, Dados: t } }, { body: { RESPOSTA: { CODIGO: codigo, MSG: 'limite do logon' } } }]);
    await assert.rejects(new CredifyVehicleProvider({ ...base, fetchImpl: f }).queryByPlate('AAA0000'), (e) => {
      assert.equal(e.code, esperado);
      assert.match(String(e.detail ?? e.message), new RegExp(`código ${codigo}`));
      return true;
    });
  }
  resetCredifyTokenCache();
});
