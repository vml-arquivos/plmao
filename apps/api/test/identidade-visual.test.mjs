import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { sampleReport } = await import('../dist/report/sample.js');
const { renderVehicleHtml } = await import('../dist/report/printHtml.js');
const { fipePdf, fipePrintHtml, makeFipeQuote } = await import('../dist/fipeReport.js');
const { renderSimulationPdf } = await import('../dist/simulator/pdf.js');
const { runSimulation, simulationBody } = await import('../dist/simulator/service.js');
const { renderProposalPdf } = await import('../dist/dealer/proposalPdf.js');
const { reportPrintHtml, buildGenericReport } = await import('../dist/reportEngine.js');

const AZUL = /#1F5FE0/i;
const FORA_DA_MARCA = /#262626|#168579|#C99A3D|#f0fdfa|#e9e9e9/i;
const quote = makeFipeQuote({ provider: 'p', source: 's', referenceMonth: 'novembro de 2026', vehicleType: 'cars', brand: { code: '1', name: 'Fiat' }, model: { code: '2', name: 'Argo' }, year: { code: '2020-1', name: '2020 Flex' }, fuel: 'Flex', fipeCode: '001001-1', valueCents: 5_000_000, valueLabel: 'R$ 50.000,00', cacheKey: 'k' });

test('toda impressão HTML sai com as cores da plataforma, sem o cinza ou o verde antigos', () => {
  const meta = { productName: 'Consulta Completa', verificationCode: 'ABCD1234', verificationUrl: 'https://placanamao.test/validar/ABCD1234', consultedAt: new Date(), audience: 'client' };
  const relatorio = renderVehicleHtml(sampleReport(), meta);
  const fipe = fipePrintHtml(quote, {});
  for (const [nome, html] of [['relatório', relatorio], ['FIPE', fipe]]) {
    assert.match(html, AZUL, `${nome}: falta o azul da marca`);
    assert.match(html, /#040B1B/i, `${nome}: falta o azul-marinho do cabeçalho`);
    assert.doesNotMatch(html, FORA_DA_MARCA, `${nome}: cor fora da identidade`);
  }
});

test('todo PDF emitido (FIPE, simulação, proposta) sai sem erro e com a assinatura visual da marca', async () => {
  const settings = { rates: { cdcPf: 1.97, cdcPj: 1.45, leasingPf: null, leasingPj: 1.37 }, fees: { cadastroCents: 60_000, avaliacaoCents: 40_000, registroCents: 25_000 }, iof: { pfDailyPct: 0.0082, pjDailyPct: 0.0041, additionalPct: 0.38, capDays: 365 } };
  const out = runSimulation(simulationBody.parse({ vehicleValueCents: 8_000_000, downPaymentCents: 2_000_000, months: 48 }), settings);
  const pdfs = {
    fipe: await fipePdf(quote, {}),
    simulacao: await renderSimulationPdf(out, { code: 'SIM-1', generatedAt: new Date(), referenceMonth: '2026-11', rateSource: 'teste' }),
    proposta: await renderProposalPdf({ code: 'P1', createdAt: new Date(), validUntil: '2026-12-01', store: { name: 'Loja', whatsapp: null, email: null, city: null, state: null }, customerName: 'Cliente', vehicleLabel: 'Carro', vehicleDetails: [], priceCents: 5_000_000, downPaymentCents: 0, tradeInCents: 0, financing: null, notes: '', sellerName: null, qrUrl: null, siteUrl: 'https://placanamao.com.br' })
  };
  for (const [nome, buf] of Object.entries(pdfs)) {
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-', nome);
    assert.ok(buf.length > 5_000, `${nome}: PDF vazio`);
  }
  // a FIPE deixou de ser texto puro em Helvetica: é gerada pelo mesmo motor dos demais relatórios (fontes da marca embutidas)
  const { PDFDocument } = await import('pdf-lib');
  const fipe = await PDFDocument.load(pdfs.fipe);
  assert.match(fipe.getTitle() ?? '', /Consulta Zero/);
  assert.ok(fipe.getPageCount() >= 1);
});

test('motor de relatório genérico também usa as cores da marca por padrão', () => {
  const report = buildGenericReport({
    id: 'tpl', productId: 'COMPLETE', version: 1, name: 'T', status: 'PUBLISHED', title: 'Consulta', subtitle: 'Placa na Mão',
    sections: [{ key: 'vehicle', label: 'Veículo', order: 1, visible: true, fields: [{ key: 'identification.plate', label: 'Placa', visible: true }] }]
  }, { identification: { plate: 'ABC1D23' } }, '2026-08-22T00:00:00.000Z');
  const html = reportPrintHtml(report, {});
  assert.match(html, AZUL);
  assert.doesNotMatch(html, FORA_DA_MARCA);
});
