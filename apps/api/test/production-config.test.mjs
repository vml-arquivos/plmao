import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const testDir = dirname(fileURLToPath(import.meta.url));
const probe = resolve(testDir, 'fixtures/config-probe.mjs');
const baseEnv = {
  ...process.env,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.test:5432/app',
  DATABASE_SSL: 'true',
  JWT_SECRET: 'a'.repeat(80),
  APP_URL: 'https://app.example.test',
  WEB_ORIGIN: 'https://app.example.test',
  DATA_PROVIDER: 'real',
  VEHICLE_API_BASE_URL: 'https://vehicle.example.test',
  VEHICLE_API_QUERY_PATH: '/v1/query',
  VEHICLE_API_QUERY_METHOD: 'post',
  VEHICLE_API_AUTH_SCHEME: 'bearer',
  VEHICLE_API_TOKEN: 'vehicle-runtime-token',
  PAYMENT_PROVIDER: 'asaas',
  PAYMENT_API_BASE_URL: 'https://api.asaas.com',
  PAYMENT_API_KEY: 'asaas-runtime-key',
  PAYMENT_WEBHOOK_SECRET: 'webhook-runtime-secret',
  EMAIL_PROVIDER: 'disabled',
  SANDBOX_SEED_ENABLED: 'false',
  SANDBOX_CREDIT_PURCHASE_ENABLED: 'false'
};

test('produção falha antes do startup quando usa mock, sandbox ou URLs inseguras', () => {
  const result = spawnSync(process.execPath, [probe], {
    env: { ...baseEnv, DATA_PROVIDER: 'mock', PAYMENT_PROVIDER: 'sandbox', APP_URL: 'http://app.example.test', WEB_ORIGIN: 'http://app.example.test', SANDBOX_SEED_ENABLED: 'true' },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATA_PROVIDER_MOCK_FORBIDDEN/);
  assert.match(result.stderr, /PAYMENT_PROVIDER_SANDBOX_FORBIDDEN/);
  assert.match(result.stderr, /APP_URL_HTTPS_REQUIRED/);
  assert.doesNotMatch(result.stderr, /vehicle-runtime-token|asaas-runtime-key/);
});

test('produção aceita provider real e pagamento completo sem imprimir credenciais', () => {
  const result = spawnSync(process.execPath, [probe], { env: baseEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CONFIG_OK/);
  assert.doesNotMatch(result.stdout + result.stderr, /vehicle-runtime-token|asaas-runtime-key|webhook-runtime-secret/);
});

test('produção aceita pagamento explicitamente desabilitado sem credenciais de gateway', () => {
  const result = spawnSync(process.execPath, [probe], {
    env: {
      ...baseEnv,
      PAYMENT_PROVIDER: 'disabled',
      PAYMENT_API_BASE_URL: '',
      PAYMENT_API_KEY: '',
      PAYMENT_WEBHOOK_SECRET: ''
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CONFIG_OK/);
});
