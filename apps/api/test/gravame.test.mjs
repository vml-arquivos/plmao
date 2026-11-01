import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { lienRecords, distance, parseDate } = await import('../dist/report/gravame.js');

const ok = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const item = (r, key) => r.sections.flatMap((s) => s.items).find((i) => i.key === key);
const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const GRAV = (g) => ({ CONSULTA: { IDCONSULTA: '533' }, RESPOSTA: { CODIGO: '1', GRAVAME: { PLACA: 'ABC1234', CHASSI: '9BWZZZ377VT004251', MARCA_MODELO: 'VW/GOL', GRAVAMES: g } } });
const lien = { NUMERO_RESTRICAO: '123456', DATA_RESTRICAO: '2023-03-15', ESTADO_RESTRICAO: 'SP', STATUS: 'ATIVO', CODIGO_AGENTE: '33', NOME_AGENTE: 'BANCO ITAU S.A.', DOCUMENTO_AGENTE: '60701190000104', DATA_CONTRATO: '2023-03-10', ESTADO_CONTRATO: 'SP', NUMERO_CONTRATO: 'CT-998877' };
// Veículo Total com a base de gravame (BDRP) vazia, como na consulta que falhou em produção.
const noBdrp = () => { const x = structuredClone(ok); x.RESPOSTA.CODIGO = ['2', '1', '1', '1', '1', '1', '2', '2']; x.RESPOSTA.VEICULOSBDRP = { DESCRICAORETORNO: 'NAO FOI POSSIVEL LOCALIZAR', RETORNO: {} }; return x; };
const RENA = (rec) => ({ CONSULTA: { IDCONSULTA: '483' }, RESPOSTA: { CODIGO: '1', DESCRICAORETORNO: 'SUCESSO', RENAJUD: { CONSTARESTRICAORENAJUD: Object.keys(rec).length ? 'SIM' : 'NAO', PLACA: 'ABC1D34', QTDOCORRENCIAS: String(Object.keys(rec).length), ...rec } } });
const judicialRec = { CHAVERETORNO: '1', OCORRENCIA: '1', TIPORESTRICJUDICIAL: 'BUSCA E APREENSAO', CODIGOTRIBUNAL: '10', NOMETRIBUNAL: 'TJSP', CODIGOORGAOJUDICIAL: '55', NOMEORGAOJUDICIAL: '2A VARA CIVEL SAO PAULO', NUMERODOPROCESSO: '1002345-67.2024.8.26.0100', DATADAINCLUSAO: '2024-05-20' };
const rawWith = (g) => ({ placa: 'ABC1234', idConsulta: '467', data: noBdrp(), ...(g ? { gravame: g } : {}) });

test('lista do /gravame: aceita objeto REGISTRO_n, lista, registro único e ignora vazios', () => {
  assert.equal(lienRecords({ data: GRAV({ REGISTRO_1: lien, REGISTRO_2: { ...lien, NUMERO_CONTRATO: 'B' } }) }).length, 2);
  assert.equal(lienRecords({ data: GRAV([lien]) }).length, 1);
  assert.equal(lienRecords({ data: GRAV(lien) }).length, 1);
  assert.equal(lienRecords({ data: GRAV({}) }).length, 0);
  assert.equal(lienRecords({ data: GRAV([{ NUMERO_RESTRICAO: '', NOME_AGENTE: '' }]) }).length, 0);
});

test('datas e tempo: passado em anos e meses, futuro como prazo restante', () => {
  const now = new Date(Date.UTC(2026, 10, 1, 12));
  assert.equal(distance(parseDate('2023-03-10'), now).text, 'há 3 anos e 7 meses');
  assert.deepEqual(distance(parseDate('15/05/2028'), now), { text: 'faltam 1 ano e 6 meses', future: true });
  assert.equal(parseDate('15-MAR-21').getUTCFullYear(), 2021);
  assert.equal(parseDate('lixo'), null);
});

