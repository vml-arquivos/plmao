import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { auctionRecords, auctionTable } = await import('../dist/report/leilao.js');
const { lienAllowedFor } = await import('../dist/lib/lienRefresh.js');
const { prettyValue } = await import('../dist/report/fieldLabels.js');

const ok = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const item = (r, k) => r.sections.flatMap((s) => s.items).find((i) => i.key === k);

test('roubo/furto e recall: rótulos em português, datas legíveis e sem campos técnicos', () => {
  const raw = structuredClone(ok);
  const codes = raw.RESPOSTA.CODIGO.map(String);
  codes[2] = '1';
  raw.RESPOSTA.CODIGO = codes;
  raw.RESPOSTA.HISTORICOROUBOFURTO = { DESCRICAORETORNO: 'SUCESSO', REGISTRO_1: { PLACA: 'AAA0A00', TIPOOCORRENCIA: 'FURTO', MARCAMODELO: 'HONDA/CIVIC', BOLETIM: '2023/004512-7', ANOBOLETIM: '2023', DATAOCORRENCIA: '2023-06-18', UFOCORRENCIA: 'SP', CIDADE: 'CAMPINAS', CODIGOORGAOSEGURANCA: '250101' } };
  const text = String(item(buildReportV2(raw), 'VT_ROUBOFURTO_DETALHES')?.display ?? '');
  assert.match(text, /Tipo de ocorrência: FURTO/);
  assert.match(text, /Boletim de ocorrência: 2023\/004512-7/);
  assert.match(text, /Data da ocorrência: 18\/06\/2023/);
  assert.doesNotMatch(text, /Tipoocorrencia|Anoboletim|Codigoorgao|Placa:|Marcamodelo|2023-06-18/);
});

test('leilão: tabela sem repetir ano, cor, motor e códigos internos; situação do chassi com rótulo próprio', () => {
  const reg = (n) => ({ NSUVEICULO: `99${n}`, IDLEILAO: `48${n}`, LOTE: `0${n}`, LEILOEIRO: 'LEILOEIRO X', DATALEILAO: '2025-03-14', COMITENTE: 'SEGURADORA Y', PATIO: 'PATIO Z', CONDICAOGERALDOVEICULO: 'RECUPERAVEL', SITUACAODOCHASSI: 'NORMAL', COR: 'PRETO', COMBUSTIVEL: 'FLEX', ANOMODELO: '2018', ANOFABRICACAO: '2018', NRMOTOR: 'ABC', NRCAMBIO: 'DEF', CATEGORIADOVEICULO: 'PASSEIO', QUANTIDADEDEEIXOS: '2', PLACA: 'AAA0A00' });
  const table = auctionTable(auctionRecords({ REGISTRO_1: reg(1), REGISTRO_2: reg(2) }));
  assert.ok(table);
  assert.deepEqual(table.columns, ['Data', 'Leilão', 'Lote', 'Leiloeiro', 'Comitente', 'Pátio / local', 'Condição geral', 'Situação do chassi']);
  assert.equal(table.rows[0][0], '14/03/2025');
  assert.doesNotMatch(JSON.stringify(table), /Nsuveiculo|Anomodelo|Nrmotor|PRETO/);
});

test('/gravame só é permitido aos produtos cujo contrato o inclui', () => {
  for (const id of ['LIEN', 'BASIC', 'PREMIUM']) assert.equal(lienAllowedFor(id), true, id);
  for (const id of ['COMPLETE', 'AUCTION', 'CADASTRAL', 'FIPE_FREE']) assert.equal(lienAllowedFor(id), false, id);
});

test('prettyValue converte data ISO e mantém o resto', () => {
  assert.equal(prettyValue('2024-03-04'), '04/03/2024');
  assert.equal(prettyValue('NÃO'), 'NÃO');
});
