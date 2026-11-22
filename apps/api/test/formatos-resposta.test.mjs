import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { isVehicleTotal } = await import('../dist/report/vehicleTotal.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const consulta = (id) => ({ CODIGORESPOSTA: '1', DATAHORA: '01/01/2026 10:00:00', LOGON: '1', IDCONSULTA: id });
const ok = (id, resposta) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '1', ...resposta } });
const absent = (id, text) => ({ CONSULTA: consulta(id), RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: text } });

/** Resposta por caminho; registra cada chamada. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const h = routes[path];
    if (!h) throw new Error(`chamada inesperada: ${path}`);
    if (h.status && h.status >= 400) return new Response('{}', { status: h.status });
    return new Response(JSON.stringify(h.body ?? h), { status: 200 });
  };
  fn.calls = calls;
  fn.paid = () => calls.filter((c) => c !== '/auth');
  return fn;
}
const opts = (fetchImpl) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid', clientSecret: 'sec', method: 'post', timeoutMs: 3000, fetchImpl });
const withFlags = (flags) => { const c = structuredClone(sample); Object.assign(c.RESPOSTA.VEICULOSBDRP.RETORNO, flags); return c; };

const SINISTRO_LIMPO = ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '0' });
const SINISTRO_ALERTA = ok('450', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '1' });
const NACIONAL = ok('369', { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', MARCA: 'VW', MODELO: 'GOL', RESTRICAO1: 'SEM RESTRICAO', RESTRICAO2: 'SEM RESTRICAO', SITUACAO_CHASSI: 'NORMAL', ULTIMA_ATUALIZACAO: '07/06/2026' });
const LEILAO_NADA = absent('448', 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.');


const CAMPOS_NACIONAL = { DESCRICAORETORNO: 'SUCESSO', PLACA: 'AAA0000', CHASSI: '9BWZZZ377VT004251', MARCA: 'VW', MODELO: 'GOL', RESTRICAO1: 'SEM RESTRICAO', RESTRICAO2: 'SEM RESTRICAO', SITUACAO_CHASSI: 'NORMAL', ULTIMA_ATUALIZACAO: '07/06/2026' };

/** Cada consulta pode vir direto na RESPOSTA ou dentro de um bloco com o nome publicado na documentação da Credify. */
const FORMAS_NACIONAL = {
  direto: () => ok('369', CAMPOS_NACIONAL),
  'bloco VEICULARBNACIONALONLINE': () => ok('369', { VEICULARBNACIONALONLINE: CAMPOS_NACIONAL }),
  'bloco VEICULARBNACIONAL': () => ok('369', { VEICULARBNACIONAL: CAMPOS_NACIONAL }),
  'bloco VEICULARBNACIONAL com REGISTRO_1': () => ok('369', { VEICULARBNACIONAL: { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: CAMPOS_NACIONAL } })
};
const FORMAS_SINISTRO = {
  direto: () => ok('450', { DESCRICAORETORNO: 'SUCESSO', INDICIODESINISTRO: '1' }),
  'bloco INDICIOSINISTROVEICULAR': () => ok('450', { INDICIOSINISTROVEICULAR: { DESCRICAORETORNO: 'SUCESSO', INDICIODESINISTRO: '1' } })
};
const LEILAO_COM_DADOS = { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { IDLEILAO: '48211', LOTE: '0137', LEILOEIRO: 'LEILOEIRO EXEMPLO', DATALEILAO: '2025-03-14', COMITENTE: 'SEGURADORA EXEMPLO', CONDICAOGERALDOVEICULO: 'RECUPERAVEL' } };
const FORMAS_LEILAO = {
  direto: () => ok('448', LEILAO_COM_DADOS),
  'bloco LEILAOCONJUGADO': () => ok('448', { LEILAOCONJUGADO: LEILAO_COM_DADOS })
};

for (const [nNac, nacional] of Object.entries(FORMAS_NACIONAL)) for (const [nSin, sinistro] of Object.entries(FORMAS_SINISTRO)) for (const [nLei, leilao] of Object.entries(FORMAS_LEILAO)) {
  test(`Completa: nacional (${nNac}) + sinistro (${nSin}) + leilão (${nLei}) entregam todos os dados, sem 424 e sem chamada fora do contrato`, async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': sinistro(), '/veicularbnacionalonline': nacional(), '/leilaoconjugado': leilao() });
    const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
    assert.deepEqual([...f.paid()].sort(), ['/debitosrestricoesproprietarios', '/indiciosinistro', '/leilaoconjugado', '/veicularbnacionalonline']);
    const items = new Map(buildReportV2(out.raw).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
    assert.equal(items.get('VT_SINISTRO').state, 'ALERT', 'sinistro');
    assert.equal(items.get('VT_LEILAO').state, 'ALERT', 'leilão');
    assert.equal(items.get('VN_SITUACAO_CHASSI')?.state, 'CLEAR', 'base nacional com dados');
  });
}

