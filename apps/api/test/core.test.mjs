import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBdrp, normalizeFipe } from '../dist/normalizer.js';

function payload(overrides = {}) {
  return {
    RESPOSTA: {
      CODIGO: '1',
      VEICULOSBDRP: {
        RETORNO: {
          PLACA: 'TST0A00', MARCA: 'NOVA MOTORS', MODELO: 'ECO X', MARCAMODELOCOMPLETO: 'NOVA MOTORS/ECO X',
          VEIANOFABR: '2022', VEIANOMODELO: '2023', COR: 'PRATA', COMBUSTIVEL: 'FLEX',
          MUNICIPIO: 'GOIANIA', UF: 'GO', SITUACAOVEICULO: 'CIRCULACAO',
          DEBIPVA: '1.825,00', VALORTOTALDEBITOMULTA: '459,00', EXISTEDEBITODELICENCIAMENTOVL: '0,00',
          RESFURTO: 'NADA CONSTA', RESJUDICIAL: 'NADA CONSTA', RESRENAJUD: 'NADA CONSTA', RESADMINISTRATIVA: 'NADA CONSTA',
          RESTRIBUTARIA: 'NADA CONSTA', RESTRICAOFINAN: 'NADA CONSTA', RESTRICAORFB: 'NAO POSSUI RESTRICAO RFB', RESAMBIENTAL: 'OK',
          RECALL: 'NAO POSSUI RECALL',
          ...overrides
        }
      }
    }
  };
}

test('normaliza valores monetários e mantém dados de relatório independentes do fornecedor', () => {
  const report = normalizeBdrp(payload());
  assert.equal(report.identification.plate, 'TST0A00');
  assert.equal(report.identification.fullModel, 'NOVA MOTORS/ECO X');
  assert.equal(report.debts.find((item) => item.key === 'IPVA')?.amountCents, 182500);
  assert.equal(report.debts.find((item) => item.key === 'MULTAS')?.amountCents, 45900);
  assert.equal(report.restrictions.every((item) => !item.alert), true);
  assert.deepEqual(report.coverage, { identification: 'FOUND', debts: 'FOUND', restrictions: 'FOUND', recall: 'FOUND' });
});

test('normaliza resposta veicular da APIBrasil sem exigir campos de relatório completo', () => {
  const report = normalizeBdrp({
    placa: 'JIW6972',
    data: {
      marca: 'VOLKSWAGEN',
      modelo: 'GOL 1.0',
      marcaModelo: 'VOLKSWAGEN GOL 1.0',
      ano: '2020',
      anoModelo: '2021',
      cor: 'PRATA',
      combustivel: 'FLEX',
      tipoVeiculo: 'AUTOMOVEL',
      municipio: 'BRASILIA',
      uf: 'DF',
      chassi: '9BWZZZ377VT004251'
    }
  });
  assert.equal(report.identification.plate, 'JIW6972');
  assert.equal(report.identification.brand, 'VOLKSWAGEN');
  assert.equal(report.identification.model, 'GOL 1.0');
  assert.equal(report.characteristics.manufactureYear, '2020');
  assert.equal(report.characteristics.modelYear, '2021');
  assert.equal(report.characteristics.fuel, 'FLEX');
  assert.equal(report.registration.city, 'BRASILIA');
  assert.equal(report.registration.state, 'DF');
});

test('marca como não consultados os blocos ausentes no retorno', () => {
  const report = normalizeBdrp({ placa: 'JIW6972', data: { marca: 'VOLKSWAGEN', modelo: 'GOL 1.0', marcaModelo: 'VOLKSWAGEN GOL 1.0' } });
  assert.deepEqual(report.coverage, { identification: 'FOUND', debts: 'NOT_QUERIED', restrictions: 'NOT_QUERIED', recall: 'NOT_QUERIED' });
});

test('sinaliza restrição material sem depender apenas da apresentação', () => {
  const report = normalizeBdrp(payload({ RESJUDICIAL: 'RESTRICAO FICTICIA PARA TESTE' }));
  const judicial = report.restrictions.find((item) => item.key === 'JUDICIAL');
  assert.equal(judicial?.alert, true);
  assert.equal(judicial?.status, 'RESTRICAO FICTICIA PARA TESTE');
});

test('rejeita resposta de provedor incompatível', () => {
  assert.throws(() => normalizeBdrp({ RESPOSTA: { CODIGO: '0' } }), /Resposta do provedor inválida/);
});

test('normaliza valor FIPE brasileiro e mantém a referência mensal', () => {
  const quote = normalizeFipe({
    provider: 'parallelum', source: 'Tabela FIPE vigente', brandCode: '59', brand: 'VW',
    modelCode: '123', model: 'Gol 1.0', yearCode: '2024-1', year: '2024 Gasolina',
    codeFipe: '005001-1', price: 'R$ 45.678,90', referenceMonth: 'agosto de 2026', fuel: 'Gasolina', tipoVeiculo: 1
  });
  assert.equal(quote.vehicleType, 'cars');
  assert.equal(quote.valueCents, 4567890);
  assert.equal(quote.fipeCode, '005001-1');
  assert.equal(quote.referenceMonth, 'agosto de 2026');
});

test('não mascara resposta FIPE sem valor ou referência', () => {
  assert.throws(() => normalizeFipe({ brand: 'VW', model: 'Gol', year: '2024', codeFipe: '005001-1', price: '0', referenceMonth: 'agosto de 2026' }), /FIPE_INVALID_RESPONSE/);
  assert.throws(() => normalizeFipe({ brand: 'VW', model: 'Gol', year: '2024', codeFipe: '005001-1', price: 'R$ 45.678,90' }), /FIPE_REFERENCE_MISSING/);
});
