import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { LinkButton, usePageTitle } from '../../shared/ui';
import { trackFunnel } from '../funnel';
import { SEO_BY_PATH } from '../content/seoPages';
import { useSession } from '../session';
import PlateSearch from '../components/PlateSearch';
import { useFaqs } from '../components/Faq';
import { SeoH1, useSeoContent } from '../components/SeoContent';

const TOOLS = [
  { to: '/fipe', icon: 'tag', title: 'Valor FIPE', text: 'Preço médio do veículo, grátis.' },
  { to: '/simulador', icon: 'calculator', title: 'Simular financiamento', text: 'CDC e leasing lado a lado.' },
  { to: '/comparar', icon: 'list', title: 'Comparar versões', text: 'Consumo, custos e ficha.' },
  { to: '/veiculos', icon: 'car', title: 'Guia de veículos', text: 'Ficha técnica e opiniões.' }
] as const;

export default function SeoPage({ path }: { path: string }) {
  const page = SEO_BY_PATH.get(path)!;
  const { status } = useSession();
  usePageTitle(page.title);
  const { data: faqs } = useFaqs();
  useEffect(() => { trackFunnel('SEO_PAGE_VIEW', { landing: path, intent: page.intent }); }, [path, page.intent]);
  const seo = useSeoContent(path);
  const faq = seo && seo.faq.length ? seo.faq : [...(page.faq ?? []), ...(faqs ?? []).slice(0, 3).map((f) => ({ q: f.question, a: f.answer }))];
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">{page.kicker}</span>
          <SeoH1 path={path} fallback={page.heading} />
          <p className="lead">{page.lead}</p>
          <div style={{ marginTop: 26, maxWidth: 640 }}>
            {page.intent === 'plate' ? <PlateSearch authed={status === 'authed'} placement="seo_hero" /> : <div className="row"><LinkButton to="/criar-conta" variant="primary" size="lg" iconRight="arrow-right">Criar conta grátis</LinkButton><LinkButton to="/contato?assunto=comercial" size="lg">Falar com a equipe</LinkButton></div>}
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 24 }}>
        <div className="container">
          <div className="why-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>{page.points.map((p) => <div className="why-card" key={p.title}><span className="wi"><Icon name="check-circle" size={24} /></span><h3>{p.title}</h3><p>{p.text}</p></div>)}</div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <div className="why-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {TOOLS.map((t) => (
              <Link key={t.to} to={t.to} className="why-card" onClick={() => trackFunnel('CTA_CLICKED', { placement: 'seo_tools', target: t.to, landing: path })}>
                <span className="wi"><Icon name={t.icon} size={24} /></span><h3>{t.title}</h3><p>{t.text}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="container" style={{ maxWidth: 820 }}>
          <div className="alert info"><Icon name="info" /><div><b>“Não informado” não significa “nada consta”.</b> A Placa na Mão diferencia um dado sem ocorrência de um campo que a fonte não retornou, para você nunca tirar uma conclusão errada.</div></div>
          <div className="section-head" style={{ marginTop: 40 }}><h2>Perguntas frequentes</h2></div>
          <div className="faq" style={{ margin: 0 }}>{faq.map((i) => { const q = 'q' in i ? i.q : ''; const a = 'a' in i ? i.a : ''; return <details key={q}><summary>{q}</summary><p>{a}</p></details>; })}</div>
          <div className="row" style={{ marginTop: 32 }}><LinkButton to="/consultar" variant="primary" size="lg" iconRight="arrow-right">Consultar uma placa</LinkButton><Link to="/planos" className="btn btn-lg">Ver preços</Link></div>
        </div>
      </section>
    </>
  );
}