test('Completa com base de gravame vazia + /gravame com gravame: banco, CNPJ, contrato, tempo e alerta', () => {
  const r = buildReportV2(rawWith({ data: GRAV({ REGISTRO_1: lien }) }));
  assert.equal(item(r, 'RESTRICAOFINAN').state, 'ALERT');
  assert.equal(item(r, 'RESTRICAONOMEAGENTE').value, 'BANCO ITAU S.A.');
  assert.equal(item(r, 'CGCFINANCEIRA').value, '60.701.190/0001-04');
  assert.equal(item(r, 'NUMEROCONTRATOFINANCEIRA').value, 'CT-998877');
  assert.match(item(r, 'GR_SITUACAO').value, /Há gravame \/ alienação fiduciária — BANCO ITAU S\.A\./);
  assert.match(item(r, 'GR_DETALHES').value, /Banco\/financeira: BANCO ITAU S\.A\. \(CNPJ 60701190000104\) · contrato nº CT-998877 · restrição nº 123456 · gravame incluído em 15\/03\/2023 \(há \d+ anos? e \d+ m/);
  assert.match(item(r, 'GR_VALORES').value, /não informam saldo devedor, valor financiado, parcelas/);
  assert.ok(r.verdict.level !== 'CLEAR', 'gravame ativo pesa no veredito');
});

test('/gravame sem registros: "sem gravame"; sem resposta do /gravame: "não informado", nunca "nada consta"', () => {
  const none = buildReportV2(rawWith({ data: GRAV({}) }));
  assert.equal(item(none, 'RESTRICAOFINAN').state, 'CLEAR');
  assert.match(item(none, 'GR_SITUACAO').value, /Sem gravame/);
  const nf = buildReportV2(rawWith({ notFound: true }));
  assert.match(item(nf, 'GR_SITUACAO').value, /Sem gravame/);
  const un = buildReportV2(rawWith({ unavailable: true }));
  assert.match(item(un, 'GR_SITUACAO').value, /Não informado pela fonte/);
  assert.equal(item(un, 'RESTRICAOFINAN').state, 'NOT_PROVIDED');
  const sem = buildReportV2(rawWith(undefined));
  assert.match(item(sem, 'GR_SITUACAO').value, /não equivale a “nada consta”/);
});

test('BDRP com gravame (campos da própria consulta): prazo restante pela vigência e resumo com banco', () => {
  const x = structuredClone(ok);
  Object.assign(x.RESPOSTA.VEICULOSBDRP.RETORNO, { RESTRICAOFINAN: 'ALIENACAO FIDUCIARIA', RESTRICAONOMEAGENTE: 'BANCO BRADESCO S.A.', CGCFINANCEIRA: '60746948000112', NUMEROCONTRATOFINANCEIRA: '555', RESTRICAODATAINCLUSAO: '10/01/2024', DATAVIGENCIACONTRATOFINANCEIRA: '10/01/2030' });
  const r = buildReportV2({ placa: 'ABC1234', data: x });
  assert.match(item(r, 'GR_SITUACAO').value, /BANCO BRADESCO S\.A\./);
  assert.match(item(r, 'GR_DETALHES').value, /contrato nº 555/);
  assert.match(item(r, 'GR_PRAZO').value, /Contrato vigente até 10\/01\/2030 \(faltam/);
});

test('veículo sem gravame na base própria: resumo limpo e sem aviso de valores', () => {
  const r = buildReportV2({ placa: 'ABC1234', data: ok });
  assert.match(item(r, 'GR_SITUACAO').value, /Sem gravame/);
  assert.equal(item(r, 'GR_VALORES'), undefined);
});

function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), body: init?.body ? String(init.body) : '' }); const h = handlers.shift(); if (!h) throw new Error('chamada inesperada'); if (h instanceof Error) throw h; return new Response(JSON.stringify(h.body ?? {}), { status: h.status ?? 200, headers: { 'content-type': 'application/json' } }); };
  fn.calls = calls; return fn;
}
const login = { body: { Success: true, Dados: jwt } };
const opts = (f) => ({ baseUrl: 'https://api.credify.test', clientId: 'cid-teste', clientSecret: 'segredo-teste', method: 'post', timeoutMs: 2000, fetchImpl: f });

test('provedor: Completa com BDRP vazio chama o /gravame (533) uma vez e anexa a resposta', async () => {
  resetCredifyTokenCache();
  const f = fakeFetch([login, { body: noBdrp() }, { body: GRAV({ REGISTRO_1: lien }) }, { body: RENA({}) }]);
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  const paid = f.calls.filter((c) => !c.url.endsWith('/auth'));
  assert.equal(paid.length, 3, 'Total + /gravame + /renajud (base de restrições vazia)');
  assert.match(paid[0].url, /\/veiculototal$/); assert.match(paid[0].body, /"IdConsulta":"467"/);
  assert.match(paid[1].url, /\/gravame$/); assert.match(paid[1].body, /"IdConsulta":"533"/); assert.match(paid[1].body, /ABC1D34/);
  assert.ok(out.raw.gravame.data.RESPOSTA.GRAVAME);
  assert.equal(lienRecords(out.raw.gravame).length, 1);
});

