// Tipos de busca da consulta veicular. As regras espelham as da API (a API é quem decide).
export type SearchType = 'PLATE' | 'CHASSIS' | 'RENAVAM' | 'OWNER_DOC';
export const SEARCH_TYPES: SearchType[] = ['PLATE', 'CHASSIS', 'RENAVAM', 'OWNER_DOC'];
export const SEARCH_LABELS: Record<SearchType, string> = { PLATE: 'Placa', CHASSIS: 'Chassi', RENAVAM: 'Renavam', OWNER_DOC: 'CPF/CNPJ do proprietário' };
export const SEARCH_SHORT: Record<SearchType, string> = { PLATE: 'Placa', CHASSIS: 'Chassi', RENAVAM: 'Renavam', OWNER_DOC: 'CPF/CNPJ' };
export const SEARCH_HINT: Record<SearchType, string> = {
  PLATE: 'Placas Mercosul (ABC1D23) e antigas (ABC-1234).',
  CHASSIS: 'De 8 a 17 letras e números, como no documento do veículo.',
  RENAVAM: 'De 9 a 11 números, como no documento do veículo.',
  OWNER_DOC: 'CPF ou CNPJ do proprietário, só números.'
};
export const SEARCH_PLACEHOLDER: Record<SearchType, string> = { PLATE: 'ABC1D23', CHASSIS: '9BWZZZ377VT004251', RENAVAM: '00639884962', OWNER_DOC: '000.000.000-00' };

const digits = (v: string) => v.replace(/\D/g, '');

function validRenavam(input: string): boolean {
  const d = digits(input);
  if (d.length < 9 || d.length > 11) return false;
  const p = d.padStart(11, '0');
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3];
  const sum = p.slice(0, 10).split('').reverse().reduce((a, c, i) => a + Number(c) * w[i]!, 0);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === Number(p[10]);
}
function validCpf(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[len])) return false;
  }
  return true;
}
function validCnpj(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const mod = w.reduce((a, x, i) => a + Number(d[i]) * x, 0) % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Limpa o que a pessoa digita, conforme o tipo (mantém campo editável e sem símbolos). */
export function cleanSearchInput(type: SearchType, raw: string): string {
  if (type === 'PLATE') return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  if (type === 'CHASSIS') return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
  if (type === 'RENAVAM') return digits(raw).slice(0, 11);
  return digits(raw).slice(0, 14);
}

export function isValidSearch(type: SearchType, value: string): boolean {
  if (type === 'PLATE') return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value);
  if (type === 'CHASSIS') return value.length >= 8 && value.length <= 17 && !(value.length === 17 && /[IOQ]/.test(value));
  if (type === 'RENAVAM') return validRenavam(value);
  return validCpf(value) || validCnpj(value);
}

export function formatDocument(value: string): string {
  if (value.length === 11) return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  if (value.length === 14) return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  return value;
}
