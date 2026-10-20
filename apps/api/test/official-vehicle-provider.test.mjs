import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-zod';
process.env.DATA_PROVIDER = 'real';
process.env.VEHICLE_API_BASE_URL = 'https://gateway.apibrasil.io/api/v2';
process.env.VEHICLE_API_QUERY_PATH = 'consulta/veiculos/credits';
process.env.VEHICLE_API_QUERY_METHOD = 'post';
process.env.VEHICLE_API_AUTH_SCHEME = 'bearer';
process.env.VEHICLE_API_TOKEN = 'legacy-token';
process.env.APIBRASIL_BEARER_TOKEN = 'apibrasil-token';

const { OfficialVehicleProvider } = await import('../dist/providers/officialVehicleProvider.js');

test('envia placa para o endpoint APIBrasil por POST sem expor token na URL', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      response: {
        placa: 'JIW6972',
        marca: 'VOLKSWAGEN',
        modelo: 'GOL 1.0',
        ano: '2020',
        anoModelo: '2021'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await new OfficialVehicleProvider().queryByPlate('JIW6972');
    assert.equal(request.url, 'https://gateway.apibrasil.io/api/v2/consulta/veiculos/credits');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.authorization, 'Bearer apibrasil-token');
    assert.equal(request.init.headers['content-type'], 'application/json');
    assert.equal(request.init.body, JSON.stringify({ placa: 'JIW6972' }));
    assert.equal(result.providerQueryId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
