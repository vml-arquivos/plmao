import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Badge, ErrorState, LinkButton, Skeleton, Tabs, useAsync } from '../../shared/ui';
import { money } from '../../shared/format';
import { api, type Catalog, type CatalogPackage, type CatalogProduct } from '../api';
import { useSession } from '../session';

export function useCatalog() {
  return useAsync(() => api.get<Catalog>('/catalog'), []);
}

function productTarget(authed: boolean, id: string) {
  const dest = `/app/consultar?produto=${encodeURIComponent(id)}`;
  return authed ? dest : `/criar-conta?next=${encodeURIComponent(dest)}`;
}
function packageTarget(authed: boolean, slug: string) {
  const dest = `/app/carteira?pacote=${encodeURIComponent(slug)}`;
  return authed ? dest : `/criar-conta?next=${encodeURIComponent(dest)}`;
}

function ProductPlan({ p, authed }: { p: CatalogProduct; authed: boolean }) {
  const soon = p.commercialStatus !== 'ACTIVE' && !p.isFree;
  return (
    <div className={`plan ${p.featured ? 'featured' : ''} ${soon ? 'soon' : ''}`}>
      {p.featured && <span className="ribbon"><Badge tone="violet"><Icon name="star" size={12} /> Mais completa</Badge></span>}
      <h4>{p.name}</h4>
      <div className="price">{p.isFree ? 'Grátis' : money(p.priceCents)}<small>por consulta</small></div>
      <p className="desc">{p.description}</p>
      {!!p.features?.length && <ul>{p.features.slice(0, 5).map((f) => <li key={f}><Icon name="check" size={16} /> {f}</li>)}</ul>}
      {soon ? <span className="btn btn-block" aria-disabled="true">Em breve</span> : <LinkButton to={productTarget(authed, p.id)} variant={p.featured ? 'primary' : 'default'} block>Contratar</LinkButton>}
    </div>
  );
}

function PackagePlan({ p, authed, best }: { p: CatalogPackage; authed: boolean; best: boolean }) {
  return (
    <div className={`plan ${best ? 'featured' : ''}`}>
      {best && <span className="ribbon"><Badge tone="violet"><Icon name="star" size={12} /> Melhor custo</Badge></span>}
      <h4>{p.name}</h4>
      <div className="price">{money(p.priceCents)}</div>
      <p className="desc">{p.description}</p>
      <ul>
        <li><Icon name="check" size={16} /> {money(p.credits * 100)} em saldo para consultas</li>
        {p.bonusCents > 0 && <li><Icon name="check" size={16} /> Bônus de {money(p.bonusCents)}</li>}
        <li><Icon name="check" size={16} /> Use em qualquer consulta, sem validade curta</li>
      </ul>
      <LinkButton to={packageTarget(authed, p.slug)} variant={best ? 'primary' : 'default'} block>Contratar</LinkButton>
    </div>
  );
}

/** Seção "Planos e consultas" (landing e /planos). Dados reais de /api/catalog. */
export default function Pricing({ id = 'planos' }: { id?: string }) {
  const { status } = useSession();
  const authed = status === 'authed';
  const { data, error, loading, reload } = useCatalog();
  const [tab, setTab] = useState<'single' | 'packs'>('single');
  const packs = data?.packages ?? [];
  const best = packs.length ? packs.reduce((a, b) => (b.bonusCents / b.priceCents > a.bonusCents / a.priceCents ? b : a)).slug : '';
  return (
    <div className="plans-wrap" id={id}>
      <div className="plans-intro">
        <div>
          <span className="eyebrow" style={{ color: '#C4B5FD' }}>Planos e consultas</span>
          <h3 style={{ marginTop: 10 }}>Evite surpresas. Faça uma consulta completa.</h3>
          <p style={{ marginTop: 10 }}>Antes de comprar, vender ou financiar, consulte o histórico e tenha mais segurança na sua decisão.</p>
        </div>
        <LinkButton to="/consultar" variant="outline-light" iconRight="arrow-right">Consultar uma placa</LinkButton>
      </div>
      <div className="stack">
        <div className="row-between"><h3 style={{ fontSize: 20 }}>Escolha como pagar</h3><Tabs label="Tipo de compra" value={tab} onChange={setTab} items={[{ id: 'single', label: 'Consulta avulsa' }, { id: 'packs', label: 'Pacotes de saldo' }]} /></div>
        {loading && <div className="plan-grid"><Skeleton h={260} r={18} /><Skeleton h={260} r={18} /><Skeleton h={260} r={18} /></div>}
        {error != null && <ErrorState error={error} onRetry={reload} />}
        {data && tab === 'single' && (data.products.length ? <div className="plan-grid">{data.products.filter((p) => !p.isFree).map((p) => <ProductPlan key={p.id} p={p} authed={authed} />)}</div> : <p className="muted">Nenhuma consulta disponível no momento.</p>)}
        {data && tab === 'packs' && (packs.length ? <div className="plan-grid">{packs.map((p) => <PackagePlan key={p.slug} p={p} authed={authed} best={p.slug === best} />)}</div> : <p className="muted">Pacotes indisponíveis no momento.</p>)}
        <p className="muted" style={{ fontSize: 13 }}>Preço final exibido antes do pagamento. Pix e cartão conforme a disponibilidade do checkout. <Link to="/termos">Termos de Uso</Link>.</p>
      </div>
    </div>
  );
}
