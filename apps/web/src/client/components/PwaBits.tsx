import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../shared/icons';
import { Button, Modal } from '../../shared/ui';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const DISMISS_KEY = 'pnm_install_dismissed_at';
const DISMISS_DAYS = 14;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
/** iPhone, iPad e iPadOS (que se apresenta como Mac com toque). No iOS todo navegador instala pelo menu Compartilhar. */
const isIos = () => typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isAndroid = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/* O evento do navegador pode chegar antes de a tela montar: guardamos no módulo. */
let deferred: InstallEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; installed = true; notify(); });
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export type InstallPlatform = 'android' | 'ios' | 'desktop';

/** Estado da instalação do app: se já está instalado, se o navegador oferece o botão nativo e qual o passo a passo do aparelho. */
export function useInstall() {
  const ready = useSyncExternalStore(subscribe, () => deferred !== null, () => false);
  useSyncExternalStore(subscribe, () => installed, () => false);
  const platform: InstallPlatform = isIos() ? 'ios' : isAndroid() ? 'android' : 'desktop';
  const standalone = isStandalone() || installed;
  /** Abre o convite nativo (Android e desktop). Devolve `false` quando só dá para orientar (iOS e navegadores sem o evento). */
  async function install(): Promise<boolean> {
    if (!deferred) return false;
    const ev = deferred; deferred = null; notify();
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice.outcome === 'accepted';
  }
  return { standalone, canPrompt: ready, platform, install };
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="ig-step"><span className="ig-n">{n}</span><span>{children}</span></li>;
}

/** Passo a passo da instalação para quem não tem o botão nativo. */
export function InstallGuide({ platform, onClose }: { platform: InstallPlatform; onClose: () => void }) {
  return (
    <Modal title="Instalar o Placa na Mão" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Entendi</Button>}>
      {platform === 'ios' ? (
        <ol className="ig-steps">
          <Step n={1}>Abra este site no <b>Safari</b> (no iPhone e no iPad a instalação é feita por ele).</Step>
          <Step n={2}>Toque em <b>Compartilhar</b> <Icon name="share" size={16} />, o quadrado com a seta para cima, na barra do Safari.</Step>
          <Step n={3}>Role e toque em <b>Adicionar à Tela de Início</b>.</Step>
          <Step n={4}>Toque em <b>Adicionar</b>. O ícone aparece na tela inicial e abre em tela cheia, como um aplicativo.</Step>
        </ol>
      ) : platform === 'android' ? (
        <ol className="ig-steps">
          <Step n={1}>Abra este site no <b>Chrome</b>.</Step>
          <Step n={2}>Toque nos <b>três pontinhos</b> no canto superior direito.</Step>
          <Step n={3}>Toque em <b>Instalar aplicativo</b> (ou <b>Adicionar à tela inicial</b>).</Step>
          <Step n={4}>Confirme em <b>Instalar</b>. O ícone aparece na tela inicial e na lista de aplicativos.</Step>
        </ol>
      ) : (
        <ol className="ig-steps">
          <Step n={1}>No <b>Chrome</b> ou no <b>Edge</b>, clique no ícone de instalar no fim da barra de endereço, ou abra o menu <b>⋮</b>.</Step>
          <Step n={2}>Clique em <b>Instalar Placa na Mão</b>.</Step>
          <Step n={3}>O aplicativo abre em janela própria e fica no menu iniciar, no Dock ou na área de trabalho.</Step>
        </ol>
      )}
    </Modal>
  );
}

/** Botão "Instalar app": abre o convite nativo quando o navegador oferece, senão mostra o passo a passo. Some depois de instalado. */
export function InstallButton({ variant = 'default', block, size, label = 'Instalar app' }: { variant?: 'default' | 'primary'; block?: boolean; size?: 'sm'; label?: string }) {
  const { standalone, platform, install } = useInstall();
  const [guide, setGuide] = useState(false);
  if (standalone) return null;
  return (
    <>
      <Button variant={variant} block={block} size={size} icon="smartphone" onClick={async () => { if (!(await install()) && !deferred) setGuide(true); }}>{label}</Button>
      {guide && <InstallGuide platform={platform} onClose={() => setGuide(false)} />}
    </>
  );
}

/** Link de texto "Instalar app" (rodapé). */
export function InstallLink() {
  const { standalone, platform, install } = useInstall();
  const [guide, setGuide] = useState(false);
  if (standalone) return null;
  return (
    <>
      <button type="button" className="foot-link" onClick={async () => { if (!(await install()) && !deferred) setGuide(true); }}>Instalar o app</button>
      {guide && <InstallGuide platform={platform} onClose={() => setGuide(false)} />}
    </>
  );
}

/**
 * Convite para instalar o app. `floating`: cartão fixo na parte de baixo (site público), aparece depois de alguns segundos.
 * Dispensar esconde por 14 dias.
 */
export function InstallPrompt({ floating = false }: { floating?: boolean }) {
  const { standalone, canPrompt, platform, install } = useInstall();
  const [hidden, setHidden] = useState(() => {
    const at = Number(read(DISMISS_KEY) ?? 0);
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86400000;
  });
  const [late, setLate] = useState(!floating);
  const [guide, setGuide] = useState(false);
  useEffect(() => { if (!floating) return; const t = setTimeout(() => setLate(true), 6000); return () => clearTimeout(t); }, [floating]);
  // Sem botão nativo, só insistimos no iOS (onde a instrução é o único caminho); nos demais, o botão fica no menu.
  const offer = canPrompt || platform === 'ios';
  if (standalone || hidden || !late || !offer) return null;
  const dismiss = () => { write(DISMISS_KEY, String(Date.now())); setHidden(true); };
  const go = async () => { if (canPrompt) { const ok = await install(); if (ok) setHidden(true); else dismiss(); } else setGuide(true); };
  return (
    <>
      <div className={`install-card ${floating ? 'floating' : ''}`} role="region" aria-label="Instalar aplicativo">
        <span className="ic"><Icon name="smartphone" size={22} /></span>
        <div className="grow">
          <b>Instale o Placa na Mão</b>
          <span>{canPrompt ? 'Abre direto da tela inicial, em tela cheia, como um aplicativo.' : 'Adicione à tela de início e use como um aplicativo.'}</span>
        </div>
        <Button variant="primary" size="sm" onClick={go}>{canPrompt ? 'Instalar' : 'Como instalar'}</Button>
        <button type="button" className="icon-btn" aria-label="Dispensar" onClick={dismiss}><Icon name="x" size={18} /></button>
      </div>
      {guide && <InstallGuide platform={platform} onClose={() => { setGuide(false); dismiss(); }} />}
    </>
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
