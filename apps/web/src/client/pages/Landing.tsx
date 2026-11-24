import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../shared/icons';
import { LinkButton, usePageTitle } from '../../shared/ui';
import { money } from '../../shared/format';
import { HeroArt, PhoneFrame } from '../art';
import { PublicHeader } from '../layouts';
import { useSession } from '../session';
import { useHomeConfig } from '../homeConfig';
import { HOME_DEFAULTS, type HomeConfig } from '../../shared/homeDefaults';
import { trackFunnel } from '../funnel';
import PlateChoice from '../components/PlateChoice';
import { PackageCards, ProductCards, SmartPicker, useCatalog, useFreeOffers } from '../components/Catalog';
import { LANDINGS } from '../content/landingPages';
import Faq from '../components/Faq';
import Testimonials from '../components/Testimonials';
import { DetailsButton, PdfModelLink } from '../components/ConsultaDetails';
import { SeoContentAfterFaqs, useSeoH1 } from '../components/SeoContent';

const HomeSimulator = lazy(() => import('../components/HomeTools').then((m) => ({ default: m.HomeSimulator })));

const STEPS = [
  { t: 'Digite a placa', s: 'Placa antiga ou Mercosul.' },
  { t: 'Escolha a consulta', s: 'O preço aparece antes de pagar.' },
  { t: 'Receba o relatório', s: 'Na tela e em PDF.' }
];

const TOOLS: Array<{ to: string; icon: IconName; title: string; text: string }> = [
  { to: '/fipe', icon: 'trending-up', title: 'Tabela FIPE', text: 'Preço médio por marca, modelo e ano.' },
  { to: '/simulador', icon: 'calculator', title: 'Simulador de financiamento', text: 'Parcela e custo total.' },
  { to: '/veiculos', icon: 'car', title: 'Guia de veículos', text: 'Fichas e modelos em destaque.' },
  { to: '/comparar', icon: 'bar-chart', title: 'Comparar veículos', text: 'Lado a lado, com ficha técnica.' },
  { to: '/blog', icon: 'file-text', title: 'Blog', text: 'Guias para comprar e vender.' }
];

function SamplePhones() {
  return (
    <div className="phones" aria-label="Exemplo ilustrativo do relatório, com dados fictícios">
      <PhoneFrame className="sm">
        <div className="mini-plate"><div><b>ABC1D23</b><small className="muted" style={{ display: 'block' }}>VW / Exemplo 1.0 · 2020/2021</small></div><Icon name="shield-check" size={20} /></div>
        <div className="mini-verdict"><Icon name="shield-check" size={22} /><div><b>Sem alertas relevantes</b><span>Veículo sem pendências</span></div></div>
        {[['car', 'Dados cadastrais', 'Marca, modelo, ano e cor'], ['dollar', 'Débitos', 'Licenciamento, IPVA'], ['shield-alert', 'Restrições', 'Roubo, furto e outras'], ['credit-card', 'Financiamento', 'Gravame e contratos']].map(([i, t, s]) => (
          <div className="mini-row" key={t}><span className="mi"><Icon name={i as IconName} size={15} /></span><div><b>{t}</b><small>{s}</small></div></div>
        ))}
      </PhoneFrame>
      <PhoneFrame>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 13 }}><span>Relatório completo</span><Icon name="menu" size={16} /></div>
        <div className="mini-verdict"><Icon name="shield-check" size={22} /><div><b>Situação do veículo</b><span>Sem restrições</span></div></div>
        {[['dollar', 'Débitos pendentes', 'R$ 0,00'], ['receipt', 'Multas', 'R$ 0,00'], ['shield-alert', 'Restrições', 'Nada consta'], ['file-text', 'Gravame', 'Nada consta']].map(([i, t, s]) => (
          <div className="mini-row" key={t}><span className="mi"><Icon name={i as IconName} size={15} /></span><div><b>{t}</b><small>{s}</small></div></div>
        ))}
        <div className="mini-btn">Baixar relatório</div>
      </PhoneFrame>
    </div>
  );
}

/** H1 da home: o texto curto configurado no painel de SEO; a frase de efeito vira o subtítulo. */
function HeroTitle({ tag, hold }: { tag: string | null; hold: boolean }) {
  const h1 = useSeoH1('/', '');
  const style = hold ? { visibility: 'hidden' as const } : undefined;
  const line = tag ? <>{tag}</> : <>Saiba tudo sobre o carro <span className="grad-text">antes de fechar negócio.</span></>;
  if (!h1) return <h1 id="hero-title" style={style}>{line}</h1>;
  return <><h1 id="hero-title">{h1}</h1><p className="hero-tag" style={style}>{line}</p></>;
}

