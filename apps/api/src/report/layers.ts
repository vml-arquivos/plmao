/**
 * Completa em camadas: em vez de comprar o pacote Veículo Total, o sistema chama a consulta base e só as consultas que
 * o relatório precisa, e monta uma resposta no MESMO formato do Veículo Total (blocos + vetor de códigos). Assim todo o
 * relatório (telas, PDF, API, avisos de mudança) continua igual. Este módulo é puro: não chama a Credify nem lê variáveis.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const scalar = (v: unknown): string => (Array.isArray(v) ? scalar(v.find((x) => String(x ?? '').trim() !== '')) : v == null || isRec(v) ? '' : String(v).trim());
const upperKeys = (o: Rec): Rec => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), v]));

/** Ordem dos blocos no vetor CODIGO do Veículo Total. */
export const LAYER_ORDER = ['INDICIOSINISTROVEICULAR', 'RECALL', 'HISTORICOROUBOFURTO', 'LEILAOCONJUGADO', 'HISTORICOPROPRIETARIO', 'VEICULARBNACIONAL', 'PRECIFICADORFIPE', 'VEICULOSBDRP'] as const;
export type LayerBlock = (typeof LAYER_ORDER)[number];

/** Resultado de uma consulta avulsa: dados, "não encontrado" ou nada (falhou ou não foi chamada). */
export type Piece = { kind: 'data'; resposta: Rec } | { kind: 'notFound' } | { kind: 'none'; code?: string };

/** RESPOSTA do envelope guardado ({ placa, data: envelope }), com as chaves em maiúsculas. */
export function respostaOf(raw: unknown, depth = 0): Rec | null {
  if (!isRec(raw) || depth > 4) return null;
  for (const [k, v] of Object.entries(raw)) if (k.toUpperCase() === 'RESPOSTA' && isRec(v)) return upperKeys(v);
  for (const v of Object.values(raw)) { const f = respostaOf(v, depth + 1); if (f) return f; }
  return null;
}

/** Texto do marcador do cadastro (RETORNO do BDRP) para roubo/furto e recall. */
export function bdrpReturn(raw: unknown): Rec {
  const r = respostaOf(raw);
  const bdrp = r && isRec(r.VEICULOSBDRP) ? upperKeys(r.VEICULOSBDRP as Rec) : undefined;
  return bdrp && isRec(bdrp.RETORNO) ? upperKeys(bdrp.RETORNO as Rec) : {};
}

const CLEAR_TEXT = /^(NADA CONSTA|NAO CONSTA|NAO POSSUI|SEM |NAO HA|NAO EXISTE|NENHUM|NAO)/;

/** "Limpo" só quando o marcador diz com todas as letras que não há ocorrência. Vazio ou texto desconhecido = precisa consultar. */
export function flagIsClear(value: unknown): boolean {
  const t = fold(scalar(value));
  return t !== '' && CLEAR_TEXT.test(t);
}
export const flagText = (value: unknown): string => scalar(value);

/** Semáforo do Farol Leilão: 1 verde, 2 amarelo, 3 vermelho. Aceita REGISTRO_1 aninhado ou campos na raiz. */
export interface Farol { level: 'GREEN' | 'YELLOW' | 'RED'; parecer: 1 | 2 | 3; semaforo: string }
export function parseFarol(resposta: unknown): Farol | undefined {
  const find = (o: unknown, key: string, depth = 0): string => {
    if (!isRec(o) || depth > 5) return '';
    for (const [k, v] of Object.entries(o)) if (k.toUpperCase() === key && !isRec(v) && !Array.isArray(v)) return scalar(v);
    for (const v of Object.values(o)) { const f = find(v, key, depth + 1); if (f) return f; }
    return '';
  };
  const parecer = Number(find(resposta, 'PARECERTECNICO'));
  const sem = fold(find(resposta, 'SEMAFORO'));
  const byParecer = parecer === 1 ? 'GREEN' : parecer === 2 ? 'YELLOW' : parecer === 3 ? 'RED' : undefined;
  const bySem = /VERDE/.test(sem) ? 'GREEN' : /AMARELO/.test(sem) ? 'YELLOW' : /VERMELH/.test(sem) ? 'RED' : undefined;
  const level = byParecer ?? bySem;
  if (!level) return undefined;
  const p = (level === 'GREEN' ? 1 : level === 'YELLOW' ? 2 : 3) as 1 | 2 | 3;
  return { level, parecer: p, semaforo: level === 'GREEN' ? 'VERDE' : level === 'YELLOW' ? 'AMARELO' : 'VERMELHO' };
}
export const FAROL_TEXT: Record<Farol['level'], string> = { GREEN: 'parecer favorável, sem restrições', YELLOW: 'restrição discreta ou pequena', RED: 'restrições graves' };

/** RESPOSTA de uma consulta avulsa sem os campos de controle: vira o "bloco" do Veículo Total. */
function blockFrom(resposta: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(resposta)) if (!/^(CODIGO|MSG|MSG_ERRO)$/i.test(k)) out[k.toUpperCase()] = v;
  return out;
}