test('provedor: com BDRP preenchido, ou em outro pacote, não faz a chamada extra; falha do /gravame não derruba a consulta', async () => {
  resetCredifyTokenCache();
  const f1 = fakeFetch([login, { body: ok }]);
  const a = await new CredifyVehicleProvider(opts(f1)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  assert.equal(f1.calls.filter((c) => !c.url.endsWith('/auth')).length, 1); assert.equal(a.raw.gravame, undefined);
  resetCredifyTokenCache();
  const f2 = fakeFetch([login, { body: noBdrp() }]);
  const b = await new CredifyVehicleProvider(opts(f2)).queryByPlate('ABC1D34', { productId: 'AUCTION' });
  assert.equal(f2.calls.filter((c) => !c.url.endsWith('/auth')).length, 1); assert.equal(b.raw.gravame, undefined);
  resetCredifyTokenCache();
  const f3 = fakeFetch([login, { body: noBdrp() }, { status: 500, body: { Message: 'erro' } }]);
  const c = await new CredifyVehicleProvider(opts(f3)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  assert.deepEqual(c.raw.gravame, { unavailable: true });
  assert.ok(buildReportV2(c.raw), 'o relatório ainda sai');
  resetCredifyTokenCache();
  const f4 = fakeFetch([login, { body: noBdrp() }, { body: { CONSULTA: {}, RESPOSTA: { CODIGO: '2', MSG: 'NAO ENCONTRADO' } } }]);
  const d = await new CredifyVehicleProvider(opts(f4)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  assert.deepEqual(d.raw.gravame, { notFound: true });
});

test('busca e apreensão: texto nas restrições vira ocorrência; sem texto e com restrições = nada consta; sem restrições = não informado', () => {
  const withText = structuredClone(ok);
  withText.RESPOSTA.VEICULOSBDRP.RETORNO.RESJUDICIAL = 'BUSCA E APREENSAO - 2A VARA CIVEL';
  const a = item(buildReportV2(withText), 'RES_BUSCA_APREENSAO');
  assert.equal(a.state, 'ALERT');
  assert.match(a.display, /BUSCA E APREENSAO/);
  assert.equal(buildReportV2(withText).verdict.level, 'HIGH_RISK');

  const clean = item(buildReportV2(ok), 'RES_BUSCA_APREENSAO');
  assert.notEqual(clean.state, 'ALERT');

  const negated = structuredClone(ok);
  negated.RESPOSTA.VEICULOSBDRP.RETORNO.OUTRAS_RESTRICOES_01 = 'SEM BUSCA E APREENSAO';
  assert.notEqual(item(buildReportV2(negated), 'RES_BUSCA_APREENSAO').state, 'ALERT');

  const none = buildReportV2(rawWith(null));
  const n = item(none, 'RES_BUSCA_APREENSAO');
  assert.equal(n.state, 'INFO');
  assert.match(n.display, /Não informado/);
  assert.equal(none.coverage.restrictionsProvided, false, 'item informativo não conta como restrição retornada');
});

test('Renajud: restrição judicial no Total dispara o /renajud (483) e o relatório mostra tribunal, processo, data e busca e apreensão', async () => {
  resetCredifyTokenCache();
  const flagged = structuredClone(ok);
  flagged.RESPOSTA.VEICULOSBDRP.RETORNO.RESJUDICIAL = 'EXISTE RESTRICAO JUDICIAL';
  const f = fakeFetch([login, { body: flagged }, { body: RENA({ REGISTRO_1: judicialRec }) }]);
  const out = await new CredifyVehicleProvider(opts(f)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  const paid = f.calls.filter((c) => !c.url.endsWith('/auth'));
  assert.equal(paid.length, 2);
  assert.match(paid[1].url, /\/renajud$/); assert.match(paid[1].body, /"IdConsulta":"483"/);
  const r = buildReportV2(out.raw);
  assert.equal(item(r, 'RJ_DETALHES').state, 'ALERT');
  assert.match(item(r, 'RJ_DETALHES').value, /Tribunal: TJSP · Órgão: 2A VARA CIVEL SAO PAULO · Processo nº 1002345-67\.2024\.8\.26\.0100 · incluída em 20\/05\/2024/);
  assert.equal(item(r, 'RES_BUSCA_APREENSAO').state, 'ALERT');
  assert.match(item(r, 'RES_BUSCA_APREENSAO').value, /BUSCA E APREENSAO/);
  assert.equal(item(r, 'RESRENAJUD').state, 'ALERT');
});

test('Renajud: sem restrição judicial no Total não há chamada extra; falha do /renajud não derruba a consulta; outro pacote não chama', async () => {
  resetCredifyTokenCache();
  const f1 = fakeFetch([login, { body: ok }]);
  const a = await new CredifyVehicleProvider(opts(f1)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  assert.equal(f1.calls.filter((c) => !c.url.endsWith('/auth')).length, 1); assert.equal(a.raw.renajud, undefined);
  resetCredifyTokenCache();
  const flagged = structuredClone(ok); flagged.RESPOSTA.VEICULOSBDRP.RETORNO.RESRENAJUD = 'EXISTE RESTRICAO RENAJUD';
  const f2 = fakeFetch([login, { body: flagged }, { status: 500, body: { Message: 'erro' } }]);
  const b = await new CredifyVehicleProvider(opts(f2)).queryByPlate('ABC1D34', { productId: 'COMPLETE' });
  assert.deepEqual(b.raw.renajud, { unavailable: true });
  assert.ok(buildReportV2(b.raw), 'o relatório ainda sai');
  resetCredifyTokenCache();
  const f3 = fakeFetch([login, { body: flagged }]);
  await new CredifyVehicleProvider(opts(f3)).queryByPlate('ABC1D34', { productId: 'AUCTION' });
  assert.equal(f3.calls.filter((c) => !c.url.endsWith('/auth')).length, 1);
});

test('Renajud: base de restrições vazia e /renajud sem registro = nada consta judicial', () => {
  const r = buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: noBdrp(), renajud: { data: RENA({}) } });
  assert.equal(item(r, 'RESRENAJUD').state, 'CLEAR');
  assert.equal(item(r, 'RJ_DETALHES'), undefined);
  assert.equal(item(r, 'RES_BUSCA_APREENSAO').state, 'CLEAR');
});

test('base nacional do Veículo Total: restrições 01–04, situação do chassi, limite, montagem, última atualização e importação', () => {
  const x = structuredClone(ok);
  Object.assign(x.RESPOSTA.VEICULARBNACIONAL.REGISTRO_1, { RESTRICAO1: 'SEM RESTRICAO', RESTRICAO2: 'BUSCA E APREENSAO', RESTRICAO3: '', RESTRICAO4: 'SEM RESTRICAO', DATA_LIMITE_RESTRICAO: '2027-01-10', SITUACAO_CHASSI: 'NORMAL', TIPO_MONTAGEM: 'COMPLETA', NUMERO_LUGAR: '5', ULTIMA_ATUALIZACAO: '2026-06-07', NUMERO_DI: '2612345678', DATA_REGISTRO_DI: '2015-02-01', UNIDADE_LOCAL_SRF: 'PORTO DE SANTOS', IDENTIFICACAO_IMPORTADORA: '12345678000195' });
  const r = buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: x });
  assert.equal(item(r, 'VN_RESTRICAO_1').state, 'CLEAR');
  assert.equal(item(r, 'VN_RESTRICAO_2').state, 'ALERT');
  assert.equal(item(r, 'VN_RESTRICAO_3'), undefined, 'vazio some');
  assert.equal(item(r, 'RES_BUSCA_APREENSAO').state, 'ALERT');
  assert.equal(item(r, 'VN_SITUACAO_CHASSI').state, 'CLEAR');
  assert.equal(item(r, 'VN_DATA_LIMITE_RESTRICAO').value, '10/01/2027');
  assert.equal(item(r, 'VN_ULTIMA_ATUALIZACAO').value, '07/06/2026');
  assert.match(item(r, 'VN_IMPORTACAO').value, /DI nº 2612345678 · registrada em 01\/02\/2015 · unidade da Receita PORTO DE SANTOS · importador 12\.345\.678\/0001-95/);
  const plain = buildReportV2({ placa: 'ABC1234', idConsulta: '467', data: ok });
  assert.equal(item(plain, 'VN_IMPORTACAO'), undefined);
});
