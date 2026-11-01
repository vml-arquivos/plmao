import type { ReportTable, VtValue } from './vehicleTotal.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (v == null || isRec(v) || Array.isArray(v) ? '' : String(v).trim());
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const upperKeys = (o: Rec): Rec => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));

/** Campos que identificam o veículo (já estão no cabeçalho) ou pessoas: não entram na tabela de leilão. */
const SKIP = /^(CODIGO|DESCRICAORETORNO|EXISTE_ERRO|MSG_ERRO|CHAVERETORNO|TEMPOEXECUCAO|REDUNDANCIA|STATUS_CONSULTA|PLACA|CHASSI|RENAVAM|MOTOR|MARCA|MODELO|MARCAMODELO)$|CPF|CNPJ|CGC|DOCUMENTO|PROPRIETARIO|NOME_PROP/;
const COLUMNS: Array<[string, RegExp]> = [
  ['Data', /^(DATA|DT)(_?(DO_?)?LEILAO)?$|^(DATA|DT)_?(DO_?)?LEILAO/],
  ['Leilão', /^(ID_?LEILAO|NUMERO_?LEILAO|NR_?LEILAO|COD_?LEILAO|LEILAO_?ID|LEILAO|NOME_?LEILAO)$/],
  ['Lote', /LOTE/],
  ['Leiloeiro', /LEILOEIRO/],
  ['Comitente', /COMITENTE|VENDEDOR|ORIGEM/],
  ['Pátio / local', /PATIO|LOCAL|CIDADE|MUNICIPIO|^UF$/],
  ['Condição geral', /CONDICAO|AVARIA|CLASSIFICACAO|ESTADO/],
  ['Situação', /SITUACAO|STATUS/],
  ['Valor', /VALOR|LANCE/]
];
const humanize = (key: string): string => { const b = key.split('_').filter(Boolean).join(' ').toLowerCase(); return b.charAt(0).toUpperCase() + b.slice(1); };

/** Registros de leilão de um bloco (REGISTRO_n, lista de objetos ou o próprio bloco com campos simples). */
export function auctionRecords(block: unknown): Rec[] {
  if (!isRec(block)) return [];
  const b = upperKeys(block);
  const out: Rec[] = [];
  const take = (v: unknown, depth = 0): void => {
    if (depth > 3) return;
    if (Array.isArray(v)) { v.forEach((x) => take(x, depth + 1)); return; }
    if (!isRec(v)) return;
    const u = upperKeys(v);
    const hasNested = Object.values(u).some((x) => isRec(x) || (Array.isArray(x) && x.some(isRec)));
    if (hasNested) { Object.entries(u).forEach(([k, x]) => { if (!SKIP.test(k)) take(x, depth + 1); }); return; }
    out.push(u);
  };
  const named = Object.entries(b).filter(([k, v]) => /^REGISTRO(_?\d+)?$/.test(k) && (isRec(v) || Array.isArray(v)));
  if (named.length) named.sort((a, c) => (Number(a[0].replace(/\D/g, '')) || 0) - (Number(c[0].replace(/\D/g, '')) || 0)).forEach(([, v]) => take(v, 1));
  else take(b, 0);
  return out.filter((r) => Object.entries(r).some(([k, v]) => !SKIP.test(k) && str(v) !== '' && str(v) !== '0'));
}

const dateOut = (v: string): string => {
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};

