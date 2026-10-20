import assert from 'node:assert/strict';
import test from 'node:test';
import { fipePdf, fipePrintHtml } from '../dist/fipeReport.js';

const quote = {
  provider: 'fipe',
  source: 'internal',
  consultedAt: '2026-08-22T12:00:00.000Z',
  referenceMonth: 'agosto de 2026',
  referenceCode: '202608',
  vehicleType: 'carros',
  brand: { code: '1', name: 'Marca Teste' },
  model: { code: '2', name: 'Modelo Teste' },
  year: { code: '2020', name: '2020' },
  fuel: 'Flex',
  modelYear: '2020',
  fipeCode: '123456-7',
  valueCents: 100000,
  valueLabel: 'R$ 1.000,00',
  documentCode: 'CPF-TESTE',
  reportHash: 'a'.repeat(64),
  estimatedNegotiation: { minCents: 90000, maxCents: 110000, disclaimer: 'Informativo.' },
  blocks: [{ key: 'FIPE', label: 'Valor FIPE', state: 'FOUND', message: 'Disponível.' }],
  vehicleDetails: { plate: 'ABC1D23', brand: 'Marca Teste', fullModel: 'Modelo Teste', status: 'Regular' }
};

const branding = {
  name: 'Frota Norte',
  primaryColor: '#123456',
  accentColor: '#ABCDEF',
  logoUrl: 'https://example.com/frota-norte.svg'
};

test('renderiza PDF FIPE com o nome da organização', () => {
  const pdf = fipePdf(quote, branding).toString('latin1');
  assert.match(pdf, /Frota Norte/);
  assert.match(pdf, /CONSULTA ZERO/);
  assert.doesNotMatch(pdf, /Placa na Mão/);
});

test('renderiza impressão FIPE com nome, cores e logo da organização', () => {
  const html = fipePrintHtml(quote, branding);
  assert.match(html, /Frota Norte/);
  assert.match(html, /#123456/);
  assert.match(html, /#ABCDEF/);
  assert.match(html, /https:\/\/example\.com\/frota-norte\.svg/);
  assert.match(html, /alt=""/);
});

test('mantém fallback Placa na Mão quando a organização não fornece marca', () => {
  const html = fipePrintHtml(quote, {});
  const pdf = fipePdf(quote, {}).toString('latin1');
  assert.match(html, /Placa na Mão/);
  assert.match(pdf, /Placa na Mão/);
});

assert.equal(typeof fipePdf, 'function');
assert.equal(typeof fipePrintHtml, 'function');
