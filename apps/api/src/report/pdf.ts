import { forClientDocument } from './clientDoc.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import type { ReportItem, ReportV2 } from './normalizeV2.js';
import { brlFromCents } from './format.js';
import { ownerIdentityEnabled } from './mask.js';
import { sheetBlocks } from './sheetItems.js';

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
  ink: rgb(0.016, 0.043, 0.106), text: rgb(0.043, 0.086, 0.2), muted: rgb(0.341, 0.4, 0.529), line: rgb(0.878, 0.906, 0.953), soft: rgb(0.957, 0.969, 0.992),
  violet: rgb(0.122, 0.373, 0.878), lilac: rgb(0.486, 0.725, 1), blue: rgb(0.361, 0.682, 0.941), white: rgb(1, 1, 1),
  green: rgb(0.055, 0.624, 0.431), greenBg: rgb(0.89, 0.973, 0.937), amber: rgb(0.706, 0.325, 0.035), amberBg: rgb(0.996, 0.953, 0.78), red: rgb(0.863, 0.149, 0.149), redBg: rgb(0.996, 0.91, 0.91), grayBg: rgb(0.918, 0.941, 0.984)
};

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
  addPage(): PDFPage { this.page = this.pdf.addPage([W, H]); this.pages.push(this.page); this.y = this.firstTop; return this.page; }
  /** topo da área de conteúdo: o relatório de consulta reserva o cabeçalho; os demais PDFs usam a margem de sempre */
  firstTop = H - M - 10; nextTop = H - M;
  ensure(h: number) { if (this.y - h < 52) { this.addPage(); this.y = this.nextTop; } }
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

/* ---------- Layout do relatório de consulta (identidade da plataforma: azul-marinho, azul e fundos claros; verde, âmbar e vermelho só no estado) ---------- */
export const N = {
  ink: rgb(0.016, 0.043, 0.106), text: rgb(0.043, 0.086, 0.2), muted: rgb(0.341, 0.4, 0.529), line: rgb(0.8, 0.84, 0.92), hair: rgb(0.878, 0.906, 0.953),
  band: rgb(0.906, 0.937, 0.996), soft: rgb(0.957, 0.969, 0.992), dark: rgb(0.016, 0.043, 0.106), white: rgb(1, 1, 1),
  blue: rgb(0.122, 0.373, 0.878), blueInk: rgb(0.086, 0.275, 0.69), accent: rgb(0.361, 0.682, 0.941), pale: rgb(0.85, 0.91, 1),
  ok: rgb(0.055, 0.624, 0.431), okSoft: rgb(0.89, 0.973, 0.937), okInk: rgb(0.016, 0.424, 0.306),
  warn: rgb(0.706, 0.325, 0.035), warnSoft: rgb(0.996, 0.953, 0.78), warnInk: rgb(0.573, 0.251, 0.055),
  danger: rgb(0.863, 0.149, 0.149), dangerSoft: rgb(0.996, 0.91, 0.91), dangerInk: rgb(0.6, 0.106, 0.106)
};
export const HB = 152; // altura reservada ao cabeçalho (repetido em todas as páginas)
const LABEL_W = 104;

export interface HeaderInfo {
  brand: string;
  /** título central ("Consulta Veicular", "Consulta Zero") */
  title: string;
  tag: string;
  when: Date;
  code: string;
  url: string;
  vehicle: { name: string; plate?: string; sub?: string };
}

