import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../shared/icons';
import { api } from './api';

/* ---------- Tipos ---------- */
export type Kind = 'CAR' | 'MOTORCYCLE' | 'TRUCK' | 'UTILITY';
export type Modality = 'CDC' | 'LEASING' | 'BOTH';
export type Person = 'PF' | 'PJ';
export type Condition = 'NEW' | 'USED';

export interface FeeLine { key: string; label: string; cents: number; financed: boolean }
export interface ScheduleRow { n: number; dueDate: string; installmentCents: number; interestCents: number; principalCents: number; balanceCents: number }
export interface SimResult {
  modality: 'CDC' | 'LEASING'; vehicleValueCents: number; downPaymentCents: number; downPaymentPct: number; loanNetCents: number;
  fees: FeeLine[]; feesTotalCents: number; iofCents: number; principalCents: number; months: number; monthlyRatePct: number; annualRatePct: number;
  installmentCents: number; residualCents: number; installmentsTotalCents: number; totalPaidCents: number; totalCostCents: number; interestCents: number;
  costOverVehiclePct: number; cetMonthlyPct: number; cetAnnualPct: number; firstInstallmentDays: number; schedule: ScheduleRow[];
}
export interface RateInfo { pct: number; custom: boolean; note: string | null }
export interface CalcResponse {
  results: { cdc?: SimResult; leasing?: SimResult }; rates: { cdc?: RateInfo; leasing?: RateInfo }; errors: { cdc?: string; leasing?: string };
  generatedAt: string; referenceMonth: string; source: string;
}
export interface SimConfig {
  vehicleKinds: Array<{ key: Kind; label: string }>;
  limits: { graceDays: { min: number; max: number }; vehicleMinCents: number; vehicleMaxCents: number; cdcMonths: { min: number; max: number }; leasingMonths: { min: number; max: number }; maxDownPct: number; maxResidualPct: number; ratePct: { min: number; max: number } };
  rates: { cdc: { PF: RateInfo; PJ: RateInfo }; leasing: { PF: RateInfo; PJ: RateInfo } };
  referenceMonth: string; source: string;
  fees: { cadastroCents: number; avaliacaoCents: number; registroCents: number };
  iof: { pfDailyPct: number; pjDailyPct: number; additionalPct: number; capDays: number };
  updatedAt: string;
}

/* ---------- Estado do formulário ---------- */
export interface SimState {
  kind: Kind; modality: Modality; person: Person; condition: Condition;
  value: number; down: number; months: number;
  customRate: string; residual: number; financeFees: boolean; grace: number;
  fees: { cadastro: number | null; avaliacao: number | null; registro: number | null; insurance: number | null };
  label: string; notes: string;
}

export const KINDS: Array<{ key: Kind; slug: string; label: string; icon: IconName; short: string }> = [
  { key: 'CAR', slug: 'carro', label: 'Carro', icon: 'car', short: 'Carros' },
  { key: 'MOTORCYCLE', slug: 'moto', label: 'Moto', icon: 'bike', short: 'Motos' },
  { key: 'TRUCK', slug: 'caminhao', label: 'Caminhão', icon: 'truck', short: 'Caminhões' },
  { key: 'UTILITY', slug: 'utilitario', label: 'Utilitário', icon: 'car', short: 'Utilitários' }
];
export const kindBySlug = (slug?: string) => KINDS.find((k) => k.slug === slug);
export const kindByKey = (key: Kind) => KINDS.find((k) => k.key === key)!;

const DEFAULTS: Record<Kind, { value: number; down: number; months: number; person: Person }> = {
  CAR: { value: 80000, down: 20000, months: 48, person: 'PF' },
  MOTORCYCLE: { value: 18000, down: 4000, months: 36, person: 'PF' },
  TRUCK: { value: 350000, down: 100000, months: 48, person: 'PJ' },
  UTILITY: { value: 120000, down: 30000, months: 48, person: 'PF' }
};

