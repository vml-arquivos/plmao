import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
process.env.WEB_ORIGIN = 'https://example.com';

const { hasAsaasCheckoutConfig, hasAsaasIntegrationConfig } = await import('../dist/payments/asaas.js');

function config(overrides = {}) {
  return {
    PAYMENT_PROVIDER: 'asaas',
    PAYMENT_API_BASE_URL: 'https://api-sandbox.asaas.com',
    PAYMENT_API_KEY: 'sandbox-test-key',
    PAYMENT_WEBHOOK_SECRET: 'webhook-test-secret',
    ...overrides
  };
}

test('permite configurar checkout sem segredo de Webhook', () => {
  const current = config({ PAYMENT_WEBHOOK_SECRET: undefined });
  assert.equal(hasAsaasCheckoutConfig(current), true);
  assert.equal(hasAsaasIntegrationConfig(current), false);
});

test('considera a integração completa configurada quando checkout e Webhook têm seus requisitos', () => {
  const current = config();
  assert.equal(hasAsaasCheckoutConfig(current), true);
  assert.equal(hasAsaasIntegrationConfig(current), true);
});

test('mantém checkout desabilitado sem chave de API', () => {
  const current = config({ PAYMENT_API_KEY: undefined });
  assert.equal(hasAsaasCheckoutConfig(current), false);
  assert.equal(hasAsaasIntegrationConfig(current), false);
});
