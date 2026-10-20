import { useMemo, useState } from 'react';
import { ErrorState, Input, Skeleton, useAsync } from '../../shared/ui';
import { api, type FaqItem } from '../api';

export function useFaqs() {
  return useAsync(() => api.get<{ faqs: FaqItem[] }>('/faqs').then((r) => r.faqs), []);
}

/** Perguntas e respostas editadas no painel. `limit` mostra só as primeiras (home); `searchable` ativa busca e agrupamento. */
export default function Faq({ limit, searchable = false }: { limit?: number; searchable?: boolean }) {
  const { data, error, loading, reload } = useFaqs();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const all = data ?? [];
    const term = q.trim().toLowerCase();
    const filtered = term ? all.filter((i) => `${i.question} ${i.answer}`.toLowerCase().includes(term)) : all;
    return limit ? filtered.slice(0, limit) : filtered;
  }, [data, q, limit]);
  if (loading) return <div className="faq"><Skeleton h={58} r={16} /><Skeleton h={58} r={16} /><Skeleton h={58} r={16} /></div>;
  if (error != null) return <ErrorState error={error} onRetry={reload} />;
  const groups = searchable ? [...new Set(items.map((i) => i.category))] : [''];
  return (
    <>
      {searchable && (
        <div className="faq-tools"><Input icon="search" aria-label="Buscar nas perguntas" placeholder="Buscar uma dúvida…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      )}
      <div className="faq">
        {!items.length && <p className="muted" style={{ textAlign: 'center' }}>Nenhuma pergunta encontrada. Fale com a gente pelo contato.</p>}
        {groups.map((g) => (
          <div key={g || 'all'} style={{ display: 'grid', gap: 10 }}>
            {g && <h4>{g}</h4>}
            {items.filter((i) => !g || i.category === g).map((i) => <details key={i.id}><summary>{i.question}</summary><p>{i.answer}</p></details>)}
          </div>
        ))}
      </div>
    </>
  );
}
