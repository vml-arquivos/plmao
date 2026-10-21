/**
 * Simulador de financiamento de veículos (CDC e leasing).
 *
 * Premissas (todas mostradas ao cliente na tela e no PDF):
 * - Tabela Price (parcelas fixas, padrão) ou SAC (amortização constante: parcelas decrescentes), taxa efetiva mensal, primeira parcela em 30 dias.
 * - IOF de crédito calculado por parcela: alíquota diária × dias (limitado a 365 dias) sobre cada amortização
 *   + alíquota adicional sobre o principal. O IOF é financiado junto (cálculo "por dentro").
 * - Tarifas (cadastro, avaliação do bem, registro do contrato) entram no financiamento ou são pagas à vista.
 * - Leasing: valor residual garantido (VRG) pago no fim, se o cliente exercer a opção de compra.
 * - CET: taxa que iguala o valor liberado ao fluxo de pagamentos (parcelas, residual e tarifas pagas à vista).
 * Dinheiro trafega em centavos inteiros nas bordas; taxas em percentual (ex.: 1,97 = 1,97% ao mês).
 */

export type Modality = 'CDC' | 'LEASING';
export type Amortization = 'PRICE' | 'SAC';
export type PersonType = 'PF' | 'PJ';
export type VehicleKind = 'CAR' | 'MOTORCYCLE' | 'TRUCK' | 'UTILITY';
export type VehicleCondition = 'NEW' | 'USED';

export interface IofRates { pfDailyPct: number; pjDailyPct: number; additionalPct: number; capDays: number }
export interface FeeDefaults { cadastroCents: number; avaliacaoCents: number; registroCents: number }

export interface FinancingInput {
  modality: Modality;
  personType: PersonType;
  vehicleKind: VehicleKind;
  condition: VehicleCondition;
  vehicleValueCents: number;
  downPaymentCents: number;
  months: number;
  /** taxa mensal em % já resolvida (informada pelo cliente ou a média de mercado) */
  monthlyRatePct: number;
  /** leasing: valor residual garantido em % do valor do veículo, pago no fim da operação */
  residualPct: number;
  fees: { cadastroCents: number; avaliacaoCents: number; registroCents: number; insuranceCents: number };
  /** true: tarifas e seguro entram no valor financiado; false: pagas à vista na contratação */
  financeFees: boolean;
  firstInstallmentDays: number;
  iof: IofRates;
  /** PRICE: parcelas fixas (padrão). SAC: a parcela começa maior e diminui a cada mês. */
  amortization?: Amortization;
  /** data de contratação (para os vencimentos); padrão: hoje */
  startDate?: Date;
}

export interface FeeLine { key: string; label: string; cents: number; financed: boolean }
export interface ScheduleRow { n: number; dueDate: string; installmentCents: number; interestCents: number; principalCents: number; balanceCents: number }

export interface FinancingResult {
  modality: Modality;
  vehicleValueCents: number;
  downPaymentCents: number;
  downPaymentPct: number;
  /** valor do veículo menos a entrada (o que a financeira libera) */
  loanNetCents: number;
  fees: FeeLine[];
  feesTotalCents: number;
  feesFinancedCents: number;
  feesUpfrontCents: number;
  iofCents: number;
  /** principal total financiado (liberado + tarifas financiadas + IOF) */
  principalCents: number;
  months: number;
  monthlyRatePct: number;
  annualRatePct: number;
  amortization: Amortization;
  /** primeira parcela (nas parcelas fixas, é o valor de todas) */
  installmentCents: number;
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  residualCents: number;
  installmentsTotalCents: number;
  /** tudo que sai do bolso se ficar com o veículo: entrada + à vista + parcelas + residual */
  totalPaidCents: number;
  /** juros + IOF + tarifas: quanto o crédito custa além do valor do veículo */
  totalCostCents: number;
  interestCents: number;
  costOverVehiclePct: number;
  cetMonthlyPct: number;
  cetAnnualPct: number;
  firstInstallmentDays: number;
  schedule: ScheduleRow[];
}

export class FinancingError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'FinancingError'; }
}

