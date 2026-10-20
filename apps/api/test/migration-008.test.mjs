import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/migrations.ts', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');

function migrationBlock() {
  const start = source.indexOf("id: '008_configurable_reports_org_pricing_security'");
  assert.notEqual(start, -1, 'migration 008 não encontrada');
  const end = source.indexOf("id: '", start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

test('migration 008 preserva report_documents legado e apenas adiciona colunas compatíveis', () => {
  const block = migrationBlock();
  assert.doesNotMatch(block, /CREATE TABLE report_documents/i);
  assert.match(block, /ALTER TABLE report_documents/i);
  assert.match(block, /ADD COLUMN IF NOT EXISTS product_id/i);
  assert.match(block, /ADD COLUMN IF NOT EXISTS template_id/i);
  assert.match(block, /ADD COLUMN IF NOT EXISTS template_version/i);
});

test('migration 008 cria templates publicados antes das configurações obrigatórias de produtos', () => {
  const block = migrationBlock();
  assert.match(block, /CREATE TABLE IF NOT EXISTS report_templates/i);
  assert.match(block, /config::text !~\* 'owner|document|cpf|cnpj|address|endereco'/i);
  assert.match(block, /INSERT INTO report_templates/i);
  assert.match(block, /INSERT INTO product_report_configs/i);
  assert.ok(block.indexOf('INSERT INTO report_templates') < block.indexOf('INSERT INTO product_report_configs'));
});

test('migration 008 conecta preço negociado ao fluxo atual de pacotes de créditos', () => {
  const block = migrationBlock();
  assert.match(block, /CREATE TABLE IF NOT EXISTS organization_credit_package_prices/i);
  assert.match(block, /package_id uuid NOT NULL REFERENCES credit_packages\(id\)/i);
  assert.match(block, /price_cents integer NOT NULL CHECK \(price_cents > 0\)/i);
  assert.match(block, /CREATE INDEX IF NOT EXISTS idx_org_credit_package_prices_window/i);
  assert.doesNotMatch(block, /organization_product_prices\s*\(/i);
});

test('server resolve preço da organização tanto na lista quanto na cotação e checkout', () => {
  const server = serverSource.replace(/\r\n/g, '\n');
  assert.match(server, /effectivePackagePrice\(client, req\.user!\.id, String\(item\.id\), Number\(item\.price_cents\)\)/);
  assert.ok((server.match(/effectivePackagePrice\(client, req\.user!\.id, String\(packRow\.id\), basePriceCents\)/g) ?? []).length >= 2);
  assert.match(server, /amountCents: draft\.amountCents/);
});
