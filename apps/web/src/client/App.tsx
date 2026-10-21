import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PageLoading } from '../shared/ui';
import { AppLayout, PublicLayout, RequireAuth, ScrollManager } from './layouts';
import { SEO_PAGES } from './content/seoPages';
import { useEffect } from 'react';
import { captureReferral } from './funnel';
import { api } from './api';
import { useSession } from './session';

const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const SeoPage = lazy(() => import('./pages/SeoPage'));
const Fipe = lazy(() => import('./pages/Fipe'));
const FuelPage = lazy(() => import('./pages/Fuel').then((m) => ({ default: m.FuelPage })));
const EconomyPage = lazy(() => import('./pages/Fuel').then((m) => ({ default: m.EconomyPage })));
const GuideHome = lazy(() => import('./pages/Guide').then((m) => ({ default: m.GuideHome })));
const CatalogVehiclePage = lazy(() => import('./pages/Guide').then((m) => ({ default: m.CatalogVehiclePage })));
const GuideModelPage = lazy(() => import('./pages/Guide').then((m) => ({ default: m.GuideModelPage })));
const Compare = lazy(() => import('./pages/Compare'));
const Simulator = lazy(() => import('./pages/Simulator'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const NewQuery = lazy(() => import('./pages/NewQuery'));
const History = lazy(() => import('./pages/History'));
const QueryDetail = lazy(() => import('./pages/QueryDetail'));
const Wallet = lazy(() => import('./pages/Wallet'));
const Partner = lazy(() => import('./pages/Partner'));
const Garage = lazy(() => import('./pages/Garage'));
const GarageVehicle = lazy(() => import('./pages/Garage').then((m) => ({ default: m.GarageVehicle })));
const FaqPage = lazy(() => import('./pages/Content').then((m) => ({ default: m.FaqPage })));
const BlogPage = lazy(() => import('./pages/Content').then((m) => ({ default: m.BlogPage })));
const BlogPostPage = lazy(() => import('./pages/Content').then((m) => ({ default: m.BlogPostPage })));
const Account = lazy(() => import('./pages/Account'));
const named = (key: string) => lazy(() => import('./pages/Public').then((m) => ({ default: (m as unknown as Record<string, React.ComponentType>)[key] })));
const GuestQuery = named('GuestQuery'); const PlansPage = named('PlansPage'); const ValidatePage = named('ValidatePage'); const About = named('About'); const Contact = named('Contact'); const NotFound = named('NotFound');
const Legal = lazy(() => import('./pages/Public').then((m) => ({ default: m.Legal })));

/** Trata retornos que chegam na raiz: login social, redefinição de senha e retorno do checkout. */
function Home() {
  const loc = useLocation();
  const { login } = useSession();
  const p = new URLSearchParams(loc.search);
  const ticket = p.get('oauth_ticket');
  useEffect(() => {
    if (!ticket) return;
    api.post<{ token: string }>('/auth/oauth/consume', { ticket }).then((r) => login(r.token)).catch(() => undefined).finally(() => { window.history.replaceState(null, '', '/app'); window.location.replace('/app'); });
  }, [ticket, login]);
  if (ticket) return <PageLoading />;
  if (p.get('oauth_error')) return <Navigate to={`/entrar?oauth_error=${encodeURIComponent(p.get('oauth_error')!)}`} replace />;
  if (p.get('reset_token')) return <Navigate to={`/entrar?reset_token=${encodeURIComponent(p.get('reset_token')!)}`} replace />;
  const checkout = p.get('checkout');
  if (checkout) return <Navigate to={`/app/carteira?checkout=${encodeURIComponent(checkout)}`} replace />;
  return <Landing />;
}

export default function App() {
  useEffect(() => { captureReferral(); }, []);
  return (
    <>
      <ScrollManager />
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/entrar" element={<Auth initial="login" />} />
          <Route path="/criar-conta" element={<Auth initial="register" />} />
          <Route path="/recuperar-senha" element={<Auth initial="forgot" />} />
          <Route element={<PublicLayout />}>
            <Route path="/consultar" element={<GuestQuery />} />
            <Route path="/fipe" element={<Fipe />} />
            <Route path="/veiculos" element={<GuideHome />} />
            <Route path="/veiculos/mais-economicos" element={<EconomyPage />} />
            <Route path="/combustivel" element={<FuelPage />} />
            <Route path="/veiculos/frota/:id" element={<CatalogVehiclePage />} />
            <Route path="/veiculos/:slug" element={<GuideModelPage />} />
            <Route path="/comparar" element={<Compare />} />
            <Route path="/simulador" element={<Simulator />} />
            <Route path="/simulador/:tipo" element={<Simulator />} />
            <Route path="/planos" element={<PlansPage />} />
            <Route path="/desenvolvedores" element={<Navigate to="/" replace />} />
            <Route path="/perguntas-frequentes" element={<FaqPage />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/:slug" element={<BlogPostPage />} />
            <Route path="/sobre" element={<About />} />
            <Route path="/contato" element={<Contact />} />
            <Route path="/termos" element={<Legal kind="terms" />} />
            <Route path="/privacidade" element={<Legal kind="privacy" />} />
            <Route path="/validar" element={<ValidatePage />} />
            <Route path="/validar/:code" element={<ValidatePage />} />
            <Route path="/validar-relatorio/:code" element={<ValidatePage />} />
            {SEO_PAGES.map((s) => <Route key={s.path} path={s.path} element={<SeoPage path={s.path} />} />)}
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="consultar" element={<NewQuery />} />
            <Route path="historico" element={<History />} />
            <Route path="consulta/:id" element={<QueryDetail />} />
            <Route path="carteira" element={<Wallet />} />
            <Route path="garagem" element={<Garage />} />
            <Route path="garagem/:id" element={<GarageVehicle />} />
            <Route path="parceiro" element={<Partner />} />
            <Route path="api" element={<Navigate to="/app" replace />} />
            <Route path="conta" element={<Account />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
