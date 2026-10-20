import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, IconButton, Logo, ThemeSwitch } from '../shared/ui';
import { Icon, type IconName } from '../shared/icons';
import { initials } from '../shared/format';
import { ROLE_LABEL, type Permission } from './api';
import { useAdminSession } from './session';

interface NavItem { to: string; label: string; icon: IconName; perm: Permission; end?: boolean }
const GROUPS: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Visão geral', items: [{ to: '/', label: 'Painel', icon: 'dashboard', perm: 'VIEW_AUDIT', end: true }] },
  { title: 'Operação', items: [
    { to: '/consultas', label: 'Consultas', icon: 'search', perm: 'VIEW_AUDIT' },
    { to: '/usuarios', label: 'Usuários', icon: 'users', perm: 'MANAGE_USERS' },
    { to: '/suporte', label: 'Suporte', icon: 'mail', perm: 'VIEW_AUDIT' }
  ] },
  { title: 'Financeiro', items: [
    { to: '/financeiro', label: 'Financeiro', icon: 'bar-chart', perm: 'MANAGE_BILLING' },
    { to: '/precos', label: 'Preços e margens', icon: 'tag', perm: 'MANAGE_PRICING' },
    { to: '/pagamentos', label: 'Pagamentos', icon: 'credit-card', perm: 'MANAGE_BILLING' },
    { to: '/cupons', label: 'Cupons', icon: 'percent', perm: 'MANAGE_BILLING' },
    { to: '/parceiros', label: 'Parceiros e repasses', icon: 'wallet', perm: 'MANAGE_BILLING' }
  ] },
  { title: 'Sistema', items: [
    { to: '/auditoria', label: 'Auditoria', icon: 'shield-check', perm: 'VIEW_AUDIT' },
    { to: '/sistema', label: 'Sistema', icon: 'settings', perm: 'VIEW_AUDIT' }
  ] }
];

export default function AdminLayout() {
  const { user, can, logout, recoveryCodesRemaining } = useAdminSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="adm">
      <div className="adm-top no-print">
        <IconButton icon="menu" label="Abrir menu" onClick={() => setOpen(true)} />
        <span className="grow">Painel · Placa na Mão</span>
        <ThemeSwitch />
      </div>
      {open && <div className="overlay" onClick={() => setOpen(false)} style={{ zIndex: 150 }} />}
      <aside className={`adm-side ${open ? 'open' : ''}`} aria-label="Menu do painel">
        <Logo forceDark />
        <span className="adm-badge">Painel da equipe</span>
        <nav className="adm-nav">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => can(i.perm));
            if (!items.length) return null;
            return <div key={g.title} style={{ display: 'contents' }}><span className="group">{g.title}</span>{items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={i.icon} size={18} />{i.label}</NavLink>
            ))}</div>;
          })}
        </nav>
        <div className="adm-side-foot">
          <NavLink to="/conta" className="adm-me" title="Minha conta"><span className="av">{initials(user?.name ?? '?')}</span><div style={{ minWidth: 0 }}><b>{user?.name}</b><span>{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</span></div></NavLink>
          {recoveryCodesRemaining > 0 && recoveryCodesRemaining <= 2 && <span style={{ fontSize: 12, color: '#FCD679' }}>Restam {recoveryCodesRemaining} códigos de recuperação.</span>}
          <div className="row"><ThemeSwitch /><Button variant="ghost" size="sm" icon="log-out" onClick={() => void logout()}>Sair</Button></div>
        </div>
      </aside>
      <main className="adm-main" id="main"><div className="adm-page"><Outlet /></div></main>
    </div>
  );
}
