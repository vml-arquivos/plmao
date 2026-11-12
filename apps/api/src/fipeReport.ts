import crypto from 'node:crypto';
import type { FipeProviderResult, FipeQuote, FipeVehicleDetails } from './types.js';
import type { VehicleSheet } from './enrichment/sheet.js';
import { Doc, H, HB, M, CW, N, bandTitle, clean, docFooter, docHeader, itemsGrid, priceSeries, qr } from './report/pdf.js';
import { sheetBlocks } from './report/sheetItems.js';
import type { ReportItem } from './report/normalizeV2.js';

const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const display = (value?: string) => value?.trim() || 'Não informado';

export function makeFipeQuote(result: FipeProviderResult, plate?: string, vehicleDetails?: FipeVehicleDetails): FipeQuote {
  const now = new Date().toISOString();
  const base = {
    provider: result.provider,
    source: result.source,
    consultedAt: now,
    referenceMonth: result.referenceMonth,
    referenceCode: result.referenceCode,
    vehicleType: result.vehicleType,
    brand: result.brand,
    model: result.model,
    year: result.year,
    fuel: result.fuel,
    modelYear: result.modelYear,
    fipeCode: result.fipeCode,
    valueCents: result.valueCents,
    valueLabel: result.valueLabel,
    plate: plate || undefined,
    vehicleDetails: vehicleDetails || undefined
  };
  const reportHash = crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex');
  const documentCode = `CPF-${crypto.randomBytes(9).toString('base64url').toUpperCase()}`;
  return {
    ...base,
    documentCode,
    reportHash,
    estimatedNegotiation: {
      minCents: Math.round(result.valueCents * 0.9),
      maxCents: Math.round(result.valueCents * 1.1),
      disclaimer: 'Estimativa informativa calculada a partir do valor FIPE. O preço real varia conforme conservação, região, quilometragem, acessórios e histórico.'
    },
    blocks: [
      { key: 'FIPE', label: 'Valor FIPE', state: 'FOUND', message: 'Valor médio e referência mensal disponíveis.' },
      { key: 'IDENTITY', label: 'Identificação do veículo', state: vehicleDetails ? 'FOUND' : 'NOT_QUERIED', message: vehicleDetails ? 'Dados de identificação encontrados para a placa informada.' : 'Identificação por placa não utilizada nesta modalidade.' },
      { key: 'RESTRICTIONS', label: 'Restrições e gravame', state: 'NOT_QUERIED', message: 'Não incluídos na Consulta zero.' },
      { key: 'DEBTS', label: 'Débitos', state: 'NOT_QUERIED', message: 'Não incluídos na Consulta zero.' },
      { key: 'RECALL', label: 'Recall', state: 'NOT_QUERIED', message: 'Não incluído na Consulta zero.' },
      { key: 'HISTORY', label: 'Leilão e sinistro', state: 'NOT_QUERIED', message: 'Não incluídos na Consulta zero.' }
    ]
  };
}

export function reportSnapshot(quote: FipeQuote): Record<string, unknown> {
  return { schema: 'placanamao.fipe.report.v2', version: 2, report: quote };
}

function vehicleLines(details?: FipeVehicleDetails): string[] {
  if (!details) return [];
  const entries: Array<[string, string | undefined]> = [
    ['Placa', details.plate],
    ['Chassi', details.chassis],
    ['Motor (número)', details.engine],
    ['Marca', details.brand],
    ['Modelo identificado', details.fullModel || details.model],
    ['Ano de fabricação', details.manufactureYear],
    ['Ano do modelo', details.modelYear],
    ['Cor', details.color],
    ['Combustível', details.fuel],
    ['Potência', details.power],
    ['Cilindrada', details.displacement],
    ['Tipo', details.type],
    ['Espécie', details.species],
    ['Categoria', details.category],
    ['Carroceria', details.body],
    ['Passageiros', details.passengers],
    ['Capacidade de carga', details.loadCapacity],
    ['Procedência', details.origin],
    ['Município', details.city],
    ['UF', details.state],
    ['Ano do licenciamento', details.licensingYear],
    ['Situação informada', details.status]
  ];
  return entries.filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}: ${value}`);
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pctText = (n: number | null | undefined) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`);

