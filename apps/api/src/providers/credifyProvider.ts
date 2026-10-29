import { env, CREDIFY_CONSULTA_CODES, CREDIFY_DEFAULT_BODY, CREDIFY_DEFAULT_PATH, CREDIFY_PLATE_PATHS, CREDIFY_PRODUCT_PATHS } from '../config.js';
import type { VehicleDataProvider } from '../types.js';
import { providerOutcome } from '../report/normalizeV2.js';
import { parseSearchTypes, type SearchType } from '../searchKey.js';
import { log } from '../lib/http.js';

/**
 * Adaptador da Credify, baseado na documentação pública (docs.credify.com.br):
 *  - POST {base}/auth com { ClientID, ClientSecret } devolve { Success, Message, Dados: <JWT válido por 24h> };
 *  - as demais chamadas levam `Authorization: Bearer <token>`;
 *  - a consulta padrão é o "Veículo Total": POST /veiculototal com { Consulta: { IdConsulta, Placa } }; a resposta traz
 *    os blocos CONSULTA/RESPOSTA (ver report/vehicleTotal.ts). "Placa não encontrada" vem com RESPOSTA.CODIGO = ["2"].
 * Caminho, método e corpo podem ser trocados por configuração (CREDIFY_QUERY_*), com {{plate}} e {{queryId}} no modelo.
 * {{queryId}} é o CÓDIGO FIXO da consulta (IdConsulta, um por endpoint; ver CREDIFY_CONSULTA_CODES), não um número livre.
 * Nada aqui é cobrado ou chamado com DATA_PROVIDER≠real.
 */
type Failure = Error & { code: string; detail?: string };
/** `detail` guarda o motivo técnico (status HTTP e mensagem da Credify) para o painel; nunca contém chaves nem tokens. */
const fail = (code: string, detail?: string): Failure => Object.assign(new Error(code), { code, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
/** Lê a mensagem curta que a Credify devolve em erro ({ Message } ou { MSG }), sem repassar o corpo inteiro. */
async function reason(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  let msg = '';
  try {
    const j = JSON.parse(text) as Record<string, any>;
    msg = String(j?.Message ?? j?.message ?? j?.DADOS?.MSG ?? j?.Mensagem ?? j?.title ?? j?.detail ?? j?.error ?? '');
    // Sem campo de mensagem conhecido: mostra o corpo (resposta do fornecedor, sem segredos) para dar para diagnosticar.
    if (!msg.trim() && text.trim()) msg = `corpo ${text.trim().replace(/\s+/g, ' ').slice(0, 300)}`;
  } catch { msg = text.replace(/<[^>]*>/g, ' '); }
  return `HTTP ${response.status}${msg.trim() ? `: ${msg.trim().replace(/\s+/g, ' ').slice(0, 400)}` : ' (sem mensagem no corpo)'}`;
}

export interface CredifyOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  baseUrl?: string; clientId?: string; clientSecret?: string; path?: string; consultaId?: string; method?: 'get' | 'post'; bodyTemplate?: string; timeoutMs?: number; searchTypes?: string;
}

/** Renova antes de vencer; o JWT dura 24 h, então usamos o `exp` quando legível e 23 h como teto. */
function tokenExpiry(token: string, now: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') return Math.min(payload.exp * 1000 - 5 * 60_000, now + 23 * 3600_000);
  } catch { /* token opaco */ }
  return now + 23 * 3600_000;
}

