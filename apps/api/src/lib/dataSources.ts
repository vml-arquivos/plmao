/**
 * Fontes de dados (APIs) que cada consulta pode usar. A escolha é por produto e fica em query_products.data_sources:
 *  - sem escolha (null): vale o comportamento padrão do sistema, igual ao de antes (nada muda para quem não mexer);
 *  - com escolha: o produto compra só as fontes marcadas (mais a base de cadastro, que identifica o veículo).
 * O que o cliente VÊ continua sendo definido por "Campos do relatório"; aqui se define o que é COMPRADO (custo).
 */
import { contractFor } from './productContract.js';

export type DataSourceKey = 'BASE' | 'SINISTRO' | 'NATIONAL' | 'THEFT' | 'RECALL' | 'AUCTION' | 'AUCTION_SIMPLE' | 'GRAVAME' | 'RENAJUD' | 'OWNERS' | 'OWNER_PLATE' | 'FIPE' | 'RENAINF' | 'TOTAL';

export interface DataSourceDef { key: DataSourceKey; label: string; description: string; provider: 'credify' | 'anycar' }

export const DATA_SOURCES: readonly DataSourceDef[] = [
  { key: 'SINISTRO', label: 'Indício de sinistro', description: 'Alerta de sinistro/perda total (Credify).', provider: 'credify' },
  { key: 'NATIONAL', label: 'Base nacional (cadastro online)', description: 'Dados cadastrais atualizados da base nacional (Credify).', provider: 'credify' },
  { key: 'THEFT', label: 'Roubo e furto', description: 'Só é buscado em detalhe quando o cadastro indica ocorrência (Credify).', provider: 'credify' },
  { key: 'RECALL', label: 'Recall', description: 'Só é buscado em detalhe quando o cadastro indica recall (Credify).', provider: 'credify' },
  { key: 'AUCTION', label: 'Leilão completo (Credify)', description: 'Leilão conjugado com Farol, mais caro; traz o detalhe de cada leilão.', provider: 'credify' },
  { key: 'AUCTION_SIMPLE', label: 'Leilão simples (AnyCar)', description: 'Só diz se o veículo passou por leilão: data, leiloeiro, lote, condição e valor. Mais barato.', provider: 'anycar' },
  { key: 'GRAVAME', label: 'Gravame completo', description: 'Banco, contrato e datas do financiamento; busca quando o cadastro indica alienação (Credify).', provider: 'credify' },
  { key: 'RENAJUD', label: 'Restrições judiciais (Renajud)', description: 'Busca quando o cadastro indica restrição judicial (Credify).', provider: 'credify' },
  { key: 'OWNERS', label: 'Histórico de proprietários', description: 'Quantidade e linha do tempo de proprietários (Credify). Consulta própria, cobrada sempre que o produto a usa.', provider: 'credify' },
  { key: 'OWNER_PLATE', label: 'Proprietário pela placa', description: 'Nome e CPF/CNPJ do proprietário atual pela placa (Credify). Consulta própria e barata, cobrada sempre que o produto a usa.', provider: 'credify' },
  { key: 'FIPE', label: 'FIPE pela placa', description: 'Código FIPE, preço e preço médio exatos pela placa (Credify). Consulta própria e barata.', provider: 'credify' },
  { key: 'RENAINF', label: 'Multas detalhadas (RENAINF)', description: 'Cada multa com descrição, vencimento e valor (Credify). Consulta própria, cobrada sempre que o produto a usa.', provider: 'credify' },
  { key: 'TOTAL', label: 'Pacote Veículo Total (Credify)', description: 'Uma compra só com todas as bases. Substitui as demais fontes.', provider: 'credify' }
];

/** BASE = só a base de cadastro, sem nenhuma fonte opcional (escolha explícita do painel). */
const KEYS = new Set<string>([...DATA_SOURCES.map((s) => s.key), 'BASE']);

/** Lê direto do ambiente para este módulo poder ser importado sem carregar toda a configuração. */
export const anycarConfigured = (): boolean => (process.env.ANYCAR_API_KEY ?? '').trim() !== '';

export type SourcesValidation = { ok: true; sources: DataSourceKey[] | null } | { ok: false; error: string };

/** Valida a lista vinda do painel. Lista vazia ou nula volta ao padrão do sistema. */
export function validateDataSources(input: unknown): SourcesValidation {
  if (input == null) return { ok: true, sources: null };
  if (!Array.isArray(input)) return { ok: false, error: 'DATA_SOURCES_INVALID' };
  const list: string[] = [...new Set(input.map((v) => String(v).toUpperCase().trim()))];
  if (!list.length) return { ok: true, sources: null };
  const unknown = list.find((k) => !KEYS.has(k));
  if (unknown) return { ok: false, error: `DATA_SOURCE_UNKNOWN:${unknown}` };
  if (list.includes('TOTAL')) return { ok: true, sources: ['TOTAL'] };
  if (list.length > 1 && list.includes('BASE')) list.splice(list.indexOf('BASE'), 1);
  if (list.includes('AUCTION') && list.includes('AUCTION_SIMPLE')) return { ok: false, error: 'DATA_SOURCES_AUCTION_CONFLICT' };
  if (list.includes('AUCTION_SIMPLE') && !anycarConfigured()) return { ok: false, error: 'DATA_SOURCE_ANYCAR_NOT_CONFIGURED' };
  return { ok: true, sources: list as DataSourceKey[] };
}

