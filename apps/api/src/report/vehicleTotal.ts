/**
 * Consulta "Veículo Total" da Credify (POST /veiculototal).
 *
 * A resposta vem em blocos independentes (sinistro, recall, roubo/furto, leilão, proprietários, base nacional,
 * FIPE e VEICULOSBDRP) e RESPOSTA.CODIGO é um vetor posicional: 1 = com dados, 2 = sem dados, 3 = erro.
 * Este módulo:
 *  - decide se a resposta serve (ok), se a placa não existe (notFound) ou se veio inválida (cobrança estornada);
 *  - monta um "envelope plano" no formato que o normalizador já entende (RETORNO do VEICULOSBDRP, completado com a
 *    base nacional e a FIPE quando o BDRP deixa algum campo vazio);
 *  - extrai os campos extras do relatório sem nunca afirmar "sem ocorrência" quando a fonte não respondeu.
 */
import { maskDocument, maskName } from './mask.js';
import { brlFromCents, sentenceCase } from './format.js';

export const VT_BLOCKS = ['INDICIOSINISTROVEICULAR', 'RECALL', 'HISTORICOROUBOFURTO', 'LEILAOCONJUGADO', 'HISTORICOPROPRIETARIO', 'VEICULARBNACIONAL', 'PRECIFICADORFIPE', 'VEICULOSBDRP'] as const;
type BlockName = (typeof VT_BLOCKS)[number];
type Rec = Record<string, unknown>;

export interface VtValue { state: 'NOT_PROVIDED' | 'CLEAR' | 'ALERT' | 'INFO'; value: string | null; display?: string | null; masked?: boolean }

const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const str = (v: unknown): string => (Array.isArray(v) ? str(v.find((x) => String(x ?? '').trim() !== '')) : v == null || isRec(v) ? '' : String(v).trim());
const upperKeys = (o: Rec): Rec => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));

/** Localiza o objeto RESPOSTA no envelope (aceita o formato guardado { placa, data: envelope }). */
function findResposta(raw: unknown, depth = 0): Rec | null {
  if (!isRec(raw) || depth > 4) return null;
  for (const [k, v] of Object.entries(raw)) if (k.toUpperCase() === 'RESPOSTA' && isRec(v)) return upperKeys(v);
  for (const v of Object.values(raw)) { const found = findResposta(v, depth + 1); if (found) return found; }
  return null;
}

function findConsulta(raw: unknown, depth = 0): Rec | null {
  if (!isRec(raw) || depth > 4) return null;
  for (const [k, v] of Object.entries(raw)) if (k.toUpperCase() === 'CONSULTA' && isRec(v)) return v;
  for (const v of Object.values(raw)) { const found = findConsulta(v, depth + 1); if (found) return found; }
  return null;
}

export function isVehicleTotal(raw: unknown): boolean {
  const r = findResposta(raw);
  if (!r) return false;
  return Array.isArray(r.CODIGO) || VT_BLOCKS.some((b) => b !== 'VEICULOSBDRP' && b in r);
}

function codes(r: Rec): string[] | null { return Array.isArray(r.CODIGO) ? r.CODIGO.map((c) => String(c ?? '').trim()) : null; }
/** Código do bloco pela posição; só vale quando o vetor tem uma posição para cada bloco. */
function blockCode(r: Rec, name: BlockName): string | undefined {
  const arr = codes(r);
  return arr && arr.length === VT_BLOCKS.length ? arr[VT_BLOCKS.indexOf(name)] : undefined;
}
const block = (r: Rec, name: BlockName): Rec | undefined => (isRec(r[name]) ? upperKeys(r[name] as Rec) : undefined);
const records = (b: Rec | undefined): Rec[] => b ? Object.entries(b).filter(([k, v]) => /^REGISTRO_\d+$/.test(k) && isRec(v)).sort((a, c) => Number(a[0].slice(9)) - Number(c[0].slice(9))).map(([, v]) => upperKeys(v as Rec)) : [];

export interface VtOutcome { ok: boolean; notFound?: boolean; reason?: string }

