import { buildReportV2 } from '../report/normalizeV2.js';
import { fetchFipeHistory, type FipeType, type FipeHistory } from './fipeHistory.js';

export interface Enrichment { fipeHistory?: FipeHistory; generatedAt: string }

const inferType = (text: string): FipeType => (/moto|motocic|ciclomotor|scooter|motoneta/.test(text) ? 'motorcycles' : /caminh|onibus|trator|reboque|semirreboque/.test(text) ? 'trucks' : 'cars');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Completa a resposta do provedor com dados que o sistema busca/calcula. Nunca lança: qualquer falha devolve o que houver.
 * Hoje: histórico de preços da FIPE (precisa do código FIPE que o Veículo Total entrega).
 */
export async function enrichVehicle(raw: unknown, opts: { fetchImpl?: typeof fetch; timeoutMs?: number; fipeHistory?: boolean } = {}): Promise<Enrichment | undefined> {
  if (opts.fipeHistory === false) return undefined;
  try {
    const report = buildReportV2(raw);
    const item = (key: string) => report.sections.flatMap((s) => s.items).find((i) => i.key === key && i.state !== 'NOT_PROVIDED')?.value ?? '';
    const fipeCode = String(item('VT_FIPE_CODIGO'));
    const modelYear = Number(String(item('VEIANOMODELO')).replace(/\D/g, ''));
    if (!fipeCode || !modelYear) return undefined;
    const type = inferType(fold(`${item('TIPO')} ${item('ESPECIE')} ${item('CATEGORIA')}`));
    const fipeHistory = await fetchFipeHistory({ fipeCode, modelYear, fuel: String(item('COMBUSTIVEL')), type, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs });
    return fipeHistory ? { fipeHistory, generatedAt: new Date().toISOString() } : undefined;
  } catch {
    return undefined;
  }
}
