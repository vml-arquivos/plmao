import assert from 'node:assert/strict';
import test from 'node:test';
import { useTestEnv, loadCore, uid, integration } from './helpers/db.mjs';

useTestEnv();
const { pool } = await loadCore();
const { withPlateCache, isPartialResult } = await import('../dist/providers/cachedProvider.js');

function fakeProvider() {
  const calls = [];
  return {
    name: 'credify-teste',
    calls,
    marker: 'preservado',
    async queryByPlate(plate, ctx) { calls.push([plate, ctx?.productId]); return { providerQueryId: `q${calls.length}`, raw: { placa: plate, data: { RESPOSTA: { VEICULOSBDRP: { RETORNO: { NOME: 'JOAO DA SILVA' } } } } } }; },
    async fetchSupplement() { return { ok: true }; }
  };
}
const plate = () => `TST${Math.floor(1000 + Math.random() * 8999)}`.slice(0, 7);

test('cache por placa e pacote: a segunda consulta não chama o fornecedor; outro pacote chama', { skip: !integration }, async () => {
  const base = fakeProvider(); const p = withPlateCache(base, 24); const pl = plate();
  const a = await p.queryByPlate(pl, { productId: 'COMPLETE' });
  const b = await p.queryByPlate(pl, { productId: 'COMPLETE' });
  assert.equal(base.calls.length, 1);
  assert.deepEqual(b.raw, a.raw);
  assert.equal(b.providerQueryId, 'q1');
  await p.queryByPlate(pl, { productId: 'BASIC' });
  assert.equal(base.calls.length, 2, 'outro pacote não reaproveita');
  assert.equal(p.marker, 'preservado');
  assert.deepEqual(await p.fetchSupplement(), { ok: true });
});

test('o que fica no cache é criptografado e vence no prazo', { skip: !integration }, async () => {
  const base = fakeProvider(); const p = withPlateCache(base, 24); const pl = plate();
  await p.queryByPlate(pl, { productId: 'BASIC' });
  const row = (await pool.query(`SELECT payload FROM provider_cache WHERE plate=$1`, [pl])).rows[0];
  assert.ok(row.payload.startsWith('v1.') && !row.payload.includes('JOAO'));
  await pool.query(`UPDATE provider_cache SET created_at = now() - interval '25 hours' WHERE plate=$1`, [pl]);
  await p.queryByPlate(pl, { productId: 'BASIC' });
  assert.equal(base.calls.length, 2, 'venceu: consulta de novo');
});

test('resposta parcial não entra no cache e prazo 0 desliga', { skip: !integration }, async () => {
  const calls = [];
  const partial = { name: 'credify-parcial', async queryByPlate(plate) { calls.push(plate); return { raw: { placa: plate, parcial: true, data: {} } }; } };
  const p = withPlateCache(partial, 24); const pl = plate();
  await p.queryByPlate(pl, { productId: 'COMPLETE' });
  await p.queryByPlate(pl, { productId: 'COMPLETE' });
  assert.equal(calls.length, 2);
  assert.ok(isPartialResult({ gravame: { unavailable: true } }) && isPartialResult({ parcial: true }) && !isPartialResult({ data: {} }));
  const base = fakeProvider();
  assert.equal(withPlateCache(base, 0), base);
});
