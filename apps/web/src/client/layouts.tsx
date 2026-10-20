import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../shared/icons';
import { Button, LinkButton, Logo, PageLoading, ThemeSwitch } from '../shared/ui';
import { initials, money } from '../shared/format';
import { BRAND } from './config';
import { useSession } from './session';
import { InstallPrompt, OfflineBanner } from './components/PwaBits';

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
const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Início' },
  { to: '/planos', label: 'Consultas e preços' },
  { to: '/blog', label: 'Blog' },
  { to: '/perguntas-frequentes', label: 'Perguntas' },
  { to: '/fipe', label: 'FIPE grátis' }
];

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
            {NAV.map((n) => <Link key={n.to} to={n.to} aria-current={n.to === pathname ? 'page' : undefined}>{n.label}</Link>)}
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
            {NAV.map((n) => <Link key={n.to} to={n.to} className="dl">{n.label}</Link>)}
            <Link to="/sobre" className="dl">Sobre</Link>
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
          </div>
          <div><h5>Consultas</h5><ul><li><Link to="/consulta-placa">Consulta de placa</Link></li><li><Link to="/consultar-debitos-veiculo">Débitos e multas</Link></li><li><Link to="/consultar-gravame">Gravame</Link></li><li><Link to="/consultar-leilao-veiculo">Leilão</Link></li><li><Link to="/fipe">FIPE grátis</Link></li></ul></div>
          <div><h5>Empresa</h5><ul><li><Link to="/sobre">Sobre</Link></li><li><Link to="/para-lojistas">Para lojistas</Link></li><li><Link to="/blog">Blog</Link></li><li><Link to="/perguntas-frequentes">Perguntas frequentes</Link></li><li><Link to="/contato">Contato</Link></li></ul></div>
          <div><h5>Legal</h5><ul><li><Link to="/termos">Termos de Uso</Link></li><li><Link to="/privacidade">Política de Privacidade</Link></li><li><Link to="/validar">Validar relatório</Link></li></ul></div>
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
    </>
  );
}

/* ---------- Área logada ---------- */
const ITEMS: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/app', label: 'Painel', icon: 'home', end: true },
  { to: '/app/historico', label: 'Histórico', icon: 'clock' },
  { to: '/app/carteira', label: 'Carteira', icon: 'wallet' },
  { to: '/app/parceiro', label: 'Parceiro', icon: 'users' },
  { to: '/app/conta', label: 'Minha conta', icon: 'user' }
];

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();
  if (status === 'loading') return <PageLoading />;
  if (status === 'anon') return <Navigate to={`/entrar?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function AppLayout() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  if (!me) return null;
  const out = async () => { await logout(); nav('/', { replace: true }); };
  return (
    <div className="app-shell">
      <aside className="app-side" aria-label="Menu da conta">
        <Link to="/app" className="logo"><Logo /></Link>
        <nav className="app-nav">
          <NavLink to="/app/consultar" className="cta"><Icon name="search" /> Nova consulta</NavLink>
          {ITEMS.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={i.icon} /> {i.label}</NavLink>)}
        </nav>
        <div className="app-side-foot">
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
        <NavLink to="/app" end className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="home" /><span>Início</span></NavLink>
        <NavLink to="/app/historico" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="clock" /><span>Histórico</span></NavLink>
        <NavLink to="/app/consultar" className={({ isActive }) => `mid ${isActive ? 'active' : ''}`}><span className="mi"><Icon name="search" size={24} /></span><span>Consultar</span></NavLink>
        <NavLink to="/app/carteira" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="wallet" /><span>Carteira</span></NavLink>
        <NavLink to="/app/conta" className={({ isActive }) => (isActive ? 'active' : '')}><Icon name="user" /><span>Conta</span></NavLink>
      </nav>
    </div>
  );
}
