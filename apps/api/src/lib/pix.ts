import { isValidCnpj, isValidCpf, onlyDigits } from './br.js';

/** Chave PIX do cliente: usada só para devolver valores (reembolso), cashback e comissões do Indique e Ganhe. */
export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA'] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Descobre o tipo quando a pessoa não escolheu. Dúvida entre CPF e celular: CPF válido ganha. */
export function detectPixType(raw: string): PixKeyType | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes('@')) return EMAIL.test(v) ? 'EMAIL' : null;
  if (UUID.test(v)) return 'ALEATORIA';
  const d = onlyDigits(v);
  if (d.length === 11 && isValidCpf(d) && !v.startsWith('+')) return 'CPF';
  if (d.length === 14 && isValidCnpj(d)) return 'CNPJ';
  if (/^\+?(55)?\d{10,11}$/.test(d) && (d.length === 10 || d.length === 11 || d.length === 12 || d.length === 13)) return 'TELEFONE';
  return null;
}

/** Valida e normaliza a chave (CPF/CNPJ só dígitos, telefone +55…, e-mail minúsculo). Devolve null se não for uma chave válida do tipo. */
export function normalizePixKey(raw: string, type?: string | null): { type: PixKeyType; key: string } | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const t = (type && (PIX_KEY_TYPES as readonly string[]).includes(type) ? (type as PixKeyType) : detectPixType(v));
  if (!t) return null;
  const d = onlyDigits(v);
  switch (t) {
    case 'CPF': return isValidCpf(d) ? { type: t, key: d } : null;
    case 'CNPJ': return isValidCnpj(d) ? { type: t, key: d } : null;
    case 'EMAIL': return EMAIL.test(v) && v.length <= 140 ? { type: t, key: v.toLowerCase() } : null;
    case 'TELEFONE': {
      const national = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
      return national.length === 10 || national.length === 11 ? { type: t, key: `+55${national}` } : null;
    }
    case 'ALEATORIA': return UUID.test(v) ? { type: t, key: v.toLowerCase() } : null;
  }
}

/** Mostra só o final da chave (painel e telas que não precisam do valor inteiro). */
export function maskPixKey(key: string | null | undefined, type?: string | null): string | null {
  if (!key) return null;
  if (type === 'EMAIL') { const [u, dom] = key.split('@'); return `${(u ?? '').slice(0, 2)}***@${dom ?? ''}`; }
  return `***${key.slice(-4)}`;
}
