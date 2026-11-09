import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { LinkButton, Skeleton, usePageTitle, useAsync } from '../../shared/ui';
import SeoContent from '../components/SeoContent';
import { pct } from '../simulator';

interface FinLink { path: string; name: string; monthlyPct: number | null }
interface FinancingPageData {
  path: string; kind: 'hub' | 'bank' | 'custom'; name: string; h1: string; title: string; description: string;
  blocks: Array<{ h: string; p: string }>; faq: Array<{ q: string; a: string }>; links: FinLink[]; table: FinLink[];
}

const label = (l: FinLink) => (l.path.startsWith('/financiamento/') ? `Financiamento de carro ${l.name}` : l.name);

/**
 * "Financiamento de carro {banco}", o índice /financiamento e as páginas criadas no painel de SEO.
 * Mostra o mesmo conteúdo que o servidor entrega no HTML inicial: blocos com a taxa real, tabela, perguntas e links.
 */
export default function FinancingBank() {
  const path = useLocation().pathname.replace(/\/$/, '') || '/';
  const { data, loading, error } = useAsync(() => api.get<FinancingPageData>('/simulator/financing-page', { query: { path } }), [path]);
  usePageTitle(data?.title.split(' | ')[0] ?? '');
  if (error && !data) return <section className="section"><div className="container"><h1>Página não encontrada</h1><p className="lead">O endereço que você abriu não existe ou foi removido.</p><LinkButton to="/simulador/carro" variant="primary">Simular financiamento</LinkButton></div></section>;
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">Financiamento de veículos</span>
          <h1>{data?.h1 ?? <Skeleton h={40} w="70%" />}</h1>
          <p className="lead" style={{ minHeight: 52 }}>{data?.description ?? ''}</p>
          <div className="row" style={{ marginTop: 22 }}>
            <LinkButton to="/simulador/carro" variant="primary" size="lg" iconRight="arrow-right">Simular financiamento</LinkButton>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 24, minHeight: loading ? 480 : undefined }}>
        <div className="container" style={{ maxWidth: 820 }}>
          {data?.blocks.map((b) => <article key={b.h} className="seo-block"><h2>{b.h}</h2><p>{b.p}</p></article>)}
          {data && data.table.length > 0 && (
            <article className="seo-block">
              <h2>Taxa por banco</h2>
              <ul>{data.table.map((t) => <li key={t.path}><Link to={t.path}>{label(t)}</Link>{t.monthlyPct != null ? `: ${pct(t.monthlyPct)} ao mês` : ''}</li>)}</ul>
            </article>
          )}
          {data && data.faq.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 32 }}><h2>Perguntas frequentes</h2></div>
              <div className="faq" style={{ margin: 0 }}>{data.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
            </>
          )}
          {data && data.links.length > 0 && (
            <article className="seo-block" style={{ marginTop: 32 }}>
              <h2>Veja também</h2>
              <ul>{data.links.map((l) => <li key={l.path}><Link to={l.path}>{label(l)}</Link>{l.monthlyPct != null ? `: ${pct(l.monthlyPct)} ao mês` : ''}</li>)}</ul>
            </article>
          )}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 24 }}>Estimativa para comparar caminhos, não é oferta de crédito nem promessa de aprovação. As condições finais dependem da análise da instituição financeira.</p>
        </div>
      </section>
      {data && <SeoContent path={path} faqTitle="Mais perguntas" />}
    </>
  );
}
