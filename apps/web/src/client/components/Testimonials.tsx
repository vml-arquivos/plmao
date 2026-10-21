import { useEffect, useState } from 'react';
import { api } from '../api';

interface Item { id: string; name: string; text: string; rating: number | null }

/** Só mostra depoimentos publicados e autorizados; sem nenhum, a seção inteira some. */
export default function Testimonials() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { let on = true; api.get<{ items: Item[] }>('/testimonials').then((r) => { if (on) setItems(r.items); }).catch(() => { /* seção opcional */ }); return () => { on = false; }; }, []);
  if (!items.length) return null;
  return (
    <section className="section alt" id="depoimentos" aria-labelledby="depoimentos-title">
      <div className="container">
        <div className="section-head center"><span className="eyebrow">Depoimentos</span><h2 id="depoimentos-title">O que dizem os clientes.</h2></div>
        <div className="testimonial-grid">
          {items.map((t) => (
            <figure className="testimonial" key={t.id}>
              {t.rating ? <div className="testimonial-stars" role="img" aria-label={`Nota ${t.rating} de 5`}>{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</div> : null}
              <blockquote>{t.text}</blockquote>
              <figcaption>{t.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
