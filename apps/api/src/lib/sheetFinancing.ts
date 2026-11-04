import { loadFinancingSettings } from '../financingSettings.js';
import { runSimulation, simulationBody } from '../simulator/service.js';
import type { SheetFinancing } from '../enrichment/sheet.js';

/** Simulação padrão para a ficha ("Financie"): entrada de 20%, 48 parcelas, CDC, pessoa física, veículo usado, taxa de mercado configurada no painel. */
export async function financingTeaser(valueCents: number): Promise<SheetFinancing | undefined> {
  try {
    if (!Number.isFinite(valueCents) || valueCents < 500_000) return undefined;
    const down = Math.round(valueCents * 0.2);
    const body = simulationBody.parse({ modality: 'CDC', personType: 'PF', condition: 'USED', vehicleKind: 'CAR', vehicleValueCents: valueCents, downPaymentCents: down, months: 48 });
    const out = runSimulation(body, await loadFinancingSettings());
    const r = out.results.cdc;
    if (!r || r.installmentCents <= 0) return undefined;
    return { vehicleCents: valueCents, downPaymentCents: down, months: 48, installmentCents: r.installmentCents };
  } catch {
    return undefined;
  }
}
