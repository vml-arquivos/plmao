import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, LinkButton, Modal, PageLoading, PlateBadge, Select, Skeleton, Tabs, Textarea, useToast, usePageTitle } from '../../shared/ui';
import { api } from '../api';
import { ApiError, errorMessage } from '../../shared/api';
import { dateOnly, isValidPlate, normalizePlate } from '../../shared/format';
import { Markdown } from '../../shared/markdown';
import { useSession } from '../session';
import { GuideCover, ModelCard, RatingBars, StarPicker, Stars, formatSpec, ratingText, typeLabel, useSpecMeta, versionLabel, yearsLabel, type GuideCard, type GuideModel, type GuideTip, type PublicOpinion, type SpecMeta, type Specs } from '../guide';

/* ========================================================================== */
/*  /veiculos — busca                                                          */
/* ========================================================================== */
interface PlateResult { vehicle: { plate: string; brand: string | null; model: string | null; year: number | null; fuel: string | null }; matches: Array<{ slug: string; brand: string; name: string; versions: Array<{ id: string; name: string; yearModel: number | null; sameYear: boolean }> }> }

export function GuideHome() {
  usePageTitle('Guia de veículos');
  const { status } = useSession();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'model' | 'plate'>('model');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [brand, setBrand] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<'name' | 'rating'>('name');
  const [brands, setBrands] = useState<Array<{ brand: string; total: number }>>([]);
  const [items, setItems] = useState<GuideCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tips, setTips] = useState<GuideTip[]>([]);
  const [tipCat, setTipCat] = useState('');
  const PAGE = 12;

  useEffect(() => { api.get<{ brands: Array<{ brand: string; total: number }> }>('/vehicles/brands').then((r) => setBrands(r.brands), () => undefined); }, []);
  useEffect(() => { api.get<{ tips: GuideTip[] }>('/vehicles/tips', { query: { limit: 30 } }).then((r) => setTips(r.tips), () => undefined); }, []);
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (offset: number) => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ total: number; items: GuideCard[] }>('/vehicles', { query: { search: debounced, brand, type, sort, limit: PAGE, offset } });
      setTotal(r.total); setItems((prev) => (offset ? [...prev, ...r.items] : r.items));
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [debounced, brand, type, sort]);
  useEffect(() => { void load(0); }, [load]);

  const filtersOn = Boolean(debounced || brand || type);
  const tipList = tips.filter((t) => !tipCat || t.category === tipCat);
  const tipCats = useMemo(() => [...new Map(tips.map((t) => [t.category, t.categoryLabel])).entries()], [tips]);

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">Guia de veículos</span>
          <h1 style={{ maxWidth: '22ch' }}>Conheça o carro antes de comprar.</h1>
          <p className="lead">Ficha técnica, nota de quem tem o carro, dicas de cuidados e comparação lado a lado. Cadastro grátis para ver tudo.</p>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container stack-lg">
          <div className="card card-pad stack">
            <Tabs label="Forma de busca" value={mode} onChange={setMode} items={[{ id: 'model', label: 'Por modelo' }, { id: 'plate', label: 'Por placa' }]} />
            {mode === 'model' ? (
              <div className="guide-filters">
                <Input icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ex.: Tracker, Onix, CG 160…" aria-label="Buscar modelo" maxLength={80} />
                <Select value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Marca"><option value="">Todas as marcas</option>{brands.map((b) => <option key={b.brand} value={b.brand}>{b.brand} ({b.total})</option>)}</Select>
                <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo"><option value="">Carro, moto e caminhão</option><option value="CAR">Carros</option><option value="MOTORCYCLE">Motos</option><option value="TRUCK">Caminhões</option></Select>
                <Select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'rating')} aria-label="Ordenar"><option value="name">Ordem alfabética</option><option value="rating">Mais bem avaliados</option></Select>
              </div>
            ) : <PlateSearch authed={status === 'authed'} />}
          </div>

          {mode === 'model' && (
            <div className="stack">
              {!loading && !error && <p className="muted" aria-live="polite">{total ? `${total} ${total === 1 ? 'veículo' : 'veículos'}${filtersOn ? ' encontrados' : ' no guia'}` : ''}</p>}
              {error != null && <ErrorState error={error} onRetry={() => void load(0)} />}
              {loading && !items.length && <div className="guide-grid"><Skeleton h={300} r={24} /><Skeleton h={300} r={24} /><Skeleton h={300} r={24} /></div>}
              {!loading && !error && !items.length && (
                <EmptyState icon="car" title={filtersOn ? 'Nenhum veículo com esses filtros' : 'O guia está sendo montado'}>
                  {filtersOn ? 'Tente outro nome ou limpe os filtros.' : 'Em breve teremos as primeiras fichas por aqui. Enquanto isso, consulte o valor FIPE ou a situação de um veículo pela placa.'}
                </EmptyState>
              )}
              {items.length > 0 && <div className="guide-grid">{items.map((m) => <ModelCard key={m.slug} m={m} />)}</div>}
              {items.length < total && <div style={{ textAlign: 'center' }}><Button loading={loading} onClick={() => void load(items.length)}>Ver mais veículos</Button></div>}
            </div>
          )}

          {tipList.length > 0 && (
            <div className="stack" id="dicas">
              <div><span className="eyebrow">Dicas e cuidados</span><h2 style={{ marginTop: 6 }}>Cuide bem do seu veículo</h2></div>
              {tipCats.length > 1 && (
                <div className="chips" role="group" aria-label="Categorias de dicas">
                  <button type="button" className="chip" aria-pressed={!tipCat} onClick={() => setTipCat('')}>Todas</button>
                  {tipCats.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={tipCat === k} onClick={() => setTipCat(k)}>{l}</button>)}
                </div>
              )}
              <div className="tip-grid">{tipList.map((t) => <TipCard key={t.id} tip={t} />)}</div>
            </div>
          )}

          <div className="card card-pad guide-cta">
            <div><h3>Vai comprar um usado?</h3><p className="muted">A ficha mostra como o modelo é. A consulta pela placa mostra como aquele carro específico está: débitos, restrições, leilão e mais.</p></div>
            <div className="row"><LinkButton to="/consultar" variant="primary" iconRight="arrow-right">Consultar uma placa</LinkButton><LinkButton to="/fipe">Ver valor FIPE</LinkButton></div>
          </div>
        </div>
      </section>
    </>
  );
}

