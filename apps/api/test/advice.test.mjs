import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { buildAdvice } = await import('../dist/report/advice.js');
const { buildReportV2, viewReport } = await import('../dist/report/normalizeV2.js');

const it = (key, state) => ({ key, label: key, kind: 'flag', state, value: state === 'NOT_PROVIDED' ? null : 'x', sensitivity: 'PUBLIC', tier: 1 });
const rep = (sections, debts = { hasDebt: false, totalCents: 0, items: [], fineBreakdown: [], note: '' }, extra = {}) => ({ sections: sections.map(([key, items]) => ({ key, items })), debts, debtsHidden: false, ...extra });
const status = (a, key) => a.checks.find((c) => c.key === key)?.status;

test('leilão e sinistro: risco alto na revenda e no seguro, com os motivos', () => {
  const a = buildAdvice(rep([['HISTORICO', [it('VT_LEILAO', 'ALERT'), it('VT_SINISTRO', 'ALERT')]], ['DEBITOS', []]]));
  assert.equal(a.resale.level, 'HIGH');
  assert.equal(a.resale.reasons.length, 2);
  assert.equal(status(a, 'auction'), 'ATTENTION');
  assert.equal(status(a, 'claim'), 'ATTENTION');
  assert.match(a.resale.note, /não é garantia/);
});

test('só alienação ativa e débito: risco moderado; gravame pede quitação e baixa comprovadas', () => {
  const a = buildAdvice(rep([['HISTORICO', [it('VT_LEILAO', 'CLEAR'), it('VT_SINISTRO', 'CLEAR')]], ['GRAVAME', [it('RESTRICAOFINAN', 'ALERT')]], ['DEBITOS', []]], { hasDebt: true, totalCents: 150000, items: [], fineBreakdown: [], note: '' }));
  assert.equal(a.resale.level, 'MODERATE');
  assert.equal(status(a, 'lien'), 'ATTENTION');
  assert.match(a.checks.find((c) => c.key === 'lien').detail, /quitação/);
  assert.equal(status(a, 'debts'), 'ATTENTION');
  assert.match(a.checks.find((c) => c.key === 'debts').detail, /1\.500,00/);
});

test('tudo limpo: baixo risco; RENAJUD é alerta que impede a transferência', () => {
  const clean = buildAdvice(rep([['HISTORICO', [it('VT_LEILAO', 'CLEAR'), it('VT_SINISTRO', 'CLEAR')]], ['RESTRICOES', [it('RESRENAJUD', 'CLEAR')]], ['DEBITOS', []]]));
  assert.equal(clean.resale.level, 'LOW');
  assert.equal(status(clean, 'judicial'), 'OK');
  const judicial = buildAdvice(rep([['HISTORICO', [it('VT_LEILAO', 'CLEAR')]], ['RESTRICOES', [it('RESRENAJUD', 'ALERT')]], ['DEBITOS', []]]));
  assert.equal(status(judicial, 'judicial'), 'ALERT');
  assert.equal(judicial.resale.level, 'HIGH');
});

test('pacote sem a seção: a verificação nem é citada; seção presente sem retorno vira "não consultado", nunca "ok"', () => {
  const fora = buildAdvice(rep([['IDENTIFICACAO', [it('CHASSI', 'INFO')]]], undefined, { debtsHidden: true }));
  assert.equal(fora.resale, undefined);
  assert.equal(status(fora, 'chassis'), 'NOT_CHECKED');
  for (const key of ['debts', 'judicial', 'lien', 'auction', 'claim', 'theft', 'recall']) assert.equal(status(fora, key), undefined, key);
  assert.ok(fora.toDo.length >= 5);
  const semRetorno = buildAdvice(rep([['HISTORICO', [it('VT_LEILAO', 'NOT_PROVIDED'), it('VT_SINISTRO', 'NOT_PROVIDED')]], ['RESTRICOES', [it('RESJUDICIAL', 'NOT_PROVIDED')]], ['GRAVAME', []], ['DEBITOS', []]], undefined, { debtsHidden: true }));
  for (const key of ['auction', 'claim', 'judicial', 'lien']) assert.equal(status(semRetorno, key), 'NOT_CHECKED', key);
  assert.equal(semRetorno.resale, undefined);
});

test('viewReport entrega o parecer calculado só com as seções do pacote', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
  const v2 = buildReportV2(raw);
  const cadastral = viewReport(v2, { audience: 'client', tier: 3, sections: ['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO'] });
  assert.equal(cadastral.advice.resale, undefined);
  assert.equal(status(cadastral.advice, 'debts'), undefined);
  assert.ok(!JSON.stringify(cadastral.advice).includes('Restrição judicial'));
  const complete = viewReport(v2, { audience: 'client', tier: 3 });
  assert.ok(complete.advice.resale);
  assert.equal(status(complete.advice, 'debts'), 'OK');
});
