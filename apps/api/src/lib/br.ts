/** Utilitários de documentos brasileiros usados no cadastro de clientes, empresas e notas fiscais. */

export const onlyDigits = (value: string | null | undefined): string => String(value ?? '').replace(/\D/g, '');

export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[len])) return false;
  }
  return true;
}

export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number): number => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export type DocumentKind = 'CPF' | 'CNPJ';
export function documentKind(input: string | null | undefined): DocumentKind | null {
  const d = onlyDigits(input);
  if (d.length === 11 && isValidCpf(d)) return 'CPF';
  if (d.length === 14 && isValidCnpj(d)) return 'CNPJ';
  return null;
}

export function maskDocument(input: string | null | undefined): string | null {
  const d = onlyDigits(input);
  if (!d) return null;
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-${d.slice(9)}`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.***/${d.slice(8, 12)}-${d.slice(12)}`;
  return '***';
}

export function formatDocument(input: string | null | undefined): string | null {
  const d = onlyDigits(input);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d || null;
}

export const BR_STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

/** Senha temporária legível (sem caracteres ambíguos), mostrada uma única vez ao criar ou redefinir. */
export function temporaryPassword(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(14));
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]!);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}-${chars.slice(10, 14).join('')}#7`;
}

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}