export const LIMITS = {
  minVehicleCents: 500_000,        // R$ 5.000
  maxVehicleCents: 2_000_000_000,  // R$ 20.000.000
  maxDownPct: 95,
  cdcMonths: { min: 6, max: 84 },
  leasingMonths: { min: 24, max: 60 },
  maxResidualPct: 60,
  ratePct: { min: 0.05, max: 15 }
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundCents = (n: number) => Math.round(n);

export const annualFromMonthly = (m: number) => (Math.pow(1 + m / 100, 12) - 1) * 100;

/** Parcela de um fluxo com saldo residual R pago junto da última parcela (taxa i em fração). */
function pmt(principal: number, i: number, n: number, residual: number): number {
  if (i === 0) return (principal - residual) / n;
  const pvResidual = residual / Math.pow(1 + i, n);
  return ((principal - pvResidual) * i) / (1 - Math.pow(1 + i, -n));
}

interface RawSchedule { pmt: number; rows: Array<{ payment: number; interest: number; principal: number; balance: number }> }
/** PRICE: parcela fixa. SAC: amortização constante (principal − residual) / n e juros sobre o saldo, então a parcela cai todo mês. */
function rawSchedule(principal: number, i: number, n: number, residual: number, amortization: Amortization = 'PRICE'): RawSchedule {
  const fixed = pmt(principal, i, n, residual);
  const flat = (principal - residual) / n;
  const rows: RawSchedule['rows'] = [];
  let balance = principal;
  let first = fixed;
  for (let k = 1; k <= n; k++) {
    const interest = balance * i;
    const payment = amortization === 'SAC' ? flat + interest : fixed;
    const amort = payment - interest;
    if (k === 1) first = payment;
    balance -= amort;
    rows.push({ payment, interest, principal: amort, balance: k === n ? residual : balance });
  }
  return { pmt: first, rows };
}

/** IOF de crédito: alíquota diária (máx. capDays) sobre cada amortização + adicional sobre o principal. */
export function computeIof(principal: number, sched: RawSchedule, residual: number, firstDays: number, dailyPct: number, additionalPct: number, capDays: number): number {
  let iof = principal * (additionalPct / 100);
  sched.rows.forEach((row, idx) => {
    const days = firstDays + 30 * idx;
    iof += row.principal * (Math.min(days, capDays) * dailyPct / 100);
  });
  if (residual > 0) {
    const days = firstDays + 30 * (sched.rows.length - 1);
    iof += residual * (Math.min(days, capDays) * dailyPct / 100);
  }
  return iof;
}

/** Resolve a taxa r (mensal, fração) tal que liberado = Σ parcela/(1+r)^t + residual/(1+r)^t_n. `payment` pode ser um valor fixo ou a lista de parcelas. */
export function solveCet(released: number, payment: number | number[], months: number, residual: number, firstDays: number): number {
  const list = Array.isArray(payment) ? payment : Array.from({ length: months }, () => payment);
  const npv = (r: number) => {
    let v = 0;
    for (let k = 1; k <= months; k++) v += (list[k - 1] ?? 0) / Math.pow(1 + r, (firstDays + 30 * (k - 1)) / 30);
    if (residual > 0) v += residual / Math.pow(1 + r, (firstDays + 30 * (months - 1)) / 30);
    return v;
  };
  if (npv(0) <= released) return 0;
  let lo = 0; let hi = 1;
  while (npv(hi) > released && hi < 1000) hi *= 2;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > released) lo = mid; else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

function addMonths(d: Date, months: number, days = 0): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  const day = x.getUTCDate();
  x.setUTCDate(1);
  x.setUTCMonth(x.getUTCMonth() + months);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return x;
}

export function validateInput(i: FinancingInput): void {
  if (!Number.isSafeInteger(i.vehicleValueCents) || i.vehicleValueCents < LIMITS.minVehicleCents || i.vehicleValueCents > LIMITS.maxVehicleCents) throw new FinancingError('SIM_VEHICLE_VALUE', 'Informe o valor do veículo entre R$ 5.000 e R$ 20.000.000.');
  if (!Number.isSafeInteger(i.downPaymentCents) || i.downPaymentCents < 0) throw new FinancingError('SIM_DOWN_PAYMENT', 'A entrada não pode ser negativa.');
  if (i.downPaymentCents > i.vehicleValueCents * LIMITS.maxDownPct / 100) throw new FinancingError('SIM_DOWN_PAYMENT', 'A entrada pode ser de no máximo 95% do valor do veículo.');
  const range = i.modality === 'LEASING' ? LIMITS.leasingMonths : LIMITS.cdcMonths;
  if (!Number.isInteger(i.months) || i.months < range.min || i.months > range.max) throw new FinancingError('SIM_MONTHS', `O prazo deve ficar entre ${range.min} e ${range.max} meses.`);
  if (!(i.monthlyRatePct >= LIMITS.ratePct.min && i.monthlyRatePct <= LIMITS.ratePct.max)) throw new FinancingError('SIM_RATE', 'Informe uma taxa mensal entre 0,05% e 15%.');
  if (i.modality === 'LEASING' && !(i.residualPct >= 0 && i.residualPct <= LIMITS.maxResidualPct)) throw new FinancingError('SIM_RESIDUAL', 'O valor residual deve ficar entre 0% e 60%.');
  if (!Number.isInteger(i.firstInstallmentDays) || i.firstInstallmentDays < 30 || i.firstInstallmentDays > 120) throw new FinancingError('SIM_GRACE', 'A primeira parcela pode vencer entre 30 e 120 dias depois da contratação.');
  for (const [k, v] of Object.entries(i.fees)) if (!Number.isSafeInteger(v) || v < 0 || v > 5_000_000) throw new FinancingError('SIM_FEES', `Valor inválido em ${k}.`);
}

