import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/migrations.ts', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');

function migrationBlock() {
  const start = source.indexOf("id: '009_query_money_pricing_migration'");
  assert.notEqual(start, -1, 'migration 009 não encontrada');
  const end = source.indexOf("id: '", start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

test('migration 009 adiciona preço monetário por produto e converte saldo legado com auditoria', () => {
  const block = migrationBlock();
  assert.match(block, /ALTER TABLE query_products ADD COLUMN IF NOT EXISTS price_cents integer/);
  assert.match(block, /price_cents = CASE/);
  assert.match(block, /COALESCE\(reference_price_cents, GREATEST\(credit_cost, 1\) \* 100\)/);
  assert.match(block, /CREATE TABLE IF NOT EXISTS wallet_money_conversions/);
  assert.match(block, /conversion_rate_cents integer NOT NULL DEFAULT 100/);
  assert.match(block, /INSERT INTO wallet_money_conversions\(user_id,legacy_credit_balance,converted_balance_cents\)/);
  assert.match(block, /ON CONFLICT\(user_id\) DO NOTHING/);
  assert.match(block, /CONVERT_LEGACY_CREDITS_TO_CENTS/);
  assert.match(block, /audit_log_id IS NULL/);
});

test('migration 009 permite ordens QUERY com package nullable e créditos não negativos', () => {
  const block = migrationBlock();
  assert.match(block, /ALTER TABLE payment_orders ALTER COLUMN package_id DROP NOT NULL/);
  assert.match(block, /ALTER TABLE payment_orders ALTER COLUMN credits DROP NOT NULL/);
  assert.match(block, /ALTER TABLE payment_orders ALTER COLUMN credits SET DEFAULT 0/);
  assert.match(block, /payment_orders_credits_nonnegative_check CHECK \(credits >= 0\)/);
  assert.match(block, /purchase_type IN \('CREDIT_PACKAGE','QUERY'\)/);
  assert.match(block, /product_id text/);
  assert.match(block, /query_plate text/);
});

test('migration 009 cria preços por organização e entitlement de consulta', () => {
  const block = migrationBlock();
  assert.match(block, /CREATE TABLE IF NOT EXISTS organization_query_prices/);
  assert.match(block, /organization_id uuid NOT NULL REFERENCES organizations\(id\)/);
  assert.match(block, /product_id text NOT NULL REFERENCES query_products\(id\)/);
  assert.match(block, /UNIQUE\(organization_id, product_id\)/);
  assert.match(block, /CREATE TABLE IF NOT EXISTS query_payment_entitlements/);
  assert.match(block, /order_id uuid NOT NULL UNIQUE REFERENCES payment_orders\(id\)/);
  assert.match(block, /status text NOT NULL DEFAULT 'READY' CHECK \(status IN \('READY','CONSUMED','FAILED'\)\)/);
});

test('server separa ordens QUERY do saldo legado e expõe os contratos monetários', () => {
  assert.match(serverSource, /purchaseType === 'QUERY'/);
  assert.match(serverSource, /query_payment_entitlements/);
  assert.match(serverSource, /priceCents/);
  assert.match(serverSource, /amountCents/);
  assert.match(serverSource, /paymentOrderId/);
  assert.match(serverSource, /payments\/query\/quote/);
  assert.match(serverSource, /payments\/query\/checkout/);
});
