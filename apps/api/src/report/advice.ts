import { brlFromCents } from './format.js';
import { CATALOG_BY_KEY } from './catalog.js';
import type { ReportV2 } from './normalizeV2.js';

/**
 * Parecer de revenda/seguro e checklist "Antes de pagar".
 * Calculado só com o que o pacote contratado entrega: o que não foi consultado aparece como "não consultado", nunca como "ok".
 * São indicativos para apoiar a decisão, não garantia.
 */
export type CheckStatus = 'OK' | 'ATTENTION' | 'ALERT' | 'NOT_CHECKED';
export interface AdviceCheck { key: string; label: string; status: CheckStatus; detail: string }
export interface ResaleAdvice { level: 'LOW' | 'MODERATE' | 'HIGH'; title: string; reasons: string[]; note: string }
export interface ReportAdvice {
  /** risco de recusa na revenda e no seguro; ausente quando o pacote não traz leilão nem sinistro */
  resale?: ResaleAdvice;
  /** o que a consulta verificou, item a item */
  checks: AdviceCheck[];
  /** o que só a pessoa consegue conferir pessoalmente */
  toDo: string[];
}

type Item = ReportV2['sections'][number]['items'][number];
type Verdict = 'ALERT' | 'CLEAR' | 'UNKNOWN';

const TO_DO = [
  'Confirme que quem vende é o proprietário que consta no documento (CRLV-e), com documento com foto.',
  'Pague somente na conta do proprietário e nunca antecipe sinal a terceiros ou "intermediários".',
  'Confira no carro a placa, o chassi, o número do motor e a gravação nos vidros.',
  'Compare o preço com a tabela FIPE: valor muito abaixo do mercado é sinal clássico de golpe.',
  'Faça vistoria cautelar e test drive antes de fechar o negócio.',
  'Feche a transferência no mesmo dia do pagamento e guarde todos os comprovantes.'
];

export function buildAdvice(report: ReportV2): ReportAdvice {
  const items = new Map<string, Item>();
  for (const s of report.sections) for (const i of s.items) if (i.state !== 'NOT_PROVIDED') items.set(i.key, i);
  const verdictOf = (...keys: string[]): Verdict => {
    let seen = false;
    for (const k of keys) {
      const i = items.get(k);
      if (!i) continue;
      if (i.state === 'ALERT') return 'ALERT';
      if (i.state === 'CLEAR') seen = true;
    }
    return seen ? 'CLEAR' : 'UNKNOWN';
  };
  const inScope = (key: string) => report.sections.some((s) => s.key === key);

  const K = {
    auction: ['VT_LEILAO', 'AU_LEILAO'], claim: ['VT_SINISTRO'], theft: ['VT_ROUBOFURTO', 'RESFURTO'], lien: ['RESTRICAOFINAN', 'INTENCAORESTRICAOFINAN'],
    judicial: ['RESJUDICIAL', 'RESRENAJUD', 'RES_BUSCA_APREENSAO', 'RJ_DETALHES'],
    administrative: ['RESADMINISTRATIVA', 'RESTRIBUTARIA', 'RESTRICAORFB', 'VN_RESTRICAO_1', 'VN_RESTRICAO_2', 'VN_RESTRICAO_3', 'VN_RESTRICAO_4'],
    chassis: ['TIPOREMARCACAOCHASSI', 'VN_SITUACAO_CHASSI'], recall: ['VT_RECALL', 'RECALL']
  } as const;
  const auction = verdictOf(...K.auction);
  const claim = verdictOf(...K.claim);
  const theft = verdictOf(...K.theft);
  const lien = verdictOf(...K.lien);
  const judicial = verdictOf(...K.judicial);
  const administrative = verdictOf(...K.administrative);
  const chassis = verdictOf(...K.chassis);
  const recall = verdictOf(...K.recall);
  /** A verificação só é listada quando o pacote tem a seção onde ela mora; o que está fora do pacote não é nomeado aqui. */
  const covered = (keys: readonly string[]) => keys.some((k) => { const sec = CATALOG_BY_KEY.get(k)?.section; return !!sec && inScope(sec); });
  const debtsChecked = !report.debtsHidden && inScope('DEBITOS');

  const checks: AdviceCheck[] = [];
  const add = (key: string, label: string, keys: readonly string[], v: Verdict, alert: { status: CheckStatus; detail: string }, ok: string) => {
    if (!covered(keys)) return;
    if (v === 'UNKNOWN') checks.push({ key, label, status: 'NOT_CHECKED', detail: 'Não consultado neste pacote ou a fonte não retornou. Isso não significa que está tudo certo.' });
    else if (v === 'ALERT') checks.push({ key, label, ...alert });
    else checks.push({ key, label, status: 'OK', detail: ok });
  };

  if (debtsChecked) {
    if (report.debts.hasDebt) checks.push({ key: 'debts', label: 'Débitos (IPVA, licenciamento, multas)', status: 'ATTENTION', detail: `Há débitos de ${brlFromCents(report.debts.totalCents)}. Combine por escrito quem paga antes da transferência.` });
    else checks.push({ key: 'debts', label: 'Débitos (IPVA, licenciamento, multas)', status: 'OK', detail: 'Nenhum débito informado pela fonte na data da consulta.' });
  } else if (inScope('DEBITOS')) checks.push({ key: 'debts', label: 'Débitos (IPVA, licenciamento, multas)', status: 'NOT_CHECKED', detail: 'A fonte não retornou os débitos nesta consulta. Isso não significa que está tudo certo.' });

  add('judicial', 'Restrição judicial, RENAJUD e busca e apreensão', K.judicial, judicial, { status: 'ALERT', detail: 'Consta restrição que pode impedir a transferência. Não pague antes de confirmar a baixa no órgão responsável.' }, 'Nada consta na data da consulta.');
  add('lien', 'Financiamento e alienação (gravame)', K.lien, lien, { status: 'ATTENTION', detail: 'O carro está alienado a uma financeira. Só compre com a quitação e a baixa do gravame comprovadas, ou pagando direto ao banco.' }, 'Sem gravame ativo na data da consulta.');
  add('administrative', 'Restrições administrativas e outras', K.administrative, administrative, { status: 'ATTENTION', detail: 'Consta restrição administrativa ou de outra base. Confira o motivo no Detran antes de pagar.' }, 'Nada consta na data da consulta.');
  add('theft', 'Roubo ou furto', K.theft, theft, { status: 'ALERT', detail: 'Há registro de roubo ou furto. Confirme no órgão se foi recuperado e regularizado.' }, 'Sem registro na data da consulta.');
  add('auction', 'Passagem por leilão', K.auction, auction, { status: 'ATTENTION', detail: 'O veículo passou por leilão. Pode ter desvalorização e recusa de seguradoras; peça vistoria cautelar.' }, 'Sem registro de leilão nas bases consultadas.');
  add('claim', 'Indício de sinistro', K.claim, claim, { status: 'ATTENTION', detail: 'Há indício de sinistro. É indício, não certeza: confirme com vistoria física.' }, 'Sem indício de sinistro nas bases consultadas.');
  add('chassis', 'Situação e remarcação do chassi', K.chassis, chassis, { status: 'ALERT', detail: 'Há irregularidade ou remarcação no chassi. Confira fisicamente antes de qualquer pagamento.' }, 'Chassi normal na data da consulta.');
  add('recall', 'Recall pendente', K.recall, recall, { status: 'ATTENTION', detail: 'Há recall registrado. O reparo na concessionária é gratuito; confirme se já foi feito.' }, 'Sem recall pendente informado.');

  const resale = buildResale({ auction, claim, theft, lien, judicial, chassis, recall, administrative, debts: debtsChecked && report.debts.hasDebt, evaluated: auction !== 'UNKNOWN' || claim !== 'UNKNOWN' });
  return { ...(resale ? { resale } : {}), checks, toDo: TO_DO };
}