export function simulate(input: FinancingInput): FinancingResult {
  validateInput(input);
  const isLeasing = input.modality === 'LEASING';
  const i = input.monthlyRatePct / 100;
  const n = input.months;
  const amortization: Amortization = input.amortization === 'SAC' ? 'SAC' : 'PRICE';
  const loanNet = input.vehicleValueCents - input.downPaymentCents;
  const residual = isLeasing ? roundCents(input.vehicleValueCents * input.residualPct / 100) : 0;

  const fees: FeeLine[] = [];
  const addFee = (key: string, label: string, cents: number) => { if (cents > 0) fees.push({ key, label, cents, financed: input.financeFees }); };
  addFee('cadastro', 'Tarifa de cadastro', input.fees.cadastroCents);
  addFee('avaliacao', 'Avaliação do bem', input.fees.avaliacaoCents);
  addFee('registro', isLeasing ? 'Registro do contrato' : 'Registro do contrato / gravame', input.fees.registroCents);
  addFee('seguro', 'Seguro / serviços opcionais', input.fees.insuranceCents);
  const feesTotal = fees.reduce((s, f) => s + f.cents, 0);
  const feesFinanced = input.financeFees ? feesTotal : 0;
  const feesUpfront = input.financeFees ? 0 : feesTotal;

  const dailyPct = input.personType === 'PF' ? input.iof.pfDailyPct : input.iof.pjDailyPct;
  // carência: dias além dos 30 padrão até a 1ª parcela capitalizam juros sobre o saldo
  const growth = Math.pow(1 + i, (input.firstInstallmentDays - 30) / 30);
  // ponto fixo: o IOF financiado aumenta o principal, que aumenta o IOF
  let principal = loanNet + feesFinanced;
  let iof = 0;
  for (let it = 0; it < 60; it++) {
    const sched = rawSchedule(principal * growth, i, n, residual, amortization);
    sched.rows.forEach((row) => { row.principal /= growth; });
    iof = computeIof(principal, sched, residual, input.firstInstallmentDays, dailyPct, input.iof.additionalPct, input.iof.capDays);
    const next = loanNet + feesFinanced + iof;
    if (Math.abs(next - principal) < 0.001) { principal = next; break; }
    principal = next;
  }
  const finalSched = rawSchedule(principal * growth, i, n, residual, amortization);
  const carencyInterest = principal * (growth - 1);

  const start = input.startDate ?? new Date();
  const schedule: ScheduleRow[] = finalSched.rows.map((row, idx) => {
    const due = addMonths(start, idx, input.firstInstallmentDays);
    return {
      n: idx + 1,
      dueDate: due.toISOString().slice(0, 10),
      installmentCents: roundCents(row.payment),
      interestCents: roundCents(row.interest + (idx === 0 ? carencyInterest : 0)),
      principalCents: roundCents(idx === 0 ? row.principal - carencyInterest : row.principal),
      balanceCents: Math.max(0, roundCents(row.balance))
    };
  });

  const payments = schedule.map((r) => r.installmentCents);
  const installment = payments[0] ?? 0;
  const lastInstallment = payments[payments.length - 1] ?? 0;
  const installmentsTotal = payments.reduce((a, b) => a + b, 0);
  const totalPaid = input.downPaymentCents + feesUpfront + installmentsTotal + residual;
  const totalCost = totalPaid - input.vehicleValueCents;
  const iofRounded = roundCents(iof);
  const interest = Math.max(0, roundCents(installmentsTotal + residual - principal));
  const firstInstallmentDays = input.firstInstallmentDays;
  const cet = solveCet(loanNet - feesUpfront, payments, n, residual, input.firstInstallmentDays);

  return {
    modality: input.modality,
    vehicleValueCents: input.vehicleValueCents,
    downPaymentCents: input.downPaymentCents,
    downPaymentPct: round2(input.downPaymentCents / input.vehicleValueCents * 100),
    loanNetCents: loanNet,
    fees,
    feesTotalCents: feesTotal,
    feesFinancedCents: feesFinanced,
    feesUpfrontCents: feesUpfront,
    iofCents: iofRounded,
    principalCents: roundCents(principal),
    months: n,
    monthlyRatePct: input.monthlyRatePct,
    annualRatePct: round2(annualFromMonthly(input.monthlyRatePct)),
    amortization,
    installmentCents: installment,
    firstInstallmentCents: installment,
    lastInstallmentCents: lastInstallment,
    residualCents: residual,
    installmentsTotalCents: installmentsTotal,
    totalPaidCents: totalPaid,
    totalCostCents: totalCost,
    interestCents: interest,
    costOverVehiclePct: round2(totalCost / input.vehicleValueCents * 100),
    cetMonthlyPct: round2(cet * 100),
    cetAnnualPct: round2((Math.pow(1 + cet, 12) - 1) * 100),
    firstInstallmentDays,
    schedule
  };
}
