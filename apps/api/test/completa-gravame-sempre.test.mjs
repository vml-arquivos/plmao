import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv({ CREDIFY_COMPLETE_GRAVAME: 'always' });
const { CredifyVehicleProvider, resetCredifyTokenCache } = await import('../dist/providers/credifyProvider.js');

const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/exemplo-retorno-provedor.json', import.meta.url), 'utf8'));
const jwt = () => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.s`;
const ok = (id, resposta) => ({ CONSULTA: { CODIGORESPOSTA: '1', IDCONSULTA: id }, RESPOSTA: { CODIGO: '1', ...resposta } });

test('CREDIFY_COMPLETE_GRAVAME=always consulta o gravame mesmo com cadastro "nada consta"', async () => {
  resetCredifyTokenCache();
  const calls = [];
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path === '/auth') return new Response(JSON.stringify({ Success: true, Dados: jwt() }), { status: 200 });
    const body = { '/debitosrestricoesproprietarios': sample, '/indiciosinistro': ok('450', { INDICIODESINISTRO: '0' }), '/veicularbnacionalonline': ok('369', { PLACA: 'AAA0000', MARCA: 'VW' }), '/leilaoconjugado': { CONSULTA: { IDCONSULTA: '448' }, RESPOSTA: { CODIGO: '2', DESCRICAORETORNO: 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.' } }, '/gravame': ok('533', { GRAVAME: { PLACA: 'AAA0000', GRAVAMES: {} } }) }[path];
    if (!body) throw new Error(`chamada inesperada: ${path}`);
    return new Response(JSON.stringify(body), { status: 200 });
  };
  await new CredifyVehicleProvider({ baseUrl: 'https://api.credify.test', clientId: 'c', clientSecret: 's', method: 'post', timeoutMs: 3000, fetchImpl }).queryByPlate('AAA0000', { productId: 'COMPLETE' });
  assert.ok(calls.includes('/gravame'));
});
