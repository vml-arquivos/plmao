import type { VtValue } from './vehicleTotal.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (v == null || isRec(v) || Array.isArray(v) ? '' : String(v).trim());
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const upperKeys = (o: Rec): Rec => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));
const none = (s: string) => !s || /^(NAO INFORMAD[OA]|NADA CONSTA|N\/?A|-+|0+)$/.test(fold(s));
const NOT_PROVIDED: VtValue = { state: 'NOT_PROVIDED', value: null };
const info = (s: string): VtValue => ({ state: 'INFO', value: s, display: s });

const MONTHS: Record<string, number> = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };

/** "15/03/2021", "15-MAR-21", "2021-03-15" ou "20210315" → data (UTC, meio-dia) ou null. */
export function parseDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  let d: number; let m: number; let y: number;
  let r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (r) { d = Number(r[1]); m = Number(r[2]); y = Number(r[3]); }
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) { y = Number(r[1]); m = Number(r[2]); d = Number(r[3]); }
  else if ((r = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = Number(r[1]); m = Number(r[2]); d = Number(r[3]); }
  else if ((r = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/.exec(s)) && MONTHS[r[2]!.toUpperCase()]) { d = Number(r[1]); m = MONTHS[r[2]!.toUpperCase()]!; y = r[3]!.length === 2 ? (Number(r[3]) >= 50 ? 1900 : 2000) + Number(r[3]) : Number(r[3]); }
  else return null;
  if (!(y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return new Date(Date.UTC(y, m - 1, d, 12));
}
const brDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const span = (months: number) => {
  const y = Math.floor(months / 12); const m = months % 12;
  const parts = [y ? `${y} ${y === 1 ? 'ano' : 'anos'}` : '', m ? `${m} ${m === 1 ? 'mês' : 'meses'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' e ') : 'menos de 1 mês';
};
const monthsBetween = (from: Date, to: Date) => (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0);
/** "há 3 anos e 2 meses" (data passada) ou "faltam 1 ano e 4 meses" (data futura). */
export function distance(date: Date, now: Date): { text: string; future: boolean } {
  if (date.getTime() <= now.getTime()) return { text: `há ${span(Math.max(0, monthsBetween(date, now)))}`, future: false };
  return { text: `faltam ${span(Math.max(0, monthsBetween(now, date)))}`, future: true };
}

/** Gravames devolvidos pelo /gravame da Credify (lista, objeto único ou REGISTRO_n), já com as chaves em maiúsculas. */
export function lienRecords(gravame: unknown): Rec[] {
  if (!isRec(gravame) || !('data' in gravame)) return [];
  const find = (o: unknown, depth = 0): unknown => {
    if (!isRec(o) || depth > 5) return undefined;
    for (const [k, v] of Object.entries(o)) if (k.toUpperCase() === 'GRAVAMES' && v != null) return v;
    for (const v of Object.values(o)) { const f = find(v, depth + 1); if (f !== undefined) return f; }
    return undefined;
  };
  const node = find(gravame.data);
  const looksLien = (o: Rec) => ['NUMERO_RESTRICAO', 'NOME_AGENTE', 'NUMERO_CONTRATO', 'DATA_RESTRICAO'].some((k) => k in o);
  const out: Rec[] = [];
  const take = (v: unknown, depth = 0): void => {
    if (depth > 3) return;
    if (Array.isArray(v)) { v.forEach((x) => take(x, depth + 1)); return; }
    if (!isRec(v)) return;
    const u = upperKeys(v);
    if (looksLien(u)) { out.push(u); return; }
    Object.values(v).forEach((x) => take(x, depth + 1));
  };
  take(node);
  return out.filter((r) => Object.values(r).some((x) => str(x) && !none(str(x))));
}

/**
 * Complemento de gravame (consulta /gravame): quando o Veículo Total veio sem a base de gravame, usa a lista do /gravame
 * para preencher banco, CNPJ, contrato e datas nos campos de restrição financeira. Só age quando a resposta do /gravame existe.
 */
export function applyLien(upper: Rec, raw: unknown): void {
  const g = isRec(raw) ? raw.gravame : undefined;
  if (!isRec(g)) return;
  if (g.unavailable) return;
  const recs = lienRecords(g);
  const empty = (k: string) => none(str(upper[k]));
  if (!recs.length) {
    // Resposta do /gravame sem nenhum gravame (ou "não encontrado"): a base de gravames não tem registro para o veículo.
    if (empty('RESTRICAOFINAN') && (g.notFound === true || 'data' in g)) upper.RESTRICAOFINAN = 'NADA CONSTA';
    return;
  }
  const active = recs.find((r) => !/BAIX|CANCEL|EXTINT|ENCERR|QUITAD/.test(fold(str(r.STATUS)))) ?? null;
  const main = active ?? recs[0]!;
  if (empty('RESTRICAOFINAN')) upper.RESTRICAOFINAN = active ? `ALIENACAO FIDUCIARIA / GRAVAME ATIVO${str(active.STATUS) ? ` (${str(active.STATUS)})` : ''}` : 'NADA CONSTA';
  if (empty('RESTRICAONOMEAGENTE')) upper.RESTRICAONOMEAGENTE = str(main.NOME_AGENTE);
  if (empty('CGCFINANCEIRA')) upper.CGCFINANCEIRA = str(main.DOCUMENTO_AGENTE);
  if (empty('RESTRICAODATAINCLUSAO')) upper.RESTRICAODATAINCLUSAO = str(main.DATA_RESTRICAO);
  if (empty('NUMEROCONTRATOFINANCEIRA')) upper.NUMEROCONTRATOFINANCEIRA = str(main.NUMERO_CONTRATO);
  if (empty('CODIGOAGENTEFINANCEIRO')) upper.CODIGOAGENTEFINANCEIRO = str(main.CODIGO_AGENTE);
}

/** Itens de leitura direta do gravame: situação, banco/contrato/tempo, prazo restante e o aviso sobre valores. */
export function gravameExtras(upper: Rec, raw: unknown, now = new Date()): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const g = isRec(raw) ? raw.gravame : undefined;
  const recs = isRec(g) ? lienRecords(g) : [];
  const flag = fold(str(upper.RESTRICAOFINAN));
  const hasFlag = Boolean(flag);
  const lienFromFlag = hasFlag && !none(flag) && !/SEM (RESTRICAO|GRAVAME)|NAO CONSTA/.test(flag);
  const clean = hasFlag && (none(flag) || /SEM (RESTRICAO|GRAVAME)|NAO CONSTA/.test(flag)) && !recs.length;
  const hasData = lienFromFlag || recs.length > 0;

  if (!hasFlag && !recs.length) {
    out.set('GR_SITUACAO', info('Não informado pela fonte: a base de gravame não retornou dados para este veículo. Isso não equivale a “nada consta”.'));
    return out;
  }
  if (clean) { out.set('GR_SITUACAO', info('Sem gravame ou alienação fiduciária registrados.')); return out; }

  const bank = str(upper.RESTRICAONOMEAGENTE) || str(upper.INTENCAONOMEFINANC);
  const cnpj = str(upper.CGCFINANCEIRA);
  const rows: Rec[] = recs.length ? recs : [{
    NOME_AGENTE: str(upper.RESTRICAONOMEAGENTE), DOCUMENTO_AGENTE: str(upper.CGCFINANCEIRA), NUMERO_CONTRATO: str(upper.NUMEROCONTRATOFINANCEIRA),
    DATA_RESTRICAO: str(upper.RESTRICAODATAINCLUSAO), STATUS: str(upper.RESTRICAOFINAN)
  }];
  const cleared = (r: Rec) => /BAIX|CANCEL|EXTINT|ENCERR|QUITAD/.test(fold(str(r.STATUS)));
  const activeCount = recs.length ? recs.filter((r) => !cleared(r)).length : 1;
  const clearedCount = recs.length ? recs.length - activeCount : 0;
  if (recs.length && !activeCount) out.set('GR_SITUACAO', info(`Sem gravame ativo. Há ${clearedCount} ${clearedCount === 1 ? 'gravame baixado' : 'gravames baixados'} no histórico do veículo${bank ? ` (${bank})` : ''}.`));
  else out.set('GR_SITUACAO', info(`Há gravame / alienação fiduciária ativo${bank ? ` — ${bank}` : ''}${clearedCount ? `; mais ${clearedCount} ${clearedCount === 1 ? 'baixado' : 'baixados'} no histórico` : ''}.`));

  const lines: string[] = [];
  const table: string[][] = [];
  rows.slice(0, 20).forEach((r, i) => {
    const bankName = str(r.NOME_AGENTE) || bank;
    const doc = str(r.DOCUMENTO_AGENTE) || cnpj;
    const inc = parseDate(r.DATA_RESTRICAO);
    const start = parseDate(r.DATA_CONTRATO);
    const done = recs.length ? cleared(r) : false;
    const status = done ? 'Gravame baixado pelo agente financeiro' : 'Gravame ativo (alienação fiduciária)';
    const parts = [
      rows.length > 1 ? `${i + 1}º gravame` : '',
      bankName ? `Banco/financeira: ${bankName}${doc ? ` (CNPJ ${doc})` : ''}` : '',
      str(r.NUMERO_CONTRATO) ? `contrato nº ${str(r.NUMERO_CONTRATO)}` : '',
      str(r.NUMERO_RESTRICAO) ? `restrição nº ${str(r.NUMERO_RESTRICAO)}` : '',
      inc ? `gravame incluído em ${brDate(inc)} (${distance(inc, now).text})` : '',
      start ? `contrato iniciado em ${brDate(start)} (${distance(start, now).text})` : '',
      str(r.ESTADO_RESTRICAO) ? `UF ${str(r.ESTADO_RESTRICAO)}` : '',
      recs.length ? `situação: ${status.toLowerCase()}` : (str(r.STATUS) && !/^ALIENACAO FIDUCIARIA \/ GRAVAME ATIVO/.test(fold(str(r.STATUS))) ? `situação: ${str(r.STATUS)}` : '')
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join(' · '));
    const HANDLED = /^(NOME_AGENTE|DOCUMENTO_AGENTE|CODIGO_AGENTE|NUMERO_CONTRATO|NUMERO_RESTRICAO|DATA_RESTRICAO|DATA_CONTRATO|ESTADO_RESTRICAO|ESTADO_CONTRATO|STATUS)$|CPF|DEVEDOR|PROPRIETARIO|ARRENDATARIO|FINANCIADO$/;
    const other = Object.entries(r).filter(([k, v]) => !HANDLED.test(k) && str(v) && !none(str(v))).map(([k, v]) => `${k.split('_').join(' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}: ${str(v).slice(0, 80)}`);
    if (!recs.length) {
      const intent = str(upper.INTENCAONOMEFINANC) || str(upper.INTENCAONOMEAGENTE);
      if (intent) other.push(`Intenção de troca de financiamento: ${intent}${str(upper.INTENCAODATAINCLUSAO) ? ` (${str(upper.INTENCAODATAINCLUSAO)})` : ''}`);
      if (str(upper.DATAVIGENCIACONTRATOFINANCEIRA)) other.push(`Vigência do contrato: ${str(upper.DATAVIGENCIACONTRATOFINANCEIRA)}`);
    }
    const ufGrav = str(r.ESTADO_RESTRICAO); const ufCont = str(r.ESTADO_CONTRATO);
    table.push([
      [bankName, doc ? `CNPJ ${doc}` : '', str(r.CODIGO_AGENTE) ? `Cód. agente ${str(r.CODIGO_AGENTE)}` : ''].filter(Boolean).join('\n') || '—',
      [str(r.NUMERO_CONTRATO) ? `Contrato nº ${str(r.NUMERO_CONTRATO)}` : '', start ? `Início ${brDate(start)}` : '', ufCont ? `UF do contrato ${ufCont}` : ''].filter(Boolean).join('\n') || 'Contrato não informado',
      [str(r.NUMERO_RESTRICAO) ? `Restrição nº ${str(r.NUMERO_RESTRICAO)}` : '', inc ? `Incluído em ${brDate(inc)} (${distance(inc, now).text})` : str(r.DATA_RESTRICAO), ufGrav ? `UF do gravame ${ufGrav}` : ''].filter(Boolean).join('\n') || '—',
      `${status}${done ? ' — HISTÓRICO' : ' — ATUAL'}`,
      other.join('\n') || '—'
    ]);
  });
  out.set('GR_DETALHES', lines.length ? { state: 'INFO', value: lines.join('\n'), display: lines.join('\n'), table: { columns: ['Quem financiou (agente financeiro)', 'Contrato', 'Gravame (registro, UF e data)', 'Situação', 'Outras informações'], rows: table } } : NOT_PROVIDED);

  const vig = parseDate(upper.DATAVIGENCIACONTRATOFINANCEIRA);
  if (vig) {
    const d = distance(vig, now);
    out.set('GR_PRAZO', info(d.future ? `Contrato vigente até ${brDate(vig)} (${d.text})` : `Vigência do contrato encerrada em ${brDate(vig)} (${d.text}); confirme a baixa do gravame com o banco`));
  } else out.set('GR_PRAZO', NOT_PROVIDED);

  if (hasData && activeCount > 0) out.set('GR_VALORES', info('As bases oficiais (Detran, Senatran e Credify) não informam saldo devedor, valor financiado, parcelas pagas ou a pagar. Para esses valores, peça ao vendedor o contrato e confirme a quitação com o banco acima.'));
  return out;
}

const SEIZURE = /BUSCA\s*(E|\/|-)?\s*APREENS/;
/** Percorre o retorno inteiro da fonte (inclusive o /gravame) atrás de texto de busca e apreensão. */
function seizureText(raw: unknown, depth = 0, seen = new Set<unknown>()): string | null {
  if (depth > 9 || raw == null) return null;
  if (typeof raw === 'string') return SEIZURE.test(fold(raw)) && !/^(SEM|NAO|NADA)\b|(SEM|NAO CONSTA|NAO HA|NAO POSSUI) BUSCA/.test(fold(raw)) ? raw.replace(/\s+/g, ' ').trim().slice(0, 240) : null;
  if (typeof raw !== 'object' || seen.has(raw)) return null;
  seen.add(raw);
  for (const v of Array.isArray(raw) ? raw : Object.values(raw as Rec)) { const f = seizureText(v, depth + 1, seen); if (f) return f; }
  return null;
}

/**
 * Busca e apreensão: a fonte não tem campo próprio; a ocorrência vem escrita nas restrições (judicial, financeira, outras) ou no gravame.
 * Procura esse texto no retorno. Sem texto e com restrições retornadas = nada consta; sem restrições retornadas = não informado.
 */
export function seizureExtra(upper: Rec, raw: unknown): VtValue {
  const found = seizureText(raw) ?? seizureText(upper);
  if (found) return { state: 'ALERT', value: found, display: `Consta: ${found}` };
  const g = isRec(raw) ? raw.gravame : undefined;
  const restrictionKeys = ['RESJUDICIAL', 'RESRENAJUD', 'RESADMINISTRATIVA', 'RESTRICAOFINAN', 'OUTRAS_RESTRICOES_01', 'OUTRAS_RESTRICOES_02', 'OUTRAS_RESTRICOES_03', 'OUTRAS_RESTRICOES_04'];
  const j = isRec(raw) ? raw.renajud : undefined;
  const provided = restrictionKeys.some((k) => str(upper[k]) !== '') || (isRec(g) && !g.unavailable && 'data' in g) || (isRec(j) && !j.unavailable && 'data' in j);
  if (provided) return { state: 'CLEAR', value: 'Nada consta', display: 'Nada consta nas restrições retornadas pela fonte' };
  return info('Não informado: a fonte não retornou restrições para esta consulta. Isso não equivale a “nada consta”.');
}
