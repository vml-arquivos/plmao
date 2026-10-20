import { Fragment, type FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import AccountAuthScreen from './AccountAuthScreen';
import Brand from './Brand';
import LegalPage from './LegalPage';
import SeoLandingPage, { applySeoHead, seoPageForPath, type SeoPage } from './seo';
import { trackFunnel } from './funnel';
import './styles.css';

registerSW({ immediate: true });

const API = '/api';
type Theme = 'light' | 'dark' | 'system';
type View = 'consult' | 'history' | 'wallet' | 'settings' | 'admin';
type AdminTab = 'overview' | 'users' | 'queries' | 'products' | 'payments' | 'audit' | 'lookup' | 'settings' | 'coupons' | 'affiliates' | 'organizations' | 'support';
const isTeamRole = (role?: string) => role === 'OPERADOR' || role === 'ADMIN' || role === 'SUPER_ADMIN';
const firstAdminTabFor = (permissions: string[]): AdminTab => permissions.includes('VIEW_AUDIT') ? 'overview' : permissions.includes('MANAGE_USERS') ? 'users' : permissions.includes('MANAGE_BILLING') ? 'payments' : permissions.includes('MANAGE_PRICING') ? 'products' : 'lookup';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
type Product = { id: string; name: string; description: string; priceCents: number; basePriceCents?: number; negotiated?: boolean; referencePriceCents?: number | null; active?: boolean; slug?: string; features?: string[]; isFree?: boolean; featured?: boolean; displayOrder?: number; source?: string | null; coverage?: string | null; commercialStatus?: string; reportTemplate?: { id: string; version: number; name: string; status: string } | null };
type FipeItem = { code: string; name: string };
type FipeOffer = { id: string; name: string; description: string; priceCents: number; features?: string[]; commercialStatus?: string; featured?: boolean };
type FipeVehicleDetails = { plate: string; brand?: string; model?: string; fullModel?: string; manufactureYear?: string; modelYear?: string; color?: string; fuel?: string; power?: string; displacement?: string; type?: string; species?: string; category?: string; body?: string; passengers?: string; loadCapacity?: string; origin?: string; city?: string; state?: string; licensingYear?: string; status?: string };
type FipeQuote = { documentCode: string; reportHash: string; consultedAt: string; referenceMonth: string; vehicleType: 'cars' | 'motorcycles' | 'trucks'; brand: FipeItem; model: FipeItem; year: FipeItem; fuel?: string; fipeCode: string; valueCents: number; valueLabel: string; estimatedNegotiation?: { minCents: number; maxCents: number; disclaimer: string }; blocks: Array<{ key: string; label: string; state: string; message: string }>; plate?: string; vehicleDetails?: FipeVehicleDetails };
const fipeTypeLabels: Record<FipeQuote['vehicleType'], string> = { cars: 'Carros', motorcycles: 'Motos', trucks: 'Caminhões' };
type User = { id: string; email: string; name: string; role: string };
type Profile = { id: string; email: string; name: string; role: string; passwordEnabled: boolean; cpfCnpj: string; phone: string; companyName: string; city: string; state: string; marketingOptIn: boolean };
type Debt = { key: string; label: string; amountCents: number; hasDebt: boolean };
type Restriction = { key: string; label: string; status: string; alert: boolean };
type CoverageState = 'FOUND' | 'NOT_QUERIED' | 'PENDING';
type CoverageKey = 'identification' | 'debts' | 'restrictions' | 'recall';
type Report = {
  identification: { plate: string; renavam?: string; chassis?: string; engine?: string; gearbox?: string; brand?: string; model?: string; fullModel?: string };
  characteristics: { manufactureYear?: string; modelYear?: string; color?: string; fuel?: string; power?: string; displacement?: string; type?: string; species?: string; category?: string; body?: string; axles?: string; passengers?: string; loadCapacity?: string; origin?: string };
  registration: { city?: string; state?: string; licensingDate?: string; licensingYear?: string; status?: string };
  owner: { name?: string; document?: string; documentType?: string };
  debts: Debt[];
  restrictions: Restriction[];
  recall?: string;
  coverage?: Partial<Record<CoverageKey, CoverageState>>;
  diagnostic: { level: 'CLEAR' | 'ATTENTION' | 'HIGH_RISK'; title: string; reason: string };
};
type Query = { id: string; plate: string; productId: string; productName: string; status: string; priceCents: number; chargeSource?: string; provider: string; createdAt: string; completedAt?: string; result: Report | null; verificationCode?: string };
type Transaction = { id: string; kind: string; amountCents: number; balanceBeforeCents: number; balanceAfterCents: number; description: string; createdAt: string };
type Me = { user: User; balanceCents: number; permissions: string[]; identities?: string[]; profile?: Profile };
type OAuthProviderStatus = { id: 'google' | 'microsoft' | 'apple'; label: string; enabled: boolean };
type AdminSeriesRow = { date: string; queries: number; successful_queries: number; sales: number; revenue_cents: number; users: number };
type AdminSummary = { active_users: string; new_users_30d: string; queries_today: string; successful_queries: string; failed_queries: string; refunds: string; queries_billed_cents: string; query_revenue_cents: string; query_sales: string; confirmed_revenue_cents: string; confirmed_sales: string; average_ticket_cents: string; open_checkout_cents: string; refunded_revenue_cents: string; prepaid_balance_cents: string; fipe_started?: string; fipe_completed?: string; fipe_saved?: string; fipe_pdf_downloads?: string; fipe_provider_failures_24h?: string; fipe_provider_last_success?: string; fipe_save_rate_pct?: string; funnel_visitors_30d?: string; seo_visitors_30d?: string; cta_visitors_30d?: string; checkout_starts_30d?: string; visitor_registration_rate_pct?: string; daily?: AdminSeriesRow[] };
type AdminSettings = { environment: Record<string, string | number | boolean>; configured: Record<string, boolean>; safe: { siteTagline: string | null; supportEmail: string | null; maintenanceNotice: string | null; defaultAffiliateRateBps: number; fipeGuestDailyLimit: number } };
type AdminCoupon = { id: string; code: string; discountType: 'PERCENT' | 'FIXED'; discountValue: number; maxRedemptions: number | null; redeemedCount: number; startsAt?: string | null; expiresAt?: string | null; active: boolean; createdAt: string };
type AdminAffiliate = { id: string; name: string; email?: string; code: string; commissionBps?: number; commission_bps?: number; active: boolean; commissionsCount?: number; pendingCents?: number; createdAt?: string };
type AdminCommission = { id: string; amountCents: number; status: string; createdAt: string; paidAt?: string | null; affiliate: { name: string; code: string }; externalReference?: string | null };
type AdminOrganization = { id: string; name: string; document?: string | null; active: boolean; slug?: string | null; primaryColor?: string | null; accentColor?: string | null; logoUrl?: string | null; customDomain?: string | null; settings?: Record<string, string>; createdAt: string };
type AdminOrganizationMember = { organizationId: string; userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'; name: string; email: string; active: boolean };
type AffiliateSelf = { affiliate: { id: string; name: string; email: string; code: string; commissionBps?: number; commission_bps?: number; active: boolean } | null; shareUrl?: string; totals?: { pendingCents: number; paidCents: number; commissions: number; referredUsers?: number } };
type OrganizationContext = { organization: { id: string; name: string; slug?: string | null; primaryColor?: string | null; accentColor?: string | null; logoUrl?: string | null; customDomain?: string | null; role?: string } | null };
type AdminUser = { id: string; name: string; email: string; role: string; active: boolean; createdAt: string; lastLoginAt?: string; balanceCents: number; queriesCount: number };
type AdminPayment = { id: string; status: string; amountCents: number; purchaseType?: string; provider: string; externalId?: string; createdAt: string; paidAt?: string; customer: { name: string; email: string } };
type AdminQuery = { id: string; plate: string; status: string; priceCents: number; chargeSource?: string; provider: string; productName: string; createdAt: string; completedAt?: string; errorCode?: string; customer: { name: string; email: string } };
type AdminAudit = { id: string; action: string; entity: string; entityId?: string; createdAt: string; actor: { name: string; email: string } | null };
type ReportFieldConfig = { key: string; label: string; visible?: boolean };
type ReportSectionConfig = { key: string; label: string; order: number; visible?: boolean; fields: ReportFieldConfig[] };
type ReportTemplateConfig = { title: string; subtitle?: string; sections: ReportSectionConfig[] };
type AdminReportTemplate = { id: string; productId: string; version: number; name: string; status: 'DRAFT' | 'PUBLISHED'; config: ReportTemplateConfig; createdBy?: string; createdAt?: string };
type AdminQueryPrice = { id: string; organizationId: string; productId: string; productName: string; basePriceCents: number; priceCents: number; active: boolean; startsAt?: string | null; endsAt?: string | null };
type ContactMessage = { id: string; userId?: string | null; name: string; email: string; subject: string; message: string; category: 'SUPPORT' | 'PRIVACY' | 'LGPD' | 'COMMERCIAL'; status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED'; createdAt: string; closedAt?: string | null };
type AdminLookup = { plate: string; productId: string; productName: string; provider: string; providerQueryId?: string; consultedAt: string; result: Report };
type CheckoutQuote = { purchaseType?: 'QUERY'; productId?: string; productName?: string; plate?: string; basePriceCents?: number; negotiated?: boolean; couponCode: string | null; affiliateCode: string | null; subtotalCents: number; discountCents: number; amountCents: number; paymentProviderConfigured: boolean; usageCountChangesOnlyAfterPaid: boolean };
type ApiError = { error?: string; message?: string };
class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(response: Response, body?: ApiError) {
    super(body?.message ?? body?.error ?? `HTTP_${response.status}`);
    this.name = 'ApiRequestError';
    this.status = response.status;
    this.code = body?.error;
  }
}
async function readJson<T>(response: Response): Promise<T | undefined> {
  if (response.status === 204 || response.status === 304) return undefined;
  const raw = await response.text();
  if (!raw.trim()) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}
function isAuthenticationFailure(reason: unknown): boolean {
  return reason instanceof ApiRequestError && reason.status === 401;
}
type MatrixStatus = 'included' | 'excluded' | 'pending';
type MatrixPlan = { id: string; name: string; eyebrow: string; description: string; featured?: boolean; disabled?: boolean; cells: Record<string, MatrixStatus> };
const matrixFeatures = [
  ['identification', 'Identificação do veículo'],
  ['debts', 'Débitos'],
  ['restrictions', 'Restrições'],
  ['recall', 'Recall'],
  ['auction', 'Leilão'],
  ['accident', 'Sinistro'],
  ['lien', 'Gravame detalhado']
] as const;
const matrixPlans: MatrixPlan[] = [
  { id: 'BASIC', name: 'Básica', eyebrow: 'Para começar', description: 'Identificação essencial para uma primeira leitura.', cells: { identification: 'included', debts: 'excluded', restrictions: 'excluded', recall: 'excluded', auction: 'excluded', accident: 'excluded', lien: 'excluded' } },
  { id: 'DEBTS', name: 'Débitos e Restrições', eyebrow: 'Para conferir pendências', description: 'Identificação com débitos e restrições do veículo.', cells: { identification: 'included', debts: 'included', restrictions: 'included', recall: 'excluded', auction: 'excluded', accident: 'excluded', lien: 'excluded' } },
  { id: 'COMPLETE', name: 'Completa', eyebrow: 'Mais escolhida', description: 'Uma visão ampla para apoiar a decisão de compra.', featured: true, cells: { identification: 'included', debts: 'included', restrictions: 'included', recall: 'included', auction: 'excluded', accident: 'excluded', lien: 'excluded' } },
  { id: 'PREMIUM', name: 'Premium', eyebrow: 'Em evolução', description: 'Inclui a cobertura completa e itens em validação com fornecedor.', cells: { identification: 'included', debts: 'included', restrictions: 'included', recall: 'included', auction: 'pending', accident: 'pending', lien: 'excluded' } },
  { id: 'RISK', name: 'Risco', eyebrow: 'Em breve', description: 'Leilão, sinistro e gravame detalhado em uma análise dedicada.', disabled: true, cells: { identification: 'excluded', debts: 'excluded', restrictions: 'excluded', recall: 'excluded', auction: 'pending', accident: 'pending', lien: 'pending' } }
];
  const formatCount = (value: number) => new Intl.NumberFormat('pt-BR').format(value);

const formatMoney = (value: number) => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const mask = (value?: string) => !value ? '—' : value.length <= 5 ? value : `${value.slice(0, 3)}••••${value.slice(-3)}`;

function ThemeControl({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <div className="themeControl" role="group" aria-label="Tema de aparência">
    {([['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Sistema']] as [Theme, string][]).map(([value, label]) => (
      <button key={value} className={theme === value ? 'selected' : ''} onClick={() => setTheme(value)} aria-pressed={theme === value}>{label}</button>
    ))}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { SUCCESS: 'Concluída', REFUNDED: 'Estornada', PROCESSING: 'Em processamento', FAILED: 'Falhou' };
  return <span className={`status status-${status.toLowerCase()}`}>{map[status] ?? status}</span>;
}

function Landing({ theme, setTheme, onAccess }: { theme: Theme; setTheme: (value: Theme) => void; onAccess: (mode: 'login' | 'register') => void }) {
  const [interestPlan, setInterestPlan] = useState<MatrixPlan | null>(null);
  const [interestEmail, setInterestEmail] = useState('');
  const [interestSaved, setInterestSaved] = useState(false);
  const [interestError, setInterestError] = useState('');
  const [heroPlate, setHeroPlate] = useState('');
  const [heroPlateError, setHeroPlateError] = useState('');
  const [publicStats, setPublicStats] = useState<number | null>(null);
  const [publicOffers, setPublicOffers] = useState<FipeOffer[]>([]);
  function openPlan(plan: MatrixPlan) {
    if (plan.id === 'PREMIUM' || plan.id === 'RISK') { setInterestPlan(plan); setInterestSaved(false); setInterestError(''); return; }
    onAccess('register');
  }
  useEffect(() => {
    let active = true;
    void fetch(`${API}/stats`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('stats_unavailable');
        return await response.json() as { totalQueries?: number };
      })
      .then((body) => { if (active && typeof body.totalQueries === 'number') setPublicStats(body.totalQueries); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void fetch(`${API}/fipe/offers`, { cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as { offers?: FipeOffer[] } : { offers: [] })
      .then((body) => { if (active) setPublicOffers(body.offers ?? []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  function submitHeroPlate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = heroPlate.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (normalized.length !== 7) { setHeroPlateError('Informe uma placa com 7 caracteres.'); return; }
    setHeroPlateError('');
    trackFunnel('PLATE_CAPTURED', { placement: 'home_hero', plateFormat: /^[A-Z]{3}\d[A-Z]\d{2}$/.test(normalized) ? 'mercosul' : 'legacy' });
    trackFunnel('CTA_CLICKED', { placement: 'home_hero', destination: 'register' });
    onAccess('register');
  }
  function publicPrice(planId: string) {
    const offer = publicOffers.find((item) => item.id === planId || (planId === 'BASIC' && item.id === 'CADASTRAL'));
    return offer ? formatMoney(offer.priceCents) : 'Preço disponível na carteira';
  }
  async function saveInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInterestError('');
    try {
      const response = await fetch(`${API}/plan-interest`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: interestEmail, plan: interestPlan?.id }) });
      const body = await readJson<ApiError>(response) ?? {};
      if (!response.ok) throw new ApiRequestError(response, body);
      setInterestSaved(true);
    } catch (reason) { setInterestError(reason instanceof Error ? reason.message : 'Não foi possível registrar seu interesse agora.'); }
  }
  return <div className="landing">
    <header className="publicHeader"><Brand compact /><nav aria-label="Navegação principal"><a href="#como-funciona">Como funciona</a><a href="#planos">Planos</a><a href="#conteudos">Conteúdos</a><a href="#faq">Dúvidas</a><button className="textButton" onClick={() => onAccess('login')}>Entrar</button></nav><ThemeControl theme={theme} setTheme={setTheme} /></header>
    <main>
      <section className="hero">
        <div className="heroContent">
          <p className="kicker">Consulta veicular inteligente</p>
          <h1>Busque os fatos.<br /><em>Decida com segurança.</em></h1>
          <p className="heroLead">A BUSCARR é sua central de consulta veicular: crie uma conta gratuita, acesse o dashboard e pague somente quando precisar consultar e mantenha cada relatório organizado em um único lugar.</p>
          <form className="heroPlateSearch" onSubmit={submitHeroPlate} aria-label="Começar cadastro com a placa do veículo">
            <label htmlFor="hero-plate">Informe a placa para começar</label>
            <div><input id="hero-plate" value={heroPlate} onChange={(event) => { setHeroPlate(event.target.value.toUpperCase().slice(0, 8)); setHeroPlateError(''); }} placeholder="ABC1D23" maxLength={8} autoComplete="off" aria-describedby="hero-plate-help" /><button className="primaryButton" type="submit">Criar conta e continuar <span>→</span></button></div>
            <small id="hero-plate-help">Usaremos apenas o formato para melhorar a jornada. Após o cadastro, você poderá preencher a placa com segurança. A FIPE manual continua gratuita.</small>
            {heroPlateError && <small className="plateError" role="alert">{heroPlateError}</small>}
          </form>
          <div className="heroActions"><button className="primaryButton" onClick={() => { trackFunnel('CTA_CLICKED', { placement: 'home_hero', destination: 'register' }); onAccess('register'); }}>Criar conta gratuita <span>→</span></button><a className="secondaryButton" href="/fipe" onClick={() => trackFunnel('CTA_CLICKED', { placement: 'home_hero', destination: 'fipe' })}>Consultar FIPE grátis</a><a className="secondaryButton" href="#como-funciona">Entender como funciona</a></div>
          <div className="heroTrust"><span><b>Dashboard pessoal</b> desde o primeiro acesso</span><span><b>Pagamento somente</b> ao iniciar uma consulta</span><span><b>Relatórios protegidos</b> na sua conta</span>{publicStats !== null && <span className="heroSocialProof" aria-live="polite"><b>{formatCount(publicStats)}</b> consultas concluídas</span>}</div>
        </div>
        <div className="vehicleCard" aria-label="Experiência BUSCARR com imagem de veículo premium">
          <img className="vehiclePhoto" src="/images/hero-luxury-night.jpeg" alt="Automóvel premium em movimento durante a noite" />
          <div className="vehicleOverlay"></div>
          <div className="vehicleTop"><span className="miniBrand">BUSCARR · INTELIGÊNCIA VEICULAR</span><span className="secureTag">Dados para decidir</span></div>
          <div className="vehicleContent"><p>Decisão respaldada</p><h2>Leitura objetiva para cada negociação.</h2><span className="plateVisual">CONSULTA PROTEGIDA</span></div>
          <div className="reportPreview"><div><small>Identificação</small><strong>Origem e dados-chave</strong></div><div><small>Ocorrências</small><strong>Sinais de atenção</strong></div><div><small>Histórico</small><strong>Na sua conta</strong></div></div>
        </div>
      </section>
      <section className="howItWorks" id="como-funciona"><div><p className="kicker">Como funciona</p><h2>Uma conta. Uma carteira. Decisões mais seguras.</h2><p className="sectionLead">O acesso ao dashboard é gratuito. Você só realiza pagamento quando decidir iniciar uma consulta; depois, cada relatório fica salvo em seu histórico.</p></div><ol><li><b>01</b><div><strong>Crie e acesse sua conta</strong><p>Cadastre-se com e-mail e senha para entrar no seu dashboard pessoal, sem pagamento inicial.</p></div></li><li><b>02</b><div><strong>Escolha a consulta que precisa</strong><p>Selecione o produto, confira o preço por consulta e conclua a compra pelo checkout seguro somente quando precisar.</p></div></li><li><b>03</b><div><strong>Consulte e acompanhe</strong><p>Informe a placa, receba o retorno da consulta e mantenha o relatório no seu histórico.</p></div></li></ol></section>
      <section className="plansSection" id="planos">
        <div className="sectionHeading"><p className="kicker">Planos para cada decisão</p><h2>Escolha o nível de informação que você precisa.</h2><p>Comece com clareza, consulte com preço transparente e avance para uma análise mais completa quando a negociação exigir.</p></div>
        <div className="featuredPlans" aria-label="Planos destacados">
          {matrixPlans.filter((plan) => ['BASIC', 'COMPLETE', 'PREMIUM'].includes(plan.id)).map((plan) => <article key={plan.id} className={`publicPlanCard ${plan.id === 'COMPLETE' ? 'featured' : ''}`}>
            <div className="planTop"><span>{plan.id === 'COMPLETE' ? 'Mais escolhida' : plan.eyebrow}</span><b className="planPrice">{publicPrice(plan.id)}</b></div>
            <h3>{plan.name}</h3><p>{plan.description}</p>
            <ul>{matrixFeatures.slice(0, plan.id === 'BASIC' ? 2 : plan.id === 'COMPLETE' ? 4 : 5).map(([key, label]) => <li key={key}>{label}</li>)}</ul>
            <button className={plan.id === 'COMPLETE' ? 'primaryButton' : 'secondaryButton'} onClick={() => openPlan(plan)}>{plan.id === 'PREMIUM' ? 'Quero ser avisado' : 'Criar conta'}{plan.id !== 'PREMIUM' && <span>→</span>}</button>
          </article>)}
        </div>
        <a className="comparisonLink" href="#comparacao-completa">Ver comparação completa <span aria-hidden="true">↓</span></a>
        <div className="fullComparison" id="comparacao-completa"><h3>Comparação completa</h3><div className="planMatrixIntro"><strong>Cada plano tem preço próprio por consulta.</strong><span>O cadastro é gratuito e nenhum pagamento é feito nesta página.</span></div><div className="planMatrix" role="table" aria-label="Matriz comparativa dos planos de consulta"><div className="planMatrixGrid" role="rowgroup"><div className="matrixCorner" role="columnheader">Cobertura</div>{matrixPlans.map((plan) => <div className={`matrixPlanHead ${plan.featured ? 'featuredPlan' : ''} ${plan.disabled ? 'planDisabled' : ''}`} role="columnheader" key={plan.id}><span>{plan.eyebrow}</span><h3>{plan.name}</h3><p>{plan.description}</p><button className={plan.featured ? 'primaryButton' : 'secondaryButton'} onClick={() => openPlan(plan)}>{plan.disabled ? 'Deixar meu e-mail' : plan.id === 'PREMIUM' ? 'Quero ser avisado' : 'Criar conta'}{!plan.disabled && plan.id !== 'PREMIUM' && <span>→</span>}</button></div>)}{matrixFeatures.map(([key, label]) => <Fragment key={key}><div className="matrixFeatureLabel" role="rowheader">{label}</div>{matrixPlans.map((plan) => <div className={`matrixCell ${plan.disabled ? 'planDisabled' : ''}`} role="cell" key={`${plan.id}-${key}`}><span className={`matrixStatus ${plan.cells[key]}`} title={plan.cells[key] === 'pending' ? 'Em validação com fornecedor' : undefined}>{plan.cells[key] === 'included' ? '✓' : plan.cells[key] === 'pending' ? '⚠' : '✗'}</span>{plan.cells[key] === 'pending' && <small>Em validação</small>}</div>)}</Fragment>)}</div><div className="planMatrixLegend"><span><b className="matrixStatus included">✓</b> Incluído</span><span><b className="matrixStatus excluded">✗</b> Não incluído neste plano</span><span><b className="matrixStatus pending">⚠</b> Em validação com fornecedor</span></div></div></div>
        {interestPlan && <section className="planInterest" role="dialog" aria-live="polite" aria-label="Interesse em plano"><div><p className="kicker">{interestPlan.name} · em evolução</p><h3>{interestSaved ? 'Interesse registrado.' : 'Ainda não prometa o que não está disponível.'}</h3><p>{interestSaved ? 'Avisaremos quando houver uma atualização desta cobertura.' : 'Leilão, sinistro e gravame detalhado dependem de validação. Deixe seu e-mail para receber novidades quando o produto estiver pronto.'}</p></div>{interestSaved ? <button className="secondaryButton" onClick={() => setInterestPlan(null)}>Fechar</button> : <form onSubmit={saveInterest}><label>E-mail<input type="email" value={interestEmail} onChange={(event) => setInterestEmail(event.target.value)} required placeholder="voce@empresa.com" /></label><div><button className="primaryButton" type="submit">Deixar meu e-mail <span>→</span></button><button className="textButton" type="button" onClick={() => setInterestPlan(null)}>Agora não</button></div>{interestError && <p className="interestError" role="alert">{interestError}</p>}</form>}</section>}
      </section>
      <section className="contentSection" id="conteudos"><div className="sectionHeading"><p className="kicker">Conteúdo para decidir melhor</p><h2>O que observar antes de fechar negócio.</h2></div><div className="articleGrid"><article><span>GUIA</span><h3>Como consultar a placa de um veículo antes de comprar</h3><p>Entenda quais dados ajudam a reduzir incertezas em uma negociação.</p><a href="/consulta-placa">Ler orientação →</a></article><article><span>SEGURANÇA</span><h3>Por que histórico e documentação merecem atenção</h3><p>Uma decisão responsável considera dados técnicos, contexto e verificações oficiais.</p><a href="/historico-veicular">Ver checklist →</a></article><article><span>PREÇOS</span><h3>Como funciona o preço por consulta</h3><p>Compare cobertura, disponibilidade e preço antes de iniciar.</p><a href="/planos">Comparar consultas →</a></article></div></section>
      <section className="faqSection" id="faq"><div className="sectionHeading"><p className="kicker">Dúvidas frequentes</p><h2>Transparência antes de cada consulta.</h2></div><div className="faqGrid"><article><h3>O que eu recebo ao consultar?</h3><p>Você recebe um relatório com os dados disponibilizados pela consulta e pelo produto escolhido.</p></article><article><h3>Quando o valor da consulta é consumido?</h3><p>O valor é debitado do saldo pré-pago ao iniciar a consulta. Se houver falha técnica na integração, a carteira registra o estorno de acordo com a regra operacional.</p></article><article><h3>Meus relatórios ficam salvos?</h3><p>Sim. Os relatórios concluídos ficam vinculados à sua conta para consulta posterior, respeitando as regras de acesso e privacidade.</p></article></div></section>
      <section className="publicCta"><div><p className="kicker">A sua próxima decisão começa aqui</p><h2>Crie sua conta e tenha sua central de consulta veicular.</h2><p>Sem cobrança para acessar o dashboard. Você paga apenas quando quiser consultar.</p></div><button className="primaryButton" onClick={() => onAccess('register')}>Criar minha conta <span>→</span></button></section>
    </main>
    <footer><strong>BUSCARR</strong><span>Consulta veicular inteligente, com transparência desde o primeiro passo.</span><a href="mailto:contato@carpivara.casadf.com.br">contato@carpivara.casadf.com.br</a><a href="/termos">Termos de Uso</a><a href="/privacidade">Política de Privacidade</a></footer>
  </div>;
}

function FipeView({ token = '', onAccess }: { token?: string; onAccess: () => void }) {
  const mode = 'manual' as const;
  const [vehicleType, setVehicleType] = useState<FipeQuote['vehicleType']>('cars');
  const [brands, setBrands] = useState<FipeItem[]>([]);
  const [models, setModels] = useState<FipeItem[]>([]);
  const [years, setYears] = useState<FipeItem[]>([]);
  const [brand, setBrand] = useState<FipeItem | null>(null);
  const [model, setModel] = useState<FipeItem | null>(null);
  const [year, setYear] = useState<FipeItem | null>(null);
  const [quote, setQuote] = useState<FipeQuote | null>(null);
  const [offers, setOffers] = useState<FipeOffer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  async function loadOptions(path: string): Promise<FipeItem[]> {
    const response = await fetch(`${API}${path}`, { headers, cache: 'no-store' });
    const body = await readJson<{ brands?: FipeItem[]; models?: FipeItem[]; years?: FipeItem[]; message?: string }>(response);
    if (!response.ok) throw new ApiRequestError(response, body);
    return body?.brands ?? body?.models ?? body?.years ?? [];
  }

  useEffect(() => {
    if (mode !== 'manual') return;
    setBrand(null); setModel(null); setYear(null); setModels([]); setYears([]); setError('');
    void loadOptions(`/fipe/brands?vehicleType=${vehicleType}`).then(setBrands).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as marcas.'));
  }, [mode, vehicleType]);
  useEffect(() => { void fetch(`${API}/fipe/offers`, { headers, cache: 'no-store' }).then(async (response) => response.ok ? await readJson<{ offers?: FipeOffer[] }>(response) : undefined).then((body) => setOffers(body?.offers ?? [])).catch(() => setOffers([])); }, [token]);
  useEffect(() => { if (!brand || mode !== 'manual') return; setModel(null); setYear(null); setYears([]); void loadOptions(`/fipe/models?vehicleType=${vehicleType}&brandCode=${encodeURIComponent(brand.code)}`).then(setModels).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os modelos.')); }, [brand, mode, vehicleType]);
  useEffect(() => { if (!brand || !model || mode !== 'manual') return; setYear(null); void loadOptions(`/fipe/years?vehicleType=${vehicleType}&brandCode=${encodeURIComponent(brand.code)}&modelCode=${encodeURIComponent(model.code)}`).then(setYears).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os anos.')); }, [brand, model, mode, vehicleType]);

  async function consultFipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!brand || !model || !year) { setError('Escolha veículo, marca, modelo e ano para consultar.'); return; }
    setLoading(true); setError(''); setQuote(null); setSaved(false);
    trackFunnel('FIPE_FORM_SUBMITTED', { vehicleType });
    try {
      const bodyInput = { vehicleType, brand, model, year };
      const response = await fetch(`${API}/fipe/quote`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(bodyInput) });
      const body = await readJson<FipeQuote & { message?: string; error?: string }>(response);
      if (!response.ok) throw new ApiRequestError(response, body);
      if (!body || !body.brand?.name || !body.model?.name || !body.year?.name || !body.valueLabel || !body.fipeCode) throw new Error('Não foi possível confirmar todos os dados do veículo e da FIPE. Tente novamente.');
      setQuote(body);
      trackFunnel('FIPE_RESULT_VIEWED', { vehicleType, hasVehicleDetails: Boolean(body.vehicleDetails), referenceMonth: body.referenceMonth });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a consulta.'); }
    finally { setLoading(false); }
  }

  function requireAccount(action: 'print' | 'pdf' | 'save') {
    trackFunnel('FIPE_REPORT_ACTION', { action, authenticated: Boolean(token) });
    if (!token) { sessionStorage.setItem('carpivara_fipe_return', '1'); onAccess(); return; }
    if (!quote) return;
    const url = `${API}/fipe/reports/${quote.documentCode}/${action === 'print' ? 'print' : 'pdf'}`;
    if (action === 'save') { void saveReport(); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function saveReport() {
    if (!quote || !token) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API}/fipe/quotes/${quote.documentCode}/save`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...headers } });
      const body = await readJson<{ message?: string; error?: string }>(response);
      if (!response.ok) throw new ApiRequestError(response, body);
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o relatório.'); }
    finally { setLoading(false); }
  }

  const details = quote?.vehicleDetails;
  const detailFields: Array<[string, string | undefined]> = quote ? ([
        ['Marca', details?.brand || quote.brand.name],
    ['Modelo identificado', details?.fullModel || details?.model || `${quote.brand.name} ${quote.model.name}`],
    ['Ano de fabricação', details?.manufactureYear],
    ['Ano do modelo', details?.modelYear || quote.year.name],
    ['Cor', details?.color],
    ['Combustível', details?.fuel || quote.fuel],
    ['Potência', details?.power],
    ['Cilindrada', details?.displacement],
    ['Tipo', details?.type],
    ['Espécie', details?.species],
    ['Categoria', details?.category],
    ['Carroceria', details?.body],
    ['Passageiros', details?.passengers],
    ['Capacidade de carga', details?.loadCapacity],
    ['Procedência', details?.origin],
    ['Município', details?.city],
    ['UF', details?.state],
    ['Ano do licenciamento', details?.licensingYear],
    ['Situação informada', details?.status]
  ] as Array<[string, string | undefined]>).filter((entry): entry is [string, string] => Boolean(entry[1])) : [];
  const notQueried = quote?.blocks.filter((block) => block.key !== 'FIPE' && block.state !== 'FOUND') ?? [];

  return <div className="fipePage"><header className="publicHeader"><Brand compact /><div className="fipeHeaderActions"><a className="textButton" href="/?site=1">Página inicial</a>{token && <a className="textButton" href="/">Voltar ao dashboard</a>}{!token && <button className="primaryButton compact" onClick={onAccess}>Criar conta</button>}</div></header><main className="fipeMain">
    <section className="fipeHero"><div><p className="kicker">Consulta zero</p><h1>Descubra o valor médio antes de negociar.</h1><p>Selecione o veículo manualmente e consulte o valor FIPE correspondente. Só exibimos o resultado quando todos os dados do veículo e da FIPE estão completos.</p></div><div className="fipePromise"><strong>R$ 0</strong><span>sem cobrança</span><small>A Consulta zero informa o valor médio FIPE. Ela não verifica gravame, sinistro, débitos, roubo/furto, leilão ou outras ocorrências documentais.</small></div></section>
    <section className="fipeFormCard"><div className="sectionHeading"><p className="kicker">Passo 1 de 2</p><h2>Escolha o veículo</h2><p>Selecione o tipo, a marca, o modelo e o ano para localizar a cotação FIPE correspondente.</p></div><form onSubmit={consultFipe}><div className="fipeFields"><label>Tipo<select value={vehicleType} onChange={(event) => setVehicleType(event.target.value as FipeQuote['vehicleType'])}><option value="cars">Carros</option><option value="motorcycles">Motos</option><option value="trucks">Caminhões</option></select></label><label>Marca<select value={brand?.code ?? ''} onChange={(event) => setBrand(brands.find((item) => item.code === event.target.value) ?? null)}><option value="">Selecione</option>{brands.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label>Modelo<select value={model?.code ?? ''} disabled={!brand} onChange={(event) => setModel(models.find((item) => item.code === event.target.value) ?? null)}><option value="">Selecione</option>{models.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label>Ano<select value={year?.code ?? ''} disabled={!model} onChange={(event) => setYear(years.find((item) => item.code === event.target.value) ?? null)}><option value="">Selecione</option>{years.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label></div>{error && <div className="notice noticeError" role="alert">{error}</div>}<div className="fipeFormFooter"><span><strong>Consulta zero</strong> · valor médio FIPE sem consulta documental</span><button className="primaryButton" disabled={loading || !brand || !model || !year}>{loading ? 'Consultando FIPE...' : 'Consultar FIPE agora'} <span>→</span></button></div></form></section>
    {quote && <section className="fipeResultCard"><div className="fipeResultHeader"><div><p className="kicker">Consulta zero concluída</p><h2>{details?.fullModel || `${quote.brand.name} ${quote.model.name}`}</h2><p>{fipeTypeLabels[quote.vehicleType]} · ano FIPE {quote.year.name} · {quote.fuel || details?.fuel || 'combustível não informado'}</p></div><div className="fipeValue"><small>Valor médio FIPE</small><strong>{quote.valueLabel}</strong><span>Referência {quote.referenceMonth}</span></div></div><div className="fipeResultIntro"><strong>Dados confirmados para esta consulta</strong><span>O resultado abaixo combina a identificação do veículo e a cotação FIPE encontrada para a referência indicada.</span></div>{detailFields.length > 0 && <><h3 className="fipeSubheading">Dados do veículo</h3><dl className="fipeDetailGrid">{detailFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}<h3 className="fipeSubheading">Dados da FIPE</h3><div className="fipeDataGrid"><div><span>Marca</span><strong>{quote.brand.name}</strong></div><div><span>Modelo FIPE</span><strong>{quote.model.name}</strong></div><div><span>Ano FIPE</span><strong>{quote.year.name}</strong></div><div><span>Código FIPE</span><strong>{quote.fipeCode}</strong></div><div><span>Referência</span><strong>{quote.referenceMonth}</strong></div><div><span>Valor médio</span><strong>{quote.valueLabel}</strong></div></div>{quote.estimatedNegotiation && <div className="fipeEstimate"><strong>Faixa apenas informativa: {formatMoney(quote.estimatedNegotiation.minCents)} a {formatMoney(quote.estimatedNegotiation.maxCents)}</strong><p>{quote.estimatedNegotiation.disclaimer}</p></div>}<div className="fipeLimitCard"><div><p className="kicker">Limite da Consulta zero</p><h3>A FIPE orienta. A consulta completa investiga.</h3><p>Este resultado não traz gravame, sinistro, débitos, restrições, roubo/furto, leilão ou outras informações documentais.</p></div><div className="fipeLimitList">{notQueried.slice(0, 6).map((block) => <span key={block.key}>— {block.label}</span>)}</div></div><div className="fipeSalesCta"><div><p className="kicker">Próximo passo</p><h3>Tenha acesso à consulta completa</h3><p>Quer saber se há impedimentos ou ocorrências antes de negociar? Avance para a análise adequada ao seu objetivo.</p></div><div className="fipeCtaButtons"><button className="primaryButton" onClick={onAccess}>Tenha acesso à consulta completa <span>→</span></button><button className="secondaryButton" onClick={() => document.getElementById('fipe-offers')?.scrollIntoView({ behavior: 'smooth' })}>Continuar só com a FIPE</button></div></div><div className="fipeActions"><button className="secondaryButton" onClick={() => requireAccount('print')}>Imprimir dados</button><button className="secondaryButton" onClick={() => requireAccount('pdf')}>Gerar PDF</button><button className="primaryButton" onClick={() => requireAccount('save')} disabled={loading || saved}>{saved ? 'Salvo no histórico' : token ? 'Salvar no histórico' : 'Criar conta gratuita'} <span>→</span></button></div>{!token && <p className="fipeGateNotice">O valor FIPE é gratuito. Para imprimir, gerar PDF ou salvar o relatório, crie sua conta gratuita.</p>}<div className="fipeReportMeta"><span>Documento <b>{quote.documentCode}</b></span><span>Validação pública disponível após gerar o relatório</span></div></section>}
    {offers.filter((offer) => offer.id !== 'FIPE_FREE').length > 0 && <section className="fipeOffers" id="fipe-offers"><div className="sectionHeading"><p className="kicker">Próximos níveis de segurança</p><h2>Continue só com a FIPE ou aprofunde a consulta.</h2><p>A Consulta zero é gratuita e suficiente para orientar o valor médio. Quando precisar de segurança documental, escolha a próxima análise.</p></div><div className="fipeOfferGrid">{offers.filter((offer) => offer.id !== 'FIPE_FREE').map((offer) => { const soon = offer.commercialStatus !== 'ACTIVE'; return <article key={offer.id} className={offer.featured ? 'featuredOffer' : ''}><span className="offerStatus">{soon ? 'Disponibilidade em breve' : `${formatMoney(offer.priceCents)}`}</span><h3>{offer.name}</h3><p>{offer.description}</p><button className={soon ? 'secondaryButton' : 'primaryButton'} disabled={soon} onClick={onAccess}>{soon ? 'Em breve' : 'Tenha acesso'}{!soon && <span>→</span>}</button></article>; })}</div></section>}
  </main><footer><strong>BUSCARR</strong><span>Consulta zero para orientar o valor. Consulta completa para aprofundar a decisão.</span><a href="/termos">Termos de Uso</a><a href="/privacidade">Política de Privacidade</a></footer></div>;
}
function ValidationPage({ code }: { code: string }) { const [result, setResult] = useState<{ authentic: boolean; status?: string; reportKind?: string; documentCode?: string; createdAt?: string; hash?: string; plate?: string | null; fipeReferenceMonth?: string | null } | null>(null); useEffect(() => { void fetch(`${API}/validar-relatorio/${encodeURIComponent(code)}`, { cache: 'no-store' }).then((response) => readJson<{ authentic: boolean; status?: string; reportKind?: string; documentCode?: string; createdAt?: string; hash?: string; plate?: string | null; fipeReferenceMonth?: string | null }>(response)).then((body) => setResult(body ?? { authentic: false, status: 'ERROR' })).catch(() => setResult({ authentic: false, status: 'ERROR' })); }, [code]); const vehicleReport = result?.reportKind === 'VEHICLE_QUERY'; return <div className="validationPage"><Brand /><section className="validationCard"><p className="kicker">Validação pública</p>{!result ? <h1>Verificando relatório…</h1> : result.authentic ? <><div className="validationIcon">✓</div><h1>Relatório autêntico</h1><p>O {vehicleReport ? 'relatório da consulta' : 'documento'} <strong>{result.documentCode}</strong> foi encontrado na base de validação da BUSCARR.</p><div className="validationRows"><span>Status<strong>{result.status}</strong></span><span>{vehicleReport ? 'Veículo' : 'Referência FIPE'}<strong>{vehicleReport ? (result.plate ?? '—') : (result.fipeReferenceMonth ?? '—')}</strong></span><span>Hash<strong>{result.hash?.slice(0, 24)}…</strong></span></div><a className="primaryButton" href={vehicleReport ? '/?site=1' : '/fipe'}>{vehicleReport ? 'Voltar à página inicial' : 'Consultar FIPE grátis'} <span>→</span></a></> : <><div className="validationIcon invalid">!</div><h1>Relatório não encontrado</h1><p>O código informado não corresponde a um relatório público válido.</p><a className="secondaryButton" href="/?site=1">Voltar à página inicial</a></>}</section></div>; }

function AuthScreen({ onAuthenticated, onBack, externalError = '', initialMode = 'register' }: { onAuthenticated: (token: string) => void; onBack: () => void; externalError?: string; initialMode?: 'login' | 'register' }) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [providers, setProviders] = useState<OAuthProviderStatus[]>([]);

  useEffect(() => { setMode(initialMode); setError(''); }, [initialMode]);
  useEffect(() => { void fetch(`${API}/auth/providers`, { cache: 'no-store' }).then((response) => response.ok ? readJson<{ providers?: OAuthProviderStatus[] }>(response) : undefined).then((body) => setProviders(body?.providers ?? [])).catch(() => setProviders([])); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setPending(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (mode === 'register' && String(form.get('name') ?? '').trim().length < 2) { setError('Informe seu nome completo para criar a conta.'); setPending(false); return; }
    if (mode === 'register' && password.length < 10) { setError('Crie uma senha com pelo menos 10 caracteres.'); setPending(false); return; }
    if (mode === 'register' && password !== String(form.get('passwordConfirmation') ?? '')) { setError('As senhas precisam ser iguais.'); setPending(false); return; }
    if (mode === 'register' && (form.get('acceptTerms') !== 'on' || form.get('acceptPrivacy') !== 'on')) { setError('Para criar sua conta, aceite os Termos de Uso e a Política de Privacidade.'); setPending(false); return; }
    const payload = mode === 'login'
      ? { email: String(form.get('email') ?? ''), password }
      : { name: String(form.get('name') ?? ''), email: String(form.get('email') ?? ''), password, acceptTerms: form.get('acceptTerms') === 'on', acceptPrivacy: form.get('acceptPrivacy') === 'on', marketingOptIn: form.get('marketingOptIn') === 'on' };
    try {
      const response = await fetch(`${API}/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await readJson<ApiError & { token?: string }>(response) ?? {};
      if (!response.ok || !body.token) throw new ApiRequestError(response, body);
      sessionStorage.setItem('carpivara_token', body.token);
      onAuthenticated(body.token);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível acessar sua conta.'); }
    finally { setPending(false); }
  }

  function selectMode(next: 'login' | 'register') { setMode(next); setError(''); }
  function startSocialLogin(provider: OAuthProviderStatus) { if (provider.enabled) window.location.assign(`${API}/auth/oauth/${provider.id}/start`); }
  const providerLabel: Record<OAuthProviderStatus['id'], string> = { google: 'Continuar com Google', microsoft: 'Continuar com Microsoft', apple: 'Continuar com Apple' };
  const providerIcon: Record<OAuthProviderStatus['id'], string> = { google: 'G', microsoft: '⊞', apple: '●' };
  const configuredProviders = (['google', 'microsoft', 'apple'] as OAuthProviderStatus['id'][]).map((id) => providers.find((provider) => provider.id === id) ?? { id, label: id, enabled: false });
  const enabledProviders = configuredProviders.filter((provider) => provider.enabled);

  return <div className="authShell"><div className="authVisual"><button className="backButton" onClick={onBack}>← Voltar ao início</button><Brand /><div className="authPitch"><p className="kicker">Acesso à plataforma</p><h1>Crie sua conta. Acesse seu dashboard.</h1><p>O cadastro é gratuito. Você só escolhe e paga pela consulta no momento em que decidir realizá-la.</p></div><div className="authDecor"><span>Dashboard pessoal</span><span>Saldo e pagamentos</span><span>Histórico protegido</span></div></div><div className="authPanel"><div className="authCard authCardPremium"><div className="authTabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => selectMode('login')}>Já tenho conta</button><button className={mode === 'register' ? 'active' : ''} onClick={() => selectMode('register')}>Criar conta</button></div><h2>{mode === 'login' ? 'Entre no seu dashboard.' : 'Seu dashboard começa aqui.'}</h2><p className="muted">{mode === 'login' ? 'Acesse carteira, consultas e relatórios salvos com seu e-mail e senha.' : 'O cadastro não exige pagamento. Crie sua conta e entre na plataforma agora.'}</p>{enabledProviders.length > 0 && <><div className="socialAuth" aria-label="Acesso social">{enabledProviders.map((provider) => <button className="socialButton" type="button" key={provider.id} onClick={() => startSocialLogin(provider)}><span aria-hidden="true">{providerIcon[provider.id]}</span>{providerLabel[provider.id]}</button>)}</div><div className="authDivider"><span>ou continue com e-mail</span></div></>}<form onSubmit={submit}>{mode === 'register' && <label>Nome completo<input name="name" autoComplete="name" minLength={2} required placeholder="Como podemos chamar você?" /></label>}<label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com" /></label><label>Senha<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 10 : 1} required placeholder={mode === 'register' ? 'Crie uma senha com pelo menos 10 caracteres' : 'Sua senha'} /></label>{mode === 'register' && <><label>Confirmar senha<input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={10} required placeholder="Repita sua senha" /></label><div className="consentFields"><label className="checkField"><input name="acceptTerms" type="checkbox" required /> <span><b>Obrigatório:</b> li e aceito os Termos de Uso.</span></label><label className="checkField"><input name="acceptPrivacy" type="checkbox" required /> <span><b>Obrigatório:</b> li e aceito a Política de Privacidade.</span></label><label className="checkField"><input name="marketingOptIn" type="checkbox" /> <span>Quero receber conteúdos e novidades por e-mail.</span></label></div></>}{(error || externalError) && <div className="notice noticeError" role="alert">{error || externalError}</div>}<button className="primaryButton full" disabled={pending}>{pending ? 'Criando acesso...' : mode === 'login' ? 'Entrar no dashboard' : 'Criar conta e acessar'} <span>→</span></button></form><p className="authFine">Dados de autenticação são processados de forma segura. Nenhum valor é cobrado para criar ou acessar a sua conta.</p></div></div></div>;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('carpivara_token') ?? '');
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('carpivara_theme') as Theme) || 'light');
  const [seoPage] = useState<SeoPage | null>(() => seoPageForPath(window.location.pathname));
  const [publicPage, setPublicPage] = useState<'landing' | 'auth' | 'fipe' | 'validation' | 'terms' | 'privacy' | 'seo'>(() => { const url = new URL(window.location.href); return url.searchParams.has('reset_token') ? 'auth' : window.location.pathname === '/fipe' ? 'fipe' : window.location.pathname === '/termos' ? 'terms' : window.location.pathname === '/privacidade' ? 'privacy' : window.location.pathname.startsWith('/validar-relatorio/') ? 'validation' : seoPageForPath(window.location.pathname) ? 'seo' : 'landing'; });
  const [showPublicSite, setShowPublicSite] = useState(() => new URL(window.location.href).searchParams.get('site') === '1');
  const [resetToken, setResetToken] = useState(() => new URL(window.location.href).searchParams.get('reset_token') ?? '');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [affiliateCode] = useState(() => {
    const url = new URL(window.location.href);
    const candidate = url.searchParams.get('ref') ?? url.searchParams.get('affiliate') ?? '';
    return /^[A-Za-z0-9_-]{3,40}$/.test(candidate) ? candidate : '';
  });
  const [view, setView] = useState<View>('consult');
  const [me, setMe] = useState<Me | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<Query[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [admin, setAdmin] = useState<AdminSummary | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminPayments, setAdminPayments] = useState<AdminPayment[]>([]);
  const [adminQueries, setAdminQueries] = useState<AdminQuery[]>([]);
  const [adminAudit, setAdminAudit] = useState<AdminAudit[]>([]);
  const [adminProducts, setAdminProducts] = useState<Product[]>([]);
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null);
  const [adminCoupons, setAdminCoupons] = useState<AdminCoupon[]>([]);
  const [adminAffiliates, setAdminAffiliates] = useState<AdminAffiliate[]>([]);
  const [adminCommissions, setAdminCommissions] = useState<AdminCommission[]>([]);
  const [adminOrganizations, setAdminOrganizations] = useState<AdminOrganization[]>([]);
  const [adminOrganizationMembers, setAdminOrganizationMembers] = useState<AdminOrganizationMember[]>([]);
  const [adminContacts, setAdminContacts] = useState<ContactMessage[]>([]);
  const [adminQueryPrices, setAdminQueryPrices] = useState<Record<string, AdminQueryPrice[]>>({});
  const [adminTemplates, setAdminTemplates] = useState<Record<string, AdminReportTemplate[]>>({});
  const [adminLoadErrors, setAdminLoadErrors] = useState<string[]>([]);
  const [organization, setOrganization] = useState<OrganizationContext['organization']>(null);
  const [affiliateSelf, setAffiliateSelf] = useState<AffiliateSelf | null>(null);
  const [adminTab, setAdminTab] = useState<AdminTab>('overview');
  const [report, setReport] = useState<Query | null>(null);
  const [plate, setPlate] = useState('');
  const [productId, setProductId] = useState('COMPLETE');
  const [historyFilter, setHistoryFilter] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [queryStage, setQueryStage] = useState(0);
  const [queryQuote, setQueryQuote] = useState<CheckoutQuote | null>(null);
  const [queryQuoteLoading, setQueryQuoteLoading] = useState(false);
  const [queryQuoteError, setQueryQuoteError] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const ticket = url.searchParams.get('oauth_ticket');
    const oauthError = url.searchParams.get('oauth_error');
    if (!ticket && !oauthError) return;
    url.searchParams.delete('oauth_ticket');
    url.searchParams.delete('oauth_error');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    if (oauthError) { setError('Não foi possível concluir o acesso pelo provedor escolhido. Tente novamente ou use seu e-mail.'); setPublicPage('auth'); return; }
    void fetch(`${API}/auth/oauth/consume`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) })
      .then(async (response) => {
        const body = await readJson<ApiError & { token?: string }>(response) ?? {};
        if (!response.ok || !body.token) throw new ApiRequestError(response, body);
        sessionStorage.setItem('carpivara_token', body.token);
        setToken(body.token);
      })
      .catch((reason) => { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir o acesso social.'); setPublicPage('auth'); });
  }, []);

  const appliedTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  useEffect(() => { document.documentElement.dataset.theme = appliedTheme; localStorage.setItem('carpivara_theme', theme); }, [appliedTheme, theme]);
  useEffect(() => { if (toast) { const timer = window.setTimeout(() => setToast(''), 4000); return () => window.clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    if (publicPage === 'landing') { applySeoHead(null); trackFunnel('HOME_PAGE_VIEW'); }
    if (publicPage === 'fipe') {
      applySeoHead({ path: '/fipe', title: 'Consulta FIPE grátis e em tempo real | BUSCARR', description: 'Consulte gratuitamente o valor médio FIPE vigente por tipo, marca, modelo e ano. Veja o resultado e avance apenas se precisar de análise veicular.' });
      trackFunnel('FIPE_PAGE_VIEW');
    }
  }, [publicPage]);

  async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) } });
    const body = await readJson<T & ApiError>(response);
    if (!response.ok) throw new ApiRequestError(response, body);
    if (body === undefined && response.status !== 204) throw new ApiRequestError(response);
    return body as T;
  }

  async function refresh(loadAdmin = false) {
    if (!token) return;
    try {
      const baseResults = await Promise.allSettled([
        api<Me>('/me'),
        api<Product[]>('/query-products'),
        api<Query[]>('/queries'),
        api<Transaction[]>('/wallet/transactions'),
        api<OrganizationContext>('/organization/context')
      ] as const);
      const [profileResult, productResult, historyResult, walletResult, organizationResult] = baseResults;
      if (profileResult.status === 'rejected') {
        if (isAuthenticationFailure(profileResult.reason)) {
          sessionStorage.removeItem('carpivara_token'); setToken(''); setMe(null); setPublicPage('auth');
        } else {
          setError(profileResult.reason instanceof Error ? profileResult.reason.message : 'Não foi possível carregar seu perfil.');
        }
        return;
      }
      const profile = profileResult.value;
      const baseLabels = ['produtos', 'histórico', 'carteira', 'organização'];
      const baseFailures = [productResult, historyResult, walletResult, organizationResult].flatMap((result, index) => result.status === 'rejected' ? [baseLabels[index]] : []);
      setMe(profile);
      if (productResult.status === 'fulfilled') setProducts(productResult.value);
      if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
      if (walletResult.status === 'fulfilled') setTransactions(walletResult.value);
      if (organizationResult.status === 'fulfilled') setOrganization(organizationResult.value.organization);
      if (isTeamRole(profile.user.role)) { setView('admin'); if (!loadAdmin) setAdminTab(firstAdminTabFor(profile.permissions)); }
      setError(baseFailures.length ? `Não foi possível carregar: ${baseFailures.join(', ')}. Tente novamente.` : '');
      if (!isTeamRole(profile.user.role)) {
        const selfAffiliate = await api<AffiliateSelf>('/affiliate/stats').catch(() => null);
        setAffiliateSelf(selfAffiliate);
      }
      if (loadAdmin || isTeamRole(profile.user.role)) {
        const canAudit = profile.permissions.includes('VIEW_AUDIT');
        const canUsers = profile.permissions.includes('MANAGE_USERS');
        const canBilling = profile.permissions.includes('MANAGE_BILLING');
        const canPricing = profile.permissions.includes('MANAGE_PRICING');
        const canLookup = profile.permissions.includes('VIEW_SENSITIVE_DATA');
        const canSystem = profile.permissions.includes('ADMIN_SYSTEM');
        const adminResults = await Promise.allSettled([
          canAudit ? api<AdminSummary>('/admin/overview') : Promise.resolve(null),
          canAudit ? api<AdminSettings>('/admin/settings') : Promise.resolve(null),
          canUsers ? api<AdminUser[]>('/admin/users') : Promise.resolve([]),
          canBilling ? api<AdminPayment[]>('/admin/payments') : Promise.resolve([]),
          canAudit ? api<AdminQuery[]>('/admin/queries') : Promise.resolve([]),
          canAudit ? api<AdminAudit[]>('/admin/audit') : Promise.resolve([]),
          canPricing ? api<Product[]>('/admin/products') : canLookup && productResult.status === 'fulfilled' ? Promise.resolve(productResult.value) : Promise.resolve([]),
          canBilling ? api<AdminCoupon[]>('/admin/coupons') : Promise.resolve([]),
          canBilling ? api<AdminAffiliate[]>('/admin/affiliates') : Promise.resolve([]),
          canBilling ? api<AdminCommission[]>('/admin/affiliate-commissions') : Promise.resolve([]),
          canSystem ? api<AdminOrganization[]>('/admin/organizations') : Promise.resolve([]),
          canAudit ? api<ContactMessage[]>('/admin/contact-messages') : Promise.resolve([])
        ] as const);
        const adminLabels = ['visão geral', 'configurações', 'usuários', 'pagamentos', 'consultas', 'auditoria', 'catálogo', 'cupons', 'afiliados', 'comissões', 'organizações', 'suporte'];
        setAdminLoadErrors(adminResults.flatMap((result, index) => result.status === 'rejected' ? [adminLabels[index]] : []));
        const [summaryResult, settingsResult, usersResult, paymentsResult, queriesResult, auditResult, catalogResult, couponsResult, affiliatesResult, commissionsResult, organizationsResult, contactsResult] = adminResults;
        if (summaryResult.status === 'fulfilled' && summaryResult.value) setAdmin(summaryResult.value);
        if (settingsResult.status === 'fulfilled' && settingsResult.value) setAdminSettings(settingsResult.value);
        if (usersResult.status === 'fulfilled') setAdminUsers(usersResult.value);
        if (paymentsResult.status === 'fulfilled') setAdminPayments(paymentsResult.value);
        if (queriesResult.status === 'fulfilled') setAdminQueries(queriesResult.value);
        if (auditResult.status === 'fulfilled') setAdminAudit(auditResult.value);
        if (catalogResult.status === 'fulfilled') setAdminProducts(catalogResult.value);
        if (couponsResult.status === 'fulfilled') setAdminCoupons(couponsResult.value);
        if (affiliatesResult.status === 'fulfilled') setAdminAffiliates(affiliatesResult.value);
        if (commissionsResult.status === 'fulfilled') setAdminCommissions(commissionsResult.value);
        if (organizationsResult.status === 'fulfilled') setAdminOrganizations(organizationsResult.value);
        if (contactsResult.status === 'fulfilled') setAdminContacts(contactsResult.value);
      } else {
        setAdminLoadErrors([]);
      }
    } catch (reason) {
      if (isAuthenticationFailure(reason)) {
        sessionStorage.removeItem('carpivara_token'); setToken(''); setMe(null); setPublicPage('auth');
      } else {
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os dados.');
      }
    }
  }
  useEffect(() => { void refresh(); }, [token]);

  const selectedProduct = useMemo(() => products.find((product) => product.id === productId), [products, productId]);
  const filteredHistory = useMemo(() => history.filter((item) => item.plate.includes(historyFilter.toUpperCase().replace(/[^A-Z0-9]/g, ''))), [history, historyFilter]);
  const adminPermissions = me?.permissions ?? [];
  const teamAccount = isTeamRole(me?.user.role);
  const canViewAudit = adminPermissions.includes('VIEW_AUDIT');
  const canManageUsers = adminPermissions.includes('MANAGE_USERS');
  const canManageBilling = adminPermissions.includes('MANAGE_BILLING');
  const canManagePricing = adminPermissions.includes('MANAGE_PRICING');
  const canLookup = adminPermissions.includes('VIEW_SENSITIVE_DATA');
  const canManageProviders = adminPermissions.includes('MANAGE_PROVIDERS');
  const canSystem = adminPermissions.includes('ADMIN_SYSTEM');
  const canAdmin = Boolean(canViewAudit || canLookup || canManageUsers || canManagePricing || canManageBilling || canManageProviders || canSystem);
  const firstAdminTab = firstAdminTabFor(adminPermissions);

  async function runQuery() {
    if (!plate.trim()) { setError('Informe uma placa para iniciar a consulta.'); return; }
    setLoading(true); setError(''); setReport(null); setQueryStage(1);
    const stages = window.setInterval(() => setQueryStage((current) => Math.min(current + 1, 3)), 620);
    try {
      const result = await api<Query>('/queries', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ plate, productId }) });
      setQueryStage(4); setReport(result); setPlate(result.plate); await refresh(); setToast('Consulta concluída e salva no seu histórico.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a consulta.'); await refresh(); }
    finally { window.clearInterval(stages); setLoading(false); }
  }

  async function previewQueryCheckout(inputProductId = productId, inputPlate = plate, inputCouponCode = '', inputAffiliateCode = affiliateCode) {
    if (!inputPlate.trim() || !inputProductId) { setQueryQuoteError('Informe a placa e escolha uma consulta.'); return; }
    setQueryQuoteLoading(true); setQueryQuoteError(''); setQueryQuote(null);
    try {
      const quote = await api<CheckoutQuote>('/payments/query/quote', { method: 'POST', body: JSON.stringify({ productId: inputProductId, plate: inputPlate.trim().toUpperCase(), ...(inputCouponCode.trim() ? { couponCode: inputCouponCode.trim().toUpperCase() } : {}), ...(inputAffiliateCode.trim() ? { affiliateCode: inputAffiliateCode.trim().toUpperCase() } : {}) }) });
      setQueryQuote(quote);
      trackFunnel('CHECKOUT_QUOTE_VIEWED', { productId: inputProductId, amountCents: quote.amountCents, paymentConfigured: quote.paymentProviderConfigured });
    } catch (reason) { setQueryQuoteError(reason instanceof Error ? reason.message : 'Não foi possível validar o preço da consulta.'); }
    finally { setQueryQuoteLoading(false); }
  }
  async function startQueryCheckout(inputProductId = productId, inputPlate = plate, inputCouponCode = '', inputAffiliateCode = affiliateCode) {
    if (!inputPlate.trim() || !inputProductId) { setQueryQuoteError('Informe a placa e escolha uma consulta.'); return; }
    setLoading(true); setQueryQuoteError('');
    try {
      trackFunnel('CHECKOUT_STARTED', { productId: inputProductId, hasCoupon: Boolean(inputCouponCode.trim()), hasAffiliate: Boolean(inputAffiliateCode.trim()) });
      const order = await api<{ checkoutUrl: string }>('/payments/query/checkout', { method: 'POST', body: JSON.stringify({ productId: inputProductId, plate: inputPlate.trim().toUpperCase(), ...(inputCouponCode.trim() ? { couponCode: inputCouponCode.trim().toUpperCase() } : {}), ...(inputAffiliateCode.trim() ? { affiliateCode: inputAffiliateCode.trim().toUpperCase() } : {}) }) });
      window.location.assign(order.checkoutUrl);
    } catch (reason) { setQueryQuoteError(reason instanceof Error ? reason.message : 'Não foi possível abrir o checkout da consulta.'); setLoading(false); }
  }
  async function openSavedQuery(id: string) {
    setLoading(true); setError('');
    try { const saved = await api<Query>(`/queries/${id}`); setReport(saved); setView('consult'); setToast('Relatório salvo aberto sem iniciar uma nova cobrança.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta consulta.'); }
    finally { setLoading(false); }
  }


  async function activateAffiliate() {
    setLoading(true); setError('');
    try {
      const result = await api<{ affiliate: AffiliateSelf['affiliate'] }>('/affiliate/activate', { method: 'POST', body: JSON.stringify({}) });
      setAffiliateSelf((current) => ({ affiliate: result.affiliate, totals: current?.totals ?? { pendingCents: 0, paidCents: 0, commissions: 0 } }));
      setToast('Link de afiliado ativado com sucesso.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ativar o link de afiliado.'); }
    finally { setLoading(false); }
  }

  async function saveProfile(input: Omit<Profile, 'id' | 'email' | 'role' | 'passwordEnabled'>) {
    setLoading(true); setError('');
    try {
      const result = await api<{ user: User; profile: Profile }>('/profile', { method: 'PUT', body: JSON.stringify(input) });
      setMe((current) => current ? { ...current, user: result.user, profile: result.profile } : current);
      setToast('Dados do perfil salvos com sucesso.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o perfil.'); }
    finally { setLoading(false); }
  }

  async function changePassword(input: { currentPassword?: string; newPassword: string }): Promise<boolean> {
    setLoading(true); setError('');
    try {
      await api<void>('/auth/change-password', { method: 'POST', body: JSON.stringify(input) });
      setMe((current) => current?.profile ? { ...current, profile: { ...current.profile, passwordEnabled: true } } : current);
      setToast('Senha salva com sucesso.');
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a senha.'); return false; }
    finally { setLoading(false); }
  }

  async function adminSaveSettings(input: Partial<AdminSettings['safe']>) {
    setLoading(true); setError('');
    try { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Configurações operacionais salvas.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as configurações.'); }
    finally { setLoading(false); }
  }
  async function adminCreateCoupon(input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api('/admin/coupons', { method: 'POST', body: JSON.stringify(input) }); await refresh(true); setToast('Cupom criado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o cupom.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateCoupon(id: string, input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api(`/admin/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Cupom atualizado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o cupom.'); }
    finally { setLoading(false); }
  }
  async function adminDeleteCoupon(id: string) {
    if (!window.confirm('Desativar e remover este cupom?')) return;
    setLoading(true); setError('');
    try { await api(`/admin/coupons/${id}`, { method: 'DELETE' }); await refresh(true); setToast('Cupom removido.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover o cupom.'); }
    finally { setLoading(false); }
  }
  async function adminCreateAffiliate(input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api('/admin/affiliates', { method: 'POST', body: JSON.stringify(input) }); await refresh(true); setToast('Afiliado criado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o afiliado.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateAffiliate(id: string, input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api(`/admin/affiliates/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Afiliado atualizado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o afiliado.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateCommission(id: string, status: 'PAID' | 'CANCELLED') {
    setLoading(true); setError('');
    try { await api(`/admin/affiliate-commissions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(true); setToast('Status da comissão atualizado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a comissão.'); }
    finally { setLoading(false); }
  }
  async function adminCreateOrganization(input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api('/admin/organizations', { method: 'POST', body: JSON.stringify(input) }); await refresh(true); setToast('Organização criada com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar a organização.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateOrganization(id: string, input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api(`/admin/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Marca da organização atualizada.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a organização.'); }
    finally { setLoading(false); }
  }
  async function adminLoadOrganizationMembers(id: string) {
    setLoading(true); setError('');
    try { setAdminOrganizationMembers(await api<AdminOrganizationMember[]>(`/admin/organizations/${id}/members`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os membros da organização.'); }
    finally { setLoading(false); }
  }
  async function adminUpsertOrganizationMember(organizationId: string, input: { userId: string; role: AdminOrganizationMember['role'] }) {
    setLoading(true); setError('');
    try { await api(`/admin/organizations/${organizationId}/members`, { method: 'POST', body: JSON.stringify(input) }); setAdminOrganizationMembers(await api<AdminOrganizationMember[]>(`/admin/organizations/${organizationId}/members`)); setToast('Membro da organização atualizado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o membro.'); }
    finally { setLoading(false); }
  }
  async function adminDeleteOrganizationMember(organizationId: string, userId: string) {
    setLoading(true); setError('');
    try { await api(`/admin/organizations/${organizationId}/members/${userId}`, { method: 'DELETE' }); setAdminOrganizationMembers((current) => current.filter((member) => member.userId !== userId)); setToast('Membro removido da organização.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover o membro.'); }
    finally { setLoading(false); }
  }

  async function adminUpdateUser(id: string, input: { role?: string; active?: boolean }) {
    setLoading(true); setError('');
    try { await api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Usuário atualizado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o usuário.'); }
    finally { setLoading(false); }
  }
  async function adminDeleteUser(id: string) {
    setLoading(true); setError('');
    try { await api(`/admin/users/${id}`, { method: 'DELETE' }); await refresh(true); setToast('Conta removida e sessões revogadas.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover a conta.'); }
    finally { setLoading(false); }
  }
  async function adminAdjustWallet(id: string, input: { amountCents: number; description: string }) {
    setLoading(true); setError('');
    try {
      const result = await api<{ balanceBeforeCents: number; balanceAfterCents: number }>(`/admin/users/${id}/wallet-adjustments`, { method: 'POST', body: JSON.stringify(input) });
      await refresh(true);
      setToast(`Saldo ajustado: ${formatMoney(result.balanceBeforeCents)} → ${formatMoney(result.balanceAfterCents)}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ajustar a carteira.'); }
    finally { setLoading(false); }
  }
  async function adminCreateProduct(input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api('/admin/products', { method: 'POST', body: JSON.stringify(input) }); await refresh(true); setToast('Produto criado com template publicado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o produto.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateProduct(id: string, input: Record<string, unknown>) {
    setLoading(true); setError('');
    try { await api(`/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); await refresh(true); setToast('Produto atualizado com sucesso.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o produto.'); }
    finally { setLoading(false); }
  }
  async function adminLoadTemplates(productId: string) {
    try { const rows = await api<AdminReportTemplate[]>(`/admin/products/${productId}/report-templates`); setAdminTemplates((current) => ({ ...current, [productId]: rows })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os templates.'); }
  }
  async function adminCreateTemplate(productId: string, input: { name: string; status: 'DRAFT' | 'PUBLISHED'; config: ReportTemplateConfig }) {
    setLoading(true); setError('');
    try { await api(`/admin/products/${productId}/report-templates`, { method: 'POST', body: JSON.stringify(input) }); await adminLoadTemplates(productId); await refresh(true); setToast('Versão de template criada.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o template.'); }
    finally { setLoading(false); }
  }
  async function adminPublishTemplate(id: string, productId: string) {
    setLoading(true); setError('');
    try { await api(`/admin/report-templates/${id}/publish`, { method: 'POST', body: JSON.stringify({}) }); await adminLoadTemplates(productId); await refresh(true); setToast('Template publicado e usado nas próximas consultas.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível publicar o template.'); }
    finally { setLoading(false); }
  }

  async function adminLoadQueryPrices(organizationId: string) {
    try { const rows = await api<AdminQueryPrice[]>(`/admin/organizations/${organizationId}/query-prices`); setAdminQueryPrices((current) => ({ ...current, [organizationId]: rows })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os preços por consulta.'); }
  }
  async function adminSaveQueryPrice(organizationId: string, input: { productId: string; priceCents: number; active: boolean; startsAt?: string | null; endsAt?: string | null }) {
    setLoading(true); setError('');
    try { await api(`/admin/organizations/${organizationId}/query-prices`, { method: 'PUT', body: JSON.stringify(input) }); await adminLoadQueryPrices(organizationId); setToast('Preço por consulta salvo.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o preço por consulta.'); }
    finally { setLoading(false); }
  }
  async function adminDisableQueryPrice(organizationId: string, productId: string) {
    setLoading(true); setError('');
    try { await api(`/admin/organizations/${organizationId}/query-prices/${productId}`, { method: 'DELETE' }); await adminLoadQueryPrices(organizationId); setToast('Preço por consulta desativado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível desativar o preço por consulta.'); }
    finally { setLoading(false); }
  }
  async function adminUpdateContact(id: string, status: ContactMessage['status']) {
    setLoading(true); setError('');
    try { await api(`/admin/contact-messages/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await refresh(true); setToast('Ticket atualizado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o ticket.'); }
    finally { setLoading(false); }
  }
  async function adminRunRetention(input: { olderThanDays: number; execute: boolean }) {
    setLoading(true); setError('');
    try { const result = await api<{ dryRun: boolean; cutoffAt: string; candidateCount?: number; deletedCount?: number; retentionDays: number }>('/admin/audit/retention', { method: 'POST', body: JSON.stringify(input) }); setToast(result.dryRun ? `Prévia: ${result.candidateCount ?? 0} evento(s) elegível(is) para retenção.` : `${result.deletedCount ?? 0} evento(s) removido(s) conforme a política.`); await refresh(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível executar a política de retenção.'); }
    finally { setLoading(false); }
  }
  async function sendContact(input: { name: string; email: string; subject: string; message: string; category: ContactMessage['category'] }) {
    setLoading(true); setError('');
    try { const result = await api<{ emailSent: boolean }>('/contact', { method: 'POST', body: JSON.stringify(input) }); setToast(result.emailSent ? 'Mensagem registrada e encaminhada ao suporte.' : 'Mensagem registrada. O e-mail de suporte ainda não está configurado.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível registrar a mensagem.'); }
    finally { setLoading(false); }
  }
  async function adminLookup(input: { plate: string; productId: string }): Promise<AdminLookup | null> {
    setLoading(true); setError('');
    try { const result = await api<AdminLookup>('/admin/lookups', { method: 'POST', body: JSON.stringify(input) }); setToast('Consulta administrativa concluída e registrada na auditoria.'); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a consulta administrativa.'); return null; }
    finally { setLoading(false); }
  }

  async function openReportDocument(kind: 'print' | 'pdf') {
    if (!report) return;
    try {
      const response = await fetch(`${API}/queries/${report.id}/report/${kind}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Não foi possível ${kind === 'print' ? 'abrir a impressão' : 'gerar o PDF'} deste relatório.`);
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      if (kind === 'print') { const popup = window.open(url, '_blank', 'noopener,noreferrer'); if (!popup) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.'); }
      else { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buscarr-${report.plate}.pdf`; anchor.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 1500); setToast(kind === 'print' ? 'Relatório aberto para impressão.' : 'PDF preparado com sucesso.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o documento.'); }
  }

  async function exportReport() {
    if (!report) return;
    try {
      const response = await fetch(`${API}/queries/${report.id}/export`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Não foi possível exportar este relatório.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `buscarr-${report.plate}.json`; anchor.click(); URL.revokeObjectURL(url); setToast('Exportação preparada com sucesso.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível exportar este relatório.'); }
  }

  function logout() { void api('/auth/logout', { method: 'POST' }).catch(() => undefined); sessionStorage.removeItem('carpivara_token'); setToken(''); setMe(null); setReport(null); setShowPublicSite(false); setPublicPage('landing'); }
  function navigate(next: View) {
    const safeView = teamAccount && next !== 'admin' ? 'admin' : next;
    setView(safeView); setError('');
    if (safeView === 'admin') { setAdminTab(firstAdminTab); void refresh(true); }
  }
  function navigateAdminTab(tab: AdminTab) { setView('admin'); setAdminTab(tab); setError(''); void refresh(true); }

  if (publicPage === 'terms') return <LegalPage kind="terms" />;
  if (publicPage === 'privacy') return <LegalPage kind="privacy" />;
  if (publicPage === 'validation') return <ValidationPage code={window.location.pathname.split('/').filter(Boolean).pop() ?? ''} />;
  if (publicPage === 'seo' && seoPage) return <SeoLandingPage page={seoPage} onAccess={() => { setAuthMode('register'); setResetToken(''); setError(''); setPublicPage('auth'); }} />;
  if (token && showPublicSite && publicPage === 'landing') return <Landing theme={theme} setTheme={setTheme} onAccess={() => { setShowPublicSite(false); setPublicPage('landing'); setView('consult'); }} />;
  if (!token) {
    if (publicPage === 'fipe') return <FipeView onAccess={() => { setAuthMode('register'); setPublicPage('auth'); }} />;
    return publicPage === 'landing' ? <Landing theme={theme} setTheme={setTheme} onAccess={(mode) => { setAuthMode(mode); setResetToken(''); setError(''); setPublicPage('auth'); }} /> : <AccountAuthScreen onAuthenticated={(nextToken) => { setToken(nextToken); setShowPublicSite(false); setResetToken(''); if (sessionStorage.getItem('carpivara_fipe_return') === '1') { sessionStorage.removeItem('carpivara_fipe_return'); setPublicPage('fipe'); } }} onBack={() => { setResetToken(''); setShowPublicSite(false); setPublicPage('landing'); }} externalError={error} initialMode={authMode} resetToken={resetToken} affiliateCode={affiliateCode} />;
  }
  if (publicPage === 'fipe') return <FipeView token={token} onAccess={() => { setShowPublicSite(false); setPublicPage('landing'); setView('consult'); }} />;

  const adminMode = teamAccount || view === 'admin';
  const adminNav = <>
    {canViewAudit && <button className={adminTab === 'overview' ? 'active adminNavPrimary' : 'adminNavPrimary'} onClick={() => navigateAdminTab('overview')}><i>◈</i> Visão geral</button>}
    {canManageUsers && <button className={adminTab === 'users' ? 'active' : ''} onClick={() => navigateAdminTab('users')}><i>♙</i> Usuários</button>}
    {canViewAudit && <button className={adminTab === 'queries' ? 'active' : ''} onClick={() => navigateAdminTab('queries')}><i>⌁</i> Consultas</button>}
    {canManageBilling && <button className={adminTab === 'payments' ? 'active' : ''} onClick={() => navigateAdminTab('payments')}><i>◇</i> Pagamentos</button>}
    {canManagePricing && <button className={adminTab === 'products' ? 'active' : ''} onClick={() => navigateAdminTab('products')}><i>▣</i> Catálogo</button>}
    {canViewAudit && <button className={adminTab === 'audit' ? 'active' : ''} onClick={() => navigateAdminTab('audit')}><i>≡</i> Auditoria</button>}
    {canLookup && <button className={adminTab === 'lookup' ? 'active' : ''} onClick={() => navigateAdminTab('lookup')}><i>⌕</i> Consulta interna</button>}
    {canManageBilling && <button className={adminTab === 'coupons' ? 'active' : ''} onClick={() => navigateAdminTab('coupons')}><i>%</i> Cupons</button>}
    {canManageBilling && <button className={adminTab === 'affiliates' ? 'active' : ''} onClick={() => navigateAdminTab('affiliates')}><i>↗</i> Afiliados</button>}
    {canManageProviders && <button className={adminTab === 'settings' ? 'active' : ''} onClick={() => navigateAdminTab('settings')}><i>⚙</i> Configurações</button>}
    {canSystem && <button className={adminTab === 'organizations' ? 'active' : ''} onClick={() => navigateAdminTab('organizations')}><i>▤</i> Organizações</button>}
    {canViewAudit && <button className={adminTab === 'support' ? 'active' : ''} onClick={() => navigateAdminTab('support')}><i>✉</i> Suporte e LGPD</button>}
    {!teamAccount && <button onClick={() => navigate('consult')}><i>↩</i> Voltar ao cliente</button>}
  </>;
  return <div className="appShell"><aside className={adminMode ? 'sidebar adminSidebar' : 'sidebar'}><Brand /><div className="workspaceLabel"><span>{adminMode ? 'Painel administrativo' : 'Área do cliente'}</span><b>{teamAccount ? 'Conta de equipe' : adminMode ? 'Operação protegida' : 'Conta protegida'}</b></div><nav className="sideNav" aria-label={adminMode ? 'Navegação administrativa' : 'Navegação da plataforma'}>{adminMode ? adminNav : <><button className={view === 'consult' ? 'active' : ''} onClick={() => navigate('consult')}><i>⌁</i> Nova consulta</button><button className={view === 'history' ? 'active' : ''} onClick={() => navigate('history')}><i>◫</i> Histórico</button><button className={view === 'wallet' ? 'active' : ''} onClick={() => navigate('wallet')}><i>◇</i> Carteira</button><button className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><i>◌</i> Perfil e segurança</button>{canAdmin && <button onClick={() => navigate('admin')}><i>◈</i> Administração</button>}</>}</nav><div className="sidePublicLinks" aria-label="Acessos públicos"><a href="/?site=1">Página inicial</a><a href="/fipe">Consulta FIPE grátis</a></div><div className="sideBottom"><div className="sideCredit"><span>{teamAccount ? 'Saldo operacional' : adminMode ? 'Carteira do cliente' : 'Saldo disponível'}</span><strong>{formatMoney(me?.balanceCents ?? 0)} <small>R$ disponíveis</small></strong></div><button className="logoutButton" onClick={logout}>Sair da conta</button></div></aside><main className="workspace"><header className={adminMode ? 'appHeader adminHeader' : 'appHeader'}><div><p className="kicker">{adminMode ? 'Retaguarda BUSCARR' : view === 'consult' ? 'Consulta veicular' : view === 'history' ? 'Histórico de consultas' : view === 'wallet' ? 'Saldo e pagamentos' : 'Perfil e segurança'}</p><h1>{adminMode ? 'Controle da operação.' : view === 'consult' ? `Bom ter você por aqui, ${me?.user.name?.split(' ')[0] ?? 'cliente'}` : view === 'history' ? 'Suas consultas, organizadas.' : view === 'wallet' ? 'Clareza em cada pagamento.' : 'Perfil e segurança.'}</h1></div><div className="headerActions"><div className="headerQuickLinks" aria-label="Atalhos do site"><a href="/?site=1">Início</a><a href="/fipe">FIPE grátis</a></div><ThemeControl theme={theme} setTheme={setTheme} />{!adminMode && <button className="profileEditButton" type="button" onClick={() => navigate('settings')}>Editar usuário e senha</button>}{adminMode && !teamAccount && <button className="profileEditButton adminReturnButton" type="button" onClick={() => navigate('consult')}>Voltar à conta</button>}{teamAccount && <span className="teamAccountBadge">Conta de equipe</span>}<div className="profileBadge"><span>{me?.user.name?.slice(0, 1).toUpperCase()}</span><div><strong>{me?.user.name}</strong><small>{me?.user.role.replace('_', ' ')}</small></div></div></div></header>{organization && <div className="organizationContextBanner" style={{ borderColor: organization.primaryColor ?? '#12304A' }}><span>Ambiente de organização</span><strong>{organization.name}</strong><small>{organization.role ? `${organization.role.replace('_', ' ')} · ` : ''}relatórios FIPE podem usar esta identidade contextual</small></div>}{toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')} aria-label="Fechar aviso">×</button></div>}{error && <div className="notice noticeError" role="alert">{error}<button onClick={() => setError('')} aria-label="Fechar erro">×</button></div>}{view === 'consult' && !teamAccount && <ConsultView plate={plate} setPlate={setPlate} products={products} productId={productId} setProductId={setProductId} selectedProduct={selectedProduct} balanceCents={me?.balanceCents ?? 0} loading={loading} queryStage={queryStage} runQuery={runQuery} report={report} exportReport={exportReport} onPrint={() => void openReportDocument('print')} onPdf={() => void openReportDocument('pdf')} onPreviewQueryCheckout={previewQueryCheckout} onStartQueryCheckout={startQueryCheckout} queryQuote={queryQuote} queryQuoteLoading={queryQuoteLoading} queryQuoteError={queryQuoteError} />}{view === 'history' && !teamAccount && <HistoryView history={filteredHistory} filter={historyFilter} setFilter={setHistoryFilter} loading={loading} openSavedQuery={openSavedQuery} onRepeat={(item) => { setPlate(item.plate); setProductId(item.productId); setReport(null); navigate('consult'); setToast('Placa e produto preenchidos. O valor será debitado do saldo pré-pago ou seguirá para checkout.'); }} />}{view === 'wallet' && !teamAccount && <WalletView balanceCents={me?.balanceCents ?? 0} transactions={transactions} products={products} loading={loading} onPreviewQueryCheckout={previewQueryCheckout} onStartQueryCheckout={startQueryCheckout} queryQuote={queryQuote} queryQuoteLoading={queryQuoteLoading} queryQuoteError={queryQuoteError} affiliate={affiliateSelf} onActivateAffiliate={activateAffiliate} />}{view === 'settings' && !teamAccount && <SettingsView theme={theme} setTheme={setTheme} user={me?.user} profile={me?.profile} onSaveProfile={saveProfile} onChangePassword={changePassword} loading={loading} />}{view === 'admin' && canAdmin && <AdminView summary={admin} products={adminProducts} users={adminUsers} payments={adminPayments} queries={adminQueries} auditEntries={adminAudit} permissions={adminPermissions} tab={adminTab} setTab={setAdminTab} currentUserId={me?.user.id} loading={loading} adminLoadErrors={adminLoadErrors} onRetryAdmin={() => refresh(true)} settings={adminSettings} coupons={adminCoupons} affiliates={adminAffiliates} commissions={adminCommissions} organizations={adminOrganizations} organizationMembers={adminOrganizationMembers} onLoadOrganizationMembers={adminLoadOrganizationMembers} onUpsertOrganizationMember={adminUpsertOrganizationMember} onDeleteOrganizationMember={adminDeleteOrganizationMember} onUpdateUser={adminUpdateUser} onDeleteUser={adminDeleteUser} onAdjustWallet={adminAdjustWallet} onUpdateProduct={adminUpdateProduct} onLookup={adminLookup} onSaveSettings={adminSaveSettings} onChangePassword={changePassword} onCreateCoupon={adminCreateCoupon} onUpdateCoupon={adminUpdateCoupon} onDeleteCoupon={adminDeleteCoupon} onCreateAffiliate={adminCreateAffiliate} onUpdateAffiliate={adminUpdateAffiliate} onUpdateCommission={adminUpdateCommission} onCreateOrganization={adminCreateOrganization} onUpdateOrganization={adminUpdateOrganization} contacts={adminContacts} queryPrices={adminQueryPrices} templates={adminTemplates} onCreateProduct={adminCreateProduct} onCreateTemplate={adminCreateTemplate} onLoadTemplates={adminLoadTemplates} onPublishTemplate={adminPublishTemplate} onLoadQueryPrices={adminLoadQueryPrices} onSaveQueryPrice={adminSaveQueryPrice} onDisableQueryPrice={adminDisableQueryPrice} onUpdateContact={adminUpdateContact} onRunRetention={adminRunRetention} />}</main><nav className="mobileNav" aria-label="Navegação móvel">{adminMode ? <>{canViewAudit && <button className={adminTab === 'overview' ? 'active' : ''} onClick={() => navigateAdminTab('overview')}>Visão geral</button>}{canManageUsers && <button className={adminTab === 'users' ? 'active' : ''} onClick={() => navigateAdminTab('users')}>Usuários</button>}{canViewAudit && <button className={adminTab === 'queries' ? 'active' : ''} onClick={() => navigateAdminTab('queries')}>Consultas</button>}{canManageBilling && <button className={adminTab === 'payments' ? 'active' : ''} onClick={() => navigateAdminTab('payments')}>Pagamentos</button>}{canLookup && <button className={adminTab === 'lookup' ? 'active' : ''} onClick={() => navigateAdminTab('lookup')}>Interna</button>}{canManageBilling && <button className={adminTab === 'coupons' ? 'active' : ''} onClick={() => navigateAdminTab('coupons')}>Cupons</button>}{canManageBilling && <button className={adminTab === 'affiliates' ? 'active' : ''} onClick={() => navigateAdminTab('affiliates')}>Afiliados</button>}{canManageProviders && <button className={adminTab === 'settings' ? 'active' : ''} onClick={() => navigateAdminTab('settings')}>Configurações</button>}{canSystem && <button className={adminTab === 'organizations' ? 'active' : ''} onClick={() => navigateAdminTab('organizations')}>Organizações</button>}{canViewAudit && <button className={adminTab === 'support' ? 'active' : ''} onClick={() => navigateAdminTab('support')}>Suporte</button>}<a href="/?site=1">Início</a><button onClick={logout}>Sair</button></> : <><button className={view === 'consult' ? 'active' : ''} onClick={() => navigate('consult')}>Consultar</button><button className={view === 'history' ? 'active' : ''} onClick={() => navigate('history')}>Histórico</button><button className={view === 'wallet' ? 'active' : ''} onClick={() => navigate('wallet')}>Carteira</button>{canAdmin && <button onClick={() => navigate('admin')}>Admin</button>}<a href="/?site=1">Início</a><button onClick={logout}>Sair</button></>}</nav></div>;
}

function ConsultView({ plate, setPlate, products, productId, setProductId, selectedProduct, balanceCents, loading, queryStage, runQuery, report, exportReport, onPrint, onPdf, onPreviewQueryCheckout, onStartQueryCheckout, queryQuote, queryQuoteLoading, queryQuoteError }: { plate: string; setPlate: (value: string) => void; products: Product[]; productId: string; setProductId: (value: string) => void; selectedProduct?: Product; balanceCents: number; loading: boolean; queryStage: number; runQuery: () => void; report: Query | null; exportReport: () => void; onPrint: () => void; onPdf: () => void; onPreviewQueryCheckout: (productId?: string, plate?: string, couponCode?: string, affiliateCode?: string) => Promise<void>; onStartQueryCheckout: (productId?: string, plate?: string, couponCode?: string, affiliateCode?: string) => Promise<void>; queryQuote: CheckoutQuote | null; queryQuoteLoading: boolean; queryQuoteError: string }) {
  return <><div className="workspacePublicShortcut" role="note">Quer consultar somente o valor médio FIPE sem cobrança? <a href="/fipe">Acesse a Consulta FIPE grátis</a>.</div><section className="consultCard"><div className="consultIntro"><p className="kicker">Nova consulta</p><h2>O que você quer descobrir?</h2><p>Digite a placa, escolha o tipo de consulta e veja o custo antes de confirmar.</p></div><div className="consultForm"><label>Placa do veículo<input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))} placeholder="ABC1D23" maxLength={7} aria-describedby="plate-help" /></label><label>Produto<select value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><div className="costBox"><span>Custo da consulta</span><strong>{selectedProduct ? formatMoney(selectedProduct.priceCents) : '—'}</strong><small>Saldo pré-pago: {formatMoney(balanceCents)}</small></div><button className="primaryButton consultButton" onClick={runQuery} disabled={loading || !selectedProduct}>{loading ? 'Consultando...' : 'Consultar agora'} <span>→</span></button>{selectedProduct && balanceCents < (selectedProduct.priceCents ?? 0) && <div className="queryCheckoutPrompt"><p>Seu saldo pré-pago não cobre esta consulta. Valide o valor e pague somente este veículo.</p><button type="button" className="secondaryButton" onClick={() => void onPreviewQueryCheckout()} disabled={loading || queryQuoteLoading}>{queryQuoteLoading ? 'Validando valor...' : 'Ver valor para este veículo'}</button>{queryQuoteError && <div className="notice noticeError" role="alert">{queryQuoteError}</div>}{queryQuote && <div className="checkoutQuote" role="status"><span>Valor final antes do checkout</span><strong>{formatMoney(queryQuote.amountCents)}</strong><small>{queryQuote.paymentProviderConfigured ? 'Pagamento confirmado pelo provedor após o checkout.' : 'O provedor de pagamento ainda não está configurado.'}</small><button type="button" className="primaryButton" onClick={() => void onStartQueryCheckout()} disabled={loading || !queryQuote.paymentProviderConfigured}>Ir para checkout seguro <span>→</span></button></div>}</div>}</div>{selectedProduct && <div className="productDetail"><span>{selectedProduct.description}</span>{selectedProduct.features?.map((feature) => <small key={feature}>{feature}</small>)}</div>}</section>{loading && <section className="progressCard" aria-live="polite"><div className="progressHeader"><div className="spinner"></div><div><strong>{['Preparando sua consulta', 'Validando placa', 'Consultando informações', 'Organizando dados', 'Relatório pronto'][queryStage] ?? 'Consultando'}</strong><p>Você será informado se houver qualquer problema. O valor só é consumido quando a consulta é processada.</p></div></div><div className="steps">{['Validar', 'Consultar', 'Organizar', 'Concluir'].map((step, index) => <span className={index < queryStage ? 'done' : index === queryStage ? 'current' : ''} key={step}>{step}</span>)}</div></section>}{report ? <ReportView query={report} exportReport={exportReport} onPrint={onPrint} onPdf={onPdf} /> : !loading && <section className="reportEmpty"><span className="emptyMark">C</span><div><p className="kicker">Relatório inteligente</p><h2>Seu próximo relatório aparece aqui.</h2><p>Identificação, características, débitos e ocorrências serão organizados em uma leitura objetiva, sem despejar dados técnicos.</p></div></section>}</>;
}

function CoverageBadge({ label, state }: { label: string; state: CoverageState }) {
  const text = state === 'FOUND' ? 'FOUND · consultado' : state === 'PENDING' ? 'PENDING · em validação' : 'NOT_QUERIED · não consultado';
  return <div className={`coverageBadge ${state.toLowerCase().replace('_', '-')}`}><span>{state === 'FOUND' ? '✓' : state === 'PENDING' ? '⚠' : '—'}</span><strong>{label}</strong><small>{text}</small></div>;
}
function ReportView({ query, exportReport, onPrint, onPdf }: { query: Query; exportReport: () => void; onPrint: () => void; onPdf: () => void }) {
  const result = query.result; if (!result) return null;
  const fallbackCoverage: Record<CoverageKey, CoverageState> = { identification: 'FOUND', debts: result.debts.length ? 'FOUND' : 'NOT_QUERIED', restrictions: result.restrictions.length ? 'FOUND' : 'NOT_QUERIED', recall: result.recall ? 'FOUND' : 'NOT_QUERIED' };
  const coverage = { ...fallbackCoverage, ...(result.coverage ?? {}) };
  const total = result.debts.reduce((sum, item) => sum + item.amountCents, 0);
  const alertCount = result.restrictions.filter((item) => item.alert).length;
  const diagnosisClass = result.diagnostic.level.toLowerCase().replace('_', '-');
  const verificationCode = query.verificationCode ?? query.id.slice(0, 8).toUpperCase();
  return <section className="reportShell"><div className="reportHeader"><div><div className="reportMeta"><span>Relatório #{query.id.slice(0, 8).toUpperCase()}</span><StatusBadge status={query.status} /><span>{formatDate(query.completedAt ?? query.createdAt)}</span></div><h2>{result.identification.fullModel ?? result.identification.model ?? 'Veículo consultado'}</h2><p>{result.characteristics.manufactureYear ?? '—'}/{result.characteristics.modelYear ?? '—'} · {result.characteristics.color ?? 'Cor não informada'} · {result.characteristics.fuel ?? 'Combustível não informado'}</p></div><div className="reportActions"><span className="plateBadge">{result.identification.plate}</span><button className="secondaryButton compact" onClick={onPrint}>Imprimir</button><button className="secondaryButton compact" onClick={onPdf}>PDF</button><button className="secondaryButton compact" onClick={exportReport}>Exportar dados</button></div></div><div className={`diagnostic ${diagnosisClass}`}><span className="diagnosticIcon">{result.diagnostic.level === 'CLEAR' ? '✓' : '!'}</span><div><small>Diagnóstico geral</small><strong>{result.diagnostic.title}</strong><p>{result.diagnostic.reason}</p></div></div><div className="reportMetrics"><Metric label="Situação" value={result.registration.status ?? 'Não informado'} /><Metric label="Débitos mapeados" value={formatMoney(total)} attention={total > 0} /><Metric label="Ocorrências" value={alertCount ? `${alertCount} atenção` : 'Nada consta'} attention={alertCount > 0} /><Metric label="Localidade" value={`${result.registration.city ?? '—'}/${result.registration.state ?? '—'}`} /></div><div className="reportGrid"><DataBlock title="Identificação" rows={[["Placa", result.identification.plate], ["Marca", result.identification.brand], ["Modelo", result.identification.model], ["Renavam", mask(result.identification.renavam)], ["Chassi", mask(result.identification.chassis)], ["Motor", mask(result.identification.engine)], ["Câmbio", result.identification.gearbox]]} /><DataBlock title="Características" rows={[["Cor", result.characteristics.color], ["Combustível", result.characteristics.fuel], ["Categoria", result.characteristics.category], ["Tipo", result.characteristics.type], ["Espécie", result.characteristics.species], ["Potência", result.characteristics.power ? `${result.characteristics.power} cv` : undefined], ["Cilindrada", result.characteristics.displacement ? `${result.characteristics.displacement} cc` : undefined]]} /><DataBlock title="Registro" rows={[["Município", result.registration.city], ["UF", result.registration.state], ["Licenciamento", result.registration.licensingDate], ["Exercício", result.registration.licensingYear], ["Situação", result.registration.status], ["Recall", result.recall]]} /><div className="dataBlock"><h3>Débitos <span>{total > 0 ? 'Atenção' : 'Em dia'}</span></h3><div className="dataRows">{result.debts.map((item) => <div className="dataRow" key={item.key}><span>{item.label}</span><strong className={item.hasDebt ? 'attentionText' : ''}>{formatMoney(item.amountCents)}</strong></div>)}</div></div><div className="dataBlock dataBlockWide"><h3>Restrições <span>{alertCount ? `${alertCount} ocorrência(s)` : 'Nada consta'}</span></h3><div className="restrictionGrid">{result.restrictions.map((item) => <div className={`restriction ${item.alert ? 'alert' : 'clear'}`} key={item.key}><span className="restrictionSymbol">{item.alert ? '!' : '✓'}</span><div><strong>{item.label}</strong><p>{item.status}</p></div></div>)}</div></div></div><p className="reportDisclaimer">As informações refletem os dados disponíveis no momento da consulta. Este relatório não substitui verificações oficiais quando necessárias.</p><div className="reportCoverage"><div><p className="kicker">Cobertura desta consulta</p><h3>Veja exatamente o que foi consultado.</h3><p>Os estados abaixo diferenciam informação encontrada de itens que não fizeram parte desta consulta.</p></div><div className="coverageGrid"><CoverageBadge label="Identificação" state={coverage.identification} /><CoverageBadge label="Débitos" state={coverage.debts} /><CoverageBadge label="Restrições" state={coverage.restrictions} /><CoverageBadge label="Recall" state={coverage.recall} /></div></div><div className="reportVerification"><div><span className="verificationSeal">✓</span><div><p className="kicker">Selo de verificação pública</p><h3>Este relatório pode ser conferido online.</h3><p>Use o código <strong>{verificationCode}</strong> para confirmar a autenticidade do registro.</p></div></div><a className="secondaryButton" href={`/validar-relatorio/${encodeURIComponent(verificationCode)}`}>Verificar relatório <span>→</span></a></div></section>;
}
function Metric({ label, value, attention = false }: { label: string; value: string; attention?: boolean }) { return <div className={attention ? 'metric attentionMetric' : 'metric'}><span>{label}</span><strong>{value}</strong></div>; }
function DataBlock({ title, rows }: { title: string; rows: [string, string | undefined][] }) { return <div className="dataBlock"><h3>{title}</h3><div className="dataRows">{rows.map(([label, value]) => <div className="dataRow" key={label}><span>{label}</span><strong>{value || '—'}</strong></div>)}</div></div>; }

function HistoryView({ history, filter, setFilter, loading, openSavedQuery, onRepeat }: { history: Query[]; filter: string; setFilter: (value: string) => void; loading: boolean; openSavedQuery: (id: string) => void; onRepeat: (query: Query) => void }) {
  return <section className="contentCard"><div className="listHeader"><div><h2>Consultas salvas</h2><p>Abra um relatório anterior sem nova cobrança.</p></div><label className="searchField"><span>Buscar placa</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="ABC1D23" /></label></div><div className="historyTable"><div className="tableHead"><span>Placa</span><span>Produto</span><span>Data</span><span>Status</span><span>Ações</span></div>{history.length === 0 ? <div className="emptyList"><strong>Nenhuma consulta encontrada.</strong><p>Quando você consultar um veículo, o relatório ficará disponível aqui.</p></div> : history.map((item) => <div className="tableRow" key={item.id}><strong>{item.plate}</strong><span>{item.productName}</span><span>{formatDate(item.createdAt)}</span><StatusBadge status={item.status} /><div className="rowActions"><button className="tableButton" onClick={() => openSavedQuery(item.id)} disabled={loading || item.status !== 'SUCCESS'}>Abrir</button><button className="tableButton ghost" onClick={() => onRepeat(item)}>Consultar de novo</button></div></div>)}</div></section>;
}

function WalletView({ balanceCents, transactions, products, loading, onPreviewQueryCheckout, onStartQueryCheckout, queryQuote, queryQuoteLoading, queryQuoteError, affiliate, onActivateAffiliate }: { balanceCents: number; transactions: Transaction[]; products: Product[]; loading: boolean; onPreviewQueryCheckout: (productId?: string, plate?: string, couponCode?: string, affiliateCode?: string) => Promise<void>; onStartQueryCheckout: (productId?: string, plate?: string, couponCode?: string, affiliateCode?: string) => Promise<void>; queryQuote: CheckoutQuote | null; queryQuoteLoading: boolean; queryQuoteError: string; affiliate: AffiliateSelf | null; onActivateAffiliate: () => Promise<void> }) {
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id ?? 'COMPLETE');
  const [queryPlate, setQueryPlate] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [affiliateCode, setAffiliateCode] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const affiliateProfile = affiliate?.affiliate;
  const shareLink = affiliate?.shareUrl ?? (affiliateProfile ? new URL('/?ref=' + encodeURIComponent(affiliateProfile.code), window.location.origin).toString() : '');
  const quoteMatches = Boolean(queryQuote && queryQuote.productId === selectedProductId && queryQuote.plate === queryPlate.trim().toUpperCase());
  async function copyAffiliateLink() {
    if (!shareLink) return;
    try { await navigator.clipboard.writeText(shareLink); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200); } catch { setLinkCopied(false); }
  }
  return <><section className="walletHero"><div><p className="kicker">Saldo BUSCARR</p><h2>{formatMoney(balanceCents)} <small>disponíveis para consultas</small></h2><p>Use o saldo pré-pago em reais ou pague uma consulta individual no checkout seguro. O saldo e cada movimentação ficam registrados no histórico.</p></div></section><section className="contentCard creditStore"><div className="listHeader"><div><p className="kicker">Consulta individual</p><h2>Compre somente o que precisa</h2><p>Escolha o produto, informe a placa e valide o valor final antes de abrir o checkout.</p><div className="notice noticeError" role="status">E-mails transacionais ainda não estão configurados. A recuperação de senha e o recibo por e-mail não serão enviados neste ambiente; acompanhe pagamentos e movimentações pelo saldo e pelo histórico.</div></div></div><div className="checkoutOptions"><div className="formGrid"><label>Produto<select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.priceCents)}</option>)}</select></label><label>Placa do veículo<input value={queryPlate} onChange={(event) => setQueryPlate(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))} placeholder="ABC1D23" maxLength={7} /></label><label>Cupom de desconto<input value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Opcional" maxLength={40} /></label><label>Código de indicação<input value={affiliateCode} onChange={(event) => setAffiliateCode(event.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Opcional" maxLength={40} /></label></div>{selectedProduct && <div className="checkoutQuote"><span>Preço da consulta</span><strong>{formatMoney(selectedProduct.priceCents)}</strong><small>Saldo atual: {formatMoney(balanceCents)} · a confirmação financeira ocorre no provedor.</small></div>}<button type="button" className="primaryButton" disabled={loading || queryQuoteLoading || queryPlate.length !== 7 || !selectedProduct} onClick={() => void onPreviewQueryCheckout(selectedProductId, queryPlate, couponCode, affiliateCode)}>{queryQuoteLoading ? 'Validando valor...' : 'Validar valor para esta placa'} <span>→</span></button>{queryQuoteError && <div className="notice noticeError" role="alert">{queryQuoteError}</div>}{quoteMatches && queryQuote && <div className="checkoutQuote" role="status" aria-live="polite"><span>Prévia validada no servidor</span><div><small>Subtotal</small><b>{formatMoney(queryQuote.subtotalCents)}</b></div><div><small>Desconto {queryQuote.couponCode ? `· ${queryQuote.couponCode}` : ''}</small><b className="quoteDiscount">− {formatMoney(queryQuote.discountCents)}</b></div><div><small>Total do checkout</small><b>{formatMoney(queryQuote.amountCents)}</b></div><p>{queryQuote.paymentProviderConfigured ? 'O pedido será criado somente ao continuar para o checkout.' : 'O provedor de pagamento ainda não está configurado; nenhum pedido foi criado.'}</p><button type="button" className="primaryButton" disabled={loading || !queryQuote.paymentProviderConfigured} onClick={() => void onStartQueryCheckout(selectedProductId, queryPlate, couponCode, affiliateCode)}>Continuar para checkout seguro <span>→</span></button></div>}</div></section>{!affiliateProfile ? <section className="contentCard affiliateCard"><div><p className="kicker">Indique e acompanhe</p><h2>Ative seu link de indicação</h2><p>Compartilhe um link BUSCARR e acompanhe comissões pendentes. O pagamento das comissões é feito manualmente pela operação.</p></div><button className="secondaryButton" disabled={loading} onClick={() => void onActivateAffiliate()}>Ativar meu link</button></section> : <section className="contentCard affiliateCard"><div><p className="kicker">Seu canal de indicação</p><h2>{affiliateProfile.code}</h2><p>Comissões confirmadas: {formatMoney(affiliate?.totals?.paidCents ?? 0)} · pendentes: {formatMoney(affiliate?.totals?.pendingCents ?? 0)}</p><div className="affiliateShareBox"><code>{shareLink}</code><button type="button" className="tableButton" onClick={() => void copyAffiliateLink()}>{linkCopied ? 'Link copiado' : 'Copiar link'}</button></div><small>{formatCount(affiliate?.totals?.referredUsers ?? 0)} pessoa(s) entraram pelo seu link.</small></div><span className="status status-success">Afiliado ativo</span></section>}<section className="contentCard"><div className="listHeader"><div><h2>Movimentações</h2><p>Compras, consultas e estornos registrados em reais e em ordem cronológica.</p></div></div><div className="historyTable transactions"><div className="tableHead"><span>Movimento</span><span>Descrição</span><span>Data</span><span>Saldo após</span></div>{transactions.length === 0 ? <div className="emptyList"><strong>Sua carteira ainda não teve movimentações.</strong><p>Quando um pagamento for confirmado ou uma consulta for realizada, o histórico aparecerá aqui.</p></div> : transactions.map((item) => <div className="tableRow" key={item.id}><strong className={item.amountCents > 0 ? 'creditAmount' : 'debitAmount'}>{item.amountCents > 0 ? '+' : ''}{formatMoney(item.amountCents)}</strong><span>{item.description}</span><span>{formatDate(item.createdAt)}</span><span>{formatMoney(item.balanceAfterCents)}</span></div>)}</div></section></>;
}
function SettingsView({ theme, setTheme, user, profile, onSaveProfile, onChangePassword, loading }: { theme: Theme; setTheme: (value: Theme) => void; user?: User; profile?: Profile; onSaveProfile: (input: Omit<Profile, 'id' | 'email' | 'role' | 'passwordEnabled'>) => Promise<void>; onChangePassword: (input: { currentPassword?: string; newPassword: string }) => Promise<boolean>; loading: boolean }) {
  const [profileForm, setProfileForm] = useState({ name: profile?.name ?? user?.name ?? '', cpfCnpj: profile?.cpfCnpj ?? '', phone: profile?.phone ?? '', companyName: profile?.companyName ?? '', city: profile?.city ?? '', state: profile?.state ?? '', marketingOptIn: profile?.marketingOptIn ?? false });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' });
  const [passwordError, setPasswordError] = useState('');
  useEffect(() => { if (profile) setProfileForm({ name: profile.name, cpfCnpj: profile.cpfCnpj, phone: profile.phone, companyName: profile.companyName, city: profile.city, state: profile.state, marketingOptIn: profile.marketingOptIn }); }, [profile]);
  const hasPassword = profile?.passwordEnabled ?? true;
  async function submitProfile(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSaveProfile(profileForm); }
  async function submitPassword(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPasswordError(''); if (passwordForm.newPassword.length < 10) { setPasswordError('A nova senha precisa ter pelo menos 10 caracteres.'); return; } if (passwordForm.newPassword !== passwordForm.confirmation) { setPasswordError('As senhas precisam ser iguais.'); return; } const changed = await onChangePassword({ ...(hasPassword ? { currentPassword: passwordForm.currentPassword } : {}), newPassword: passwordForm.newPassword }); if (changed) setPasswordForm({ currentPassword: '', newPassword: '', confirmation: '' }); }
  return <section className="settingsGrid accountSettings"><article className="contentCard"><p className="kicker">Aparência</p><h2>Escolha sua experiência</h2><p className="muted">A preferência é salva neste dispositivo.</p><ThemeControl theme={theme} setTheme={setTheme} /></article><article className="contentCard profileCard"><div className="listHeader"><div><p className="kicker">Perfil</p><h2>Seus dados</h2><p className="muted">Mantenha as informações da sua conta atualizadas.</p></div></div><form className="accountForm" onSubmit={submitProfile}><div className="formGrid"><label>Nome completo<input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} autoComplete="name" required minLength={2} /></label><label>E-mail<input value={profile?.email ?? user?.email ?? ''} readOnly disabled /></label><label>CPF/CNPJ<input value={profileForm.cpfCnpj} onChange={(event) => setProfileForm({ ...profileForm, cpfCnpj: event.target.value })} autoComplete="off" /></label><label>Telefone<input value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} autoComplete="tel" /></label><label>Empresa<input value={profileForm.companyName} onChange={(event) => setProfileForm({ ...profileForm, companyName: event.target.value })} autoComplete="organization" /></label><label>Cidade<input value={profileForm.city} onChange={(event) => setProfileForm({ ...profileForm, city: event.target.value })} autoComplete="address-level2" /></label><label>UF<input value={profileForm.state} onChange={(event) => setProfileForm({ ...profileForm, state: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} autoComplete="address-level1" /></label></div><label className="checkField"><input type="checkbox" checked={profileForm.marketingOptIn} onChange={(event) => setProfileForm({ ...profileForm, marketingOptIn: event.target.checked })} /> <span>Quero receber conteúdos e novidades por e-mail.</span></label><button className="primaryButton" disabled={loading}>Salvar dados <span>→</span></button></form></article><article className="contentCard passwordCard"><p className="kicker">Segurança</p><h2>{hasPassword ? 'Alterar senha' : 'Criar senha de acesso'}</h2><p className="muted">{hasPassword ? 'Por segurança, confirme sua senha atual antes de criar uma nova.' : 'Sua conta social ainda não possui senha. Crie uma para também entrar com e-mail.'}</p><form className="accountForm" onSubmit={submitPassword}>{passwordError && <div className="notice noticeError" role="alert">{passwordError}</div>}{hasPassword && <label>Senha atual<input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} autoComplete="current-password" required /></label>}<label>Nova senha<input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} autoComplete="new-password" minLength={10} required placeholder="Pelo menos 10 caracteres" /></label><label>Confirmar nova senha<input type="password" value={passwordForm.confirmation} onChange={(event) => setPasswordForm({ ...passwordForm, confirmation: event.target.value })} autoComplete="new-password" minLength={10} required /></label><button className="secondaryButton" disabled={loading}>Salvar senha</button></form></article><article className="contentCard"><p className="kicker">Conta</p><h2>Dados de acesso</h2><dl className="accountData"><div><dt>E-mail</dt><dd>{profile?.email ?? user?.email}</dd></div><div><dt>Perfil</dt><dd>{(profile?.role ?? user?.role ?? '').replace('_', ' ')}</dd></div><div><dt>Senha</dt><dd>{hasPassword ? 'Ativa' : 'Ainda não criada'}</dd></div></dl><p className="muted">Para recuperar o acesso sem entrar na conta, use a opção “Esqueci minha senha” na tela de login.</p></article></section>; }
function AdminPasswordCard({ onChangePassword, loading }: { onChangePassword: (input: { currentPassword?: string; newPassword: string }) => Promise<boolean>; loading: boolean }) {
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmation: '' });
  const [passwordError, setPasswordError] = useState('');
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    if (passwordForm.newPassword.length < 10) { setPasswordError('A nova senha precisa ter pelo menos 10 caracteres.'); return; }
    if (passwordForm.newPassword !== passwordForm.confirmation) { setPasswordError('As senhas precisam ser iguais.'); return; }
    const changed = await onChangePassword({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword });
    if (changed) setPasswordForm({ currentPassword: '', newPassword: '', confirmation: '' });
  }
  return <section className="adminActionCard adminPasswordCard" aria-labelledby="admin-password-title"><div className="adminDetailHeader"><div><p className="kicker">Segurança da conta</p><h3 id="admin-password-title">Alterar sua senha</h3><p>Atualize a credencial do usuário administrativo conectado. A sessão atual permanece ativa após a troca.</p></div><span className="status status-success">Sessão protegida</span></div><form className="accountForm" onSubmit={submitPassword} autoComplete="off">{passwordError && <div className="notice noticeError" role="alert">{passwordError}</div>}<label>Senha atual<input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} autoComplete="current-password" required /></label><div className="formGrid"><label>Nova senha<input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} autoComplete="new-password" minLength={10} required placeholder="Pelo menos 10 caracteres" /></label><label>Confirmar nova senha<input type="password" value={passwordForm.confirmation} onChange={(event) => setPasswordForm({ ...passwordForm, confirmation: event.target.value })} autoComplete="new-password" minLength={10} required /></label></div><small className="formHint">Use uma senha exclusiva com pelo menos 10 caracteres. As outras sessões serão encerradas após a alteração.</small><button className="secondaryButton" disabled={loading}>{loading ? 'Atualizando senha...' : 'Atualizar senha'} <span>→</span></button></form></section>;
}

