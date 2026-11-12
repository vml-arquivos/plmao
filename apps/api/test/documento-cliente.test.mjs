import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { useTestEnv } from './helpers/db.mjs';

useTestEnv();
const { sampleReport } = await import('../dist/report/sample.js');
const { renderVehiclePdf } = await import('../dist/report/pdf.js');
const { renderVehicleHtml } = await import('../dist/report/printHtml.js');
const { forClientDocument } = await import('../dist/report/clientDoc.js');

function pdfText(buf) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-')), 'r.pdf');
  fs.writeFileSync(f, buf);
  try { return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); } catch { return null; }
}

/** Relatório com tudo o que é assunto interno: ponto fora do plano, o que o produto não inclui, fonte que não respondeu e verificação não consultada. */
function relatorioComAssuntoInterno() {
  const base = sampleReport();
  const sections = base.sections.map((s, i) => (i === 0 ? { ...s, items: [...s.items, { key: 'GR_SITUACAO', label: 'Alienação fiduciária / gravame', kind: 'text', state: 'INFO', value: 'Não informado pela fonte: a base de gravame não retornou dados para este veículo.', display: 'Não informado pela fonte: a base de gravame não retornou dados para este veículo.', sensitivity: 'PUBLIC', tier: 1, high: false }] } : s));
  return {
    ...base,
    sections,
    lockedAlertCount: 2,
    scope: { mode: 'TIER', notIncluded: [{ key: 'DEBITOS', label: 'Débitos' }, { key: 'GRAVAME', label: 'Gravame' }] },
    verdict: { ...base.verdict, level: 'ATTENTION', title: 'Há pontos de atenção fora deste plano', reason: 'O provedor retornou 2 pontos de atenção que não são exibidos no plano contratado.' },
    advice: {
      ...(base.advice ?? { resale: null, toDo: [] }),
      checks: [
        { key: 'lien', label: 'Financiamento e alienação (gravame)', status: 'NOT_CHECKED', detail: 'Não consultado neste pacote ou a fonte não retornou. Isso não significa que está tudo certo.' },
        { key: 'auction', label: 'Passagem por leilão', status: 'NOT_CHECKED', detail: 'Não consultado neste pacote ou a fonte não retornou.' },
        { key: 'theft', label: 'Roubo ou furto', status: 'OK', detail: 'Sem registro na data da consulta.' }
      ]
    }
  };
}
const PROIBIDO = /pacote|plano contratado|fora do plano|fora deste plano|não incluído|nao incluido|neste produto|provedor|fonte não retornou|não consultado|não informado pela fonte|consulte um plano/i;
const meta = { productName: 'Consulta Completa', verificationCode: 'ABCD1234', verificationUrl: 'https://placanamao.test/validar/ABCD1234', consultedAt: new Date(), audience: 'client' };

test('documento do cliente: sem plano, pacote, fonte que não respondeu nem custo de serviço', async () => {
  const doc = forClientDocument(relatorioComAssuntoInterno());
  assert.equal(doc.scope, undefined);
  assert.equal(doc.lockedAlertCount, 0);
  assert.ok(!PROIBIDO.test(JSON.stringify({ v: doc.verdict, a: doc.advice, i: doc.sections.flatMap((x) => x.items) })), 'sobrou texto interno no relatório do cliente');
  assert.deepEqual(doc.advice.checks.map((c) => c.key), ['theft'], 'só o que foi consultado entra no "Antes de pagar"');
  assert.equal(doc.verdict.title, 'Há pontos de atenção neste veículo');

  const html = renderVehicleHtml(relatorioComAssuntoInterno(), meta);
  assert.ok(!PROIBIDO.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), 'HTML de impressão com texto interno');

  const texto = pdfText(await renderVehiclePdf(relatorioComAssuntoInterno(), meta));
  if (texto != null) assert.ok(!PROIBIDO.test(texto), `PDF com texto interno: ${(PROIBIDO.exec(texto) ?? [])[0]}`);
});

test('documento do cliente: o relatório completo (tela e API) continua com os dados todos', () => {
  const full = relatorioComAssuntoInterno();
  forClientDocument(full);
  assert.equal(full.lockedAlertCount, 2);
  assert.equal(full.scope.notIncluded.length, 2);
  assert.equal(full.advice.checks.length, 3);
});