/** ok = dá para montar o relatório; notFound = a placa não existe nas bases; senão a resposta é inválida (estorno). */
export function vehicleTotalOutcome(raw: unknown): VtOutcome {
  const r = findResposta(raw);
  if (!r) return { ok: false, reason: 'RESPOSTA ausente' };
  const arr = codes(r);
  if (arr && arr.length && arr.every((c) => c === '2')) return { ok: false, notFound: true, reason: 'CODIGO=2' };
  if (arr && arr.length && arr.every((c) => c === '3')) return { ok: false, reason: 'CODIGO=3' };
  const bdrp = block(r, 'VEICULOSBDRP');
  const bc = blockCode(r, 'VEICULOSBDRP');
  if (!bdrp && isRec(r.DADOS) && str((r.DADOS as Rec).MSG)) return { ok: false, notFound: true, reason: 'DADOS.MSG' };
  if (bc !== undefined && bc !== '1') {
    // sem BDRP e sem base nacional: a placa não existe; só um dos dois faltando é falha de fornecedor.
    return bc === '2' && blockCode(r, 'VEICULARBNACIONAL') === '2' ? { ok: false, notFound: true, reason: 'BDRP/VEICULAR=2' } : { ok: false, reason: `VEICULOSBDRP CODIGO=${bc}` };
  }
  const ret = bdrp && isRec(bdrp.RETORNO) ? upperKeys(bdrp.RETORNO as Rec) : undefined;
  if (!ret) return { ok: false, reason: 'VEICULOSBDRP ausente' };
  const desc = str(bdrp?.DESCRICAORETORNO);
  if (desc && fold(desc) !== 'SUCESSO') return { ok: false, reason: `DESCRICAORETORNO=${desc}` };
  const err = str(ret.EXISTE_ERRO);
  if (err && err !== '0') return { ok: false, reason: 'EXISTE_ERRO' };
  return { ok: true };
}

const nz = (v: unknown): string => { const s = str(v); return s === '0' ? '' : s; };

/** RETORNO do BDRP completado (só onde está vazio) com a base nacional e a FIPE. */
function mergedReturn(r: Rec): Rec {
  const bdrp = block(r, 'VEICULOSBDRP');
  const ret: Rec = bdrp && isRec(bdrp.RETORNO) ? { ...(bdrp.RETORNO as Rec) } : {};
  const have = (k: string) => Object.keys(ret).some((x) => x.toUpperCase() === k && str(ret[x]) !== '');
  const nat = records(block(r, 'VEICULARBNACIONAL'))[0] ?? {};
  const fipe = records(block(r, 'PRECIFICADORFIPE'))[0] ?? {};
  const fill = (k: string, v: unknown) => { const s = str(v); if (s && !have(k)) ret[k] = s; };
  fill('PLACA', nat.PLACA); fill('MARCA', nat.MARCA); fill('MODELO', nat.MODELO ?? fipe.MODELOFIPE);
  fill('MARCAMODELOCOMPLETO', nat.MODELO); fill('CHASSI', nat.CHASSI); fill('RENAVAM', nat.RENAVAM);
  fill('VEIANOFABR', nat.ANO_FABRICACAO); fill('VEIANOMODELO', nat.ANO_MODELO); fill('COR', nat.COR); fill('COMBUSTIVEL', nat.COMBUSTIVEL);
  fill('POTENCIA', nat.POTENCIA); fill('CILINDRADA', nat.CILINDRADA); fill('TIPO', nat.TIPO_VEICULO); fill('ESPECIE', nat.ESPECIE_VEICULO);
  fill('CARROCERIA', nat.CARROCERIA); fill('MUNICIPIO', nat.MUNICIPIO); fill('UF', nat.UF); fill('MOTOR', nat.NUMERO_MOTOR);
  fill('CAPACIDADEPASSAG', nat.QUANTIDADE_PASSAGEIRO); fill('CAPACIDADECARGA', nz(nat.CAPACIDADE_CARGA)); fill('PBT', nz(nat.PESO_BRUTO_TOTAL));
  fill('CMT', nz(nat.CAPACIDADE_MAXIMA_TRACAO)); fill('EIXOS', nz(nat.NUMERO_EIXO)); fill('VEIPROCEDENCIA', nat.NACIONALIDADE);
  fill('SITUACAOVEICULO', nat.SITUACAO_VEICULO); fill('NUMERO_CAIXACAMBIO', nat.NUMERO_CAIXA_CAMBIO);
  return ret;
}

/** Envelope plano: o que o normalizador de VEICULOSBDRP já entende (CODIGO escalar "1"). */
export function adaptVehicleTotal(raw: unknown): { flat: Rec } {
  const r = findResposta(raw) ?? {};
  const bdrp = block(r, 'VEICULOSBDRP');
  return { flat: { CONSULTA: findConsulta(raw) ?? {}, RESPOSTA: { CODIGO: '1', VEICULOSBDRP: { DESCRICAORETORNO: str(bdrp?.DESCRICAORETORNO) || 'SUCESSO', RETORNO: mergedReturn(r) } } } };
}

