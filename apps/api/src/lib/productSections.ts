import { refreshScopes, scopeForProduct } from './reportScope.js';

/**
 * Seções e campos do relatório liberados por produto (configurados no painel).
 * Cache em memória (leitura síncrona nos serializadores): recarregado na partida, a cada 30 s e após edição no painel.
 * Sem modelo publicado, vale a lista de seções do produto; sem lista, a regra por nível (tier).
 */
export const refreshProductSections = refreshScopes;

export function sectionsForProduct(productId: string | null | undefined): string[] | null {
  return scopeForProduct(productId).sections;
}

export function startProductSectionsRefresh(): void {
  const timer = setInterval(() => { refreshScopes().catch(() => undefined); }, 30_000);
  timer.unref();
}
