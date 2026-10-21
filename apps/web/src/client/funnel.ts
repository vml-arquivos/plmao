type Meta = Record<string, string | number | boolean | null | undefined>;
const SESSION_KEY = 'pnm_funnel_session';
const ATTR_KEY = 'pnm_funnel_attribution';
const ALLOWED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'] as const;

export function funnelSessionId(): string {
  try {
    const cur = localStorage.getItem(SESSION_KEY);
    if (cur && /^[a-zA-Z0-9-]{16,80}$/.test(cur)) return cur;
    const next = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, next);
    return next;
  } catch { return `anon-${Math.random().toString(36).slice(2)}-${Date.now()}`; }
}

/** Captura UTM/ref da primeira visita da sessão; `ref` também vira código de parceiro (persistido). */
export function attribution(): Record<string, string> {
  try {
    const cur = sessionStorage.getItem(ATTR_KEY);
    if (cur) return JSON.parse(cur) as Record<string, string>;
  } catch { /* recria */ }
  const url = new URL(window.location.href);
  const values: Record<string, string> = {};
  for (const key of ALLOWED) { const v = url.searchParams.get(key)?.trim().slice(0, 120); if (v) values[key] = v; }
  if (document.referrer) { try { const host = new URL(document.referrer).hostname; if (host && host !== window.location.hostname) values.referrer = host.slice(0, 120); } catch { /* ignora */ } }
  try { sessionStorage.setItem(ATTR_KEY, JSON.stringify(values)); } catch { /* ignora */ }
  return values;
}

const REF_KEY = 'pnm_partner_ref';
export function captureReferral(): void {
  const ref = new URL(window.location.href).searchParams.get('ref')?.trim().slice(0, 40);
  if (ref && /^[A-Za-z0-9_-]{3,40}$/.test(ref)) { try { localStorage.setItem(REF_KEY, ref.toUpperCase()); } catch { /* ignora */ } }
}
export function storedReferral(): string | undefined {
  try { return localStorage.getItem(REF_KEY) ?? undefined; } catch { return undefined; }
}

export type FunnelEvent = 'HOME_PAGE_VIEW' | 'SEO_PAGE_VIEW' | 'FIPE_PAGE_VIEW' | 'CTA_CLICKED' | 'PLATE_CAPTURED' | 'FIPE_FORM_SUBMITTED' | 'FIPE_RESULT_VIEWED' | 'FIPE_REPORT_ACTION' | 'AUTH_VIEWED' | 'AUTH_SUBMITTED' | 'ACCOUNT_CREATED' | 'AUTH_SUCCEEDED' | 'CHECKOUT_QUOTE_VIEWED' | 'CHECKOUT_STARTED';
export function trackFunnel(event: FunnelEvent, metadata: Meta = {}): void {
  const clean = Object.fromEntries(
    Object.entries({ ...attribution(), ...metadata })
      .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v) || v === null)
      .map(([k, v]) => [k.slice(0, 60), typeof v === 'string' ? v.slice(0, 160) : v])
  );
  const path = /^\/[a-zA-Z0-9/_-]*$/.test(window.location.pathname) ? window.location.pathname : '/';
  void fetch('/api/funnel/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, sessionId: funnelSessionId(), path, metadata: clean }), keepalive: true, cache: 'no-store' }).catch(() => undefined);
}
