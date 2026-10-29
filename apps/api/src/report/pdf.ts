import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import type { ReportItem, ReportV2 } from './normalizeV2.js';
import { brlFromCents } from './format.js';
import { maskPlate } from './mask.js';

export interface ReportMeta {
  productName: string;
  verificationCode: string;
  verificationUrl: string;
  consultedAt: Date;
  /** hash do resultado (vehicle_queries.result_hash) mostrado para conferência */
  resultHash?: string | null;
  brandName?: string;
  audience?: 'client' | 'team';
  /** modelo de exemplo com dados fictícios: marca d'água e aviso, sem validade */
  sample?: boolean;
}

const FONT_DIR = new URL('../../assets/fonts/', import.meta.url);
const font = (name: string) => readFileSync(new URL(name, FONT_DIR));

export const W = 595.28; export const H = 841.89; export const M = 40; export const CW = W - M * 2;
export const C = {
  ink: rgb(0.059, 0.059, 0.078), text: rgb(0.122, 0.145, 0.19), muted: rgb(0.42, 0.45, 0.5), line: rgb(0.9, 0.91, 0.935), soft: rgb(0.965, 0.96, 0.99),
  violet: rgb(0.545, 0.361, 0.965), lilac: rgb(0.753, 0.518, 0.988), blue: rgb(0.231, 0.51, 0.965), white: rgb(1, 1, 1),
  green: rgb(0.086, 0.6, 0.36), greenBg: rgb(0.9, 0.97, 0.93), amber: rgb(0.8, 0.5, 0.04), amberBg: rgb(1, 0.96, 0.87), red: rgb(0.85, 0.2, 0.2), redBg: rgb(1, 0.92, 0.92), grayBg: rgb(0.94, 0.945, 0.955)
};

const VERDICT_STYLE = {
  CLEAR: { fg: C.green, bg: C.greenBg, label: 'SEM ALERTAS' },
  ATTENTION: { fg: C.amber, bg: C.amberBg, label: 'ATENÇÃO' },
  HIGH_RISK: { fg: C.red, bg: C.redBg, label: 'ALTO RISCO' },
  INCONCLUSIVE: { fg: C.muted, bg: C.grayBg, label: 'ANÁLISE LIMITADA' }
} as const;


export interface RectOpts { x: number; y: number; width: number; height: number; color?: RGB; borderColor?: RGB; borderWidth?: number; borderRadius?: number }
/** pdf-lib não tem cantos arredondados nativos: desenha via caminho SVG (origem no canto superior esquerdo). */
export function rect(page: PDFPage, o: RectOpts) {
  const r = Math.min(o.borderRadius ?? 0, o.width / 2, o.height / 2);
  if (!r) { page.drawRectangle({ x: o.x, y: o.y, width: o.width, height: o.height, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth }); return; }
  const { width: w, height: h } = o;
  const path = `M ${r},0 H ${w - r} A ${r},${r} 0 0 1 ${w},${r} V ${h - r} A ${r},${r} 0 0 1 ${w - r},${h} H ${r} A ${r},${r} 0 0 1 0,${h - r} V ${r} A ${r},${r} 0 0 1 ${r},0 Z`;
  page.drawSvgPath(path, { x: o.x, y: o.y + h, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth });
}

export class Doc {
  pdf!: PDFDocument; page!: PDFPage; y = 0; pages: PDFPage[] = [];
  jx800!: PDFFont; jx700!: PDFFont; jx600!: PDFFont; dm400!: PDFFont; dm500!: PDFFont; dm700!: PDFFont;
  static async create(): Promise<Doc> {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.pdf.registerFontkit(fontkit);
    const embed = (n: string) => d.pdf.embedFont(font(n), { subset: true });
    [d.jx800, d.jx700, d.jx600, d.dm400, d.dm500, d.dm700] = await Promise.all([
      embed('plus-jakarta-sans-latin-800-normal.woff'), embed('plus-jakarta-sans-latin-700-normal.woff'), embed('plus-jakarta-sans-latin-600-normal.woff'),
      embed('dm-sans-latin-400-normal.woff'), embed('dm-sans-latin-500-normal.woff'), embed('dm-sans-latin-700-normal.woff')
    ]);
    return d;
  }
  addPage(): PDFPage { this.page = this.pdf.addPage([W, H]); this.pages.push(this.page); this.y = H - M - 10; return this.page; }
  ensure(h: number) { if (this.y - h < 52) { this.addPage(); this.y = H - M; } }
  text(t: string, x: number, y: number, size: number, f: PDFFont, color: RGB, opts: { maxWidth?: number } = {}) {
    const safe = clean(t);
    this.page.drawText(opts.maxWidth ? fit(f, safe, size, opts.maxWidth) : safe, { x, y, size, font: f, color });
  }
  wrap(t: string, f: PDFFont, size: number, maxWidth: number): string[] {
    const words = clean(t).split(/\s+/); const lines: string[] = []; let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) <= maxWidth) cur = next; else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
}

