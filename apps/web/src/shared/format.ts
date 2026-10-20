// Utilitários de formatação (valores sempre em centavos inteiros).
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents: number | null | undefined): string => (cents == null || Number.isNaN(Number(cents)) ? '—' : brl.format(Number(cents) / 100));
export const moneyShort = (cents: number): string => (Number.isInteger(cents / 100) ? brl.format(cents / 100).replace(',00', '') : brl.format(cents / 100));
export const bpsToPercent = (bps: number | null | undefined): string => (bps == null ? '—' : `${(Number(bps) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
export const percentToBps = (value: string | number): number => Math.round(Number(String(value).replace(',', '.')) * 100);
/** "24,90" / "24.90" / "R$ 24,90" → 2490. Retorna null se inválido. */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, '').trim();
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
export const centsToInput = (cents: number | null | undefined): string => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const dtf = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const dateTime = (v: string | Date | null | undefined): string => (v ? dtf.format(new Date(v)) : '—');
export const dateOnly = (v: string | Date | null | undefined): string => (v ? df.format(new Date(v)) : '—');
export function relativeTime(v: string | Date): string {
  const diff = Date.now() - new Date(v).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d < 30 ? `há ${d} d` : dateOnly(v);
}
export const normalizePlate = (v: string): string => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
export const isValidPlate = (v: string): boolean => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizePlate(v));
export const formatPlate = (v: string): string => { const p = normalizePlate(v); return p.length > 3 && /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p; };
export const num = (n: number | string | null | undefined): string => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';

const STATUS_LABELS: Record<string, string> = { CIRCULACAO: 'Em circulação', 'EM CIRCULACAO': 'Em circulação', 'EM CIRCULAÇÃO': 'Em circulação', BAIXADO: 'Baixado', BAIXADA: 'Baixado', ROUBO: 'Roubo/furto', FURTO: 'Roubo/furto', 'ROUBO/FURTO': 'Roubo/furto' };
/** Rótulo amigável da situação do veículo (mantém o texto original quando desconhecido). */
export function vehicleStatusLabel(v: string | null | undefined): string {
  if (!v) return '';
  const key = v.trim().toUpperCase();
  return STATUS_LABELS[key] ?? v.trim().charAt(0).toUpperCase() + v.trim().slice(1).toLowerCase();
}
