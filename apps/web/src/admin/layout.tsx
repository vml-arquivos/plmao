import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, IconButton, Logo, ThemeSwitch } from '../shared/ui';
import { Icon, type IconName } from '../shared/icons';
import { NavGroup, routeActive } from '../shared/NavGroup';
import { initials } from '../shared/format';
import { ROLE_LABEL, type Permission } from './api';
import { useAdminSession } from './session';

interface NavItem { to: string; label: string; icon: IconName; perm: Permission; end?: boolean; superOnly?: boolean }
export const GROUPS: Array<{ title: string; icon: IconName; items: NavItem[] }> = [
  { title: 'Visão geral', icon: 'dashboard', items: [
    { to: '/', label: 'Painel', icon: 'dashboard', perm: 'VIEW_DASHBOARD', end: true },
    { to: '/resultados', label: 'Resultados', icon: 'bar-chart', perm: 'VIEW_DASHBOARD' }
  ] },
  { title: 'Clientes e CRM', icon: 'users', items: [
    { to: '/leads', label: 'Leads e CRM', icon: 'trending-up', perm: 'VIEW_CUSTOMERS' },
    { to: '/clientes', label: 'Clientes', icon: 'users', perm: 'VIEW_CUSTOMERS' },
    { to: '/lojas', label: 'Lojas', icon: 'building', perm: 'VIEW_CUSTOMERS' },
    { to: '/empresas', label: 'Empresas', icon: 'building', perm: 'VIEW_CUSTOMERS' }
  ] },
  { title: 'Atendimento', icon: 'message-circle', items: [
    { to: '/consultas', label: 'Consultas', icon: 'search', perm: 'VIEW_QUERIES' },
    { to: '/suporte', label: 'Suporte', icon: 'mail', perm: 'MANAGE_SUPPORT' }
  ] },
  { title: 'Dinheiro', icon: 'wallet', items: [
    { to: '/financeiro', label: 'Financeiro', icon: 'bar-chart', perm: 'MANAGE_BILLING' },
    { to: '/cobrancas', label: 'Cobranças e parcelas', icon: 'receipt', perm: 'MANAGE_BILLING' },
    { to: '/pagamentos', label: 'Pagamentos', icon: 'credit-card', perm: 'MANAGE_BILLING' },
    { to: '/notas-fiscais', label: 'Notas fiscais', icon: 'file-text', perm: 'MANAGE_FISCAL' },
    { to: '/contratos', label: 'Contratos', icon: 'file-text', perm: 'VIEW_CONTRACTS' }
  ] },
  { title: 'Preços e vendas', icon: 'tag', items: [
    { to: '/precos', label: 'Preços e margens', icon: 'tag', perm: 'MANAGE_PRICING' },
    { to: '/cupons', label: 'Cupons', icon: 'percent', perm: 'MANAGE_BILLING' },
    { to: '/parceiros', label: 'Parceiros e repasses', icon: 'wallet', perm: 'MANAGE_BILLING' }
  ] },
  { title: 'Site e conteúdo', icon: 'sparkles', items: [
    { to: '/catalogo', label: 'Vitrine de produtos', icon: 'sparkles', perm: 'MANAGE_CONTENT' },
    { to: '/guia', label: 'Guia de veículos', icon: 'car', perm: 'MANAGE_CONTENT' },
    { to: '/simulador', label: 'Simulador de financiamento', icon: 'calculator', perm: 'MANAGE_BILLING' },
    { to: '/artigos', label: 'Artigos e blog', icon: 'file-text', perm: 'MANAGE_CONTENT' },
    { to: '/faq', label: 'Perguntas frequentes', icon: 'info', perm: 'MANAGE_CONTENT' },
    { to: '/depoimentos', label: 'Depoimentos', icon: 'users', perm: 'MANAGE_CONTENT' },
    { to: '/seo', label: 'SEO e Google', icon: 'search', perm: 'MANAGE_CONTENT' }
  ] },
  { title: 'Sistema', icon: 'settings', items: [
    { to: '/equipe', label: 'Equipe e acessos', icon: 'key', perm: 'MANAGE_TEAM' },
    { to: '/integracoes', label: 'Integrações', icon: 'settings', perm: 'MANAGE_PROVIDERS' },
    { to: '/auditoria', label: 'Auditoria', icon: 'shield-check', perm: 'VIEW_AUDIT' },
    { to: '/sistema', label: 'Sistema', icon: 'settings', perm: 'VIEW_AUDIT' },
    { to: '/dados-de-teste', label: 'Limpar dados de teste', icon: 'trash', perm: 'VIEW_AUDIT', superOnly: true }
  ] }
];

/** Primeira tela que a pessoa pode abrir (usada quando ela não tem acesso ao painel inicial). */
export function firstAllowedRoute(can: (p: Permission) => boolean): string {
  for (const g of GROUPS) for (const i of g.items) if (can(i.perm)) return i.to;
  return '/conta';
}

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
            const items = g.items.filter((i) => can(i.perm) && (!i.superOnly || user?.role === 'SUPER_ADMIN'));
            if (!items.length) return null;
            return (
              <NavGroup key={g.title} id={g.title} title={g.title} icon={g.icon} prefix="adm" storeKey="pnm_nav_adm" active={items.some((i) => routeActive(loc.pathname, i.to, i.end))}>
                {items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={i.icon} size={18} />{i.label}</NavLink>)}
              </NavGroup>
            );
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
