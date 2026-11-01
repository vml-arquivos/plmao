import { parseDate } from './gravame.js';
import type { VtValue } from './vehicleTotal.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (v == null || isRec(v) || Array.isArray(v) ? '' : String(v).trim());
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const upperKeys = (o: Rec): Rec => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));
const NO = /^(NAO|N|FALSE|0|NADA CONSTA|NAO CONSTA|SEM )/;
const brDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** Bloco RENAJUD da resposta do /renajud da Credify (chaves em maiúsculas), ou null. */
function renajudBlock(renajud: unknown): Rec | null {
  if (!isRec(renajud) || renajud.unavailable || !('data' in renajud)) return null;
  const find = (o: unknown, depth = 0): Rec | null => {
    if (!isRec(o) || depth > 5) return null;
    for (const [k, v] of Object.entries(o)) if (k.toUpperCase() === 'RENAJUD' && isRec(v)) return upperKeys(v);
    for (const v of Object.values(o)) { const f = find(v, depth + 1); if (f) return f; }
    return null;
  };
  return find(renajud.data);
}

/** Restrições judiciais devolvidas pelo /renajud (REGISTRO_n ou lista), sem registros vazios. */
export function judicialRecords(renajud: unknown): Rec[] {
  const block = renajudBlock(renajud);
  if (!block) return [];
  const out: Rec[] = [];
  const take = (v: unknown, depth = 0): void => {
    if (depth > 3) return;
    if (Array.isArray(v)) { v.forEach((x) => take(x, depth + 1)); return; }
    if (!isRec(v)) return;
    const u = upperKeys(v);
    if (['NUMERODOPROCESSO', 'NOMETRIBUNAL', 'TIPORESTRICJUDICIAL', 'NOMEORGAOJUDICIAL'].some((k) => str(u[k]))) { out.push(u); return; }
    Object.values(v).forEach((x) => take(x, depth + 1));
  };
  for (const [k, v] of Object.entries(block)) if (/^REGISTRO/.test(k) || Array.isArray(v)) take(v);
  return out;
}

/** O /renajud só vale a chamada extra quando o Veículo Total acusou restrição judicial/Renajud ou veio sem a base de restrições. */
export function judicialNeeded(upper: Rec | null): boolean {
  if (!upper || !Object.keys(upper).length) return true;
  return ['RESJUDICIAL', 'RESRENAJUD'].some((k) => { const v = fold(str(upper[k])); return v !== '' && !/^(NADA CONSTA|NAO CONSTA|NAO POSSUI|NAO EXISTE|NAO HA|SEM |INEXISTENTE)/.test(v); });
}

/** Preenche RESRENAJUD/RESJUDICIAL quando a base de restrições não trouxe e o /renajud respondeu. */
export function applyJudicial(upper: Rec, raw: unknown): void {
  const j = isRec(raw) ? raw.renajud : undefined;
  if (!isRec(j) || j.unavailable) return;
  const recs = judicialRecords(j);
  const block = renajudBlock(j);
  const empty = (k: string) => !str(upper[k]);
  if (recs.length) { upper.RESRENAJUD = `CONSTA RESTRICAO RENAJUD (${recs.length} ${recs.length === 1 ? 'registro' : 'registros'})`; return; }
  const flag = fold(str(block?.CONSTARESTRICAORENAJUD));
  if (empty('RESRENAJUD') && (j.notFound === true || (block && (NO.test(flag) || flag === '')))) upper.RESRENAJUD = 'NADA CONSTA';
}

/** Tribunal, órgão, processo, tipo e data de cada restrição judicial (Renajud), em linguagem direta. */
export function judicialExtras(raw: unknown): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const recs = judicialRecords(isRec(raw) ? raw.renajud : undefined);
  const lines = recs.slice(0, 10).map((r, i) => {
    const d = parseDate(r.DATADAINCLUSAO);
    return [
      recs.length > 1 ? `${i + 1}ª restrição` : '',
      str(r.TIPORESTRICJUDICIAL) ? `Tipo: ${str(r.TIPORESTRICJUDICIAL)}` : '',
      str(r.NOMETRIBUNAL) ? `Tribunal: ${str(r.NOMETRIBUNAL)}` : '',
      str(r.NOMEORGAOJUDICIAL) ? `Órgão: ${str(r.NOMEORGAOJUDICIAL)}` : '',
      str(r.NUMERODOPROCESSO) ? `Processo nº ${str(r.NUMERODOPROCESSO)}` : '',
      d ? `incluída em ${brDate(d)}` : str(r.DATADAINCLUSAO) ? `incluída em ${str(r.DATADAINCLUSAO)}` : ''
    ].filter(Boolean).join(' · ');
  }).filter(Boolean);
  if (lines.length) { const text = lines.join('\n'); out.set('RJ_DETALHES', { state: 'ALERT', value: text, display: text }); }
  return out;
}
