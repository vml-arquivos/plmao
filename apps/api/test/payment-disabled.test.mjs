import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
process.env.WEB_ORIGIN = 'https://example.com';
process.env.PAYMENT_PROVIDER = 'disabled';

const { getPaymentProvider } = await import('../dist/payments/index.js');

const provider = getPaymentProvider();

test('provider disabled informa checkout indisponível e não valida webhook', async () => {
  assert.equal(provider.name, 'disabled');
  assert.equal(provider.isConfigured(), false);
  assert.equal(provider.isValidWebhookSignature({ headers: {} }), false);
  assert.equal(provider.parseWebhookEvent({}), null);
  await assert.rejects(
    provider.createCheckout({
      orderId: 'order-test',
      itemName: 'Consulta',
      itemDescription: 'Consulta de teste',
      amountCents: 100,
      customer: { name: 'Teste', email: 'teste@example.com' }
    }),
    (error) => error?.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED'
  );
});
