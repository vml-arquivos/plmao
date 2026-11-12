import { env } from '../config.js';

/**
 * Consulta de CEP feita no servidor. Devolve só o endereço público do CEP (rua, bairro, cidade, UF) para pré-preencher um cadastro,
 * que a pessoa revisa antes de salvar. Fonte principal: BrasilAPI (GET {base}/api/cep/v2/{cep}); reserva: ViaCEP (GET {base}/ws/{cep}/json/).
 * Os dois são gratuitos e abertos. Sem CEP_PROVIDER=disabled nenhuma chamada externa é feita.
 */
export interface CepData { cep: string; street: string | null; district: string | null; city: string | null; state: string | null; complement: string | null }
export interface CepResult { data: CepData; source: string; cached: boolean }
export class CepError extends Error { constructor(public code: 'CEP_INVALID' | 'CEP_NOT_FOUND' | 'CEP_LOOKUP_DISABLED' | 'CEP_RATE_LIMITED' | 'CEP_UNAVAILABLE') { super(code); } }

const str = (v: unknown, max = 160): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const uf = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

export const cepLookupEnabled = () => env.CEP_PROVIDER !== 'disabled';
export const onlyCepDigits = (v: string): string => v.replace(/\D/g, '');

export function normalizeBrasilApiCep(raw: unknown, cep: string): CepData | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const city = str(r.city, 80); const state = uf(r.state);
  if (!city || !state) return null;
  return { cep, street: str(r.street), district: str(r.neighborhood, 80), city, state, complement: null };
}
export function normalizeViaCep(raw: unknown, cep: string): CepData | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.erro === true || r.erro === 'true') return null;
  const city = str(r.localidade, 80); const state = uf(r.uf);
  if (!city || !state) return null;
  return { cep, street: str(r.logradouro), district: str(r.bairro, 80), city, state, complement: null };
}

// cache em memória (24 h) e limite por solicitante (60 consultas / 10 min)
const cache = new Map<string, { at: number; value: { data: CepData; source: string } }>();
const CACHE_MS = 24 * 3600_000;
const hits = new Map<string, number[]>();
export function cepRateLimit(key: string, now = Date.now(), max = 60, windowMs = 600_000): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now); hits.set(key, recent); return true;
}
export function resetCepState(): void { cache.clear(); hits.clear(); }

type Outcome = { kind: 'ok'; data: CepData } | { kind: 'notFound' } | { kind: 'down' };

async function ask(f: typeof fetch, url: string, parse: (raw: unknown) => CepData | null): Promise<Outcome> {
  let response: Response;
  try { response = await f(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(env.CEP_API_TIMEOUT_MS) }); }
  catch { return { kind: 'down' }; }
  if (response.status === 404 || response.status === 400) return { kind: 'notFound' };
  if (!response.ok) return { kind: 'down' };
  let raw: unknown;
  try { raw = await response.json(); } catch { return { kind: 'down' }; }
  const data = parse(raw);
  return data ? { kind: 'ok', data } : { kind: 'notFound' };
}

export async function lookupCep(input: string, opts: { requester: string; fetchImpl?: typeof fetch; now?: () => number } = { requester: 'anon' }): Promise<CepResult> {
  const cep = onlyCepDigits(input);
  if (!/^\d{8}$/.test(cep) || /^0{8}$/.test(cep)) throw new CepError('CEP_INVALID');
  if (!cepLookupEnabled()) throw new CepError('CEP_LOOKUP_DISABLED');
  const now = opts.now?.() ?? Date.now();
  const hit = cache.get(cep);
  if (hit && now - hit.at < CACHE_MS) return { ...hit.value, cached: true };
  if (!cepRateLimit(opts.requester, now)) throw new CepError('CEP_RATE_LIMITED');
  const f = opts.fetchImpl ?? fetch;
  const primary = (env.CEP_BASE_URL ?? 'https://brasilapi.com.br').replace(/\/+$/, '');
  const fallback = (env.CEP_FALLBACK_BASE_URL ?? 'https://viacep.com.br').replace(/\/+$/, '');
  const first = await ask(f, `${primary}/api/cep/v2/${cep}`, (raw) => normalizeBrasilApiCep(raw, cep));
  let found: { data: CepData; source: string } | null = first.kind === 'ok' ? { data: first.data, source: 'BrasilAPI' } : null;
  let reachable = first.kind !== 'down';
  if (!found) {
    // "não achou" na fonte principal não basta: a reserva também confere antes de dizer que o CEP não existe.
    const second = await ask(f, `${fallback}/ws/${cep}/json/`, (raw) => normalizeViaCep(raw, cep));
    if (second.kind === 'ok') found = { data: second.data, source: 'ViaCEP' };
    if (second.kind !== 'down') reachable = true;
  }
  if (!found) throw new CepError(reachable ? 'CEP_NOT_FOUND' : 'CEP_UNAVAILABLE');
  if (cache.size > 2000) cache.clear();
  cache.set(cep, { at: now, value: found });
  return { ...found, cached: false };
}
