import { env } from '../config.js';
import type { DataSourceKey } from './dataSources.js';

/** O que o sistema usa na Completa quando o produto não tem escolha própria (reflete as variáveis atuais). */
export function defaultSourcesFor(productId: string): DataSourceKey[] {
  const id = productId.toUpperCase();
  if (id === 'COMPLETE' && env.CREDIFY_COMPLETE_MODE === 'layered') {
    return ['SINISTRO', ...(env.CREDIFY_COMPLETE_NATIONAL ? ['NATIONAL' as const] : []), 'THEFT', 'RECALL', 'AUCTION', ...(env.CREDIFY_GRAVAME_SUPPLEMENT ? ['GRAVAME' as const] : []), ...(env.CREDIFY_JUDICIAL_SUPPLEMENT ? ['RENAJUD' as const] : [])];
  }
  if (id === 'COMPLETE' || id === 'PREMIUM') return ['TOTAL', ...(env.CREDIFY_GRAVAME_SUPPLEMENT ? ['GRAVAME' as const] : []), ...(env.CREDIFY_JUDICIAL_SUPPLEMENT ? ['RENAJUD' as const] : [])];
  if (id === 'AUCTION') return ['AUCTION'];
  if (id === 'LIEN') return ['GRAVAME'];
  return [];
}

