import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildReportV2, viewReport, extractReturn, providerOutcome, isEmptyValue } from '../dist/report/normalizeV2.js';
import { FIELD_CATALOG, CATALOG_BY_KEY } from '../dist/report/catalog.js';
import { maskDocument, maskName, maskVehicleId } from '../dist/report/mask.js';
import { normalizeBdrp } from '../dist/normalizer.js';
import { publicVehicleResult } from '../dist/privacy.js';

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const ret = sample.RESPOSTA.VEICULOSBDRP.RETORNO;

test('catálogo cobre todos os campos do exemplo do provedor', () => {
  const missing = Object.keys(ret).filter((k) => !CATALOG_BY_KEY.has(k));
  assert.deepEqual(missing, []);
  assert.equal(FIELD_CATALOG.length, Object.keys(ret).length);
  assert.equal(new Set(FIELD_CATALOG.map((d) => d.key)).size, FIELD_CATALOG.length);
});

test('sucesso do provedor exige CODIGO=1, SUCESSO e EXISTE_ERRO=0', () => {
  assert.equal(extractReturn(sample).PLACA, 'AAA0000');
  assert.equal(providerOutcome(sample).ok, true);
  const bad = structuredClone(sample); bad.RESPOSTA.CODIGO = '0';
  assert.equal(providerOutcome(bad).ok, false);
  const bad2 = structuredClone(sample); bad2.RESPOSTA.VEICULOSBDRP.DESCRICAORETORNO = 'ERRO';
  assert.equal(providerOutcome(bad2).ok, false);
  const bad3 = structuredClone(sample); bad3.RESPOSTA.VEICULOSBDRP.RETORNO.EXISTE_ERRO = '1';
  assert.equal(providerOutcome(bad3).ok, false);
  assert.throws(() => buildReportV2(bad3));
});

