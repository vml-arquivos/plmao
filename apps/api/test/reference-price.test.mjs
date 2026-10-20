import assert from 'node:assert/strict';
import test from 'node:test';
import { decideReferencePrice, largestEndingAtOrBelow, priceFromReference } from '../dist/pricing/referencePrice.js';
import { allocate, applyBps, divRound, formatBRL, parseBRLToCents } from '../dist/lib/money.js';

test('regra de referência: maior ,90 até 5% abaixo (exemplos do produto)', () => {
  assert.equal(priceFromReference(6490), 6090);
  assert.equal(priceFromReference(7990), 7590);
  assert.equal(priceFromReference(1390), 1290);
  assert.equal(priceFromReference(4590), 4290);
});
test('referências redondas e limites', () => {
  assert.equal(priceFromReference(10000), 9490); // 95,00 -> 94,90
  assert.equal(priceFromReference(10000, 0), 9990);
  assert.equal(priceFromReference(0), null);
  assert.equal(priceFromReference(50), null);
  assert.equal(largestEndingAtOrBelow(90), 90);
  assert.equal(largestEndingAtOrBelow(89), null);
  assert.equal(largestEndingAtOrBelow(190), 190);
  assert.equal(largestEndingAtOrBelow(289), 190);
});
test('propriedade: resultado termina em ,90 e nunca excede referência × 0,95', () => {
  for (let ref = 500; ref <= 50000; ref += 37) {
    const p = priceFromReference(ref);
    if (p == null) continue;
    assert.equal(p % 100, 90);
    assert.ok(p * 10000 <= ref * 9500, `${ref}->${p}`);
    assert.ok(p + 100 > Math.floor((ref * 9500) / 10000), `${ref}->${p} não é o maior`);
  }
});
test('trava de margem: piso acima da regra mantém o piso e sinaliza', () => {
  const locked = decideReferencePrice({ referenceCents: 6490, floorCents: 6300 });
  assert.equal(locked.marginLocked, true);
  assert.equal(locked.finalCents, 6390);
  assert.equal(locked.reason, 'MARGIN_LOCK');
  const free = decideReferencePrice({ referenceCents: 6490, floorCents: 3000 });
  assert.equal(free.marginLocked, false);
  assert.equal(free.finalCents, 6090);
  assert.equal(free.belowMarketBps, Math.round(((6490 - 6090) * 10000) / 6490));
});
test('sem referência mantém o preço atual respeitando o piso; gratuito = 0', () => {
  assert.equal(decideReferencePrice({ referenceCents: null, currentCents: 2490, floorCents: 1000 }).finalCents, 2490);
  assert.equal(decideReferencePrice({ referenceCents: null, currentCents: 500, floorCents: 1000 }).finalCents, 1090);
  assert.equal(decideReferencePrice({ referenceCents: 6490, isFree: true }).finalCents, 0);
});
test('dinheiro: parse/format/bps/allocate sem perder centavo', () => {
  assert.equal(parseBRLToCents('R$ 1.234,56'), 123456);
  assert.equal(parseBRLToCents('29,9'), 2990);
  assert.equal(parseBRLToCents('29.90'), 2990);
  assert.equal(formatBRL(123456), 'R$ 1.234,56');
  assert.equal(formatBRL(-5), '-R$ 0,05');
  assert.equal(applyBps(2490, 1000), 249);
  assert.equal(applyBps(1, 5000), 1); // half-up
  assert.equal(divRound(-5, 2), -3);
  const parts = allocate(100, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);
});
