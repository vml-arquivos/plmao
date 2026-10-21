import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from './icons';
import { errorMessage } from './api';
import { formatPlate } from './format';
import { useTheme, type ThemePref } from './theme';

/* ---------- Marca ---------- */
export function Logo({ mark = false, forceDark = false, className = '', height }: { mark?: boolean; forceDark?: boolean; className?: string; height?: number }) {
  const style = height ? { height } : undefined;
  return (
    <span className={`logo ${forceDark ? 'force-dark' : ''} ${className}`}>
      {mark ? (
        <img className="on-light on-dark" src="/brand/logo-app-icon.svg" alt="Placa na Mão" style={style} />
      ) : (
        <>
          <img className="on-light" src="/brand/logo-horizontal.svg" alt="Placa na Mão" style={style} />
          <img className="on-dark" src="/brand/logo-horizontal-dark.svg" alt="" aria-hidden="true" style={style} />
        </>
      )}
    </span>
  );
}

/* ---------- Botões ---------- */
type Variant = 'primary' | 'default' | 'ghost' | 'danger' | 'outline-light';
const cls = (v: Variant, size?: 'sm' | 'lg', block?: boolean, extra?: string) => ['btn', v === 'default' ? '' : `btn-${v}`, size ? `btn-${size}` : '', block ? 'btn-block' : '', extra ?? ''].filter(Boolean).join(' ');
export function Button({ variant = 'default', size, block, loading, icon, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean; loading?: boolean; icon?: IconName }) {
  return (
    <button type="button" {...rest} disabled={disabled || loading} className={cls(variant, size, block, className)}>
      {loading ? <span className="spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}
export function LinkButton({ variant = 'default', size, block, icon, iconRight, children, className, ...rest }: LinkProps & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean; icon?: IconName; iconRight?: IconName }) {
  return (
    <Link {...rest} className={cls(variant, size, block, className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}{children}{iconRight && <Icon name={iconRight} size={size === 'sm' ? 16 : 18} />}
    </Link>
  );
}
export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}><Icon name={icon} /></button>;
}

/* ---------- Dica com ícone "i" (passa o mouse, toca ou foca) ---------- */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = hover || pinned;
  useEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const r = btn.current.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12)) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => { setHover(false); setPinned(false); };
    const away = (e: Event) => { if (!btn.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    const t0 = Date.now();
    const onScroll = () => { if (Date.now() - t0 > 500) close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }, [open]);
  return (
    <span className="infotip">
      <button
        ref={btn} type="button" className="infotip-btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinned((v) => !v); }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false); }}
        onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      >i</button>
      {open && pos && <span id={id} role="tooltip" className="infotip-pop" style={{ top: pos.top, left: pos.left }}>{children}</span>}
    </span>
  );
}

