import { PDFDocument, rgb } from 'pdf-lib';
import { Doc, CW, H, M, W, clean, drawLogo, fit, rect } from './pdf.js';
import type { AdviceCheck, CheckStatus } from './advice.js';

/**
 * Dossiê do veículo: uma capa com o resumo e, em seguida, o relatório de cada consulta da placa, do jeito que foi emitido
 * (cada um mantém o próprio código de validação). O dossiê só reúne; não refaz nem altera nenhum relatório.
 */
export interface DossierEntry { productName: string; consultedAt: Date; code: string; verdict: string; checks: AdviceCheck[]; pdf: Buffer }
export interface DossierInput { plate: string; vehicle: string; entries: DossierEntry[]; generatedAt: Date; validateUrl: string }

const INK = rgb(0.06, 0.06, 0.06); const TEXT = rgb(0.16, 0.16, 0.16); const MUTED = rgb(0.43, 0.43, 0.43); const LINE = rgb(0.8, 0.8, 0.8); const SOFT = rgb(0.96, 0.96, 0.96);
const WORD: Record<CheckStatus, string> = { OK: 'Sem ocorrência', ATTENTION: 'Atenção', ALERT: 'Alerta', NOT_CHECKED: 'Não consultado' };
const RANK: Record<CheckStatus, number> = { ALERT: 3, ATTENTION: 2, OK: 1, NOT_CHECKED: 0 };

/** Pior situação de cada verificação entre todas as consultas do dossiê. */
export function worstChecks(entries: Array<{ checks: AdviceCheck[] }>): AdviceCheck[] {
  const best = new Map<string, AdviceCheck>();
  for (const e of entries) for (const c of e.checks) { const cur = best.get(c.key); if (!cur || RANK[c.status] > RANK[cur.status]) best.set(c.key, c); }
  return [...best.values()].sort((a, b) => RANK[b.status] - RANK[a.status]);
}

export async function renderDossierPdf(input: DossierInput): Promise<Buffer> {
  const d = await Doc.create();
  d.pdf.setTitle(`Dossiê do veículo - ${input.plate}`);
  d.pdf.setAuthor('Placa na Mão');
  d.pdf.setSubject(`${input.entries.length} consulta(s) reunidas`);
  d.pdf.setCreationDate(input.generatedAt);
  d.addPage();
  drawLogo(d, M, H - M - 30, 30, false);
  d.text('Placa na Mão', M + 42, H - M - 20, 13, d.jx800, INK);
  d.text('Dossiê do veículo', M, H - 130, 24, d.jx800, INK);
  d.text(input.plate, M, H - 168, 30, d.jx800, INK);
  if (input.vehicle) d.text(input.vehicle, M, H - 190, 11, d.dm500, TEXT, { maxWidth: CW });
  d.text(`Emitido em ${input.generatedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} às ${input.generatedAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`, M, H - 208, 9, d.dm400, MUTED);
  d.y = H - 240;

  // consultas reunidas
  d.text('Consultas reunidas', M, d.y, 11, d.jx800, INK); d.y -= 16;
  for (const e of input.entries) {
    d.ensure(34);
    rect(d.page, { x: M, y: d.y - 28, width: CW, height: 28, color: SOFT, borderColor: LINE, borderWidth: 0.6, borderRadius: 4 });
    d.text(e.productName, M + 10, d.y - 12, 9.5, d.dm700, INK, { maxWidth: CW * 0.5 });
    d.text(`${e.consultedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}  ·  código ${e.code}`, M + 10, d.y - 23, 7.5, d.dm400, MUTED);
    d.text(fit(d.dm500, clean(e.verdict), 8.5, CW * 0.42), W - M - 10 - Math.min(CW * 0.42, d.dm500.widthOfTextAtSize(clean(e.verdict), 8.5)), d.y - 17, 8.5, d.dm500, TEXT);
    d.y -= 34;
  }

  // resumo das verificações (pior situação entre as consultas)
  const checks = worstChecks(input.entries).filter((c) => c.status !== 'NOT_CHECKED');
  if (checks.length) {
    d.y -= 10; d.ensure(40);
    d.text('Situação das verificações', M, d.y, 11, d.jx800, INK); d.y -= 6;
    d.text('Considera a pior situação encontrada entre as consultas acima.', M, d.y - 8, 8, d.dm400, MUTED); d.y -= 22;
    for (const c of checks) {
      d.ensure(20);
      d.page.drawLine({ start: { x: M, y: d.y - 4 }, end: { x: W - M, y: d.y - 4 }, thickness: 0.4, color: LINE });
      d.text(c.label, M, d.y - 14, 9, d.dm500, TEXT, { maxWidth: CW - 120 });
      const w = WORD[c.status];
      d.text(w, W - M - d.dm700.widthOfTextAtSize(w, 9), d.y - 14, 9, d.dm700, INK);
      d.y -= 20;
    }
  }
  d.y -= 14; d.ensure(70);
  rect(d.page, { x: M, y: d.y - 58, width: CW, height: 58, color: SOFT, borderColor: LINE, borderWidth: 0.6, borderRadius: 4 });
  const note = `Cada relatório a seguir foi emitido na data indicada e mantém o seu próprio código de validação, que pode ser conferido em ${input.validateUrl.replace(/^https?:\/\//, '')}. As informações refletem o momento de cada consulta e não substituem documentos oficiais. O dossiê apenas reúne os relatórios.`;
  d.wrap(note, d.dm400, 8, CW - 20).forEach((l, i) => d.text(l, M + 10, d.y - 16 - i * 10, 8, d.dm400, MUTED));

  d.pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 42 }, end: { x: W - M, y: 42 }, thickness: 0.6, color: LINE });
    pg.drawText(clean(`Placa na Mão  ·  Dossiê  ·  ${input.plate}`), { x: M, y: 30, size: 7.5, font: d.dm500, color: TEXT });
    const right = d.pages.length > 1 ? `Capa ${i + 1}` : 'Capa';
    pg.drawText(right, { x: W - M - d.dm500.widthOfTextAtSize(right, 7.5), y: 30, size: 7.5, font: d.dm500, color: TEXT });
  });

  for (const e of input.entries) {
    const src = await PDFDocument.load(e.pdf);
    const pages = await d.pdf.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => d.pdf.addPage(pg));
  }
  return Buffer.from(await d.pdf.save());
}
