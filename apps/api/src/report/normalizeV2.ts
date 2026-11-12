/**
 * Normalizador v2 do retorno VEICULOSBDRP.
 *
 * Princípios:
 *  - campo vazio (`[]`, "", null) = NOT_PROVIDED: o provedor não entregou; nunca exibimos como "sem ocorrência";
 *  - campos de pessoas (nome/CPF/CNPJ) saem mascarados; o JSON bruto fica criptografado em outra coluna;
 *  - multas por órgão são COMPONENTES do total de multas (nunca somadas em dobro);
 *  - o veredito só é "sem alertas" se as restrições foram de fato retornadas.
 */
import { CATALOG_BY_KEY, ENRICH_CATALOG, FIELD_CATALOG, SECTIONS, VT_CATALOG, type FieldDef, type SectionKey, type Tier } from './catalog.js';
import { enrichmentExtras, readFipeMatch } from './enrichmentExtras.js';
import { applyLien, gravameExtras, seizureExtra } from './gravame.js';
import { leilaoExtras } from './leilao.js';
import { leilaoAnalyses } from './analiseLeilao.js';
import { applyJudicial, judicialExtras } from './judicial.js';
import { adaptVehicleTotal, isVehicleTotal, vehicleTotalExtras, vehicleTotalOutcome, type ReportTable } from './vehicleTotal.js';
import { formatDocument, ownerIdentityEnabled } from './mask.js';
import { brlFromCents, sentenceCase } from './format.js';
import { buildAdvice, type ReportAdvice } from './advice.js';
import { readSheet, type VehicleSheet } from '../enrichment/sheet.js';

export const NORMALIZER_VERSION = 3;
export const REPORT_SCHEMA = 'placanamao.vehicle.report.v2';

export type ItemState = 'NOT_PROVIDED' | 'CLEAR' | 'ALERT' | 'INFO';
export type Verdict = 'CLEAR' | 'ATTENTION' | 'HIGH_RISK' | 'INCONCLUSIVE';

export interface ReportItem {
  key: string;
  label: string;
  kind: FieldDef['kind'];
  state: ItemState;
  /** valor pronto para exibição (já mascarado quando sensível); null quando NOT_PROVIDED */
  value: string | null;
  /** texto pronto para leitura humana (ex.: "Nada consta", "R$ 293,47") */
  display?: string | null;
  amountCents?: number;
  masked?: boolean;
  /** quando o item é uma lista de registros (gravames, leilões, restrições judiciais): colunas e linhas */
  table?: ReportTable;
  sensitivity: FieldDef['sensitivity'];
  tier: Tier;
  /** componente de outro total (ex.: multa por órgão): exibido, mas não somado */
  component?: boolean;
  high?: boolean;
}

export interface ReportSection {
  key: SectionKey;
  label: string;
  description: string;
  status: ItemState;
  items: ReportItem[];
  providedCount: number;
  notProvidedCount: number;
}

export interface ReportV2 {
  schema: typeof REPORT_SCHEMA;
  normalizerVersion: number;
  plate: string;
  headline: { brand?: string; model?: string; fullModel?: string; manufactureYear?: string; modelYear?: string; color?: string; fuel?: string; city?: string; state?: string; status?: string };
  verdict: { level: Verdict; title: string; reason: string; alerts: Array<{ key: string; label: string; value: string; high: boolean }> };
  debts: { totalCents: number; hasDebt: boolean; items: Array<{ key: string; label: string; amountCents: number }>; fineBreakdown: Array<{ key: string; label: string; amountCents: number }>; note: string };
  sections: ReportSection[];
  coverage: { provided: number; total: number; notProvidedKeys: string[]; restrictionsProvided: boolean; debtsProvided: boolean };
  unknownFieldCount: number;
  /** preenchido por viewReport: quantos alertas existem fora do plano contratado */
  lockedAlertCount?: number;
  debtsHidden?: boolean;
  /** preenchido por viewReport: o que o produto contratado cobre. "Fora do produto" é diferente de "não retornado pela fonte". */
  scope?: { mode: 'TEMPLATE' | 'SECTIONS' | 'TIER'; templateVersion?: number; notIncluded: Array<{ key: string; label: string }> };
  /** preenchido por viewReport: parecer de revenda/seguro e checklist "Antes de pagar", só com o que o pacote consultou */
  advice?: ReportAdvice;
  /** ficha gratuita (decodificador de chassi, tabela FIPE, financiamento, ficha técnica do guia); presente nas consultas que a incluem */
  sheet?: VehicleSheet;
}

