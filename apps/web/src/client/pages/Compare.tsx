import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, EmptyState, ErrorState, Field, Input, LinkButton, PageLoading, Select, Skeleton, Switch, usePageTitle, useToast } from '../../shared/ui';
import { api } from '../api';
import { useSession } from '../session';
import { Stars, formatSpec, ratingText, type RatingCategory, type RatingSummary, type SpecField, type Specs } from '../guide';
import { SeoH1 } from '../components/SeoContent';

interface CompareItem { versionId: string; label: string; model: { slug: string; brand: string; name: string }; version: { name: string; yearModel: number | null; fuel: string | null }; specs: Specs; rating: RatingSummary }
interface CompareResult { groups: string[]; fields: SpecField[]; ratingCategories: RatingCategory[]; items: CompareItem[]; winners: Record<string, number[]>; ratingWinners: Record<string, number[]> }
interface Slot { versionId: string; label: string; slug: string }
const MAX = 3;

export default function Compare() {
  usePageTitle('Comparar veículos');
  const { status } = useSession();
  const loc = useLocation();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const ids = useMemo(() => (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX), [params]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const setIds = useCallback((next: string[]) => { setParams(next.length ? { ids: next.join(',') } : {}, { replace: true }); }, [setParams]);

  // rótulos dos veículos escolhidos
  useEffect(() => {
    if (!ids.length) { setSlots([]); return; }
    let alive = true;
    api.get<{ items: Slot[] }>('/vehicles/version-labels', { query: { ids: ids.join(',') } }).then((r) => {
      if (!alive) return;
      const byId = new Map(r.items.map((i) => [i.versionId, i]));
      setSlots(ids.map((id) => byId.get(id)).filter((x): x is Slot => Boolean(x)));
    }, () => undefined);
    return () => { alive = false; };
  }, [ids]);

  // comparação (precisa de conta e de 2+ veículos)
  useEffect(() => {
    if (status !== 'authed' || ids.length < 2) { setResult(null); setError(null); return; }
    let alive = true;
    setLoading(true); setError(null);
    api.get<CompareResult>('/vehicles/compare', { query: { ids: ids.join(',') } }).then((r) => { if (alive) setResult(r); }, (e) => { if (alive) { setError(e); setResult(null); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ids, status]);

  if (status === 'loading') return <PageLoading />;
  const next = `${loc.pathname}${loc.search}`;
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <span className="eyebrow">Comparador</span>
          <SeoH1 path="/comparar" fallback="Compare veículos lado a lado." style={{ maxWidth: '24ch' }} />
          <p className="lead">Escolha de 2 a 3 versões e veja ficha técnica, consumo, espaço e a nota de quem tem, com o melhor de cada quesito destacado.</p>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container stack-lg">
          {status !== 'authed' ? (
            <div className="card card-pad stack">
              <div className="row"><Icon name="lock" size={22} /><h3>O comparador é grátis para quem tem conta</h3></div>
              <p className="muted">Crie sua conta em menos de um minuto para comparar veículos, ver a ficha técnica completa e ler a opinião dos donos.</p>
              <div className="row"><LinkButton to={`/criar-conta?next=${encodeURIComponent(next)}`} variant="primary">Criar conta grátis</LinkButton><LinkButton to={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</LinkButton></div>
            </div>
          ) : (
            <>
              <div className="cmp-slots">
                {Array.from({ length: MAX }).map((_, i) => {
                  const slot = slots[i];
                  if (slot) {
                    return (
                      <div key={slot.versionId} className="cmp-slot filled">
                        <span className="cat-tag">Veículo {i + 1}</span>
                        <Link to={`/veiculos/${slot.slug}?versao=${slot.versionId}`}><b>{slot.label}</b></Link>
                        <button type="button" className="link-btn" onClick={() => setIds(ids.filter((x) => x !== slot.versionId))}>Remover</button>
                      </div>
                    );
                  }
                  return i === slots.length ? <VehiclePicker key="picker" exclude={ids} onPick={(id) => setIds([...ids, id])} index={i} /> : <div key={`empty-${i}`} className="cmp-slot empty"><span className="cat-tag">Veículo {i + 1}</span><span className="muted">{i === 2 ? 'Opcional' : 'Escolha acima'}</span></div>;
                })}
              </div>
              {ids.length < 2 && <EmptyState icon="bar-chart" title="Escolha pelo menos 2 veículos">Busque pelo nome (ex.: “Tracker Premier”) em cada campo acima. Se ainda não achar, o veículo pode não estar no guia: veja os <Link to="/veiculos">modelos disponíveis</Link>.</EmptyState>}
              {loading && <div className="stack"><Skeleton h={60} /><Skeleton h={260} /></div>}
              {error != null && <ErrorState error={error} onRetry={() => setIds([...ids])} />}
              {result && !loading && (
                <div className="stack">
                  <div className="between">
                    <Switch checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} label="Mostrar só o que é diferente" />
                    <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => toast.ok('Link copiado.'), () => toast.error('Não foi possível copiar o link.')); }}>Copiar link da comparação</Button>
                  </div>
                  <CompareTable data={result} onlyDiff={onlyDiff} />
                  <p className="muted" style={{ fontSize: 13 }}>Dados técnicos conforme cadastro do guia (fabricante e testes publicados). Consumo e desempenho reais variam com uso e conservação. A nota dos donos reflete só opiniões aprovadas aqui no guia.</p>
                  <Alert tone="info" icon="info" title="Vai comprar um destes?">Consulte a placa do carro anunciado para saber débitos, restrições e histórico. <Link to="/consultar">Consultar uma placa</Link></Alert>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

function VehiclePicker({ exclude, onPick, index }: { exclude: string[]; onPick: (id: string) => void; index: number }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ versionId: string; label: string }>>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cascade, setCascade] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setBusy(true);
      api.get<{ items: Array<{ versionId: string; label: string }> }>('/vehicles/search-versions', { query: { q: q.trim() } }).then((r) => setResults(r.items.filter((i) => !exclude.includes(i.versionId))), () => setResults([])).finally(() => setBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, exclude]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="cmp-slot picker" ref={box}>
      <span className="cat-tag">Veículo {index + 1}</span>
      <Input icon="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Buscar modelo ou versão" aria-label={`Buscar veículo ${index + 1}`} maxLength={80} autoComplete="off" />
      <button type="button" className="link-btn" onClick={() => setCascade((v) => !v)} aria-expanded={cascade}>{cascade ? 'Fechar a escolha por listas' : 'Ou escolher por marca, modelo, versão e ano'}</button>
      {cascade && <VersionSelects exclude={exclude} onPick={(id) => { setCascade(false); onPick(id); }} />}
      {open && (
        <ul className="picker-list" role="listbox">
          {busy && <li className="muted">Buscando…</li>}
          {!busy && !results.length && <li className="muted">Nenhum veículo encontrado.</li>}
          {results.map((r) => <li key={r.versionId} role="option" aria-selected={false}><button type="button" onClick={() => { setOpen(false); setQ(''); onPick(r.versionId); }}>{r.label}</button></li>)}
        </ul>
      )}
    </div>
  );
}

interface TreeVersion { id: string; name: string; fuel: string | null; yearModel: number | null }
interface Tree { brands: Array<{ name: string; models: Array<{ slug: string; name: string; versions: TreeVersion[] }> }> }

/** Escolha em cascata: marca, modelo, versão e ano (só o que existe no guia). */
function VersionSelects({ exclude, onPick }: { exclude: string[]; onPick: (id: string) => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [failed, setFailed] = useState(false);
  const [brand, setBrand] = useState(''); const [slug, setSlug] = useState(''); const [ver, setVer] = useState('');
  useEffect(() => { api.get<Tree>('/vehicles/version-tree').then(setTree, () => setFailed(true)); }, []);
  const models = tree?.brands.find((b) => b.name === brand)?.models ?? [];
  const allVersions = models.find((m) => m.slug === slug)?.versions ?? [];
  const versions = allVersions.filter((v) => !exclude.includes(v.id));
  const verKey = (v: TreeVersion) => `${v.name}|${v.fuel ?? ''}`;
  const names = [...new Map(versions.map((v) => [verKey(v), v])).values()];
  const years = versions.filter((v) => verKey(v) === ver);
  const pickVersion = (key: string) => { setVer(key); const list = versions.filter((v) => verKey(v) === key); if (list.length === 1) onPick(list[0]!.id); };
  if (failed) return <p className="muted" style={{ fontSize: 13 }}>Não foi possível carregar as listas agora. Use a busca acima.</p>;
  if (!tree) return <p className="muted" style={{ fontSize: 13 }}>Carregando…</p>;
  return (
    <div className="stack-sm cmp-cascade">
      <Field label="Marca"><Select value={brand} onChange={(e) => { setBrand(e.target.value); setSlug(''); setVer(''); }}><option value="">Selecione</option>{tree.brands.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</Select></Field>
      <Field label="Modelo"><Select value={slug} onChange={(e) => { setSlug(e.target.value); setVer(''); }} disabled={!brand}><option value="">Selecione</option>{models.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}</Select></Field>
      <Field label="Versão"><Select value={ver} onChange={(e) => pickVersion(e.target.value)} disabled={!slug}><option value="">Selecione</option>{names.map((v) => <option key={verKey(v)} value={verKey(v)}>{v.name}{v.fuel ? ` · ${v.fuel}` : ''}</option>)}</Select></Field>
      <Field label="Ano"><Select value="" onChange={(e) => e.target.value && onPick(e.target.value)} disabled={years.length < 2}><option value="">{years.length === 1 ? 'Único ano cadastrado' : 'Selecione'}</option>{years.map((v) => <option key={v.id} value={v.id}>{v.yearModel ?? 'Ano não informado'}</option>)}</Select></Field>
      {slug && !names.length && <p className="muted" style={{ fontSize: 13 }}>{allVersions.length ? 'Todas as versões deste modelo já estão na comparação.' : 'Este modelo ainda não tem versões cadastradas para comparar.'}</p>}
    </div>
  );
}

function CompareTable({ data, onlyDiff }: { data: CompareResult; onlyDiff: boolean }) {
  const { items, fields, groups, winners, ratingWinners, ratingCategories } = data;
  const wins = items.map((_, i) => Object.values(winners).filter((w) => w.includes(i)).length + Object.values(ratingWinners).filter((w) => w.includes(i)).length);
  const totalWins = Math.max(...wins);
  const differs = (vals: unknown[]) => new Set(vals.map((v) => JSON.stringify(v ?? null))).size > 1;
  const hasRatings = items.some((i) => i.rating.count > 0);

  const ratingRows = hasRatings ? [
    { key: 'overall', label: 'Nota geral', vals: items.map((i) => i.rating.average) },
    ...ratingCategories.map((c) => ({ key: c.key, label: c.label, vals: items.map((i) => i.rating.categories[c.key] ?? null) }))
  ].filter((r) => r.vals.some((v) => v != null)).filter((r) => !onlyDiff || differs(r.vals)) : [];

  return (
    <div className="cmp-wrap">
      <table className="cmp">
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Quesito</span></th>
            {items.map((it, i) => (
              <th key={it.versionId} scope="col">
                <Link to={`/veiculos/${it.model.slug}?versao=${it.versionId}`}><span className="cat-tag">{it.model.brand}</span><b>{it.model.name}</b></Link>
                <span className="muted cmp-ver">{[it.version.name, it.version.yearModel, it.version.fuel].filter(Boolean).join(' · ')}</span>
                {totalWins > 0 && <span className={`wins ${wins[i] === totalWins ? 'top' : ''}`}>{wins[i]} {wins[i] === 1 ? 'quesito' : 'quesitos'} a favor</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ratingRows.length > 0 && (
            <>
              <tr className="grp"><th colSpan={items.length + 1} scope="colgroup">Nota dos donos</th></tr>
              {ratingRows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  {r.vals.map((v, i) => <td key={i} className={ratingWinners[r.key]?.includes(i) ? 'win' : ''}>{v == null ? '—' : <span className="cmp-rate"><Stars value={v} size={14} /> {ratingText(v)}</span>}{r.key === 'overall' && items[i]!.rating.count > 0 && <small className="muted"> ({items[i]!.rating.count})</small>}</td>)}
                </tr>
              ))}
            </>
          )}
          {groups.map((g) => {
            const rows = fields.filter((f) => f.group === g && items.some((it) => it.specs[f.key] !== undefined)).filter((f) => !onlyDiff || differs(items.map((it) => it.specs[f.key])));
            if (!rows.length) return null;
            return [
              <tr key={`g-${g}`} className="grp"><th colSpan={items.length + 1} scope="colgroup">{g}</th></tr>,
              ...rows.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  {items.map((it, i) => <td key={it.versionId} className={winners[f.key]?.includes(i) ? 'win' : ''}>{formatSpec(f, it.specs[f.key])}{winners[f.key]?.includes(i) && <Icon name="check" size={14} className="win-ico" aria-label="Melhor neste quesito" />}</td>)}
                </tr>
              ))
            ];
          })}
        </tbody>
      </table>
      {!ratingRows.length && !groups.some((g) => fields.some((f) => f.group === g && items.some((it) => it.specs[f.key] !== undefined))) && <p className="muted" style={{ padding: 16 }}>Estes veículos ainda não têm dados técnicos cadastrados para comparar.</p>}
    </div>
  );
}
