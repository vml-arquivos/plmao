import type { ReportV2 } from './normalizeV2.js';

/**
 * Relatório que sai para o cliente (PDF e impressão): só consulta e análise.
 * Nada sobre plano, pacote, o que "não está incluído", fonte que não respondeu ou custo de serviço: isso é assunto interno
 * e nunca vai ao cliente. O relatório de tela e a API continuam com os dados completos; aqui só se escolhe o que mostrar.
 */
const NOT_INFORMED = /^\s*n[ãa]o informado/i;

export function forClientDocument(report: ReportV2): ReportV2 {
  const sections = report.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !NOT_INFORMED.test(String(i.display ?? i.value ?? ''))) }));

  let { title, reason } = report.verdict;
  if (/fora deste plano/i.test(title)) {
    title = 'Há pontos de atenção neste veículo';
    reason = 'Foram identificados pontos de atenção nas bases consultadas. Confirme com vistoria e com os órgãos competentes antes de fechar negócio.';
  }
  reason = reason
    .replace(/\s*Há ainda \d+ ponto\(s\) de atenção fora deste plano\./i, '')
    .replace(/^O provedor não retornou débitos nem restrições para esta consulta;/, 'Não foi possível confirmar débitos e restrições nesta consulta;')
    .replace(/^Restrições não foram retornadas pelo provedor nesta consulta;/, 'Parte das restrições não pôde ser confirmada nesta consulta;')
    .replace(/nos dados retornados pelo provedor nesta consulta/i, 'nas bases consultadas nesta consulta')
    .replace(/pelo provedor/gi, 'nas bases consultadas');

  const advice = report.advice ? { ...report.advice, checks: report.advice.checks.filter((c) => c.status !== 'NOT_CHECKED') } : report.advice;
  const { scope: _scope, ...rest } = report;
  void _scope;
  return { ...rest, sections, verdict: { ...report.verdict, title, reason }, lockedAlertCount: 0, advice };
}
