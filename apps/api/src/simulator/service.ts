import { z } from 'zod';
import { simulate, FinancingError, LIMITS, type FinancingInput, type FinancingResult, type Modality, type PersonType } from '../lib/financing.js';
import { marketRate, type FinancingSettings } from '../financingSettings.js';

export const VEHICLE_KINDS = [
  { key: 'CAR', label: 'Carro' },
  { key: 'MOTORCYCLE', label: 'Moto' },
  { key: 'TRUCK', label: 'Caminhão' },
  { key: 'UTILITY', label: 'Utilitário / van / picape' }
] as const;

const cents = z.number().int().min(0).max(2_000_000_000);
export const simulationBody = z.object({
  modality: z.enum(['CDC', 'LEASING', 'BOTH']).default('CDC'),
  personType: z.enum(['PF', 'PJ']).default('PF'),
  vehicleKind: z.enum(['CAR', 'MOTORCYCLE', 'TRUCK', 'UTILITY']).default('CAR'),
  condition: z.enum(['NEW', 'USED']).default('USED'),
  vehicleValueCents: cents,
  downPaymentCents: cents.default(0),
  months: z.number().int().min(1).max(120).default(48),
  /** taxa mensal própria (ex.: a da proposta do banco), em % ao mês */
  ratePct: z.number().min(0).max(100).nullish(),
  residualPct: z.number().min(0).max(100).default(20),
  financeFees: z.boolean().default(true),
  /** dias até a 1ª parcela (30 = padrão; mais que isso é carência, com juros capitalizados) */
  firstInstallmentDays: z.number().int().min(30).max(120).default(30),
  /** texto livre que aparece no PDF, ex.: "Honda Civic EXL 2020" */
  vehicleLabel: z.string().trim().max(80).default(''),
  notes: z.string().trim().max(400).default(''),
  fees: z.object({
    cadastroCents: z.number().int().min(0).max(5_000_000).optional(),
    avaliacaoCents: z.number().int().min(0).max(5_000_000).optional(),
    registroCents: z.number().int().min(0).max(5_000_000).optional(),
    insuranceCents: z.number().int().min(0).max(5_000_000).optional()
  }).strict().default({})
}).strict();
export type SimulationBody = z.infer<typeof simulationBody>;

export interface RateInfo { pct: number; custom: boolean; note: string | null }
export interface SimulationOutput {
  body: SimulationBody;
  results: { cdc?: FinancingResult; leasing?: FinancingResult };
  rates: { cdc?: RateInfo; leasing?: RateInfo };
  errors: { cdc?: string; leasing?: string };
  generatedAt: string;
}

function toInput(body: SimulationBody, modality: Modality, settings: FinancingSettings): { input: FinancingInput; rate: RateInfo } {
  const market = marketRate(settings, modality, body.personType);
  const custom = body.ratePct != null && body.ratePct > 0;
  const pct = custom ? body.ratePct! : market.pct;
  const isLeasing = modality === 'LEASING';
  return {
    rate: { pct, custom, note: custom ? null : market.note },
    input: {
      modality,
      personType: body.personType,
      vehicleKind: body.vehicleKind,
      condition: body.condition,
      vehicleValueCents: body.vehicleValueCents,
      downPaymentCents: body.downPaymentCents,
      months: body.months,
      monthlyRatePct: pct,
      residualPct: isLeasing ? body.residualPct : 0,
      financeFees: body.financeFees,
      firstInstallmentDays: body.firstInstallmentDays,
      iof: settings.iof,
      fees: {
        cadastroCents: body.fees.cadastroCents ?? settings.fees.cadastroCents,
        avaliacaoCents: body.fees.avaliacaoCents ?? (body.condition === 'USED' ? settings.fees.avaliacaoCents : 0),
        // leasing: o veículo fica em nome da arrendadora, não há alienação fiduciária/gravame a registrar
        registroCents: body.fees.registroCents ?? (isLeasing ? 0 : settings.fees.registroCents),
        insuranceCents: body.fees.insuranceCents ?? 0
      }
    }
  };
}

/** Executa a(s) simulação(ões). Erros de uma modalidade não derrubam a outra quando o cliente pede as duas. */
export function runSimulation(body: SimulationBody, settings: FinancingSettings, now = new Date()): SimulationOutput {
  const out: SimulationOutput = { body, results: {}, rates: {}, errors: {}, generatedAt: now.toISOString() };
  const wanted: Modality[] = body.modality === 'BOTH' ? ['CDC', 'LEASING'] : [body.modality];
  for (const m of wanted) {
    const key = m === 'CDC' ? 'cdc' : 'leasing';
    try {
      const { input, rate } = toInput(body, m, settings);
      input.startDate = now;
      out.results[key] = simulate(input);
      out.rates[key] = rate;
    } catch (e) {
      if (!(e instanceof FinancingError)) throw e;
      if (body.modality !== 'BOTH') throw e;
      out.errors[key] = e.message;
    }
  }
  if (!out.results.cdc && !out.results.leasing) throw new FinancingError('SIM_INVALID', Object.values(out.errors)[0] ?? 'Não foi possível simular.');
  return out;
}

export function simulatorConfig(settings: FinancingSettings) {
  return {
    vehicleKinds: VEHICLE_KINDS,
    limits: { graceDays: { min: 30, max: 120 }, vehicleMinCents: LIMITS.minVehicleCents, vehicleMaxCents: LIMITS.maxVehicleCents, cdcMonths: LIMITS.cdcMonths, leasingMonths: LIMITS.leasingMonths, maxDownPct: LIMITS.maxDownPct, maxResidualPct: LIMITS.maxResidualPct, ratePct: LIMITS.ratePct },
    rates: {
      cdc: { PF: marketRate(settings, 'CDC', 'PF'), PJ: marketRate(settings, 'CDC', 'PJ') },
      leasing: { PF: marketRate(settings, 'LEASING', 'PF'), PJ: marketRate(settings, 'LEASING', 'PJ') }
    },
    referenceMonth: settings.referenceMonth,
    source: settings.source,
    fees: settings.fees,
    iof: settings.iof,
    updatedAt: settings.refreshedAt ?? settings.updatedAt
  };
}

export type { PersonType };