/** Fontes por produto, em memória (carregadas junto com o escopo do relatório). */
let bySource = new Map<string, DataSourceKey[] | null>();
export function setProductSources(next: Map<string, DataSourceKey[] | null>): void { bySource = next; }
/** null = padrão do sistema. */
export function sourcesForProduct(productId: string | null | undefined): DataSourceKey[] | null {
  // Produto de linha fixa: as APIs vêm do contrato (productContract.ts), nunca do que estiver guardado.
  const fixed = contractFor(productId);
  if (fixed) return fixed.sources ? ([...fixed.sources] as DataSourceKey[]) : null;
  return bySource.get(String(productId ?? '')) ?? null;
}
export function parseStoredSources(value: unknown): DataSourceKey[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const list = value.map((v) => String(v)).filter((k): k is DataSourceKey => KEYS.has(k));
  return list.length ? list : null;
}

/** Assinatura curta das fontes, para o cache por placa não misturar respostas de configurações diferentes. */
export function sourcesSignature(sources: readonly string[] | null | undefined): string {
  return sources && sources.length ? [...sources].sort().join('+') : '';
}

/** Campos do relatório que só existem quando a fonte correspondente é comprada. */
const SOURCE_FIELDS: Record<string, readonly string[]> = {
  SINISTRO: ['VT_SINISTRO'],
  NATIONAL: ['VN_RESTRICAO_1', 'VN_RESTRICAO_2', 'VN_RESTRICAO_3', 'VN_RESTRICAO_4', 'VN_DATA_LIMITE_RESTRICAO', 'VN_SITUACAO_CHASSI', 'VN_TIPO_MONTAGEM', 'VN_LUGARES', 'VN_ULTIMA_ATUALIZACAO', 'VN_IMPORTACAO', 'AL_ALTERACOES'],
  THEFT: ['VT_ROUBOFURTO', 'VT_ROUBOFURTO_DETALHES'],
  RECALL: ['VT_RECALL', 'VT_RECALL_DETALHES'],
  AUCTION: ['VT_LEILAO', 'VT_LEILAO_DETALHES', 'AU_LEILAO', 'AU_LEILAO_DETALHES', 'AN_SCORE_LEILAO', 'AN_DESVALORIZACAO', 'AN_CSV_INMETRO', 'AN_SEGURO'],
  AUCTION_SIMPLE: ['VT_LEILAO', 'VT_LEILAO_DETALHES', 'AU_LEILAO', 'AU_LEILAO_DETALHES', 'AN_SCORE_LEILAO', 'AN_DESVALORIZACAO', 'AN_CSV_INMETRO', 'AN_SEGURO'],
  GRAVAME: ['GR_DETALHES', 'GR_PRAZO', 'GR_VALORES'],
  RENAJUD: ['RJ_DETALHES'],
  OWNERS: ['VT_PROPRIETARIOS_QTD', 'VT_PROPRIETARIOS_HISTORICO'],
  FIPE: ['VT_FIPE_PRECO', 'VT_FIPE_PRECO_MEDIO', 'VT_FIPE_CODIGO', 'VT_FIPE_MODELO', 'VT_FIPE_VIGENCIA'],
  RENAINF: ['RN_MULTAS'],
  TOTAL: ['VT_SINISTRO', 'VT_ROUBOFURTO', 'VT_ROUBOFURTO_DETALHES', 'VT_LEILAO', 'VT_LEILAO_DETALHES', 'AN_SCORE_LEILAO', 'AN_DESVALORIZACAO', 'AN_CSV_INMETRO', 'AN_SEGURO', 'VT_RECALL', 'VT_RECALL_DETALHES', 'VT_PROPRIETARIOS_QTD', 'VT_PROPRIETARIOS_HISTORICO', 'VT_FIPE_PRECO', 'VT_FIPE_PRECO_MEDIO', 'VT_FIPE_CODIGO', 'VT_FIPE_MODELO', 'VT_FIPE_VIGENCIA']
};

/** Campos que ficam sem dado quando o produto não compra a fonte: servem para "ajustar o relatório às fontes". Sem escolha (padrão) devolve vazio. */
export function fieldsOutsideSources(selected: readonly string[] | null | undefined): string[] {
  if (!selected || !selected.length) return [];
  const keep = new Set(selected.flatMap((k) => SOURCE_FIELDS[k] ?? []));
  const all = new Set(Object.values(SOURCE_FIELDS).flat());
  return [...all].filter((f) => !keep.has(f));
}
