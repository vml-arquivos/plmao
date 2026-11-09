import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../shared/icons';
import { Button, LinkButton, Logo, PageLoading, ThemeSwitch } from '../shared/ui';
import { initials, money } from '../shared/format';
import { BRAND } from './config';
import { useActiveProfile, useSession, type UsageProfile } from './session';
import ProfileSwitch from './components/ProfileSwitch';
import { analyticsConfigured } from './analytics';
import { InstallButton, InstallLink, InstallPrompt, OfflineBanner } from './components/PwaBits';
import SupportChannels from './components/SupportChannels';

/* ---------- Rolagem ao navegar ---------- */
export function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) { setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); return; }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

/* ---------- Site público ---------- */
type PubLink = { to: string; label: string };
type PubItem = PubLink | { label: string; children: PubLink[] };
/** Menu do site: poucos itens no topo; o que tem o mesmo assunto fica agrupado. */
const NAV: PubItem[] = [
  { to: '/', label: 'Início' },
  { to: '/planos', label: 'Consultas e preços' },
  { to: '/fipe', label: 'Tabela FIPE' },
  { to: '/simulador', label: 'Simulador' },
  { label: 'Veículos', children: [
    { to: '/veiculos', label: 'Guia de veículos' },
    { to: '/comparar', label: 'Comparar veículos' },
    { to: '/veiculos/mais-economicos', label: 'Carros mais econômicos' },
    { to: '/combustivel', label: 'Etanol ou gasolina?' }
  ] },
  { label: 'Ajuda', children: [
    { to: '/blog', label: 'Blog' },
    { to: '/perguntas-frequentes', label: 'Perguntas frequentes' },
    { to: '/sobre', label: 'Sobre' },
    { to: '/contato', label: 'Contato' }
  ] }
];