function buildResale(f: { auction: Verdict; claim: Verdict; theft: Verdict; lien: Verdict; judicial: Verdict; chassis: Verdict; recall: Verdict; administrative: Verdict; debts: boolean; evaluated: boolean }): ResaleAdvice | undefined {
  if (!f.evaluated) return undefined;
  const reasons: string[] = [];
  let score = 0;
  const hit = (v: Verdict, weight: number, text: string) => { if (v === 'ALERT') { score += weight; reasons.push(text); } };
  hit(f.auction, 3, 'Passagem por leilão: seguradoras e compradores costumam recusar ou pedir desconto.');
  hit(f.claim, 2, 'Indício de sinistro: pode haver dano estrutural e dificuldade de seguro.');
  hit(f.theft, 3, 'Registro de roubo ou furto.');
  hit(f.judicial, 3, 'Restrição judicial ou busca e apreensão: impede a transferência até a baixa.');
  hit(f.chassis, 3, 'Irregularidade no chassi.');
  hit(f.lien, 1, 'Alienação ativa: precisa ser quitada e baixada para transferir.');
  hit(f.administrative, 1, 'Restrição administrativa ou de outra base.');
  hit(f.recall, 1, 'Recall registrado.');
  if (f.debts) { score += 1; reasons.push('Há débitos em aberto.'); }
  const note = 'Indicativo calculado só com as informações desta consulta. Cada seguradora e comprador tem critério próprio; não é garantia de aceitação nem de preço.';
  if (score >= 3) return { level: 'HIGH', title: 'Alto risco de recusa na revenda e no seguro', reasons, note };
  if (score >= 1) return { level: 'MODERATE', title: 'Risco moderado de recusa na revenda e no seguro', reasons, note };
  return { level: 'LOW', title: 'Baixo risco de recusa na revenda e no seguro', reasons: ['Nenhuma ocorrência relevante nas informações consultadas.'], note };
}