export function defaultState(kind: Kind): SimState {
  const d = DEFAULTS[kind];
  return { kind, modality: 'CDC', person: d.person, condition: kind === 'TRUCK' ? 'NEW' : 'USED', value: d.value, down: d.down, months: d.months, customRate: '', residual: 20, financeFees: true, grace: 30, fees: { cadastro: null, avaliacao: null, registro: null, insurance: null }, label: '', notes: '' };
}

const num = (v: string | null): number | null => { if (v == null || v === '') return null; const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : null; };

/** Lê o estado da URL (permite compartilhar a simulação e voltar do cadastro sem perder nada). */
export function stateFromParams(kind: Kind, p: URLSearchParams): SimState {
  const s = defaultState(kind);
  const v = num(p.get('v')); if (v && v > 0) s.value = v;
  const e = num(p.get('e')); if (e !== null && e >= 0) s.down = e;
  const m = num(p.get('m')); if (m && m >= 6 && m <= 120) s.months = Math.round(m);
  const mod = p.get('mod'); if (mod === 'CDC' || mod === 'LEASING' || mod === 'BOTH') s.modality = mod;
  const pf = p.get('pf'); if (pf === 'PF' || pf === 'PJ') s.person = pf;
  const cond = p.get('c'); if (cond === 'NEW' || cond === 'USED') s.condition = cond;
  const r = p.get('r'); if (r && num(r)) s.customRate = r;
  const res = num(p.get('res')); if (res !== null && res >= 0 && res <= 60) s.residual = res;
  const g = num(p.get('g')); if (g && g >= 30 && g <= 120) s.grace = Math.round(g);
  if (p.get('ff') === '0') s.financeFees = false;
  const label = p.get('n'); if (label) s.label = label.slice(0, 80);
  return s;
}

export function paramsFromState(s: SimState): Record<string, string> {
  const d = defaultState(s.kind);
  const out: Record<string, string> = { v: String(s.value), e: String(s.down), m: String(s.months) };
  if (s.modality !== 'CDC') out.mod = s.modality;
  if (s.person !== d.person) out.pf = s.person;
  if (s.condition !== d.condition) out.c = s.condition;
  if (s.customRate) out.r = s.customRate;
  if (s.modality !== 'CDC' && s.residual !== 20) out.res = String(s.residual);
  if (s.grace !== 30) out.g = String(s.grace);
  if (!s.financeFees) out.ff = '0';
  if (s.label) out.n = s.label;
  return out;
}

export function toBody(s: SimState): Record<string, unknown> {
  const rate = num(s.customRate);
  const fees: Record<string, number> = {};
  if (s.fees.cadastro !== null) fees.cadastroCents = Math.round(s.fees.cadastro * 100);
  if (s.fees.avaliacao !== null) fees.avaliacaoCents = Math.round(s.fees.avaliacao * 100);
  if (s.fees.registro !== null) fees.registroCents = Math.round(s.fees.registro * 100);
  if (s.fees.insurance !== null) fees.insuranceCents = Math.round(s.fees.insurance * 100);
  return {
    modality: s.modality, personType: s.person, vehicleKind: s.kind, condition: s.condition,
    vehicleValueCents: Math.round(s.value * 100), downPaymentCents: Math.round(s.down * 100), months: s.months,
    ratePct: rate && rate > 0 ? rate : null, residualPct: s.residual, financeFees: s.financeFees, firstInstallmentDays: s.grace,
    vehicleLabel: s.label.trim(), notes: s.notes.trim(), fees
  };
}

/* ---------- Formatação ---------- */
export const pct = (v: number, digits = 2) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const monthRef = (ym: string) => { const [y, m] = ym.split('-'); return m && y ? `${m}/${y}` : ym; };
export const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
export const dateBr = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

/* ---------- Configuração (cache de módulo) ---------- */
let cfgCache: Promise<SimConfig> | null = null;
export function loadSimConfig(): Promise<SimConfig> {
  if (!cfgCache) cfgCache = api.get<SimConfig>('/simulator/config').catch((e) => { cfgCache = null; throw e; });
  return cfgCache;
}
export function useSimConfig(): SimConfig | null {
  const [cfg, setCfg] = useState<SimConfig | null>(null);
  useEffect(() => { let alive = true; loadSimConfig().then((c) => { if (alive) setCfg(c); }, () => undefined); return () => { alive = false; }; }, []);
  return cfg;
}

