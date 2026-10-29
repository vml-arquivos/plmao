import { useEffect, useState, type HTMLAttributes } from 'react';
import { api } from '../api';

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

export default function SeoContent({ path, faqTitle = 'Perguntas frequentes' }: { path: string; faqTitle?: string }) {
  const d = useSeoContent(path);
  if (!d || (!d.sections.length && !d.faq.length)) return null;
  return (
    <section className="section alt seo-content">
      <div className="container" style={{ maxWidth: 820 }}>
        {d.sections.map((s) => <article key={s.h} className="seo-block"><h2>{s.h}</h2><p>{s.p}</p></article>)}
        {d.faq.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: d.sections.length ? 40 : 0 }}><h2>{faqTitle}</h2></div>
            <div className="faq" style={{ margin: 0 }}>{d.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
          </>
        )}
      </div>
    </section>
  );
}
