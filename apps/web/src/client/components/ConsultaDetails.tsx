import { Fragment, useState, type ReactNode } from 'react';
import { Icon } from '../../shared/icons';
import { Modal, Skeleton, Tabs, useAsync } from '../../shared/ui';
import { api } from '../api';
import { useSession } from '../session';
import { productTarget, useCatalog } from './Catalog';
import { Link } from 'react-router-dom';

interface DetailSection { key: string; label: string; items: string[] }
interface DetailProduct { id: string; name: string; sections: DetailSection[] }

export const pdfModelUrl = (id: string) => `/api/catalog/${encodeURIComponent(id)}/modelo.pdf`;

/** Link para abrir o modelo do PDF (dados fictícios) da consulta. */
export function PdfModelLink({ id, children = 'Ver modelo do PDF', className = 'btn btn-sm' }: { id: string; children?: ReactNode; className?: string }) {
  return <a className={className} href={pdfModelUrl(id)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="file-text" size={15} /> {children}</a>;
}

function Compare({ products }: { products: DetailProduct[] }) {
  // união de seções e itens, na ordem em que aparecem
  const sections: Array<{ key: string; label: string; items: string[] }> = [];
  for (const p of products) for (const s of p.sections) {
    let hit = sections.find((x) => x.key === s.key);
    if (!hit) { hit = { key: s.key, label: s.label, items: [] }; sections.push(hit); }
    for (const it of s.items) if (!hit.items.includes(it)) hit.items.push(it);
  }
  const has = (p: DetailProduct, key: string, item: string) => p.sections.find((s) => s.key === key)?.items.includes(item) ?? false;
  return (
    <div className="matrix-wrap" role="region" aria-label="Comparativo item a item" tabIndex={0} style={{ maxHeight: '58vh' }}>
      <table className="matrix cmp">
        <thead><tr><th scope="col">Informação</th>{products.map((p) => <th scope="col" key={p.id}>{p.name.replace('Consulta ', '')}</th>)}</tr></thead>
        <tbody>
          {sections.map((s) => {
            const common = s.items.filter((it) => products.every((p) => has(p, s.key, it)));
            const diff = s.items.filter((it) => !common.includes(it));
            return (
              <Fragment key={s.key}>
                <tr className="grp"><th colSpan={products.length + 1} scope="colgroup">{s.label}</th></tr>
                {common.length > 0 && <tr className="common"><td colSpan={products.length + 1}><b>Em todas:</b> {common.join(', ')}</td></tr>}
                {diff.map((it) => (
                  <tr key={s.key + it}>
                    <th scope="row">{it}</th>
                    {products.map((p) => <td key={p.id}>{has(p, s.key, it) ? <span className="cell yes" role="img" aria-label="Incluso"><Icon name="check" size={15} /></span> : <span className="cell no" role="img" aria-label="Não incluso">—</span>}</td>)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function One({ p }: { p: DetailProduct }) {
  return (
    <div className="stack">
      {p.sections.map((s) => (
        <section key={s.key} className="det-sec">
          <h3>{s.label}</h3>
          <ul className="det-items">{s.items.map((i) => <li key={i}><Icon name="check" size={14} />{i}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

export function DetailsModal({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const { status } = useSession();
  const details = useAsync(() => api.get<{ products: DetailProduct[] }>('/catalog/details'), []);
  const catalog = useCatalog();
  const products = (details.data?.products ?? []).filter((p) => p.sections.length > 0);
  const [tab, setTab] = useState<string>(initial ?? 'ALL');
  const current = products.find((p) => p.id === tab);
  const active = current && catalog.data?.products.find((c) => c.id === current.id)?.commercialStatus === 'ACTIVE';
  return (
    <Modal wide title="O que vem em cada consulta" onClose={onClose}
      footer={current ? (
        <>
          <PdfModelLink id={current.id} className="btn">Ver modelo do PDF</PdfModelLink>
          {active ? <Link className="btn btn-primary" to={productTarget(status === 'authed', current.id)}>Contratar esta consulta</Link> : <span className="muted">Em breve</span>}
        </>
      ) : undefined}>
      {details.loading && <Skeleton h={240} r={12} />}
      {details.error != null && <p className="muted">Não foi possível carregar os detalhes agora. Tente de novo em instantes.</p>}
      {products.length > 0 && (
        <div className="stack">
          <Tabs label="Consulta" value={tab} onChange={setTab} items={[{ id: 'ALL', label: 'Comparar' }, ...products.map((p) => ({ id: p.id, label: p.name.replace('Consulta ', '') }))]} />
          {tab === 'ALL' ? <Compare products={products} /> : current ? <One p={current} /> : null}
          <p className="muted" style={{ fontSize: 13 }}>O modelo do PDF usa dados fictícios, só para mostrar o formato e as informações de cada consulta. O que a fonte não retornar para uma placa é omitido do relatório.</p>
        </div>
      )}
    </Modal>
  );
}

/** Botão que abre o detalhamento (comparativo item a item). */
export function DetailsButton({ initial, children = 'Detalhar consultas', className = 'btn', icon = true }: { initial?: string; children?: ReactNode; className?: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>{icon && <Icon name="list" size={15} />} {children}</button>
      {open && <DetailsModal initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}
