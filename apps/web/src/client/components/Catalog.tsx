import { useMemo, useState } from 'react';
import { Icon } from '../../shared/icons';
import { ErrorState, LinkButton, Skeleton, useAsync } from '../../shared/ui';
import { money } from '../../shared/format';
import { api, type Catalog, type CatalogFeature, type CatalogPackage, type CatalogProduct } from '../api';
import { useSession } from '../session';

export function useCatalog() {
  return useAsync(() => api.get<Catalog>('/catalog'), []);
}

export const productTarget = (authed: boolean, id: string) => {
  const dest = `/app/consultar?produto=${encodeURIComponent(id)}`;
  return authed ? dest : `/criar-conta?next=${encodeURIComponent(dest)}`;
};
export const packageTarget = (authed: boolean, slug: string) => {
  const dest = `/app/carteira?pacote=${encodeURIComponent(slug)}`;
  return authed ? dest : `/criar-conta?next=${encodeURIComponent(dest)}`;
};

const isActive = (p: CatalogProduct) => p.commercialStatus === 'ACTIVE';
const sellable = (p: CatalogProduct) => !p.isFree;

function CatalogState({ loading, error, reload }: { loading: boolean; error: unknown; reload: () => void }) {
  if (loading) return <div className="prod-grid"><Skeleton h={340} r={28} /><Skeleton h={340} r={28} /><Skeleton h={340} r={28} /></div>;
  if (error != null) return <ErrorState error={error} onRetry={reload} />;
  return null;
}

/* ---------- Cards de produto ---------- */
function ProductCard({ p, features, authed }: { p: CatalogProduct; features: CatalogFeature[]; authed: boolean }) {
  const soon = !isActive(p);
  const rows = features.length && Object.keys(p.matrix ?? {}).length
    ? features.map((f) => ({ label: f.label, st: p.matrix[f.id] ?? 'NOT_INCLUDED' })).filter((r) => r.st !== 'NOT_INCLUDED')
    : (p.features ?? []).map((label) => ({ label, st: 'INCLUDED' as const }));
  return (
    <article className={`pcard ${p.featured ? 'featured' : ''} ${soon ? 'soon' : ''}`}>
      {p.badge && <span className="pbadge">{p.badge}</span>}
      <h3>{p.name}</h3>
      <p className="tag">{p.tagline || p.description}</p>
      <div className="pprice">
        {p.listPriceCents && p.listPriceCents > p.priceCents ? <span className="was">de {money(p.listPriceCents)}</span> : null}
        <span className="now num">{money(p.priceCents)}<small>por consulta</small></span>
      </div>
      {p.discountPercent ? <span className="off">{p.discountPercent}% de desconto</span> : null}
      <ul>
        {rows.slice(0, 8).map((r) => (
          <li key={r.label} className={r.st === 'SOON' ? 'na' : ''}><Icon name={r.st === 'SOON' ? 'clock' : 'check'} size={16} />{r.label}{r.st === 'SOON' ? ' (em breve)' : ''}</li>
        ))}
      </ul>
      {p.coverage ? <span className="cov">{p.coverage}</span> : null}
      {soon ? <span className="btn btn-block" aria-disabled="true">Em breve</span> : <LinkButton to={productTarget(authed, p.id)} variant={p.featured ? 'primary' : 'default'} block>Contratar</LinkButton>}
    </article>
  );
}

export function ProductCards({ homeOnly = false }: { homeOnly?: boolean }) {
  const { status } = useSession();
  const { data, error, loading, reload } = useCatalog();
  const st = CatalogState({ loading, error, reload });
  if (st) return st;
  if (!data) return null;
  let list = data.products.filter(sellable).filter((p) => (homeOnly ? p.showOnHome : true));
  if (homeOnly) list = [...list].sort((a, b) => Number(!isActive(a)) - Number(!isActive(b))).slice(0, 4);
  if (!list.length) return <p className="muted">Nenhuma consulta disponível no momento.</p>;
  return <div className="prod-grid">{list.map((p) => <ProductCard key={p.id} p={p} features={data.features} authed={status === 'authed'} />)}</div>;
}