function PubDropdown({ label, children, pathname }: { label: string; children: PubLink[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const current = children.some((c) => c.to === pathname);
  return (
    <div className="pub-dd" ref={ref}>
      <button type="button" className="pub-dd-btn" aria-expanded={open} aria-haspopup="true" data-current={current || undefined} onClick={() => setOpen((v) => !v)}>
        {label}<Icon name="chevron-down" size={15} />
      </button>
      {open && <div className="pub-dd-panel" role="menu">{children.map((c) => <Link key={c.to} to={c.to} role="menuitem" aria-current={c.to === pathname ? 'page' : undefined}>{c.label}</Link>)}</div>}
    </div>
  );
}

export function PublicHeader({ overHero = false }: { overHero?: boolean }) {
  const { status } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { const on = () => setScrolled(window.scrollY > 24); on(); window.addEventListener('scroll', on, { passive: true }); return () => window.removeEventListener('scroll', on); }, []);
  useEffect(() => setOpen(false), [pathname]);
  const flat = overHero && !scrolled;
  return (
    <>
      <header className={`pub-nav ${flat ? 'over-hero' : ''}`}>
        <div className="container">
          <Link to="/" aria-label="Placa na Mão — início"><Logo /></Link>
          <nav className="pub-links" aria-label="Principal">
            {NAV.map((n) => 'children' in n
              ? <PubDropdown key={n.label} label={n.label} children={n.children} pathname={pathname} />
              : <Link key={n.to} to={n.to} aria-current={n.to === pathname ? 'page' : undefined}>{n.label}</Link>)}
          </nav>
          <div className="pub-cta">
            <ThemeSwitch />
            {status === 'authed' ? <LinkButton to="/app" variant="primary" size="sm">Minha área</LinkButton> : (
              <>
                <LinkButton to="/entrar" variant={flat ? 'outline-light' : 'default'} size="sm" className="hide-m">Entrar</LinkButton>
                <LinkButton to="/criar-conta" variant="primary" size="sm" className="hide-m">Criar conta</LinkButton>
              </>
            )}
            <button type="button" className="icon-btn pub-burger" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="menu" /></button>
          </div>
        </div>
      </header>
      {open && (
        <div className="drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="row-between" style={{ marginBottom: 10 }}><Logo /><button type="button" className="icon-btn" aria-label="Fechar menu" onClick={() => setOpen(false)}><Icon name="x" /></button></div>
            {NAV.map((n) => 'children' in n
              ? <div key={n.label} className="dgroup"><span className="dgroup-t">{n.label}</span>{n.children.map((c) => <Link key={c.to} to={c.to} className="dl">{c.label}</Link>)}</div>
              : <Link key={n.to} to={n.to} className="dl">{n.label}</Link>)}
            <div style={{ marginTop: 6 }}><InstallButton block label="Instalar o app" /></div>
            <hr className="divider" style={{ margin: '10px 0' }} />
            {status === 'authed' ? <LinkButton to="/app" variant="primary" block>Minha área</LinkButton> : <><LinkButton to="/criar-conta" variant="primary" block>Criar conta</LinkButton><LinkButton to="/entrar" block>Entrar</LinkButton></>}
          </div>
        </div>
      )}
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <div className="container">
        <div className="foot-grid">
          <div className="stack-sm">
            <Logo forceDark />
            <p style={{ maxWidth: 320, marginTop: 10 }}>Consulta veicular completa por placa, com relatório detalhado e PDF para imprimir. {BRAND.slogan}</p>
            <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>
            <SupportChannels />
          </div>
          <div><h5>Consultas</h5><ul><li><Link to="/consulta-placa">Consulta de placa</Link></li><li><Link to="/consultar-debitos-veiculo">Débitos e multas</Link></li><li><Link to="/consultar-gravame">Gravame</Link></li><li><Link to="/consultar-leilao-veiculo">Leilão</Link></li><li><Link to="/fipe">FIPE grátis</Link></li><li><Link to="/veiculos">Guia de veículos</Link></li><li><Link to="/comparar">Comparar veículos</Link></li><li><Link to="/veiculos/mais-economicos">Carros mais econômicos</Link></li><li><Link to="/combustivel">Etanol ou gasolina?</Link></li><li><Link to="/simulador">Simulador de financiamento</Link></li></ul></div>
          <div><h5>Empresa</h5><ul><li><Link to="/sobre">Sobre</Link></li><li><Link to="/para-lojistas">Para lojistas</Link></li><li><Link to="/blog">Blog</Link></li><li><InstallLink /></li><li><Link to="/perguntas-frequentes">Perguntas frequentes</Link></li><li><Link to="/contato">Contato</Link></li></ul></div>
          <div><h5>Legal</h5><ul><li><Link to="/termos">Termos de Uso</Link></li><li><Link to="/privacidade">Política de Privacidade</Link></li>{analyticsConfigured() && <li><button type="button" className="linkbtn light" onClick={() => window.dispatchEvent(new Event('pnm:cookie-prefs'))}>Preferências de cookies</button></li>}<li><Link to="/validar">Validar relatório</Link></li></ul></div>
        </div>
        <div className="foot-bottom"><span>© {new Date().getFullYear()} Placa na Mão. Todos os direitos reservados.</span><span>Os relatórios apoiam a decisão e não substituem vistoria ou consulta aos órgãos competentes.</span></div>
      </div>
    </footer>
  );
}

export function PublicLayout() {
  return (
    <>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <OfflineBanner />
      <PublicHeader />
      <main id="conteudo"><Outlet /></main>
      <PublicFooter />
      <InstallPrompt floating />
    </>
  );
}

/* ---------- Área logada ---------- */
type NavItem = { to: string; label: string; icon: IconName; end?: boolean; only?: UsageProfile[] };
type NavSection = { title?: string; items: NavItem[] };
/**
 * Menu por perfil de uso, em grupos pelo assunto. Cliente vê o essencial para consultar; lojista ganha a loja, a consulta em lote
 * e a carteira de veículos; afiliado vê o painel de indicações. O menu é só navegação: o acesso a cada área é conferido no servidor.
 */
const SECTIONS: NavSection[] = [
  { items: [
    { to: '/app', label: 'Painel', icon: 'home', end: true, only: ['CLIENTE', 'LOJISTA'] },
    { to: '/app/parceiro', label: 'Indicações', icon: 'users', only: ['AFILIADO'] }
  ] },
  { title: 'Acompanhar', items: [
    { to: '/app/historico', label: 'Consultas', icon: 'clock' },
    { to: '/app/monitoramento', label: 'Monitoramento', icon: 'eye', only: ['CLIENTE', 'LOJISTA'] },
    { to: '/app/lote', label: 'Em lote', icon: 'list', only: ['LOJISTA'] }
  ] },
  { title: 'Garagem', items: [
    { to: '/app/garagem', label: 'Minha garagem', icon: 'car', only: ['CLIENTE', 'LOJISTA'] },
    { to: '/app/simulacoes', label: 'Simulações', icon: 'calculator', only: ['CLIENTE', 'LOJISTA'] }
  ] },
  { title: 'Loja', items: [
    { to: '/app/loja', label: 'Minha loja', icon: 'building', only: ['LOJISTA'] },
    { to: '/app/veiculos', label: 'Meus veículos', icon: 'car', only: ['LOJISTA'] }
  ] },
  { title: 'Carteira e convites', items: [
    { to: '/app/carteira', label: 'Carteira', icon: 'wallet' },
    { to: '/app/convites', label: 'Convites e indicações', icon: 'users' }
  ] },
  { title: 'Conta', items: [
    { to: '/app/suporte', label: 'Suporte', icon: 'mail' },
    { to: '/app/conta', label: 'Minha conta', icon: 'user' }
  ] }
];

function sectionsFor(profile: UsageProfile): NavSection[] {
  return SECTIONS.map((sec) => ({ ...sec, items: sec.items.filter((i) => !i.only || i.only.includes(profile)) })).filter((sec) => sec.items.length > 0);
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'anon') return <Navigate to={`/entrar?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function AppLinks({ sections, onGo }: { sections: NavSection[]; onGo?: () => void }) {
  return (
    <>
      {sections.map((sec, n) => (
        <div key={sec.title ?? `s${n}`} className="app-grp">
          {sec.title && <span className="app-grp-t">{sec.title}</span>}
          {sec.items.map((i) => <NavLink key={i.to + i.label} to={i.to} end={i.end} onClick={onGo} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={i.icon} /> {i.label}</NavLink>)}
        </div>
      ))}
    </>
  );
}

export function AppLayout() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc);
  }, [menu]);
  if (!me) return null;
  const profile = useActiveProfile();
  const sections = sectionsFor(profile);
  const homeTo = profile === 'AFILIADO' ? '/app/parceiro' : '/app';
  const out = async () => { await logout(); nav('/', { replace: true }); };
  return (
    <div className="app-shell">
      <aside className="app-side" aria-label="Menu da conta">
        <Link to="/app" className="logo"><Logo /></Link>
        <nav className="app-nav">
          <NavLink to="/app/consultar" className="cta"><Icon name="search" /> Nova consulta</NavLink>
          <AppLinks sections={sections} />
        </nav>
        <div className="app-side-foot">
          <ProfileSwitch />
          <div className="user-chip"><span className="avatar">{initials(me.user.name)}</span><span style={{ minWidth: 0 }}><b>{me.user.name.split(' ')[0]}</b><small className="truncate">{me.user.email}</small></span></div>
          <div className="row"><ThemeSwitch /><Button variant="ghost" size="sm" icon="log-out" onClick={out}>Sair</Button></div>
        </div>
      </aside>
      <div className="app-main">
        <div className="app-top">
          <Link to="/app" className="logo" aria-label="Início"><Logo /></Link>
          <Link to="/app/carteira" className="balance-chip" aria-label={`Saldo ${money(me.balanceCents)}. Abrir carteira`}><Icon name="wallet" size={18} />{money(me.balanceCents)}</Link>
          <span className="hide-d"><ThemeSwitch /></span>
        </div>
        <OfflineBanner />
        <main className="app-content" id="conteudo"><InstallPrompt /><Outlet /></main>
      </div>
      <nav className="app-tabbar" aria-label="Navegação">
        <NavLink to={homeTo} end className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="home" /><span>Início</span></NavLink>
        <NavLink to="/app/historico" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="clock" /><span>Consultas</span></NavLink>
        <NavLink to="/app/consultar" className={({ isActive }) => `mid ${isActive ? 'active' : ''}`}><span className="mi"><Icon name="search" size={24} /></span><span>Consultar</span></NavLink>
        <NavLink to="/app/carteira" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="wallet" /><span>Carteira</span></NavLink>
        <button type="button" className={menu ? 'active' : ''} aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}><Icon name="menu" /><span>Menu</span></button>
      </nav>
      {menu && (
        <div className="drawer app-sheet-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(false); }}>
          <div className="app-sheet" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="row-between"><span className="app-sheet-name"><span className="avatar">{initials(me.user.name)}</span><b>{me.user.name.split(' ')[0]}</b></span><button type="button" className="icon-btn" aria-label="Fechar menu" onClick={() => setMenu(false)}><Icon name="x" /></button></div>
            <nav className="app-nav"><AppLinks sections={sections} onGo={() => setMenu(false)} /></nav>
            <ProfileSwitch />
            <div className="row-between"><ThemeSwitch /><Button variant="ghost" size="sm" icon="log-out" onClick={out}>Sair</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
