import { env, CREDIFY_DEFAULT_BODY, CREDIFY_DEFAULT_PATH } from '../config.js';
import type { VehicleDataProvider } from '../types.js';
import { providerOutcome } from '../report/normalizeV2.js';
import { parseSearchTypes, type SearchType } from '../searchKey.js';

/**
 * Adaptador da Credify, baseado na documentação pública (docs.credify.com.br):
 *  - POST {base}/auth com { ClientID, ClientSecret } devolve { Success, Message, Dados: <JWT válido por 24h> };
 *  - as demais chamadas levam `Authorization: Bearer <token>`;
 *  - a consulta padrão é o "Veículo Total": POST /veiculototal com { Consulta: { IdConsulta, Placa } }; a resposta traz
 *    os blocos CONSULTA/RESPOSTA (ver report/vehicleTotal.ts). "Placa não encontrada" vem com RESPOSTA.CODIGO = ["2"].
 * Caminho, método e corpo podem ser trocados por configuração (CREDIFY_QUERY_*), com {{plate}} e {{queryId}} no modelo.
 * Nada aqui é cobrado ou chamado com DATA_PROVIDER≠real.
 */
type Failure = Error & { code: string; detail?: string };
/** `detail` guarda o motivo técnico (status HTTP e mensagem da Credify) para o painel; nunca contém chaves nem tokens. */
const fail = (code: string, detail?: string): Failure => Object.assign(new Error(code), { code, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
/** Lê a mensagem curta que a Credify devolve em erro ({ Message } ou { MSG }), sem repassar o corpo inteiro. */
async function reason(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  let msg = '';
  try { const j = JSON.parse(text) as Record<string, any>; msg = String(j?.Message ?? j?.message ?? j?.DADOS?.MSG ?? j?.Mensagem ?? ''); } catch { msg = text.replace(/<[^>]*>/g, ' '); }
  return `HTTP ${response.status}${msg.trim() ? `: ${msg.trim().replace(/\s+/g, ' ')}` : ''}`;
}

export interface CredifyOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  baseUrl?: string; clientId?: string; clientSecret?: string; path?: string; method?: 'get' | 'post'; bodyTemplate?: string; timeoutMs?: number; searchTypes?: string;
}

/** Renova antes de vencer; o JWT dura 24 h, então usamos o `exp` quando legível e 23 h como teto. */
function tokenExpiry(token: string, now: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') return Math.min(payload.exp * 1000 - 5 * 60_000, now + 23 * 3600_000);
  } catch { /* token opaco */ }
  return now + 23 * 3600_000;
}

let shared: { token: string; expiresAt: number } | null = null;
/** A documentação diz "Bearer {token}", mas o esquema OpenAPI descreve o cabeçalho como chave direta. Guarda o formato que a Credify aceitou. */
let authStyle: 'bearer' | 'raw' = 'bearer';
let inflight: Promise<string> | null = null;
export function resetCredifyTokenCache(): void { shared = null; inflight = null; authStyle = 'bearer'; }

