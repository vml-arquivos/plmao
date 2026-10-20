import assert from 'node:assert/strict';
import test from 'node:test';
import { performAdminLookup } from '../dist/adminLookup.js';

const normalized = {
  identification: { plate: 'TST0A00', brand: 'NOVA MOTORS', model: 'ECO X' },
  characteristics: { modelYear: '2023' },
  registration: { status: 'CIRCULACAO' },
  owner: {},
  debts: [],
  restrictions: [],
  recall: 'NAO POSSUI RECALL',
  coverage: { identification: 'FOUND', debts: 'NOT_QUERIED', restrictions: 'NOT_QUERIED', recall: 'NOT_QUERIED' },
  diagnostic: { level: 'CLEAR', title: 'Sem alertas', reason: 'Nenhum alerta no retorno.' }
};

test('consulta administrativa reutiliza o provedor sem tocar em carteira', async () => {
  let calls = 0;
  const result = await performAdminLookup({
    provider: {
      name: 'stub-provider',
      async queryByPlate(plate) {
        calls += 1;
        assert.equal(plate, 'TST0A00');
        return { providerQueryId: 'provider-1', raw: { plate } };
      }
    },
    plate: 'TST0A00',
    productId: 'COMPLETE',
    productName: 'Consulta Completa',
    timeoutMs: 1000,
    normalize(raw) {
      assert.deepEqual(raw, { plate: 'TST0A00' });
      return normalized;
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.plate, 'TST0A00');
  assert.equal(result.providerQueryId, 'provider-1');
  assert.equal(result.productId, 'COMPLETE');
  assert.equal(result.result.identification.plate, 'TST0A00');
  assert.equal('balance' in result, false);
});
