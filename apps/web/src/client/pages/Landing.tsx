import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../../shared/icons';
import { LinkButton, usePageTitle } from '../../shared/ui';
import { money } from '../../shared/format';
import { HeroArt, PhoneFrame } from '../art';
import { PublicHeader } from '../layouts';
import { useSession } from '../session';
import { trackFunnel } from '../funnel';
import PlateSearch from '../components/PlateSearch';
import { PackageCards, ProductCards, SmartPicker, useCatalog } from '../components/Catalog';
import Faq from '../components/Faq';
import Testimonials from '../components/Testimonials';
import { DetailsButton, PdfModelLink } from '../components/ConsultaDetails';
import { SeoContentAfterFaqs, useSeoH1 } from '../components/SeoContent';

const STEPS = [
  { t: 'Digite a placa', s: 'Placa antiga ou Mercosul.' },
  { t: 'Escolha a consulta', s: 'O preço aparece antes de pagar.' },
  { t: 'Receba o relatório', s: 'Na tela e em PDF, em segundos.' }
];

const TOOLS: Array<{ to: string; icon: IconName; title: string; text: string }> = [
  { to: '/fipe', icon: 'trending-up', title: 'Tabela FIPE', text: 'Preço médio por marca, modelo e ano.' },
  { to: '/simulador', icon: 'calculator', title: 'Simulador de financiamento', text: 'Parcela e custo total.' },
  { to: '/veiculos', icon: 'car', title: 'Guia de veículos', text: 'Fichas e modelos em destaque.' },
  { to: '/comparar', icon: 'bar-chart', title: 'Comparar veículos', text: 'Lado a lado, em segundos.' },
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
function HeroTitle() {
  const h1 = useSeoH1('/', '');
  if (!h1) return <h1 id="hero-title">Saiba tudo sobre o carro <span className="grad-text">antes de fechar negócio.</span></h1>;
  return <><h1 id="hero-title">{h1}</h1><p className="hero-tag">Saiba tudo sobre o carro <span className="grad-text">antes de fechar negócio.</span></p></>;
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

export default function Landing() {
  usePageTitle('');
  const { status } = useSession();
  const price = useFromPrice();
  useEffect(() => { trackFunnel('HOME_PAGE_VIEW', { landing: '/' }); }, []);
  return (
    <>
      <PublicHeader overHero />
      <section className="hero2" id="hero" aria-labelledby="hero-title">
        <div className="hero2-bg" aria-hidden="true" />
        <div className="container hero2-grid">
          <div className="hero2-copy">
            <HeroTitle />
            <p className="hero-lead">Débitos, multas, restrições e gravame em um só relatório. Sem mensalidade: você paga só a consulta que fizer.</p>
            <PlateSearch authed={status === 'authed'} placement="hero" />
            <div className="trust-row">
              {price && <span className="from"><Icon name="tag" size={16} />A partir de {price}</span>}
              <span><Icon name="shield-check" size={16} />Pagamento seguro</span>
              <span><Icon name="zap" size={16} />Resultado em segundos</span>
              <PdfModelLink id="COMPLETE" className="linkbtn light">Ver modelo do PDF</PdfModelLink>
            </div>
          </div>
          <div className="hero2-visual" aria-hidden="true">
            <div className="hv-card">
              <div className="hv-top"><span className="hv-plate">ABC 1D23</span><div><b>VW Exemplo 1.0</b><small>2020/2021 · Prata · Flex</small></div></div>
              <div className="hv-verdict"><Icon name="shield-check" size={20} /><div><b>Sem alertas relevantes</b><small>Nada consta nas bases consultadas</small></div></div>
              <div className="hv-tiles">
                <div><small>Débitos</small><b className="ok">Nenhum</b></div>
                <div><small>Restrições</small><b className="ok">Nada consta</b></div>
                <div><small>Gravame</small><b className="ok">Nada consta</b></div>
                <div><small>FIPE</small><b>R$ 32.500</b></div>
              </div>
              <svg className="hv-chart" viewBox="0 0 300 70" preserveAspectRatio="none"><defs><linearGradient id="hvg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#60A5FA" stopOpacity=".35" /><stop offset="1" stopColor="#60A5FA" stopOpacity="0" /></linearGradient></defs><path d="M0 14 C40 18 70 24 110 30 S190 44 230 48 S280 56 300 58 L300 70 L0 70Z" fill="url(#hvg)" /><path d="M0 14 C40 18 70 24 110 30 S190 44 230 48 S280 56 300 58" fill="none" stroke="#7CB9FF" strokeWidth="2" /></svg>
              <small className="hv-cap">Histórico da FIPE nos últimos 24 meses</small>
            </div>
            <div className="hv-float"><Icon name="file-text" size={18} /><div><b>Relatório em PDF</b><small>com código de validação</small></div></div>
            <span className="hv-sample">Exemplo ilustrativo, com dados fictícios</span>
          </div>
        </div>
      </section>

      <section className="section" id="consultas">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2>Escolha a consulta.</h2><p>O valor aparece antes de pagar.</p></div>
          <ProductCards homeOnly />
          <div className="row home-cta-row">
            <DetailsButton className="btn">Comparar consultas</DetailsButton>
            <LinkButton to="/planos" iconRight="arrow-right">Preços e pacotes</LinkButton>
          </div>
          <details className="picker-toggle">
            <summary><span>Não sabe qual escolher?</span><Icon name="chevron-down" size={18} /></summary>
            <SmartPicker />
          </details>
        </div>
      </section>

      <section className="section alt" id="como-funciona">
        <div className="container showcase">
          <div>
            <h2 style={{ fontSize: 'clamp(26px,3.6vw,38px)' }}>Relatório claro, do jeito que você precisa.</h2>
            <ul className="checklist">
              {['Situação do veículo resumida no topo', 'Débitos e multas com valores, sem duplicidade', 'PDF com código de validação para compartilhar'].map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} /></span>{t}</li>)}
            </ul>
            <div className="steps-inline" aria-label="Como funciona">{STEPS.map((s) => <div key={s.t}><b>{s.t}</b><span>{s.s}</span></div>)}</div>
            <div className="row" style={{ marginTop: 24 }}><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Consultar agora</LinkButton></div>
            <span className="sample-tag">Imagens ilustrativas, com dados fictícios.</span>
          </div>
          <SamplePhones />
        </div>
      </section>

      <section className="section" id="pacotes">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2>Consulte mais, pague menos por consulta.</h2><p>Recarregue o saldo e use em qualquer consulta. Sem mensalidade.</p></div>
          <PackageCards />
          <div className="custom-card slim">
            <div>
              <h3>Lojista ou empresa?</h3>
              <p>Pacotes personalizados com preço menor por consulta, acesso da equipe e histórico centralizado.</p>
            </div>
            <div className="custom-cta">
              <LinkButton to="/para-lojistas" variant="primary" iconRight="arrow-right">Ver pacotes para lojistas</LinkButton>
              <Link to="/contato" className="linkbtn">Falar com a equipe</Link>
            </div>
          </div>
        </div>
      </section>

      <Testimonials />

      <section className="section" id="duvidas">
        <div className="container">
          <div className="section-head center"><h2>Dúvidas frequentes.</h2></div>
          <Faq limit={6} />
          <div className="row" style={{ justifyContent: 'center', marginTop: 22 }}><Link to="/perguntas-frequentes" className="btn">Ver todas as perguntas</Link></div>
        </div>
      </section>

      <section className="section alt tools-strip" id="ferramentas-gratis" aria-labelledby="tools-title">
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
      </section>

      <SeoContentAfterFaqs path="/" limit={6} faqTitle="Mais perguntas sobre consulta de placa" />

      <section className="section" style={{ paddingTop: 0 }} id="consultar-final">
        <div className="container">
          <div className="final-banner solo">
            <div className="art" aria-hidden="true"><HeroArt /></div>
            <div>
              <h2>Consulte a placa antes de fechar negócio.</h2>
              <p>Leva menos de um minuto.</p>
              <PlateSearch authed={status === 'authed'} placement="final" />
            </div>
          </div>
        </div>
      </section>

      <StickyCta price={price} />
    </>
  );
}
