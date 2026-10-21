import type { Modality, PersonType } from './financing.js';

/** Taxa média de uma instituição, como o Banco Central publica (% ao mês). */
export interface BcbBankRate { segment: PersonType; modality: Modality; institution: string; monthlyPct: number; annualPct: number | null; position: number | null; period: string | null }

/** Banco cadastrado pela equipe: taxas e tarifas próprias (quando informadas) têm prioridade sobre a média do Banco Central. */
export interface BankConfig {
  id: string; name: string; bcbMatch: string;
  cdcPfPct: number | null; cdcPjPct: number | null; leasingPjPct: number | null;
  fees: { cadastroCents: number | null; avaliacaoCents: number | null; registroCents: number | null };
  notes: string; active: boolean; displayOrder: number; updatedAt: string;
}

export interface BankRate { pct: number; source: 'manual' | 'bcb'; institution: string | null; period: string | null }

/** "BCO SANTANDER (BRASIL) S.A." → "BCO SANTANDER BRASIL S A" (sem acento, pontuação ou caixa). */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** Todas as palavras do texto de busca precisam aparecer, inteiras, no nome da instituição ("PAN" não casa com "PANAMBY"). */
export function matchInstitution(match: string, institution: string): boolean {
  const want = normalizeName(match).split(' ').filter(Boolean);
  if (!want.length) return false;
  const have = new Set(normalizeName(institution).split(' '));
  return want.every((t) => have.has(t));
}

/** Taxa a usar para o banco: a informada pela equipe; se não houver, a média do Banco Central da instituição que casar (a de menor posição). */
export function pickBankRate(bank: BankConfig, modality: Modality, person: PersonType, bcb: BcbBankRate[]): BankRate | null {
  const manual = modality === 'CDC' ? (person === 'PF' ? bank.cdcPfPct : bank.cdcPjPct) : (person === 'PJ' ? bank.leasingPjPct : null);
  if (manual != null && manual > 0) return { pct: manual, source: 'manual', institution: null, period: null };
  const hits = bcb
    .filter((r) => r.segment === person && r.modality === modality && r.monthlyPct > 0 && matchInstitution(bank.bcbMatch, r.institution))
    .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.monthlyPct - b.monthlyPct);
  const best = hits[0];
  return best ? { pct: best.monthlyPct, source: 'bcb', institution: best.institution, period: best.period } : null;
}
