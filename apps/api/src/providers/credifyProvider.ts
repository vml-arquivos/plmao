import { env } from '../config.js';
import type { VehicleDataProvider } from '../types.js';
import { providerOutcome } from '../report/normalizeV2.js';

/**
 * Adaptador da Credify, baseado na documentação pública (docs.credify.com.br):
 *  - POST {base}/auth com { ClientID, ClientSecret } devolve { Success, Message, Dados: <JWT válido por 24h> };
 *  - as demais chamadas levam `Authorization: Bearer <token>`;
 *  - a consulta "Débitos, restrições e proprietários" devolve o envelope CONSULTA/RESPOSTA.VEICULOSBDRP,
 *    o mesmo formato que o normalizador já entende.
 * O caminho, o método e o CORPO da consulta vêm de configuração (CREDIFY_QUERY_*): o corpo não foi confirmado
 * em homologação e, por isso, não há valor padrão. Nada aqui é cobrado ou chamado com DATA_PROVIDER≠real.
 */
type Failure = Error & { code: string };
const fail = (code: string): Failure => Object.assign(new Error(code), { code });

export interface CredifyOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  baseUrl?: string; clientId?: string; clientSecret?: string; path?: string; method?: 'get' | 'post'; bodyTemplate?: string; timeoutMs?: number;
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
export function resetCredifyTokenCache(): void { shared = null; }

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
    const path = this.o.path ?? env.CREDIFY_QUERY_PATH ?? '/debitosrestricoesproprietarios';
    const method = this.o.method ?? env.CREDIFY_QUERY_METHOD;
    const bodyTemplate = this.o.bodyTemplate ?? env.CREDIFY_QUERY_BODY_TEMPLATE;
    if (!clientId || !clientSecret) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    if (method === 'post' && !bodyTemplate) throw fail('DATA_PROVIDER_NOT_CONFIGURED');
    return { baseUrl, clientId, clientSecret, path: path.startsWith('/') ? path : `/${path}`, method, bodyTemplate };
  }

  private async http(url: string, init: RequestInit): Promise<Response> {
    try {
      return await (this.o.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(this.o.timeoutMs) });
    } catch { throw fail('PROVIDER_TIMEOUT'); }
  }

  private async token(force = false): Promise<string> {
    const now = (this.o.now ?? Date.now)();
    if (!force && shared && shared.expiresAt > now) return shared.token;
    const c = this.cfg();
    const response = await this.http(`${c.baseUrl}/auth`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ClientID: c.clientId, ClientSecret: c.clientSecret }) });
    if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED');
    if (!response.ok) throw fail('DATA_PROVIDER_UNAVAILABLE');
    const json = await response.json().catch(() => null) as { Success?: boolean; Dados?: unknown } | null;
    if (!json || json.Success === false || typeof json.Dados !== 'string' || !json.Dados) throw fail('DATA_PROVIDER_AUTH_FAILED');
    shared = { token: json.Dados, expiresAt: tokenExpiry(json.Dados, now) };
    return json.Dados;
  }

  /** O corpo é gerado a partir do modelo JSON; a placa entra como valor JSON (nunca por concatenação de texto). */
  private body(template: string, plate: string): string {
    const parsed = JSON.parse(template) as unknown;
    const fill = (v: unknown): unknown => typeof v === 'string' ? v.replaceAll('{{plate}}', plate) : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
    return JSON.stringify(fill(parsed));
  }

  async queryByPlate(plate: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    const c = this.cfg();
    const call = async (token: string) => {
      const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${token}` };
      const init: RequestInit = { method: c.method.toUpperCase(), headers };
      let url = `${c.baseUrl}${c.path.replaceAll('{plate}', encodeURIComponent(plate))}`;
      if (c.method === 'post') { headers['content-type'] = 'application/json'; try { init.body = this.body(c.bodyTemplate!, plate); } catch { throw fail('DATA_PROVIDER_NOT_CONFIGURED'); } }
      else if (!c.path.includes('{plate}')) url += `${url.includes('?') ? '&' : '?'}placa=${encodeURIComponent(plate)}`;
      return this.http(url, init);
    };
    let response = await call(await this.token());
    if (response.status === 401) response = await call(await this.token(true));
    if (response.status === 404 || response.status === 410) throw fail('NOT_FOUND');
    if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED');
    if (response.status === 408 || response.status === 429) throw fail('DATA_PROVIDER_RATE_LIMITED');
    if (response.status === 402) throw fail('DATA_PROVIDER_QUOTA_EXHAUSTED');
    if (!response.ok) throw fail('DATA_PROVIDER_UNAVAILABLE');
    const raw = await response.json().catch(() => { throw fail('DATA_PROVIDER_INVALID_RESPONSE'); }) as Record<string, any>;
    if (!providerOutcome(raw).ok) throw fail('DATA_PROVIDER_INVALID_RESPONSE');
    const id = raw?.CONSULTA?.CODIGORESPOSTA ?? raw?.CONSULTA?.IDCONSULTA;
    return { providerQueryId: id == null ? undefined : String(id), raw: { placa: plate, data: raw } };
  }
}
