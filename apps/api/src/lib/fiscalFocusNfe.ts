import { env } from '../config.js';
import { FiscalProviderError, type FiscalEmitInput, type FiscalEmitResult, type FiscalProvider } from './fiscal.js';

/**
 * Emissão automática de NFS-e (padrão nacional) pelo integrador Focus NFe.
 * O integrador guarda o certificado digital da empresa, assina e transmite a DPS ao Sistema Nacional NFS-e e devolve número,
 * código de verificação, XML e PDF. O sistema envia só os dados da nota; nunca guarda certificado.
 *
 * Fluxo: POST /v2/nfsen?ref=<referência única> (202 = aceito, autorização assíncrona) e GET /v2/nfsen/<referência> até autorizar.
 * Dados do emitente vêm da tela Fiscal → Configurações (CNPJ, inscrição municipal, município IBGE, regime, código de tributação nacional).
 * Homologação e produção usam servidores e tokens diferentes; a escolha segue o ambiente da tela Fiscal.
 */
const HOMOLOGACAO = 'https://homologacao.focusnfe.com.br';
const PRODUCAO = 'https://api.focusnfe.com.br';
const TIMEOUT_MS = 25_000;

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Referência única da nota no integrador: estável por job, para o reenvio nunca duplicar a nota. */
export function focusRef(idempotencyKey: string): string {
  return `plmao-${idempotencyKey.replace(/^fiscal-emit:/, '').replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 60);
}

/** Corpo da DPS no formato do integrador. Falha com mensagem clara (sem tentar de novo) quando falta dado do emitente. */
export function buildDps(input: FiscalEmitInput, now = new Date()): Record<string, unknown> {
  const s = input.issuer as { cnpj?: string; municipal_registration?: string; service_code?: string; iss_rate_bps?: number | null; tax_regime?: string; city_ibge_code?: string; series?: string };
  const c = input.customer as { document?: string | null; name?: string | null; legalName?: string | null; email?: string | null; phone?: string | null };
  const bad = (m: string) => new FiscalProviderError(m, false);
  const cnpj = digits(s.cnpj);
  if (cnpj.length !== 14) throw bad('Configure o CNPJ do emitente em Fiscal → Configurações.');
  if (!str(s.municipal_registration)) throw bad('Configure a inscrição municipal do emitente em Fiscal → Configurações.');
  const city = digits(s.city_ibge_code);
  if (city.length !== 7) throw bad('Configure o código IBGE do município (7 dígitos) em Fiscal → Configurações.');
  const cTribNac = digits(s.service_code);
  if (cTribNac.length !== 6) throw bad('O código de tributação nacional do serviço precisa ter 6 dígitos (ex.: 010701). Ajuste em Fiscal → Configurações.');
  const doc = digits(c.document);
  if (doc.length !== 11 && doc.length !== 14) throw bad('O documento do cliente (CPF ou CNPJ) está incompleto.');
  if (input.amountCents <= 0) throw bad('Valor da nota inválido.');

  const brt = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const simples = s.tax_regime === 'SIMPLES' ? '3' : s.tax_regime === 'MEI' ? '2' : '1';
  const body: Record<string, unknown> = {
    data_emissao: now.toISOString(),
    data_competencia: brt,
    codigo_municipio_emissora: Number(city),
    cnpj_prestador: cnpj,
    inscricao_municipal_prestador: String(s.municipal_registration).trim(),
    codigo_opcao_simples_nacional: simples,
    [doc.length === 14 ? 'cnpj_tomador' : 'cpf_tomador']: doc,
    razao_social_tomador: String(c.legalName ?? c.name ?? '').slice(0, 150) || undefined,
    codigo_municipio_prestacao: city,
    codigo_tributacao_nacional_iss: cTribNac,
    descricao_servico: input.description.slice(0, 1000),
    valor_servico: Math.round(input.amountCents) / 100,
    tributacao_iss: 1,
    tipo_retencao_iss: 1,
    indicador_total_tributacao: 0,
    finalidade_emissao: 0,
    consumidor_final: doc.length === 11 ? 1 : 0,
    indicador_destinatario: 0
  };
  // Optante pelo Simples recolhe o ISS no DAS: a alíquota só vai na DPS dos demais regimes.
  if (s.tax_regime !== 'SIMPLES' && s.tax_regime !== 'MEI' && s.iss_rate_bps != null) body.percentual_aliquota_relativa_municipio = Number(s.iss_rate_bps) / 100;
  if (str(c.email)) body.email_tomador = String(c.email).slice(0, 80);
  const phone = digits(c.phone);
  if (phone.length >= 6 && phone.length <= 20) body.telefone_tomador = phone;
  if (/^\d+$/.test(String(s.series ?? ''))) body.serie_dps = Number(s.series);
  if (str(env.FOCUSNFE_NBS)) body.codigo_nbs = digits(env.FOCUSNFE_NBS);
  if (str(env.FOCUSNFE_IBSCBS_CST)) body.ibs_cbs_situacao_tributaria = String(env.FOCUSNFE_IBSCBS_CST).trim();
  if (str(env.FOCUSNFE_IBSCBS_CLASS_TRIB)) body.ibs_cbs_classificacao_tributaria = String(env.FOCUSNFE_IBSCBS_CLASS_TRIB).trim();
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

/** Mensagem do integrador (formatos diferentes por erro): junta o que houver, sem dados do cliente. */
export function focusMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  const j = json as Record<string, unknown>;
  const parts: string[] = [];
  const push = (v: unknown) => { const t = str(v); if (t) parts.push(t); };
  push(j.mensagem); push(j.mensagem_sefaz); push(j.codigo);
  if (Array.isArray(j.erros)) for (const e of j.erros) push(typeof e === 'string' ? e : (e as Record<string, unknown>)?.mensagem);
  return (parts.join(' · ') || fallback).slice(0, 280);
}

type Json = Record<string, unknown>;
const pick = (j: Json, ...keys: string[]) => { for (const k of keys) { const v = j[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return null; };

/** Converte a consulta da nota no resultado que a fila entende. */
export function mapFocusStatus(json: Json, baseUrl: string, ref: string, series: string | null): FiscalEmitResult {
  const status = String(json.status ?? '').toLowerCase();
  const abs = (u: string | null) => (u ? (/^https?:\/\//i.test(u) ? u : `${baseUrl}${u.startsWith('/') ? '' : '/'}${u}`) : null);
  if (status === 'autorizado' || status === 'autorizada') {
    const number = pick(json, 'numero', 'numero_nfse', 'numero_nota');
    if (!number) throw new FiscalProviderError('A nota foi autorizada, mas o integrador ainda não informou o número. Nova consulta em instantes.', true);
    return {
      status: 'ISSUED', number, series: pick(json, 'serie', 'serie_dps') ?? series,
      verificationCode: pick(json, 'codigo_verificacao'), accessKey: pick(json, 'chave_nfse', 'chave_acesso', 'chave'),
      pdfUrl: abs(pick(json, 'url_danfse', 'caminho_danfse', 'url_pdf', 'caminho_pdf')), xmlUrl: abs(pick(json, 'caminho_xml_nota_fiscal', 'url_xml', 'caminho_xml'))
    };
  }
  if (status === 'erro_autorizacao') return { status: 'REJECTED', reason: focusMessage(json, 'A nota foi recusada pelo Sistema Nacional NFS-e.') };
  if (status === 'cancelado' || status === 'cancelada') return { status: 'REJECTED', reason: 'A nota consta como cancelada no integrador.' };
  return { status: 'PENDING', providerRef: ref };
}

export interface FocusOptions { token?: string; tokenHomologacao?: string; baseUrl?: string; fetchImpl?: typeof fetch }

export function createFocusNfeProvider(opts: FocusOptions = {}): FiscalProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const environment = async () => {
    const { pool } = await import('../db.js');
    const r = await pool.query('SELECT environment FROM fiscal_settings WHERE id=1');
    return String(r.rows[0]?.environment ?? 'HOMOLOGACAO');
  };
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Json | null; text: string }> {
    const prod = (await environment()) === 'PRODUCAO';
    const token = prod ? (opts.token ?? env.FOCUSNFE_TOKEN) : (opts.tokenHomologacao ?? env.FOCUSNFE_TOKEN_HOMOLOGACAO);
    if (!token) throw new FiscalProviderError(prod ? 'Falta o token de produção do emissor (FOCUSNFE_TOKEN).' : 'Falta o token de homologação do emissor (FOCUSNFE_TOKEN_HOMOLOGACAO).', false);
    const base = (opts.baseUrl ?? env.FOCUSNFE_BASE_URL ?? (prod ? PRODUCAO : HOMOLOGACAO)).replace(/\/$/, '');
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new FiscalProviderError(`Sem resposta do emissor: ${e instanceof Error ? e.message.slice(0, 120) : 'erro de rede'}`, true);
    }
    const text = await res.text();
    let json: Json | null = null;
    try { json = text ? (JSON.parse(text) as Json) : null; } catch { json = null; }
    return { status: res.status, json, text };
  }
  const baseOf = async () => (opts.baseUrl ?? env.FOCUSNFE_BASE_URL ?? ((await environment()) === 'PRODUCAO' ? PRODUCAO : HOMOLOGACAO)).replace(/\/$/, '');
  const seriesOf = (input: FiscalEmitInput) => { const s = (input.issuer as { series?: string }).series; return s ? String(s) : null; };

  return {
    name: 'focusnfe',
    isConfigured: () => Boolean(opts.token ?? env.FOCUSNFE_TOKEN ?? opts.tokenHomologacao ?? env.FOCUSNFE_TOKEN_HOMOLOGACAO),
    async emit(input) {
      const ref = focusRef(input.idempotencyKey);
      const dps = buildDps(input);
      const r = await call('POST', `/v2/nfsen?ref=${encodeURIComponent(ref)}`, dps);
      if (r.status === 202 || r.status === 200 || r.status === 201) return { status: 'PENDING', providerRef: ref };
      // Referência já enviada antes (reenvio depois de uma queda): segue para a consulta em vez de duplicar.
      if (r.status === 409 || /ja existe|já existe|already|duplic/i.test(r.text.slice(0, 400))) return { status: 'PENDING', providerRef: ref };
      if (r.status === 401 || r.status === 403) throw new FiscalProviderError('O emissor recusou o acesso (token inválido ou sem permissão).', false);
      if (r.status === 400 || r.status === 422) return { status: 'REJECTED', reason: focusMessage(r.json, 'Dados da nota recusados pelo emissor.') };
      throw new FiscalProviderError(`O emissor respondeu ${r.status}.`, true);
    },
    async poll(ref, input) {
      const r = await call('GET', `/v2/nfsen/${encodeURIComponent(ref)}`);
      if (r.status === 404) return { status: 'PENDING', providerRef: ref };
      if (r.status === 401 || r.status === 403) throw new FiscalProviderError('O emissor recusou o acesso (token inválido ou sem permissão).', false);
      if (r.status !== 200 || !r.json) throw new FiscalProviderError(`O emissor respondeu ${r.status} na consulta.`, true);
      return mapFocusStatus(r.json, await baseOf(), ref, seriesOf(input));
    }
  };
}
