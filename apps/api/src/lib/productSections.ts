import { pool } from '../db.js';

/**
 * Seções do relatório liberadas por produto (configuradas no painel).
 * Cache em memória (leitura síncrona nos serializadores): recarregado na partida, a cada 30 s e após edição no painel.
 * `null` = sem lista configurada → vale a regra por nível (tier) do produto.
 */
let cache = new Map<string, string[] | null>();

export async function refreshProductSections(): Promise<void> {
  const rows = await pool.query('SELECT id, report_sections FROM query_products');
  const next = new Map<string, string[] | null>();
  for (const r of rows.rows) next.set(String(r.id), Array.isArray(r.report_sections) && r.report_sections.length ? (r.report_sections as string[]) : null);
  cache = next;
}

export function sectionsForProduct(productId: string | null | undefined): string[] | null {
  return cache.get(String(productId ?? '')) ?? null;
}

export function startProductSectionsRefresh(): void {
  const timer = setInterval(() => { refreshProductSections().catch(() => undefined); }, 30_000);
  timer.unref();
}