/** remove caracteres que as fontes embutidas (latin) não cobrem */
export const clean = (t: string) => String(t ?? '').normalize('NFC').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E -ſ]/g, '');
export function fit(f: PDFFont, t: string, size: number, maxWidth: number): string {
  if (f.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let s = t; while (s.length > 1 && f.widthOfTextAtSize(`${s}…`.replace('…', '...'), size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

export function drawLogo(d: Doc, x: number, y: number, size: number, dark: boolean) {
  // marca: placa estilizada (retângulo com faixa azul) dentro de um quadrado violeta
  const p = d.page;
  rect(p, { x, y, width: size, height: size, color: C.violet, borderRadius: size * 0.26 });
  const pw = size * 0.66; const ph = size * 0.42; const px = x + (size - pw) / 2; const py = y + (size - ph) / 2 - size * 0.02;
  rect(p, { x: px, y: py, width: pw, height: ph, color: C.white, borderRadius: size * 0.06 });
  rect(p, { x: px, y: py + ph - ph * 0.28, width: pw, height: ph * 0.28, color: C.blue, borderRadius: size * 0.04 });
  rect(p, { x: px + pw * 0.16, y: py + ph * 0.2, width: pw * 0.68, height: ph * 0.18, color: C.ink });
  void dark;
}

function drawPlate(d: Doc, plate: string, x: number, y: number, w = 150) {
  const h = w * 0.3; const p = d.page;
  rect(p, { x, y, width: w, height: h, color: C.white, borderColor: C.ink, borderWidth: 1.4, borderRadius: 6 });
  rect(p, { x: x + 1, y: y + h - h * 0.27, width: w - 2, height: h * 0.27 - 1, color: C.blue, borderRadius: 5 });
  d.text('BRASIL', x + w / 2 - d.dm700.widthOfTextAtSize('BRASIL', 6) / 2, y + h - h * 0.2, 6, d.dm700, C.white);
  const size = h * 0.5; const t = plate.length === 7 ? `${plate.slice(0, 3)} ${plate.slice(3)}` : plate;
  const tw = d.jx800.widthOfTextAtSize(t, size);
  d.text(t, x + (w - tw) / 2, y + h * 0.17, size, d.jx800, C.ink);
}

function chip(d: Doc, label: string, x: number, y: number, fg: RGB, bg: RGB): number {
  const size = 7; const w = d.dm700.widthOfTextAtSize(label, size) + 12;
  rect(d.page, { x, y: y - 3, width: w, height: 13, color: bg, borderRadius: 6.5 });
  d.text(label, x + 6, y + 0.5, size, d.dm700, fg);
  return w;
}

const STATE_COLOR = (s: ReportItem['state']) => s === 'ALERT' ? C.red : s === 'CLEAR' ? C.green : C.muted;

function header(d: Doc, meta: ReportMeta, report: ReportV2) {
  const p = d.page;
  rect(p, { x: 0, y: H - 112, width: W, height: 112, color: C.ink });
  rect(p, { x: 0, y: H - 112, width: W, height: 3, color: C.violet });
  drawLogo(d, M, H - 74, 34, true);
  d.text(meta.brandName ?? 'Placa na Mão', M + 44, H - 61, 17, d.jx800, C.white);
  d.text('Consulta veicular por placa', M + 44, H - 75, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  const right = 'Relatório de consulta veicular';
  d.text(right, W - M - d.jx700.widthOfTextAtSize(right, 10.5), H - 58, 10.5, d.jx700, C.white);
  const code = `Código ${meta.verificationCode}`;
  d.text(code, W - M - d.dm500.widthOfTextAtSize(code, 8.5), H - 72, 8.5, d.dm500, C.lilac);
  const when = meta.consultedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  d.text(when, W - M - d.dm400.widthOfTextAtSize(when, 8), H - 85, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  // placa + veículo
  d.y = H - 112 - 30;
  drawPlate(d, report.plate, M, d.y - 36, 152);
  const hl = report.headline; const tx = M + 172;
  const title = [hl.brand, hl.model].filter(Boolean).join(' ') || hl.fullModel || 'Veículo';
  d.text(title, tx, d.y - 4, 17, d.jx800, C.ink, { maxWidth: W - M - tx });
  const sub = [hl.manufactureYear && hl.modelYear ? `${hl.manufactureYear}/${hl.modelYear}` : hl.modelYear ?? hl.manufactureYear, hl.color, hl.fuel].filter(Boolean).join('  ·  ');
  if (sub) d.text(sub, tx, d.y - 22, 10, d.dm500, C.muted, { maxWidth: W - M - tx });
  const place = [hl.city, hl.state].filter(Boolean).join(' - ');
  if (place) d.text(place, tx, d.y - 36, 9, d.dm400, C.muted, { maxWidth: W - M - tx });
  d.y -= 62;
}

function verdictCard(d: Doc, report: ReportV2) {
  const v = report.verdict; const st = VERDICT_STYLE[v.level];
  const lines = d.wrap(v.reason, d.dm400, 9.5, CW - 36);
  const h = 44 + lines.length * 13;
  d.ensure(h + 10);
  const y = d.y - h;
  rect(d.page, { x: M, y, width: CW, height: h, color: st.bg, borderRadius: 10 });
  rect(d.page, { x: M, y, width: 5, height: h, color: st.fg, borderRadius: 2 });
  chip(d, st.label, M + 18, y + h - 22, C.white, st.fg);
  d.text(v.title, M + 18 + d.dm700.widthOfTextAtSize(st.label, 7) + 22, y + h - 20, 12.5, d.jx800, C.ink);
  lines.forEach((l, i) => d.text(l, M + 18, y + h - 40 - i * 13, 9.5, d.dm400, C.text));
  d.y = y - 14;
}

function stats(d: Doc, report: ReportV2) {
  const allItems = report.sections.flatMap((s) => s.items);
  const get = (k: string) => allItems.find((i) => i.key === k);
  const restrictionAlerts = report.verdict.alerts.filter((a) => a.high || /^RES|RESTRICAO|INTENCAO/.test(a.key)).length;
  const recall = get('RECALL');
  const restrictionsVisible = (report.sections.find((x) => x.key === 'RESTRICOES')?.items.length ?? 0) > 0;
  const HIDDEN = 'Fora do plano';
  const tiles: Array<{ label: string; value: string; color: RGB }> = [
    { label: 'Débitos em aberto', value: report.debtsHidden ? HIDDEN : report.debts.totalCents > 0 ? brlFromCents(report.debts.totalCents) : report.coverage.debtsProvided ? 'Nenhum' : 'Não fornecido', color: report.debtsHidden ? C.muted : report.debts.totalCents > 0 ? C.red : report.coverage.debtsProvided ? C.green : C.muted },
    { label: 'Restrições', value: !restrictionsVisible ? HIDDEN : !report.coverage.restrictionsProvided ? 'Não fornecido' : restrictionAlerts > 0 ? `${restrictionAlerts} ocorrência${restrictionAlerts > 1 ? 's' : ''}` : 'Nada consta', color: !restrictionsVisible || !report.coverage.restrictionsProvided ? C.muted : restrictionAlerts > 0 ? C.red : C.green },
    { label: 'Recall', value: !recall ? HIDDEN : recall.state === 'NOT_PROVIDED' ? 'Não fornecido' : (recall.display ?? ''), color: !recall ? C.muted : STATE_COLOR(recall.state) },
    { label: 'Situação', value: get('SITUACAOVEICULO')?.display ?? (get('SITUACAOVEICULO') ? 'Não fornecido' : HIDDEN), color: get('SITUACAOVEICULO')?.state === 'ALERT' ? C.red : C.text }
  ];
  const gap = 8; const w = (CW - gap * 3) / 4; const h = 46;
  d.ensure(h + 12);
  tiles.forEach((t, i) => {
    const x = M + i * (w + gap); const y = d.y - h;
    rect(d.page, { x, y, width: w, height: h, color: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 8 });
    d.text(t.label.toUpperCase(), x + 10, y + h - 14, 6.5, d.dm700, C.muted);
    d.text(t.value, x + 10, y + 12, 11, d.jx800, t.color, { maxWidth: w - 18 });
  });
  d.y -= h + 16;
}

function sectionTitle(d: Doc, label: string, status: ReportItem['state'], sub: string) {
  d.ensure(60);
  const y = d.y - 14;
  d.page.drawCircle({ x: M + 4, y: y + 3.5, size: 4, color: status === 'ALERT' ? C.red : status === 'CLEAR' ? C.green : C.violet });
  d.text(label, M + 16, y, 12, d.jx800, C.ink);
  const sw = d.dm400.widthOfTextAtSize(sub, 8);
  d.text(sub, W - M - sw, y + 1, 8, d.dm400, C.muted);
  d.page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.8, color: C.line });
  d.y = y - 18;
}

function itemsGrid(d: Doc, items: ReportItem[]) {
  const colGap = 14; const colW = (CW - colGap) / 2;
  for (let i = 0; i < items.length; i += 2) {
    const row = items.slice(i, i + 2);
    const heights = row.map((it) => 14 + d.wrap(it.display ?? it.value ?? '', d.jx600, 9.5, colW - 16).length * 12);
    const rowH = Math.max(...heights) + 4;
    d.ensure(rowH + 4);
    row.forEach((it, c) => {
      const x = M + c * (colW + colGap); const top = d.y;
      d.text(it.label.toUpperCase(), x, top - 8, 6.5, d.dm700, C.muted, { maxWidth: colW });
      const color = it.state === 'ALERT' ? C.red : it.state === 'CLEAR' ? C.green : C.ink;
      if (it.state !== 'INFO') d.page.drawCircle({ x: x + 3, y: top - 19.5, size: 2.6, color });
      const lines = d.wrap(it.display ?? it.value ?? '', d.jx600, 9.5, colW - 16);
      lines.forEach((l, li) => d.text(l, x + (it.state !== 'INFO' ? 11 : 0), top - 21 - li * 12, 9.5, d.jx600, it.state === 'INFO' ? C.ink : color));
    });
    d.y -= rowH;
  }
  d.y -= 6;
}

/** Histórico mensal da FIPE: mini gráfico de linha + tabela compacta (4 colunas). */
function priceSeries(d: Doc, item: ReportItem) {
  const pts = String(item.display ?? item.value ?? '').split(' · ').map((p) => { const m = /^(\S+) R\$\s*([\d.]+),(\d{2})$/.exec(p.trim()); return m ? { label: m[1], cents: Number(m[2].replace(/\./g, '')) * 100 + Number(m[3]) } : null; }).filter((p): p is { label: string; cents: number } => p !== null);
  if (pts.length < 2) return;
  const asc = [...pts].reverse(); // do mais antigo ao mais recente
  const chartH = 54; const rows = Math.ceil(pts.length / 4); const tableH = rows * 13;
  d.ensure(chartH + tableH + 34);
  d.text('HISTÓRICO MENSAL DA FIPE (ÚLTIMOS ' + pts.length + ' MESES)', M, d.y - 8, 6.5, d.dm700, C.muted);
  const top = d.y - 18; const x0 = M + 4; const w = CW - 8;
  const min = Math.min(...asc.map((p) => p.cents)); const max = Math.max(...asc.map((p) => p.cents)); const span = Math.max(1, max - min);
  rect(d.page, { x: M, y: top - chartH, width: CW, height: chartH, color: C.soft, borderRadius: 6 });
  const xy = (p: { cents: number }, i: number) => ({ x: x0 + 6 + (i / (asc.length - 1)) * (w - 12), y: top - chartH + 8 + ((p.cents - min) / span) * (chartH - 16) });
  for (let i = 1; i < asc.length; i++) { const a = xy(asc[i - 1], i - 1); const b = xy(asc[i], i); d.page.drawLine({ start: a, end: b, thickness: 1.4, color: C.violet }); }
  const last = xy(asc[asc.length - 1], asc.length - 1); d.page.drawCircle({ x: last.x, y: last.y, size: 2.6, color: C.violet });
  d.y = top - chartH - 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 4; c++) {
      const p = pts[r * 4 + c]; if (!p) continue;
      const x = M + c * (CW / 4);
      d.text(p.label, x + 3, d.y - 8, 7.5, d.dm400, C.muted);
      d.text(brlFromCents(p.cents), x + 46, d.y - 8, 8, d.jx600, C.ink);
    }
    d.y -= 13;
  }
  d.y -= 8;
}

function debtsBlock(d: Doc, report: ReportV2) {
  if (report.debtsHidden) return;
  const hasItems = report.debts.items.length > 0;
  if (!hasItems && !report.coverage.debtsProvided) return;
  d.ensure(80);
  sectionTitle(d, 'Resumo de débitos', hasItems ? 'ALERT' : 'CLEAR', hasItems ? brlFromCents(report.debts.totalCents) : 'Nenhum débito informado');
  if (hasItems) {
    for (const it of report.debts.items) {
      d.ensure(18);
      d.text(it.label, M + 6, d.y - 10, 9.5, d.dm500, C.text);
      const v = brlFromCents(it.amountCents);
      d.text(v, W - M - d.jx700.widthOfTextAtSize(v, 9.5) - 4, d.y - 10, 9.5, d.jx700, C.ink);
      d.page.drawLine({ start: { x: M, y: d.y - 15 }, end: { x: W - M, y: d.y - 15 }, thickness: 0.4, color: C.line });
      d.y -= 18;
    }
    d.ensure(26);
    rect(d.page, { x: M, y: d.y - 24, width: CW, height: 22, color: C.soft, borderRadius: 6 });
    d.text('Total em aberto', M + 10, d.y - 17, 9.5, d.jx700, C.ink);
    const t = brlFromCents(report.debts.totalCents);
    d.text(t, W - M - d.jx800.widthOfTextAtSize(t, 11) - 10, d.y - 18, 11, d.jx800, C.red);
    d.y -= 32;
    if (report.debts.fineBreakdown.length) {
      const note = `Multas por órgão (${report.debts.fineBreakdown.map((f) => `${f.label.replace('Multas — ', '')}: ${brlFromCents(f.amountCents)}`).join('; ')}) detalham o total de multas e não são somadas novamente.`;
      for (const l of d.wrap(note, d.dm400, 8, CW - 8)) { d.ensure(12); d.text(l, M + 4, d.y - 9, 8, d.dm400, C.muted); d.y -= 11; }
      d.y -= 6;
    }
  } else d.y -= 4;
}

export async function qr(d: Doc, url: string, x: number, y: number, size: number) {
  const code = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = code.modules.size; const cell = size / n; const p = d.page;
  rect(p, { x: x - 4, y: y - 4, width: size + 8, height: size + 8, color: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 6 });
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.modules.get(r, c)) rect(p, { x: x + c * cell, y: y + size - (r + 1) * cell, width: cell + 0.2, height: cell + 0.2, color: C.ink });
}

export async function renderVehiclePdf(report: ReportV2, meta: ReportMeta): Promise<Buffer> {
  const d = await Doc.create();
  d.pdf.setTitle(`Relatório de consulta veicular - ${maskPlate(report.plate)}`);
  d.pdf.setAuthor(meta.brandName ?? 'Placa na Mão');
  d.pdf.setSubject(`${meta.productName} - código ${meta.verificationCode}`);
  d.pdf.setCreationDate(meta.consultedAt);
  d.addPage();
  header(d, meta, report);
  verdictCard(d, report);
  stats(d, report);
  debtsBlock(d, report);

  const empty: string[] = [];
  let omitted = false;
  for (const s of report.sections) {
    const shown = s.items.filter((i) => i.state !== 'NOT_PROVIDED' && !(s.key === 'DEBITOS' && i.kind === 'money' && i.state === 'CLEAR'));
    if (s.items.some((i) => i.state === 'NOT_PROVIDED')) omitted = true;
    if (!shown.length) { if (s.items.length) empty.push(s.label); continue; }
    const series = shown.find((i) => i.key === 'EN_FIPE_SERIE');
    const grid = shown.filter((i) => i !== series);
    sectionTitle(d, s.label, s.status, `${shown.length} informações`);
    if (grid.length) itemsGrid(d, grid);
    if (series) priceSeries(d, series);
  }
  if (empty.length || omitted) {
    const parts = [empty.length ? `Sem dados retornados pela fonte nesta consulta: ${empty.join(', ')}.` : '', omitted ? 'Itens que a fonte não retornou foram omitidos.' : ''].filter(Boolean).join(' ');
    const lines = d.wrap(parts, d.dm400, 7.5, CW - 6);
    d.ensure(lines.length * 10 + 10);
    for (const l of lines) { d.text(l, M + 3, d.y - 8, 7.5, d.dm400, C.muted); d.y -= 10; }
    d.y -= 6;
  }

  if (report.scope?.notIncluded.length) {
    const note = `Não incluído neste produto: ${report.scope.notIncluded.map((n) => n.label).join(', ')}. Isso não significa ausência de ocorrências.`;
    const lines = d.wrap(note, d.dm400, 7.5, CW - 6);
    d.ensure(lines.length * 10 + 10);
    for (const l of lines) { d.text(l, M + 3, d.y - 8, 7.5, d.dm400, C.muted); d.y -= 10; }
    d.y -= 6;
  }

  if (report.lockedAlertCount) {
    d.ensure(40);
    rect(d.page, { x: M, y: d.y - 34, width: CW, height: 34, color: C.soft, borderRadius: 8 });
    d.text(`Há ${report.lockedAlertCount} ponto(s) de atenção fora do plano contratado. Consulte um plano com mais detalhes para ver.`, M + 12, d.y - 21, 9, d.dm500, C.violet, { maxWidth: CW - 24 });
    d.y -= 46;
  }

  // validação + avisos
  d.ensure(150);
  d.y -= 6;
  const boxH = 104; const by = d.y - boxH;
  rect(d.page, { x: M, y: by, width: CW, height: boxH, color: C.soft, borderRadius: 10 });
  await qr(d, meta.verificationUrl, M + 14, by + 14, 76);
  const tx = M + 112;
  d.text('Validação do relatório', tx, by + boxH - 22, 11, d.jx800, C.ink);
  d.text(`Código de verificação: ${meta.verificationCode}`, tx, by + boxH - 38, 9, d.dm500, C.text);
  const hash = (meta.resultHash ?? createHash('sha256').update(JSON.stringify(report)).digest('hex')).slice(0, 32);
  d.text(`Impressão digital: ${hash}`, tx, by + boxH - 51, 7.5, d.dm400, C.muted);
  const vurl = meta.verificationUrl.replace(/^https?:\/\//, '');
  d.text(`Confira a autenticidade em ${vurl}`, tx, by + boxH - 64, 8, d.dm400, C.muted, { maxWidth: CW - 125 });
  const notice = meta.sample ? 'Este é um modelo ilustrativo, com dados fictícios, para mostrar quais informações você recebe nesta consulta. Não tem validade e não se refere a nenhum veículo real.' : 'Informações fornecidas por fonte de dados contratada, conforme retornado na data e hora da consulta; não substituem documentos oficiais nem certidões. Dados pessoais do proprietário (nome e CPF/CNPJ) não são exibidos, em conformidade com a LGPD.';
  d.wrap(notice, d.dm400, 7, CW - 125).forEach((l, i) => d.text(l, tx, by + boxH - 79 - i * 8.5, 7, d.dm400, C.muted));
  d.y = by - 10;

  // rodapé em todas as páginas
  const total = d.pages.length;
  d.pages.forEach((p, i) => {
    if (meta.sample) {
      const wm = 'MODELO · DADOS FICTÍCIOS';
      p.drawText(clean(wm), { x: 110, y: 250, size: 44, font: d.jx800, color: rgb(0.88, 0.88, 0.93), rotate: degrees(40), opacity: 0.55 });
    }
    p.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: C.line });
    const left = `${meta.brandName ?? 'Placa na Mão'}  ·  ${meta.productName}  ·  ${maskPlate(report.plate)}`;
    p.drawText(clean(left), { x: M, y: 22, size: 7.5, font: d.dm400, color: C.muted });
    const right = `Página ${i + 1} de ${total}`;
    p.drawText(right, { x: W - M - d.dm500.widthOfTextAtSize(right, 7.5), y: 22, size: 7.5, font: d.dm500, color: C.muted });
  });
  return Buffer.from(await d.pdf.save());
}
