import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';
process.env.WEB_ORIGIN = 'https://example.com';
process.env.APP_URL = 'https://example.com';
process.env.PAYMENT_PROVIDER = 'mercadopago';
process.env.MP_ACCESS_TOKEN = 'mp-test-access-token';
process.env.MP_WEBHOOK_SECRET = 'mp-test-webhook-secret';

const { MercadoPagoProvider } = await import('../dist/payments/mercadopago.js');

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

test('cria preferência Mercado Pago com valor em reais e referência externa', async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return new Response(JSON.stringify({ id: 'pref-123', init_point: 'https://www.mercadopago.com/checkout/v1/redirect?pref_id=pref-123' }), { status: 201 });
  };

  const provider = new MercadoPagoProvider();
  const result = await provider.createCheckout({
    orderId: 'order-123',
    itemName: 'Pacote Completo',
    itemDescription: 'Consultas veiculares',
    amountCents: 4990,
    customer: { name: 'Cliente Teste', email: 'cliente@example.com' }
  });
  const body = JSON.parse(request.options.body);

  assert.equal(provider.isConfigured(), true);
  assert.equal(request.url, 'https://api.mercadopago.com/checkout/preferences');
  assert.equal(request.options.headers.authorization, 'Bearer mp-test-access-token');
  assert.equal(body.external_reference, 'order-123');
  assert.equal(body.items[0].unit_price, 49.9);
  assert.equal(result.id, 'pref-123');
  assert.match(result.link, /^https:\/\//);
});

test('valida a assinatura documentada do webhook com comparação em tempo constante', () => {
  const provider = new MercadoPagoProvider();
  const payload = { type: 'payment', data: { id: 'payment-123' } };
  const requestId = 'request-123';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const manifest = `id:payment-123;request-id:${requestId};ts:${timestamp};`;
  const hash = crypto.createHmac('sha256', 'mp-test-webhook-secret').update(manifest).digest('hex');
  const request = {
    headers: { 'x-signature': `ts=${timestamp},v1=${hash}`, 'x-request-id': requestId },
    rawBody: Buffer.from(JSON.stringify(payload))
  };

  assert.equal(provider.isValidWebhookSignature(request), true);
  assert.equal(provider.isValidWebhookSignature({ ...request, headers: { ...request.headers, 'x-signature': `ts=${timestamp},v1=${'0'.repeat(64)}` } }), false);
  assert.deepEqual(provider.parseWebhookEvent(payload), { externalReference: null, externalPaymentId: 'payment-123', rawStatus: null });
});