test('data de inclusão da restrição vinda da base principal aparece como dd/mm/aaaa (AAAAMMDD, ISO e dd/mm/aaaa)', () => {
  for (const [entrada, esperado] of [['20240220', '20/02/2024'], ['2024-02-20', '20/02/2024'], ['20/02/2024', '20/02/2024']]) {
    const raw = withFlags({ RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: 'BANCO EXEMPLO S.A.', CGCFINANCEIRA: '00000000000191', NUMEROCONTRATOFINANCEIRA: '0045-9981234-7', RESTRICAODATAINCLUSAO: entrada });
    const rep = buildReportV2(raw);
    const item = rep.sections.flatMap((s) => s.items).find((i) => i.key === 'RESTRICAODATAINCLUSAO');
    assert.ok(item, 'campo presente');
    assert.equal(item.display, esperado);
  }
});

const RECALL_CAMPOS = { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { DATAINICIOCAMPANHA: '04/03/2024', MONTADORA: 'HONDA AUTOMOVEIS DO BRASIL', IDGRAVIDADE: '3', INDICATIVO: 'GRANDE IMPORTANCIA', SUJEITOACONFIRMACAOPELAMONTADORA: 'SIM', FONECONFIRMACAO: '0800 000 0000', MARCAMODELO: 'HONDA/CIVIC' } };
const FORMAS_RECALL = {
  'RESPOSTA.RECALL': () => ok('452', { RECALL: RECALL_CAMPOS }),
  'CODIGO e RECALL dentro de CONSULTA (como a documentação mostra)': () => ({ CONSULTA: { CODIGO: '1', RECALL: RECALL_CAMPOS } })
};
for (const [nome, recall] of Object.entries(FORMAS_RECALL)) {
  test(`recall (${nome}): a consulta paga entrega a campanha no relatório`, async () => {
    resetCredifyTokenCache();
    const f = fakeFetch({ '/debitosrestricoesproprietarios': withFlags({ RECALL: 'POSSUI RECALL' }), '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/recall': recall() });
    const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'COMPLETE' });
    assert.ok(f.paid().includes('/recall'), 'recall consultado');
    const texto = JSON.stringify(buildReportV2(out.raw));
    assert.ok(/HONDA AUTOMOVEIS DO BRASIL/.test(texto), 'campanha de recall no relatório');
  });
}

test('infrações (RENAINF) no formato publicado: lista em DEBITOS, local e data da multa, situação "opened" como Em aberto', async () => {
  resetCredifyTokenCache();
  const renainf = ok('536', { RENAINF: { PLACA: 'AAA0000', RESTRICOES: { INDICADOR_RENAINF: 'TRUE' }, DEBITOS: [
    { TOTAL: '195.23', MULTA: '195.23', DATA_VENCIMENTO: '10/12/2026', DESCRICAO: 'EXCESSO DE VELOCIDADE', STATUS_PAGAMENTO: 'opened', TIPO: '3', DADOS_EXTRAS: [{ GRUPO: 'Detalhamento Multa', CHAVE: 'Local', EXTRA1: 'AV BRASIL, 1000', EXTRA2: '', EXTRA3: '' }, { GRUPO: 'Detalhamento Multa', CHAVE: 'Data e Hora', EXTRA1: '01/11/2026 08:15', EXTRA2: '', EXTRA3: '' }] }
  ] } });
  const f = fakeFetch({ '/debitosrestricoesproprietarios': sample, '/indiciosinistro': SINISTRO_LIMPO, '/veicularbnacionalonline': NACIONAL, '/leilaoconjugado': LEILAO_NADA, '/renainf': renainf });
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('AAA0000', { productId: 'BASIC', sources: ['SINISTRO', 'NATIONAL', 'AUCTION', 'RENAINF'] });
  assert.ok(f.paid().includes('/renainf'), 'renainf consultado');
  const alvo = JSON.stringify(buildReportV2(out.raw));
  assert.ok(/EXCESSO DE VELOCIDADE/.test(alvo), 'multa no relatório');
  assert.ok(/Em aberto/.test(alvo), 'situação em português');
  assert.ok(!/"opened"/.test(alvo), 'sem opened cru');
  assert.ok(/Local: AV BRASIL, 1000/.test(alvo), 'local da multa');
  assert.ok(/Data e Hora: 01\/11\/2026 08:15/.test(alvo), 'data e hora da multa');
});

test('modelo vazio no cadastro e na base nacional: usa o modelo da FIPE em vez de ficar em branco', () => {
  const raw = structuredClone(JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8')));
  raw.RESPOSTA.VEICULOSBDRP.RETORNO.MODELO = '';
  raw.RESPOSTA.VEICULARBNACIONAL.REGISTRO_1.MODELO = '';
  const item = buildReportV2(raw).sections.flatMap((s) => s.items).find((i) => i.key === 'MODELO');
  assert.equal(item?.value, 'GOL 1.0 FLEX 4P');
});
