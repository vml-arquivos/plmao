import { buildReportV2 } from '../report/normalizeV2.js';
import { enrichVehicle, type Enrichment } from '../enrichment/index.js';
import { parsePriceCents } from '../enrichment/fipeHistory.js';
import { buildVehicleSheet } from '../enrichment/sheet.js';
import { catalogSpecsFor } from './sheetSpecs.js';
import { financingTeaser } from './sheetFinancing.js';

/**
 * Complemento das consultas pagas: o que o sistema já fazia (histórico FIPE) mais a ficha gratuita do veículo,
 * montada uma vez e guardada junto da consulta (a ficha não muda se o guia ou as taxas mudarem depois).
 * Nunca lança e não faz nenhuma chamada paga ao fornecedor de dados.
 */
export async function enrichWithSheet(raw: unknown, opts: { fipeHistory?: boolean; fetchImpl?: typeof fetch } = {}): Promise<(Enrichment & { sheet?: unknown }) | undefined> {
  let base: Enrichment | undefined;
  try { base = await enrichVehicle(raw, { fipeHistory: opts.fipeHistory, fetchImpl: opts.fetchImpl }); } catch { base = undefined; }
  try {
    const report = buildReportV2(raw);
    const item = (key: string) => String(report.sections.flatMap((s) => s.items).find((i) => i.key === key && i.state !== 'NOT_PROVIDED')?.value ?? '');
    const match = base?.fipeMatch;
    const code = item('VT_FIPE_CODIGO') || match?.fipeCode || base?.fipeHistory?.fipeCode || '';
    const priceFromReport = parsePriceCents(item('VT_FIPE_PRECO'));
    const current = match?.valueCents ?? (priceFromReport || null);
    const modelYear = Number(item('VEIANOMODELO').replace(/\D/g, '')) || null;
    const fipeModel = item('VT_FIPE_MODELO') || (match ? `${match.brand} ${match.model}` : '');
    const financing = current ? await financingTeaser(current) : undefined;
    const specs = await catalogSpecsFor({ brand: item('MARCA'), model: item('MODELO'), fullModel: item('MARCAMODELOCOMPLETO'), year: modelYear });
    const sheet = buildVehicleSheet({
      chassis: item('CHASSI'), engine: item('MOTOR'), brand: item('MARCA'), fullModel: item('MARCAMODELOCOMPLETO') || item('MODELO'),
      fuel: item('COMBUSTIVEL'), modelYear, manufactureYear: item('VEIANOFABR'), fipeCode: code, fipeModel, fipeCurrentCents: current, history: base?.fipeHistory ?? null, financing, specs
    });
    return { ...(base ?? { generatedAt: new Date().toISOString() }), sheet };
  } catch {
    return base;
  }
}
