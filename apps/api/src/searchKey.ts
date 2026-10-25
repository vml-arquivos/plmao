import { isValidCnpj, isValidCpf, onlyDigits } from './lib/br.js';

/** Formas de pedir uma consulta veicular. O que cada fonte atende varia e é declarado pelo provedor. */
export const SEARCH_TYPES = ['PLATE', 'CHASSIS', 'RENAVAM', 'OWNER_DOC'] as const;
export type SearchType = typeof SEARCH_TYPES[number];

export const SEARCH_LABELS: Record<SearchType, string> = {
  PLATE: 'Placa',
  CHASSIS: 'Chassi',
  RENAVAM: 'Renavam',
  OWNER_DOC: 'CPF/CNPJ do proprietário'
};

/** Mensagem de erro por tipo (código de erro da API). */
export const INVALID_CODE: Record<SearchType, string> = {
  PLATE: 'INVALID_PLATE',
  CHASSIS: 'INVALID_CHASSIS',
  RENAVAM: 'INVALID_RENAVAM',
  OWNER_DOC: 'INVALID_OWNER_DOC'
};

export function isValidRenavam(input: string): boolean {
  const digits = onlyDigits(input);
  if (digits.length < 9 || digits.length > 11) return false;
  const padded = digits.padStart(11, '0');
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3];
  const base = padded.slice(0, 10).split('').reverse();
  const sum = base.reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(padded[10]);
}

/**
 * Normaliza e valida a chave da busca. Devolve o valor canônico (placa e chassi em maiúsculas sem símbolos,
 * Renavam com 11 dígitos, documento só com dígitos) ou null se for inválida.
 */
export function normalizeSearchKey(type: SearchType, raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (type === 'PLATE') {
    const value = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value) ? value : null;
  }
  if (type === 'CHASSIS') {
    const value = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length < 8 || value.length > 17) return null;
    // Chassi completo (17) nunca usa I, O e Q.
    if (value.length === 17 && /[IOQ]/.test(value)) return null;
    return value;
  }
  if (type === 'RENAVAM') {
    const digits = onlyDigits(text);
    return isValidRenavam(digits) ? digits.padStart(11, '0') : null;
  }
  const digits = onlyDigits(text);
  if (digits.length === 11) return isValidCpf(digits) ? digits : null;
  if (digits.length === 14) return isValidCnpj(digits) ? digits : null;
  return null;
}

export type SearchInput = { plate?: string; searchType?: SearchType; searchValue?: string };

/** Resolve o corpo da requisição: `plate` (formato antigo) ou `searchType` + `searchValue`. */
export function resolveSearchInput(input: SearchInput): { type: SearchType; value: string } | null {
  const type: SearchType = input.searchType ?? 'PLATE';
  const raw = input.searchValue ?? input.plate ?? '';
  const value = normalizeSearchKey(type, raw);
  return value ? { type, value } : null;
}

/** Mascara o valor para listas e logs (placa e chassi aparecem inteiros ao dono; documento nunca). */
export function maskSearchValue(type: SearchType, value: string): string {
  if (type === 'OWNER_DOC') return value.length === 11 ? `***.${value.slice(3, 6)}.***-${value.slice(9)}` : `**.***.${value.slice(5, 8)}/****-${value.slice(12)}`;
  return value;
}

/** Lê uma lista separada por vírgula (ex.: "PLATE,CHASSIS,RENAVAM"). A placa sempre vale. */
export function parseSearchTypes(csv: string | undefined): SearchType[] {
  const wanted = new Set(String(csv ?? '').split(',').map((v) => v.trim().toUpperCase()));
  return SEARCH_TYPES.filter((t) => t === 'PLATE' || wanted.has(t));
}
