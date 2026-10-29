import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { decodeChassis, modelYearFromChar } = await import('../dist/enrichment/chassis.js');
const { expectedKm, priceTrend, projectPrice } = await import('../dist/enrichment/estimates.js');
const { fetchFipeHistory, parseMonth, parsePriceCents, pickYearId, resetFipeHistoryCache } = await import('../dist/enrichment/fipeHistory.js');
const { enrichVehicle } = await import('../dist/enrichment/index.js');
const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
const { executeVehicleLookup } = await import('../dist/vehicleLookup.js');
const { normalizeBdrp } = await import('../dist/normalizer.js');

const ok = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const item = (r, k) => r.sections.flatMap((s) => s.items).find((i) => i.key === k);

test('decodificador de chassi: fabricante, país e ano do modelo; formato fora do padrão não afirma nada', () => {
  const a = decodeChassis('WDDGF4KWXCA554608', [2011, 2012]);
  assert.deepEqual([a.valid, a.manufacturer, a.country, a.modelYear], [true, 'Mercedes-Benz', 'Alemanha', 2012]);
  const b = decodeChassis('9BWZZZ377VT004251', [1997]);
  assert.deepEqual([b.manufacturer, b.country, b.modelYear], ['Volkswagen', 'Brasil', 1997]);
  assert.equal(decodeChassis('9BXYZ', []).valid, false);
  assert.equal(decodeChassis('9BWZZZ377VT00425I', []).valid, false); // I não existe em chassi
  assert.equal(modelYearFromChar('C', [2012]), 2012);
  assert.equal(modelYearFromChar('C', [1982]), 1982);
});

test('quilometragem de referência: faixa pela idade, rotulada como estimativa', () => {
  const r = expectedKm(2016, new Date('2026-10-29'));
  assert.deepEqual([r.ageYears, r.low, r.mid, r.high], [10, 80000, 120000, 160000]);
  assert.equal(expectedKm(1900), undefined);
  assert.ok(expectedKm(2026, new Date('2026-10-29')).mid > 0);
});

test('tendência e projeção da FIPE', () => {
  const series = Array.from({ length: 13 }, (_, i) => ({ label: `m${i}`, time: 2025 * 12 + i, cents: 10000000 - i * 100000 }));
  const t = priceTrend(series, 12);
  assert.equal(t.months, 12);
  assert.ok(Math.abs(t.pct - -12) < 0.001);
  const p = projectPrice(series, 6);
  assert.equal(p.perMonthCents, -100000);
  assert.equal(p.cents, 8800000 - 600000);
  assert.equal(priceTrend(series.slice(0, 2), 12), undefined);
});

test('FIPE: meses e preços em vários formatos, escolha do ano-combustível', () => {
  assert.equal(parseMonth('agosto de 2026').label, 'Ago/2026');
  assert.equal(parseMonth('October 2025').label, 'Out/2025');
  assert.equal(parseMonth('2026-03').time, 2026 * 12 + 2);
  assert.equal(parseMonth('abc'), undefined);
  assert.equal(parsePriceCents('R$ 64.090,00'), 6409000);
  assert.equal(parsePriceCents('64090.5'), 6409050);
  assert.equal(pickYearId([{ code: '2011-1', name: '2011 Gasolina' }, { code: '2011-3', name: '2011 Diesel' }], 2011, 'DIESEL'), '2011-3');
  assert.equal(pickYearId([{ code: '2011-1', name: '2011 Gasolina' }], 2012), undefined);
});

function fipeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    const body = String(url).endsWith('/history')
      ? { priceHistory: Array.from({ length: 24 }, (_, i) => ({ month: `${2024 + Math.floor((i + 9) / 12)}-${String(((i + 9) % 12) + 1).padStart(2, '0')}`, price: `R$ ${(70000 - i * 250).toLocaleString('pt-BR')},00` })) }
      : Array.from({ length: 41 }, (_, i) => ({ code: `${1990 + i}-1`, name: `${1990 + i} Gasolina` }));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('histórico da FIPE: duas chamadas, série ordenada, cache por código/ano e falha sem exceção', async () => {
  resetFipeHistoryCache();
  const calls = [];
  const h = await fetchFipeHistory({ fipeCode: '021239-3', modelYear: 2012, fetchImpl: fipeFetch(calls) });
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/cars\/021239-3\/years$/);
  assert.match(calls[1], /\/cars\/021239-3\/years\/2012-1\/history$/);
  assert.equal(h.series.length, 24);
  assert.ok(h.series[0].time < h.series[23].time);
  await fetchFipeHistory({ fipeCode: '021239-3', modelYear: 2012, fetchImpl: fipeFetch(calls) });
  assert.equal(calls.length, 2, 'segunda consulta vem do cache');
  resetFipeHistoryCache();
  const bad = await fetchFipeHistory({ fipeCode: '021239-3', modelYear: 2012, fetchImpl: async () => { throw new Error('rede'); } });
  assert.equal(bad, undefined);
  assert.equal(await fetchFipeHistory({ fipeCode: 'x', modelYear: 2012, fetchImpl: fipeFetch([]) }), undefined);
});

test('relatório do Veículo Total ganha as análises; sem histórico da FIPE ele só traz chassi e quilometragem de referência', () => {
  const r = buildReportV2(ok);
  assert.ok(item(r, 'EN_CHASSI_FABRICANTE'));
  assert.match(item(r, 'EN_KM_REFERENCIA').display, /Estimativa pela idade; não é a quilometragem real/);
  assert.equal(item(r, 'EN_FIPE_SERIE'), undefined);
  assert.equal(item(r, 'EN_FIPE_PROJECAO'), undefined);
  assert.ok(r.sections.some((s) => s.key === 'ANALISES'));
});

test('enrichVehicle + lookup: histórico entra no relatório; se o complemento falha, a consulta segue sem ele', async () => {
  resetFipeHistoryCache();
  const calls = [];
  const enrichment = await enrichVehicle(ok, { fetchImpl: fipeFetch(calls) });
  assert.ok(enrichment?.fipeHistory?.series.length >= 12, 'achou código FIPE no Veículo Total e buscou o histórico');
  const provider = { name: 'teste', queryByPlate: async () => ({ providerQueryId: 'x', raw: ok }) };
  const withHist = await executeVehicleLookup({ provider, plate: 'ABC1234', productId: 'COMPLETE', enrich: async () => enrichment, timeoutMs: 5000, normalize: normalizeBdrp });
  const report = withHist.normalized.reportV2 ?? buildReportV2(withHist.raw);
  assert.ok(item(report, 'EN_FIPE_SERIE')?.display.includes('/'));
  assert.ok(item(report, 'EN_FIPE_VAR_12M') && item(report, 'EN_FIPE_PROJECAO'));
  const failed = await executeVehicleLookup({ provider, plate: 'ABC1234', productId: 'COMPLETE', enrich: async () => { throw new Error('FIPE fora do ar'); }, timeoutMs: 5000, normalize: normalizeBdrp });
  assert.ok(failed.normalized.identification.plate);
  assert.equal(failed.raw.enrichment, undefined);
});
