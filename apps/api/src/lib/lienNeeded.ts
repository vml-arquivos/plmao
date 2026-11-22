import { extractReturn } from '../report/normalizeV2.js';
import { bdrpCode, isVehicleTotal } from '../report/vehicleTotal.js';

/**
 * Regra única de quando vale comprar o /gravame: a base principal não trouxe dados, não afirmou "sem gravame" ou indicou
 * alienação sem o agente financeiro, o contrato, a data ou o CNPJ. Vale para a consulta nova e para completar uma antiga ao abrir o relatório.
 */
export function lienDetailNeeded(data: unknown, always = false): boolean {
  if (!isVehicleTotal(data)) return false;
  if (always) return true;
  if (bdrpCode(data) !== '1') return true;
  const upper = Object.fromEntries(Object.entries(extractReturn(data) ?? {}).map(([k, v]) => [k.toUpperCase(), String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim()]));
  const flag = (upper.RESTRICAOFINAN ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (!flag || /BAIX/.test(flag)) return true;
  const clean = /^(NADA CONSTA|NAO CONSTA|NAO POSSUI)/.test(flag) || /SEM (RESTRICAO|GRAVAME)/.test(flag);
  if (clean) return false;
  return !upper.RESTRICAONOMEAGENTE || !upper.NUMEROCONTRATOFINANCEIRA || !upper.RESTRICAODATAINCLUSAO || !upper.CGCFINANCEIRA;
}
