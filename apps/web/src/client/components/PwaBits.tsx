import { useEffect, useState } from 'react';
import { Icon } from '../../shared/icons';
import { Button } from '../../shared/ui';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const DISMISS_KEY = 'pnm_install_dismissed';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

/** Convite para instalar o app (Android/desktop via evento do navegador; iOS com instrução de "Adicionar à Tela de Início"). */
export function InstallPrompt() {
  const [ev, setEv] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(() => typeof window === 'undefined' || isStandalone() || read(DISMISS_KEY) === '1');
  const [ios] = useState(() => typeof window !== 'undefined' && isIos());
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEv(e as InstallEvent); };
    const done = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done); };
  }, []);
  if (hidden || (!ev && !ios)) return null;
  const dismiss = () => { write(DISMISS_KEY, '1'); setHidden(true); };
  const install = async () => { if (!ev) return; await ev.prompt(); const c = await ev.userChoice; if (c.outcome === 'accepted') setHidden(true); else dismiss(); };
  return (
    <div className="install-card" role="region" aria-label="Instalar aplicativo">
      <span className="ic"><Icon name="smartphone" size={22} /></span>
      <div className="grow">
        <b>Instale o Placa na Mão</b>
        <span>{ev ? 'Abra mais rápido, direto da tela inicial, como um aplicativo.' : 'No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'}</span>
      </div>
      {ev && <Button variant="primary" size="sm" onClick={install}>Instalar</Button>}
      <button type="button" className="icon-btn" aria-label="Dispensar" onClick={dismiss}><Icon name="x" size={18} /></button>
    </div>
  );
}

/** Aviso discreto quando o aparelho fica sem internet. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true); const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return <div className="offline-banner" role="status"><Icon name="alert-triangle" size={16} /> Você está sem internet. Consultas e pagamentos precisam de conexão.</div>;
}