test('[] vira NOT_PROVIDED e nunca "sem ocorrência"', () => {
  const report = buildReportV2(sample);
  const items = new Map(report.sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  const empties = Object.entries(ret).filter(([, v]) => isEmptyValue(v)).map(([k]) => k);
  assert.equal(empties.length, 32);
  for (const k of empties) { assert.equal(items.get(k).state, 'NOT_PROVIDED', k); assert.equal(items.get(k).value, null, k); }
  assert.equal(items.get('RESTRICAOFINAN').state, 'CLEAR');
  assert.equal(items.get('INTENCAORESTRICAOFINAN').state, 'NOT_PROVIDED');
});

test('classifica estados: NADA CONSTA/NAO POSSUI/INSPECAO OK = CLEAR; EXISTE DEBITO = ALERT', () => {
  const items = new Map(buildReportV2(sample).sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  for (const k of ['RESFURTO', 'RESJUDICIAL', 'RESRENAJUD', 'RECALL', 'RESTRICAORFB', 'RESAMBIENTAL', 'EXISTEDEBITODEIPVA', 'EXISTEDEBITODEDPVAT', 'OUTRAS_RESTRICOES_01', 'TIPOREMARCACAOCHASSI', 'CCOMUNICACAOVENDA']) assert.equal(items.get(k).state, 'CLEAR', k);
  assert.equal(items.get('EXISTEDEBITODELICENCIAMENTO').state, 'ALERT');
  assert.equal(items.get('EXISTEDEBITOMULTA').state, 'ALERT');
  assert.equal(items.get('SITUACAOVEICULO').state, 'INFO');
});

test('multas não são contadas em dobro (293,47 uma vez) e licenciamento entra no total', () => {
  const { debts } = buildReportV2(sample);
  assert.equal(debts.totalCents, 29347 + 16022);
  assert.deepEqual(debts.items.map((i) => i.amountCents).sort(), [16022, 29347]);
  assert.deepEqual(debts.fineBreakdown.map((i) => [i.key, i.amountCents]), [['DEBDER', 29347]]);
  // sem o total de multas, usa soma dos componentes (sem duplicar)
  const alt = structuredClone(sample); alt.RESPOSTA.VEICULOSBDRP.RETORNO.VALORTOTALDEBITOMULTA = [];
  assert.equal(buildReportV2(alt).debts.totalCents, 29347 + 16022);
});

test('ano de fabricação (VEIANOFABR) é capturado', () => {
  assert.equal(buildReportV2(sample).headline.manufactureYear, 'XXXX');
  assert.equal(normalizeBdrp(sample).characteristics.manufactureYear, 'XXXX');
});

test('veredito: ATTENTION por débitos; HIGH_RISK por furto; INCONCLUSIVE sem restrições', () => {
  assert.equal(buildReportV2(sample).verdict.level, 'ATTENTION');
  const theft = structuredClone(sample); theft.RESPOSTA.VEICULOSBDRP.RETORNO.RESFURTO = 'EXISTE REGISTRO DE ROUBO/FURTO';
  const v = buildReportV2(theft).verdict;
  assert.equal(v.level, 'HIGH_RISK'); assert.ok(v.alerts.some((a) => a.key === 'RESFURTO' && a.high));
  const clean = structuredClone(sample); const r = clean.RESPOSTA.VEICULOSBDRP.RETORNO;
  r.EXISTEDEBITODELICENCIAMENTO = 'NAO EXISTE DEBITO DE LICENCIAMENTO'; r.EXISTEDEBITODELICENCIAMENTOVL = '0,00'; r.EXISTEDEBITOMULTA = 'NAO EXISTE DEBITO DE MULTA'; r.VALORTOTALDEBITOMULTA = '0,00'; r.DEBDER = '0,00';
  assert.equal(buildReportV2(clean).verdict.level, 'CLEAR');
  for (const k of Object.keys(r)) if (/^RES|^OUTRAS|^INTENCAO|^RESTRICAO|^RECALL/.test(k)) r[k] = [];
  assert.equal(buildReportV2(clean).verdict.level, 'INCONCLUSIVE');
});

test('LGPD: proprietário mascarado no relatório e ausente da visão do cliente', () => {
  const report = buildReportV2({ RESPOSTA: { CODIGO: '1', VEICULOSBDRP: { DESCRICAORETORNO: 'SUCESSO', RETORNO: { ...ret, PRONOME: 'JOAO DA SILVA SANTOS', CPF_CNPJ_PROPRIETARIO: '12345678901', CHASSI: '9BWZZZ377VT004251' } } } });
  const all = report.sections.flatMap((s) => s.items);
  assert.equal(all.find((i) => i.key === 'PRONOME').value, 'JOAO DA S**** S*****');
  assert.equal(all.find((i) => i.key === 'CPF_CNPJ_PROPRIETARIO').value, '***.456.789-**');
  assert.ok(!JSON.stringify(report).includes('12345678901'));
  assert.ok(!JSON.stringify(report).includes('SILVA'));
  assert.ok(!JSON.stringify(report).includes('9BWZZZ377VT004251'));
  const client = viewReport(report, { audience: 'client', tier: 3 });
  const keys = client.sections.flatMap((s) => s.items.map((i) => i.key));
  assert.ok(!keys.includes('PRONOME') && !keys.includes('CPF_CNPJ_PROPRIETARIO') && !keys.includes('CHAVERETORNO'));
  assert.ok(keys.includes('TIPODOCUMENTOPROPRIETARIO'));
  const team = viewReport(report, { audience: 'team', tier: 3 });
  assert.ok(team.sections.flatMap((s) => s.items.map((i) => i.key)).includes('CHAVERETORNO'));
});

test('plano básico não vaza débitos/restrições; avisa que há pontos fora do plano', () => {
  const view = viewReport(buildReportV2(sample), { audience: 'client', tier: 1 });
  const keys = view.sections.flatMap((s) => s.items.map((i) => i.key));
  assert.ok(keys.includes('MARCA') && !keys.includes('DEBIPVA') && !keys.includes('RESFURTO'));
  assert.equal(view.debts.totalCents, 0); assert.equal(view.debtsHidden, true);
  assert.ok(view.lockedAlertCount > 0);
  assert.ok(view.verdict.alerts.length === 0);
});

test('normalizeBdrp: dono mascarado, sem dupla contagem de multas e v2 anexado; público não vaza owner', () => {
  const n = normalizeBdrp(sample);
  assert.ok(n.v2);
  assert.equal(n.debts.reduce((a, d) => a + d.amountCents, 0), 29347 + 16022);
  const pub = publicVehicleResult(n);
  assert.equal(pub.owner, undefined);
  assert.ok(!JSON.stringify(pub).includes('PRONOME'));
});

test('máscaras', () => {
  assert.equal(maskDocument('123.456.789-01'), '***.456.789-**');
  assert.equal(maskDocument('12345678000190'), '**.345.678/0001-**');
  assert.equal(maskName('MARIA APARECIDA DE SOUZA'), 'MARIA A****** DE S****');
  assert.equal(maskVehicleId('9BWZZZ377VT004251'), '9BW**********4251');
  assert.equal(maskDocument(null), null);
});
