import { useEffect, useState, type HTMLAttributes } from 'react';
import { api } from '../api';
import { useFaqs } from './Faq';

export interface SeoBlock { h1?: string | null; title?: string | null; sections: Array<{ h: string; p: string }>; faq: Array<{ q: string; a: string }> }
const cache = new Map<string, SeoBlock>();

// O servidor já escreve o H1 configurado no HTML inicial (marcado com data-seo). Guardamos esse texto antes do React montar,
// para o primeiro desenho da página já sair com o H1 certo, sem piscar do texto antigo para o novo.
const here = () => (typeof location === 'undefined' ? '' : location.pathname.replace(/\/$/, '') || '/');
const titles: Record<string, string> = ((window as unknown as { __pnmSeoTitle?: Record<string, string> }).__pnmSeoTitle ??= {});
const first: { path: string; h1: string } | null = (() => {
  try {
    const el = document.querySelector('#root h1[data-seo]'); const t = el?.textContent?.trim();
    if (t && document.title) titles[here()] = document.title; // título que o servidor escreveu no HTML inicial
    return t ? { path: here(), h1: t } : null;
  } catch { return null; }
})();
// O servidor também entrega os textos do painel em <script id="seo-data"> (só valem para a rota marcada): a primeira pintura já sai completa.
try {
  const raw = document.getElementById('seo-data')?.textContent;
  const d = raw ? JSON.parse(raw) as { path?: string } & Partial<SeoBlock> : null;
  if (d && d.path === here()) cache.set(d.path, { h1: d.h1 ?? null, title: d.title ?? null, sections: d.sections ?? [], faq: d.faq ?? [] });
} catch { /* sem dados embutidos: o app pede à API como antes */ }
/** Guarda o resultado e aplica o título configurado quando a página aberta é esta. */
function remember(path: string, r: SeoBlock) {
  cache.set(path, r);
  if (r.title) { titles[path] = r.title; if (here() === path) document.title = r.title; }
}

/** Textos e perguntas da página, editados no painel (SEO). É o mesmo conteúdo que o Google recebe no HTML inicial. */
export function useSeoContent(path: string): SeoBlock | null {
  const [data, setData] = useState<SeoBlock | null>(cache.get(path) ?? null);
  useEffect(() => {
    let live = true;
    if (cache.has(path)) { setData(cache.get(path)!); return; }
    api.get<SeoBlock>('/seo/page', { query: { path } }).then((r) => { remember(path, r); if (live) setData(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [path]);
  return data;
}

/** H1 da página, configurado no painel (SEO). Enquanto não chega, mostra o texto padrão da própria página. */
export function useSeoH1(path: string, fallback: string): string {
  const [, bump] = useState(0);
  useEffect(() => {
    if (cache.has(path)) return;
    let live = true;
    api.get<SeoBlock>('/seo/page', { query: { path } }).then((r) => { remember(path, r); if (live) bump((n) => n + 1); }).catch(() => undefined);
    return () => { live = false; };
  }, [path]);
  return cache.get(path)?.h1 || (first && first.path === path ? first.h1 : '') || fallback;
}

/** <h1> com o texto configurado no painel de SEO; sem configuração, usa o texto padrão da página. */
export function SeoH1({ path, fallback, ...rest }: { path: string; fallback: string } & HTMLAttributes<HTMLHeadingElement>) {
  return <h1 {...rest}>{useSeoH1(path, fallback)}</h1>;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Blocos e perguntas cadastrados no painel (SEO), mostrados na página como conteúdo visível.
 * Regra de composição: os blocos aparecem sempre; as perguntas do painel aparecem junto das que a própria página já mostra
 * (`exclude`), sem repetir a mesma pergunta. Nada é escondido: o que o Google lê no schema é o que a pessoa vê.
 */
export default function SeoContent({ path, faqTitle = 'Perguntas frequentes', exclude, holdFaq = false }: { path: string; faqTitle?: string; exclude?: string[]; holdFaq?: boolean }) {
  const d = useSeoContent(path);
  if (!d) return null;
  const skip = new Set((exclude ?? []).map(norm));
  const faq = holdFaq ? [] : d.faq.filter((f) => !skip.has(norm(f.q)));
  if (!d.sections.length && !faq.length) return null;
  return (
    <section className="section alt seo-content">
      <div className="container" style={{ maxWidth: 820 }}>
        {d.sections.map((s) => <article key={s.h} className="seo-block"><h2>{s.h}</h2><p>{s.p}</p></article>)}
        {faq.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: d.sections.length ? 40 : 0 }}><h2>{faqTitle}</h2></div>
            <div className="faq" style={{ margin: 0 }}>{faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
          </>
        )}
      </div>
    </section>
  );
}

/** Para páginas que já mostram perguntas da central (`/faqs`): as do painel entram depois, sem repetir as que já estão na tela. */
export function SeoContentAfterFaqs({ path, limit, faqTitle = 'Mais perguntas' }: { path: string; limit?: number; faqTitle?: string }) {
  const { data, loading } = useFaqs();
  // enquanto a lista da central carrega, só os blocos aparecem; as perguntas esperam para não piscar e depois sumir por repetição
  return <SeoContent path={path} faqTitle={faqTitle} holdFaq={loading} exclude={(data ?? []).slice(0, limit).map((f) => f.question)} />;
}
