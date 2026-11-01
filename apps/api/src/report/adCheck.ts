import { brlFromCents } from './format.js';
import type { ReportV2 } from './normalizeV2.js';

/**
 * Conferir anúncio: compara o que o anúncio diz (preço, modelo, cor e ano) com o que o registro do veículo mostra.
 * Preço muito abaixo da FIPE e divergência de modelo, cor ou ano são sinais clássicos de golpe e de carro clonado.
 * Os limites de preço são uma referência do sistema, não uma regra oficial.
 */
export interface AdInput { priceCents?: number; model?: string; color?: string; year?: number }
export type PriceLevel = 'ALERT' | 'ATTENTION' | 'OK' | 'ABOVE' | 'NO_REFERENCE';
export interface AdPrice { level: PriceLevel; fipeCents?: number; diffPct?: number; message: string }
export interface AdField { field: 'year' | 'color' | 'model'; status: 'OK' | 'ATTENTION' | 'MISMATCH'; registered: string; informed: string; message: string }
export interface AdResult { price?: AdPrice; fields: AdField[]; summary: string; hasRisk: boolean }

const fold = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim();

/** "R$ 32.500,00" → 3250000. Devolve undefined quando não há número legível. */
export function parseBrlToCents(text: string | null | undefined): number | undefined {
  const m = String(text ?? '').match(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/);
  if (!m) return undefined;
  const reais = Number(m[1]!.replace(/\./g, ''));
  const cents = Number((m[2] ?? '0').padEnd(2, '0'));
  const total = reais * 100 + cents;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

const COLOR_ALIAS: Record<string, string> = { BRANCA: 'BRANCO', PRETA: 'PRETO', VERMELHA: 'VERMELHO', AMARELA: 'AMARELO', CINZA: 'CINZA', PRATA: 'PRATA', AZUL: 'AZUL', VERDE: 'VERDE', MARROM: 'MARROM', BEGE: 'BEGE', LARANJA: 'LARANJA', DOURADA: 'DOURADO', VINHO: 'VINHO' };
const colorKey = (c: string) => { const f = fold(c).split(' ')[0] ?? ''; return COLOR_ALIAS[f] ?? f; };
const tokenHit = (token: string, haystack: string[]) => haystack.some((w) => w === token || (token.length >= 3 && w.startsWith(token)));

function priceCheck(report: ReportV2, informedCents: number): AdPrice {
  const item = report.sections.flatMap((s) => s.items).find((i) => i.key === 'VT_FIPE_PRECO' && i.state !== 'NOT_PROVIDED');
  const fipeCents = parseBrlToCents(item?.display ?? item?.value);
  if (!fipeCents) return { level: 'NO_REFERENCE', message: 'Esta consulta não trouxe o valor da tabela FIPE, então não dá para comparar o preço.' };
  const diffPct = Math.round(((informedCents - fipeCents) / fipeCents) * 1000) / 10;
  const ref = `FIPE de ${brlFromCents(fipeCents)}`;
  if (diffPct <= -25) return { level: 'ALERT', fipeCents, diffPct, message: `O preço está ${Math.abs(diffPct).toLocaleString('pt-BR')}% abaixo da ${ref}. Preço muito abaixo do mercado é o sinal mais comum de golpe: não pague sinal nem antecipe valores.` };
  if (diffPct <= -10) return { level: 'ATTENTION', fipeCents, diffPct, message: `O preço está ${Math.abs(diffPct).toLocaleString('pt-BR')}% abaixo da ${ref}. Pode ser uma boa oferta ou um problema (leilão, sinistro, dívida): confira o relatório e peça vistoria.` };
  if (diffPct <= 10) return { level: 'OK', fipeCents, diffPct, message: `O preço está dentro de 10% da ${ref}.` };
  return { level: 'ABOVE', fipeCents, diffPct, message: `O preço está ${diffPct.toLocaleString('pt-BR')}% acima da ${ref}. Compare com anúncios parecidos antes de aceitar.` };
}

export function checkAd(report: ReportV2, input: AdInput): AdResult {
  const h = report.headline;
  const fields: AdField[] = [];
  if (input.year) {
    const model = Number(h.modelYear) || undefined;
    const made = Number(h.manufactureYear) || undefined;
    const registered = [made, model].filter(Boolean).join('/') || 'não informado';
    if (!model && !made) fields.push({ field: 'year', status: 'ATTENTION', registered, informed: String(input.year), message: 'A consulta não trouxe o ano do veículo.' });
    else if (input.year === model || input.year === made) fields.push({ field: 'year', status: 'OK', registered, informed: String(input.year), message: 'O ano do anúncio confere com o registro.' });
    else if ([model, made].some((y) => y && Math.abs(y - input.year!) === 1)) fields.push({ field: 'year', status: 'ATTENTION', registered, informed: String(input.year), message: 'O ano do anúncio difere em um ano do registro. Pode ser ano de fabricação x modelo: confirme no documento.' });
    else fields.push({ field: 'year', status: 'MISMATCH', registered, informed: String(input.year), message: 'O ano do anúncio não confere com o registro. Pode ser erro do anúncio ou veículo diferente do anunciado (clone).' });
  }
  if (input.color?.trim()) {
    const registered = h.color ?? '';
    if (!registered) fields.push({ field: 'color', status: 'ATTENTION', registered: 'não informada', informed: input.color, message: 'A consulta não trouxe a cor do veículo.' });
    else if (colorKey(input.color) === colorKey(registered)) fields.push({ field: 'color', status: 'OK', registered, informed: input.color, message: 'A cor do anúncio confere com o registro.' });
    else fields.push({ field: 'color', status: 'MISMATCH', registered, informed: input.color, message: 'A cor do anúncio é diferente da registrada. Se o carro foi repintado, a mudança precisa constar no documento; senão, desconfie.' });
  }
  if (input.model?.trim()) {
    const registered = [h.brand, h.fullModel ?? h.model].filter(Boolean).join(' ');
    const hay = fold(`${h.brand ?? ''} ${h.model ?? ''} ${h.fullModel ?? ''}`).split(' ').filter(Boolean);
    const tokens = fold(input.model).split(' ').filter((t) => t.length >= 2);
    if (!hay.length) fields.push({ field: 'model', status: 'ATTENTION', registered: 'não informado', informed: input.model, message: 'A consulta não trouxe o modelo do veículo.' });
    else if (tokens.length && tokens.every((t) => tokenHit(t, hay))) fields.push({ field: 'model', status: 'OK', registered, informed: input.model, message: 'O modelo do anúncio confere com o registro.' });
    else if (tokens.some((t) => tokenHit(t, hay))) fields.push({ field: 'model', status: 'ATTENTION', registered, informed: input.model, message: 'O modelo bate só em parte (versão, motor ou abreviação). Confira com o documento.' });
    else fields.push({ field: 'model', status: 'MISMATCH', registered, informed: input.model, message: 'O modelo do anúncio é diferente do registrado. Pode ser veículo diferente do anunciado (clone).' });
  }
  const price = input.priceCents ? priceCheck(report, input.priceCents) : undefined;
  const hasRisk = price?.level === 'ALERT' || fields.some((f) => f.status === 'MISMATCH');
  const attention = price?.level === 'ATTENTION' || fields.some((f) => f.status === 'ATTENTION');
  const summary = hasRisk
    ? 'Há sinais de risco entre o anúncio e o registro. Não pague nada antes de conferir pessoalmente o carro e o documento.'
    : attention ? 'O anúncio tem pontos que merecem conferência antes de fechar negócio.' : 'Nada divergente entre o anúncio e o registro nos itens informados. Siga conferindo o carro pessoalmente.';
  return { ...(price ? { price } : {}), fields, summary, hasRisk };
}
