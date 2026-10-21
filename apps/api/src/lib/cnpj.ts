import { env } from '../config.js';
import { pool } from '../db.js';
import { isValidCnpj, onlyDigits } from './br.js';

/**
 * Consulta de CNPJ feita no servidor (nunca no navegador). Devolve só o necessário para pré-preencher um cadastro,
 * que o usuário revisa antes de salvar. Não guarda nem repassa quadro societário, e-mail ou telefone.
 * Fonte: BrasilAPI (GET {base}/api/cnpj/v1/{cnpj}), desligada por padrão (CNPJ_PROVIDER=disabled).
 */
export interface CnpjData {
  cnpj: string; legalName: string | null; tradeName: string | null; situation: string | null; openedAt: string | null;
  mainActivity: { code: string | null; description: string | null }; legalNature: string | null;
  address: { zip: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null };
}
export interface CnpjResult { data: CnpjData; source: string; fetchedAt: string; cached: boolean }
export class CnpjError extends Error { constructor(public code: 'CNPJ_INVALID' | 'CNPJ_NOT_FOUND' | 'CNPJ_LOOKUP_DISABLED' | 'CNPJ_RATE_LIMITED' | 'CNPJ_UNAVAILABLE') { super(code); } }

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const digits = (v: unknown): string | null => { const d = onlyDigits(typeof v === 'number' ? String(v) : (v as string | null)); return d || null; };

/** Converte a resposta do provedor no formato mínimo. Campos ausentes viram null (nunca inventados). */
export function normalizeBrasilApi(raw: unknown, cnpj: string): CnpjData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const opened = str(r.data_inicio_atividade, 10);
  return {
    cnpj,
    legalName: str(r.razao_social, 160), tradeName: str(r.nome_fantasia, 160), situation: str(r.descricao_situacao_cadastral, 60),
    openedAt: opened && /^\d{4}-\d{2}-\d{2}$/.test(opened) ? opened : null,
    mainActivity: { code: digits(r.cnae_fiscal), description: str(r.cnae_fiscal_descricao, 200) },
    legalNature: str(r.natureza_juridica, 120),
    address: {
      zip: digits(r.cep), street: [str(r.descricao_tipo_de_logradouro, 30), str(r.logradouro, 160)].filter(Boolean).join(' ') || null,
      number: str(r.numero, 20), complement: str(r.complemento, 80), district: str(r.bairro, 80), city: str(r.municipio, 80),
      state: typeof r.uf === 'string' && /^[A-Za-z]{2}$/.test(r.uf) ? r.uf.toUpperCase() : null
    }
  };
}

export const cnpjLookupEnabled = () => env.CNPJ_PROVIDER !== 'disabled';

// limite por solicitante (memória do processo): 20 consultas / 10 min
const hits = new Map<string, number[]>();
export function cnpjRateLimit(key: string, now = Date.now(), max = 20, windowMs = 600_000): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now); hits.set(key, recent); return true;
}

export async function lookupCnpj(input: string, opts: { requester: string; fetchImpl?: typeof fetch; now?: () => number } = { requester: 'anon' }): Promise<CnpjResult> {
  const cnpj = onlyDigits(input);
  if (!isValidCnpj(cnpj)) throw new CnpjError('CNPJ_INVALID');
  if (!cnpjLookupEnabled()) throw new CnpjError('CNPJ_LOOKUP_DISABLED');
  const ttl = env.CNPJ_CACHE_TTL_HOURS;
  if (ttl > 0) {
    const c = await pool.query(`SELECT data,source,fetched_at FROM cnpj_cache WHERE cnpj=$1 AND fetched_at > now() - make_interval(hours => $2::int)`, [cnpj, ttl]);
    if (c.rowCount) return { data: c.rows[0].data as CnpjData, source: c.rows[0].source, fetchedAt: new Date(c.rows[0].fetched_at).toISOString(), cached: true };
  }
  if (!cnpjRateLimit(opts.requester, opts.now?.())) throw new CnpjError('CNPJ_RATE_LIMITED');
  const base = (env.CNPJ_BASE_URL ?? 'https://brasilapi.com.br').replace(/\/+$/, '');
  const f = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await f(`${base}/api/cnpj/v1/${cnpj}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(env.CNPJ_API_TIMEOUT_MS) });
  } catch { throw new CnpjError('CNPJ_UNAVAILABLE'); }
  if (response.status === 404 || response.status === 400) throw new CnpjError('CNPJ_NOT_FOUND');
  if (response.status === 429) throw new CnpjError('CNPJ_RATE_LIMITED');
  if (!response.ok) throw new CnpjError('CNPJ_UNAVAILABLE');
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new CnpjError('CNPJ_UNAVAILABLE'); }
  const data = normalizeBrasilApi(raw, cnpj);
  if (!data.legalName) throw new CnpjError('CNPJ_UNAVAILABLE');
  const source = 'BrasilAPI';
  const saved = await pool.query(`INSERT INTO cnpj_cache(cnpj,data,source,fetched_at) VALUES($1,$2::jsonb,$3,now())
    ON CONFLICT(cnpj) DO UPDATE SET data=EXCLUDED.data,source=EXCLUDED.source,fetched_at=now() RETURNING fetched_at`, [cnpj, JSON.stringify(data), source]);
  return { data, source, fetchedAt: new Date(saved.rows[0].fetched_at).toISOString(), cached: false };
}