/** Tabela dos leilões (data, leilão, lote, leiloeiro, comitente, pátio, condição…), com o que a fonte informou. */
export function auctionTable(recs: Rec[]): ReportTable | null {
  if (!recs.length) return null;
  const cols: Array<{ label: string; pick: (r: Rec) => string }> = [];
  const used = new Set<string>();
  for (const [label, re] of COLUMNS) {
    const keys = [...new Set(recs.flatMap((r) => Object.keys(r)))].filter((k) => !used.has(k) && !SKIP.test(k) && re.test(k) && recs.some((r) => str(r[k]) !== '' && str(r[k]) !== '0'));
    if (!keys.length) continue;
    keys.forEach((k) => used.add(k));
    cols.push({ label, pick: (r) => { const hit = keys.map((k) => str(r[k])).find((x) => x !== '' && x !== '0'); return hit ? (label === 'Data' ? dateOut(hit) : hit) : '—'; } });
  }
  const rest = [...new Set(recs.flatMap((r) => Object.keys(r)))].filter((k) => !used.has(k) && !SKIP.test(k) && recs.some((r) => str(r[k]) !== '' && str(r[k]) !== '0'));
  if (rest.length) cols.push({ label: 'Outras informações', pick: (r) => rest.map((k) => (str(r[k]) !== '' && str(r[k]) !== '0' ? `${humanize(k)}: ${str(r[k]).slice(0, 120)}` : '')).filter(Boolean).join(' · ') || '—' });
  if (!cols.length) return null;
  return { columns: cols.map((c) => c.label), rows: recs.slice(0, 20).map((r) => cols.map((c) => c.pick(r))) };
}

/** Bloco da resposta do /leilaoconjugado (ou LEILAOCONJUGADO do Veículo Total), chaves em maiúsculas. */
function leilaoBlock(data: unknown): Rec | null {
  const find = (o: unknown, depth = 0): Rec | null => {
    if (!isRec(o) || depth > 5) return null;
    for (const [k, v] of Object.entries(o)) if (/^LEILAO(CONJUGADO)?$/i.test(k) && isRec(v)) return upperKeys(v);
    for (const v of Object.values(o)) { const f = find(v, depth + 1); if (f) return f; }
    return null;
  };
  const named = find(data);
  if (named) return named;
  const resposta = (() => {
    const f = (o: unknown, depth = 0): Rec | null => {
      if (!isRec(o) || depth > 4) return null;
      for (const [k, v] of Object.entries(o)) if (k.toUpperCase() === 'RESPOSTA' && isRec(v)) return upperKeys(v);
      for (const v of Object.values(o)) { const x = f(v, depth + 1); if (x) return x; }
      return null;
    };
    return f(data);
  })();
  return resposta;
}

const NONE_TEXT = /NAO FOI APRESENTAD|NADA CONSTA|NAO CONSTA|NAO POSSUI|NAO HA |SEM REGISTRO/;
const UNKNOWN_TEXT = /NAO FOI POSSIVEL|INDISPONIVEL|ERRO/;

/**
 * Leilão a partir da consulta /leilaoconjugado (448). Vale só quando a resposta existe:
 * "veículo não apresentado" ou placa sem registro → nada consta; registros → alerta com a tabela; fonte fora do ar → não informado.
 */
export function leilaoExtras(raw: unknown): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const l = isRec(raw) ? raw.leilao : undefined;
  if (!isRec(l) || l.unavailable) return out;
  if (l.notFound === true) {
    out.set('AU_LEILAO', { state: 'CLEAR', value: 'NAO CONSTA', display: 'Não consta em base de leilão' });
    return out;
  }
  if (!('data' in l)) return out;
  const b = leilaoBlock(l.data);
  const desc = fold(str(b?.DESCRICAORETORNO));
  const recs = auctionRecords(b ?? undefined);
  if (recs.length) {
    out.set('AU_LEILAO', { state: 'ALERT', value: str(b?.DESCRICAORETORNO) || 'CONSTA REGISTRO DE LEILAO', display: recs.length === 1 ? 'Consta 1 registro de leilão' : `Constam ${recs.length} registros de leilão` });
    const table = auctionTable(recs);
    if (table) out.set('AU_LEILAO_DETALHES', { state: 'INFO', value: `${recs.length} ${recs.length === 1 ? 'registro' : 'registros'} de leilão`, display: `${recs.length} ${recs.length === 1 ? 'registro' : 'registros'} de leilão`, table });
    return out;
  }
  if (NONE_TEXT.test(desc)) out.set('AU_LEILAO', { state: 'CLEAR', value: str(b?.DESCRICAORETORNO), display: 'Não consta em base de leilão' });
  else if (desc && !UNKNOWN_TEXT.test(desc) && desc !== 'SUCESSO') out.set('AU_LEILAO', { state: 'ALERT', value: str(b?.DESCRICAORETORNO), display: str(b?.DESCRICAORETORNO) });
  return out;
}
