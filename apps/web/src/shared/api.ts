export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status; this.code = code; this.data = data;
  }
}

type Store = 'local' | 'session';
export interface ApiClientOptions { tokenKey: string; store: Store; onUnauthorized?: () => void }
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RequestOptions { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; query?: Record<string, string | number | boolean | null | undefined> }

function storage(kind: Store): Storage | null { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; } }

export function createApi(opts: ApiClientOptions) {
  const token = {
    get: (): string | null => { try { return storage(opts.store)?.getItem(opts.tokenKey) ?? null; } catch { return null; } },
    set: (value: string) => { try { storage(opts.store)?.setItem(opts.tokenKey, value); } catch { /* armazenamento indisponível */ } },
    clear: () => { try { storage(opts.store)?.removeItem(opts.tokenKey); } catch { /* ignore */ } }
  };

  function url(path: string, query?: RequestOptions['query']): string {
    const u = new URL(`/api${path}`, window.location.origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.pathname + u.search;
  }

  async function raw(method: Method, path: string, o: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...o.headers };
    const t = token.get();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url(path, o.query), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), cache: 'no-store', signal: o.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
    }
    if (res.status === 401 && t && opts.onUnauthorized) opts.onUnauthorized();
    return res;
  }

  async function request<T>(method: Method, path: string, o: RequestOptions = {}): Promise<T> {
    const res = await raw(method, path, o);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) { try { data = JSON.parse(text) as Record<string, unknown>; } catch { data = {}; } }
    if (!res.ok) throw new ApiError(res.status, String(data.error ?? 'ERROR'), String(data.message ?? 'Não foi possível concluir a operação. Tente novamente.'), data);
    return data as T;
  }

  /** Baixa um arquivo autenticado (PDF/CSV) e dispara o download no navegador. */
  async function download(path: string, filename: string, o: RequestOptions & { method?: 'GET' | 'POST' } = {}): Promise<void> {
    const res = await raw(o.method ?? 'GET', path, { ...o, headers: { Accept: '*/*', ...o.headers } });
    if (!res.ok) {
      let message = 'Não foi possível baixar o arquivo agora.';
      try { const d = await res.json() as { message?: string }; if (d.message) message = d.message; } catch { /* corpo não-JSON */ }
      throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  return {
    token,
    get: <T,>(path: string, o?: RequestOptions) => request<T>('GET', path, o),
    post: <T,>(path: string, body?: unknown, o?: RequestOptions) => request<T>('POST', path, { ...o, body: body ?? {} }),
    put: <T,>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PUT', path, { ...o, body: body ?? {} }),
    patch: <T,>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PATCH', path, { ...o, body: body ?? {} }),
    del: <T,>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
    download
  };
}
export type Api = ReturnType<typeof createApi>;
export const errorMessage = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.');