/** Mantém o token sempre novo: ao subir e a cada 30 min renova se faltar menos de 2 h para vencer. Falha aqui só é registrada; a consulta tenta o login de novo. */
export function startCredifyTokenKeeper(onError: (message: string) => void = () => undefined, provider = new CredifyVehicleProvider()): NodeJS.Timeout {
  const tick = async () => {
    try {
      const left = shared ? shared.expiresAt - Date.now() : 0;
      if (left < 2 * 3600_000) await provider.testConnection();
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

  private cfg() {
    const baseUrl = (this.o.baseUrl ?? env.CREDIFY_BASE_URL ?? 'https://api.credify.com.br').replace(/\/$/, '');
    const clientId = this.o.clientId ?? env.CREDIFY_CLIENT_ID;
    const clientSecret = this.o.clientSecret ?? env.CREDIFY_CLIENT_SECRET;
    const path = this.o.path ?? env.CREDIFY_QUERY_PATH ?? CREDIFY_DEFAULT_PATH;
    const method = this.o.method ?? env.CREDIFY_QUERY_METHOD;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const bodyTemplate = this.o.bodyTemplate ?? env.CREDIFY_QUERY_BODY_TEMPLATE ?? (normalizedPath === CREDIFY_DEFAULT_PATH ? CREDIFY_DEFAULT_BODY : undefined);
    if (!clientId || !clientSecret) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    if (method === 'post' && !bodyTemplate) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    return { baseUrl, clientId, clientSecret, path: normalizedPath, method, bodyTemplate };
  }

  private async http(url: string, init: RequestInit): Promise<Response> {
    try {
      return await (this.o.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(this.o.timeoutMs) });
    } catch (e) { throw fail('PROVIDER_TIMEOUT', `Sem resposta da Credify (${e instanceof Error ? e.name : 'erro de rede'}).`); }
  }

  /** Várias consultas ao mesmo tempo com o token vencido fazem um único login (os demais esperam o mesmo resultado). */
  private async token(force = false): Promise<string> {
    const now = (this.o.now ?? Date.now)();
    if (!force && shared && shared.expiresAt > now) return shared.token;
    if (inflight) return inflight;
    inflight = this.login(now).finally(() => { inflight = null; });
    return inflight;
  }

  private async login(now: number): Promise<string> {
    const c = this.cfg();
    const login = (secret: string | number) => this.http(`${c.baseUrl}/auth`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ClientID: c.clientId, ClientSecret: secret }) });
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
    shared = { token: json.Dados, expiresAt: tokenExpiry(json.Dados, now) };
    return json.Dados;
  }

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

  queryByPlate(plate: string): Promise<{ providerQueryId?: string; raw: unknown }> { return this.run('PLATE', plate); }

  queryBy(type: SearchType, value: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    if (type !== 'PLATE' && !this.supportedSearchTypes.includes(type)) throw fail('SEARCH_TYPE_NOT_SUPPORTED');
    return this.run(type, value);
  }

  private async run(type: SearchType, value: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    const c = this.cfg();
    const name = { PLATE: 'plate', CHASSIS: 'chassis', RENAVAM: 'renavam', OWNER_DOC: 'document' }[type];
    const queryParam = { PLATE: 'placa', CHASSIS: 'chassi', RENAVAM: 'renavam', OWNER_DOC: 'documento' }[type];
    // IdConsulta: texto único por chamada (só dígitos, para caber em qualquer regra do fornecedor).
    const queryId = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const values: Record<string, string> = { plate: '', chassis: '', renavam: '', document: '', queryId, [name]: value };
    // Para tipos além da placa, o caminho ou o corpo precisa dizer onde a chave entra; senão não há como chamar.
    if (type !== 'PLATE' && !c.path.includes(`{${name}}`) && !(c.method === 'post' && c.bodyTemplate?.includes(`{{${name}}}`))) throw fail('SEARCH_TYPE_NOT_SUPPORTED');
    const call = async (token: string, style: 'bearer' | 'raw') => {
      const headers: Record<string, string> = { accept: 'application/json', authorization: style === 'bearer' ? `Bearer ${token}` : token };
      const init: RequestInit = { method: c.method.toUpperCase(), headers };
      let url = `${c.baseUrl}${Object.entries(values).reduce((acc, [k, x]) => acc.replaceAll(`{${k}}`, encodeURIComponent(x)), c.path)}`;
      if (c.method === 'post') { headers['content-type'] = 'application/json'; try { init.body = this.body(c.bodyTemplate!, values); } catch { throw fail('DATA_PROVIDER_NOT_CONFIGURED'); } }
      else if (!c.path.includes(`{${name}}`)) url += `${url.includes('?') ? '&' : '?'}${queryParam}=${encodeURIComponent(value)}`;
      return this.http(url, init);
    };
    const other = (s: 'bearer' | 'raw') => (s === 'bearer' ? 'raw' : 'bearer');
    let response = await call(await this.token(), authStyle);
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
    if (!response.ok) throw fail('DATA_PROVIDER_UNAVAILABLE', await reason(response));
    const text = await response.text().catch(() => '');
    let raw: Record<string, any>;
    try { raw = JSON.parse(text) as Record<string, any>; } catch { throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Resposta que não é JSON: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`); }
    if (!raw || typeof raw !== 'object' || !raw.RESPOSTA) throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Resposta sem o bloco RESPOSTA (campos: ${Object.keys(raw ?? {}).slice(0, 8).join(', ') || 'nenhum'}${raw?.Message ? `; Message: ${String(raw.Message)}` : ''}).`);
    const outcome = providerOutcome(raw);
    if (outcome.notFound) throw fail('NOT_FOUND', 'Placa não encontrada na Credify.');
    if (!outcome.ok) throw fail('DATA_PROVIDER_INVALID_RESPONSE', `Credify respondeu com erro (${outcome.reason ?? 'sem motivo'}): CODIGO ${JSON.stringify(raw?.RESPOSTA?.CODIGO ?? null)}${raw?.RESPOSTA?.DADOS?.MSG ? `; ${String(raw.RESPOSTA.DADOS.MSG)}` : ''}.`);
    const id = raw?.CONSULTA?.CODIGORESPOSTA ?? raw?.CONSULTA?.IDCONSULTA;
    return { providerQueryId: id == null ? undefined : String(id), raw: { ...(type === 'PLATE' ? { placa: value } : {}), idConsulta: queryId, data: raw } };
  }
}