const FINE_COMPONENTS = new Set(['DEBDETRAN', 'DEBDER', 'DEBDERSA', 'DEBPOLRODFED', 'DEBRENAINF']);
const FINE_TOTAL = 'VALORTOTALDEBITOMULTA';
/** débitos "em dinheiro" que compõem o total (multas entram pelo total, não pelos componentes). */
const DEBT_SUMMANDS: Array<[string, string]> = [
  ['EXISTEDEBITODEIPVA', 'DEBIPVA'],
  ['EXISTEDEBITODELICENCIAMENTO', 'EXISTEDEBITODELICENCIAMENTOVL'],
  ['EXISTEDEBITODEDPVAT', 'DPVAT'],
  ['EXISTEDEBITOMULTA', FINE_TOTAL],
  ['DEBMUNICIPAIS', 'DEBMUNICIPAIS'],
  ['DEBCETESB', 'DEBCETESB']
];

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const DEFAULT_CLEAR = /^(NADA CONSTA|NAO CONSTA|NAO POSSUI|NAO EXISTE|NAO HA|NAO TEM|SEM (?!INFORMA)|INEXISTENTE|REGULAR$)|VEICULAR OK$|^OK$|^NORMAL$/;
const SITUATION_ALERT = /BAIXAD|ROUBO|FURTO|SINISTRO|BLOQUEAD|APREENDID|LEILAO|INATIV|DESMONT/;

export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return String(value).trim() === '';
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) return scalar(value.find((v) => !isEmptyValue(v)));
  return value == null ? '' : String(value).trim();
}

export function parseCents(value: unknown): number {
  const s = scalar(value);
  if (!s) return 0;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

const MONEY_RE = /^\d{1,3}(\.\d{3})*,\d{2}$|^\d+(,\d{1,2})?$|^\d+\.\d{2}$/;

/** Localiza o objeto RETORNO no envelope do provedor (ou o próprio objeto, se já for plano). */
export function extractReturn(rawInput: unknown): Record<string, unknown> | null {
  // Veículo Total: o RETORNO é o do BDRP completado com a base nacional e a FIPE.
  const raw = isVehicleTotal(rawInput) ? adaptVehicleTotal(rawInput).flat : rawInput;
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value) || depth > 6) return null;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (k.toUpperCase() === 'RETORNO' && v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    }
    if ('PLACA' in obj && 'MARCA' in obj) return obj;
    for (const v of Object.values(obj)) { const found = visit(v, depth + 1); if (found) return found; }
    return null;
  };
  return visit(raw, 0);
}