/** Aviso de campanha configurado no painel (texto curto + link opcional). */
function Announce({ a }: { a: HomeConfig['announce'] }) {
  if (!a.enabled || !a.text) return null;
  const go = () => trackFunnel('CTA_CLICKED', { placement: 'announce', target: a.linkTo ?? '', landing: '/' });
  const label = a.linkLabel && a.linkTo ? a.linkLabel : null;
  return (
    <div className="hero2-pill" role="note">
      <span>{a.text}</span>
      {label && a.linkTo && (a.linkTo.startsWith('/')
        ? <Link to={a.linkTo} onClick={go}>{label} <Icon name="arrow-right" size={14} /></Link>
        : <a href={a.linkTo} target="_blank" rel="noopener noreferrer" onClick={go}>{label} <Icon name="arrow-right" size={14} /></a>)}
    </div>
  );
}

/** Menor preço de consulta do catálogo (vem do painel; nada fixo no código). */
function useFromPrice(): string | null {
  const { data } = useCatalog();
  return useMemo(() => {
    const prices = (data?.products ?? []).filter((p) => !p.isFree && p.commercialStatus === 'ACTIVE' && p.priceCents > 0).map((p) => p.priceCents);
    return prices.length ? money(Math.min(...prices)) : null;
  }, [data]);
}

/** Barra fixa no celular: aparece depois do topo e some quando a busca final está na tela. */
function StickyCta({ price }: { price: string | null }) {
  const [heroIn, setHeroIn] = useState(true);
  const [endIn, setEndIn] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const hero = document.getElementById('hero');
    const end = document.getElementById('consultar-final');
    const a = new IntersectionObserver(([e]) => setHeroIn(Boolean(e?.isIntersecting)));
    // some quando a busca final aparece e também depois que ela já passou (rodapé)
    const b = new IntersectionObserver(([e]) => setEndIn(Boolean(e && (e.isIntersecting || e.boundingClientRect.top < 0))));
    if (hero) a.observe(hero); else setHeroIn(false);
    if (end) b.observe(end);
    return () => { a.disconnect(); b.disconnect(); };
  }, []);
  const show = !heroIn && !endIn;
  useEffect(() => {
    const root = document.documentElement;
    if (show) root.setAttribute('data-sticky-cta', ''); else root.removeAttribute('data-sticky-cta');
    return () => root.removeAttribute('data-sticky-cta');
  }, [show]);
  function go() {
    trackFunnel('CTA_CLICKED', { placement: 'sticky_mobile', target: '#hero', landing: '/' });
    document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#hero .plate-search input')?.focus({ preventScroll: true }), 450);
  }
  return (
    <div className={`sticky-cta${show ? ' on' : ''}`} aria-hidden={!show}>
      <button type="button" className="btn btn-primary btn-lg" onClick={go} tabIndex={show ? 0 : -1}><Icon name="search" size={19} /> Consultar placa{price ? <small>a partir de {price}</small> : null}</button>
    </div>
  );
}