/** Cabeçalho único dos documentos de consulta: faixa azul-marinho com filete de destaque, logo, QR e faixa azul com o veículo. */
export function docHeader(d: Doc, page: PDFPage, idx: number, total: number, h: HeaderInfo) {
  d.page = page;
  const top = H - 22;
  // faixa superior azul-marinho com filete de destaque
  page.drawRectangle({ x: 0, y: H - 88, width: W, height: 88, color: N.dark });
  page.drawRectangle({ x: 0, y: H - 90.5, width: W, height: 2.5, color: N.accent });
  drawLogo(d, M, top - 34, 34, true);
  d.text(h.brand, M + 44, top - 17, 13, d.jx800, N.white);
  d.text('Consulta veicular por placa', M + 44, top - 29, 7, d.dm400, N.accent);
  d.text(h.title, W / 2 - d.jx800.widthOfTextAtSize(clean(h.title), 17) / 2 + 20, top - 16, 17, d.jx800, N.white);
  d.text(h.tag, 190, top - 29, 7.5, d.dm500, N.accent);
  const when = h.when.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  d.text(`Data/hora da consulta: ${when}`, 190, top - 39, 7.5, d.dm700, N.white);
  d.text(`Código ${h.code}  ·  Pág. ${idx + 1}/${total}`, 190, top - 49, 7.5, d.dm500, N.pale);
  void qr(d, h.url, W - M - 40, top - 48, 40);
  // faixa com o veículo
  const bh = 58; const by = H - 90.5 - bh;
  d.page.drawRectangle({ x: 0, y: by, width: W, height: bh, color: N.blue });
  d.page.drawRectangle({ x: 0, y: by, width: W, height: 1.2, color: N.blueInk });
  const nameT = clean(h.vehicle.name).toUpperCase();
  if (h.vehicle.plate) {
    const nameW = Math.min(d.jx800.widthOfTextAtSize(nameT, 15), CW);
    d.text(nameT, W / 2 - nameW / 2, by + bh - 19, 15, d.jx800, N.white, { maxWidth: CW });
    const plate = clean(h.vehicle.plate);
    const pw = d.jx800.widthOfTextAtSize(plate, 14) + 26;
    rect(d.page, { x: W / 2 - pw / 2, y: by + bh - 45, width: pw, height: 21, color: N.white, borderRadius: 5 });
    d.text(plate, W / 2 - d.jx800.widthOfTextAtSize(plate, 14) / 2, by + bh - 39.5, 14, d.jx800, N.dark);
  } else {
    const nameW = Math.min(d.jx800.widthOfTextAtSize(nameT, 15), CW);
    d.text(nameT, W / 2 - nameW / 2, by + bh - 28, 15, d.jx800, N.white, { maxWidth: CW });
  }
  if (h.vehicle.sub) { const sw = Math.min(d.dm500.widthOfTextAtSize(clean(h.vehicle.sub), 7.5), CW); d.text(h.vehicle.sub, W / 2 - sw / 2, by + 6, 7.5, d.dm500, N.pale, { maxWidth: CW }); }
}

/** Rodapé único: filete azul, identificação do documento, página e aviso. */
export function docFooter(d: Doc, p: PDFPage, idx: number, total: number, left: string, notice: string) {
  p.drawRectangle({ x: 0, y: 0, width: W, height: 3, color: N.blue });
  p.drawLine({ start: { x: M, y: 42 }, end: { x: W - M, y: 42 }, thickness: 0.6, color: N.line });
  p.drawText(clean(left), { x: M, y: 30, size: 7.5, font: d.dm500, color: N.text });
  const right = `Página ${idx + 1} de ${total}`;
  p.drawText(right, { x: W - M - d.dm500.widthOfTextAtSize(right, 7.5), y: 30, size: 7.5, font: d.dm500, color: N.text });
  p.drawText(clean(fit(d.dm400, notice, 6.3, CW)), { x: M, y: 19, size: 6.3, font: d.dm400, color: N.muted });
}

