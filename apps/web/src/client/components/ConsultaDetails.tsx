import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../../shared/icons';
import { Modal, Skeleton, Tabs, useAsync } from '../../shared/ui';
import { money } from '../../shared/format';
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

const SECTION_ICON: Record<string, IconName> = { IDENTIFICACAO: 'car', CARACTERISTICAS: 'list', REGISTRO: 'file-text', DEBITOS: 'dollar', RESTRICOES: 'shield-alert', HISTORICO: 'clock', GRAVAME: 'credit-card', INSPECAO_RECALL: 'wrench', FIPE: 'bar-chart', ANALISES: 'sparkles' };

/** Comparativo por seção: o que cada consulta cobre, sem uma tabela de 100 linhas. */
function Compare({ products, onPick }: { products: DetailProduct[]; onPick: (id: string) => void }) {
  const sections: Array<{ key: string; label: string }> = [];
  for (const p of products) for (const s of p.sections) if (!sections.some((x) => x.key === s.key)) sections.push({ key: s.key, label: s.label });
  return (
    <div className="matrix-wrap" role="region" aria-label="Comparativo por seção" tabIndex={0}>
      <table className="matrix cmp">
        <thead><tr><th scope="col">O que você recebe</th>{products.map((p) => <th scope="col" key={p.id}><button type="button" className="linkbtn" onClick={() => onPick(p.id)}>{p.name.replace('Consulta ', '')}</button></th>)}</tr></thead>
        <tbody>
          {sections.map((s) => (
            <tr key={s.key}>
              <th scope="row"><span className="cmp-ico"><Icon name={SECTION_ICON[s.key] ?? 'check'} size={16} /></span>{s.label}</th>
              {products.map((p) => {
                const n = p.sections.find((x) => x.key === s.key)?.items.length ?? 0;
                return <td key={p.id}>{n > 0 ? <span className="cell yes" title={`${n} informações`} role="img" aria-label={`Incluso, ${n} informações`}><Icon name="check" size={15} /></span> : <span className="cell no" role="img" aria-label="Não incluso">—</span>}{n > 0 && <small className="cmp-n">{n} itens</small>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function One({ p }: { p: DetailProduct }) {
  return (
    <div className="det-grid">
      {p.sections.map((s) => (
        <section key={s.key} className="det-card">
          <header><span className="det-ico"><Icon name={SECTION_ICON[s.key] ?? 'check'} size={18} /></span><h3>{s.label}</h3><span className="det-n">{s.items.length}</span></header>
          <ul className="det-chips">{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

function ProductHead({ id }: { id: string }) {
  const { data } = useCatalog();
  const c = data?.products.find((x) => x.id === id);
  if (!c) return null;
  return (
    <div className="det-head">
      <div><h3>{c.name}</h3><p>{c.longDescription || c.description}</p></div>
      <div className="det-price"><b className="num">{money(c.priceCents)}</b><small>por consulta</small></div>
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
          {tab === 'ALL' ? <Compare products={products} onPick={setTab} /> : current ? <><ProductHead id={current.id} /><One p={current} /></> : null}
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
      {open && createPortal(<DetailsModal initial={initial} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
