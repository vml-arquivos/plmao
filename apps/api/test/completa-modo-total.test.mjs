import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv({ CREDIFY_COMPLETE_MODE: 'total' });
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');
const vt = JSON.parse(fs.readFileSync(new URL('./fixtures/veiculototal-sucesso.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;

test('CREDIFY_COMPLETE_MODE=total devolve a Completa ao pacote Veículo Total (volta atrás sem mudar código)', async () => {
  resetCredifyTokenCache();
  const calls = [];
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    if (path === '/veiculototal') return new Response(JSON.stringify(vt), { status: 200 });
    return new Response(JSON.stringify({}), { status: 404 });
  };
  await new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: 's', method: 'post', timeoutMs: 3000, fetchImpl }).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(calls.includes('/veiculototal'));
  assert.ok(!calls.includes('/indiciosinistro'));
});
