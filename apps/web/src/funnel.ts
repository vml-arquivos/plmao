type FunnelMetadata = Record<string, string | number | boolean | null | undefined>;

const SESSION_KEY = 'buscarr_funnel_session';
const ATTRIBUTION_KEY = 'buscarr_funnel_attribution';
const ALLOWED_ATTRIBUTION = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'] as const;

function sessionId(): string {
  const current = localStorage.getItem(SESSION_KEY);
  if (current && /^[a-zA-Z0-9-]{16,80}$/.test(current)) return current;
  const next = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(SESSION_KEY, next);
  return next;
}

function attribution(): Record<string, string> {
  const current = sessionStorage.getItem(ATTRIBUTION_KEY);
  if (current) {
    try { return JSON.parse(current) as Record<string, string>; } catch { /* recria abaixo */ }
  }
  const url = new URL(window.location.href);
  const values: Record<string, string> = {};
  for (const key of ALLOWED_ATTRIBUTION) {
    const value = url.searchParams.get(key)?.trim().slice(0, 120);
    if (value) values[key] = value;
  }
  if (document.referrer) {
    try {
      const host = new URL(document.referrer).hostname;
      if (host && host !== window.location.hostname) values.referrer = host.slice(0, 120);
    } catch { /* referência inválida é ignorada */ }
  }
  sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(values));
  return values;
}

export function trackFunnel(event: string, metadata: FunnelMetadata = {}): void {
  const cleanMetadata = Object.fromEntries(
    Object.entries({ ...attribution(), ...metadata })
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null)
      .map(([key, value]) => [key.slice(0, 60), typeof value === 'string' ? value.slice(0, 160) : value])
  );
  const payload = JSON.stringify({ event, sessionId: sessionId(), path: window.location.pathname, metadata: cleanMetadata });
  void fetch('/api/funnel/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
    cache: 'no-store'
  }).catch(() => undefined);
}
