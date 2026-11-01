import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { checkAd, parseBrlToCents } = await import('../dist/report/adCheck.js');

const rep = (fipe = 'R$ 32.500,00', headline = {}) => ({
  headline: { brand: 'FIAT', model: 'UNO', fullModel: 'UNO MILLE WAY 1.0', manufactureYear: '2012', modelYear: '2013', color: 'BRANCA', ...headline },
  sections: [{ key: 'VEICULO', items: fipe ? [{ key: 'VT_FIPE_PRECO', label: 'FIPE', kind: 'text', state: 'INFO', value: fipe, display: fipe, sensitivity: 'PUBLIC', tier: 1 }] : [] }],
  debts: { hasDebt: false, totalCents: 0, items: [], fineBreakdown: [], note: '' }, debtsHidden: false
});

test('lê valores em reais do jeito que a FIPE mostra', () => {
  assert.equal(parseBrlToCents('32.500,00'), 3250000);
  assert.equal(parseBrlToCents('R$ 1.234.567,89'), 123456789);
  assert.equal(parseBrlToCents('nada'), undefined);
});

test('preço muito abaixo da FIPE é alerta; faixa normal é ok; acima avisa', () => {
  assert.equal(checkAd(rep(), { priceCents: 2000000 }).price.level, 'ALERT');
  assert.equal(checkAd(rep(), { priceCents: 2000000 }).hasRisk, true);
  assert.equal(checkAd(rep(), { priceCents: 2800000 }).price.level, 'ATTENTION');
  assert.equal(checkAd(rep(), { priceCents: 3300000 }).price.level, 'OK');
  assert.equal(checkAd(rep(), { priceCents: 4000000 }).price.level, 'ABOVE');
  assert.equal(checkAd(rep(), { priceCents: 3300000 }).hasRisk, false);
});

test('sem FIPE na consulta não inventa comparação', () => {
  const r = checkAd(rep(null), { priceCents: 1000000 });
  assert.equal(r.price.level, 'NO_REFERENCE');
  assert.equal(r.hasRisk, false);
});

test('ano, cor e modelo: confere, aproxima ou diverge', () => {
  const ok = checkAd(rep(), { year: 2013, color: 'Branca', model: 'Uno Mille' });
  assert.deepEqual(ok.fields.map((f) => f.status), ['OK', 'OK', 'OK']);
  assert.equal(ok.hasRisk, false);
  const near = checkAd(rep(), { year: 2014 });
  assert.equal(near.fields[0].status, 'ATTENTION');
  const bad = checkAd(rep(), { year: 2020, color: 'Preto', model: 'Gol' });
  assert.deepEqual(bad.fields.map((f) => f.status), ['MISMATCH', 'MISMATCH', 'MISMATCH']);
  assert.equal(bad.hasRisk, true);
  assert.match(bad.summary, /risco/);
});

test('sem dados no registro, pede atenção e não afirma que confere', () => {
  const r = checkAd(rep('R$ 10.000,00', { color: undefined, modelYear: undefined, manufactureYear: undefined }), { year: 2013, color: 'Branca' });
  assert.deepEqual(r.fields.map((f) => f.status), ['ATTENTION', 'ATTENTION']);
});
