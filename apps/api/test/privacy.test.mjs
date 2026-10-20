import assert from 'node:assert/strict';
import test from 'node:test';
import { publicVehicleResult, redactPrivateFields, sanitizeAuditMetadata } from '../dist/privacy.js';

test('remove proprietário do resultado público de consulta paga', () => {
  const result = publicVehicleResult({
    identification: { brand: 'Fiat', model: 'Argo', year: '2023' },
    owner: { name: 'Pessoa Teste', document: '00000000000', documentType: 'CPF' },
    debts: [],
    restrictions: [],
    recall: [],
    coverage: {}
  });
  assert.equal('owner' in result, false);
  assert.deepEqual(result.identification, { brand: 'Fiat', model: 'Argo', year: '2023' });
});

test('remove campos pessoais de configurações de relatório sem alterar dados veiculares', () => {
  const result = redactPrivateFields({
    identification: { brand: 'Fiat', model: 'Argo' },
    owner: { name: 'Pessoa Teste', document: '00000000000' },
    unexpected: { CPF_CNPJ_PROPRIETARIO: '00000000000', CHASSI: '9ZZPRIVATE', RENAVAM: '12345678900', MOTOR: 'MOTOR-PRIVATE' },
    address: 'Rua reservada',
    restrictions: [{ label: 'Alienação', alert: true }]
  });
  assert.deepEqual(result, {
    identification: { brand: 'Fiat', model: 'Argo' },
    restrictions: [{ label: 'Alienação', alert: true }]
  });
});

test('mascara placa e remove PII dos metadados de auditoria', () => {
  assert.deepEqual(sanitizeAuditMetadata({ plate: 'ABC1D23', email: 'pessoa@example.test', nested: { document: '00000000000', status: 'SUCCESS' } }), {
    plate: 'ABC***23',
    nested: { status: 'SUCCESS' }
  });
});