/** Linhas de texto da ficha (PDF). */
export function sheetLines(sheet?: VehicleSheet): string[] {
  if (!sheet) return [];
  const out: string[] = [];
  if (sheet.decoder.length) out.push('', 'DECODIFICADOR DO CHASSI E DO MODELO', ...sheet.decoder.map((r) => `${r.label}: ${r.value}`));
  if (sheet.fipe?.annual.length) out.push('', `TABELA FIPE POR ANO (${sheet.fipe.code})`, `Atual: ${brl(sheet.fipe.currentCents)}`, ...sheet.fipe.annual.map((a) => `${a.year}  ${brl(a.cents)}  variacao sobre o ano anterior: ${pctText(a.pct)}`));
  if (sheet.fipe?.monthly.length) out.push('', 'HISTORICO DOS ULTIMOS 24 MESES', 'Mes / Valor / % mes anterior / % no periodo', ...sheet.fipe.monthly.map((m) => `${m.label}  ${brl(m.cents)}  ${pctText(m.pctMonth)}  ${pctText(m.pctPeriod)}`));
  if (sheet.financing) out.push('', 'FINANCIE (SIMULACAO ESTIMADA)', `Entrada de ${brl(sheet.financing.downPaymentCents)} + ${sheet.financing.months} parcelas de ${brl(sheet.financing.installmentCents)}`, 'Estimativa com taxa media de mercado; a proposta real depende da analise do banco.');
  if (sheet.specs) out.push('', `FICHA TECNICA - ${sheet.specs.title}`, ...sheet.specs.rows.map((r) => `${r.label}: ${r.value}`));
  return out;
}

/** Blocos HTML da ficha (versão para impressão). */
export function sheetHtml(sheet?: VehicleSheet): string {
  if (!sheet) return '';
  const rows = (items: Array<{ label: string; value: string }>) => `<div class="details">${items.map((r) => `<div><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`).join('')}</div>`;
  const parts: string[] = [];
  if (sheet.decoder.length) parts.push(`<h2>Decodificador do chassi e do modelo</h2>${rows(sheet.decoder)}`);
  if (sheet.fipe?.annual.length) parts.push(`<h2>Tabela FIPE por ano</h2><p class="muted">Código FIPE ${escapeHtml(sheet.fipe.code)} · Atual ${escapeHtml(brl(sheet.fipe.currentCents))}</p><table><thead><tr><th>Ano</th><th>Valor</th><th>Variação sobre o ano anterior</th></tr></thead><tbody>${sheet.fipe.annual.map((a) => `<tr><td>${a.year}</td><td>${escapeHtml(brl(a.cents))}</td><td>${escapeHtml(pctText(a.pct))}</td></tr>`).join('')}</tbody></table>`);
  if (sheet.fipe?.monthly.length) parts.push(`<h2>Histórico dos últimos 24 meses</h2><table><thead><tr><th>Mês</th><th>Valor</th><th>% mês anterior</th><th>% no período</th></tr></thead><tbody>${sheet.fipe.monthly.map((m) => `<tr><td>${escapeHtml(m.label)}</td><td>${escapeHtml(brl(m.cents))}</td><td>${escapeHtml(pctText(m.pctMonth))}</td><td>${escapeHtml(pctText(m.pctPeriod))}</td></tr>`).join('')}</tbody></table>`);
  if (sheet.financing) parts.push(`<h2>Financie</h2><div class="notice">Entrada de ${escapeHtml(brl(sheet.financing.downPaymentCents))} + ${sheet.financing.months} parcelas de <strong>${escapeHtml(brl(sheet.financing.installmentCents))}</strong>. Simulação estimada com taxa média de mercado; a proposta real depende da análise do banco.</div>`);
  if (sheet.specs) parts.push(`<h2>Ficha técnica · ${escapeHtml(sheet.specs.title)}</h2>${rows(sheet.specs.rows)}`);
  return parts.join('');
}

export type ReportBranding = { name?: string; primaryColor?: string; accentColor?: string; logoUrl?: string; siteUrl?: string };

function brandingColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

function brandingLogo(branding: ReportBranding): string {
  return branding.logoUrl && /^https?:\/\//i.test(branding.logoUrl) ? branding.logoUrl : '';
}

const info = (key: string, label: string, value: string): ReportItem => ({ key, label, kind: 'text', state: 'INFO', value, display: value, sensitivity: 'PUBLIC', tier: 1 });

/** PDF da Consulta Zero no mesmo padrão visual do relatório de consulta: cabeçalho, faixas, grade de dados, validação e rodapé. */
export async function fipePdf(quote: FipeQuote, branding: ReportBranding = {}): Promise<Buffer> {
  const brand = branding.name || 'Placa na Mão';
  const site = (branding.siteUrl || 'https://placanamao.com.br').replace(/\/$/, '');
  const url = `${site}/validar-relatorio/${quote.documentCode}`;
  const when = new Date(quote.consultedAt);
  const d = await Doc.create();
  d.pdf.setTitle(`Consulta Zero - valor FIPE - ${quote.documentCode}`);
  d.pdf.setAuthor(brand);
  d.pdf.setSubject('Relatório gratuito de valor de referência FIPE');
  d.pdf.setCreationDate(when);
  d.firstTop = H - HB; d.nextTop = H - HB;
  d.addPage();

  // destaque: valor FIPE vigente e faixa informativa (mesma caixa do parecer do relatório)
  const est = quote.estimatedNegotiation;
  const hint = d.wrap('O preço real varia conforme conservação, região, quilometragem, acessórios e histórico. Esta faixa não é um preço oficial.', d.dm400, 8, CW - 32);
  const bh = 74 + (est ? 22 + hint.length * 10 : 0);
  const by = d.y - bh;
  d.page.drawRectangle({ x: M, y: by, width: CW, height: bh, color: N.band });
  d.page.drawRectangle({ x: M, y: by, width: 5, height: bh, color: N.blue });
  d.text('VALOR FIPE VIGENTE', M + 16, by + bh - 16, 7.5, d.dm700, N.blueInk);
  d.text(quote.valueLabel, M + 16, by + bh - 44, 26, d.jx800, N.ink, { maxWidth: CW - 32 });
  d.text(`Tabela FIPE · referência ${quote.referenceMonth} · código ${quote.fipeCode}`, M + 16, by + bh - 62, 8.5, d.dm500, N.text, { maxWidth: CW - 32 });
  if (est) {
    d.text('ESTIMATIVA INFORMATIVA DE NEGOCIAÇÃO', M + 16, by + bh - 82, 7.5, d.dm700, N.blueInk);
    d.text(`${formatCents(est.minCents)} a ${formatCents(est.maxCents)}`, M + 16, by + bh - 99, 13, d.jx800, N.ink);
    hint.forEach((l, i) => d.text(l, M + 16, by + bh - 113 - i * 10, 8, d.dm400, N.text));
  }
  d.y = by - 14;

  const ident = vehicleLines(quote.vehicleDetails).map((line) => { const k = line.indexOf(':'); return k > 0 ? { label: line.slice(0, k), value: line.slice(k + 1).trim() } : { label: 'Informação', value: line }; });
  ident.push({ label: 'Veículo FIPE', value: `${quote.brand.name} / ${quote.model.name}` });
  ident.push({ label: 'Ano FIPE', value: `${quote.year.name}${quote.fuel ? ` - ${quote.fuel}` : ''}` });
  bandTitle(d, 'Identificação do veículo', `${ident.length} informações`);
  itemsGrid(d, ident.map((r, i) => info(`FP_ID_${i}`, r.label, r.value)));

  const fipeRows = [
    info('FP_COD', 'Código FIPE', quote.fipeCode),
    info('FP_VAL', 'Valor FIPE vigente', quote.valueLabel),
    info('FP_REF', 'Referência', quote.referenceMonth),
    info('FP_DT', 'Consultado em', when.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
  ];
  bandTitle(d, 'Dados FIPE', `${fipeRows.length} informações`);
  itemsGrid(d, fipeRows);

  for (const block of sheetBlocks(quote.sheet)) {
    const chart = block.title === 'Tabela FIPE' && Boolean(quote.sheet?.fipe?.monthly.length);
    // o histórico mensal sai como gráfico com os valores (mesmo desenho do relatório pago), sem repetir a tabela
    const items = chart ? block.items.filter((i) => i.key !== 'SH_FIPE_MENSAL') : block.items;
    bandTitle(d, block.title, `${items.length} informações`);
    itemsGrid(d, items);
    if (chart && quote.sheet?.fipe) {
      const series = quote.sheet.fipe.monthly.map((m) => `${m.label.replace(/\s+/g, '')} ${brl(m.cents)}`).join(' · ');
      priceSeries(d, info('FP_SERIE', 'Série', series));
    }
  }

  bandTitle(d, 'Considerações importantes');
  for (const c of ['Esta consulta informa o valor de referência da Tabela FIPE e a ficha do veículo. Não verifica gravame, restrições, débitos, roubo ou furto, leilão ou sinistro.', 'Os valores são de referência e não substituem a avaliação do veículo nem documentos oficiais.']) {
    const lines = d.wrap(c, d.dm400, 8, CW - 16);
    d.ensure(lines.length * 10 + 6);
    d.page.drawCircle({ x: M + 4, y: d.y - 5.5, size: 1.6, color: N.blue });
    lines.forEach((l, i) => d.text(l, M + 12, d.y - 8 - i * 10, 8, d.dm400, N.text));
    d.y -= lines.length * 10 + 4;
  }
  d.y -= 10;

  // validação
  d.ensure(110);
  const vh = 82; const vy = d.y - vh;
  d.page.drawRectangle({ x: M, y: vy, width: CW, height: vh, color: N.soft, borderColor: N.line, borderWidth: 0.8 });
  d.page.drawRectangle({ x: M, y: vy, width: 4, height: vh, color: N.blue });
  await qr(d, url, M + 14, vy + 13, 56);
  const tx = M + 96;
  d.text('Validação do relatório', tx, vy + vh - 18, 10.5, d.jx800, N.ink);
  d.text(`Código do documento: ${quote.documentCode}`, tx, vy + vh - 32, 8.5, d.dm500, N.text);
  d.text(`Impressão digital: ${quote.reportHash.slice(0, 32)}`, tx, vy + vh - 43, 7, d.dm400, N.muted);
  d.text(`Confira a autenticidade em ${url.replace(/^https?:\/\//, '')}`, tx, vy + vh - 55, 7.5, d.dm400, N.muted, { maxWidth: CW - 110 });
  d.y = vy - 10;

  const total = d.pages.length;
  const plateOrCode = quote.plate || quote.documentCode;
  const name = quote.vehicleDetails?.fullModel || [quote.brand.name, quote.model.name].filter(Boolean).join(' ');
  const sub = [quote.year.name, quote.fuel, `Ref. ${quote.referenceMonth}`].filter(Boolean).join(' · ');
  d.pages.forEach((p, i) => {
    docHeader(d, p, i, total, { brand, title: 'Consulta Zero', tag: 'Valor de referência FIPE', when, code: quote.documentCode, url, vehicle: { name, ...(quote.plate ? { plate: quote.plate } : {}), sub } });
    docFooter(d, p, i, total, `${brand}  ·  Consulta Zero  ·  ${plateOrCode}`, 'Valores de referência da Tabela FIPE na data da consulta; não substituem a avaliação do veículo nem documentos oficiais.');
  });
  return Buffer.from(await d.pdf.save());
}

export function fipePrintHtml(quote: FipeQuote, branding: ReportBranding = {}): string {
  const primaryColor = brandingColor(branding.primaryColor, '#1F5FE0');
  const accentColor = brandingColor(branding.accentColor, '#5CAEF0');
  const logoUrl = brandingLogo(branding);
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" style="max-height:42px;max-width:220px;object-fit:contain;margin-bottom:8px">` : '';
  const blocks = quote.blocks.map((block) => `<li><strong>${escapeHtml(block.label)}</strong>: ${escapeHtml(block.message)}</li>`).join('');
  const details = vehicleLines(quote.vehicleDetails).map((line) => {
    const separator = line.indexOf(':');
    return `<div><span>${escapeHtml(separator > 0 ? line.slice(0, separator) : 'Informação')}</span><strong>${escapeHtml(separator > 0 ? line.slice(separator + 1).trim() : line)}</strong></div>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Consulta zero ${escapeHtml(quote.documentCode)}</title><style>
  @page{size:A4;margin:18mm}body{font-family:"DM Sans",Arial,sans-serif;color:#0B1633;line-height:1.45;max-width:760px;margin:0 auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}header{background:#040B1B;color:#fff;border-bottom:3px solid ${escapeHtml(accentColor)};padding:18px 22px;margin-bottom:22px;border-radius:10px 10px 0 0}header .muted{color:#9DB4DD}h1{font-family:"Plus Jakarta Sans",Arial,sans-serif;font-size:22px;margin:0;color:#fff}h2{font-family:"Plus Jakarta Sans",Arial,sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.02em;margin-top:24px;padding:7px 10px;background:#E7EFFE;border-left:4px solid ${escapeHtml(primaryColor)};color:#1648B0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.card{border:1px solid #E0E7F3;border-radius:8px;padding:12px}.details{display:grid;grid-template-columns:1fr 1fr;gap:8px}.details div{border:1px solid #E0E7F3;border-radius:6px;padding:8px}.details span{display:block;color:#576687;font-size:11px}.details strong{display:block;margin-top:3px;font-size:13px}.muted{color:#576687;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #E0E7F3;padding:5px 6px;text-align:left}th{color:#1648B0;background:#E7EFFE;font-weight:700}ul{padding-left:18px}.notice{background:#E7EFFE;border-left:4px solid ${escapeHtml(accentColor)};padding:12px}.print{margin:20px 0;padding:10px 16px;border:0;background:${escapeHtml(primaryColor)};color:white;border-radius:6px}@media print{.print{display:none}.card,.details div{break-inside:avoid}}@media(max-width:560px){.details{grid-template-columns:1fr}}
  </style></head><body><header>${logo}<h1>${escapeHtml(branding.name || 'Placa na Mão')} — Consulta zero</h1><div class="muted">Documento ${escapeHtml(quote.documentCode)} · Validação ${escapeHtml(quote.reportHash)}</div></header><h2>Identificação do veículo</h2><div class="details">${details || '<div><span>Identificação</span><strong>Não informada</strong></div>'}</div><h2>Dados FIPE</h2><div class="grid"><div class="card"><strong>Veículo FIPE</strong><br>${escapeHtml(quote.brand.name)} / ${escapeHtml(quote.model.name)}<br>Ano: ${escapeHtml(quote.year.name)}<br>Combustível: ${escapeHtml(quote.fuel || 'Não informado')}</div><div class="card"><strong>Valor FIPE vigente</strong><br><span style="font-size:24px">${escapeHtml(quote.valueLabel)}</span><br>Referência: ${escapeHtml(quote.referenceMonth)}<br>Código: ${escapeHtml(quote.fipeCode)}</div></div><p class="muted">Consulta realizada em ${escapeHtml(new Date(quote.consultedAt).toLocaleString('pt-BR'))}</p><h2>Estimativa informativa</h2><p>${escapeHtml(formatCents(quote.estimatedNegotiation?.minCents ?? 0))} a ${escapeHtml(formatCents(quote.estimatedNegotiation?.maxCents ?? 0))}. ${escapeHtml(quote.estimatedNegotiation?.disclaimer)}</p>${sheetHtml(quote.sheet)}<h2>O que a Consulta zero não verifica</h2><div class="notice">A FIPE informa o valor médio, mas não verifica gravame, restrições, débitos, roubo/furto, leilão ou sinistro. Para uma análise documental completa, avance para a consulta completa.</div><h2>Resumo da cobertura</h2><ul>${blocks}</ul><p class="muted">Validação pública: /validar-relatorio/${escapeHtml(quote.documentCode)}</p><button class="print" onclick="window.print()">Imprimir</button></body></html>`;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
