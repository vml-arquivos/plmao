/**
 * Google Analytics 4 e Google Ads, com consentimento (LGPD).
 * Os IDs vêm do servidor como meta tags (GA_MEASUREMENT_ID, GOOGLE_ADS_ID, GOOGLE_ADS_PURCHASE_LABEL).
 * Sem ID configurado, nada é carregado. O script do Google só entra depois que a pessoa aceita os cookies.
 */
type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

const CONSENT_KEY = 'pnm_cookie_consent';
export type Consent = 'granted' | 'denied' | null;

const meta = (name: string): string => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? '';
const ids = () => ({ ga: meta('pnm-ga'), ads: meta('pnm-ads'), adsLabel: meta('pnm-ads-purchase') });

export const analyticsConfigured = (): boolean => { const i = ids(); return Boolean(i.ga || i.ads); };
export function storedConsent(): Consent {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === 'granted' || v === 'denied' ? v : null; } catch { return null; }
}

let loaded = false;
function load(): void {
  const { ga, ads } = ids();
  const first = ga || ads;
  if (loaded || !first) return;
  loaded = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() { (window.dataLayer as unknown[]).push(arguments); } as Gtag;
  window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  window.gtag('js', new Date());
  window.gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  if (ga) window.gtag('config', ga, { send_page_view: false, anonymize_ip: true });
  if (ads) window.gtag('config', ads);
  const s = document.createElement('script');
  s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(first)}`;
  document.head.appendChild(s);
}

export function setConsent(value: 'granted' | 'denied'): void {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* sem armazenamento: vale só nesta visita */ }
  if (value === 'granted') { load(); pageView(window.location.pathname); }
  else if (window.gtag) window.gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
}

/** Chamado uma vez ao abrir o app: se já havia aceite, carrega na hora. */
export function initAnalytics(): void { if (analyticsConfigured() && storedConsent() === 'granted') load(); }

/** Caminho sem dados pessoais: ids viram ":id" e a query nunca é enviada (placas, códigos, tokens). */
export function safePath(pathname: string): string {
  return pathname.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/[A-Z0-9]{7,8}(?=\/|$)/g, '/:placa').slice(0, 120) || '/';
}

export function pageView(pathname: string): void {
  if (!window.gtag || storedConsent() !== 'granted') return;
  const path = safePath(pathname);
  window.gtag('event', 'page_view', { page_path: path, page_location: `${window.location.origin}${path}`, page_title: document.title });
}

export function trackEvent(name: string, params: Record<string, string | number | boolean> = {}): void {
  if (!window.gtag || storedConsent() !== 'granted') return;
  window.gtag('event', name, params);
}

/** Compra concluída: evento `purchase` do GA4 e, se houver rótulo, a conversão do Google Ads. */
export function trackPurchase(opts: { id: string; valueCents?: number; item?: string }): void {
  if (!window.gtag || storedConsent() !== 'granted') return;
  const key = `pnm_purchase_${opts.id}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* segue */ }
  const value = opts.valueCents != null ? Math.round(opts.valueCents) / 100 : undefined;
  window.gtag('event', 'purchase', { transaction_id: opts.id, currency: 'BRL', ...(value != null ? { value } : {}), ...(opts.item ? { items: [{ item_name: opts.item }] } : {}) });
  const { ads, adsLabel } = ids();
  if (ads && adsLabel) window.gtag('event', 'conversion', { send_to: `${ads}/${adsLabel}`, transaction_id: opts.id, currency: 'BRL', ...(value != null ? { value } : {}) });
}

/** Eventos do funil interno viram eventos do GA4 (sem dados pessoais). */
const MAP: Record<string, string> = {
  PLATE_CAPTURED: 'plate_search', FIPE_FORM_SUBMITTED: 'fipe_search', FIPE_RESULT_VIEWED: 'fipe_result', ACCOUNT_CREATED: 'sign_up',
  CHECKOUT_QUOTE_VIEWED: 'view_item', CHECKOUT_STARTED: 'begin_checkout', CTA_CLICKED: 'cta_click'
};
export function mirrorFunnel(event: string, metadata: Record<string, unknown>): void {
  const name = MAP[event]; if (!name) return;
  const params: Record<string, string | number | boolean> = {};
  if (typeof metadata.amountCents === 'number') { params.value = metadata.amountCents / 100; params.currency = 'BRL'; }
  if (typeof metadata.placement === 'string') params.placement = metadata.placement.slice(0, 40);
  trackEvent(name, params);
}
