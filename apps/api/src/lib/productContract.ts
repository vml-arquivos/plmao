/**
 * Contrato de APIs por consulta. Para cada produto de linha fixa, define EXATAMENTE quais consultas da Credify ele compra.
 * É a única fonte desta verdade: o painel não muda o que é comprado nestes produtos (só preço, textos e exibição),
 * o sistema usa estas fontes sempre e, ao consultar, só deixa sair chamada que esteja na lista do produto.
 * Produtos criados no painel (outros ids) continuam escolhendo as fontes livremente.
 */
import type { DataSourceKey } from './dataSources.js';

export interface ProductContract {
  /** Fontes marcadas do produto. null = consulta direta por roteamento (sem camadas). */
  sources: readonly DataSourceKey[] | null;
  /** Caminhos além da base e das fontes marcadas (consulta própria do produto). */
  extraPaths: readonly string[];
}

export const BASE_PATH = '/debitosrestricoesproprietarios';

/** Caminho da Credify de cada fonte. */
export const SOURCE_PATHS: Record<string, string> = {
  SINISTRO: '/indiciosinistro',
  NATIONAL: '/veicularbnacionalonline',
  THEFT: '/historicoroubofurto',
  RECALL: '/recall',
  AUCTION: '/leilaoconjugado',
  GRAVAME: '/gravame',
  RENAJUD: '/renajud',
  OWNERS: '/historicoproprietario',
  OWNER_PLATE: '/veiculoproprietarioplaca',
  FIPE: '/precificadorfipe',
  RENAINF: '/renainf'
};

/** Fontes que só são compradas quando a base de cadastro indica ocorrência (nunca por padrão). */
export const CONDITIONAL_SOURCES: readonly string[] = ['THEFT', 'RECALL', 'GRAVAME', 'RENAJUD'];

const COMPLETA: DataSourceKey[] = ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'FIPE', 'OWNER_PLATE'];
const AVANCADA: DataSourceKey[] = ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'GRAVAME', 'RENAJUD', 'FIPE', 'RENAINF', 'OWNER_PLATE'];
const PREMIUM: DataSourceKey[] = ['SINISTRO', 'NATIONAL', 'THEFT', 'RECALL', 'AUCTION', 'GRAVAME', 'RENAJUD', 'OWNERS', 'FIPE', 'RENAINF', 'OWNER_PLATE'];

export const PRODUCT_CONTRACT: Readonly<Record<string, ProductContract>> = {
  CADASTRAL: { sources: null, extraPaths: [] },
  LIEN: { sources: null, extraPaths: ['/gravame'] },
  AUCTION: { sources: ['NATIONAL', 'AUCTION'], extraPaths: [] },
  BASIC: { sources: AVANCADA, extraPaths: [] },
  COMPLETE: { sources: COMPLETA, extraPaths: [] },
  PREMIUM: { sources: PREMIUM, extraPaths: [] }
};

export function contractFor(productId: string | null | undefined): ProductContract | undefined {
  return PRODUCT_CONTRACT[String(productId ?? '').toUpperCase()];
}

/** Toda chamada que o produto pode fazer (base + fontes + consulta própria). Fora desta lista, nada sai. */
export function allowedPaths(productId: string | null | undefined, extra: readonly string[] = []): Set<string> {
  const c = contractFor(productId);
  const out = new Set<string>([BASE_PATH, ...extra]);
  if (!c) return out;
  for (const s of c.sources ?? []) { const p = SOURCE_PATHS[s]; if (p) out.add(p); }
  for (const p of c.extraPaths) out.add(p);
  return out;
}

/** Chamadas que SEMPRE acontecem em placa limpa (sem ocorrência no cadastro): a base mais as fontes não condicionais. */
export function guaranteedPaths(productId: string | null | undefined): string[] {
  const c = contractFor(productId);
  if (!c) return [];
  const list = [BASE_PATH];
  for (const s of c.sources ?? []) if (!CONDITIONAL_SOURCES.includes(s)) { const p = SOURCE_PATHS[s]; if (p) list.push(p); }
  if (!c.sources) list.push(...c.extraPaths);
  return list;
}

/** Fontes efetivas do produto: a do contrato manda; produto fora do contrato usa o que o painel guardou. */
export function enforcedSources<T extends string>(productId: string, stored: readonly T[] | null): { sources: readonly string[] | null; drift: boolean } {
  const c = contractFor(productId);
  if (!c) return { sources: stored, drift: false };
  const a = [...(c.sources ?? [])].sort().join('+');
  const b = [...(stored ?? [])].sort().join('+');
  return { sources: c.sources, drift: a !== b };
}
