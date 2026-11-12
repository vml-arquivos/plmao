import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { decodeChassis } = await import('../dist/enrichment/chassis.js');
const { annualPoints } = await import('../dist/enrichment/fipeHistory.js');
const { buildVehicleSheet, parseModelName, buildFipeTables } = await import('../dist/enrichment/sheet.js');
const { makeFipeQuote, fipePdf, fipePrintHtml } = await import('../dist/fipeReport.js');
const { maskFreeChassis, maskFreeEngine } = await import('../dist/report/mask.js');
const { sheetBlocks } = await import('../dist/report/sheetItems.js');

const point = (y, m, cents) => ({ label: `${m}/${y}`, time: y * 12 + (m - 1), cents });
// Série de 30 meses (2024-07 .. 2026-12) com valores conhecidos
const all = [];
for (let i = 0; i < 30; i += 1) { const t = 2024 * 12 + 6 + i; all.push({ label: `m${i}`, time: t, cents: 1_000_000 + i * 10_000 }); }

test('decodificador: chave do chassi, região e país (exemplo Mercedes C 180)', () => {
  const v = decodeChassis('WDDGF4KWXCA554608', [2011, 2012]);
  assert.equal(v.key, 'WDDGF4KWXCA');
  assert.equal(v.region, 'Europa');
  assert.equal(v.country, 'Alemanha');
  assert.equal(decodeChassis('936CB1028', []).valid, false);
});

test('tabela por ano: último mês de cada ano e variação real sobre o ano anterior', () => {
  const pts = [point(2024, 12, 10000000), point(2025, 6, 10500000), point(2025, 12, 11000000), point(2026, 3, 9900000)];
  const a = annualPoints(pts);
  assert.deepEqual(a.map((x) => x.year), [2026, 2025, 2024]);
  assert.equal(a[0].cents, 9900000);
  assert.equal(a[0].pct, -10);
  assert.equal(a[1].pct, 10);
  assert.equal(a[2].pct, null);
});

test('tabela de 24 meses: % sobre o mês anterior e % no período', () => {
  const t = buildFipeTables({ fipeCode: '024155-5', yearId: '2011-1', series: all.slice(-24) });
  assert.equal(t.monthly.length, 24);
  assert.equal(t.monthly[0].pctMonth, Math.round(((1_290_000 - 1_280_000) / 1_280_000) * 10000) / 100);
  assert.equal(t.monthly[23].pctMonth, null);
  assert.equal(t.monthly[23].pctPeriod, null);
  assert.ok(t.monthly[0].pctPeriod > 0);
  assert.equal(buildFipeTables({ fipeCode: 'x', yearId: 'y', series: [all[0]] }), undefined);
});

test('nome do modelo: motor, portas e câmbio só quando o nome diz', () => {
  assert.deepEqual(parseModelName('Classe C 180 CGI 1.8 16V Turbo Gas. 4P Aut.'), { engine: '1.8 16V Turbo', doors: '4', gearbox: 'Automático' });
  assert.deepEqual(parseModelName('207 PASSION XR 1.4 FLEX 4P'), { engine: '1.4', doors: '4' });
  assert.deepEqual(parseModelName('Gol'), {});
});

test('ficha do veículo (exemplo Peugeot 207): decodificador, FIPE, financiamento e ficha técnica; chassi sem máscara', () => {
  const sheet = buildVehicleSheet({
    chassis: '9362ABCDEXB051028', engine: '10DXXXXXX08185', brand: 'PEUGEOT', fullModel: '207 PASSION XR 1.4 FLEX 4P', fuel: 'ALCOOL / GASOLINA', modelYear: 2011, manufactureYear: 2010,
    fipeCode: '024155-5', fipeModel: 'Peugeot 207 Passion XR 1.4 Flex', fipeCurrentCents: 1_962_800, history: { fipeCode: '024155-5', yearId: '2011-1', series: all.slice(-24), annual: annualPoints(all) },
    financing: { vehicleCents: 1_962_800, downPaymentCents: 392_560, months: 48, installmentCents: 30_834 },
    specs: { title: 'Peugeot 207 Passion XR 2011', rows: [{ label: 'Motor', value: '1.4' }] }
  });
  const labels = sheet.decoder.map((r) => r.label);
  for (const l of ['Fabricante', 'Modelo', 'Chave do chassi', 'País de fabricação', 'Motor', 'Portas', 'Combustível']) assert.ok(labels.includes(l), l);
  assert.equal(sheet.fipe.code, '024155-5');
  assert.equal(sheet.fipe.currentCents, 1_962_800);
  assert.equal(sheet.fipe.monthly.length, 24);
  assert.equal(sheet.financing.months, 48);
  assert.equal(sheet.specs.rows.length, 1);
  assert.ok(!JSON.stringify(sheet).includes('*'), 'nada mascarado');
});

