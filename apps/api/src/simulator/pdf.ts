import { PDFString, rgb, type RGB } from 'pdf-lib';
import { C, CW, Doc, H, M, W, clean, drawLogo, fit, rect } from '../report/pdf.js';
import { brlFromCents } from '../report/format.js';
import type { FinancingResult } from '../lib/financing.js';
import { VEHICLE_KINDS, type RateInfo, type SimulationOutput } from './service.js';

export interface SimulationPdfMeta {
  code: string;
  generatedAt: Date;
  customerName?: string | null;
  customerEmail?: string | null;
  brandName?: string;
  siteUrl?: string;
  referenceMonth: string;
  rateSource: string;
}

const pct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`;
const dateBr = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const monthRef = (ym: string) => { const [y, m] = ym.split('-'); return m && y ? `${m}/${y}` : ym; };
const kindLabel = (k: string) => VEHICLE_KINDS.find((v) => v.key === k)?.label ?? k;
const MODALITY_NAME = { CDC: 'Financiamento CDC', LEASING: 'Leasing (arrendamento mercantil)' } as const;

function sectionTitle(d: Doc, label: string, sub?: string) {
  d.ensure(40);
  const y = d.y - 14;
  d.text(label, M, y, 12.5, d.jx800, C.ink);
  if (sub) d.text(sub, W - M - d.dm400.widthOfTextAtSize(clean(sub), 8), y + 1, 8, d.dm400, C.muted);
  d.page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.8, color: C.line });
  d.y = y - 20;
}

function tiles(d: Doc, items: Array<{ label: string; value: string; sub?: string; color?: RGB }>) {
  const gap = 8; const w = (CW - gap * (items.length - 1)) / items.length; const h = 58;
  d.ensure(h + 12);
  items.forEach((t, i) => {
    const x = M + i * (w + gap); const y = d.y - h;
    rect(d.page, { x, y, width: w, height: h, color: i === 0 ? C.soft : C.white, borderColor: i === 0 ? C.violet : C.line, borderWidth: i === 0 ? 1.2 : 1, borderRadius: 9 });
    d.text(t.label.toUpperCase(), x + 11, y + h - 15, 6.5, d.dm700, C.muted, { maxWidth: w - 20 });
    d.text(t.value, x + 11, y + h - 35, i === 0 ? 16 : 13, d.jx800, t.color ?? C.ink, { maxWidth: w - 20 });
    if (t.sub) d.text(t.sub, x + 11, y + 10, 7.5, d.dm400, C.muted, { maxWidth: w - 20 });
  });
  d.y -= h + 16;
}

function keyValues(d: Doc, rows: Array<{ label: string; value: string; strong?: boolean; color?: RGB; note?: string }>) {
  for (const r of rows) {
    const noteLines = r.note ? d.wrap(r.note, d.dm400, 7.5, CW - 16) : [];
    const h = 16.5 + noteLines.length * 9;
    d.ensure(h);
    const top = d.y;
    d.text(r.label, M + 4, top - 11.5, 9.5, r.strong ? d.dm700 : d.dm500, r.strong ? C.ink : C.text);
    const v = clean(r.value);
    const font = r.strong ? d.jx800 : d.jx700;
    d.text(v, W - M - 4 - font.widthOfTextAtSize(v, r.strong ? 10.5 : 9.5), top - 11.5, r.strong ? 10.5 : 9.5, font, r.color ?? C.ink);
    noteLines.forEach((l, i) => d.text(l, M + 4, top - 21 - i * 9, 7.5, d.dm400, C.muted));
    d.page.drawLine({ start: { x: M, y: top - h + 3 }, end: { x: W - M, y: top - h + 3 }, thickness: 0.4, color: C.line });
    d.y -= h;
  }
  d.y -= 8;
}

function costBar(d: Doc, r: FinancingResult) {
  const interestOnly = Math.max(0, r.totalPaidCents - r.vehicleValueCents - r.iofCents - r.feesTotalCents);
  const segs = [
    { label: 'Veículo', cents: r.vehicleValueCents, color: C.blue },
    { label: 'Juros', cents: interestOnly, color: C.violet },
    { label: 'IOF', cents: r.iofCents, color: C.amber },
    { label: 'Tarifas e seguros', cents: r.feesTotalCents, color: C.green }
  ].filter((s) => s.cents > 0);
  const total = segs.reduce((s, x) => s + x.cents, 0) || 1;
  d.ensure(58);
  let x = M; const y = d.y - 16; const barH = 14;
  segs.forEach((s, i) => {
    const w = Math.max(2, (CW * s.cents) / total);
    rect(d.page, { x, y, width: w, height: barH, color: s.color, borderRadius: i === 0 || i === segs.length - 1 ? 4 : 0 });
    x += w;
  });
  let lx = M; const ly = y - 16;
  segs.forEach((s) => {
    d.page.drawCircle({ x: lx + 3, y: ly + 3, size: 3, color: s.color });
    const t = `${s.label}  ${brlFromCents(s.cents)}  (${((s.cents / total) * 100).toFixed(1).replace('.', ',')}%)`;
    d.text(t, lx + 10, ly, 7.5, d.dm500, C.text);
    lx += 10 + d.dm500.widthOfTextAtSize(clean(t), 7.5) + 14;
  });
  d.y = ly - 16;
}

function scheduleTable(d: Doc, r: FinancingResult, title: string) {
  const cols = [
    { h: 'Nº', w: 34, align: 'left' as const },
    { h: 'Vencimento', w: 82, align: 'left' as const },
    { h: 'Parcela', w: 92, align: 'right' as const },
    { h: 'Juros', w: 92, align: 'right' as const },
    { h: 'Amortização', w: 108, align: 'right' as const },
    { h: 'Saldo devedor', w: CW - (34 + 82 + 92 + 92 + 108), align: 'right' as const }
  ];
  const rowH = 15;
  const drawHeader = () => {
    d.ensure(rowH * 3);
    const y = d.y - rowH;
    rect(d.page, { x: M, y, width: CW, height: rowH, color: C.ink, borderRadius: 4 });
    let x = M;
    cols.forEach((c) => {
      const tw = d.dm700.widthOfTextAtSize(clean(c.h), 7.5);
      d.text(c.h, c.align === 'left' ? x + 7 : x + c.w - 7 - tw, y + 4.5, 7.5, d.dm700, C.white);
      x += c.w;
    });
    d.y -= rowH + 2;
  };
  sectionTitle(d, title, `${r.months} parcelas`);
  drawHeader();
  r.schedule.forEach((row, idx) => {
    if (d.y - rowH < 56) { d.addPage(); d.y = H - M; drawHeader(); }
    const y = d.y - rowH;
    if (idx % 2 === 0) rect(d.page, { x: M, y, width: CW, height: rowH, color: C.soft });
    const cells = [String(row.n), dateBr(row.dueDate), brlFromCents(row.installmentCents), brlFromCents(row.interestCents), brlFromCents(row.principalCents), brlFromCents(row.balanceCents)];
    let x = M;
    cols.forEach((c, i) => {
      const f = i === 2 ? d.dm700 : d.dm500;
      const tw = f.widthOfTextAtSize(clean(cells[i]!), 8);
      d.text(cells[i]!, c.align === 'left' ? x + 7 : x + c.w - 7 - tw, y + 4.5, 8, f, i === 2 ? C.ink : C.text);
      x += c.w;
    });
    d.y -= rowH;
  });
  if (r.residualCents > 0) {
    d.ensure(34);
    rect(d.page, { x: M, y: d.y - 28, width: CW, height: 28, color: C.amberBg, borderRadius: 6 });
    d.text(`Valor residual garantido (VRG): ${brlFromCents(r.residualCents)}, pago ao final somente se você exercer a opção de compra.`, M + 10, d.y - 18, 8.5, d.dm500, C.text, { maxWidth: CW - 20 });
    d.y -= 38;
  } else d.y -= 8;
}

function rateText(r: FinancingResult, info: RateInfo | undefined, meta: SimulationPdfMeta): string {
  const base = `${pct(r.monthlyRatePct)} a.m. (${pct(r.annualRatePct)} a.a.)`;
  return info?.custom ? `${base}  ·  taxa informada por você` : `${base}  ·  média de mercado (BCB ${monthRef(meta.referenceMonth)})`;
}

type Row = { label: string; value: string; strong?: boolean; color?: RGB; note?: string };

/** Link clicável (anotação URI) sobre um retângulo da página atual. */
function link(d: Doc, x: number, y: number, w: number, h: number, url: string) {
  const ctx = d.pdf.context;
  const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y, x + w, y + h], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }));
  d.page.node.addAnnot(ref);
}

function commonRows(first: FinancingResult): Row[] {
  const grace = first.firstInstallmentDays > 30;
  return [
    { label: 'Valor do veículo', value: brlFromCents(first.vehicleValueCents) },
    { label: `Entrada (${pct(first.downPaymentPct)})`, value: brlFromCents(first.downPaymentCents) },
    { label: 'Valor liberado (veículo - entrada)', value: brlFromCents(first.loanNetCents) },
    { label: 'Prazo', value: `${first.months} meses` },
    { label: 'Primeira parcela', value: `em ${first.firstInstallmentDays} dias`, note: grace ? `Carência de ${first.firstInstallmentDays - 30} dias além do padrão: os juros desse período são somados ao saldo devedor e aumentam a parcela.` : undefined }
  ];
}

function modalityBlock(d: Doc, out: SimulationOutput, r: FinancingResult, meta: SimulationPdfMeta, many: boolean) {
  const info = r.modality === 'CDC' ? out.rates.cdc : out.rates.leasing;
  d.ensure(330);
  sectionTitle(d, many ? MODALITY_NAME[r.modality] : 'Resultado da simulação', many ? undefined : MODALITY_NAME[r.modality]);
  tiles(d, [
    { label: 'Parcela mensal', value: brlFromCents(r.installmentCents), sub: r.residualCents ? `${r.months} parcelas + residual ${brlFromCents(r.residualCents)} (opcional)` : `${r.months} parcelas fixas` },
    { label: 'Total pago ao final', value: brlFromCents(r.totalPaidCents), sub: r.residualCents ? 'entrada + parcelas + residual' : 'entrada + parcelas' },
    { label: 'CET', value: `${pct(r.cetAnnualPct)} a.a.`, sub: `${pct(r.cetMonthlyPct)} ao mês` }
  ]);

  const rows: Row[] = many ? [] : commonRows(r);
  rows.push({ label: 'Taxa de juros', value: rateText(r, info, meta), note: info?.note ?? undefined });
  if (r.residualCents) rows.push({ label: `Valor residual garantido (${pct(r.residualCents / r.vehicleValueCents * 100)} do veículo)`, value: brlFromCents(r.residualCents), note: 'Pago no fim do contrato somente se você optar por ficar com o veículo.' });
  keyValues(d, rows);

  sectionTitle(d, 'O que você paga além do veículo');
  keyValues(d, [
    { label: 'Juros do financiamento', value: brlFromCents(Math.max(0, r.totalPaidCents - r.vehicleValueCents - r.iofCents - r.feesTotalCents)) },
    { label: 'IOF (calculado por parcela, financiado)', value: brlFromCents(r.iofCents) },
    ...r.fees.map((f) => ({ label: `${f.label} (${f.financed ? 'financiada' : 'paga à vista'})`, value: brlFromCents(f.cents) })),
    { label: 'Custo total do crédito', value: brlFromCents(r.totalCostCents), strong: true, color: C.red, note: `Equivale a ${pct(r.costOverVehiclePct)} do valor do veículo.` },
    { label: 'Valor total financiado (inclui IOF e tarifas financiadas)', value: brlFromCents(r.principalCents) }
  ]);
  costBar(d, r);
}

function infoBox(d: Doc, title: string, pairs: Array<[string, string]>) {
  const h = 24 + Math.ceil(pairs.length / 2) * 26;
  d.ensure(h + 8);
  const y = d.y - h;
  rect(d.page, { x: M, y, width: CW, height: h, color: C.soft, borderRadius: 9 });
  d.text(title.toUpperCase(), M + 14, y + h - 16, 7, d.dm700, C.violet);
  const colW = (CW - 28) / 2;
  pairs.forEach(([k, v], i) => {
    const cx = M + 14 + (i % 2) * colW; const cy = y + h - 34 - Math.floor(i / 2) * 26;
    d.text(k.toUpperCase(), cx, cy + 6, 6.2, d.dm700, C.muted, { maxWidth: colW - 8 });
    d.text(v || '-', cx, cy - 7, 9.5, d.jx700, C.ink, { maxWidth: colW - 12 });
  });
  d.y = y - 10;
}

export async function renderSimulationPdf(out: SimulationOutput, meta: SimulationPdfMeta): Promise<Buffer> {
  const d = await Doc.create();
  const brand = meta.brandName ?? 'Placa na Mão';
  const site = (meta.siteUrl ?? 'https://placanamao.com.br').replace(/\/$/, '');
  const siteLabel = site.replace(/^https?:\/\//, '');
  d.pdf.setTitle(`Simulação de financiamento ${meta.code}`);
  d.pdf.setAuthor(brand);
  d.pdf.setSubject('Simulação de financiamento de veículo');
  d.pdf.setKeywords(['simulação', 'financiamento', 'CDC', 'leasing', 'CET', meta.code]);
  d.pdf.setCreationDate(meta.generatedAt);
  d.addPage();

  // cabeçalho
  rect(d.page, { x: 0, y: H - 104, width: W, height: 104, color: C.ink });
  rect(d.page, { x: 0, y: H - 104, width: W, height: 3, color: C.violet });
  drawLogo(d, M, H - 70, 34, true);
  d.text(brand, M + 44, H - 57, 17, d.jx800, C.white);
  d.text(siteLabel, M + 44, H - 71, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  link(d, M, H - 74, 190, 40, site);
  const rt = 'Simulação de financiamento';
  d.text(rt, W - M - d.jx700.widthOfTextAtSize(rt, 11), H - 54, 11, d.jx700, C.white);
  const code = `Código ${meta.code}`;
  d.text(code, W - M - d.dm500.widthOfTextAtSize(code, 8.5), H - 69, 8.5, d.dm500, C.lilac);
  const when = meta.generatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  d.text(when, W - M - d.dm400.widthOfTextAtSize(when, 8), H - 82, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  d.y = H - 104 - 28;

  const body = out.body;
  const first = out.results.cdc ?? out.results.leasing!;
  const title = body.vehicleLabel || `${kindLabel(body.vehicleKind)} ${body.condition === 'NEW' ? 'novo' : 'usado'}`;
  d.text(title, M, d.y - 6, 18, d.jx800, C.ink, { maxWidth: CW });
  d.text(`Simulação de ${brlFromCents(first.vehicleValueCents)} em ${first.months} meses`, M, d.y - 24, 10, d.dm500, C.muted, { maxWidth: CW });
  d.y -= 38;

  infoBox(d, 'Dados da simulação', [
    ['Cliente', meta.customerName ?? 'Simulação informativa'],
    ['E-mail', meta.customerEmail ?? '-'],
    ['Veículo', `${kindLabel(body.vehicleKind)} ${body.condition === 'NEW' ? 'novo' : 'usado'}`],
    ['Perfil', body.personType === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'],
    ['Modalidade', out.results.cdc && out.results.leasing ? 'CDC e leasing (comparativo)' : MODALITY_NAME[first.modality]],
    ['Data da simulação', when]
  ]);
  if (body.notes) {
    const lines = d.wrap(body.notes, d.dm400, 8.5, CW - 8);
    d.ensure(lines.length * 11 + 22);
    d.text('OBSERVAÇÕES', M + 4, d.y - 8, 7, d.dm700, C.muted);
    lines.forEach((l, i) => d.text(l, M + 4, d.y - 21 - i * 11, 8.5, d.dm400, C.text));
    d.y -= lines.length * 11 + 26;
  }

  const many = Boolean(out.results.cdc && out.results.leasing);
  if (many) {
    const a = out.results.cdc!; const b = out.results.leasing!;
    sectionTitle(d, 'CDC x Leasing lado a lado');
    const rowsCmp: Array<[string, string, string, boolean?]> = [
      ['Taxa de juros', `${pct(a.monthlyRatePct)} a.m.`, `${pct(b.monthlyRatePct)} a.m.`],
      ['Parcela mensal', brlFromCents(a.installmentCents), brlFromCents(b.installmentCents), true],
      ['Valor residual no final (opcional)', '—', b.residualCents ? brlFromCents(b.residualCents) : '—'],
      ['IOF', brlFromCents(a.iofCents), brlFromCents(b.iofCents)],
      ['Tarifas e seguros', brlFromCents(a.feesTotalCents), brlFromCents(b.feesTotalCents)],
      ['Total pago ao final', brlFromCents(a.totalPaidCents), brlFromCents(b.totalPaidCents), true],
      ['Custo total do crédito', brlFromCents(a.totalCostCents), brlFromCents(b.totalCostCents)],
      ['CET', `${pct(a.cetAnnualPct)} a.a.`, `${pct(b.cetAnnualPct)} a.a.`, true]
    ];
    const c1 = CW * 0.4; const c2 = CW * 0.3;
    d.ensure(26);
    rect(d.page, { x: M, y: d.y - 18, width: CW, height: 18, color: C.ink, borderRadius: 4 });
    d.text('CDC', M + c1 + c2 - 8 - d.dm700.widthOfTextAtSize('CDC', 8.5), d.y - 13, 8.5, d.dm700, C.white);
    d.text('Leasing', M + CW - 8 - d.dm700.widthOfTextAtSize('Leasing', 8.5), d.y - 13, 8.5, d.dm700, C.white);
    d.y -= 20;
    const minTotal = Math.min(a.totalPaidCents, b.totalPaidCents);
    rowsCmp.forEach(([label, va, vb, strong], i) => {
      d.ensure(18);
      const y = d.y - 18;
      if (i % 2 === 0) rect(d.page, { x: M, y, width: CW, height: 18, color: C.soft });
      d.text(label, M + 8, y + 5.5, 9, strong ? d.dm700 : d.dm500, C.text);
      const win = label === 'Total pago ao final';
      const fa = strong ? d.jx800 : d.jx600; const sa = clean(va); const sb = clean(vb);
      d.text(sa, M + c1 + c2 - 8 - fa.widthOfTextAtSize(sa, 9), y + 5.5, 9, fa, win && a.totalPaidCents === minTotal ? C.green : C.ink);
      d.text(sb, M + CW - 8 - fa.widthOfTextAtSize(sb, 9), y + 5.5, 9, fa, win && b.totalPaidCents === minTotal ? C.green : C.ink);
      d.y -= 18;
    });
    const diff = Math.abs(a.totalPaidCents - b.totalPaidCents);
    const cheaper = a.totalPaidCents <= b.totalPaidCents ? 'CDC' : 'Leasing';
    const diffInstallment = Math.abs(a.installmentCents - b.installmentCents);
    d.y -= 6;
    const cmpText = diff === 0 ? 'Os dois cenários custam o mesmo no total.' : `Neste cenário, o ${cheaper} sai ${brlFromCents(diff)} mais barato no total (considerando que você fique com o veículo; no leasing, pagando o valor residual). A parcela mensal difere em ${brlFromCents(diffInstallment)}. Condições reais variam por instituição.`;
    for (const l of d.wrap(cmpText, d.dm500, 8.5, CW - 8)) { d.text(l, M + 4, d.y - 9, 8.5, d.dm500, C.text); d.y -= 11; }
    d.y -= 14;
    sectionTitle(d, 'Dados em comum');
    keyValues(d, commonRows(first));
  }

  for (const r of [out.results.cdc, out.results.leasing]) if (r) {
    if (many) { d.addPage(); d.y = H - M; }
    modalityBlock(d, out, r, meta, many);
  }

  for (const r of [out.results.cdc, out.results.leasing]) if (r) { d.addPage(); d.y = H - M; scheduleTable(d, r, `Cronograma de parcelas${many ? ` - ${MODALITY_NAME[r.modality]}` : ''}`); }

  // premissas e avisos
  d.ensure(240);
  sectionTitle(d, 'Como calculamos e o que você precisa saber');
  const notesList = [
    `Taxa: média de mercado do Banco Central do Brasil (${meta.rateSource.replace(/^Banco Central do Brasil \(/, '').replace(/\)$/, '')}), referência ${monthRef(meta.referenceMonth)}, ou a taxa que você informou. A taxa que você receberá depende de análise de crédito, entrada, prazo, idade do veículo e instituição.`,
    'Parcelas fixas (tabela Price). IOF calculado sobre cada parcela do principal, com limite de 365 dias, mais a alíquota adicional, e financiado junto com o valor. Valores de tarifas e seguros são referências editáveis, não ofertas.',
    'CET (Custo Efetivo Total): taxa que iguala o dinheiro liberado a tudo que você paga (parcelas, tarifas à vista e valor residual). Compare propostas pelo CET e peça sempre o contrato com o CET discriminado.',
    'Leasing: o veículo fica em nome da arrendadora até o fim do contrato; no fim você decide se paga o valor residual para ficar com ele. Para pessoa física é uma modalidade pouco ofertada atualmente.',
    'Esta simulação é informativa. Não é proposta, oferta de crédito, promessa de aprovação nem aconselhamento financeiro. A Placa na Mão não é instituição financeira e não concede crédito.'
  ];
  for (const n of notesList) {
    const lines = d.wrap(n, d.dm400, 8, CW - 14);
    d.ensure(lines.length * 10.5 + 8);
    d.page.drawCircle({ x: M + 3, y: d.y - 6, size: 1.6, color: C.violet });
    lines.forEach((l, i) => d.text(l, M + 12, d.y - 8.5 - i * 10.5, 8, d.dm400, C.text));
    d.y -= lines.length * 10.5 + 5;
  }
  d.y -= 8;

  // próximos passos (links clicáveis)
  d.ensure(96);
  const bh = 84; const by = d.y - bh;
  rect(d.page, { x: M, y: by, width: CW, height: bh, color: C.soft, borderRadius: 10 });
  d.text('Antes de assinar o contrato', M + 14, by + bh - 20, 11, d.jx800, C.ink);
  d.text('Confira o CET, as tarifas e o seguro e veja a situação do veículo (débitos, restrições, leilão).', M + 14, by + bh - 34, 8, d.dm400, C.muted, { maxWidth: CW - 28 });
  const buttons: Array<[string, string]> = [['Consultar a placa', `${site}/consultar`], ['Guia e comparador de veículos', `${site}/veiculos`], ['Refazer a simulação', `${site}/simulador`]];
  let bx = M + 14;
  for (const [label, url] of buttons) {
    const w = d.dm700.widthOfTextAtSize(clean(label), 8) + 24;
    rect(d.page, { x: bx, y: by + 12, width: w, height: 22, color: C.violet, borderRadius: 11 });
    d.text(label, bx + 12, by + 19.5, 8, d.dm700, C.white);
    link(d, bx, by + 12, w, 22, url);
    bx += w + 8;
  }
  d.y = by - 12;

  const total = d.pages.length;
  d.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.6, color: C.line });
    p.drawText(clean(`${brand}  ·  Simulação ${meta.code}  ·  ${siteLabel}`), { x: M, y: 22, size: 7.5, font: d.dm400, color: C.muted });
    const right = `Página ${i + 1} de ${total}`;
    p.drawText(right, { x: W - M - d.dm500.widthOfTextAtSize(right, 7.5), y: 22, size: 7.5, font: d.dm500, color: C.muted });
  });
  return Buffer.from(await d.pdf.save());
}