function AdminView({ summary, products, users, payments, queries, auditEntries, permissions, tab, setTab, currentUserId, loading, settings, coupons, affiliates, commissions, organizations, organizationMembers, onLoadOrganizationMembers, onUpsertOrganizationMember, onDeleteOrganizationMember, onUpdateUser, onDeleteUser, onAdjustWallet, onUpdateProduct, onLookup, onSaveSettings, onChangePassword, onCreateCoupon, onUpdateCoupon, onDeleteCoupon, onCreateAffiliate, onUpdateAffiliate, onUpdateCommission, onCreateOrganization, onUpdateOrganization, contacts, queryPrices, templates, onCreateProduct, onCreateTemplate, onLoadTemplates, onPublishTemplate, onLoadQueryPrices, onSaveQueryPrice, onDisableQueryPrice, onUpdateContact, onRunRetention, adminLoadErrors, onRetryAdmin }: { summary: AdminSummary | null; products: Product[]; users: AdminUser[]; payments: AdminPayment[]; queries: AdminQuery[]; auditEntries: AdminAudit[]; permissions: string[]; tab: AdminTab; setTab: (tab: AdminTab) => void; currentUserId?: string; loading: boolean; adminLoadErrors: string[]; onRetryAdmin: () => Promise<void>; settings: AdminSettings | null; coupons: AdminCoupon[]; affiliates: AdminAffiliate[]; commissions: AdminCommission[]; organizations: AdminOrganization[]; organizationMembers: AdminOrganizationMember[]; contacts: ContactMessage[]; queryPrices: Record<string, AdminQueryPrice[]>; templates: Record<string, AdminReportTemplate[]>; onLoadOrganizationMembers: (id: string) => Promise<void>; onUpsertOrganizationMember: (organizationId: string, input: { userId: string; role: AdminOrganizationMember['role'] }) => Promise<void>; onDeleteOrganizationMember: (organizationId: string, userId: string) => Promise<void>; onUpdateUser: (id: string, input: { role?: string; active?: boolean }) => Promise<void>; onDeleteUser: (id: string) => Promise<void>; onAdjustWallet: (id: string, input: { amountCents: number; description: string }) => Promise<void>; onUpdateProduct: (id: string, input: Record<string, unknown>) => Promise<void>; onCreateProduct: (input: Record<string, unknown>) => Promise<void>; onCreateTemplate: (productId: string, input: { name: string; status: 'DRAFT' | 'PUBLISHED'; config: ReportTemplateConfig }) => Promise<void>; onLoadTemplates: (productId: string) => Promise<void>; onPublishTemplate: (id: string, productId: string) => Promise<void>; onLoadQueryPrices: (organizationId: string) => Promise<void>; onSaveQueryPrice: (organizationId: string, input: { productId: string; priceCents: number; active: boolean; startsAt?: string | null; endsAt?: string | null }) => Promise<void>; onDisableQueryPrice: (organizationId: string, productId: string) => Promise<void>; onUpdateContact: (id: string, status: ContactMessage['status']) => Promise<void>; onRunRetention: (input: { olderThanDays: number; execute: boolean }) => Promise<void>; onLookup: (input: { plate: string; productId: string }) => Promise<AdminLookup | null>; onSaveSettings: (input: Partial<AdminSettings['safe']>) => Promise<void>; onChangePassword: (input: { currentPassword?: string; newPassword: string }) => Promise<boolean>; onCreateCoupon: (input: Record<string, unknown>) => Promise<void>; onUpdateCoupon: (id: string, input: Record<string, unknown>) => Promise<void>; onDeleteCoupon: (id: string) => Promise<void>; onCreateAffiliate: (input: Record<string, unknown>) => Promise<void>; onUpdateAffiliate: (id: string, input: Record<string, unknown>) => Promise<void>; onUpdateCommission: (id: string, status: 'PAID' | 'CANCELLED') => Promise<void>; onCreateOrganization: (input: Record<string, unknown>) => Promise<void>; onUpdateOrganization: (id: string, input: Record<string, unknown>) => Promise<void> }) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [lookupPlate, setLookupPlate] = useState('');
  const [lookupProductId, setLookupProductId] = useState(products.find((product) => product.active !== false)?.id ?? '');
  const [lookupResult, setLookupResult] = useState<AdminLookup | null>(null);
  const [couponForm, setCouponForm] = useState({ code: '', discountType: 'PERCENT' as 'PERCENT' | 'FIXED', discountValue: '10', maxRedemptions: '' });
  const [affiliateForm, setAffiliateForm] = useState({ name: '', email: '', code: '', commissionBps: '1000' });
  const [organizationForm, setOrganizationForm] = useState({ name: '', slug: '', primaryColor: '#12304A', accentColor: '#C99A3D', logoUrl: '' });
  const [memberForm, setMemberForm] = useState<{ userId: string; role: AdminOrganizationMember['role'] }>({ userId: '', role: 'MEMBER' });
  const [safeForm, setSafeForm] = useState({ siteTagline: settings?.safe.siteTagline ?? '', supportEmail: settings?.safe.supportEmail ?? '', maintenanceNotice: settings?.safe.maintenanceNotice ?? '', defaultAffiliateRateBps: String(settings?.safe.defaultAffiliateRateBps ?? 1000), fipeGuestDailyLimit: String(settings?.safe.fipeGuestDailyLimit ?? 100) });
  const [productForm, setProductForm] = useState({ id: '', slug: '', name: '', description: '', priceCents: '0', referencePriceCents: '', features: '', source: '', coverage: '', commercialStatus: 'ACTIVE' });
  const [templateProductId, setTemplateProductId] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED', config: '{\n  "title": "Relatório de consulta veicular",\n  "subtitle": "Informações organizadas pelo BUSCARR",\n  "sections": []\n}' });
  const [priceForm, setPriceForm] = useState({ productId: '', priceCents: '', active: true, startsAt: '', endsAt: '' });
  const [retentionDays, setRetentionDays] = useState('180');
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const selectedOrganization = organizations.find((organization) => organization.id === selectedOrganizationId) ?? null;
  const canAudit = permissions.includes('VIEW_AUDIT');
  const canUsers = permissions.includes('MANAGE_USERS');
  const canPricing = permissions.includes('MANAGE_PRICING');
  const canBilling = permissions.includes('MANAGE_BILLING');
  const canLookup = permissions.includes('VIEW_SENSITIVE_DATA');
  const canProviders = permissions.includes('MANAGE_PROVIDERS');
  const canSystem = permissions.includes('ADMIN_SYSTEM');
  const amount = (value?: string | number) => Number(value ?? 0);
  const daily = summary?.daily ?? [];
  const chartPoints = (key: 'queries' | 'sales' | 'users' | 'revenue_cents') => {
    const values = daily.map((row) => Number(row[key] ?? 0));
    const max = Math.max(1, ...values);
    return values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 320},${108 - (value / max) * 96}`).join(' ');
  };
  const cards = [
    { label: 'Usuários ativos', value: summary?.active_users ?? '—', note: `${summary?.new_users_30d ?? '—'} novos em 30 dias` },
    { label: 'Consultas hoje', value: summary?.queries_today ?? '—', note: `${summary?.successful_queries ?? '—'} concluídas no histórico` },
    { label: 'Falhas técnicas', value: summary?.failed_queries ?? '—', note: `${summary?.refunds ?? '—'} estornos registrados` },
    { label: 'Saldo pré-pago', value: formatMoney(amount(summary?.prepaid_balance_cents)), note: `${formatMoney(amount(summary?.queries_billed_cents))} consumidos em consultas` },
    { label: 'Receita de consultas', value: formatMoney(amount(summary?.query_revenue_cents)), note: `${summary?.query_sales ?? '—'} vendas confirmadas` },
    { label: 'Checkouts em aberto', value: formatMoney(amount(summary?.open_checkout_cents)), note: 'Ainda não reconhecidos como receita' }
  ];
  useEffect(() => { if (settings) setSafeForm({ siteTagline: settings.safe.siteTagline ?? '', supportEmail: settings.safe.supportEmail ?? '', maintenanceNotice: settings.safe.maintenanceNotice ?? '', defaultAffiliateRateBps: String(settings.safe.defaultAffiliateRateBps), fipeGuestDailyLimit: String(settings.safe.fipeGuestDailyLimit) }); }, [settings]);
  async function saveUser(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedUser) return; const form = new FormData(event.currentTarget); await onUpdateUser(selectedUser.id, { role: String(form.get('role') ?? selectedUser.role), active: form.get('active') === 'on' }); }
  async function adjustWallet(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedUser) return; const form = new FormData(event.currentTarget); const amountValue = Number(form.get('amountCents') ?? 0); const description = String(form.get('description') ?? ''); if (!Number.isInteger(amountValue) || amountValue === 0 || description.trim().length < 8) return; await onAdjustWallet(selectedUser.id, { amountCents: amountValue, description }); event.currentTarget.reset(); }
  async function deleteUser() { if (!selectedUser || selectedUser.id === currentUserId) return; if (!window.confirm(`Remover a conta de ${selectedUser.name}? As sessões serão revogadas.`)) return; await onDeleteUser(selectedUser.id); setSelectedUserId(null); }
  async function saveProduct(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedProduct) return; const form = new FormData(event.currentTarget); await onUpdateProduct(selectedProduct.id, { name: String(form.get('name') ?? ''), description: String(form.get('description') ?? ''), priceCents: Number(form.get('priceCents') ?? 0), active: form.get('active') === 'on' }); setSelectedProductId(null); }
  async function submitLookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setLookupResult(null); const result = await onLookup({ plate: lookupPlate, productId: lookupProductId }); if (result) setLookupResult(result); }
  async function createCoupon(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onCreateCoupon({ code: couponForm.code, discountType: couponForm.discountType, discountValue: Number(couponForm.discountValue), maxRedemptions: couponForm.maxRedemptions ? Number(couponForm.maxRedemptions) : null, active: true }); setCouponForm({ code: '', discountType: 'PERCENT', discountValue: '10', maxRedemptions: '' }); }
  async function createAffiliate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onCreateAffiliate({ name: affiliateForm.name, email: affiliateForm.email, code: affiliateForm.code, commissionBps: Number(affiliateForm.commissionBps), active: true }); setAffiliateForm({ name: '', email: '', code: '', commissionBps: '1000' }); }
  async function createOrganization(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onCreateOrganization({ name: organizationForm.name, slug: organizationForm.slug || null, primaryColor: organizationForm.primaryColor || null, accentColor: organizationForm.accentColor || null, logoUrl: organizationForm.logoUrl || null, active: true, settings: {} }); setOrganizationForm({ name: '', slug: '', primaryColor: '#12304A', accentColor: '#C99A3D', logoUrl: '' }); }
  async function createProduct(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onCreateProduct({ id: productForm.id.toUpperCase(), slug: productForm.slug.toLowerCase(), name: productForm.name, description: productForm.description, priceCents: Number(productForm.priceCents), referencePriceCents: productForm.referencePriceCents ? Number(productForm.referencePriceCents) : null, features: productForm.features.split(/\n|,/).map((item) => item.trim()).filter(Boolean), source: productForm.source || null, coverage: productForm.coverage || null, commercialStatus: productForm.commercialStatus, active: true, isFree: false, featured: false, displayOrder: products.length }); setProductForm({ id: '', slug: '', name: '', description: '', priceCents: '0', referencePriceCents: '', features: '', source: '', coverage: '', commercialStatus: 'ACTIVE' }); }
  async function createTemplate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!templateProductId) return; try { const config = JSON.parse(templateForm.config) as ReportTemplateConfig; if (!Array.isArray(config.sections)) throw new Error('O template precisa conter uma lista sections.'); await onCreateTemplate(templateProductId, { name: templateForm.name, status: templateForm.status, config }); } catch (reason) { window.alert(reason instanceof Error ? reason.message : 'JSON de template inválido.'); } }
  async function saveQueryPrice(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedOrganization || !priceForm.productId) return; await onSaveQueryPrice(selectedOrganization.id, { productId: priceForm.productId, priceCents: Number(priceForm.priceCents), active: priceForm.active, startsAt: priceForm.startsAt || null, endsAt: priceForm.endsAt || null }); }
  async function runRetention(dryRun: boolean) { await onRunRetention({ olderThanDays: Number(retentionDays), execute: !dryRun }); }
  async function saveOrganization(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedOrganization) return; const form = new FormData(event.currentTarget); await onUpdateOrganization(selectedOrganization.id, { primaryColor: String(form.get('primaryColor') ?? ''), accentColor: String(form.get('accentColor') ?? ''), logoUrl: String(form.get('logoUrl') ?? '') || null, active: form.get('active') === 'on' }); }
  async function saveMember(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedOrganization || !memberForm.userId) return; await onUpsertOrganizationMember(selectedOrganization.id, memberForm); setMemberForm({ userId: '', role: 'MEMBER' }); }
  async function removeMember(member: AdminOrganizationMember) { if (!selectedOrganization || !window.confirm(`Remover ${member.name} da organização?`)) return; await onDeleteOrganizationMember(selectedOrganization.id, member.userId); }
  const availableProducts = products.filter((product) => product.active !== false);
  const tabs: Array<[AdminTab, string, boolean]> = [['overview', 'Visão geral', canAudit], ['users', 'Usuários', canUsers], ['queries', 'Consultas', canAudit], ['products', 'Produtos', canPricing], ['payments', 'Pagamentos', canBilling], ['coupons', 'Cupons', canBilling], ['affiliates', 'Afiliados', canBilling], ['settings', 'Configurações', canProviders], ['organizations', 'Organizações', canSystem], ['support', 'Suporte e LGPD', canAudit], ['audit', 'Auditoria', canAudit], ['lookup', 'Consulta interna', canLookup]];
  return <>
    {adminLoadErrors.length > 0 && <div className="notice noticeError" role="alert">Alguns módulos administrativos não carregaram: {adminLoadErrors.join(', ')}. <button className="tableButton" type="button" onClick={() => void onRetryAdmin()} disabled={loading}>Tentar novamente</button></div>}
    <section className="adminIdentity contentCard"><div><p className="kicker">Ambiente restrito · operação</p><h2>Painel administrativo BUSCARR</h2><p>Esta área separa operação, receita, segurança e marca. Ações administrativas permanecem protegidas por permissão e registradas quando aplicável.</p></div><span className="adminIdentityBadge">Sessão {permissions.includes('ADMIN_SYSTEM') ? 'SUPER ADMIN' : 'ADMINISTRATIVA'}</span></section>
    <nav className="adminTabs" aria-label="Seções administrativas">{tabs.filter(([, , allowed]) => allowed).map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</nav>
    {tab === 'overview' && canAudit && <><section className="adminExecutive contentCard"><div><p className="kicker">Retaguarda BUSCARR</p><h2>Visão de operação, caixa e receita.</h2><p>Os indicadores e séries abaixo são calculados a partir dos eventos persistidos no banco, sem valores demonstrativos.</p></div><div className="adminRevenue"><span>Receita confirmada</span><strong>{formatMoney(amount(summary?.confirmed_revenue_cents))}</strong><small>{summary?.confirmed_sales ?? '—'} venda(s) conciliada(s) · ticket médio {formatMoney(amount(summary?.average_ticket_cents))}</small></div></section><section className="adminMetrics">{cards.map((card) => <div className="metric" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></div>)}</section><section className="adminCharts"><article className="contentCard"><div className="listHeader"><div><p className="kicker">Série de 30 dias</p><h3>Consultas realizadas</h3></div><strong>{daily.reduce((sum, row) => sum + Number(row.queries), 0)}</strong></div><svg className="adminChart" viewBox="0 0 320 112" role="img" aria-label="Consultas dos últimos 30 dias"><polyline points={chartPoints('queries')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></article><article className="contentCard"><div className="listHeader"><div><p className="kicker">Série de 30 dias</p><h3>Receita confirmada</h3></div><strong>{formatMoney(daily.reduce((sum, row) => sum + Number(row.revenue_cents), 0))}</strong></div><svg className="adminChart revenueChart" viewBox="0 0 320 112" role="img" aria-label="Receita dos últimos 30 dias"><polyline points={chartPoints('revenue_cents')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></article></section><section className="adminInsightGrid"><article><span>Consultas FIPE iniciadas</span><strong>{summary?.fipe_started ?? '—'}</strong><p>Eventos de entrada no funil gratuito.</p></article><article><span>Conversão para histórico</span><strong>{summary?.fipe_save_rate_pct ?? '0'}%</strong><p>{summary?.fipe_saved ?? '—'} relatório(s) salvo(s).</p></article><article><span>Saúde FIPE</span><strong>{summary?.fipe_provider_failures_24h ?? '0'} falhas</strong><p>Última resposta válida: {summary?.fipe_provider_last_success ? formatDate(summary.fipe_provider_last_success) : 'ainda sem eventos'}.</p></article></section><section className="adminFunnelGrid" aria-label="Funil de aquisição dos últimos 30 dias"><article><span>Visitantes do funil</span><strong>{summary?.funnel_visitors_30d ?? '0'}</strong><p>Home, FIPE e páginas de intenção.</p></article><article><span>Tráfego SEO</span><strong>{summary?.seo_visitors_30d ?? '0'}</strong><p>Sessões únicas em páginas indexáveis.</p></article><article><span>Cliques em CTA</span><strong>{summary?.cta_visitors_30d ?? '0'}</strong><p>Ações de entrada, FIPE e conta.</p></article><article><span>Cadastros por visitante</span><strong>{summary?.visitor_registration_rate_pct ?? '0'}%</strong><p>Taxa aproximada nos últimos 30 dias.</p></article><article><span>Checkouts iniciados</span><strong>{summary?.checkout_starts_30d ?? '0'}</strong><p>Pedidos que avançaram para pagamento.</p></article></section></>}
    {tab === 'settings' && canProviders && <><AdminPasswordCard onChangePassword={onChangePassword} loading={loading} /><section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Segurança operacional</p><h2>Configurações seguras</h2><p>Segredos nunca são exibidos nem editados aqui. O painel mostra apenas status configurado e valores operacionais permitidos.</p></div></div><div className="statusGrid">{Object.entries(settings?.configured ?? {}).map(([key, value]) => <div key={key}><span>{key}</span><strong className={value ? 'status status-success' : 'status status-failed'}>{value ? 'Configurado' : 'Não configurado'}</strong></div>)}</div>{settings?.configured.email === false && <div className="notice noticeError" role="alert"><span>Recuperação por e-mail indisponível: o SMTP ainda não foi configurado.</span></div>}<div className="adminEnvironment"><strong>Ambiente</strong>{Object.entries(settings?.environment ?? {}).map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}</div><form className="accountForm adminActionCard" onSubmit={(event) => { event.preventDefault(); void onSaveSettings({ siteTagline: safeForm.siteTagline || null, supportEmail: safeForm.supportEmail || null, maintenanceNotice: safeForm.maintenanceNotice || null, defaultAffiliateRateBps: Number(safeForm.defaultAffiliateRateBps), fipeGuestDailyLimit: Number(safeForm.fipeGuestDailyLimit) }); }}><h3>Valores de negócio permitidos</h3><div className="formGrid"><label>Mensagem institucional<input value={safeForm.siteTagline} onChange={(event) => setSafeForm({ ...safeForm, siteTagline: event.target.value })} maxLength={180} /></label><label>E-mail de suporte<input type="email" value={safeForm.supportEmail} onChange={(event) => setSafeForm({ ...safeForm, supportEmail: event.target.value })} /></label><label>Aviso de manutenção<input value={safeForm.maintenanceNotice} onChange={(event) => setSafeForm({ ...safeForm, maintenanceNotice: event.target.value })} maxLength={280} /></label><label>Comissão padrão (bps)<input type="number" min="0" max="5000" value={safeForm.defaultAffiliateRateBps} onChange={(event) => setSafeForm({ ...safeForm, defaultAffiliateRateBps: event.target.value })} /></label><label>Limite FIPE convidado/dia<input type="number" min="1" max="100000" value={safeForm.fipeGuestDailyLimit} onChange={(event) => setSafeForm({ ...safeForm, fipeGuestDailyLimit: event.target.value })} /></label></div><button className="primaryButton" disabled={loading}>Salvar valores seguros <span>→</span></button></form></section></>}
    {tab === 'coupons' && canBilling && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Conversão comercial</p><h2>Cupons de desconto</h2><p>Reservas e usos são controlados transacionalmente no checkout para evitar ultrapassar limites em concorrência.</p></div></div><form className="accountForm adminActionCard" onSubmit={createCoupon}><h3>Novo cupom</h3><div className="formGrid"><label>Código<input value={couponForm.code} onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value.toUpperCase() })} required minLength={3} /></label><label>Tipo<select value={couponForm.discountType} onChange={(event) => setCouponForm({ ...couponForm, discountType: event.target.value as 'PERCENT' | 'FIXED' })}><option value="PERCENT">Percentual</option><option value="FIXED">Valor fixo em centavos</option></select></label><label>Desconto<input type="number" min="1" value={couponForm.discountValue} onChange={(event) => setCouponForm({ ...couponForm, discountValue: event.target.value })} required /></label><label>Limite de usos<input type="number" min="1" value={couponForm.maxRedemptions} onChange={(event) => setCouponForm({ ...couponForm, maxRedemptions: event.target.value })} placeholder="Sem limite" /></label></div><button className="primaryButton" disabled={loading}>Criar cupom</button></form><div className="adminDataTable"><div className="adminDataHead coupons"><span>Código</span><span>Desconto</span><span>Uso</span><span>Validade</span><span>Status</span><span>Ação</span></div>{coupons.length ? coupons.map((coupon) => <div className="adminDataRow coupons" key={coupon.id}><strong>{coupon.code}</strong><span>{coupon.discountType === 'PERCENT' ? `${coupon.discountValue}%` : formatMoney(coupon.discountValue)}</span><span>{coupon.redeemedCount}/{coupon.maxRedemptions ?? '∞'}</span><span>{coupon.expiresAt ? formatDate(coupon.expiresAt) : 'Sem expiração'}</span><span className={coupon.active ? 'status status-success' : 'status status-failed'}>{coupon.active ? 'Ativo' : 'Inativo'}</span><div className="rowActions"><button className="tableButton" onClick={() => void onUpdateCoupon(coupon.id, { active: !coupon.active })}>{coupon.active ? 'Desativar' : 'Ativar'}</button><button className="tableButton ghost" onClick={() => void onDeleteCoupon(coupon.id)}>Excluir</button></div></div>) : <div className="emptyList"><strong>Nenhum cupom criado.</strong></div>}</div></section>}
    {tab === 'affiliates' && canBilling && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Canais de aquisição</p><h2>Afiliados e comissões</h2><p>Comissões entram como pendentes somente após pagamento confirmado. O repasse permanece manual nesta primeira versão.</p></div></div><form className="accountForm adminActionCard" onSubmit={createAffiliate}><h3>Novo afiliado</h3><div className="formGrid"><label>Nome<input value={affiliateForm.name} onChange={(event) => setAffiliateForm({ ...affiliateForm, name: event.target.value })} required /></label><label>E-mail<input type="email" value={affiliateForm.email} onChange={(event) => setAffiliateForm({ ...affiliateForm, email: event.target.value })} /></label><label>Código<input value={affiliateForm.code} onChange={(event) => setAffiliateForm({ ...affiliateForm, code: event.target.value.toUpperCase() })} required /></label><label>Comissão (bps)<input type="number" min="0" max="5000" value={affiliateForm.commissionBps} onChange={(event) => setAffiliateForm({ ...affiliateForm, commissionBps: event.target.value })} required /></label></div><button className="primaryButton" disabled={loading}>Criar afiliado</button></form><div className="adminDataTable"><div className="adminDataHead affiliates"><span>Afiliado</span><span>Código</span><span>Taxa</span><span>Pendente</span><span>Status</span><span>Ação</span></div>{affiliates.length ? affiliates.map((affiliate) => <div className="adminDataRow affiliates" key={affiliate.id}><div><strong>{affiliate.name}</strong><small>{affiliate.email || 'sem e-mail'}</small></div><strong>{affiliate.code}</strong><span>{((affiliate.commissionBps ?? affiliate.commission_bps ?? 0) / 100).toFixed(2)}%</span><strong>{formatMoney(affiliate.pendingCents ?? 0)}</strong><span className={affiliate.active ? 'status status-success' : 'status status-failed'}>{affiliate.active ? 'Ativo' : 'Inativo'}</span><button className="tableButton" onClick={() => void onUpdateAffiliate(affiliate.id, { active: !affiliate.active })}>{affiliate.active ? 'Desativar' : 'Ativar'}</button></div>) : <div className="emptyList"><strong>Nenhum afiliado cadastrado.</strong></div>}</div><h3 className="subsectionTitle">Comissões pendentes</h3><div className="adminDataTable">{commissions.length ? commissions.map((commission) => <div className="adminDataRow commissionRow" key={commission.id}><div><strong>{commission.affiliate.name}</strong><small>{commission.affiliate.code}</small></div><strong>{formatMoney(commission.amountCents)}</strong><span>{commission.status}</span><span>{formatDate(commission.createdAt)}</span>{commission.status === 'PENDING' ? <div className="rowActions"><button className="tableButton" onClick={() => void onUpdateCommission(commission.id, 'PAID')}>Marcar paga</button><button className="tableButton ghost" onClick={() => void onUpdateCommission(commission.id, 'CANCELLED')}>Cancelar</button></div> : <span>{commission.paidAt ? formatDate(commission.paidAt) : '—'}</span>}</div>) : <div className="emptyList"><strong>Nenhuma comissão registrada.</strong></div>}</div></section>}
    {tab === 'organizations' && canSystem && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Base white-label</p><h2>Organizações e identidade contextual</h2><p>A fundação permite marca por organização e impressão FIPE contextual. O BUSCARR permanece o fallback oficial; relatórios pagos usam o motor genérico com snapshot seguro.</p></div></div><form className="accountForm adminActionCard" onSubmit={createOrganization}><h3>Nova organização</h3><div className="formGrid"><label>Nome<input value={organizationForm.name} onChange={(event) => setOrganizationForm({ ...organizationForm, name: event.target.value })} required /></label><label>Slug<input value={organizationForm.slug} onChange={(event) => setOrganizationForm({ ...organizationForm, slug: event.target.value.toLowerCase() })} placeholder="ex.: rede-norte" /></label><label>Cor primária<input type="text" value={organizationForm.primaryColor} onChange={(event) => setOrganizationForm({ ...organizationForm, primaryColor: event.target.value })} /></label><label>Cor de destaque<input type="text" value={organizationForm.accentColor} onChange={(event) => setOrganizationForm({ ...organizationForm, accentColor: event.target.value })} /></label><label>Logo URL<input type="url" value={organizationForm.logoUrl} onChange={(event) => setOrganizationForm({ ...organizationForm, logoUrl: event.target.value })} placeholder="Opcional" /></label></div><button className="primaryButton" disabled={loading}>Criar organização</button></form><div className="organizationGrid">{organizations.length ? organizations.map((organization) => <article className="organizationCard" key={organization.id} style={{ borderTopColor: organization.primaryColor ?? '#12304A' }}><div><span>{organization.slug || 'sem slug'}</span><h3>{organization.name}</h3><p>{organization.customDomain || 'Domínio padrão BUSCARR'}</p></div><strong className={organization.active ? 'status status-success' : 'status status-failed'}>{organization.active ? 'Ativa' : 'Inativa'}</strong><div className="rowActions"><button className="tableButton" onClick={() => { setSelectedOrganizationId(organization.id); void onLoadOrganizationMembers(organization.id); void onLoadQueryPrices(organization.id); }}>Editar marca e membros</button></div></article>) : <div className="emptyList"><strong>Nenhuma organização criada.</strong></div>}</div>{selectedOrganization && <><form className="accountForm adminActionCard" onSubmit={saveOrganization}><div className="adminDetailHeader"><div><p className="kicker">Marca contextual</p><h3>{selectedOrganization.name}</h3></div><button type="button" className="tableButton ghost" onClick={() => setSelectedOrganizationId(null)}>Fechar</button></div><div className="formGrid"><label>Cor primária<input name="primaryColor" defaultValue={selectedOrganization.primaryColor ?? '#12304A'} /></label><label>Cor de destaque<input name="accentColor" defaultValue={selectedOrganization.accentColor ?? '#C99A3D'} /></label><label>Logo URL<input name="logoUrl" defaultValue={selectedOrganization.logoUrl ?? ''} /></label></div><label className="checkField"><input name="active" type="checkbox" defaultChecked={selectedOrganization.active} /><span>Organização ativa</span></label><button className="secondaryButton" disabled={loading}>Salvar identidade contextual</button></form><section className="organizationMembersPanel"><div className="listHeader"><div><p className="kicker">Acesso da organização</p><h3>Membros e permissões</h3><p className="muted">Associe usuários existentes e controle o papel operacional dentro desta organização.</p></div></div><div className="accountForm adminActionCard"><div className="formGrid"><label>Usuário<select value={memberForm.userId} onChange={(event) => setMemberForm({ ...memberForm, userId: event.target.value })} required><option value="">Selecione um usuário</option>{users.filter((user) => !organizationMembers.some((member) => member.userId === user.id)).map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label><label>Papel<select value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value as AdminOrganizationMember['role'] })}><option value="OWNER">Proprietário</option><option value="ADMIN">Administrador</option><option value="MEMBER">Membro</option><option value="VIEWER">Leitor</option></select></label></div><button type="button" className="primaryButton" disabled={loading || !memberForm.userId} onClick={() => { if (selectedOrganization && memberForm.userId) { void onUpsertOrganizationMember(selectedOrganization.id, memberForm); setMemberForm({ userId: '', role: 'MEMBER' }); } }}>Adicionar ou atualizar membro</button></div><div className="adminDataTable"><div className="adminDataHead organizationMembers"><span>Usuário</span><span>Papel</span><span>Status</span><span>Ação</span></div>{organizationMembers.length ? organizationMembers.map((member) => <div className="adminDataRow organizationMembers" key={member.userId}><div><strong>{member.name}</strong><small>{member.email}</small></div><span>{member.role}</span><span className={member.active ? 'status status-success' : 'status status-failed'}>{member.active ? 'Ativo' : 'Inativo'}</span><button className="tableButton ghost" onClick={() => void removeMember(member)}>Remover</button></div>) : <div className="emptyList"><strong>Nenhum membro vinculado.</strong></div>}</div></section></>}</section>}
    {tab === 'organizations' && canSystem && selectedOrganization && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Condição comercial</p><h2>Preço negociado por organização</h2><p>O preço negociado se aplica ao produto de consulta, somente quando está ativo e dentro da vigência. O adaptador de pagamento permanece inalterado.</p></div></div><form className="accountForm adminActionCard" onSubmit={saveQueryPrice}><div className="formGrid"><label>Produto<select value={priceForm.productId} onChange={(event) => setPriceForm({ ...priceForm, productId: event.target.value })} required><option value="">Selecione um produto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · base {formatMoney(product.priceCents)}</option>)}</select></label><label>Preço negociado (centavos)<input type="number" min="0" step="1" value={priceForm.priceCents} onChange={(event) => setPriceForm({ ...priceForm, priceCents: event.target.value })} required /></label><label>Início da vigência<input type="datetime-local" value={priceForm.startsAt} onChange={(event) => setPriceForm({ ...priceForm, startsAt: event.target.value })} /></label><label>Fim da vigência<input type="datetime-local" value={priceForm.endsAt} onChange={(event) => setPriceForm({ ...priceForm, endsAt: event.target.value })} /></label></div><label className="checkField"><input type="checkbox" checked={priceForm.active} onChange={(event) => setPriceForm({ ...priceForm, active: event.target.checked })} /><span>Condição ativa</span></label><button className="primaryButton" disabled={loading || !priceForm.productId}>Salvar preço negociado</button></form><div className="adminDataTable"><div className="adminDataHead"><span>Produto</span><span>Preço base</span><span>Negociado</span><span>Vigência</span><span>Status</span><span>Ação</span></div>{(queryPrices[selectedOrganization.id] ?? []).length ? (queryPrices[selectedOrganization.id] ?? []).map((price) => <div className="adminDataRow" key={price.id}><div><strong>{price.productName}</strong><small>{price.productId}</small></div><span>{formatMoney(price.basePriceCents)}</span><strong>{formatMoney(price.priceCents)}</strong><span>{price.startsAt ? formatDate(price.startsAt) : 'Imediato'}{price.endsAt ? ` · até ${formatDate(price.endsAt)}` : ''}</span><span className={price.active ? 'status status-success' : 'status status-failed'}>{price.active ? 'Ativo' : 'Inativo'}</span><button className="tableButton ghost" onClick={() => void onDisableQueryPrice(selectedOrganization.id, price.productId)} disabled={loading || !price.active}>Desativar</button></div>) : <div className="emptyList"><strong>Nenhum preço negociado cadastrado.</strong></div>}</div></section>}
    {tab === 'support' && canAudit && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Atendimento e direitos</p><h2>Suporte e canal LGPD</h2><p>Mensagens e solicitações de direitos são persistidas com status operacional. A entrega por e-mail depende da configuração SMTP e é exibida de forma honesta ao solicitante.</p></div></div><div className="adminDataTable"><div className="adminDataHead"><span>Solicitante</span><span>Categoria</span><span>Assunto</span><span>Mensagem</span><span>Status</span><span>Quando</span><span>Ação</span></div>{contacts.length ? contacts.map((contact) => <div className="adminDataRow" key={contact.id}><div><strong>{contact.name}</strong><small>{contact.email}</small></div><span>{contact.category}</span><strong>{contact.subject}</strong><span title={contact.message}>{contact.message.length > 72 ? `${contact.message.slice(0, 72)}…` : contact.message}</span><span className={contact.status === 'CLOSED' ? 'status status-success' : 'status status-processing'}>{contact.status}</span><span>{formatDate(contact.createdAt)}</span><div className="rowActions">{contact.status !== 'IN_PROGRESS' && <button className="tableButton" onClick={() => void onUpdateContact(contact.id, 'IN_PROGRESS')}>Em atendimento</button>}{contact.status !== 'CLOSED' && <button className="tableButton ghost" onClick={() => void onUpdateContact(contact.id, 'CLOSED')}>Encerrar</button>}</div></div>) : <div className="emptyList"><strong>Nenhuma mensagem ou solicitação registrada.</strong></div>}</div><section className="adminActionCard"><div className="listHeader"><div><p className="kicker">Governança de auditoria</p><h3>Retenção explícita</h3><p className="muted">Faça uma prévia antes de remover eventos antigos. A execução usa a política configurada e não ocorre silenciosamente.</p></div></div><div className="formGrid"><label>Manter últimos dias<input type="number" min="180" max="3650" value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} /></label></div><div className="rowActions"><button type="button" className="secondaryButton" disabled={loading} onClick={() => void runRetention(true)}>Pré-visualizar candidatos</button><button type="button" className="dangerButton" disabled={loading} onClick={() => { if (window.confirm(`Executar a retenção e remover eventos anteriores a ${retentionDays} dias?`)) void runRetention(false); }}>Executar retenção confirmada</button></div></section></section>}
    {tab === 'queries' && canAudit && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Monitoramento operacional</p><h2>Consultas realizadas</h2><p>Histórico por cliente, produto, valor e status. A área administrativa não expõe detalhes técnicos ao cliente.</p></div></div><div className="adminDataTable"><div className="adminDataHead adminQueries"><span>Cliente</span><span>Placa</span><span>Produto</span><span>Status</span><span>Quando</span></div>{queries.length ? queries.map((query) => <div className="adminDataRow adminQueries" key={query.id}><div><strong>{query.customer.name}</strong><small>{query.customer.email}</small></div><strong>{mask(query.plate)}</strong><span>{query.productName}</span><StatusBadge status={query.status} /><span>{formatDate(query.completedAt ?? query.createdAt)}</span></div>) : <div className="emptyList"><strong>Nenhuma consulta para exibir.</strong></div>}</div></section>}
    {tab === 'users' && canUsers && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Gestão de clientes</p><h2>Usuários e carteiras</h2><p>Selecione uma linha para editar acesso, status, saldo ou remover a conta.</p></div></div><div className="adminDataTable"><div className="adminDataHead adminUsers"><span>Cliente</span><span>Perfil</span><span>Carteira</span><span>Consultas</span><span>Status</span><span>Ação</span></div>{users.length ? users.map((user) => <div className={`adminDataRow adminUsers ${selectedUserId === user.id ? 'selected' : ''}`} key={user.id} onClick={() => setSelectedUserId(user.id)}><div><strong>{user.name}</strong><small>{user.email}</small></div><span>{user.role.replace('_', ' ')}</span><strong>{formatMoney(user.balanceCents)}</strong><span>{user.queriesCount}</span><span className={user.active ? 'status status-success' : 'status status-failed'}>{user.active ? 'Ativo' : 'Inativo'}</span><button className="tableButton" type="button" onClick={(event) => { event.stopPropagation(); setSelectedUserId(user.id); }}>Detalhes</button></div>) : <div className="emptyList"><strong>Nenhum usuário para exibir.</strong></div>}</div></section>}
    {tab === 'users' && canUsers && selectedUser && <section className="adminDetailPanel contentCard"><div className="adminDetailHeader"><div><p className="kicker">Usuário selecionado</p><h2>{selectedUser.name}</h2><p>{selectedUser.email} · criado em {formatDate(selectedUser.createdAt)}</p></div><button className="tableButton ghost" onClick={() => setSelectedUserId(null)}>Fechar</button></div><div className="adminActionGrid"><form className="accountForm adminActionCard" onSubmit={saveUser}><h3>Acesso e status</h3><label>Papel<select name="role" defaultValue={selectedUser.role} disabled={selectedUser.role === 'SUPER_ADMIN'}><option value="CLIENTE">CLIENTE</option><option value="OPERADOR">OPERADOR</option><option value="ADMIN">ADMIN</option><option value="SUPER_ADMIN">SUPER ADMIN</option></select></label><label className="checkField"><input name="active" type="checkbox" defaultChecked={selectedUser.active} disabled={selectedUser.role === 'SUPER_ADMIN'} /><span>Conta ativa</span></label><button className="primaryButton" disabled={loading || selectedUser.id === currentUserId || selectedUser.role === 'SUPER_ADMIN'}>Salvar acesso</button></form><form className="accountForm adminActionCard" onSubmit={adjustWallet}><h3>Ajustar saldo pré-pago</h3><label>Valor em centavos<input name="amountCents" type="number" step="1" placeholder="Ex.: 2500 ou -1000" required /></label><label>Motivo<input name="description" minLength={8} placeholder="Motivo obrigatório do ajuste" required /></label><button className="secondaryButton" disabled={loading}>Registrar ajuste</button></form><div className="adminActionCard dangerCard"><h3>Remover conta</h3><p>A conta será desativada e terá as sessões revogadas.</p><button className="dangerButton" disabled={loading || selectedUser.id === currentUserId || selectedUser.role === 'SUPER_ADMIN'} onClick={deleteUser}>Remover conta</button></div></div></section>}
    {tab === 'products' && canPricing && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Catálogo operacional</p><h2>Produtos e relatórios configuráveis</h2><p>Crie produtos com preço por consulta, descrição comercial e um template de relatório versionado. Campos privados são rejeitados pelo backend.</p></div></div><form className="accountForm adminActionCard" onSubmit={createProduct}><h3>Novo produto</h3><div className="formGrid"><label>ID técnico<input value={productForm.id} onChange={(event) => setProductForm({ ...productForm, id: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 40) })} placeholder="VEHICLE_BASIC" required pattern="[A-Z][A-Z0-9_]{2,39}" /></label><label>Slug comercial<input value={productForm.slug} onChange={(event) => setProductForm({ ...productForm, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60) })} placeholder="consulta-basica" required /></label><label>Nome<input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} required minLength={2} /></label><label>Preço da consulta (centavos)<input type="number" min="0" step="1" value={productForm.priceCents} onChange={(event) => setProductForm({ ...productForm, priceCents: event.target.value })} required /></label><label>Preço de referência (centavos)<input type="number" min="0" step="1" value={productForm.referencePriceCents} onChange={(event) => setProductForm({ ...productForm, referencePriceCents: event.target.value })} placeholder="Informativo" /></label><label>Status comercial<input value={productForm.commercialStatus} onChange={(event) => setProductForm({ ...productForm, commercialStatus: event.target.value.toUpperCase() })} required /></label><label>Origem interna<input value={productForm.source} onChange={(event) => setProductForm({ ...productForm, source: event.target.value })} placeholder="Uso administrativo" /></label><label>Cobertura<input value={productForm.coverage} onChange={(event) => setProductForm({ ...productForm, coverage: event.target.value })} placeholder="Identificação, débitos..." /></label></div><label>Descrição<input value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} required minLength={2} /></label><label>Recursos incluídos <textarea value={productForm.features} onChange={(event) => setProductForm({ ...productForm, features: event.target.value })} placeholder="Um recurso por linha" rows={3} /></label><button className="primaryButton" disabled={loading}>Criar produto e template padrão <span>→</span></button></form><div className="productGrid adminProductGrid">{products.map((product) => <article className={product.active === false ? 'inactiveProduct' : ''} key={product.id}><span>{product.id} · {product.active === false ? 'Inativo' : 'Ativo'}</span><h3>{product.name}</h3><p>{product.description}</p><strong>{formatMoney(product.priceCents)}</strong>{product.referencePriceCents != null && <small>Referência: {formatMoney(product.referencePriceCents)}</small>}<div className="rowActions"><button className="tableButton" onClick={() => setSelectedProductId(product.id)}>Editar produto</button><button className="tableButton ghost" onClick={() => { setTemplateProductId(product.id); void onLoadTemplates(product.id); }}>Templates</button></div></article>)}</div>{selectedProduct && <form className="adminProductEditor accountForm" onSubmit={saveProduct}><div className="adminDetailHeader"><div><p className="kicker">Edição de catálogo</p><h3>{selectedProduct.id}</h3></div><button type="button" className="tableButton ghost" onClick={() => setSelectedProductId(null)}>Fechar</button></div><div className="formGrid"><label>Nome<input name="name" defaultValue={selectedProduct.name} required /></label><label>Preço da consulta (centavos)<input name="priceCents" type="number" min="0" step="1" defaultValue={selectedProduct.priceCents} required /></label></div><label>Descrição<input name="description" defaultValue={selectedProduct.description} required /></label><label className="checkField"><input name="active" type="checkbox" defaultChecked={selectedProduct.active !== false} /><span>Produto ativo</span></label><button className="primaryButton" disabled={loading}>Salvar produto <span>→</span></button></form>}{templateProductId && <section className="adminActionCard"><div className="adminDetailHeader"><div><p className="kicker">Relatório white-label</p><h3>Templates de {products.find((product) => product.id === templateProductId)?.name ?? templateProductId}</h3><p className="muted">A ordem das seções é respeitada. Não inclua caminhos privados; o motor remove proprietário, documentos e endereço mesmo se forem solicitados.</p></div><button type="button" className="tableButton ghost" onClick={() => setTemplateProductId(null)}>Fechar</button></div><div className="adminDataTable">{(templates[templateProductId] ?? []).map((template) => <div className="adminDataRow" key={template.id}><div><strong>{template.name}</strong><small>Versão {template.version} · {template.status}</small></div><span>{template.config.sections.length} seção(ões)</span>{template.status === 'PUBLISHED' ? <span className="status status-success">Publicado</span> : <button className="tableButton" onClick={() => void onPublishTemplate(template.id, templateProductId)}>Publicar</button>}</div>)}</div><form className="accountForm" onSubmit={createTemplate}><h4>Nova versão</h4><div className="formGrid"><label>Nome da versão<input value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })} required minLength={2} /></label><label>Status inicial<select value={templateForm.status} onChange={(event) => setTemplateForm({ ...templateForm, status: event.target.value as 'DRAFT' | 'PUBLISHED' })}><option value="DRAFT">Rascunho</option><option value="PUBLISHED">Publicar agora</option></select></label></div><label>Configuração JSON segura<textarea value={templateForm.config} onChange={(event) => setTemplateForm({ ...templateForm, config: event.target.value })} rows={12} spellCheck={false} required /></label><button className="secondaryButton" disabled={loading}>Criar versão de template</button></form></section>}</section>}
    {tab === 'payments' && canBilling && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Conciliação financeira</p><h2>Pagamentos recentes</h2><p>Valores só são reconhecidos após confirmação do provedor; nenhum pagamento é considerado pago pela interface.</p></div></div><div className="adminDataTable"><div className="adminDataHead payments"><span>Cliente</span><span>Valor</span><span>Tipo</span><span>Provedor</span><span>Status</span></div>{payments.length ? payments.map((payment) => <div className="adminDataRow payments" key={payment.id}><div><strong>{payment.customer.name}</strong><small>{payment.customer.email}</small></div><strong>{formatMoney(payment.amountCents)}</strong><span>{payment.purchaseType === 'QUERY' ? 'Consulta individual' : 'Saldo pré-pago'}</span><span>{payment.provider}</span><StatusBadge status={payment.status === 'PAID' ? 'SUCCESS' : payment.status === 'FAILED' ? 'FAILED' : 'PROCESSING'} /></div>) : <div className="emptyList"><strong>Nenhum pagamento conciliado ainda.</strong></div>}</div></section>}
    {tab === 'audit' && canAudit && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Rastro de operação</p><h2>Log de auditoria</h2><p>Os eventos mais recentes aparecem primeiro.</p></div></div><div className="adminDataTable"><div className="adminDataHead adminAudit"><span>Ator</span><span>Ação</span><span>Entidade</span><span>Quando</span></div>{auditEntries.length ? auditEntries.map((entry) => <div className="adminDataRow adminAudit" key={entry.id}><div><strong>{entry.actor?.name ?? 'Sistema'}</strong><small>{entry.actor?.email ?? 'evento automático'}</small></div><strong>{entry.action}</strong><span>{entry.entity}{entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}</span><span>{formatDate(entry.createdAt)}</span></div>) : <div className="emptyList"><strong>Nenhum evento de auditoria para exibir.</strong></div>}</div></section>}
    {tab === 'lookup' && canLookup && <section className="adminSection contentCard"><div className="listHeader"><div><p className="kicker">Ferramenta de suporte</p><h2>Consulta administrativa</h2><p>Investigue sem consumir o saldo do cliente. Cada execução é registrada.</p></div><span className="adminLookupBadge">Sem débito do cliente</span></div><form className="adminLookupForm accountForm" onSubmit={submitLookup}><div className="formGrid"><label>Placa do veículo<input name="plate" value={lookupPlate} onChange={(event) => setLookupPlate(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))} placeholder="ABC1D23" maxLength={7} required /></label><label>Produto<select value={lookupProductId} onChange={(event) => setLookupProductId(event.target.value)} required>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label></div><button className="primaryButton" disabled={loading || !lookupProductId}>Executar consulta interna <span>→</span></button></form>{lookupResult && <div className="adminLookupResult"><div className="adminDetailHeader"><div><p className="kicker">Retorno registrado</p><h3>{lookupResult.result.identification.fullModel ?? lookupResult.result.identification.model ?? 'Veículo consultado'}</h3><p>{lookupResult.plate} · {lookupResult.productName} · {formatDate(lookupResult.consultedAt)}</p></div><span className="status status-success">Sem débito</span></div><div className="reportMetrics"><Metric label="Situação" value={lookupResult.result.registration.status ?? 'Não informado'} /><Metric label="Ocorrências" value={lookupResult.result.restrictions.filter((item) => item.alert).length ? 'Atenção' : 'Nada consta'} attention={lookupResult.result.restrictions.some((item) => item.alert)} /><Metric label="Débitos" value={formatMoney(lookupResult.result.debts.reduce((sum, item) => sum + item.amountCents, 0))} attention={lookupResult.result.debts.some((item) => item.hasDebt)} /><Metric label="Provedor interno" value={lookupResult.provider} /></div></div>}</section>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
