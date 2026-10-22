import { pool } from '../db.js';

/**
 * Bot de triagem. NÃO gera texto livre: só devolve (a) respostas das perguntas frequentes publicadas no painel,
 * (b) mensagens fixas de triagem e (c) encaminhamento a uma pessoa. Não consulta dados da conta, não executa
 * reembolso, não altera cobrança e não opina sobre prazos ou valores que não estejam nas respostas publicadas.
 */
export const HUMAN_HINT = 'Se preferir, você pode falar com uma pessoa a qualquer momento.';

export type BotReply = { kind: 'FAQ' | 'TRIAGE' | 'HANDOFF'; text: string; escalate: boolean; priority?: 'NORMAL' | 'ALTA' | 'URGENTE'; faqId?: string };

const STOP = new Set(['a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'um', 'uma', 'para', 'por', 'com', 'que', 'se', 'eu', 'meu', 'minha', 'como', 'qual', 'quais', 'posso', 'pode', 'quero', 'preciso', 'no', 'na', 'nos', 'nas', 'ao', 'é', 'foi', 'ser', 'tem', 'ter', 'sobre', 'isso', 'esta', 'este']);
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/** Assuntos que o bot nunca resolve: vão direto para uma pessoa. */
const SENSITIVE: Array<{ re: RegExp; priority: 'NORMAL' | 'ALTA' | 'URGENTE'; why: string }> = [
  { re: /(reembols|estorn|devolu[cç]|chargeback|cobran[cç]a indevida|cobrado (duas|2)|cobrar? errad|cancelar (compra|pagamento|pedido))/, priority: 'ALTA', why: 'financeiro' },
  { re: /(lgpd|meus dados|excluir (minha )?conta|apagar (meus )?dados|titular|privacidade)/, priority: 'ALTA', why: 'privacidade' },
  { re: /(fraude|golpe|invadiram|invasao|hack|clonaram|nao reconhe[cç]o|processo|procon|advogad|judicial|ameaç)/, priority: 'URGENTE', why: 'risco' },
  { re: /(senha|codigo de verificacao|token|cartao|cvv)/, priority: 'NORMAL', why: 'credenciais' }
];

/** Mascara sequências que parecem número de cartão (13–19 dígitos válidos no Luhn) antes de gravar a mensagem. */
export function redactSensitive(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const out = text.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const d = m.replace(/\D/g, '');
    if (d.length < 13 || d.length > 19) return m;
    let sum = 0; let dbl = false;
    for (let i = d.length - 1; i >= 0; i--) { let n = Number(d[i]); if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n; dbl = !dbl; }
    if (sum % 10 !== 0) return m;
    redacted = true; return `**** **** **** ${d.slice(-4)}`;
  });
  return { text: out, redacted };
}

export function sensitiveTopic(text: string): { priority: 'NORMAL' | 'ALTA' | 'URGENTE'; why: string } | null {
  const n = normalize(text);
  const hit = SENSITIVE.find((s) => s.re.test(n));
  return hit ? { priority: hit.priority, why: hit.why } : null;
}

export function matchFaq(message: string, faqs: Array<{ id: string; question: string; answer: string }>): { id: string; answer: string; score: number } | null {
  const q = new Set(tokens(message));
  if (q.size === 0) return null;
  let best: { id: string; answer: string; score: number } | null = null;
  for (const f of faqs) {
    const ft = new Set(tokens(f.question));
    if (ft.size === 0) continue;
    let common = 0; for (const t of q) if (ft.has(t)) common += 1;
    const score = common / Math.min(q.size, ft.size);
    if (common >= 2 && score >= 0.6 && (!best || score > best.score)) best = { id: f.id, answer: f.answer, score };
  }
  return best;
}

export async function botReply(message: string, opts: { first: boolean }): Promise<BotReply> {
  const sens = sensitiveTopic(message);
  const credentials = sens?.why === 'credenciais';
  if (sens && !credentials) {
    return {
      kind: 'HANDOFF', escalate: true, priority: sens.priority,
      text: 'Esse assunto precisa ser tratado por uma pessoa da equipe. Já encaminhei a conversa e você receberá a resposta aqui. O bot não faz reembolsos, não altera cobranças e não acessa dados da sua conta.'
    };
  }
  const faqs = (await pool.query('SELECT id,question,answer FROM faqs WHERE active=true ORDER BY display_order LIMIT 200')).rows as Array<{ id: string; question: string; answer: string }>;
  const hit = matchFaq(message, faqs);
  if (credentials && !hit) {
    return { kind: 'HANDOFF', escalate: true, priority: sens!.priority, text: 'Por segurança, nunca envie senha, código de verificação ou dados de cartão por aqui. Encaminhei a conversa para uma pessoa da equipe.' };
  }
  if (hit && credentials) return { kind: 'FAQ', escalate: false, faqId: hit.id, text: `${hit.answer}\n\nPor segurança, nunca envie senha, código de verificação ou dados de cartão por aqui. Se precisar de ajuda, ${HUMAN_HINT.charAt(0).toLowerCase()}${HUMAN_HINT.slice(1)}` };
  if (hit) return { kind: 'FAQ', escalate: false, faqId: hit.id, text: `${hit.answer}\n\nIsso resolveu? Se não, ${HUMAN_HINT.charAt(0).toLowerCase()}${HUMAN_HINT.slice(1)}` };
  return {
    kind: 'TRIAGE', escalate: false,
    text: opts.first
      ? `Recebi sua mensagem. Não encontrei uma resposta pronta para ela entre as perguntas frequentes. ${HUMAN_HINT} Use o botão "Falar com uma pessoa" para encaminhar a conversa à equipe.`
      : `Não encontrei uma resposta pronta para isso. ${HUMAN_HINT}`
  };
}
