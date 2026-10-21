import { z } from 'zod';
import { simulate, FinancingError, LIMITS, type FinancingInput, type FinancingResult, type Modality, type PersonType } from '../lib/financing.js';
import { marketRate, type FinancingSettings } from '../financingSettings.js';
import { pickBankRate, type BankConfig, type BcbBankRate } from '../lib/bankRates.js';

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
  /** PRICE: parcelas fixas. SAC: parcelas decrescentes. */
  amortization: z.enum(['PRICE', 'SAC']).default('PRICE'),
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
/** Oferta estimada de um banco: mesma simulação com a taxa (e tarifas, se informadas) daquele banco. Sem a tabela de parcelas. */
export interface BankOffer {
  id: string; name: string; modality: 'CDC' | 'LEASING';
  ratePct: number; rateSource: 'manual' | 'bcb'; institution: string | null; period: string | null; ownFees: boolean;
  installmentCents: number; totalPaidCents: number; interestCents: number; iofCents: number; feesTotalCents: number;
  principalCents: number; residualCents: number; cetMonthlyPct: number; cetAnnualPct: number; costOverVehiclePct: number; annualRatePct: number;
}
export interface SimulationOutput {
  body: SimulationBody;
  banks?: BankOffer[];
  results: { cdc?: FinancingResult; leasing?: FinancingResult };
  rates: { cdc?: RateInfo; leasing?: RateInfo };
  errors: { cdc?: string; leasing?: string };
  generatedAt: string;
}

interface BankOverride { pct: number; fees: BankConfig['fees'] }

function toInput(body: SimulationBody, modality: Modality, settings: FinancingSettings, bank?: BankOverride): { input: FinancingInput; rate: RateInfo } {
  const market = marketRate(settings, modality, body.personType);
  const custom = !bank && body.ratePct != null && body.ratePct > 0;
  const pct = bank ? bank.pct : custom ? body.ratePct! : market.pct;
  const bf = bank?.fees;
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
      amortization: body.amortization,
      firstInstallmentDays: body.firstInstallmentDays,
      iof: settings.iof,
      fees: {
        // tarifa digitada pelo cliente vale mais que a do banco, que vale mais que a de referência
        cadastroCents: body.fees.cadastroCents ?? bf?.cadastroCents ?? settings.fees.cadastroCents,
        avaliacaoCents: body.fees.avaliacaoCents ?? (body.condition === 'USED' ? (bf?.avaliacaoCents ?? settings.fees.avaliacaoCents) : 0),
        // leasing: o veículo fica em nome da arrendadora, não há alienação fiduciária/gravame a registrar
        registroCents: body.fees.registroCents ?? (isLeasing ? 0 : (bf?.registroCents ?? settings.fees.registroCents)),
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

/** Mesma simulação para cada banco cadastrado que tenha taxa (informada pela equipe ou média do Banco Central). Ordenado pelo menor CET. */
export function runBankComparison(body: SimulationBody, settings: FinancingSettings, banks: BankConfig[], bcb: BcbBankRate[], now = new Date()): BankOffer[] {
  const wanted: Modality[] = body.modality === 'BOTH' ? ['CDC', 'LEASING'] : [body.modality];
  const offers: BankOffer[] = [];
  for (const bank of banks) {
    if (!bank.active) continue;
    for (const m of wanted) {
      const rate = pickBankRate(bank, m, body.personType, bcb);
      if (!rate) continue;
      try {
        const { input } = toInput(body, m, settings, { pct: rate.pct, fees: bank.fees });
        input.startDate = now;
        const r = simulate(input);
        offers.push({
          id: bank.id, name: bank.name, modality: m, ratePct: rate.pct, rateSource: rate.source, institution: rate.institution, period: rate.period,
          ownFees: bank.fees.cadastroCents != null || bank.fees.avaliacaoCents != null || bank.fees.registroCents != null,
          installmentCents: r.installmentCents, totalPaidCents: r.totalPaidCents, interestCents: r.interestCents, iofCents: r.iofCents, feesTotalCents: r.feesTotalCents,
          principalCents: r.principalCents, residualCents: r.residualCents, cetMonthlyPct: r.cetMonthlyPct, cetAnnualPct: r.cetAnnualPct, costOverVehiclePct: r.costOverVehiclePct, annualRatePct: r.annualRatePct
        });
      } catch (e) {
        if (!(e instanceof FinancingError)) throw e; // prazo ou valor fora do limite da modalidade: o banco só não aparece
      }
    }
  }
  return offers.sort((a, b) => a.cetAnnualPct - b.cetAnnualPct);
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