const NOT_PRESENTED: Partial<Record<LayerBlock, string>> = {
  LEILAOCONJUGADO: 'O VEICULO NAO FOI APRESENTADO NA BASE DE LEILAO.',
  HISTORICOROUBOFURTO: 'O VEICULO NAO FOI APRESENTADO NO HISTORICO DE ROUBO OU FURTO.',
  RECALL: 'NAO FOI POSSIVEL LOCALIZAR O VEICULO.'
};

export interface LayerInput {
  consulta?: unknown;
  /** Resposta da consulta base (Débitos, Restrições e Proprietários): precisa ter o VEICULOSBDRP. */
  baseRaw: unknown;
  sinistro: Piece;
  recall: Piece;
  /** O marcador do cadastro já bastou para roubo/furto e recall (nenhuma chamada extra). */
  recallFromFlag?: string;
  theft: Piece;
  theftFromFlag?: string;
  leilao: Piece;
  farol?: Farol;
  national: Piece;
  /** Histórico de proprietários (consulta própria da Credify); sem ela o bloco fica como "não consultado". */
  owners?: Piece;
  /** FIPE pela placa (consulta própria da Credify); sem ela o bloco fica como "não consultado". */
  fipe?: Piece;
  /** Proprietário pela placa (consulta própria da Credify): completa nome e documentos que a base não trouxe. */
  ownerPlate?: Piece;
  /** Infrações (RENAINF): multas detalhadas. Vai fora do vetor de blocos do Veículo Total. */
  renainf?: Piece;
}

/** A documentação mostra algumas consultas com os campos dentro de um bloco de mesmo nome (ex.: RESPOSTA.INDICIOSINISTROVEICULAR); outras vêm direto. Aceita as duas formas. */
function unwrap(name: LayerBlock, resposta: Rec): Rec {
  const inner = upperKeys(resposta)[name];
  return isRec(inner) ? upperKeys(inner) : resposta;
}

/** Peça → [código do bloco, bloco]. "Sem peça" vira código 3 (não consultado) e o bloco fica ausente. */
function slot(name: LayerBlock, piece: Piece, flag?: string): { code: string; block?: Rec } {
  if (flag !== undefined) return { code: '1', block: { DESCRICAORETORNO: flag } };
  if (piece.kind === 'data') {
    const resposta = unwrap(name, piece.resposta);
    return { code: '1', block: name === 'VEICULARBNACIONAL' ? nationalBlock(resposta) : blockFrom(resposta) };
  }
  if (piece.kind === 'notFound') return { code: '2', block: { DESCRICAORETORNO: NOT_PRESENTED[name] ?? 'DADO NAO ENCONTRADO' } };
  return { code: '3' };
}

/** A consulta de infrações pode vir direto ou dentro de RESPOSTA.RENAINF. */
function unwrapRenainf(resposta: Rec): Rec {
  const inner = upperKeys(resposta).RENAINF;
  return isRec(inner) ? { ...upperKeys(resposta), ...upperKeys(inner) } : resposta;
}
function renainfBlock(resposta: Rec): Rec { return blockFrom(resposta); }

/** A base nacional sai do bloco simples da consulta avulsa como REGISTRO_1, que é o formato do Veículo Total. */
function nationalBlock(resposta: Rec): Rec {
  const up = upperKeys(resposta);
  if (Object.keys(up).some((k) => /^REGISTRO_\d+$/.test(k))) return blockFrom(up);
  return { DESCRICAORETORNO: scalar(up.DESCRICAORETORNO) || 'SUCESSO', REGISTRO_1: blockFrom(up) };
}

const isZeroDoc = (v: string): boolean => !/[1-9]/.test(v.replace(/\D/g, ''));
/** Campo do proprietário na consulta base ← campo da consulta "Proprietário pela placa". */
const OWNER_PLATE_FIELDS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['PRONOME', 'NOME_PROPRIETARIO', false],
  ['CPF_CNPJ_PROPRIETARIO', 'NUMERO_DOCUMENTO_PROPRIETARIO', true],
  ['TIPODOCUMENTOPROPRIETARIO', 'TIPO_DOCUMENTO_PROPRIETARIO', false],
  ['CPFCNPJFATURADO', 'NUMERO_IDENTIFICACAO_FATURADO', true],
  ['TIPODOCUMENTOFATURADO', 'TIPO_DOCUMENTO_FATURADO', false]
];
/** Completa o cadastro da base com o proprietário pela placa, só onde a base veio vazia (ou com documento de zeros). Nunca troca um dado que a base trouxe. */
export function mergeOwnerPlate(bdrp: Rec, piece: Piece | undefined): Rec {
  if (!piece || piece.kind !== 'data' || !isRec(bdrp.RETORNO)) return bdrp;
  const up = upperKeys(piece.resposta);
  const src = isRec(up.VEICULOPROPRIETARIOPLACA) ? upperKeys(up.VEICULOPROPRIETARIOPLACA as Rec) : up;
  const retorno: Rec = { ...(bdrp.RETORNO as Rec) };
  for (const [target, from, isDoc] of OWNER_PLATE_FIELDS) {
    const incoming = scalar(src[from]);
    if (!incoming || (isDoc && isZeroDoc(incoming))) continue;
    const key = Object.keys(retorno).find((k) => k.toUpperCase() === target) ?? target;
    const current = scalar(retorno[key]);
    if (current && !(isDoc && isZeroDoc(current))) continue;
    retorno[key] = incoming;
  }
  return { ...bdrp, RETORNO: retorno };
}