test('ficha sem fonte: não inventa FIPE, financiamento nem ficha técnica', () => {
  const sheet = buildVehicleSheet({ chassis: '', brand: 'FIAT', fullModel: 'UNO' });
  assert.equal(sheet.fipe, undefined);
  assert.equal(sheet.financing, undefined);
  assert.equal(sheet.specs, undefined);
  assert.deepEqual(sheet.decoder.map((r) => r.label), ['Fabricante', 'Modelo']);
});

test('consulta gratuita: PDF com várias páginas e HTML trazem a ficha e o chassi completo', async () => {
  const sheet = buildVehicleSheet({ chassis: '9362ABCDEXB051028', brand: 'PEUGEOT', fullModel: '207 PASSION XR 1.4 FLEX 4P', modelYear: 2011, fipeCode: '024155-5', fipeModel: 'Peugeot 207', fipeCurrentCents: 1_962_800, history: { fipeCode: '024155-5', yearId: '2011-1', series: all.slice(-24), annual: annualPoints(all) }, financing: { vehicleCents: 1_962_800, downPaymentCents: 392_560, months: 48, installmentCents: 30_834 } });
  const quote = makeFipeQuote({ provider: 'parallelum', source: 'x', referenceMonth: 'novembro de 2026', vehicleType: 'cars', brand: { code: '1', name: 'Peugeot' }, model: { code: '2', name: '207 Passion XR' }, year: { code: '2011-1', name: '2011 Flex' }, fuel: 'Flex', fipeCode: '024155-5', valueCents: 1_962_800, valueLabel: 'R$ 19.628,00', cacheKey: 'k' }, 'JIJ8343', { plate: 'JIJ8343', chassis: '9362ABCDEXB051028', engine: '10DXXXXXX08185', brand: 'PEUGEOT' });
  quote.sheet = sheet;
  const buf = await fipePdf(quote);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const f = `/tmp/vs-${process.pid}-${Date.now()}.pdf`;
  fs.writeFileSync(f, buf);
  let text = null;
  try { text = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch { /* sem pdftotext */ } finally { fs.rmSync(f, { force: true }); }
  if (text !== null) {
    assert.ok((text.match(/\f/g) ?? []).length >= 1, 'mais de uma página');
    assert.ok(text.includes('9362ABCDEXB051028'));
    assert.match(text, /TABELA FIPE/i);
  }
  const html = fipePrintHtml(quote);
  assert.ok(html.includes('9362ABCDEXB051028') && html.includes('Financie') && html.includes('Histórico dos últimos 24 meses'));
  assert.ok(html.includes('R$') && !/>\s*\d{6,}\s*</.test(html.split('Estimativa informativa')[1].slice(0, 200)), 'faixa de negociação formatada em reais');
});

test('relatório pago: a ficha vira blocos do PDF', () => {
  const sheet = buildVehicleSheet({ chassis: 'WDDGF4KWXCA554608', brand: 'MERCEDES', fullModel: 'C 180 CGI', modelYear: 2012, fipeCode: '021239-3', fipeCurrentCents: 6_409_000, history: { fipeCode: '021239-3', yearId: '2012-1', series: all.slice(-24), annual: annualPoints(all) } });
  const blocks = sheetBlocks(sheet);
  assert.deepEqual(blocks.map((b) => b.title), ['Decodificador do chassi e do modelo', 'Tabela FIPE']);
  assert.equal(blocks[1].items.find((i) => i.key === 'SH_FIPE_MENSAL').table.rows.length, 24);
});

test('consulta paga com ficha: enrichWithSheet monta a ficha, o relatório a expõe e falha na FIPE não derruba', async () => {
  const { enrichWithSheet } = await import('../dist/lib/sheetEnrich.js');
  const { buildReportV2 } = await import('../dist/report/normalizeV2.js');
  const { resetFipeHistoryCache } = await import('../dist/enrichment/fipeHistory.js');
  const ok = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
  resetFipeHistoryCache();
  const fetchImpl = async (url) => {
    const body = String(url).endsWith('/history')
      ? { priceHistory: Array.from({ length: 30 }, (_, i) => ({ month: `${2024 + Math.floor((i + 6) / 12)}-${String(((i + 6) % 12) + 1).padStart(2, '0')}`, price: `R$ ${(70000 + i * 100).toLocaleString('pt-BR')},00` })) }
      : Array.from({ length: 41 }, (_, i) => ({ code: `${1990 + i}-1`, name: `${1990 + i} Gasolina` }));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const enrichment = await enrichWithSheet(ok, { fetchImpl });
  assert.ok(enrichment.sheet.decoder.length >= 3);
  assert.equal(enrichment.sheet.fipe.monthly.length, 24);
  assert.ok(enrichment.sheet.fipe.annual.length >= 2);
  const report = buildReportV2({ ...ok, enrichment });
  assert.ok(report.sheet?.decoder.some((r) => r.label === 'Chave do chassi'));
  // sem FIPE: a ficha ainda traz o decodificador e nada de tabela inventada
  resetFipeHistoryCache();
  const offline = await enrichWithSheet(ok, { fetchImpl: async () => { throw new Error('rede'); } });
  assert.ok(offline.sheet.decoder.length >= 3);
  assert.equal(offline.sheet.fipe?.monthly?.length ?? 0, 0);
  // consulta antiga (sem ficha guardada): o relatório continua igual, sem a chave sheet
  assert.equal(buildReportV2(ok).sheet, undefined);
});

test('consulta grátis por placa: chassi (3+4) e motor (3+5) mascarados; ficha não mostra a chave do chassi', () => {
  assert.equal(maskFreeChassis('9362ABCDEXB051028'), '936**********1028');
  assert.equal(maskFreeEngine('10DXXXXXX08185'), '10D******08185');
  assert.equal(maskFreeChassis(''), undefined);
  assert.equal(maskFreeChassis(undefined), undefined);
  const sheet = buildVehicleSheet({ chassis: '9362ABCDEXB051028', hideKey: true, brand: 'PEUGEOT', fullModel: '207 PASSION XR 1.4 FLEX 4P', modelYear: 2011 });
  const labels = sheet.decoder.map((r) => r.label);
  assert.ok(!labels.includes('Chave do chassi'), 'chave não aparece no grátis');
  assert.ok(labels.includes('País de fabricação') && labels.includes('Fabricante'), 'decodificador continua');
  assert.ok(!JSON.stringify(sheet).includes('9362ABCDEXB'), 'chassi real não vaza na ficha');
  const quote = makeFipeQuote({ provider: 'parallelum', source: 'x', referenceMonth: 'novembro de 2026', vehicleType: 'cars', brand: { code: '1', name: 'Peugeot' }, model: { code: '2', name: '207' }, year: { code: '2011-1', name: '2011 Flex' }, fuel: 'Flex', fipeCode: '024155-5', valueCents: 1_962_800, valueLabel: 'R$ 19.628,00', cacheKey: 'k' }, 'JIJ8343', { plate: 'JIJ8343', chassis: maskFreeChassis('9362ABCDEXB051028'), engine: maskFreeEngine('10DXXXXXX08185'), brand: 'PEUGEOT' });
  const html = fipePrintHtml({ ...quote, sheet });
  assert.ok(html.includes('936**********1028') && html.includes('10D******08185'));
  assert.ok(!html.includes('9362ABCDEXB') && !html.includes('XXXXXX0'));
});