export function TipCard({ tip }: { tip: GuideTip }) {
  return (
    <details className="tip-card">
      <summary><span className="cat-tag">{tip.categoryLabel}</span><b>{tip.title}</b></summary>
      <div className="tip-body"><Markdown source={tip.body} /></div>
    </details>
  );
}

function PlateSearch({ authed }: { authed: boolean }) {
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<PlateResult | null>(null);
  async function go() {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await api.post<PlateResult>('/vehicles/by-plate', { plate })); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  if (!authed) {
    return (
      <Alert tone="info" icon="lock" title="A busca por placa é para quem tem conta.">
        <p style={{ margin: '4px 0 10px' }}>Crie sua conta grátis para descobrir o modelo pela placa e abrir a ficha técnica completa.</p>
        <div className="row"><LinkButton to="/criar-conta?next=/veiculos" variant="primary" size="sm">Criar conta grátis</LinkButton><LinkButton to="/entrar?next=/veiculos" size="sm">Já tenho conta</LinkButton></div>
      </Alert>
    );
  }
  return (
    <div className="stack">
      <div className="plate-input-wrap"><div className="plate-input"><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" aria-label="Placa" maxLength={8} autoComplete="off" autoCapitalize="characters" /></div></div>
      <div><Button variant="primary" size="lg" icon="search" disabled={!isValidPlate(plate)} loading={busy} onClick={() => void go()}>Achar a ficha do veículo</Button></div>
      {err && <Alert tone="danger">{err}</Alert>}
      {res && (
        <div className="stack" aria-live="polite">
          <div className="row"><PlateBadge plate={res.vehicle.plate} /><div><b>{res.vehicle.model ?? res.vehicle.brand ?? 'Veículo identificado'}</b><div className="muted" style={{ fontSize: 13.5 }}>{[res.vehicle.brand, res.vehicle.year, res.vehicle.fuel].filter(Boolean).join(' · ')}</div></div></div>
          {res.matches.length ? (
            <div className="stack-sm">{res.matches.map((m) => (
              <div key={m.slug} className="plate-match">
                <Link to={`/veiculos/${m.slug}`}><b>{m.brand} {m.name}</b> <Icon name="arrow-right" size={16} /></Link>
                {m.versions.length > 0 && <div className="chips">{m.versions.slice(0, 6).map((v) => <Link key={v.id} className="chip" to={`/veiculos/${m.slug}?versao=${v.id}`}>{versionLabel(v)}{v.sameYear && <Badge tone="ok">mesmo ano</Badge>}</Link>)}</div>}
              </div>
            ))}</div>
          ) : <Alert tone="info">Ainda não temos a ficha deste modelo no guia. Você pode ver o <Link to={`/fipe?placa=${res.vehicle.plate}`}>valor na Tabela FIPE</Link> ou <Link to={`/consultar?placa=${res.vehicle.plate}`}>consultar a situação do veículo</Link>.</Alert>}
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  /veiculos/:slug — ficha                                                    */
/* ========================================================================== */
export function GuideModelPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const { status } = useSession();
  const meta = useSpecMeta();
  const [model, setModel] = useState<GuideModel | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [versionId, setVersionId] = useState('');
  const [editing, setEditing] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setModel(await api.get<GuideModel>(`/vehicles/${encodeURIComponent(slug)}`)); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [slug]);
  // recarrega quando o login muda: o conteúdo completo depende da conta
  useEffect(() => { if (status !== 'loading') void reload(); }, [reload, status]);
  usePageTitle(model ? `${model.brand} ${model.name}` : 'Guia de veículos');
  useEffect(() => {
    if (!model) return;
    const wanted = params.get('versao');
    setVersionId((cur) => (model.versions.some((v) => v.id === cur) ? cur : model.versions.some((v) => v.id === wanted) ? wanted! : model.versions[0]?.id ?? ''));
  }, [model, params]);

  if (loading && !model) return <PageLoading />;
  if (error instanceof ApiError && error.status === 404) return <section className="section"><div className="container"><EmptyState icon="car" title="Veículo não encontrado" action={<LinkButton to="/veiculos" variant="primary">Voltar ao guia</LinkButton>}>Este veículo não está no guia ou foi retirado.</EmptyState></div></section>;
  if (error != null || !model) return <section className="section"><div className="container"><ErrorState error={error} onRetry={() => void reload()} /></div></section>;

  const version = model.versions.find((v) => v.id === versionId) ?? model.versions[0];
  const next = `/veiculos/${model.slug}`;
  const authed = !model.locked;
  return (
    <>
      <section className="page-hero guide-hero">
        <div className="container">
          <Link to="/veiculos" className="back-link"><Icon name="arrow-left" size={16} /> Guia de veículos</Link>
          <div className="guide-head">
            <GuideCover imageUrl={model.imageUrl} alt={`${model.brand} ${model.name}`} type={model.vehicleType} />
            <div className="stack-sm">
              <span className="cat-tag">{model.brand}</span>
              <h1 style={{ maxWidth: 'none' }}>{model.name}</h1>
              <p className="muted">{[typeLabel(model.vehicleType), model.bodyType, yearsLabel(model.yearFrom, model.yearTo)].filter(Boolean).join(' · ')}</p>
              <div className="guide-rate big"><Stars value={model.rating.average} size={22} /><b>{ratingText(model.rating.average)}</b><span className="muted">{model.rating.count ? `${model.rating.count} ${model.rating.count === 1 ? 'opinião de dono' : 'opiniões de donos'}` : 'Ainda sem opiniões'}</span></div>
              {model.summary && <p className="lead" style={{ margin: 0 }}>{model.summary}</p>}
              <div className="row">
                {authed ? <>
                  <LinkButton to={`/comparar${version ? `?ids=${version.id}` : ''}`} variant="primary" icon="bar-chart">Comparar com outro</LinkButton>
                  <Button icon="star" onClick={() => setEditing(true)}>{model.myOpinion ? 'Editar minha opinião' : 'Deixe sua opinião'}</Button>
                  <LinkButton to={`/simulador/${simSlug(model)}`} icon="calculator">Simular financiamento</LinkButton>
                </> : <>
                  <LinkButton to={`/criar-conta?next=${encodeURIComponent(next)}`} variant="primary" icon="lock">Criar conta grátis e ver tudo</LinkButton>
                  <LinkButton to={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</LinkButton>
                  <LinkButton to={`/simulador/${simSlug(model)}`} icon="calculator">Simular financiamento</LinkButton>
                </>}
                <LinkButton to="/fipe" icon="dollar">Valor na FIPE</LinkButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container guide-layout">
          <div className="stack-lg">
            {model.versions.length > 0 && (
              <div className="card card-pad stack">
                <div className="between">
                  <h2 style={{ fontSize: 22 }}>Ficha técnica</h2>
                  {model.versions.length > 1 && <Select value={version?.id} onChange={(e) => setVersionId(e.target.value)} aria-label="Versão" style={{ maxWidth: 320 }}>{model.versions.map((v) => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}</Select>}
                </div>
                {version && <p className="muted" style={{ margin: 0 }}>{[version.name, version.yearModel, version.fuel].filter(Boolean).join(' · ')}</p>}
                {authed && version?.specs && meta ? <SpecSheet meta={meta} specs={version.specs} /> : (
                  <>
                    {version && meta && <div className="chips">{meta.fields.filter((f) => f.highlight && version.highlights[f.key] !== undefined).map((f) => <span key={f.key} className="chip static"><b>{f.label}:</b> {formatSpec(f, version.highlights[f.key])}</span>)}</div>}
                    <LockCard what="a ficha técnica completa" next={next} />
                  </>
                )}
                {model.specSource && <p className="muted spec-source">Fonte: {model.specSource}</p>}
              </div>
            )}

            {(model.pros.length > 0 || model.cons.length > 0) && (
              <div className="grid-2">
                {model.pros.length > 0 && <div className="card card-pad stack-sm pros"><h3><Icon name="check-circle" size={20} /> Pontos fortes</h3><ul>{model.pros.map((p) => <li key={p}>{p}</li>)}</ul></div>}
                {model.cons.length > 0 && <div className="card card-pad stack-sm cons"><h3><Icon name="alert-triangle" size={20} /> Pontos de atenção</h3><ul>{model.cons.map((p) => <li key={p}>{p}</li>)}</ul></div>}
              </div>
            )}

            <div className="card card-pad stack">
              <h2 style={{ fontSize: 22 }}>Review</h2>
              {authed ? (model.review ? <Markdown source={model.review} /> : <p className="muted">A equipe ainda está escrevendo o review deste modelo.</p>) : (
                <>
                  {model.reviewPreview ? <p className="prose">{model.reviewPreview}</p> : null}
                  <LockCard what="o review completo" next={next} />
                </>
              )}
            </div>

            {authed && model.buyerTips && (
              <div className="card card-pad stack"><h2 style={{ fontSize: 22 }}>O que olhar antes de comprar</h2><Markdown source={model.buyerTips} /></div>
            )}
            {authed && (model.tips?.length ?? 0) > 0 && (
              <div className="stack"><h2 style={{ fontSize: 22 }}>Dicas e cuidados para o {model.name}</h2><div className="tip-grid">{model.tips!.map((t) => <TipCard key={t.id} tip={t} />)}</div></div>
            )}

            <Opinions model={model} authed={authed} next={next} onWrite={() => setEditing(true)} />
          </div>

          <aside className="stack guide-side">
            <div className="card card-pad stack">
              <h3>Nota dos donos</h3>
              <div className="guide-rate big"><b style={{ fontSize: 34 }}>{ratingText(model.rating.average)}</b><div><Stars value={model.rating.average} size={20} /><div className="muted" style={{ fontSize: 13 }}>{model.rating.count} {model.rating.count === 1 ? 'opinião' : 'opiniões'}</div></div></div>
              {meta && model.rating.count > 0 && <RatingBars rating={model.rating} categories={meta.ratingCategories} />}
              {model.rating.count > 0 && <Distribution rating={model.rating} />}
              {!model.rating.count && <p className="muted" style={{ fontSize: 14 }}>Ainda não há opiniões aprovadas. Tem ou já teve este veículo? Conte como é.</p>}
            </div>
            <div className="card card-pad stack-sm">
              <h3>Vai comprar este veículo?</h3>
              <p className="muted" style={{ fontSize: 14 }}>A ficha mostra como o modelo é. Para saber como o carro anunciado está, consulte a placa dele.</p>
              <LinkButton to="/consultar" variant="primary" iconRight="arrow-right">Consultar situação por placa</LinkButton>
            </div>
          </aside>
        </div>
      </section>
      {editing && <OpinionModal model={model} onClose={(changed) => { setEditing(false); if (changed) void reload(); }} />}
    </>
  );
}

function LockCard({ what, next }: { what: string; next: string }) {
  return (
    <div className="lock-card">
      <Icon name="lock" size={22} />
      <div><b>Entre grátis para ver {what}.</b><p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>Ficha técnica completa, opiniões dos donos e comparador, sem custo.</p></div>
      <div className="row"><LinkButton to={`/criar-conta?next=${encodeURIComponent(next)}`} variant="primary" size="sm">Criar conta grátis</LinkButton><LinkButton to={`/entrar?next=${encodeURIComponent(next)}`} size="sm">Entrar</LinkButton></div>
    </div>
  );
}

/** Tipo do simulador que combina com o modelo (picape/van/utilitário caem em "utilitário"). */
function simSlug(m: { vehicleType: string; bodyType: string | null }): string {
  if (m.vehicleType === 'MOTORCYCLE') return 'moto';
  if (m.vehicleType === 'TRUCK') return 'caminhao';
  return ['Picape', 'Utilitário', 'Van'].includes(m.bodyType ?? '') ? 'utilitario' : 'carro';
}

export function SpecSheet({ meta, specs }: { meta: SpecMeta; specs: Specs }) {
  const groups = meta.groups.map((g) => ({ g, rows: meta.fields.filter((f) => f.group === g && specs[f.key] !== undefined) })).filter((x) => x.rows.length);
  if (!groups.length) return <p className="muted">A equipe ainda não preencheu a ficha técnica desta versão.</p>;
  return (
    <div className="spec-groups">
      {groups.map(({ g, rows }) => (
        <div key={g} className="spec-group">
          <h4>{g}</h4>
          <dl className="spec-list">{rows.map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{formatSpec(f, specs[f.key])}</dd></div>)}</dl>
        </div>
      ))}
    </div>
  );
}

function Distribution({ rating }: { rating: GuideModel['rating'] }) {
  const max = Math.max(1, ...Object.values(rating.distribution));
  return (
    <div className="dist" aria-label="Distribuição das notas">
      {[5, 4, 3, 2, 1].map((n) => (
        <div key={n} className="rating-row"><span>{n} <Icon name="star" size={12} fill="currentColor" /></span><span className="bar" aria-hidden="true"><i style={{ width: `${((rating.distribution[n] ?? 0) / max) * 100}%` }} /></span><b>{rating.distribution[n] ?? 0}</b></div>
      ))}
    </div>
  );
}

/* ---------- Opiniões ---------- */
function Opinions({ model, authed, next, onWrite }: { model: GuideModel; authed: boolean; next: string; onWrite: () => void }) {
  const meta = useSpecMeta();
  const [sort, setSort] = useState<'recent' | 'best' | 'worst'>('recent');
  const [items, setItems] = useState<PublicOpinion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(async (offset: number) => {
    if (!authed) return;
    setLoading(true); setErr(null);
    try {
      const r = await api.get<{ total: number; items: PublicOpinion[] }>(`/vehicles/${encodeURIComponent(model.slug)}/opinions`, { query: { sort, limit: 8, offset } });
      setTotal(r.total); setItems((p) => (offset ? [...p, ...r.items] : r.items));
    } catch (e) { setErr(e); } finally { setLoading(false); }
  }, [model.slug, sort, authed]);
  useEffect(() => { void load(0); }, [load, model.myOpinion?.status, model.opinionCount]);
  const mine = model.myOpinion;
  return (
    <div className="card card-pad stack" id="opinioes">
      <div className="between">
        <h2 style={{ fontSize: 22 }}>Opiniões de quem tem</h2>
        {authed && <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar opiniões" style={{ maxWidth: 220 }}><option value="recent">Mais recentes</option><option value="best">Melhores notas</option><option value="worst">Piores notas</option></Select>}
      </div>
      {!authed && <LockCard what="as opiniões dos donos" next={next} />}
      {authed && mine && mine.status !== 'APPROVED' && (
        <Alert tone={mine.status === 'REJECTED' ? 'warn' : 'info'} title={mine.status === 'REJECTED' ? 'Sua opinião não foi publicada' : 'Sua opinião está em revisão'}>
          {mine.status === 'REJECTED' ? <>{mine.rejectReason ? `Motivo: ${mine.rejectReason}. ` : ''}Você pode editar e enviar de novo.</> : 'Ela aparece aqui assim que a equipe revisar. Você pode editar enquanto isso.'}
          <div style={{ marginTop: 8 }}><Button size="sm" onClick={onWrite}>Editar minha opinião</Button></div>
        </Alert>
      )}
      {authed && !mine && <div className="row"><Button variant="primary" icon="star" onClick={onWrite}>Deixe sua opinião</Button><span className="muted" style={{ fontSize: 14 }}>Leva 2 minutos e ajuda quem está escolhendo.</span></div>}
      {authed && err != null && <ErrorState error={err} onRetry={() => void load(0)} />}
      {authed && !loading && !err && !items.length && <p className="muted">Ainda não há opiniões publicadas para este modelo.</p>}
      <div className="stack">
        {items.map((o) => (
          <article key={o.id} className="opinion">
            <header><Stars value={o.rating} size={16} /><b>{o.title || 'Opinião'}</b></header>
            <div className="muted opinion-meta">{o.author} · {dateOnly(o.createdAt)}{o.versionName ? ` · ${o.versionName}` : ''}{o.ownerSince ? ` · dono desde ${o.ownerSince}` : ''}{o.km != null ? ` · ${o.km.toLocaleString('pt-BR')} km` : ''}</div>
            {o.liked && <p><Icon name="check-circle" size={16} className="ok-ico" /> <b>Gostei:</b> {o.liked}</p>}
            {o.disliked && <p><Icon name="alert-triangle" size={16} className="warn-ico" /> <b>Não gostei:</b> {o.disliked}</p>}
            {o.comment && <p>{o.comment}</p>}
            {meta && Object.keys(o.ratings).length > 0 && <div className="chips">{meta.ratingCategories.filter((c) => o.ratings[c.key]).map((c) => <span key={c.key} className="chip static">{c.label}: {o.ratings[c.key]}/5</span>)}</div>}
          </article>
        ))}
      </div>
      {items.length < total && <div style={{ textAlign: 'center' }}><Button loading={loading} onClick={() => void load(items.length)}>Ver mais opiniões</Button></div>}
    </div>
  );
}

function OpinionModal({ model, onClose }: { model: GuideModel; onClose: (changed?: boolean) => void }) {
  const toast = useToast();
  const meta = useSpecMeta();
  const mine = model.myOpinion;
  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [cats, setCats] = useState<Record<string, number>>(mine?.ratings ?? {});
  const [versionId, setVersionId] = useState(mine?.versionId ?? '');
  const [title, setTitle] = useState(mine?.title ?? '');
  const [liked, setLiked] = useState(mine?.liked ?? '');
  const [disliked, setDisliked] = useState(mine?.disliked ?? '');
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [ownerSince, setOwnerSince] = useState(mine?.ownerSince ? String(mine.ownerSince) : '');
  const [km, setKm] = useState(mine?.km != null ? String(mine.km) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const enough = liked.trim().length + disliked.trim().length + comment.trim().length >= 20;
  const firstRef = useRef<HTMLDivElement>(null);
  useEffect(() => { firstRef.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  async function save() {
    setBusy(true); setErr('');
    try {
      const ratings = Object.fromEntries(Object.entries(cats).filter(([, v]) => v >= 1));
      const r = await api.post<{ message: string }>(`/vehicles/${encodeURIComponent(model.slug)}/opinions`, {
        versionId: versionId || null, rating, ratings, title: title.trim(), liked: liked.trim(), disliked: disliked.trim(), comment: comment.trim(),
        ownerSince: ownerSince ? Number(ownerSince) : null, km: km ? Number(km) : null
      });
      toast.ok(r.message); onClose(true);
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.del(`/vehicles/${encodeURIComponent(model.slug)}/opinions/mine`); toast.ok('Opinião removida.'); onClose(true); } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal wide title={`Sua opinião sobre o ${model.brand} ${model.name}`} onClose={() => onClose()}
      footer={<>{mine && <Button variant="ghost" onClick={() => void remove()} disabled={busy}>Remover minha opinião</Button>}<span className="grow" /><Button variant="ghost" onClick={() => onClose()}>Cancelar</Button><Button variant="primary" loading={busy} disabled={rating < 1 || !enough || !meta} onClick={() => void save()}>Enviar para revisão</Button></>}>
      <div className="stack" ref={firstRef}>
        <div className="stack-sm"><b>Nota geral</b><StarPicker value={rating} onChange={setRating} label="Nota geral" size={34} /></div>
        {meta && (
          <div className="stack-sm">
            <b>Detalhe por quesito <span className="muted" style={{ fontWeight: 500 }}>(opcional)</span></b>
            <div className="cat-pickers">{meta.ratingCategories.map((c) => <div key={c.key} className="cat-picker"><span>{c.label}</span><StarPicker value={cats[c.key] ?? 0} onChange={(v) => setCats((p) => ({ ...p, [c.key]: v }))} label={c.label} size={22} /></div>)}</div>
          </div>
        )}
        <div className="form-grid">
          {model.versions.length > 0 && <Field label="Qual versão você tem?"><Select value={versionId} onChange={(e) => setVersionId(e.target.value)}><option value="">Não sei / prefiro não informar</option>{model.versions.map((v) => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}</Select></Field>}
          <Field label="Dono desde (ano)"><Input inputMode="numeric" value={ownerSince} onChange={(e) => setOwnerSince(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2021" /></Field>
          <Field label="Quilometragem aproximada"><Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="45000" /></Field>
        </div>
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Resuma em poucas palavras" /></Field>
        <Field label="O que você gostou"><Textarea value={liked} onChange={(e) => setLiked(e.target.value)} maxLength={600} rows={3} /></Field>
        <Field label="O que não gostou"><Textarea value={disliked} onChange={(e) => setDisliked(e.target.value)} maxLength={600} rows={3} /></Field>
        <Field label="Algo mais? (manutenção, consumo real, dicas)" hint={enough ? 'Pronto para enviar.' : 'Escreva pelo menos 20 caracteres entre os três campos de texto.'}><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1500} rows={4} /></Field>
        <p className="muted" style={{ fontSize: 13 }}>Seu nome aparece só como primeiro nome e inicial do sobrenome. Links e e-mails não são aceitos. A equipe revisa antes de publicar.</p>
        {err && <Alert tone="danger">{err}</Alert>}
      </div>
    </Modal>
  );
}
