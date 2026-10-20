import type { Pool, PoolClient } from 'pg';
import { appError } from '../lib/http.js';
import { formatBRL } from '../lib/money.js';
import { hasPermission } from '../permissions.js';
import { floorPriceFor } from './productPricing.js';
import { loadPaymentSettings } from './settings.js';

/**
 * Trava de margem: nenhum caminho de escrita de preço pode gravar abaixo do piso que preserva a margem mínima
 * em todas as formas de pagamento habilitadas. Exceção somente por super admin com justificativa (auditada pelo chamador).
 */
export async function enforceMarginFloor(db: Pool | PoolClient, input: { name: string; providerCostCents: number; supplierCostCents?: number; priceCents: number; isFree?: boolean }, role: string, override?: { reason: string }): Promise<{ floorCents: number; overridden: boolean }> {
  if (input.isFree || input.priceCents <= 0) return { floorCents: 0, overridden: false };
  const settings = await loadPaymentSettings(db);
  const { floorCents } = floorPriceFor(settings, { id: 'guard', name: input.name, providerCostCents: input.providerCostCents, supplierCostCents: input.supplierCostCents });
  if (floorCents > 0 && input.priceCents < floorCents) {
    if (override && hasPermission(role, 'ADMIN_SYSTEM')) return { floorCents, overridden: true };
    throw appError(`MARGIN_LOCK: preço abaixo do piso de ${formatBRL(floorCents)}`, { code: 'MARGIN_LOCK', http: 422, expose: true });
  }
  return { floorCents, overridden: false };
}
