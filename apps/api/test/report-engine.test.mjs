import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenericReport, reportPdf, reportPrintHtml } from '../dist/reportEngine.js';

const vehicle = {
  identification: { plate: 'ABC1D23', brand: 'Fiat', model: 'Argo' },
  characteristics: { modelYear: '2023', color: 'Prata' },
  registration: { state: 'DF', status: 'ATIVO' },
  owner: { name: 'Pessoa Proprietária', document: '00000000000', documentType: 'CPF' },
  address: 'Rua reservada, 10',
  debts: [],
  restrictions: []
};

test('constrói relatório em ordem determinística e omite campos pessoais mesmo se solicitados', () => {
  const report = buildGenericReport({
    id: 'tpl-test', productId: 'COMPLETE', version: 3, name: 'Teste', status: 'PUBLISHED',
    title: 'Consulta completa', subtitle: 'Placa na Mão',
    sections: [
      { key: 'private', label: 'Privado', order: 99, visible: true, fields: [
        { key: 'owner.name', label: 'Proprietário', visible: true },
        { key: 'owner.document', label: 'CPF', visible: true },
        { key: 'address', label: 'Endereço', visible: true }
      ] },
      { key: 'vehicle', label: 'Veículo', order: 10, visible: true, fields: [
        { key: 'identification.brand', label: 'Marca', visible: true },
        { key: 'identification.plate', label: 'Placa', visible: true }
      ] }
    ]
  }, vehicle, '2026-08-22T00:00:00.000Z');

  assert.deepEqual(report.sections.map((section) => section.key), ['vehicle', 'private']);
  assert.deepEqual(report.sections[0].fields.map((field) => field.value), ['Fiat', 'ABC1D23']);
  assert.equal(report.sections[1].fields.every((field) => field.value === 'Não informado'), true);
  assert.equal(JSON.stringify(report).includes('Pessoa Proprietária'), false);
  assert.equal(JSON.stringify(report).includes('00000000000'), false);
  assert.equal(JSON.stringify(report).includes('Rua reservada'), false);
});

test('renderiza HTML com branding seguro e sem dados privados', () => {
  const report = buildGenericReport({
    id: 'tpl-html', productId: 'CADASTRAL', version: 1, name: 'Catálogo', status: 'PUBLISHED',
    sections: [{ key: 'vehicle', label: 'Veículo', order: 1, fields: [{ key: 'identification.model', label: 'Modelo' }] }]
  }, vehicle, '2026-08-22T00:00:00.000Z');
  const html = reportPrintHtml(report, { name: 'Organização Parceira', primaryColor: '#123456', accentColor: '#654321', logoUrl: 'https://example.com/logo.svg' });
  assert.match(html, /Organização Parceira/);
  assert.match(html, /#123456/);
  assert.match(html, /https:\/\/example\.com\/logo\.svg/);
  assert.doesNotMatch(html, /Pessoa Proprietária|00000000000|Rua reservada/);
  assert.match(html, /window\.print/);
});

test('gera PDF válido com conteúdo do relatório e mensagem de privacidade', () => {
  const report = buildGenericReport({
    id: 'tpl-pdf', productId: 'RESTRICTIONS', version: 2, name: 'PDF', status: 'PUBLISHED',
    sections: [{ key: 'vehicle', label: 'Veículo', order: 1, fields: [{ key: 'identification.model', label: 'Modelo' }] }]
  }, vehicle, '2026-08-22T00:00:00.000Z');
  const pdf = reportPdf(report, { name: 'Placa na Mao White Label' });
  assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.match(pdf.toString('latin1'), /Placa na Mao White Label/);
  assert.match(pdf.toString('latin1'), /Dados pessoais do proprietario sao omitidos/);
  assert.doesNotMatch(pdf.toString('latin1'), /Pessoa Proprietaria|00000000000|Rua reservada/);
});
