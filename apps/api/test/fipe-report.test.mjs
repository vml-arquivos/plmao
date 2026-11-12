import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fipePdf, fipePrintHtml } from '../dist/fipeReport.js';

/** Texto do PDF (as fontes vão embutidas, então não dá para ler o texto direto do arquivo). */
function pdfText(buf) {
  const f = path.join(os.tmpdir(), `fipe-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch { return null; } finally { fs.rmSync(f, { force: true }); }
}

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

test('renderiza PDF FIPE com o nome da organização, no padrão visual da plataforma', async () => {
  const buf = await fipePdf(quote, branding);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const text = pdfText(buf);
  if (text === null) return;
  assert.match(text, /Frota Norte/);
  assert.match(text, /Consulta Zero/);
  assert.match(text, /Valor FIPE vigente/i);
  assert.match(text, /Valida..o do relat.rio/);
  assert.doesNotMatch(text, /Placa na Mão/);
});

test('renderiza impressão FIPE com nome, cores e logo da organização', () => {
  const html = fipePrintHtml(quote, branding);
  assert.match(html, /Frota Norte/);
  assert.match(html, /#123456/);
  assert.match(html, /#ABCDEF/);
  assert.match(html, /https:\/\/example\.com\/frota-norte\.svg/);
  assert.match(html, /alt=""/);
});

test('mantém fallback Placa na Mão quando a organização não fornece marca, com as cores da marca', async () => {
  const html = fipePrintHtml(quote, {});
  const text = pdfText(await fipePdf(quote, {}));
  assert.match(html, /Placa na Mão/);
  assert.match(html, /#1F5FE0/);
  assert.doesNotMatch(html, /#168579|#C99A3D/);
  if (text !== null) assert.match(text, /Placa na Mão/);
});

assert.equal(typeof fipePdf, 'function');
assert.equal(typeof fipePrintHtml, 'function');