function pageHeader(d: Doc, page: PDFPage, idx: number, total: number, meta: ReportMeta, report: ReportV2) {
  const hl = report.headline;
  const name = [hl.brand, hl.model].filter(Boolean).join(' ') || hl.fullModel || 'Veículo';
  const sub = [hl.manufactureYear && hl.modelYear ? `${hl.manufactureYear}/${hl.modelYear}` : hl.modelYear ?? hl.manufactureYear, hl.color, hl.fuel, [hl.city, hl.state].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
  docHeader(d, page, idx, total, { brand: meta.brandName ?? 'Placa na Mão', title: 'Consulta Veicular', tag: 'Informações Exclusivas', when: meta.consultedAt, code: meta.verificationCode, url: meta.verificationUrl, vehicle: { name, plate: report.plate, ...(sub ? { sub } : {}) } });
}

type BadgeState = 'ok' | 'alert' | 'na';
function badgeIcon(d: Doc, cx: number, cy: number, state: BadgeState) {
  const p = d.page; const r = 15;
  if (state === 'ok') {
    p.drawCircle({ x: cx, y: cy, size: r + 2.2, color: N.okSoft });
    p.drawCircle({ x: cx, y: cy, size: r, color: N.ok });
    p.drawLine({ start: { x: cx - 6.5, y: cy - 0.5 }, end: { x: cx - 1.8, y: cy - 5.2 }, thickness: 2.6, color: N.white });
    p.drawLine({ start: { x: cx - 2.2, y: cy - 5 }, end: { x: cx + 7, y: cy + 5.6 }, thickness: 2.6, color: N.white });
  } else if (state === 'alert') {
    p.drawCircle({ x: cx, y: cy, size: r + 2.2, color: N.dangerSoft });
    p.drawCircle({ x: cx, y: cy, size: r, color: N.danger });
    p.drawLine({ start: { x: cx, y: cy + 7.5 }, end: { x: cx, y: cy - 1.2 }, thickness: 2.8, color: N.white });
    p.drawCircle({ x: cx, y: cy - 6, size: 1.7, color: N.white });
  } else {
    p.drawCircle({ x: cx, y: cy, size: r - 0.6, color: N.soft, borderColor: N.line, borderWidth: 1.2, borderDashArray: [3, 2] });
    p.drawLine({ start: { x: cx - 5, y: cy }, end: { x: cx + 5, y: cy }, thickness: 2, color: N.muted });
  }
}

function summaryBadges(d: Doc, report: ReportV2) {
  const all = report.sections.flatMap((s) => s.items);
  const get = (k: string) => all.find((i) => i.key === k);
  const fromItems = (keys: string[]): BadgeState | null => {
    const found = keys.map(get).filter((i): i is ReportItem => Boolean(i));
    if (!found.length) return null;
    if (found.some((i) => i.state === 'ALERT')) return 'alert';
    return found.some((i) => i.state === 'CLEAR') ? 'ok' : 'na';
  };
  const resKeys = all.filter((i) => report.sections.find((s) => s.key === 'RESTRICOES')?.items.includes(i) && i.kind === 'flag' && i.key !== 'RES_BUSCA_APREENSAO' && i.key !== 'RESFURTO').map((i) => i.key);
  const debt: BadgeState | null = report.debtsHidden ? null : report.debts.hasDebt ? 'alert' : report.coverage.debtsProvided ? 'ok' : 'na';
  const badges: Array<{ label: string; state: BadgeState | null }> = [
    { label: 'Débitos', state: debt },
    { label: 'Restrições', state: fromItems(resKeys) },
    { label: 'Alienação / gravame', state: fromItems(['RESTRICAOFINAN', 'INTENCAORESTRICAOFINAN']) },
    { label: 'Busca e apreensão', state: fromItems(['RES_BUSCA_APREENSAO']) },
    { label: 'Indício de sinistro', state: fromItems(['VT_SINISTRO']) },
    { label: 'Roubo ou furto', state: fromItems(['VT_ROUBOFURTO', 'RESFURTO']) },
    { label: 'Leilão', state: fromItems(['VT_LEILAO', 'AU_LEILAO']) },
    { label: 'Recall', state: fromItems(['VT_RECALL', 'RECALL']) }
  ];
  const shown = badges.filter((b): b is { label: string; state: BadgeState } => b.state !== null && b.state !== 'na');
  if (!shown.length) return;
  const perRow = 4; const cw = CW / perRow; const rowH = 66;
  for (let i = 0; i < shown.length; i += perRow) {
    d.ensure(rowH);
    shown.slice(i, i + perRow).forEach((b, c) => {
      const cx = M + c * cw + cw / 2; const cy = d.y - 18;
      badgeIcon(d, cx, cy, b.state);
      const lab = b.label.toUpperCase(); const lw = d.dm700.widthOfTextAtSize(lab, 6.8);
      d.text(lab, cx - lw / 2, cy - 28, 6.8, d.dm700, N.ink);
      const st = b.state === 'ok' ? 'NADA CONSTA' : b.state === 'alert' ? 'CONSTA' : 'NÃO INFORMADO';
      const f = b.state === 'na' ? d.dm400 : d.dm700;
      d.text(st, cx - f.widthOfTextAtSize(clean(st), 6.6) / 2, cy - 37, 6.6, f, b.state === 'alert' ? N.danger : b.state === 'ok' ? N.okInk : N.muted);
    });
    d.y -= rowH;
  }
  d.y -= 4;
}

const VERDICT_LABEL = { CLEAR: 'SEM ALERTAS', ATTENTION: 'ATENÇÃO', HIGH_RISK: 'ATENÇÃO — RISCO ALTO', INCONCLUSIVE: 'ANÁLISE LIMITADA' } as const;
function verdictBox(d: Doc, report: ReportV2) {
  const v = report.verdict;
  const tone = v.level === 'CLEAR' ? { bg: N.okSoft, bar: N.ok, label: N.okInk }
    : v.level === 'ATTENTION' ? { bg: N.warnSoft, bar: N.warn, label: N.warnInk }
    : v.level === 'HIGH_RISK' ? { bg: N.dangerSoft, bar: N.danger, label: N.dangerInk }
    : { bg: N.soft, bar: N.muted, label: N.muted };
  const lines = d.wrap(v.reason, d.dm400, 8.5, CW - 28);
  const h = 40 + lines.length * 11;
  d.ensure(h + 10);
  const y = d.y - h;
  d.page.drawRectangle({ x: M, y, width: CW, height: h, color: tone.bg });
  d.page.drawRectangle({ x: M, y, width: 5, height: h, color: tone.bar });
  d.text(VERDICT_LABEL[v.level], M + 16, y + h - 15, 7.5, d.dm700, tone.label);
  d.text(v.title, M + 16, y + h - 29, 11.5, d.jx800, N.ink, { maxWidth: CW - 28 });
  lines.forEach((l, i) => d.text(l, M + 16, y + h - 42 - i * 11, 8.5, d.dm400, N.text));
  d.y = y - 14;
}

export function bandTitle(d: Doc, label: string, right?: string) {
  d.ensure(60);
  const h = 17; const y = d.y - h;
  d.page.drawRectangle({ x: M, y, width: CW, height: h, color: N.band });
  d.page.drawRectangle({ x: M, y, width: 3.5, height: h, color: N.blue });
  d.text(label.toUpperCase(), M + 11, y + 5.2, 8.5, d.jx800, N.blueInk, { maxWidth: CW - 130 });
  if (right) { const rw = d.dm400.widthOfTextAtSize(clean(right), 7); d.text(right, W - M - 8 - rw, y + 5.6, 7, d.dm400, N.muted); }
  d.y = y - 6;
}

const valueOf = (it: ReportItem) => String(it.display ?? it.value ?? '');
const isWide = (it: ReportItem) => { const v = valueOf(it); return Boolean(it.table) || v.includes('\n') || v.length > 64; };

/** Tabela do item (gravames, leilões): cabeçalho cinza, colunas proporcionais ao conteúdo, linhas que não quebram no meio. */
function tableBlock(d: Doc, it: ReportItem) {
  const t = it.table; if (!t) return;
  const size = 7.6; const pad = 4;
  const weight = t.columns.map((c, ci) => Math.min(34, Math.max(9, c.length, ...t.rows.map((r) => Math.max(...String(r[ci] ?? '').split('\n').map((x) => x.length), 0)))));
  const totalW = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((w) => (CW * w) / totalW);
  const cellLines = (txt: string, ci: number, font: Doc['dm400']) => String(txt ?? '').split('\n').flatMap((part) => d.wrap(part, font, size, widths[ci]! - pad * 2));
  const headLines0 = t.columns.map((c, ci) => cellLines(c, ci, d.dm700));
  d.ensure(30 + Math.max(...headLines0.map((l) => l.length)) * 9.5 + 8 + 40);
  d.text(it.label, M + 2, d.y - 10, 8, d.dm700, N.ink, { maxWidth: CW });
  d.y -= 15;
  const headLines = t.columns.map((c, ci) => cellLines(c, ci, d.dm700));
  const headH = Math.max(...headLines.map((l) => l.length)) * 9.5 + 8;
  d.ensure(headH + 30);
  const drawHead = () => {
    d.page.drawRectangle({ x: M, y: d.y - headH, width: CW, height: headH, color: N.band });
    let x = M;
    headLines.forEach((ls, ci) => { ls.forEach((l, li) => d.text(l, x + pad, d.y - 10.5 - li * 9.5, size, d.dm700, N.ink)); x += widths[ci]!; });
    d.y -= headH;
  };
  drawHead();
  for (const row of t.rows) {
    const cells = row.map((c, ci) => cellLines(c, ci, d.dm500));
    const h = Math.max(...cells.map((l) => l.length)) * 9.5 + 7;
    const before = d.y; d.ensure(h + 2); if (d.y !== before) drawHead();
    let x = M;
    cells.forEach((ls, ci) => { ls.forEach((l, li) => d.text(l, x + pad, d.y - 10 - li * 9.5, size, d.dm500, N.text)); x += widths[ci]!; });
    d.y -= h;
    d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 0.4, color: N.hair });
  }
  d.y -= 8;
}

