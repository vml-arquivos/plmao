import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { ConsultarPlacaVehicleProvider, toBdrpEnvelope } = await import('../dist/providers/consultarPlacaProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { providerOutcome } = await import('../dist/report/normalizeV2.js');

const ok = {
  status: 'ok', mensagem: 'Consulta realizada com sucesso!', data_solicitacao: '2020-11-22 16:54:10',
  dados: { informacoes_veiculo: {
    dados_veiculo: { placa: 'AAA9999', chassi: '9AAAA99AAAA999999', ano_fabricacao: '2014', ano_modelo: '2015', marca: 'HYUNDAI', modelo: 'HYUNDAI/HB20 1.0M COMFOR', cor: 'Branca', segmento: 'Auto', especie: 'Passageiro', combustivel: 'Álcool / Gasolina', procedencia: 'Nacional', municipio: 'MARINGA', uf_municipio: 'PR' },
    dados_tecnicos: { tipo_veiculo: 'Automovel', numero_motor: 'A9AAAA999999', numero_caixa_cambio: 'AA999999999', potencia: '80', cilindradas: '998' },
    dados_carga: { numero_eixos: '2', capacidade_passageiro: '5' }
  } },
  request: { placa: 'AAA9999' }
};
function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); };
  fn.calls = calls;
  return fn;
}
const opts = (f) => ({ baseUrl: 'https://api.consultarplaca.test', email: 'dono@exemplo.com', apiKey: 'chave-teste', fetchImpl: f, timeoutMs: 2000 });
const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

test('chama GET com Basic Auth e converte para o formato interno', async () => {
  const f = fakeFetch(200, ok);
  const out = await new ConsultarPlacaVehicleProvider(opts(f)).queryByPlate('AAA9999');
  assert.equal(f.calls[0].url, 'https://api.consultarplaca.test/v2/consultarPlaca?placa=AAA9999');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.headers.authorization, `Basic ${Buffer.from('dono@exemplo.com:chave-teste').toString('base64')}`);
  assert.equal(out.raw.placa, 'AAA9999');
  assert.ok(providerOutcome(out.raw.data).ok);
  const r = out.raw.data.RESPOSTA.VEICULOSBDRP.RETORNO;
  assert.equal(r.MARCA, 'HYUNDAI');
  assert.equal(r.MODELO, 'HB20 1.0M COMFOR');
  assert.equal(r.MARCAMODELOCOMPLETO, 'HYUNDAI/HB20 1.0M COMFOR');
  assert.equal(r.VEIANOMODELO, '2015');
  assert.equal(r.UF, 'PR');
  assert.equal(r.RESRENAJUD, undefined, 'restrição não devolvida não pode virar "nada consta"');
  assert.equal(r.DEBIPVA, undefined);
});

test('relatório mostra restrições e débitos como não fornecidos', async () => {
  const env = toBdrpEnvelope('AAA9999', ok);
  const report = buildReportV2({ placa: 'AAA9999', data: env });
  assert.equal(report.headline.brand, 'HYUNDAI');
  assert.equal(report.coverage.restrictionsProvided, false);
  assert.equal(report.coverage.debtsProvided, false);
  assert.notEqual(report.verdict.level, 'CLEAR');
});

test('erros da fonte viram códigos internos', async () => {
  const cases = [
    [401, { status: 'erro' }, 'DATA_PROVIDER_AUTH_FAILED'],
    [403, { status: 'erro' }, 'DATA_PROVIDER_AUTH_FAILED'],
    [402, { status: 'erro', tipo_do_erro: 'credito_insuficiente' }, 'DATA_PROVIDER_QUOTA_EXHAUSTED'],
    [429, { status: 'erro' }, 'DATA_PROVIDER_RATE_LIMITED'],
    [200, { status: 'erro', tipo_do_erro: 'placa_nao_encontrada' }, 'NOT_FOUND'],
    [200, { status: 'erro', tipo_do_erro: 'servico_indisponivel' }, 'DATA_PROVIDER_UNAVAILABLE'],
    [500, { status: 'erro' }, 'DATA_PROVIDER_UNAVAILABLE'],
    [200, { status: 'ok', dados: {} }, 'DATA_PROVIDER_INVALID_RESPONSE']
  ];
  for (const [status, body, expected] of cases) {
    assert.equal(await code(new ConsultarPlacaVehicleProvider(opts(fakeFetch(status, body))).queryByPlate('AAA9999')), expected, `${status} ${JSON.stringify(body)}`);
  }
});

test('sem credenciais não chama a fonte', async () => {
  const f = fakeFetch(200, ok);
  assert.equal(await code(new ConsultarPlacaVehicleProvider({ ...opts(f), apiKey: '' }).queryByPlate('AAA9999')), 'DATA_PROVIDER_NOT_CONFIGURED');
  assert.equal(f.calls.length, 0);
});
