import type { VehicleSheet } from '../enrichment/sheet.js';
import type { ReportItem } from './normalizeV2.js';
import { brlFromCents } from './format.js';

const pct = (n: number | null | undefined) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(2).replace('.', ',')}%`);
const item = (key: string, label: string, value: string, table?: { columns: string[]; rows: string[][] }): ReportItem => ({ key, label, kind: 'text', state: 'INFO', value, display: value, ...(table ? { table } : {}), sensitivity: 'PUBLIC', tier: 1 });

/** A ficha gratuita como blocos de itens (mesmo formato das seções do relatório), usada no PDF. */
export function sheetBlocks(sheet?: VehicleSheet): Array<{ title: string; items: ReportItem[] }> {
  if (!sheet) return [];
  const out: Array<{ title: string; items: ReportItem[] }> = [];
  if (sheet.decoder.length) out.push({ title: 'Decodificador do chassi e do modelo', items: sheet.decoder.map((r, i) => item(`SH_DEC_${i}`, r.label, r.value)) });
  if (sheet.fipe) {
    const items: ReportItem[] = [item('SH_FIPE_ATUAL', `Valor atual (código ${sheet.fipe.code})`, brlFromCents(sheet.fipe.currentCents))];
    if (sheet.fipe.annual.length) items.push(item('SH_FIPE_ANUAL', 'Por ano', 'tabela', { columns: ['Ano', 'Valor', 'Variação sobre o ano anterior'], rows: sheet.fipe.annual.map((a) => [String(a.year), brlFromCents(a.cents), pct(a.pct)]) }));
    if (sheet.fipe.monthly.length) items.push(item('SH_FIPE_MENSAL', 'Últimos 24 meses', 'tabela', { columns: ['Mês', 'Valor', '% mês anterior', '% no período'], rows: sheet.fipe.monthly.map((m) => [m.label, brlFromCents(m.cents), pct(m.pctMonth), pct(m.pctPeriod)]) }));
    out.push({ title: 'Tabela FIPE', items });
  }
  if (sheet.financing) out.push({ title: 'Financie', items: [item('SH_FIN', 'Simulação estimada', `Entrada de ${brlFromCents(sheet.financing.downPaymentCents)} + ${sheet.financing.months} parcelas de ${brlFromCents(sheet.financing.installmentCents)}. Taxa média de mercado; a proposta real depende da análise do banco.`)] });
  if (sheet.specs) out.push({ title: `Ficha técnica · ${sheet.specs.title}`, items: sheet.specs.rows.map((r, i) => item(`SH_SPEC_${i}`, r.label, r.value)) });
  return out;
}
