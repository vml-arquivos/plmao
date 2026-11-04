import crypto from 'node:crypto';
import type { FipeProviderResult, FipeQuote, FipeVehicleDetails } from './types.js';
import type { VehicleSheet } from './enrichment/sheet.js';

/** Mantém o Latin-1 (WinAnsi) para acentos em português; símbolos fora dele viram equivalentes simples. */
const stripAccents = (value: string) => value.normalize('NFC').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
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

function pdfObject(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
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

export type ReportBranding = { name?: string; primaryColor?: string; accentColor?: string; logoUrl?: string };

function brandingColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : fallback;
}

function brandingLogo(branding: ReportBranding): string {
  return branding.logoUrl && /^https?:\/\//i.test(branding.logoUrl) ? branding.logoUrl : '';
}

export function fipePdf(quote: FipeQuote, branding: ReportBranding = {}): Buffer {
  const lines = [
    stripAccents(branding.name || 'Placa na Mão') + ' — CONSULTA ZERO',
    'Relatorio gratuito de valor medio FIPE',
    `Documento: ${quote.documentCode}`,
    `Validacao: ${quote.reportHash.slice(0, 24)}`,
    '',
    'IDENTIFICACAO DO VEICULO',
    ...vehicleLines(quote.vehicleDetails),
    `Veiculo FIPE: ${quote.brand.name} / ${quote.model.name}`,
    `Ano FIPE: ${quote.year.name}${quote.fuel ? ` — ${quote.fuel}` : ''}`,
    '',
    'DADOS FIPE',
    `Codigo FIPE: ${quote.fipeCode}`,
    `Valor FIPE vigente: ${quote.valueLabel}`,
    `Referencia: ${quote.referenceMonth}`,
    `Consultado em: ${new Date(quote.consultedAt).toLocaleString('pt-BR')}`,
    '',
    'ESTIMATIVA INFORMATIVA',
    `${formatCents(quote.estimatedNegotiation?.minCents ?? 0)} a ${formatCents(quote.estimatedNegotiation?.maxCents ?? 0)}`,
    'O preco real varia conforme conservacao, regiao, quilometragem,',
    'acessorios e historico. Esta faixa nao e um preco oficial.',
    ...sheetLines(quote.sheet),
    '',
    'O QUE A CONSULTA ZERO NAO VERIFICA',
    'Gravame, restricoes, debitos, roubo/furto, leilao ou sinistro.',
    'Para uma analise documental completa, avance para a consulta completa.',
    '',
    'Validade publica: /validar-relatorio/' + quote.documentCode
  ];
  // Páginas de 44 linhas: a ficha completa passa de uma página.
  const PER_PAGE = 44;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PER_PAGE) pages.push(lines.slice(i, i + PER_PAGE));
  const contents = pages.map((pageLines) => ['BT', '/F1 10 Tf', '50 800 Td', ...pageLines.map((line) => `(${pdfObject(stripAccents(line).slice(0, 110))}) Tj 0 -17 Td`), 'ET'].join('\n'));
  const pageIds = pages.map((_, i) => 5 + i * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  ];
  contents.forEach((content, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
  });
  objects[2] = '<< >>';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function fipePrintHtml(quote: FipeQuote, branding: ReportBranding = {}): string {
  const primaryColor = brandingColor(branding.primaryColor, '#168579');
  const accentColor = brandingColor(branding.accentColor, '#C99A3D');
  const logoUrl = brandingLogo(branding);
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" style="max-height:42px;max-width:220px;object-fit:contain;margin-bottom:8px">` : '';
  const blocks = quote.blocks.map((block) => `<li><strong>${escapeHtml(block.label)}</strong>: ${escapeHtml(block.message)}</li>`).join('');
  const details = vehicleLines(quote.vehicleDetails).map((line) => {
    const separator = line.indexOf(':');
    return `<div><span>${escapeHtml(separator > 0 ? line.slice(0, separator) : 'Informação')}</span><strong>${escapeHtml(separator > 0 ? line.slice(separator + 1).trim() : line)}</strong></div>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Consulta zero ${escapeHtml(quote.documentCode)}</title><style>
  @page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#1f2937;line-height:1.45;max-width:760px;margin:0 auto}header{border-bottom:3px solid ${escapeHtml(primaryColor)};padding-bottom:12px;margin-bottom:22px}h1{font-size:22px;margin:0;color:${escapeHtml(primaryColor)}}h2{font-size:15px;margin-top:24px;color:${escapeHtml(primaryColor)}}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.card{border:1px solid #d1d5db;border-radius:8px;padding:12px}.details{display:grid;grid-template-columns:1fr 1fr;gap:8px}.details div{border:1px solid #e5e7eb;border-radius:6px;padding:8px}.details span{display:block;color:#6b7280;font-size:11px}.details strong{display:block;margin-top:3px;font-size:13px}.muted{color:#6b7280;font-size:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e5e7eb;padding:5px 6px;text-align:left}th{color:#6b7280;font-weight:600}ul{padding-left:18px}.notice{background:#f0fdfa;border-left:4px solid ${escapeHtml(accentColor)};padding:12px}.print{margin:20px 0;padding:10px 16px;border:0;background:${escapeHtml(primaryColor)};color:white;border-radius:6px}@media print{.print{display:none}.card,.details div{break-inside:avoid}}@media(max-width:560px){.details{grid-template-columns:1fr}}
  </style></head><body><header>${logo}<h1>${escapeHtml(branding.name || 'Placa na Mão')} — Consulta zero</h1><div class="muted">Documento ${escapeHtml(quote.documentCode)} · Validação ${escapeHtml(quote.reportHash)}</div></header><h2>Identificação do veículo</h2><div class="details">${details || '<div><span>Identificação</span><strong>Não informada</strong></div>'}</div><h2>Dados FIPE</h2><div class="grid"><div class="card"><strong>Veículo FIPE</strong><br>${escapeHtml(quote.brand.name)} / ${escapeHtml(quote.model.name)}<br>Ano: ${escapeHtml(quote.year.name)}<br>Combustível: ${escapeHtml(quote.fuel || 'Não informado')}</div><div class="card"><strong>Valor FIPE vigente</strong><br><span style="font-size:24px">${escapeHtml(quote.valueLabel)}</span><br>Referência: ${escapeHtml(quote.referenceMonth)}<br>Código: ${escapeHtml(quote.fipeCode)}</div></div><p class="muted">Consulta realizada em ${escapeHtml(new Date(quote.consultedAt).toLocaleString('pt-BR'))}</p><h2>Estimativa informativa</h2><p>${escapeHtml(formatCents(quote.estimatedNegotiation?.minCents ?? 0))} a ${escapeHtml(formatCents(quote.estimatedNegotiation?.maxCents ?? 0))}. ${escapeHtml(quote.estimatedNegotiation?.disclaimer)}</p>${sheetHtml(quote.sheet)}<h2>O que a Consulta zero não verifica</h2><div class="notice">A FIPE informa o valor médio, mas não verifica gravame, restrições, débitos, roubo/furto, leilão ou sinistro. Para uma análise documental completa, avance para a consulta completa.</div><h2>Resumo da cobertura</h2><ul>${blocks}</ul><p class="muted">Validação pública: /validar-relatorio/${escapeHtml(quote.documentCode)}</p><button class="print" onclick="window.print()">Imprimir</button></body></html>`;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
