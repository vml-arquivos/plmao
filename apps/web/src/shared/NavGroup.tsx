import { useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

const read = (key: string): Record<string, boolean> => { try { const v = JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown; return v && typeof v === 'object' ? (v as Record<string, boolean>) : {}; } catch { return {}; } };
const write = (key: string, v: Record<string, boolean>) => { try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento: o menu funciona do mesmo jeito */ } };

/** Rota "item" está ativa quando o endereço é o dela ou está dentro dela. */
export const routeActive = (pathname: string, to: string, end?: boolean) => (end || to === '/' ? pathname === to : pathname === to || pathname.startsWith(`${to}/`));

/**
 * Módulo do menu: um título que abre e fecha os itens do mesmo assunto.
 * Abre sozinho quando a pessoa está numa tela do módulo e lembra o que ela abriu ou fechou neste aparelho.
 */
export function NavGroup({ id, title, icon, active, storeKey, prefix, children }: { id: string; title: string; icon?: IconName; active: boolean; storeKey: string; prefix: 'app' | 'adm'; children: ReactNode }) {
  const body = useId();
  const [open, setOpen] = useState<boolean>(() => active || read(storeKey)[id] === true);
  useEffect(() => { if (active) setOpen(true); }, [active]);
  const toggle = () => setOpen((o) => { const next = !o; const m = read(storeKey); m[id] = next; write(storeKey, m); return next; });
  return (
    <div className={`${prefix}-mod${open ? ' open' : ''}${active ? ' has-active' : ''}`}>
      <button type="button" className={`${prefix}-mod-h`} aria-expanded={open} aria-controls={body} onClick={toggle}>
        {icon && <Icon name={icon} size={18} />}
        <span>{title}</span>
        <Icon name="chevron-down" size={16} className="ico chev" />
      </button>
      <div id={body} className={`${prefix}-mod-b`} hidden={!open}>{children}</div>
    </div>
  );
}