export function itemsGrid(d: Doc, items: ReportItem[]) {
  const colGap = 18; const colW = (CW - colGap) / 2; const valW = colW - LABEL_W - 4;
  const rows: ReportItem[][] = []; let pending: ReportItem[] = [];
  const flush = () => { if (pending.length) rows.push(pending); pending = []; };
  for (const it of items) {
    if (isWide(it)) { flush(); rows.push([it]); continue; }
    pending.push(it);
    if (pending.length === 2) flush();
  }
  flush();
  for (const row of rows) {
    if (row.length === 1 && isWide(row[0]!)) {
      const it = row[0]!; const alert = it.state === 'ALERT';
      if (it.table) { tableBlock(d, it); continue; }
      const parts = valueOf(it).split('\n').flatMap((part) => d.wrap(part, alert ? d.dm700 : d.dm500, 8.5, CW - 14));
      d.ensure(Math.min(14 + parts.length * 11, 120));
      d.text(it.label, M + 2, d.y - 10, 8, d.dm700, N.ink, { maxWidth: CW });
      d.y -= 14;
      const entries = valueOf(it).split('\n');
      for (const entry of entries) {
        const lines = d.wrap(entry, alert ? d.dm700 : d.dm500, 8.5, CW - 16);
        d.ensure(lines.length * 11 + 5);
        if (alert) d.page.drawRectangle({ x: M + 3, y: d.y - 9, width: 4, height: 4, color: N.danger });
        lines.forEach((l, i) => d.text(l, M + (alert ? 12 : 6), d.y - 9 - i * 11, 8.5, alert ? d.dm700 : d.dm500, alert ? N.dangerInk : N.text));
        d.y -= lines.length * 11 + 3;
        d.page.drawLine({ start: { x: M, y: d.y }, end: { x: W - M, y: d.y }, thickness: 0.4, color: N.hair });
      }
      d.y -= 3;
      continue;
    }
    const cells = row.map((it) => ({ it, label: d.wrap(it.label, d.dm700, 8, LABEL_W - 6), value: d.wrap(valueOf(it), it.state === 'ALERT' ? d.dm700 : d.dm500, 8.5, valW - (it.state === 'ALERT' ? 8 : 0)) }));
    const rowH = Math.max(...cells.map((c) => Math.max(c.label.length * 10, c.value.length * 10.5))) + 7;
    d.ensure(rowH + 2);
    cells.forEach((c, i) => {
      const x = M + i * (colW + colGap); const top = d.y; const alert = c.it.state === 'ALERT';
      c.label.forEach((l, li) => d.text(l, x + 2, top - 9 - li * 10, 8, d.dm700, N.blueInk));
      if (alert) d.page.drawRectangle({ x: x + LABEL_W, y: top - 9.5, width: 4.2, height: 4.2, color: N.danger });
      c.value.forEach((l, li) => d.text(l, x + LABEL_W + (alert ? 8 : 0), top - 9 - li * 10.5, 8.5, alert ? d.dm700 : d.dm500, alert ? N.dangerInk : N.text));
      d.page.drawLine({ start: { x, y: top - rowH + 2 }, end: { x: x + colW, y: top - rowH + 2 }, thickness: 0.4, color: N.hair });
    });
    d.y -= rowH;
  }
  d.y -= 8;
}

