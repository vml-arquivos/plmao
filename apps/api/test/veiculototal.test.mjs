import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2, viewReport, providerOutcome, extractReturn } = await import('../dist/report/normalizeV2.js');
const { normalizeBdrp } = await import('../dist/normalizer.js');

const read = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const ok = read('veiculototal-sucesso.json');
const notFound = read('veiculototal-nao-encontrada.json');
const legacy = read('exemplo-retorno-provedor.json');
const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const item = (report, key) => report.sections.flatMap((s) => s.items).find((i) => i.key === key);
const withBlock = (name, patch, code) => { const x = structuredClone(ok); x.RESPOSTA[name] = patch; if (code) { const i = ['INDICIOSINISTROVEICULAR', 'RECALL', 'HISTORICOROUBOFURTO', 'LEILAOCONJUGADO', 'HISTORICOPROPRIETARIO', 'VEICULARBNACIONAL', 'PRECIFICADORFIPE', 'VEICULOSBDRP'].indexOf(name); x.RESPOSTA.CODIGO[i] = code; } return x; };

function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); const h = handlers.shift(); if (!h) throw new Error('chamada inesperada'); return new Response(JSON.stringify(h.body ?? {}), { status: h.status ?? 200 }); };
  fn.calls = calls; return fn;
}

test('resposta de exemplo da Credify: sucesso, relatório completo com blocos extras', () => {
  assert.deepEqual(providerOutcome(ok), { ok: true });
  const r = buildReportV2(ok);
  assert.equal(r.plate, 'ABC1234');
  assert.equal(r.headline.brand, 'VOLKSWAGEN');
  assert.equal(item(r, 'VT_PLACA_MERCOSUL').value, 'ABC1A34');
  // blocos extras
  assert.equal(item(r, 'VT_SINISTRO').state, 'CLEAR');
  assert.equal(item(r, 'VT_ROUBOFURTO').state, 'CLEAR');
  assert.equal(item(r, 'VT_LEILAO').state, 'CLEAR');
  // recall com código 2 ("não foi possível localizar") NÃO é "sem recall": fica não informado
  assert.equal(item(r, 'VT_RECALL').state, 'NOT_PROVIDED');
  assert.equal(item(r, 'VT_FIPE_PRECO').display, 'R$ 32.500,00');
  assert.equal(item(r, 'VT_FIPE_VIGENCIA').value, '06/2026');
  assert.equal(item(r, 'VT_PROPRIETARIOS_QTD').value, '2');
  assert.ok(r.sections.some((s) => s.key === 'HISTORICO') && r.sections.some((s) => s.key === 'FIPE'));
});

test('campos que o BDRP deixa vazio são completados com a base nacional (sem sobrescrever o BDRP)', () => {
  const x = structuredClone(ok);
  const ret = x.RESPOSTA.VEICULOSBDRP.RETORNO;
  const bdrpModel = ret.MODELO;
  delete ret.MARCA; ret.COR = ''; delete ret.MARCAMODELOCOMPLETO;
  const r = buildReportV2(x);
  assert.equal(r.headline.brand, 'VW');
  assert.equal(r.headline.color, 'PRATA');
  assert.equal(r.headline.model, bdrpModel);
});

test('histórico de proprietários: o cliente nunca vê nome ou documento; a equipe vê só mascarado', () => {
  const r = buildReportV2(ok);
  const team = viewReport(r, { audience: 'team', tier: 3 });
  const lista = team.sections.flatMap((s) => s.items).find((i) => i.key === 'VT_PROPRIETARIOS_LISTA');
  assert.ok(lista.value.includes('JOAO'));
  assert.ok(!lista.value.includes('SILVA') && !lista.value.includes('12345678900') && !lista.value.includes('98765432000110'));
  const client = viewReport(r, { audience: 'client', tier: 3 });
  const json = JSON.stringify(client);
  assert.ok(!json.includes('VT_PROPRIETARIOS_LISTA') && !json.includes('JOAO') && !json.includes('SANTOS'));
  assert.ok(json.includes('VT_PROPRIETARIOS_QTD'));
});

test('roubo/furto, leilão e sinistro encontrados viram alerta (roubo/furto = alto risco)', () => {
  const theft = buildReportV2(withBlock('HISTORICOROUBOFURTO', { DESCRICAORETORNO: 'VEICULO COM REGISTRO DE ROUBO' }, '1'));
  assert.equal(item(theft, 'VT_ROUBOFURTO').state, 'ALERT');
  assert.equal(theft.verdict.level, 'HIGH_RISK');
  const auction = buildReportV2(withBlock('LEILAOCONJUGADO', { DESCRICAORETORNO: 'VEICULO LOCALIZADO EM LEILAO' }, '1'));
  assert.equal(item(auction, 'VT_LEILAO').state, 'ALERT');
  assert.notEqual(auction.verdict.level, 'CLEAR');
  const sin = buildReportV2(withBlock('INDICIOSINISTROVEICULAR', { DESCRICAORETORNO: 'Sucesso', INDICIODESINISTRO: '1' }));
  assert.equal(item(sin, 'VT_SINISTRO').state, 'ALERT');
});