/** Monta o envelope no formato do Veículo Total. Os blocos não comprados (proprietários, FIPE) ficam como "não consultado". */
export function buildLayeredEnvelope(input: LayerInput): Rec {
  const base = respostaOf(input.baseRaw);
  const bdrpBase = base && isRec(base.VEICULOSBDRP) ? (base.VEICULOSBDRP as Rec) : undefined;
  if (!bdrpBase) throw new Error('Consulta base sem VEICULOSBDRP');
  const bdrp = mergeOwnerPlate(bdrpBase, input.ownerPlate);
  const pieces: Record<LayerBlock, { code: string; block?: Rec }> = {
    INDICIOSINISTROVEICULAR: input.sinistro.kind === 'notFound' ? { code: '2' } : slot('INDICIOSINISTROVEICULAR', input.sinistro),
    RECALL: slot('RECALL', input.recall, input.recallFromFlag),
    HISTORICOROUBOFURTO: slot('HISTORICOROUBOFURTO', input.theft, input.theftFromFlag),
    LEILAOCONJUGADO: input.leilao.kind === 'none' ? { code: input.farol ? '2' : '3' } : slot('LEILAOCONJUGADO', input.leilao),
    HISTORICOPROPRIETARIO: input.owners && input.owners.kind !== 'none' ? slot('HISTORICOPROPRIETARIO', input.owners) : { code: '3' },
    VEICULARBNACIONAL: slot('VEICULARBNACIONAL', input.national),
    PRECIFICADORFIPE: input.fipe && input.fipe.kind !== 'none' ? slot('PRECIFICADORFIPE', input.fipe) : { code: '3' },
    VEICULOSBDRP: { code: '1', block: bdrp }
  };
  const resposta: Rec = { CODIGO: LAYER_ORDER.map((n) => pieces[n].code) };
  for (const n of LAYER_ORDER) if (pieces[n].block) resposta[n] = pieces[n].block;
  if (input.renainf?.kind === 'data') resposta.RENAINF = renainfBlock(unwrapRenainf(input.renainf.resposta));
  if (input.farol) resposta.FAROLLEILAO = { PARECERTECNICO: String(input.farol.parecer), SEMAFORO: input.farol.semaforo };
  const origem: Rec = {};
  if (input.theftFromFlag !== undefined) origem.ROUBOFURTO = 'CADASTRO';
  if (input.recallFromFlag !== undefined) origem.RECALL = 'CADASTRO';
  if (Object.keys(origem).length) resposta.ORIGEM = origem;
  return { CONSULTA: isRec(input.consulta) ? input.consulta : {}, RESPOSTA: resposta };
}

/** Controle de custo de uma consulta: custo de cada caminho e teto vêm das variáveis (nenhum valor no código). */
export class Spend {
  private spent = 0;
  private readonly calls: string[] = [];
  private readonly costs: Record<string, number> | undefined;
  constructor(private readonly budgetCents: number | undefined, costs: Record<string, number> | undefined) {
    this.costs = costs ? Object.fromEntries(Object.entries(costs).map(([k, v]) => [k.toLowerCase(), v])) : undefined;
  }
  private allowed: Set<string> | undefined;
  /** Cerca do contrato: com a lista definida, qualquer chamada fora dela é barrada antes de sair. */
  fence(paths: Iterable<string>): void { this.allowed = new Set([...paths].map((p) => p.toLowerCase())); }
  assertAllowed(path: string): void {
    if (this.allowed && !this.allowed.has(path.toLowerCase())) throw Object.assign(new Error('PRODUCT_CONTRACT_VIOLATION'), { code: 'PRODUCT_CONTRACT_VIOLATION', detail: path });
  }
  /** Chamadas essenciais sempre acontecem e contam para o teto das opcionais. */
  record(path: string): void { this.spent += this.costs?.[path.toLowerCase()] ?? 0; this.calls.push(path); }
  /** Opcional: sem teto (ou sem custo informado) libera; com teto, só libera se couber. */
  allow(path: string): boolean {
    if (this.budgetCents === undefined) return true;
    const cost = this.costs?.[path.toLowerCase()];
    if (cost === undefined) return true;
    return this.spent + cost <= this.budgetCents;
  }
  get paths(): readonly string[] { return this.calls; }
}
