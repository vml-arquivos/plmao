import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { analyticsConfigured, initAnalytics, pageView, setConsent, storedConsent } from '../analytics';

/** Aviso de cookies (LGPD) e envio das visualizações de página. Só aparece se o Google Analytics/Ads estiver configurado. */
export default function ConsentBanner() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    initAnalytics();
    if (analyticsConfigured() && storedConsent() === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener('pnm:cookie-prefs', reopen);
    return () => window.removeEventListener('pnm:cookie-prefs', reopen);
  }, []);
  useEffect(() => { pageView(pathname); }, [pathname]);
  useEffect(() => { const d = document.documentElement; if (open) d.setAttribute('data-consent-open', ''); else d.removeAttribute('data-consent-open'); return () => d.removeAttribute('data-consent-open'); }, [open]);
  if (!open) return null;
  const choose = (v: 'granted' | 'denied') => { setConsent(v); setOpen(false); };
  return (
    <div className="consent" role="dialog" aria-label="Preferências de cookies" aria-live="polite">
      <p>Usamos cookies para medir o uso do site e melhorar a Placa na Mão. Você escolhe. <Link to="/privacidade">Política de Privacidade</Link></p>
      <div className="consent-actions">
        <button type="button" className="btn btn-sm" onClick={() => choose('denied')}>Recusar</button>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => choose('granted')}>Aceitar</button>
      </div>
    </div>
  );
}

export const openCookiePrefs = () => window.dispatchEvent(new Event('pnm:cookie-prefs'));