test('bloco com erro (código 3) nunca vira "sem ocorrência"', () => {
  const r = buildReportV2(withBlock('HISTORICOROUBOFURTO', { DESCRICAORETORNO: 'ERRO' }, '3'));
  assert.equal(item(r, 'VT_ROUBOFURTO').state, 'NOT_PROVIDED');
  const f = buildReportV2(withBlock('PRECIFICADORFIPE', { DESCRICAORETORNO: 'ERRO' }, '3'));
  assert.equal(item(f, 'VT_FIPE_PRECO').state, 'NOT_PROVIDED');
});

test('placa não encontrada (CODIGO ["2"]) e falha do bloco principal', () => {
  const o = providerOutcome(notFound);
  assert.equal(o.ok, false); assert.equal(o.notFound, true);
  assert.throws(() => buildReportV2(notFound));
  // BDRP com erro = resposta inválida (estorno), não "não encontrada"
  const bad = structuredClone(ok); bad.RESPOSTA.CODIGO[7] = '3';
  const bo = providerOutcome(bad); assert.equal(bo.ok, false); assert.ok(!bo.notFound);
  const bad2 = structuredClone(ok); bad2.RESPOSTA.VEICULOSBDRP.RETORNO.EXISTE_ERRO = '1';
  assert.equal(providerOutcome(bad2).ok, false);
});

test('consulta antiga (só VEICULOSBDRP) continua igual: sem seções ou campos novos', () => {
  const r = buildReportV2(legacy);
  assert.ok(!r.sections.some((s) => s.key === 'HISTORICO' || s.key === 'FIPE'));
  assert.ok(!r.sections.flatMap((s) => s.items).some((i) => i.key.startsWith('VT_')));
});

test('normalizeBdrp (formato legado) lê o Veículo Total sem quebrar', () => {
  const n = normalizeBdrp(ok);
  assert.equal(n.identification.plate, 'ABC1234');
  assert.equal(n.identification.brand, 'VOLKSWAGEN');
  assert.equal(n.v2.plate, 'ABC1234');
  assert.ok(extractReturn({ placa: 'ABC1234', data: ok }).MARCA);
});

test('provider: chama /veiculototal com IdConsulta e Placa, Bearer, e devolve o protocolo', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([{ body: { Success: true, Dados: jwt } }, { body: ok }]);
  const out = await new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: 's', fetchImpl: f, timeoutMs: 2000 }).queryByPlate('ABC1D23');
  assert.equal(f.calls[1].url, 'https://api.credify.test/veiculototal');
  assert.equal(f.calls[1].init.headers.authorization, `Bearer ${jwt}`);
  const body = JSON.parse(f.calls[1].init.body);
  assert.equal(body.Consulta.Placa, 'ABC1D23');
  assert.match(body.Consulta.IdConsulta, /^\d{7,10}$/);
  assert.equal(out.raw.idConsulta, body.Consulta.IdConsulta);
  assert.equal(out.providerQueryId, '100000001');
  assert.equal(buildReportV2(out.raw).plate, 'ABC1234');
});

test('provider: placa não encontrada vira NOT_FOUND; resposta sem RESPOSTA é inválida', async () => {
  resetCredifyTokenCache();
  const mk = (body) => new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: 's', fetchImpl: fakeFetch([{ body: { Success: true, Dados: jwt } }, { body }]), timeoutMs: 2000 });
  await assert.rejects(mk(notFound).queryByPlate('ABC1D23'), { code: 'NOT_FOUND' });
  resetCredifyTokenCache();
  await assert.rejects(mk({ Message: 'algo' }).queryByPlate('ABC1D23'), { code: 'DATA_PROVIDER_INVALID_RESPONSE' });
});

test('provider: segredo só com números recusado como texto é reenviado como número', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([{ status: 401, body: { Message: 'LOGON OU SENHA INVALIDOS' } }, { body: { Success: true, Dados: jwt } }, { body: ok }]);
  await new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: '123456', fetchImpl: f, timeoutMs: 2000 }).queryByPlate('ABC1D23');
  assert.equal(JSON.parse(f.calls[0].init.body).ClientSecret, '123456');
  assert.equal(JSON.parse(f.calls[1].init.body).ClientSecret, 123456);
});

test('BDRP ausente ou com erro continua sendo resposta inválida (estorno), mesmo com a base nacional presente', () => {
  const x = structuredClone(ok);
  delete x.RESPOSTA.VEICULOSBDRP;
  assert.equal(providerOutcome(x).ok, false);
  const y = structuredClone(ok);
  y.RESPOSTA.CODIGO = y.RESPOSTA.CODIGO.map((c, i) => (i === 7 ? '3' : c));
  assert.equal(providerOutcome(y).ok, false);
});