function findScalar(raw: unknown, wanted: string, depth = 0, seen = new Set<unknown>()): string | undefined {
  if (!raw || typeof raw !== 'object' || seen.has(raw) || depth > 6) return undefined;
  seen.add(raw);
  if (!Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k.toUpperCase() === wanted && (typeof v === 'string' || typeof v === 'number')) return String(v);
    }
  }
  for (const v of Array.isArray(raw) ? raw : Object.values(raw as object)) {
    const found = findScalar(v, wanted, depth + 1, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Sucesso do provedor: CODIGO=="1" && DESCRICAORETORNO=="SUCESSO" && EXISTE_ERRO=="0". Campos ausentes não reprovam. */
export function providerOutcome(raw: unknown): { ok: boolean; reason?: string; notFound?: boolean } {
  if (isVehicleTotal(raw)) return vehicleTotalOutcome(raw);
  const code = findScalar(raw, 'CODIGO');
  // Credify: 1 = dados, 2 = nada encontrado (não é falha técnica), 3 = erro.
  if (code !== undefined && code.trim() === '2') return { ok: false, notFound: true, reason: 'CODIGO=2' };
  if (code !== undefined && code.trim() !== '1') return { ok: false, reason: `CODIGO=${code}` };
  const desc = findScalar(raw, 'DESCRICAORETORNO');
  if (desc !== undefined && fold(desc) !== 'SUCESSO') return { ok: false, reason: `DESCRICAORETORNO=${desc}` };
  const err = findScalar(raw, 'EXISTE_ERRO');
  if (err !== undefined && err.trim() !== '0') return { ok: false, reason: 'EXISTE_ERRO' };
  return { ok: true };
}

function buildItem(def: FieldDef, rawValue: unknown): ReportItem {
  const base: ReportItem = { key: def.key, label: def.label, kind: def.kind, state: 'NOT_PROVIDED', value: null, sensitivity: def.sensitivity, tier: def.tier, high: def.high };
  if (isEmptyValue(rawValue)) return base;
  const text = scalar(rawValue);
  if (!text) return base;

  // Documento só de zeros (000.000.000-00) é o jeito da fonte dizer que não informou: não mostra como se fosse um número real.
  if (def.doc === 'CPF_CNPJ' && !/[1-9]/.test(text.replace(/\D/g, ''))) return base;
  if (def.doc === 'CPF_CNPJ') { const v = formatDocument(text); return { ...base, state: 'INFO', value: v, display: v }; }
  // A fonte às vezes entrega o documento colado antes do nome ("12345678900 JOAO SILVA"): o documento já tem campo próprio.
  if (def.doc === 'NAME') { const v = text.replace(/\s+/g, ' ').trim().replace(/^(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\s+(?=\D)/, ''); return { ...base, state: 'INFO', value: v, display: v }; }

  const folded = fold(text);
  switch (def.kind) {
    case 'money': {
      const amountCents = MONEY_RE.test(text) ? parseCents(text) : 0;
      const component = FINE_COMPONENTS.has(def.key);
      return { ...base, state: amountCents > 0 ? 'ALERT' : 'CLEAR', value: MONEY_RE.test(text) ? text : null, display: MONEY_RE.test(text) ? brlFromCents(amountCents) : null, amountCents, component };
    }
    case 'flag': {
      const clear = DEFAULT_CLEAR.test(folded) || Boolean(def.clear?.test(folded));
      return { ...base, state: clear ? 'CLEAR' : 'ALERT', value: text, display: sentenceCase(text) };
    }
    case 'status':
      return { ...base, state: SITUATION_ALERT.test(folded) ? 'ALERT' : 'INFO', value: text, display: sentenceCase(text), high: SITUATION_ALERT.test(folded) || undefined };
    default:
      return { ...base, state: 'INFO', value: text, display: text };
  }
}

const sectionStatus = (items: ReportItem[]): ItemState => {
  const provided = items.filter((i) => i.state !== 'NOT_PROVIDED');
  if (!provided.length) return 'NOT_PROVIDED';
  if (provided.some((i) => i.state === 'ALERT')) return 'ALERT';
  if (provided.some((i) => i.state === 'CLEAR')) return 'CLEAR';
  return 'INFO';
};

export function buildReportV2(raw: unknown): ReportV2 {
  const vt = isVehicleTotal(raw);
  const ret = extractReturn(raw);
  if (!ret) throw new Error('Resposta do provedor inválida');
  const outcome = providerOutcome(raw);
  if (!outcome.ok) throw new Error(`Resposta do provedor inválida (${outcome.reason})`);

  const upper: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ret)) upper[k.toUpperCase()] = v;
  // alias tolerados do provedor
  if (isEmptyValue(upper.VEIANOFABR)) upper.VEIANOFABR = upper.VEIANOFAB ?? upper.ANOFABRICACAO;
  if (isEmptyValue(upper.NUMERO_CAIXACAMBIO)) upper.NUMERO_CAIXACAMBIO = upper.NUMEROCAIXACAMBIO;

  // Complemento do /gravame (quando a base de gravame do Veículo Total veio vazia): preenche banco, CNPJ, contrato e datas.
  applyLien(upper, raw);
  // Complemento do /renajud (restrição judicial com tribunal, processo e data), só quando a consulta o trouxe.
  applyJudicial(upper, raw);

  const plate = scalar(upper.PLACA).toUpperCase();
  if (!plate) throw new Error('Resposta do provedor inválida');
  if (!scalar(upper.MARCA) && !scalar(upper.MODELO) && !scalar(upper.MARCAMODELOCOMPLETO)) throw new Error('Resposta do provedor inválida');

  const items = new Map<string, ReportItem>();
  for (const def of FIELD_CATALOG) items.set(def.key, buildItem(def, upper[def.key]));
  // Veículo Total: campos extras (sinistro, roubo/furto, leilão, recall, proprietários, FIPE).
  let defs: FieldDef[] = vt ? [...FIELD_CATALOG, ...VT_CATALOG, ...ENRICH_CATALOG] : [...FIELD_CATALOG, ...ENRICH_CATALOG];
  if (vt) {
    const extras = vehicleTotalExtras(raw);
    for (const def of VT_CATALOG) {
      const x = extras.get(def.key) ?? { state: 'NOT_PROVIDED' as const, value: null };
      items.set(def.key, { key: def.key, label: def.label, kind: def.kind, state: x.state, value: x.value, display: x.display ?? x.value, ...(x.masked ? { masked: true } : {}), ...(x.table ? { table: x.table } : {}), sensitivity: def.sensitivity, tier: def.tier, high: def.high && x.state === 'ALERT' ? true : undefined });
    }
  }
  // FIPE localizada pelo cadastro (modelo, ano e cilindrada) quando o provedor não trouxe o valor: preenche só o que está vazio.
  const fm = readFipeMatch(raw);
  if (vt && fm) {
    const fill = (key: string, value: string, display: string) => { const cur = items.get(key); if (cur && cur.state === 'NOT_PROVIDED') items.set(key, { ...cur, state: 'INFO', value, display }); };
    fill('VT_FIPE_PRECO', (fm.valueCents / 100).toFixed(2).replace('.', ','), brlFromCents(fm.valueCents));
    fill('VT_FIPE_CODIGO', fm.fipeCode, fm.fipeCode);
    fill('VT_FIPE_MODELO', `${fm.brand} ${fm.model}`, `${fm.brand} ${fm.model} (${fm.year}) — localizado pelo modelo, ano e motor; confira a versão`);
    fill('VT_FIPE_VIGENCIA', fm.referenceMonth, fm.referenceMonth);
  }
  // Análises do sistema (chassi, quilometragem de referência, histórico e projeção da FIPE).
  const enr = enrichmentExtras(upper, raw);
  for (const [k, v] of gravameExtras(upper, raw)) enr.set(k, v);
  for (const [k, v] of judicialExtras(raw)) enr.set(k, v);
  for (const [k, v] of leilaoExtras(raw)) enr.set(k, v);
  {
    // Análises de leilão: usam o leilão (do pacote Veículo Total ou da consulta de leilão) e o indício de sinistro já lidos.
    const au = enr.get('AU_LEILAO') ?? (items.get('VT_LEILAO')?.state !== 'NOT_PROVIDED' ? items.get('VT_LEILAO') : undefined);
    const det = enr.get('AU_LEILAO_DETALHES')?.table ? enr.get('AU_LEILAO_DETALHES') : items.get('VT_LEILAO_DETALHES');
    for (const [k, v] of leilaoAnalyses(au ? { state: au.state, ...(det?.table ? { table: det.table } : {}) } : undefined, items.get('VT_SINISTRO'))) enr.set(k, v);
  }
  enr.set('RES_BUSCA_APREENSAO', seizureExtra(upper, raw));
  for (const def of ENRICH_CATALOG) {
    const x = enr.get(def.key) ?? { state: 'NOT_PROVIDED' as const, value: null };
    items.set(def.key, { key: def.key, label: def.label, kind: def.kind, state: x.state, value: x.value, display: x.display ?? x.value, ...(x.table ? { table: x.table } : {}), sensitivity: def.sensitivity, tier: def.tier, high: def.high && x.state === 'ALERT' ? true : undefined });
  }
  // Medidas zeradas (eixos, carga, CMT, PBT em carro de passeio) não informam nada: tratadas como ausentes.
  for (const k of ['EIXOS', 'CAPACIDADECARGA', 'CMT', 'PBT']) { const it = items.get(k); if (it && it.state !== 'NOT_PROVIDED' && /^0+([.,]0+)?$/.test(String(it.value ?? '').trim())) items.set(k, { ...it, state: 'NOT_PROVIDED', value: null, display: null }); }
  // Detalhes opcionais (leilão, roubo/furto, recall, análises) só existem quando há dado ou como calcular.
  { const gone = defs.filter((d) => d.optional && items.get(d.key)?.state === 'NOT_PROVIDED'); for (const d of gone) items.delete(d.key); defs = defs.filter((d) => !gone.includes(d)); }
  const unknownFieldCount = Object.keys(upper).filter((k) => !CATALOG_BY_KEY.has(k)).length;

  // Débitos: multas pelo total (fallback soma dos componentes); nunca soma componente + total.
  const amount = (key: string) => items.get(key)?.amountCents ?? 0;
  const fineComponents = [...FINE_COMPONENTS].map((k) => items.get(k)!).filter((i) => i.state !== 'NOT_PROVIDED');
  const fineSum = fineComponents.reduce((acc, i) => acc + (i.amountCents ?? 0), 0);
  const fineTotalItem = items.get(FINE_TOTAL)!;
  const fineTotal = fineTotalItem.state !== 'NOT_PROVIDED' && amount(FINE_TOTAL) > 0 ? amount(FINE_TOTAL) : fineSum;
  if (fineTotalItem.state === 'NOT_PROVIDED' && fineSum > 0) {
    fineTotalItem.state = 'ALERT'; fineTotalItem.amountCents = fineSum; fineTotalItem.value = (fineSum / 100).toFixed(2).replace('.', ',');
  }
  const debtItems: Array<{ key: string; label: string; amountCents: number }> = [];
  for (const [flagKey, valueKey] of DEBT_SUMMANDS) {
    const cents = valueKey === FINE_TOTAL ? fineTotal : amount(valueKey);
    if (cents > 0) debtItems.push({ key: valueKey, label: valueKey === FINE_TOTAL ? 'Multas' : (items.get(flagKey)?.label ?? valueKey), amountCents: cents });
  }
  const totalCents = debtItems.reduce((acc, i) => acc + i.amountCents, 0);
  const debtsProvided = DEBT_SUMMANDS.some(([f, v]) => items.get(f)!.state !== 'NOT_PROVIDED' || items.get(v)!.state !== 'NOT_PROVIDED');
  // Se a flag diz que existe débito mas não veio valor, ainda é alerta (valor não informado).
  const flaggedWithoutValue = DEBT_SUMMANDS.filter(([f, v]) => items.get(f)!.kind === 'flag' && items.get(f)!.state === 'ALERT' && !debtItems.some((d) => d.key === v));

  const sections: ReportSection[] = SECTIONS.map((s) => {
    const list = defs.filter((d) => d.section === s.key).map((d) => items.get(d.key)!);
    const providedCount = list.filter((i) => i.state !== 'NOT_PROVIDED').length;
    return { key: s.key, label: s.label, description: s.description, status: sectionStatus(list), items: list, providedCount, notProvidedCount: list.length - providedCount };
  }).filter((s) => s.items.length > 0);

  const restrictionItems = [...items.values()].filter((i) => CATALOG_BY_KEY.get(i.key)!.section === 'RESTRICOES' || CATALOG_BY_KEY.get(i.key)!.section === 'GRAVAME');
  const restrictionFlags = restrictionItems.filter((i) => i.kind === 'flag' && i.state !== 'NOT_PROVIDED' && i.key !== 'RES_BUSCA_APREENSAO' && !i.key.startsWith('VN_') && i.key !== 'RJ_DETALHES');
  const restrictionsProvided = restrictionFlags.length > 0;

  const alertItems = [...items.values()].filter((i) => i.state === 'ALERT' && !i.component && CATALOG_BY_KEY.get(i.key)!.section !== 'INTERNO' && (i.kind === 'flag' || i.kind === 'status') );
  const highAlerts = alertItems.filter((i) => i.high);
  const alerts = alertItems.map((i) => ({ key: i.key, label: i.label, value: i.value ?? '', high: Boolean(i.high) }));

  let verdict: ReportV2['verdict'];
  if (highAlerts.length) {
    verdict = { level: 'HIGH_RISK', title: 'Atenção necessária', reason: `Foram identificadas ocorrências em ${highAlerts.slice(0, 3).map((i) => i.label.toLowerCase()).join(', ')}. Analise os detalhes antes de seguir.`, alerts };
  } else if (alertItems.length || totalCents > 0 || flaggedWithoutValue.length) {
    const parts: string[] = [];
    if (totalCents > 0 || flaggedWithoutValue.length) parts.push('há débitos a regularizar');
    const other = alertItems.filter((i) => !DEBT_SUMMANDS.some(([f]) => f === i.key));
    if (other.length) parts.push(`ocorrências em ${other.slice(0, 3).map((i) => i.label.toLowerCase()).join(', ')}`);
    verdict = { level: 'ATTENTION', title: 'Pontos de atenção', reason: `Foram encontrados pontos de atenção: ${parts.join(' e ')}.`, alerts };
  } else if (!restrictionsProvided && !debtsProvided) {
    verdict = { level: 'INCONCLUSIVE', title: 'Análise limitada', reason: 'O provedor não retornou débitos nem restrições para esta consulta; não é possível afirmar que o veículo esteja regular.', alerts };
  } else if (!restrictionsProvided) {
    verdict = { level: 'INCONCLUSIVE', title: 'Análise parcial', reason: 'Restrições não foram retornadas pelo provedor nesta consulta; a análise cobre apenas os dados disponíveis.', alerts };
  } else {
    verdict = { level: 'CLEAR', title: 'Sem alertas relevantes', reason: 'Não foram identificadas ocorrências relevantes nos dados retornados pelo provedor nesta consulta.', alerts };
  }

  const v = (key: string) => (items.get(key)!.state !== 'NOT_PROVIDED' ? items.get(key)!.value ?? undefined : undefined);
  const visibleKeys = defs.filter((d) => d.sensitivity !== 'INTERNAL');
  const notProvidedKeys = visibleKeys.filter((d) => items.get(d.key)!.state === 'NOT_PROVIDED').map((d) => d.key);

  return dedupeMunicipalDebt({
    schema: REPORT_SCHEMA,
    normalizerVersion: NORMALIZER_VERSION,
    plate,
    headline: {
      brand: v('MARCA'), model: v('MODELO'), fullModel: v('MARCAMODELOCOMPLETO'),
      manufactureYear: v('VEIANOFABR'), modelYear: v('VEIANOMODELO'), color: v('COR'), fuel: v('COMBUSTIVEL'),
      city: v('MUNICIPIO'), state: v('UF'), status: v('SITUACAOVEICULO')
    },
    verdict,
    debts: {
      totalCents,
      hasDebt: totalCents > 0 || flaggedWithoutValue.length > 0,
      items: debtItems,
      fineBreakdown: fineComponents.filter((i) => (i.amountCents ?? 0) > 0).map((i) => ({ key: i.key, label: i.label, amountCents: i.amountCents ?? 0 })),
      note: 'Multas por órgão detalham o total de multas e não são somadas novamente.'
    },
    sections,
    coverage: { provided: visibleKeys.length - notProvidedKeys.length, total: visibleKeys.length, notProvidedKeys, restrictionsProvided, debtsProvided },
    unknownFieldCount,
    ...(readSheet((raw as { enrichment?: { sheet?: unknown } } | null)?.enrichment?.sheet) ? { sheet: readSheet((raw as { enrichment?: { sheet?: unknown } }).enrichment?.sheet) } : {})
  });
}


/**
 * Débito municipal que repete o valor das multas (a fonte devolve o mesmo montante nos dois campos): conta uma vez só.
 * Idempotente; roda ao montar o relatório e também ao exibir relatórios já salvos.
 */
export function dedupeMunicipalDebt(report: ReportV2): ReportV2 {
  const muni = report.debts.items.find((i) => i.key === 'DEBMUNICIPAIS');
  if (!muni || muni.amountCents <= 0) return report;
  const fines = report.debts.items.find((i) => i.key === FINE_TOTAL);
  const componentSum = report.debts.fineBreakdown.reduce((acc, i) => acc + i.amountCents, 0);
  if (!((fines && fines.amountCents === muni.amountCents) || (componentSum > 0 && componentSum === muni.amountCents))) return report;
  const sections = report.sections.map((sec) => {
    const items = sec.items.filter((i) => i.key !== 'DEBMUNICIPAIS');
    if (items.length === sec.items.length) return sec;
    const providedCount = items.filter((i) => i.state !== 'NOT_PROVIDED').length;
    return { ...sec, items, providedCount, notProvidedCount: items.length - providedCount, status: sectionStatus(items) };
  }).filter((sec) => sec.items.length > 0);
  const items = report.debts.items.filter((i) => i.key !== 'DEBMUNICIPAIS');
  return { ...report, sections, debts: { ...report.debts, items, totalCents: Math.max(0, report.debts.totalCents - muni.amountCents), note: `${report.debts.note} O débito municipal com o mesmo valor das multas foi contado uma única vez.` } };
}

export type Audience = 'client' | 'team';

/** Modelo de campos publicado para o produto (ver lib/reportScope.ts). */
export interface ViewTemplate { version: number; config: { sections: Array<{ key: string; label?: string; order?: number; visible?: boolean; fields: Array<{ key: string; label?: string; visible?: boolean }> }> } }

function applyTemplate(sections: ReportSection[], template: ViewTemplate): ReportSection[] {
  const byKey = new Map<string, ReportItem>();
  for (const s of sections) for (const i of s.items) byKey.set(i.key, i);
  const meta = new Map(SECTIONS.map((s) => [s.key as string, s]));
  return [...template.config.sections]
    .filter((s) => s.visible !== false && meta.has(s.key))
    .sort((a, b) => (a.order ?? meta.get(a.key)!.order) - (b.order ?? meta.get(b.key)!.order))
    .map((s) => {
      const items = s.fields.filter((f) => f.visible !== false).flatMap((f) => {
        const item = byKey.get(f.key);
        const def = CATALOG_BY_KEY.get(f.key);
        // O modelo só libera campos do catálogo da própria seção e nunca dados de pessoas ou controle interno.
        if (!item || !def || def.section !== s.key || (def.sensitivity === 'OWNER' && !ownerIdentityEnabled()) || def.sensitivity === 'INTERNAL') return [];
        return [f.label ? { ...item, label: f.label } : item];
      });
      const m = meta.get(s.key)!;
      const providedCount = items.filter((i) => i.state !== 'NOT_PROVIDED').length;
      return { key: m.key, label: s.label ?? m.label, description: m.description, status: sectionStatus(items), items, providedCount, notProvidedCount: items.length - providedCount };
    })
    .filter((s) => s.items.length > 0);
}

/**
 * Filtra o relatório para exibição: o cliente nunca vê dados do proprietário (apenas o tipo),
 * campos internos ficam ocultos e campos acima do nível do produto contratado são omitidos.
 * Precedência: modelo de campos publicado > lista de seções do produto > nível (tier).
 */
export function viewReport(report: ReportV2, opts: { audience: Audience; tier: Tier; /** lista de seções liberadas pelo produto (configurada no painel); vazia/ausente = regra por nível */ sections?: string[] | null; /** modelo de campos publicado do produto (só para o cliente) */ template?: ViewTemplate | null }): ReportV2 {
  report = dedupeMunicipalDebt(report);
  const template = opts.audience === 'client' ? opts.template ?? null : null;
  const templated = template ? applyTemplate(report.sections, template) : null;
  const allow = templated ? new Set<string>(templated.map((s) => s.key)) : opts.sections && opts.sections.length ? new Set(opts.sections) : null;
  const effectiveTier: Tier = allow ? 3 : opts.tier;
  const sections = templated ?? report.sections
    .filter((s) => s.key !== 'INTERNO' || opts.audience === 'team')
    .filter((s) => opts.audience === 'team' || !allow || allow.has(s.key))
    .map((s) => {
      const items = s.items.filter((i) => {
        if (i.sensitivity === 'INTERNAL') return opts.audience === 'team';
        if (i.sensitivity === 'OWNER' && opts.audience === 'client' && !ownerIdentityEnabled()) return false;
        return i.tier <= effectiveTier;
      });
      const providedCount = items.filter((i) => i.state !== 'NOT_PROVIDED').length;
      return { ...s, items, providedCount, notProvidedCount: items.length - providedCount, status: sectionStatus(items) };
    })
    .filter((s) => s.items.length > 0);
  const visible = new Set(sections.flatMap((s) => s.items.map((i) => i.key)));
  const visibleAlerts = report.verdict.alerts.filter((a) => visible.has(a.key));
  const lockedAlertCount = report.verdict.alerts.length - visibleAlerts.length;
  const debtsAllowed = allow ? allow.has('DEBITOS') : opts.tier >= 2;
  // Produto sem a seção de débitos (ex.: Gravame, Leilão, Cadastral): nada de "débitos: nada consta", porque isso não foi consultado.
  const debtsHidden = !debtsAllowed;
  let verdict = { ...report.verdict, alerts: visibleAlerts };
  if (lockedAlertCount > 0 && !visibleAlerts.length) {
    verdict = { level: 'ATTENTION', title: 'Há pontos de atenção fora deste plano', reason: `O provedor retornou ${lockedAlertCount === 1 ? 'um ponto de atenção' : `${lockedAlertCount} pontos de atenção`} que não são exibidos no plano contratado.`, alerts: [] };
  } else if (lockedAlertCount > 0) {
    verdict = { ...verdict, reason: `${verdict.reason} Há ainda ${lockedAlertCount} ponto(s) de atenção fora deste plano.` };
  }
  const debts = debtsHidden ? { ...report.debts, totalCents: 0, items: [], fineBreakdown: [], hasDebt: false } : report.debts;
  const shown = new Set<string>(sections.map((s) => s.key));
  const scope: ReportV2['scope'] = opts.audience === 'client'
    ? { mode: template ? 'TEMPLATE' : allow ? 'SECTIONS' : 'TIER', ...(template ? { templateVersion: template.version } : {}), notIncluded: SECTIONS.filter((s) => s.key !== 'INTERNO' && s.key !== 'PROPRIETARIO' && !shown.has(s.key)).map((s) => ({ key: s.key, label: s.label })) }
    : undefined;
  if (scope && verdict.level === 'CLEAR') {
    const outside = scope.notIncluded.filter((n) => n.key === 'DEBITOS' || n.key === 'RESTRICOES' || n.key === 'GRAVAME').map((n) => n.label.toLowerCase());
    if (outside.length) verdict = { level: 'INCONCLUSIVE', title: 'Consulta parcial', reason: `Este produto não inclui: ${outside.join(', ')}. Não é possível afirmar que o veículo está sem pendências.`, alerts: [] };
  }
  const viewed: ReportV2 = { ...report, sections, verdict, debts, lockedAlertCount, debtsHidden, ...(scope ? { scope } : {}) };
  return { ...viewed, advice: buildAdvice(viewed) };
}

export function tierForProductCode(code: string | null | undefined): Tier {
  switch ((code ?? '').toUpperCase()) {
    case 'BASIC': return 1;
    case 'COMPLETE': return 2;
    default: return 3;
  }
}
