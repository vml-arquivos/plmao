import { pool } from './db.js';
import { env } from './config.js';
import { log } from './lib/http.js';
import type { FeeDefaults, IofRates, Modality, PersonType } from './lib/financing.js';

/** Séries do Banco Central (SGS): taxa média mensal de juros, recursos livres, em % ao mês. */
export const BCB_SERIES = {
  cdcPf: { code: 25471, label: 'Pessoa física, aquisição de veículos' },
  cdcPj: { code: 25447, label: 'Pessoa jurídica, aquisição de veículos' },
  leasingPf: { code: 25474, label: 'Pessoa física, arrendamento mercantil de veículos' },
  leasingPj: { code: 25450, label: 'Pessoa jurídica, arrendamento mercantil de veículos' }
} as const;
export type SeriesKey = keyof typeof BCB_SERIES;

export interface FinancingSettings {
  rates: { cdcPf: number; cdcPj: number; leasingPf: number | null; leasingPj: number };
  referenceMonth: string;
  source: string;
  autoRefresh: boolean;
  refreshedAt: string | null;
  refreshError: string | null;
  fees: FeeDefaults;
  iof: IofRates;
  updatedAt: string;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function loadFinancingSettings(): Promise<FinancingSettings> {
  const r = await pool.query('SELECT * FROM financing_settings WHERE id=1');
  const s = r.rows[0];
  if (!s) throw new Error('FINANCING_SETTINGS_MISSING');
  return {
    rates: { cdcPf: Number(s.cdc_pf_pct), cdcPj: Number(s.cdc_pj_pct), leasingPf: n(s.leasing_pf_pct), leasingPj: Number(s.leasing_pj_pct) },
    referenceMonth: s.rates_reference_month,
    source: s.rates_source,
    autoRefresh: s.auto_refresh,
    refreshedAt: s.rates_refreshed_at ? new Date(s.rates_refreshed_at).toISOString() : null,
    refreshError: s.rates_refresh_error,
    fees: { cadastroCents: Number(s.fee_cadastro_cents), avaliacaoCents: Number(s.fee_avaliacao_cents), registroCents: Number(s.fee_registro_cents) },
    iof: { pfDailyPct: Number(s.iof_pf_daily_pct), pjDailyPct: Number(s.iof_pj_daily_pct), additionalPct: Number(s.iof_additional_pct), capDays: Number(s.iof_cap_days) },
    updatedAt: new Date(s.updated_at).toISOString()
  };
}

export interface ResolvedRate { pct: number; note: string | null }

/** Taxa de mercado a usar quando o cliente não informa a dele. Leasing de PF quase não existe: cai para a média de leasing de PJ, com aviso. */
export function marketRate(settings: FinancingSettings, modality: Modality, person: PersonType): ResolvedRate {
  const r = settings.rates;
  if (modality === 'CDC') return { pct: person === 'PF' ? r.cdcPf : r.cdcPj, note: null };
  if (person === 'PJ') return { pct: r.leasingPj, note: null };
  if (r.leasingPf && r.leasingPf > 0) return { pct: r.leasingPf, note: null };
  return { pct: r.leasingPj, note: 'Leasing de veículo para pessoa física é raro hoje (o Banco Central não registra operações recentes); usamos como referência a taxa média de leasing para empresas.' };
}

interface BcbPoint { date: string; value: number }

/** Último valor positivo da série (a série de leasing PF vem zerada quando não há operações). */
export async function fetchBcbSeries(code: number, fetchImpl: typeof fetch = fetch): Promise<BcbPoint | null> {
  const res = await fetchImpl(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/8?formato=json`, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`BCB_HTTP_${res.status}`);
  const rows = (await res.json()) as Array<{ data: string; valor: string }>;
  if (!Array.isArray(rows)) throw new Error('BCB_FORMAT');
  for (const row of [...rows].reverse()) {
    const value = Number(String(row.valor).replace(',', '.'));
    if (Number.isFinite(value) && value > 0.05 && value < 15) {
      const [d, m, y] = row.data.split('/');
      return { date: `${y}-${m}`, value };
    }
  }
  return null;
}

let lastAttempt = 0;
let refreshing: Promise<{ ok: boolean; error?: string }> | null = null;

/** Atualiza as taxas pelo Banco Central. Falha de rede nunca derruba o simulador: mantém o último valor e registra o erro. */
export function refreshRatesFromBcb(fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  if (refreshing) return refreshing;
  lastAttempt = Date.now();
  refreshing = (async () => {
    try {
      const entries = await Promise.all((Object.keys(BCB_SERIES) as SeriesKey[]).map(async (k) => [k, await fetchBcbSeries(BCB_SERIES[k].code, fetchImpl)] as const));
      const got = Object.fromEntries(entries) as Record<SeriesKey, BcbPoint | null>;
      if (!got.cdcPf || !got.cdcPj || !got.leasingPj) throw new Error('BCB_MISSING_SERIES');
      const month = [got.cdcPf, got.cdcPj, got.leasingPj].map((p) => p!.date).sort().pop()!;
      await pool.query(
        `UPDATE financing_settings SET cdc_pf_pct=$1, cdc_pj_pct=$2, leasing_pj_pct=$3, leasing_pf_pct=$4, rates_reference_month=$5,
           rates_source='Banco Central do Brasil (SGS 25471, 25447, 25450)', rates_refreshed_at=now(), rates_refresh_error=NULL, updated_at=now() WHERE id=1`,
        [got.cdcPf.value, got.cdcPj.value, got.leasingPj.value, got.leasingPf?.value ?? null, month]
      );
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'BCB_ERROR';
      log('warn', 'financing_rates_refresh_failed', { error: message });
      await pool.query('UPDATE financing_settings SET rates_refresh_error=$1 WHERE id=1', [message.slice(0, 200)]).catch(() => undefined);
      return { ok: false, error: message };
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

/** Atualização preguiçosa: se passou de 24 h e a atualização automática está ligada, dispara em segundo plano. */
export function maybeRefreshInBackground(settings: FinancingSettings): void {
  if (env.NODE_ENV === 'test' || !settings.autoRefresh) return;
  if (process.env.FINANCING_AUTO_REFRESH === 'false') return;
  const age = settings.refreshedAt ? Date.now() - new Date(settings.refreshedAt).getTime() : Infinity;
  if (age < 24 * 60 * 60 * 1000 || Date.now() - lastAttempt < 60 * 60 * 1000) return;
  void refreshRatesFromBcb();
}
