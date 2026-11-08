/**
 * Análises da Placa na Mão sobre leilão: nível de risco de leilão, possível desvalorização, CSV do Inmetro e aceitação em seguro.
 * Calculadas só a partir do que a consulta trouxe (registros de leilão e indício de sinistro). Sem leilão consultado, nada é calculado.
 * Não usam percentuais nem notas de terceiros: o nível é uma classificação própria, descrita no próprio relatório.
 */
import type { VtValue } from './vehicleTotal.js';

type Seen = { state: string; table?: { columns: string[]; rows: string[][] } } | undefined;

const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const SEVERE = /SUCATA|SINISTR|RECUPERAD|MONTA|BAIXA|INCENDI|ENCHENTE|ALAGAD|COLISAO|BATID|IRRECUPER|AVARIA GRAVE|DANO/;

export type LeilaoLevel = 'Muito baixo' | 'Baixo' | 'Razoável' | 'Alto';

/** Nível pelo que a consulta trouxe: sem leilão e sem sinistro = muito baixo; leilão simples = razoável; leilão com dano, vários registros ou sinistro = alto. */
export function leilaoLevel(auction: Seen, claim: Seen): { level: LeilaoLevel; reason: string } | null {
  if (!auction || auction.state === 'NOT_PROVIDED') return null;
  const claimed = claim?.state === 'ALERT';
  const noClaim = claim?.state === 'CLEAR' ? ' nem indício de sinistro' : '';
  if (auction.state !== 'ALERT') return claimed ? { level: 'Baixo', reason: 'sem registro de leilão, mas com indício de sinistro' } : { level: 'Muito baixo', reason: `sem registro de leilão${noClaim}` };
  const rows = auction.table?.rows ?? [];
  const count = rows.length || 1;
  const severe = SEVERE.test(fold(rows.map((r) => r.join(' ')).join(' ')));
  if (severe || count >= 2 || claimed) {
    const why = [severe ? 'condição com dano informada' : '', count >= 2 ? `${count} registros de leilão` : '', claimed ? 'indício de sinistro' : ''].filter(Boolean);
    return { level: 'Alto', reason: why.join(', ') };
  }
  return { level: 'Razoável', reason: `1 registro de leilão${claim?.state === 'CLEAR' ? ', sem indício de sinistro' : ''}` };
}

export function leilaoAnalyses(auction: Seen, claim: Seen): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const r = leilaoLevel(auction, claim);
  if (!r) return out;
  const passed = auction?.state === 'ALERT';
  const high = r.level === 'Alto' || r.level === 'Razoável';
  const text = `${r.level} — ${r.reason}. Classificação da Placa na Mão (Muito baixo, Baixo, Razoável ou Alto), calculada com os registros de leilão e o indício de sinistro desta consulta; não é nota de órgão oficial.`;
  out.set('AN_SCORE_LEILAO', { state: r.level === 'Muito baixo' ? 'CLEAR' : 'INFO', value: text, display: text });
  if (passed || claim?.state === 'ALERT') {
    const t = 'Veículos com passagem por leilão ou indício de sinistro costumam ser negociados abaixo da tabela FIPE, que não considera esse histórico. O tamanho do desconto depende do tipo de dano, do reparo e da região. Use o histórico para negociar o preço e confirme o estado com vistoria cautelar. Esta análise não calcula percentual.';
    out.set('AN_DESVALORIZACAO', { state: 'INFO', value: t, display: t });
  }
  if (passed) {
    const t = 'Se o veículo foi recuperado de dano de média ou grande monta, só pode voltar a circular com o Certificado de Segurança Veicular (CSV), emitido após inspeção em empresa acreditada pelo Inmetro. Peça o certificado ao vendedor e confira no documento. Esta consulta não informa se o CSV foi emitido.';
    out.set('AN_CSV_INMETRO', { state: 'INFO', value: t, display: t });
  }
  const seguro = high
    ? 'Pode haver recusa ou prêmio mais alto: seguradoras costumam restringir veículos com passagem por leilão ou sinistro. Consulte a seguradora antes de fechar o negócio.'
    : 'Sem impedimento aparente nesta consulta. A aceitação e o preço do seguro são definidos por cada seguradora.';
  out.set('AN_SEGURO', { state: high ? 'INFO' : 'CLEAR', value: seguro, display: seguro });
  return out;
}