let shared: { token: string; expiresAt: number; issuedAt: number } | null = null;
/** Token usado em consulta tem no máximo 3 min de vida: cada consulta roda com um login recente, como no teste do painel. */
const FRESH_MS = 3 * 60_000;
let lastLogin: { at: number; ok: boolean; error?: string } | null = null;
/** Estado do login para o painel: idade do token, último login e último erro (sem expor o token). */
export function credifyTokenStatus(now = Date.now()): { hasToken: boolean; ageSeconds: number | null; expiresInMinutes: number | null; lastLoginOk: boolean | null; lastLoginAt: string | null; lastError: string | null } {
  return { hasToken: Boolean(shared), ageSeconds: shared ? Math.round((now - shared.issuedAt) / 1000) : null, expiresInMinutes: shared ? Math.max(0, Math.round((shared.expiresAt - now) / 60000)) : null, lastLoginOk: lastLogin?.ok ?? null, lastLoginAt: lastLogin ? new Date(lastLogin.at).toISOString() : null, lastError: lastLogin?.ok === false ? lastLogin.error ?? null : null };
}
const AUTH_TEXT = /token|autoriz|expir|n[ãa]o autenticad|unauthori[sz]ed|sess[ãa]o/i;
/** A documentação diz "Bearer {token}", mas o esquema OpenAPI descreve o cabeçalho como chave direta. Guarda o formato que a Credify aceitou. */
let authStyle: 'bearer' | 'raw' = 'bearer';
let inflight: Promise<string> | null = null;
export function resetCredifyTokenCache(): void { shared = null; inflight = null; authStyle = 'bearer'; lastLogin = null; }

/** Mantém o token sempre novo: ao subir e a cada 30 min renova se faltar menos de 2 h para vencer. Falha aqui só é registrada; a consulta tenta o login de novo. */
export function startCredifyTokenKeeper(onError: (message: string) => void = () => undefined, provider = new CredifyVehicleProvider()): NodeJS.Timeout {
  const tick = async () => {
    try {
      // Renova a cada ciclo (30 min): o token em uso nunca passa de poucos minutos e qualquer problema de login aparece no log na hora.
      await provider.testConnection();
    } catch (e) { onError(e instanceof Error ? e.message : 'erro desconhecido'); }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, 30 * 60_000);
  timer.unref();
  return timer;
}

export class CredifyVehicleProvider implements VehicleDataProvider {
  readonly name = 'credify';
  private readonly o: Required<Pick<CredifyOptions, 'timeoutMs'>> & CredifyOptions;
  constructor(options: CredifyOptions = {}) {
    this.o = { timeoutMs: env.VEHICLE_API_TIMEOUT_MS, ...options };
  }

  /** Caminho da consulta para um pacote: o definido em CREDIFY_QUERY_PATH (modo global) ou o do pacote. */
  routeFor(productId?: string): { path: string; routed: boolean } {
    const global = this.o.path ?? env.CREDIFY_QUERY_PATH;
    if (global) return { path: global.startsWith('/') ? global : `/${global}`, routed: false };
    const byProduct = productId ? CREDIFY_PRODUCT_PATHS[productId.toUpperCase()] : undefined;
    return byProduct ? { path: byProduct, routed: true } : { path: CREDIFY_DEFAULT_PATH, routed: false };
  }

  private cfg(productId?: string) {
    const baseUrl = (this.o.baseUrl ?? env.CREDIFY_BASE_URL ?? 'https://api.credify.com.br').replace(/\/$/, '');
    // Espaço, quebra de linha ou aspas coladas junto com o valor no painel de variáveis fazem a Credify responder "LOGON OU SENHA INVALIDOS".
    const clean = (v?: string) => v?.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
    const clientId = clean(this.o.clientId ?? env.CREDIFY_CLIENT_ID);
    const clientSecret = clean(this.o.clientSecret ?? env.CREDIFY_CLIENT_SECRET);
    const route = this.routeFor(productId);
    const method = this.o.method ?? env.CREDIFY_QUERY_METHOD;
    const normalizedPath = route.path;
    const lower = normalizedPath.toLowerCase();
    // Roteado por pacote: o código e o corpo são os da própria consulta (variáveis globais de corpo/código só valem no modo global).
    const bodyTemplate = this.o.bodyTemplate ?? (route.routed ? undefined : env.CREDIFY_QUERY_BODY_TEMPLATE) ?? (CREDIFY_PLATE_PATHS.includes(lower) ? CREDIFY_DEFAULT_BODY : undefined);
    const consultaId = (this.o.consultaId ?? (route.routed ? undefined : env.CREDIFY_QUERY_ID) ?? CREDIFY_CONSULTA_CODES[lower] ?? '').trim();
    if (!clientId || !clientSecret) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    if (bodyTemplate?.includes('{{queryId}}') && !/^\d{1,12}$/.test(consultaId)) throw fail('DATA_PROVIDER_NOT_CONFIGURED', `Falta o código da consulta (IdConsulta) para ${normalizedPath}. Defina CREDIFY_QUERY_ID com o código que a Credify informa para essa consulta.`);
    if (method === 'post' && !bodyTemplate) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    return { baseUrl, clientId, clientSecret, path: normalizedPath, method, bodyTemplate, consultaId };
  }