const NOT_PROVIDED: VtValue = { state: 'NOT_PROVIDED', value: null };
const MONTHS: Record<string, number> = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };
/** "15-MAR-15", "2015-03-15" ou "15/03/2015" → "15/03/2015". Formato desconhecido volta como veio. */
export function brDate(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2].toUpperCase()]) { const y = m[3].length === 2 ? (Number(m[3]) >= 50 ? 1900 : 2000) + Number(m[3]) : Number(m[3]); return `${m[1].padStart(2, '0')}/${String(MONTHS[m[2].toUpperCase()]).padStart(2, '0')}/${y}`; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
const textItem = (v: unknown, masked = false): VtValue => { const s = str(v); return s ? { state: 'INFO', value: s, display: s, ...(masked ? { masked } : {}) } : NOT_PROVIDED; };
const money = (v: unknown): number => {
  const s = str(v); if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

/**
 * Blocos "ocorrência" (roubo/furto, leilão, recall). Regra:
 *  código 3 ou bloco ausente → não informado; código 2 → a base não tem o veículo (roubo/leilão: nada consta);
 *  código 1 → há registro (alerta com o texto da fonte). Sem vetor de códigos, vale o texto.
 */
function occurrence(r: Rec, name: BlockName, clearText: string, noneMeansClear: boolean): VtValue {
  const b = block(r, name);
  if (!b) return NOT_PROVIDED;
  const c = blockCode(r, name);
  const desc = str(b.DESCRICAORETORNO);
  const f = fold(desc);
  if (c === '3') return NOT_PROVIDED;
  const saysNone = /NAO FOI APRESENTAD|NADA CONSTA|NAO CONSTA|NAO POSSUI|SEM RECALL|NAO HA /.test(f);
  const saysUnknown = /NAO FOI POSSIVEL|NAO LOCALIZAD|INDISPONIVEL|ERRO/.test(f);
  if (c === '2' || (c === undefined && saysNone)) return noneMeansClear ? { state: 'CLEAR', value: desc || clearText, display: clearText } : NOT_PROVIDED;
  if (c === undefined && (!desc || saysUnknown)) return NOT_PROVIDED;
  return { state: 'ALERT', value: desc || 'CONSTA', display: desc ? sentenceCase(desc) : 'Consta registro' };
}

const LABELS: Record<string, string> = { DATA: 'Data', DT: 'Data', LEILOEIRO: 'Leiloeiro', LOTE: 'Lote', COMITENTE: 'Comitente', STATUS: 'Situação', SITUACAO: 'Situação', UF: 'UF', MUNICIPIO: 'Município', CIDADE: 'Cidade', DESCRICAO: 'Descrição', CAMPANHA: 'Campanha', FABRICANTE: 'Fabricante', RISCO: 'Risco', REMEDIO: 'Solução', TIPO: 'Tipo', OBSERVACAO: 'Observação', BO: 'Boletim de ocorrência', BOLETIM: 'Boletim de ocorrência', DELEGACIA: 'Delegacia' };
const SKIP_DETAIL = /^(CODIGO|DESCRICAORETORNO|EXISTE_ERRO|MSG_ERRO|CHAVERETORNO|TEMPOEXECUCAO|REDUNDANCIA|STATUS_CONSULTA)$|CPF|CNPJ|CGC|DOCUMENTO|PROPRIETARIO|NOME_PROP|CHASSI|RENAVAM|MOTOR/;
const humanize = (key: string): string => { const base = key.split('_').filter(Boolean).map((w) => LABELS[w] ?? w.toLowerCase()).join(' '); return base.charAt(0).toUpperCase() + base.slice(1); };
/**
 * Texto com o que a fonte informou em cada registro de uma ocorrência (leilão, roubo/furto, recall). Os nomes dos campos
 * variam por fornecedor, então lista os campos simples de cada registro com o rótulo legível. Dados de pessoas ficam de fora.
 */
function occurrenceDetails(r: Rec, name: BlockName, main: VtValue): VtValue {
  if (main.state !== 'ALERT') return NOT_PROVIDED;
  const b = block(r, name);
  if (!b) return NOT_PROVIDED;
  const recs = records(b);
  const pool: Rec[] = recs.length ? recs : [b];
  const lines = pool.slice(0, 8).map((rec) => Object.entries(rec).filter(([k, v]) => !SKIP_DETAIL.test(k) && !isRec(v) && !Array.isArray(v) && str(v) !== '' && str(v) !== '0').slice(0, 14).map(([k, v]) => `${humanize(k)}: ${str(v).slice(0, 160)}`).join(' · ')).filter(Boolean);
  const text = lines.join(' | ').slice(0, 1200);
  return text ? { state: 'INFO', value: text, display: text } : NOT_PROVIDED;
}

/** Campos extras do relatório a partir dos blocos do Veículo Total. */
export function vehicleTotalExtras(raw: unknown): Map<string, VtValue> {
  const out = new Map<string, VtValue>();
  const r = findResposta(raw) ?? {};
  const nat = records(block(r, 'VEICULARBNACIONAL'))[0];
  out.set('VT_PLACA_MERCOSUL', textItem(nat?.PLACA_MODELO_NOVO));
  out.set('VT_EMPLACAMENTO', textItem(brDate(nat?.DATA_EMPLACAMENTO)));

  const sin = block(r, 'INDICIOSINISTROVEICULAR');
  const ind = str(sin?.INDICIODESINISTRO);
  out.set('VT_SINISTRO', !sin || blockCode(r, 'INDICIOSINISTROVEICULAR') === '3' || !ind
    ? NOT_PROVIDED
    : ind === '0' ? { state: 'CLEAR', value: 'SEM INDICIO', display: 'Sem indício de sinistro' } : { state: 'ALERT', value: str(sin.DESCRICAORETORNO) || 'INDICIO DE SINISTRO', display: 'Há indício de sinistro' });
  const theft = occurrence(r, 'HISTORICOROUBOFURTO', 'Não consta no histórico de roubo ou furto', true);
  const auction = occurrence(r, 'LEILAOCONJUGADO', 'Não consta em base de leilão', true);
  const recall = occurrence(r, 'RECALL', 'Sem recall pendente', false);
  out.set('VT_ROUBOFURTO', theft); out.set('VT_ROUBOFURTO_DETALHES', occurrenceDetails(r, 'HISTORICOROUBOFURTO', theft));
  out.set('VT_LEILAO', auction); out.set('VT_LEILAO_DETALHES', occurrenceDetails(r, 'LEILAOCONJUGADO', auction));
  out.set('VT_RECALL', recall); out.set('VT_RECALL_DETALHES', occurrenceDetails(r, 'RECALL', recall));

  const owners = blockCode(r, 'HISTORICOPROPRIETARIO') === '3' ? [] : records(block(r, 'HISTORICOPROPRIETARIO'));
  out.set('VT_PROPRIETARIOS_QTD', owners.length ? { state: 'INFO', value: String(owners.length), display: String(owners.length) } : NOT_PROVIDED);
  const line = (o: Rec) => `${str(o.ANO_EXERCICIO) || str(o.DATA_PROCESSAMENTO) || '—'}: ${maskName(str(o.NOME_PROPRIETARIO)) ?? '—'} (${maskDocument(str(o.CGC_CPF)) ?? '—'})`;
  out.set('VT_PROPRIETARIOS_LISTA', owners.length ? { state: 'INFO', value: owners.map(line).join(' · '), masked: true, display: owners.map(line).join(' · ') } : NOT_PROVIDED);

  const fb = block(r, 'PRECIFICADORFIPE');
  const fr = records(fb)[0];
  const fipeOk = Boolean(fr) && blockCode(r, 'PRECIFICADORFIPE') !== '3' && blockCode(r, 'PRECIFICADORFIPE') !== '2' && (!str(fr!.STATUS) || str(fr!.STATUS) === '1');
  const price = fipeOk ? money(fr!.PRECOFIPE) : 0;
  const avg = fipeOk ? money(fr!.PRECOMEDIO) : 0;
  out.set('VT_FIPE_PRECO', price ? { state: 'INFO', value: str(fr!.PRECOFIPE), display: brlFromCents(price) } : NOT_PROVIDED);
  out.set('VT_FIPE_PRECO_MEDIO', avg ? { state: 'INFO', value: str(fr!.PRECOMEDIO), display: brlFromCents(avg) } : NOT_PROVIDED);
  out.set('VT_FIPE_CODIGO', fipeOk ? textItem(fr!.CODIGOFIPE) : NOT_PROVIDED);
  out.set('VT_FIPE_MODELO', fipeOk ? textItem([str(fr!.FABRICANTEFIPE), str(fr!.MODELOFIPE)].filter(Boolean).join(' ')) : NOT_PROVIDED);
  out.set('VT_FIPE_VIGENCIA', fipeOk ? textItem(fr!.VIGENCIA) : NOT_PROVIDED);
  return out;
}
