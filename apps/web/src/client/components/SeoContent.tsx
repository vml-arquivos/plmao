import { useEffect, useState } from 'react';
import { api } from '../api';

export interface SeoBlock { sections: Array<{ h: string; p: string }>; faq: Array<{ q: string; a: string }> }
const cache = new Map<string, SeoBlock>();

/** Textos e perguntas da página, editados no painel (SEO). É o mesmo conteúdo que o Google recebe no HTML inicial. */
export function useSeoContent(path: string): SeoBlock | null {
  const [data, setData] = useState<SeoBlock | null>(cache.get(path) ?? null);
  useEffect(() => {
    let live = true;
    if (cache.has(path)) { setData(cache.get(path)!); return; }
    api.get<SeoBlock>('/seo/page', { query: { path } }).then((r) => { cache.set(path, r); if (live) setData(r); }).catch(() => undefined);
    return () => { live = false; };
  }, [path]);
  return data;
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