  private async http(url: string, init: RequestInit, timeoutMs = this.o.timeoutMs): Promise<Response> {
    const startedAt = Date.now();
    const where = new URL(url).pathname;
    try {
      const response = await (this.o.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      // Tempo de cada chamada à Credify no log, para saber se a lentidão é da fonte (e em qual consulta).
      log('info', 'credify_call', { path: where, status: response.status, ms: Date.now() - startedAt });
      return response;
    } catch (e) {
      const ms = Date.now() - startedAt;
      const kind = e instanceof Error ? e.name : 'erro de rede';
      const cause = e instanceof Error && (e as Error & { cause?: { code?: string } }).cause?.code;
      log('warn', 'credify_call_failed', { path: where, ms, kind, cause: cause ?? null });
      throw fail('PROVIDER_TIMEOUT', `Sem resposta da Credify em ${where} após ${Math.round(ms / 1000)} s (${kind}${cause ? `, ${cause}` : ''}).`);
    }
  }

  /** Várias consultas ao mesmo tempo com o token vencido fazem um único login (os demais esperam o mesmo resultado). */
  private async token(force = false): Promise<string> {
    const now = (this.o.now ?? Date.now)();
    if (!force && shared && shared.expiresAt > now && now - shared.issuedAt < FRESH_MS) return shared.token;
    if (inflight) return inflight;
    const previous = shared;
    inflight = this.loginWithRetry(now).catch((e) => {
      // Login indisponível agora, mas ainda há um token dentro da validade: segue com ele em vez de derrubar a consulta.
      if (!force && previous && previous.expiresAt > now && (e as { code?: string }).code !== 'DATA_PROVIDER_AUTH_FAILED') { log('warn', 'credify_login_failed_using_previous_token', { message: e instanceof Error ? e.message : 'erro' }); return previous.token; }
      throw e;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  /** Até 3 tentativas para falha de rede ou 5xx; credencial recusada não é repetida. */
  private async loginWithRetry(now: number): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const token = await this.login(now);
        lastLogin = { at: Date.now(), ok: true };
        if (attempt > 0) log('info', 'credify_login_recovered', { attempt: attempt + 1 });
        return token;
      } catch (e) {
        lastError = e;
        const code = (e as { code?: string }).code;
        if (code !== 'PROVIDER_TIMEOUT' && code !== 'DATA_PROVIDER_UNAVAILABLE') break;
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 1200));
      }
    }
    lastLogin = { at: Date.now(), ok: false, error: lastError instanceof Error ? ((lastError as { detail?: string }).detail ?? lastError.message) : 'erro' };
    log('warn', 'credify_login_failed', { code: (lastError as { code?: string }).code ?? null, detail: String((lastError as { detail?: string }).detail ?? '').slice(0, 200) });
    throw lastError;
  }

  private async login(now: number): Promise<string> {
    const c = this.cfg();
    const login = (secret: string | number) => this.http(`${c.baseUrl}/auth`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ClientID: c.clientId, ClientSecret: secret }) }, Math.min(this.o.timeoutMs, 20_000));
    const numeric = /^[1-9]\d{0,14}$/.test(c.clientSecret);
    const valid = (r: Response, body: { Success?: boolean; Dados?: unknown } | null) => r.ok && Boolean(body) && body!.Success !== false && typeof body!.Dados === 'string' && Boolean(body!.Dados);
    const read = async (r: Response) => (r.ok ? await r.clone().json().catch(() => null) as { Success?: boolean; Message?: string; Dados?: unknown } | null : null);
    let response = await login(c.clientSecret);
    let json = await read(response);
    // A documentação do /auth descreve ClientSecret como inteiro; se a chave for só números e o texto não gerar token, tenta como número.
    if (!valid(response, json) && numeric && response.status !== 408 && response.status < 500) { response = await login(Number(c.clientSecret)); json = await read(response); }
    if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED', `Login recusado (${await reason(response)}). Confira ClientID/ClientSecret e se o IP do servidor está em "IPs Autorizados" na Credify.`);
    if (!response.ok) throw fail('DATA_PROVIDER_UNAVAILABLE', `Login: ${await reason(response)}`);
    if (!json || json.Success === false || typeof json.Dados !== 'string' || !json.Dados) throw fail('DATA_PROVIDER_AUTH_FAILED', `Login sem token${json?.Message ? `: ${String(json.Message)}` : ''}. Confira ClientID/ClientSecret e o IP autorizado.`);
    shared = { token: json.Dados, expiresAt: tokenExpiry(json.Dados, now), issuedAt: now };
    return json.Dados;
  }

  /** Deixa o login pronto (reusa o token recente). Não consome consulta. */
  async warm(): Promise<void> { await this.token(); }

  /** Só o login (não consome consulta): confirma ClientID, ClientSecret e IP autorizado. */
  async testConnection(): Promise<{ ok: true; expiresInMinutes: number }> {
    const now = (this.o.now ?? Date.now)();
    await this.token(true);
    return { ok: true, expiresInMinutes: Math.max(0, Math.round(((shared?.expiresAt ?? now) - now) / 60000)) };
  }

  /** Placa sempre; os demais tipos só se o contrato os atende (VEHICLE_SEARCH_TYPES). */
  get supportedSearchTypes(): readonly SearchType[] { return parseSearchTypes(this.o.searchTypes ?? env.VEHICLE_SEARCH_TYPES); }

  /** O corpo é gerado a partir do modelo JSON; a chave entra como valor JSON (nunca por concatenação de texto). */
  private body(template: string, values: Record<string, string>): string {
    const parsed = JSON.parse(template) as unknown;
    const fill = (v: unknown): unknown => {
      if (typeof v === 'string') return Object.entries(values).reduce((acc, [k, x]) => acc.replaceAll(`{{${k}}}`, x), v);
      if (Array.isArray(v)) return v.map(fill);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
      return v;
    };
    return JSON.stringify(fill(parsed));
  }

  queryByPlate(plate: string, ctx?: { productId?: string }): Promise<{ providerQueryId?: string; raw: unknown }> { return this.run('PLATE', plate, ctx?.productId); }

  queryBy(type: SearchType, value: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    if (type !== 'PLATE' && !this.supportedSearchTypes.includes(type)) throw fail('SEARCH_TYPE_NOT_SUPPORTED');
    return this.run(type, value);
  }

  private async run(type: SearchType, value: string, productId?: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    const c = this.cfg(productId);
    const name = { PLATE: 'plate', CHASSIS: 'chassis', RENAVAM: 'renavam', OWNER_DOC: 'document' }[type];
    const queryParam = { PLATE: 'placa', CHASSIS: 'chassi', RENAVAM: 'renavam', OWNER_DOC: 'documento' }[type];
    // IdConsulta é o código fixo da consulta (um por endpoint), não um número livre: a Credify responde 400
    // "O IdConsulta não é válido para este EndPoint" para qualquer outro valor.
    const queryId = c.consultaId;
    const values: Record<string, string> = { plate: '', chassis: '', renavam: '', document: '', queryId, [name]: value };
    // Para tipos além da placa, o caminho ou o corpo precisa dizer onde a chave entra; senão não há como chamar.
    if (type !== 'PLATE' && !c.path.includes(`{${name}}`) && !(c.method === 'post' && c.bodyTemplate?.includes(`{{${name}}}`))) throw fail('SEARCH_TYPE_NOT_SUPPORTED');
    let sentBody = '';
    const call = async (token: string, style: 'bearer' | 'raw') => {
      const headers: Record<string, string> = { accept: 'application/json', authorization: style === 'bearer' ? `Bearer ${token}` : token };
      const init: RequestInit = { method: c.method.toUpperCase(), headers };
      let url = `${c.baseUrl}${Object.entries(values).reduce((acc, [k, x]) => acc.replaceAll(`{${k}}`, encodeURIComponent(x)), c.path)}`;
      if (c.method === 'post') { headers['content-type'] = 'application/json'; try { init.body = this.body(c.bodyTemplate!, values); sentBody = String(init.body); } catch { throw fail('DATA_PROVIDER_NOT_CONFIGURED'); } }
      else if (!c.path.includes(`{${name}}`)) url += `${url.includes('?') ? '&' : '?'}${queryParam}=${encodeURIComponent(value)}`;
      return this.http(url, init);
    };
    const other = (s: 'bearer' | 'raw') => (s === 'bearer' ? 'raw' : 'bearer');
    const send = async (force = false): Promise<Response> => {
      try {
        return await call(await this.token(force), authStyle);
      } catch (e) {
        // Sem resposta da fonte: descarta o token para a próxima consulta começar com um login novo.
        if ((e as { code?: string }).code === 'PROVIDER_TIMEOUT') shared = null;
        throw e;
      }
    };
    let response = await send();
    if (response.status === 401) {
      // 1) o outro formato de cabeçalho com o mesmo token; 2) token novo com os dois formatos.
      const alt = await call(await this.token(), other(authStyle));
      if (alt.status !== 401) { authStyle = other(authStyle); response = alt; }
      else {
        const fresh = await this.token(true);
        response = await call(fresh, authStyle);
        if (response.status === 401) { const again = await call(fresh, other(authStyle)); if (again.status !== 401) { authStyle = other(authStyle); response = again; } }
      }
    }
    if (response.status === 404 || response.status === 410) throw fail('NOT_FOUND', await reason(response));
    if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED', `Consulta recusada (${await reason(response)}). Confira as Finalidades de Consumo, o plano e o IP autorizado na Credify.`);
    if (response.status === 408 || response.status === 429) throw fail('DATA_PROVIDER_RATE_LIMITED', await reason(response));
    if (response.status === 402) throw fail('DATA_PROVIDER_QUOTA_EXHAUSTED', await reason(response));
    if (!response.ok) throw fail('DATA_PROVIDER_UNAVAILABLE', `${await reason(response)}${response.status === 400 ? ` | pedido enviado a ${c.path}: ${sentBody}` : ''}`);
    const read = async (r: Response): Promise<Record<string, any>> => {
      const text = await r.text().catch(() => '');
      try { return JSON.parse(text) as Record<string, any>; } catch { throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Resposta que não é JSON: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`); }
    };
    let raw = await read(response);
    // A Credify às vezes devolve 200 com a mensagem de token inválido ou vencido: entra de novo e repete uma única vez.
    if (raw && typeof raw === 'object' && !raw.RESPOSTA && AUTH_TEXT.test(String(raw.Message ?? raw.message ?? raw.MSG ?? ''))) {
      log('warn', 'credify_token_rejected_in_body', { path: c.path });
      shared = null;
      const retry = await call(await this.token(true), authStyle);
      if (retry.ok) raw = await read(retry);
    }
    if (!raw || typeof raw !== 'object' || !raw.RESPOSTA) throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Resposta sem o bloco RESPOSTA (campos: ${Object.keys(raw ?? {}).slice(0, 8).join(', ') || 'nenhum'}${raw?.Message ? `; Message: ${String(raw.Message)}` : ''}).`);
    const outcome = providerOutcome(raw);
    if (outcome.notFound) throw fail('NOT_FOUND', 'Placa não encontrada na Credify.');
    if (!outcome.ok) throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Credify respondeu com erro (${outcome.reason ?? 'sem motivo'}): CODIGO ${JSON.stringify(raw?.RESPOSTA?.CODIGO ?? null)}${raw?.RESPOSTA?.DADOS?.MSG ? `; ${String(raw.RESPOSTA.DADOS.MSG)}` : ''}.`);
    const id = raw?.CONSULTA?.CODIGORESPOSTA ?? raw?.CONSULTA?.IDCONSULTA;
    return { providerQueryId: id == null ? undefined : String(id), raw: { ...(type === 'PLATE' ? { placa: value } : {}), idConsulta: queryId, data: raw } };
  }
}
