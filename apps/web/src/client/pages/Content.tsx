import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { EmptyState, ErrorState, LinkButton, PageLoading, Skeleton, usePageTitle, useAsync } from '../../shared/ui';
import { dateOnly } from '../../shared/format';
import { Markdown } from '../../shared/markdown';
import { api, type ArticleFull, type ArticleSummary } from '../api';
import Faq from '../components/Faq';

/* ---------- /perguntas-frequentes ---------- */
export function FaqPage() {
  usePageTitle('Perguntas frequentes');
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Ajuda</span><h1>Perguntas frequentes</h1><p className="lead">Respostas diretas sobre consultas, pagamento, privacidade e o que cada relatório mostra.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}><div className="container"><Faq searchable /></div></section>
    </>
  );
}

/* ---------- Blog ---------- */
function Cover({ a }: { a: ArticleSummary }) {
  return <div className="post-cover">{a.coverImageUrl ? <img src={a.coverImageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name="car" size={44} />}</div>;
}

export function PostCard({ a }: { a: ArticleSummary }) {
  return (
    <Link to={`/blog/${a.slug}`} className="post-card">
      <Cover a={a} />
      <div className="post-body">
        <span className="cat-tag">{a.category}</span>
        <h3>{a.title}</h3>
        <p>{a.excerpt}</p>
        <div className="post-meta"><span>{dateOnly(a.publishedAt)}</span><span>{a.readingMinutes} min de leitura</span></div>
      </div>
    </Link>
  );
}

export function useArticles() {
  return useAsync(() => api.get<{ articles: ArticleSummary[]; categories: Array<{ category: string; total: number }> }>('/articles'), []);
}

export function LatestPosts({ n = 3 }: { n?: number }) {
  const { data, loading } = useArticles();
  if (loading) return <div className="post-grid"><Skeleton h={280} r={28} /><Skeleton h={280} r={28} /><Skeleton h={280} r={28} /></div>;
  const list = (data?.articles ?? []).slice(0, n);
  if (!list.length) return null;
  return <div className="post-grid">{list.map((a) => <PostCard key={a.id} a={a} />)}</div>;
}

export function BlogPage() {
  usePageTitle('Blog');
  const { data, error, loading, reload } = useArticles();
  const [cat, setCat] = useState('');
  const list = useMemo(() => (data?.articles ?? []).filter((a) => !cat || a.category === cat), [data, cat]);
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Blog</span><h1>Guias para comprar e vender com segurança</h1><p className="lead">Conteúdo prático sobre débitos, gravame, restrições, FIPE e o que checar antes de fechar negócio.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}>
        <div className="container stack-lg">
          {(data?.categories.length ?? 0) > 1 && (
            <div className="chips" role="group" aria-label="Categorias">
              <button type="button" className="chip" aria-pressed={!cat} onClick={() => setCat('')}>Todos</button>
              {data!.categories.map((c) => <button type="button" key={c.category} className="chip" aria-pressed={cat === c.category} onClick={() => setCat(c.category)}>{c.category}</button>)}
            </div>
          )}
          {loading && <div className="post-grid"><Skeleton h={280} r={28} /><Skeleton h={280} r={28} /><Skeleton h={280} r={28} /></div>}
          {error != null && <ErrorState error={error} onRetry={reload} />}
          {data && !list.length && <EmptyState icon="file-text" title="Nenhum artigo por aqui ainda">Volte em breve: novos guias são publicados com frequência.</EmptyState>}
          {list.length > 0 && <div className="post-grid">{list.map((a) => <PostCard key={a.id} a={a} />)}</div>}
        </div>
      </section>
    </>
  );
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.get<{ article: ArticleFull; related: ArticleSummary[] }>(`/articles/${encodeURIComponent(slug)}`), [slug]);
  usePageTitle(data?.article.seoTitle || data?.article.title || 'Blog');
  if (loading) return <PageLoading />;
  if (error != null || !data) return <section className="section"><div className="container"><ErrorState error={error ?? new Error('Artigo não encontrado')} onRetry={reload} /><p style={{ marginTop: 16 }}><Link to="/blog">Voltar ao blog</Link></p></div></section>;
  const a = data.article;
  return (
    <>
      <section className="section" style={{ paddingBottom: 24 }}>
        <div className="container">
          <article className="article">
            <Link to="/blog" className="muted" style={{ fontSize: 14, fontWeight: 500 }}>← Todos os artigos</Link>
            <h1>{a.title}</h1>
            <p className="lead">{a.excerpt}</p>
            <div className="post-meta"><span className="cat-tag">{a.category}</span><span>{a.author}</span><span>{dateOnly(a.publishedAt)}</span><span>{a.readingMinutes} min de leitura</span></div>
            {a.coverImageUrl && <div className="post-cover" style={{ borderRadius: 24, marginBottom: 26 }}><img src={a.coverImageUrl} alt="" decoding="async" /></div>}
            <Markdown source={a.body} />
            <aside className="article-cta">
              <h3>Confira a placa antes de decidir</h3>
              <p>Veja débitos, restrições e gravame em um relatório claro, com PDF para guardar.</p>
              <div><LinkButton to="/consultar" variant="primary" iconRight="arrow-right">Consultar uma placa</LinkButton></div>
            </aside>
          </article>
        </div>
      </section>
      {data.related.length > 0 && (
        <section className="section alt"><div className="container"><div className="section-head"><h2>Leia também</h2></div><div className="post-grid">{data.related.map((r) => <PostCard key={r.id} a={r} />)}</div></div></section>
      )}
    </>
  );
}