/* ---------- Campos ---------- */
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span className="lbl">{label}</span>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
export function Input({ icon, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { icon?: IconName }) {
  if (!icon) return <input className={`input ${className ?? ''}`} {...rest} />;
  return <span className="input-group"><span className="ico"><Icon name={icon} size={18} /></span><input className={`input ${className ?? ''}`} {...rest} /></span>;
}
export const Select = ({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={`select ${className ?? ''}`} {...rest}>{children}</select>;
export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={`textarea ${className ?? ''}`} {...rest} />;
export function Check({ children, ...rest }: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return <label className="check"><input type="checkbox" {...rest} /><span>{children}</span></label>;
}
export function Switch({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="switch"><input type="checkbox" role="switch" {...rest} /><span>{label}</span></label>;
}

/* ---------- Blocos simples ---------- */
export function Badge({ tone = 'neutral', dot, children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'violet'; dot?: boolean; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{dot && <span className="dot" />}{children}</span>;
}
export function Alert({ tone = 'info', icon, title, children }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; icon?: IconName; title?: string; children?: ReactNode }) {
  const def: Record<string, IconName> = { info: 'info', ok: 'check-circle', warn: 'alert-triangle', danger: 'x-circle' };
  return <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}><Icon name={icon ?? def[tone]} /><div>{title && <b>{title}{children ? ' ' : ''}</b>}{children}</div></div>;
}
export const Spinner = ({ size = 20 }: { size?: number }) => <span className="spin" style={{ width: size, height: size }} role="status" aria-label="Carregando" />;
export const PageLoading = () => <div className="page-loading"><Spinner size={28} /></div>;
export const Skeleton = ({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) => <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
export function EmptyState({ icon = 'search', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="ico-wrap"><Icon name={icon} size={26} /></span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <div className="empty-state"><span className="ico-wrap" style={{ background: 'var(--danger-soft)', color: 'var(--danger-ink)' }}><Icon name="alert-triangle" size={26} /></span><h3>Não foi possível carregar</h3><p>{errorMessage(error)}</p>{onRetry && <Button onClick={onRetry} icon="refresh">Tentar de novo</Button>}</div>;
}
export function Stat({ label, value, sub, highlight }: { label: string; value: ReactNode; sub?: ReactNode; highlight?: boolean }) {
  return <div className={`stat ${highlight ? 'hl' : ''}`}><span className="k">{label}</span><span className="v">{value}</span>{sub && <span className="s">{sub}</span>}</div>;
}
export function PlateBadge({ plate, size }: { plate: string; size?: 'sm' | 'lg' | 'xl' }) {
  return <span className={`plate ${size ?? ''}`} role="img" aria-label={`Placa ${plate}`}><b>{formatPlate(plate).replace('-', '')}</b></span>;
}
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: string }>; label: string }) {
  return <div className="tabs" role="tablist" aria-label={label}>{items.map((i) => <button key={i.id} role="tab" type="button" className="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>{i.label}</button>)}</div>;
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.icon-btn)')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head"><h3 id={titleId}>{title}</h3><IconButton icon="x" label="Fechar" onClick={onClose} /></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
      <div className="stack-sm">{typeof message === 'string' ? <p>{message}</p> : message}</div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastCtx = createContext<{ ok: (t: string) => void; error: (t: string | unknown) => void }>({ ok: () => undefined, error: () => undefined });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  const api = useMemo(() => ({ ok: (t: string) => push('ok', t), error: (t: string | unknown) => push('error', typeof t === 'string' ? t : errorMessage(t)) }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}><Icon name={t.tone === 'ok' ? 'check-circle' : 'alert-triangle'} size={18} /><span>{t.text}</span></div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- Copiar ---------- */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <div className="copy-field">
      <input className="input" readOnly value={value} aria-label={label ?? 'Valor'} onFocus={(e) => e.currentTarget.select()} />
      <Button icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(value); toast.ok('Copiado!'); } catch { toast.error('Não foi possível copiar. Selecione e copie manualmente.'); } }}>Copiar</Button>
    </div>
  );
}

/* ---------- Tema ---------- */
export function ThemeSwitch({ className }: { className?: string }) {
  const [pref, setPref] = useTheme();
  const order: ThemePref[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(pref) + 1) % 3];
  const labels: Record<ThemePref, string> = { system: 'Tema: automático', light: 'Tema: claro', dark: 'Tema: escuro' };
  return <button type="button" className={`icon-btn ${className ?? ''}`} onClick={() => setPref(next)} aria-label={`${labels[pref]}. Alternar tema`} title={labels[pref]}><Icon name={pref === 'system' ? 'monitor' : pref === 'light' ? 'sun' : 'moon'} /></button>;
}

/* ---------- Dados assíncronos ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then((data) => { if (alive) setState({ data, loading: false }); }, (error) => { if (alive) setState({ error, loading: false }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (data: T) => setState({ data, loading: false }) };
}

/* ---------- Metadados da página ---------- */
export function usePageTitle(title: string): void {
  useEffect(() => { document.title = title ? `${title} | Placa na Mão` : 'Placa na Mão | Consulta veicular completa'; }, [title]);
}