/* ---------- Matriz de comparação ---------- */
export function CompareMatrix() {
  const { status } = useSession();
  const { data, error, loading, reload } = useCatalog();
  if (loading || error != null) return <CatalogState loading={loading} error={error} reload={reload} />;
  if (!data) return null;
  const prods = data.products.filter(sellable);
  const feats = data.features.filter((f) => prods.some((p) => (p.matrix?.[f.id] ?? 'NOT_INCLUDED') !== 'NOT_INCLUDED'));
  if (!prods.length || !feats.length) return null;
  const authed = status === 'authed';
  return (
    <div className="matrix-wrap" role="region" aria-label="Comparativo entre consultas" tabIndex={0}>
      <table className="matrix">
        <thead>
          <tr><th scope="col">O que está incluso</th>{prods.map((p) => <th scope="col" key={p.id}>{p.name}<span className="mp num">{money(p.priceCents)}</span></th>)}</tr>
        </thead>
        <tbody>
          {feats.map((f) => (
            <tr key={f.id}>
              <th scope="row" style={{ fontWeight: 600 }}>{f.label}{f.description ? <small>{f.description}</small> : null}</th>
              {prods.map((p) => {
                const st = p.matrix?.[f.id] ?? 'NOT_INCLUDED';
                return <td key={p.id}>{st === 'INCLUDED' ? <span className="cell yes" role="img" aria-label="Incluso"><Icon name="check" size={15} /></span> : st === 'SOON' ? <span className="cell soon">em breve</span> : <span className="cell no" role="img" aria-label="Não incluso">—</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /> {prods.map((p) => <td key={p.id}>{isActive(p) ? <LinkButton to={productTarget(authed, p.id)} variant={p.featured ? 'primary' : 'default'} size="sm">Contratar</LinkButton> : <span className="muted">Em breve</span>}</td>)}</tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ---------- Comparador inteligente ---------- */
const PRESETS: Array<{ id: string; label: string; keys: string[] }> = [
  { id: 'comprar', label: 'Vou comprar um usado', keys: ['dados-veiculo', 'debitos', 'restricoes', 'gravame'] },
  { id: 'vender', label: 'Vou vender o meu', keys: ['dados-veiculo', 'debitos'] },
  { id: 'anuncio', label: 'Conferir um anúncio', keys: ['dados-veiculo', 'restricoes'] },
  { id: 'completa', label: 'Checagem completa', keys: ['dados-veiculo', 'registro', 'debitos', 'restricoes', 'gravame', 'recall-inspecao'] }
];

interface Plan { products: CatalogProduct[]; total: number }

/** Menor custo para cobrir todas as características escolhidas, testando todas as combinações de consultas ativas (poucas). */
export function cheapestCover(products: CatalogProduct[], need: string[]): { best: Plan | null; single: Plan | null } {
  const act = products.filter((p) => isActive(p) && sellable(p)).slice(0, 12);
  const covers = (p: CatalogProduct, fid: string) => (p.matrix?.[fid] ?? 'NOT_INCLUDED') === 'INCLUDED';
  let best: Plan | null = null;
  let single: Plan | null = null;
  for (let mask = 1; mask < 1 << act.length; mask++) {
    const set = act.filter((_, i) => mask & (1 << i));
    if (!need.every((fid) => set.some((p) => covers(p, fid)))) continue;
    const total = set.reduce((a, p) => a + p.priceCents, 0);
    const plan = { products: set, total };
    if (!best || total < best.total || (total === best.total && set.length < best.products.length)) best = plan;
    if (set.length === 1 && (!single || total < single.total)) single = plan;
  }
  return { best, single };
}

export function SmartPicker() {
  const { status } = useSession();
  const authed = status === 'authed';
  const { data, error, loading, reload } = useCatalog();
  const [sel, setSel] = useState<string[]>([]);
  const [preset, setPreset] = useState('');
  const feats = useMemo(() => (data?.features ?? []).filter((f) => (data?.products ?? []).some((p) => sellable(p) && isActive(p) && p.matrix?.[f.id] === 'INCLUDED')), [data]);
  const soonFeats = useMemo(() => (data?.features ?? []).filter((f) => !feats.includes(f) && (data?.products ?? []).some((p) => p.matrix?.[f.id] === 'SOON' || p.matrix?.[f.id] === 'INCLUDED')), [data, feats]);
  const result = useMemo(() => (data && sel.length ? cheapestCover(data.products, sel) : null), [data, sel]);
  if (loading || error != null) return <CatalogState loading={loading} error={error} reload={reload} />;
  if (!data || !feats.length) return null;
  const idByKey = new Map(data.features.map((f) => [f.key, f.id]));
  const applyPreset = (id: string, keys: string[]) => {
    setPreset(id);
    setSel(keys.map((k) => idByKey.get(k)).filter((x): x is string => !!x && feats.some((f) => f.id === x)));
  };
  const toggle = (fid: string) => { setPreset(''); setSel((s) => (s.includes(fid) ? s.filter((x) => x !== fid) : [...s, fid])); };
  const best = result?.best;
  const single = result?.single;
  const sum = best ? best.total : 0;
  const diff = best && single && single.total > best.total ? single.total - best.total : 0;
  return (
    <div className="picker" id="comparar">
      <div>
        <span className="eyebrow">Comparativo inteligente</span>
        <h3 style={{ marginTop: 6 }}>Diga o que você precisa checar. A gente mostra o caminho mais barato.</h3>
      </div>
      <div className="chips" role="group" aria-label="Situações comuns">
        {PRESETS.map((p) => <button type="button" key={p.id} className="chip preset" aria-pressed={preset === p.id} onClick={() => applyPreset(p.id, p.keys)}><Icon name="sparkles" size={15} />{p.label}</button>)}
      </div>
      <div className="chips" role="group" aria-label="O que você quer verificar">
        {feats.map((f) => <button type="button" key={f.id} className="chip" aria-pressed={sel.includes(f.id)} onClick={() => toggle(f.id)}>{sel.includes(f.id) ? <Icon name="check" size={15} /> : null}{f.label}</button>)}
        {soonFeats.map((f) => <button type="button" key={f.id} className="chip" disabled title="Em breve">{f.label} · em breve</button>)}
      </div>
      {!sel.length && <p className="picker-empty">Escolha uma situação ou marque o que deseja verificar.</p>}
      {sel.length > 0 && !best && <p className="picker-empty">Nenhuma consulta disponível cobre todos esses itens agora. Tente remover algum item.</p>}
      {best && (
        <div className="picker-result" aria-live="polite">
          <div className="rline">
            <div>
              <small className="muted">Melhor combinação para o que você marcou</small>
              <div className="big num">{money(sum)}</div>
            </div>
            <div className="picks">{best.products.map((p) => <span className="pick" key={p.id}>{p.name} · {money(p.priceCents)}</span>)}</div>
          </div>
          {diff > 0 && single && <p className="save">Economia de {money(diff)} em relação a contratar só “{single.products[0].name}” ({money(single.total)}).</p>}
          {!diff && single && best.products.length === 1 && <p className="muted" style={{ fontSize: 14 }}>Uma única consulta já cobre tudo o que você marcou.</p>}
          <div className="row">{best.products.map((p, i) => <LinkButton key={p.id} to={productTarget(authed, p.id)} variant={i === 0 ? 'primary' : 'default'} iconRight="arrow-right">Contratar {p.name}</LinkButton>)}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- Pacotes ---------- */
function PackCard({ p, best, authed }: { p: CatalogPackage; best: boolean; authed: boolean }) {
  const totalCents = p.credits * 100;
  return (
    <article className={`pack ${best ? 'best' : ''}`}>
      {(p.badge || best) && <span className="pbadge">{p.badge || 'Melhor custo'}</span>}
      <h3>{p.name}</h3>
      <p className="muted" style={{ fontSize: 14.5 }}>{p.tagline || p.description}</p>
      <div className="pp num">{money(p.priceCents)}</div>
      {p.bonusCents >= 100 ? <span className="bonus">+ {money(p.bonusCents)} de bônus</span> : null}
      <ul>
        <li><Icon name="check" size={16} />{money(totalCents)} em saldo para consultas</li>
        {(p.highlights ?? []).map((h) => <li key={h}><Icon name="check" size={16} />{h}</li>)}
        <li><Icon name="check" size={16} />Use em qualquer consulta, sem mensalidade</li>
      </ul>
      <LinkButton to={packageTarget(authed, p.slug)} variant={best ? 'primary' : 'default'} block>Comprar pacote</LinkButton>
    </article>
  );
}

export function PackageCards() {
  const { status } = useSession();
  const { data, error, loading, reload } = useCatalog();
  if (loading || error != null) return <CatalogState loading={loading} error={error} reload={reload} />;
  const packs = data?.packages ?? [];
  if (!packs.length) return <p className="muted">Pacotes indisponíveis no momento.</p>;
  const best = packs.reduce((a, b) => (b.bonusCents / b.priceCents > a.bonusCents / a.priceCents ? b : a)).slug;
  return <div className="pack-grid">{packs.map((p) => <PackCard key={p.slug} p={p} best={p.slug === best && packs.length > 1} authed={status === 'authed'} />)}</div>;
}