/** Três atalhos logo abaixo do topo: FIPE grátis com dados do veículo, consultas e simulador. */
function HomeHighlights({ price }: { price: string | null }) {
  const { status } = useSession();
  const offers = useFreeOffers();
  const authed = status === 'authed';
  const click = (target: string) => trackFunnel('CTA_CLICKED', { placement: 'home_highlights', target, landing: '/' });
  return (
    <section className="section" style={{ paddingBottom: 0 }} aria-label="Por onde começar">
      <div className="container">
        <div className="home-free">
          {offers.fipe && (
            <div className="home-free-card hl">
              <span className="eyebrow">Grátis</span>
              <h3>FIPE pela placa, com dados do veículo</h3>
              <p>Valor FIPE, histórico de preço e os dados essenciais do veículo. Crie sua conta grátis para ver, baixar e imprimir.</p>
              <LinkButton to={authed ? '/app/fipe' : '/fipe'} variant="primary" size="lg" iconRight="arrow-right" onClick={() => click('fipe')}>Consultar FIPE grátis</LinkButton>
            </div>
          )}
          <div className="home-free-card">
            <span className="wi"><Icon name="shield-check" size={24} /></span>
            <h3>Consultas de placa</h3>
            <p>Débitos, multas, restrições, gravame e leilão. {price ? `A partir de ${price}, ` : ''}sem mensalidade.</p>
            <a className="btn btn-lg" href="#consultas" onClick={() => click('consultas')}>Ver as consultas <Icon name="arrow-right" size={18} /></a>
          </div>
          <div className="home-free-card">
            <span className="wi"><Icon name="calculator" size={24} /></span>
            <h3>Simulador de financiamento</h3>
            <p>Veja a parcela, o CET e o custo total antes de ir ao banco. Grátis.</p>
            <LinkButton to="/simulador" size="lg" iconRight="arrow-right" onClick={() => click('simulador')}>Simular agora</LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  usePageTitle('');
  const { status } = useSession();
  const price = useFromPrice();
  const { config: c, images: img, ready } = useHomeConfig();
  const T = (k: 'consultasTitle' | 'consultasSub' | 'showcaseTitle' | 'packsTitle' | 'packsSub' | 'finalTitle' | 'finalSub') => c[k] ?? HOME_DEFAULTS[k];
  const bullets = c.showcaseBullets.length ? c.showcaseBullets : HOME_DEFAULTS.showcaseBullets;
  useEffect(() => { trackFunnel('HOME_PAGE_VIEW', { landing: '/' }); }, []);
  return (
    <>
      <PublicHeader overHero />
      <section className="hero2" id="hero" aria-labelledby="hero-title">
        <div className="hero2-bg" aria-hidden="true" />
        <div className="container hero2-grid">
          <div className="hero2-copy">
            <Announce a={c.announce} />
            <HeroTitle tag={c.heroTag} hold={!ready} />
            <p className="hero-lead" style={ready ? undefined : { visibility: 'hidden' }}>{c.heroLead ?? HOME_DEFAULTS.heroLead}</p>
            <PlateChoice authed={status === 'authed'} placement="hero" />
            <div className="trust-row">
              {price && <span className="from"><Icon name="tag" size={16} />A partir de {price}</span>}
              <span><Icon name="shield-check" size={16} />Pagamento seguro</span>
              <span><Icon name="file-text" size={16} />PDF com código de validação</span>
              <PdfModelLink id="COMPLETE" className="linkbtn light">Ver modelo do PDF</PdfModelLink>
            </div>
          </div>
          {img.hero ? (
            <div className="hero2-visual has-img" aria-hidden="true"><img src={img.hero.url} width={img.hero.width ?? undefined} height={img.hero.height ?? undefined} alt="" decoding="async" fetchPriority="high" /></div>
          ) : (
          <div className="hero2-visual" aria-hidden="true">
            <div className="hv-card">
              <div className="hv-top"><span className="hv-plate">ABC 1D23</span><div><b>VW Exemplo 1.0</b><small>2020/2021 · Prata · Flex</small></div></div>
              <div className="hv-verdict"><Icon name="trending-up" size={20} /><div><b>FIPE grátis</b><small>Valor médio de referência do mês</small></div></div>
              <div className="hv-tiles">
                <div><small>Valor FIPE</small><b>R$ 32.500</b></div>
                <div><small>Ano</small><b>2020/2021</b></div>
                <div><small>Combustível</small><b>Flex</b></div>
                <div><small>Chassi</small><b>9BW••1234</b></div>
              </div>
              <svg className="hv-chart" viewBox="0 0 300 70" preserveAspectRatio="none"><defs><linearGradient id="hvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#60A5FA" stopOpacity=".35" /><stop offset="1" stopColor="#60A5FA" stopOpacity="0" /></linearGradient></defs><path d="M0 14 C40 18 70 24 110 30 S190 44 230 48 S280 56 300 58 L300 70 L0 70Z" fill="url(#hvg)" /><path d="M0 14 C40 18 70 24 110 30 S190 44 230 48 S280 56 300 58" fill="none" stroke="#7CB9FF" strokeWidth="2" /></svg>
              <small className="hv-cap">Histórico de preço da FIPE nos últimos 24 meses</small>
            </div>
            <div className="hv-float"><Icon name="file-text" size={18} /><div><b>Relatório em PDF</b><small>com código de validação</small></div></div>
            <span className="hv-sample">Exemplo ilustrativo, com dados fictícios</span>
          </div>
          )}
        </div>
      </section>

      <HomeHighlights price={price} />

      <section className="section" id="consultas">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2>{T('consultasTitle')}</h2><p>{T('consultasSub')}</p></div>
          <ProductCards homeOnly />
          <div className="row home-cta-row">
            <DetailsButton className="btn">Comparar consultas</DetailsButton>
            <LinkButton to="/planos" iconRight="arrow-right">Preços e pacotes</LinkButton>
          </div>
          <nav className="home-lp-links" aria-label="Página de cada consulta">
            <span>Veja os detalhes de cada consulta:</span>
            {LANDINGS.map((l) => <Link key={l.slug} to={l.path} onClick={() => trackFunnel('CTA_CLICKED', { placement: 'home_landing_links', target: l.path, landing: '/' })}>{l.short}</Link>)}
          </nav>
          <details className="picker-toggle">
            <summary><span>Não sabe qual escolher?</span><Icon name="chevron-down" size={18} /></summary>
            <SmartPicker />
          </details>
        </div>
      </section>

      <Suspense fallback={null}><HomeSimulator /></Suspense>

      <section className="section alt" id="como-funciona">
        <div className="container showcase">
          <div>
            <h2 style={{ fontSize: 'clamp(26px,3.4vw,38px)' }}>{T('showcaseTitle')}</h2>
            <ul className="checklist">
              {bullets.map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} /></span>{t}</li>)}
            </ul>
            {c.show.steps && <div className="steps-inline" aria-label="Como funciona">{STEPS.map((s) => <div key={s.t}><b>{s.t}</b><span>{s.s}</span></div>)}</div>}
            <div className="row" style={{ marginTop: 24 }}><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Consultar agora</LinkButton></div>
            {!img.showcase && <span className="sample-tag">Imagens ilustrativas, com dados fictícios.</span>}
          </div>
          {img.showcase ? <div className="showcase-img"><img src={img.showcase.url} width={img.showcase.width ?? undefined} height={img.showcase.height ?? undefined} alt="" loading="lazy" decoding="async" /></div> : <SamplePhones />}
        </div>
      </section>

      <section className="section" id="pacotes">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2>{T('packsTitle')}</h2><p>{T('packsSub')}</p></div>
          <PackageCards />
          {c.show.lojista && <div className="custom-card slim">
            <div>
              <h3>Lojista ou empresa?</h3>
              <p>Pacotes personalizados com preço menor por consulta, acesso da equipe e histórico centralizado.</p>
            </div>
            <div className="custom-cta">
              <LinkButton to="/para-lojistas" variant="primary" iconRight="arrow-right">Ver pacotes para lojistas</LinkButton>
              <Link to="/contato" className="linkbtn">Falar com a equipe</Link>
            </div>
          </div>}
        </div>
      </section>

      {c.show.testimonials && <Testimonials />}

      <section className="section" id="duvidas">
        <div className="container">
          <div className="section-head center"><h2>Dúvidas frequentes.</h2></div>
          <Faq limit={6} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}><Link to="/perguntas-frequentes" className="btn">Ver todas as perguntas</Link></div>
        </div>
      </section>

      {c.show.tools && <section className="section alt tools-strip" id="ferramentas-gratis" aria-labelledby="tools-title">
        <div className="container stack-lg">
          <div className="section-head" style={{ marginBottom: 0 }}><h2 id="tools-title">Ferramentas grátis.</h2></div>
          <div className="tools-mini">
            {TOOLS.map((t) => (
              <Link key={t.to} to={t.to} className="tool-mini" onClick={() => trackFunnel('CTA_CLICKED', { placement: 'home_tools', target: t.to, landing: '/' })}>
                <span className="wi"><Icon name={t.icon} size={22} /></span>
                <span><b>{t.title}</b><small>{t.text}</small></span>
              </Link>
            ))}
          </div>
        </div>
      </section>}

      <SeoContentAfterFaqs path="/" limit={6} faqTitle="Mais perguntas sobre consulta de placa" />

      <section className="section" style={{ paddingTop: 0 }} id="consultar-final">
        <div className="container">
          <div className="final-banner solo">
            <div className="art" aria-hidden="true">{img.final ? <img src={img.final.url} alt="" loading="lazy" decoding="async" /> : <HeroArt />}</div>
            <div>
              <h2>{T('finalTitle')}</h2>
              <p>{T('finalSub')}</p>
              <PlateChoice authed={status === 'authed'} placement="final" note={false} />
            </div>
          </div>
        </div>
      </section>

      <StickyCta price={price} />
    </>
  );
}
