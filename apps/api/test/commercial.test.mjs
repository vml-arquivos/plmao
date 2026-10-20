import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateAffiliateCommission,
  calculateCouponDiscount,
  couponHasCapacity,
  couponWindowIsOpen,
  effectiveQueryPriceCents,
  queryAmountAfterCoupon
} from '../dist/commercial.js';

test('calcula desconto percentual com arredondamento para baixo', () => {
  assert.equal(calculateCouponDiscount(999, 'PERCENT', 15), 149);
  assert.equal(calculateCouponDiscount(1000, 'PERCENT', 100), 1000);
});

test('calcula desconto fixo sem permitir valor final negativo', () => {
  assert.equal(calculateCouponDiscount(2500, 'FIXED', 700), 700);
  assert.equal(calculateCouponDiscount(2500, 'FIXED', 5000), 2500);
});

test('rejeita descontos inválidos sem produzir crédito indevido', () => {
  assert.equal(calculateCouponDiscount(2500, 'PERCENT', 0), 0);
  assert.equal(calculateCouponDiscount(0, 'FIXED', 100), 0);
  assert.equal(calculateCouponDiscount(2500, 'FIXED', Number.NaN), 0);
});

test('respeita janela de validade e limites inclusivos', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  assert.equal(couponWindowIsOpen({ active: true, startsAt: '2026-08-22T12:00:00.000Z', expiresAt: '2026-08-22T12:00:00.000Z', now }), true);
  assert.equal(couponWindowIsOpen({ active: false, now }), false);
  assert.equal(couponWindowIsOpen({ active: true, startsAt: '2026-08-22T12:00:01.000Z', now }), false);
  assert.equal(couponWindowIsOpen({ active: true, expiresAt: '2026-08-22T11:59:59.000Z', now }), false);
});

test('considera reservas no limite de uso do cupom', () => {
  assert.equal(couponHasCapacity(3, 1, 1), true);
  assert.equal(couponHasCapacity(3, 1, 2), false);
  assert.equal(couponHasCapacity(null, 999, 999), true);
});

test('calcula comissão em basis points sobre o valor final pago', () => {
  assert.equal(calculateAffiliateCommission(10000, 1000), 1000);
  assert.equal(calculateAffiliateCommission(999, 1250), 124);
  assert.equal(calculateAffiliateCommission(10000, 0), 0);
});

// Mantém a regra de negócio explícita: commission_bps nunca deve gerar valor negativo.
test('não gera comissão negativa para valores inválidos', () => {
  assert.equal(calculateAffiliateCommission(-1, 1000), 0);
  assert.equal(calculateAffiliateCommission(1000, -1), 0);
});

assert.equal(typeof calculateCouponDiscount, 'function');
assert.equal(typeof couponWindowIsOpen, 'function');
assert.equal(typeof couponHasCapacity, 'function');
assert.equal(typeof calculateAffiliateCommission, 'function');
assert.equal(typeof effectiveQueryPriceCents, 'function');
assert.equal(typeof queryAmountAfterCoupon, 'function');

test('aceita cupom dentro da janela e rejeita expirado ou esgotado antes do pagamento', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');
  const activeCoupon = { active: true, startsAt: '2026-08-22T00:00:00.000Z', expiresAt: '2026-08-23T00:00:00.000Z' };
  assert.equal(couponWindowIsOpen({ ...activeCoupon, now }), true);
  assert.equal(calculateCouponDiscount(2000, 'PERCENT', 10), 200);
  assert.equal(couponWindowIsOpen({ active: true, expiresAt: '2026-08-21T23:59:59.000Z', now }), false);
  assert.equal(couponHasCapacity(10, 10, 0), false);
});


// O status CREATED é literal; a quantidade de expressões precisa continuar igual à quantidade de colunas.
test('mantém o INSERT de payment_orders com colunas e expressões alinhadas', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
  const match = source.match(/INSERT INTO payment_orders\(([^)]+)\)\s+VALUES\(([^)]+)\)\s+RETURNING id/);
  assert.ok(match, 'INSERT de payment_orders não encontrado');
  const columns = match[1].split(',').map((item) => item.trim()).filter(Boolean);
  const expressions = match[2].split(',').map((item) => item.trim()).filter(Boolean);
  assert.equal(columns.length, expressions.length);
  assert.equal(expressions.filter((item) => item === "'CREATED'").length, 1);
  assert.equal(expressions.includes('$12'), false);
});


test('resolve preço monetário gratuito, negociado e base', () => {
  assert.equal(effectiveQueryPriceCents({ priceCents: 2500, isFree: true }), 0);
  assert.equal(effectiveQueryPriceCents({ priceCents: 2500, negotiatedPriceCents: 1900 }), 1900);
  assert.equal(effectiveQueryPriceCents({ priceCents: 2500, negotiatedPriceCents: null }), 2500);
});

test('calcula total monetário da consulta e rejeita cupom que zera produto pago', () => {
  assert.deepEqual(queryAmountAfterCoupon(2500, 'PERCENT', 10), { subtotalCents: 2500, discountCents: 250, amountCents: 2250 });
  assert.deepEqual(queryAmountAfterCoupon(0, 'FIXED', 100), { subtotalCents: 0, discountCents: 0, amountCents: 0 });
  assert.throws(() => queryAmountAfterCoupon(1000, 'PERCENT', 100), /COUPON_ZERO_TOTAL_UNSUPPORTED/);
});