/** Histórico mensal da FIPE: mini gráfico de linha + tabela compacta (4 colunas). */
export function priceSeries(d: Doc, item: ReportItem) {
  const pts = String(item.display ?? item.value ?? '').split(' · ').map((p) => { const m = /^(\S+) R\$\s*([\d.]+),(\d{2})$/.exec(p.trim()); return m ? { label: m[1]!, cents: Number(m[2]!.replace(/\./g, '')) * 100 + Number(m[3]) } : null; }).filter((p): p is { label: string; cents: number } => p !== null);
  if (pts.length < 2) return;
  const asc = [...pts].reverse();
  const chartH = 54; const rows = Math.ceil(pts.length / 4); const tableH = rows * 13;
  d.ensure(chartH + tableH + 34);
  d.text(`HISTÓRICO MENSAL DA FIPE (ÚLTIMOS ${pts.length} MESES)`, M + 2, d.y - 8, 7, d.dm700, N.blueInk);
  const top = d.y - 16; const x0 = M + 4; const w = CW - 8;
  const min = Math.min(...asc.map((p) => p.cents)); const max = Math.max(...asc.map((p) => p.cents)); const span = Math.max(1, max - min);
  d.page.drawRectangle({ x: M, y: top - chartH, width: CW, height: chartH, color: N.soft, borderColor: N.hair, borderWidth: 0.6 });
  const xy = (p: { cents: number }, i: number) => ({ x: x0 + 6 + (i / (asc.length - 1)) * (w - 12), y: top - chartH + 8 + ((p.cents - min) / span) * (chartH - 16) });
  for (let i = 1; i < asc.length; i++) d.page.drawLine({ start: xy(asc[i - 1]!, i - 1), end: xy(asc[i]!, i), thickness: 1.6, color: N.blue });
  const last = xy(asc[asc.length - 1]!, asc.length - 1); d.page.drawCircle({ x: last.x, y: last.y, size: 3.2, color: N.accent, borderColor: N.blue, borderWidth: 1.2 });
  d.y = top - chartH - 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 4; c++) {
      const p = pts[r * 4 + c]; if (!p) continue;
      const x = M + c * (CW / 4);
      d.text(p.label, x + 3, d.y - 8, 7.5, d.dm400, N.muted);
      d.text(brlFromCents(p.cents), x + 46, d.y - 8, 8, d.dm700, N.ink);
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
  bandTitle(d, 'Resumo de débitos', hasItems ? brlFromCents(report.debts.totalCents) : 'Nenhum débito informado');
  if (hasItems) {
    for (const it of report.debts.items) {
      d.ensure(18);
      d.text(it.label, M + 6, d.y - 11, 8.5, d.dm500, N.text);
      const v = brlFromCents(it.amountCents);
      d.text(v, W - M - d.dm700.widthOfTextAtSize(v, 8.5) - 6, d.y - 11, 8.5, d.dm700, N.ink);
      d.page.drawLine({ start: { x: M, y: d.y - 16 }, end: { x: W - M, y: d.y - 16 }, thickness: 0.4, color: N.hair });
      d.y -= 18;
    }
    d.ensure(26);
    d.page.drawRectangle({ x: M, y: d.y - 22, width: CW, height: 20, color: N.band });
    d.text('Total em aberto', M + 8, d.y - 15, 9, d.jx800, N.blueInk);
    const t = brlFromCents(report.debts.totalCents);
    d.text(t, W - M - d.jx800.widthOfTextAtSize(t, 10) - 8, d.y - 16, 10, d.jx800, report.debts.hasDebt ? N.danger : N.ink);
    d.y -= 30;
    if (report.debts.fineBreakdown.length) {
      const note = `Multas por órgão (${report.debts.fineBreakdown.map((f) => `${f.label.replace('Multas — ', '')}: ${brlFromCents(f.amountCents)}`).join('; ')}) detalham o total de multas e não são somadas novamente.`;
      for (const l of d.wrap(note, d.dm400, 7.5, CW - 8)) { d.ensure(12); d.text(l, M + 4, d.y - 9, 7.5, d.dm400, N.muted); d.y -= 10; }
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

const CHECK_TEXT: Record<string, string> = { OK: 'OK', ATTENTION: 'ATENÇÃO', ALERT: 'ALERTA', NOT_CHECKED: 'NÃO CONSULTADO' };

/** Parecer de revenda/seguro e checklist "Antes de pagar" (cores neutras: o estado vai escrito). */
function adviceBlock(d: Doc, report: ReportV2) {
  const a = report.advice;
  if (!a) return;
  const bullet = (text: string, size = 8) => {
    const lines = d.wrap(text, d.dm400, size, CW - 16);
    d.ensure(lines.length * 10 + 6);
    d.page.drawCircle({ x: M + 4, y: d.y - 5.5, size: 1.6, color: N.blue });
    lines.forEach((l, i) => d.text(l, M + 12, d.y - 8 - i * 10, size, d.dm400, N.text));
    d.y -= lines.length * 10 + 3;
  };
  if (a.resale) {
    bandTitle(d, 'Revenda e seguro');
    d.ensure(20);
    d.text(a.resale.title, M + 6, d.y - 11, 9.5, d.jx800, N.ink, { maxWidth: CW - 12 });
    d.y -= 18;
    for (const r of a.resale.reasons) bullet(r);
    noteLines(d, a.resale.note);
  }
  bandTitle(d, 'Antes de pagar');
  for (const c of a.checks) {
    const lines = d.wrap(c.detail, d.dm400, 7.5, CW - 16);
    d.ensure(lines.length * 9.5 + 22);
    d.text(c.label, M + 6, d.y - 11, 8.5, d.dm700, N.ink, { maxWidth: CW - 120 });
    const tag = CHECK_TEXT[c.status] ?? c.status;
    d.text(tag, W - M - 6 - d.dm700.widthOfTextAtSize(clean(tag), 7.5), d.y - 11, 7.5, d.dm700, c.status === 'OK' ? N.okInk : c.status === 'ALERT' ? N.danger : c.status === 'ATTENTION' ? N.warn : N.muted);
    lines.forEach((l, i) => d.text(l, M + 6, d.y - 22 - i * 9.5, 7.5, d.dm400, N.muted));
    d.y -= lines.length * 9.5 + 24;
    d.page.drawLine({ start: { x: M, y: d.y + 2 }, end: { x: W - M, y: d.y + 2 }, thickness: 0.4, color: N.hair });
  }
  d.y -= 4;
  d.ensure(30);
  d.text('Confira você mesmo', M + 6, d.y - 10, 8.5, d.jx800, N.ink);
  d.y -= 16;
  for (const t of a.toDo) bullet(t);
  d.y -= 6;
}

const CONSIDERATIONS = [
  'Informações de multas, débitos e restrições vêm de bases de terceiros e podem divergir dos critérios de cada Detran e Secretaria da Fazenda. Confira sempre no site do órgão antes de fechar negócio.',
  'Indício de sinistro, leilão e roubo/furto indicam possibilidade, não certeza. Confirme com vistoria física e com os órgãos competentes.',
  'Valores de multas e débitos podem ser lançados depois da consulta.',
  'Saldo devedor, valor financiado, parcelas e prazo restante de financiamento não constam das bases oficiais; peça o contrato ao vendedor e confirme a quitação com o banco.',
  'A consulta vale para o momento em que foi feita. Quem consulta responde pelo uso das informações, conforme o contrato aceito.'
];

function considerations(d: Doc) {
  d.ensure(70);
  bandTitle(d, 'Considerações importantes');
  for (const c of CONSIDERATIONS) {
    const lines = d.wrap(c, d.dm400, 8, CW - 16);
    d.ensure(lines.length * 10 + 6);
    d.page.drawCircle({ x: M + 4, y: d.y - 5.5, size: 1.6, color: N.blue });
    lines.forEach((l, i) => d.text(l, M + 12, d.y - 8 - i * 10, 8, d.dm400, N.text));
    d.y -= lines.length * 10 + 4;
  }
  d.y -= 6;
}

function noteLines(d: Doc, text: string) {
  const lines = d.wrap(text, d.dm400, 7.5, CW - 6);
  d.ensure(lines.length * 10 + 10);
  for (const l of lines) { d.text(l, M + 3, d.y - 8, 7.5, d.dm400, N.muted); d.y -= 10; }
  d.y -= 6;
}

export async function renderVehiclePdf(fullReport: ReportV2, meta: ReportMeta): Promise<Buffer> {
  const report = forClientDocument(fullReport);
  const d = await Doc.create();
  d.pdf.setTitle(`Relatório de consulta veicular - ${report.plate}`);
  d.pdf.setAuthor(meta.brandName ?? 'Placa na Mão');
  d.pdf.setSubject(`${meta.productName} - código ${meta.verificationCode}`);
  d.pdf.setCreationDate(meta.consultedAt);
  d.firstTop = H - HB; d.nextTop = H - HB;
  d.addPage();
  summaryBadges(d, report);
  verdictBox(d, report);
  debtsBlock(d, report);

  for (const s of report.sections) {
    const shown = s.items.filter((i) => i.state !== 'NOT_PROVIDED' && !(s.key === 'DEBITOS' && i.kind === 'money' && i.state === 'CLEAR'));
    if (!shown.length) continue;
    const series = shown.find((i) => i.key === 'EN_FIPE_SERIE');
    const grid = shown.filter((i) => i !== series);
    bandTitle(d, s.label, `${shown.length} informações`);
    if (grid.length) itemsGrid(d, grid);
    if (series) priceSeries(d, series);
  }
  for (const block of sheetBlocks(report.sheet)) {
    bandTitle(d, block.title, `${block.items.length} informações`);
    itemsGrid(d, block.items);
  }
  adviceBlock(d, report);
  if (!meta.sample) considerations(d);

  // validação + avisos
  d.ensure(120);
  d.y -= 4;
  const boxH = 92; const by = d.y - boxH;
  d.page.drawRectangle({ x: M, y: by, width: CW, height: boxH, color: N.soft, borderColor: N.line, borderWidth: 0.8 });
  d.page.drawRectangle({ x: M, y: by, width: 4, height: boxH, color: N.blue });
  await qr(d, meta.verificationUrl, M + 14, by + 14, 64);
  const tx = M + 104;
  d.text('Validação do relatório', tx, by + boxH - 18, 10.5, d.jx800, N.ink);
  d.text(`Código de verificação: ${meta.verificationCode}`, tx, by + boxH - 32, 8.5, d.dm500, N.text);
  const hash = (meta.resultHash ?? createHash('sha256').update(JSON.stringify(report)).digest('hex')).slice(0, 32);
  d.text(`Impressão digital: ${hash}`, tx, by + boxH - 43, 7, d.dm400, N.muted);
  const vurl = meta.verificationUrl.replace(/^https?:\/\//, '');
  d.text(`Confira a autenticidade em ${vurl}`, tx, by + boxH - 54, 7.5, d.dm400, N.muted, { maxWidth: CW - 120 });
  const notice = meta.sample ? 'Este é um modelo ilustrativo, com dados fictícios, para mostrar quais informações você recebe nesta consulta. Não tem validade e não se refere a nenhum veículo real.' : 'Informações fornecidas por fonte de dados contratada, conforme retornado na data e hora da consulta; não substituem documentos oficiais nem certidões. ' + (ownerIdentityEnabled() ? 'Os dados de proprietários constam como retornados pela fonte e o uso é de responsabilidade de quem consulta (LGPD).' : 'Dados pessoais de proprietários pessoa física (nome e CPF) não são exibidos, em conformidade com a LGPD.');
  d.wrap(notice, d.dm400, 6.8, CW - 120).forEach((l, i) => d.text(l, tx, by + boxH - 66 - i * 8.2, 6.8, d.dm400, N.muted));
  d.y = by - 10;

  // cabeçalho e rodapé em todas as páginas
  const total = d.pages.length;
  d.pages.forEach((p, i) => {
    pageHeader(d, p, i, total, meta, report);
    if (meta.sample) p.drawText(clean('MODELO · DADOS FICTÍCIOS'), { x: 110, y: 250, size: 44, font: d.jx800, color: rgb(0.86, 0.86, 0.86), rotate: degrees(40), opacity: 0.55 });
    docFooter(d, p, i, total, `${meta.brandName ?? 'Placa na Mão'}  ·  ${meta.productName}  ·  ${report.plate}`, 'Informações de bases públicas e privadas, conforme retornado na data e hora da consulta; não substituem documentos oficiais. Confirme multas e débitos no órgão de trânsito.');
  });
  return Buffer.from(await d.pdf.save());
}