/** Calcula na API com espera (debounce) e descarta respostas antigas. */
export function useCalculation(state: SimState, enabled = true) {
  const [data, setData] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const key = JSON.stringify(toBody(state));
  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api.post<CalcResponse>('/simulator/calculate', JSON.parse(key) as Record<string, unknown>).then((r) => {
        if (id !== seq.current) return;
        setData(r); setError(null);
      }, (e: unknown) => {
        if (id !== seq.current) return;
        setError(e instanceof Error ? e.message : 'Não foi possível simular agora.'); setData(null);
      }).finally(() => { if (id === seq.current) setLoading(false); });
    }, 260);
    return () => clearTimeout(t);
  }, [key, enabled]);
  return { data, error, loading };
}

/* ---------- Campo de dinheiro em reais inteiros ---------- */
export function MoneyInput({ value, onChange, id, placeholder, ariaLabel, invalid }: { value: number | null; onChange: (v: number | null) => void; id?: string; placeholder?: string; ariaLabel?: string; invalid?: boolean }) {
  return (
    <div className="money-input">
      <span aria-hidden="true">R$</span>
      <input
        id={id} className="input" inputMode="numeric" autoComplete="off" aria-label={ariaLabel} aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={value == null ? '' : reais(value)}
        onChange={(e) => { const digits = e.target.value.replace(/\D/g, '').slice(0, 9); onChange(digits === '' ? null : Number(digits)); }}
      />
    </div>
  );
}

/* ---------- Barra de composição do custo ---------- */
export function CostBar({ r }: { r: SimResult }) {
  const interest = Math.max(0, r.totalPaidCents - r.vehicleValueCents - r.iofCents - r.feesTotalCents);
  const segs = [
    { key: 'vehicle', label: 'Veículo', cents: r.vehicleValueCents },
    { key: 'interest', label: 'Juros', cents: interest },
    { key: 'iof', label: 'IOF', cents: r.iofCents },
    { key: 'fees', label: 'Tarifas e seguros', cents: r.feesTotalCents }
  ].filter((s) => s.cents > 0);
  const total = segs.reduce((a, s) => a + s.cents, 0) || 1;
  return (
    <div className="cost-bar">
      <div className="bar" role="img" aria-label={segs.map((s) => `${s.label} ${brl(s.cents)}`).join(', ')}>
        {segs.map((s) => <i key={s.key} className={`seg-${s.key}`} style={{ width: `${(s.cents / total) * 100}%` }} />)}
      </div>
      <ul>
        {segs.map((s) => <li key={s.key}><span className={`dot seg-${s.key}`} />{s.label}<b>{brl(s.cents)}</b><small>{((s.cents / total) * 100).toFixed(1).replace('.', ',')}%</small></li>)}
      </ul>
    </div>
  );
}

export function ScheduleTable({ r }: { r: SimResult }) {
  return (
    <div className="sim-schedule">
      <table>
        <thead><tr><th>Nº</th><th>Vencimento</th><th>Parcela</th><th>Juros</th><th>Amortização</th><th>Saldo</th></tr></thead>
        <tbody>
          {r.schedule.map((row) => (
            <tr key={row.n}><td>{row.n}</td><td>{dateBr(row.dueDate)}</td><td><b>{brl(row.installmentCents)}</b></td><td>{brl(row.interestCents)}</td><td>{brl(row.principalCents)}</td><td>{brl(row.balanceCents)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KindTabs({ value, onChange, compact }: { value: Kind; onChange: (k: Kind) => void; compact?: boolean }) {
  return (
    <div className={`kind-tabs ${compact ? 'compact' : ''}`} role="tablist" aria-label="Tipo de veículo">
      {KINDS.map((k) => (
        <button key={k.key} type="button" role="tab" aria-selected={value === k.key} className="kind-tab" onClick={() => onChange(k.key)}>
          <Icon name={k.icon} size={compact ? 18 : 22} /><span>{k.label}</span>
        </button>
      ))}
    </div>
  );
}
