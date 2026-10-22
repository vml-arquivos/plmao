import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../shared/icons';
import { Input, LinkButton, Select, Skeleton } from '../shared/ui';
import { api } from './api';
import { ModelCard, type GuideCard } from './guide';
import { fipeLabel, shortBrand, type FipePrice, type FipeVType } from './fipePicker';

type Item = { code: string; name: string };
interface Hit { brand: Item; model: Item }
interface SearchResult { items: Hit[]; year: number | null }

const TYPES: Array<{ key: FipeVType; label: string; sim: string }> = [
  { key: 'cars', label: 'Carros', sim: 'carro' },
  { key: 'motorcycles', label: 'Motos', sim: 'moto' },
  { key: 'trucks', label: 'Caminhões', sim: 'caminhao' }
];

/** Palavras que, no começo do nome, fazem parte do modelo ("Grand Siena", "Santa Fe", "Land Cruiser"). */
const JOIN = new Set(['grand', 'gran', 'santa', 'land', 'range', 'new', 'nova', 'novo', 'super', 'space', 'town']);

/** Na FIPE o "modelo" já vem com a versão ("HB20 1.0 Comfort Plus 12V Flex"). A família é o começo do nome; a versão, o resto. */
export function splitFipeModel(name: string): { family: string; version: string } {
  const words = name.trim().split(/\s+/);
  const n = JOIN.has(words[0]!.toLowerCase()) && words.length > 1 ? 2 : 1;
  return { family: words.slice(0, n).join(' '), version: words.slice(n).join(' ') || name.trim() };
}

/**
 * Filtro do guia: Marca → Modelo → Versão → Ano, ou digitar o nome. Ao escolher a versão aparece a ficha do guia (se existir);
 * ao escolher o ano, o valor.
 */
export function GuideFinder({ typed, onTyped, onPicked }: { typed: string; onTyped: (v: string) => void; onPicked: () => void }) {
  const listId = useId();
  const [vt, setVt] = useState<FipeVType>('cars');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [brands, setBrands] = useState<Item[]>([]);
  const [models, setModels] = useState<Item[]>([]);
  const [years, setYears] = useState<Item[]>([]);
  const [brand, setBrand] = useState(''); const [family, setFamily] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState('');
  const [price, setPrice] = useState<FipePrice | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [fichas, setFichas] = useState<GuideCard[] | null>(null);
  const [hits, setHits] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const fail = () => setError('Não foi possível carregar a lista agora. Tente de novo em instantes.');

  useEffect(() => { api.get<{ enabled: boolean }>('/fipe/status').then((s) => setEnabled(s.enabled), () => setEnabled(false)); }, []);

  const reset = (keepBrands = false) => {
    seq.current++;
    if (!keepBrands) setBrands([]);
    setModels([]); setYears([]); setBrand(''); setFamily(''); setModel(''); setYear(''); setPrice(null); setFichas(null); setError('');
  };

  useEffect(() => {
    if (!enabled) return;
    reset();
    const token = seq.current;
    api.get<{ brands: Item[] }>('/fipe/brands', { query: { vehicleType: vt } }).then((r) => { if (token === seq.current) setBrands(r.brands); }, () => { if (token === seq.current) fail(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, vt]);

  const families = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const x of models) { const f = splitFipeModel(x.name).family; m.set(f, [...(m.get(f) ?? []), x]); }
    return m;
  }, [models]);
  const versions = family ? families.get(family) ?? [] : [];

  const brandName = (code = brand) => brands.find((b) => b.code === code)?.name ?? '';

  async function loadModels(code: string, token: number): Promise<Item[]> {
    try {
      const r = await api.get<{ models: Item[] }>('/fipe/models', { query: { vehicleType: vt, brandCode: code } });
      if (token === seq.current) setModels(r.models);
      return r.models;
    } catch { if (token === seq.current) fail(); return []; }
  }
  async function loadYears(b: string, m: string, token: number): Promise<Item[]> {
    try {
      const r = await api.get<{ years: Item[] }>('/fipe/years', { query: { vehicleType: vt, brandCode: b, modelCode: m } });
      if (token === seq.current) setYears(r.years);
      return r.years;
    } catch { if (token === seq.current) fail(); return []; }
  }
  async function loadPrice(b: string, m: string, y: string, token: number) {
    setPriceLoading(true); setPrice(null);
    try {
      const p = await api.get<FipePrice>('/fipe/price', { query: { vehicleType: vt, brandCode: b, modelCode: m, yearCode: y } });
      if (token === seq.current) setPrice(p);
    } catch { if (token === seq.current) setError('Não achamos o valor desse ano.'); } finally { if (token === seq.current) setPriceLoading(false); }
  }
  /** Ficha do guia, quando o veículo já tem uma. */
  function loadFichas(bName: string, mName: string, token: number) {
    setFichas(null);
    api.get<{ items: GuideCard[] }>('/vehicles/fipe-match', { query: { brand: bName, model: mName } }).then((r) => { if (token === seq.current) setFichas(r.items); }, () => { if (token === seq.current) setFichas([]); });
  }

  /** Escolhe a versão (modelo da FIPE) e carrega anos e ficha. Com um só ano, já mostra o valor. */
  async function pickModel(b: string, bName: string, m: Item, token: number) {
    setModel(m.code); setYear(''); setYears([]); setPrice(null);
    loadFichas(bName, m.name, token);
    const yl = await loadYears(b, m.code, token);
    if (token === seq.current && yl.length === 1) { setYear(yl[0]!.code); await loadPrice(b, m.code, yl[0]!.code, token); }
  }

  const onBrand = async (code: string) => {
    reset(true); onPicked(); onTyped('');
    const token = seq.current;
    setBrand(code);
    if (code) await loadModels(code, token);
  };
  const onFamily = async (f: string) => {
    const token = ++seq.current;
    setFamily(f); setModel(''); setYear(''); setYears([]); setPrice(null); setFichas(null); setError('');
    const list = families.get(f) ?? [];
    if (f && list.length === 1) await pickModel(brand, brandName(), list[0]!, token);
    else if (f && list[0]) loadFichas(brandName(), list[0].name, token);
  };
  const onVersion = (code: string) => {
    const token = ++seq.current; setError('');
    const m = models.find((x) => x.code === code);
    if (!m) { setModel(''); setYear(''); setYears([]); setPrice(null); return; }
    void pickModel(brand, brandName(), m, token);
  };
  const onYear = (code: string) => {
    const token = ++seq.current; setYear(code); setPrice(null); setError('');
    if (code) void loadPrice(brand, model, code, token);
  };

  // sugestões da própria tabela enquanto a pessoa digita
  useEffect(() => {
    const text = typed.trim();
    if (!enabled || text.length < 2) { setHits(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.get<SearchResult>('/fipe/search', { query: { vehicleType: vt, q: text } }).then((r) => { if (alive) setHits(r); }, () => { if (alive) setHits(null); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [typed, enabled, vt]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  async function choose(h: Hit, wantedYear: number | null) {
    const token = ++seq.current;
    setOpen(false); setHits(null); setPrice(null); setFichas(null); setError('');
    onTyped(''); onPicked();
    setBrand(h.brand.code); setYear('');
    const list = await loadModels(h.brand.code, token);
    if (token !== seq.current) return;
    const m = list.find((x) => x.code === h.model.code) ?? h.model;
    setFamily(splitFipeModel(m.name).family);
    setModel(m.code); setYears([]);
    loadFichas(h.brand.name, m.name, token);
    const yl = await loadYears(h.brand.code, m.code, token);
    if (token !== seq.current) return;
    const match = wantedYear ? yl.filter((y) => y.name.startsWith(String(wantedYear))) : [];
    const pick = match.length === 1 ? match[0]! : yl.length === 1 ? yl[0]! : null;
    if (pick) { setYear(pick.code); await loadPrice(h.brand.code, m.code, pick.code, token); }
  }

  const chosenModel = models.find((m) => m.code === model);
  const chosenYear = years.find((y) => y.code === year);
  const typeInfo = TYPES.find((t) => t.key === vt)!;
  const title = chosenModel ? `${shortBrand(brandName())} ${chosenModel.name}` : '';
  const simQuery = new URLSearchParams({ n: fipeLabel(brandName(), chosenModel?.name ?? '', chosenYear?.name ?? ''), ...(price ? { v: String(Math.round(price.valueCents) / 100) } : {}) }).toString();

  return (
    <div className="finder" ref={box}>
      <div className="finder-types" role="group" aria-label="Tipo de veículo">
        {TYPES.map((t) => <button key={t.key} type="button" className="chip" aria-pressed={vt === t.key} onClick={() => { if (vt !== t.key) setVt(t.key); }}>{t.label}</button>)}
      </div>

      <div className="vpicker">
        <Input
          icon="search" value={typed} maxLength={80} placeholder="Digite o nome: HB20, Onix 2020, Civic, CG 160…" autoComplete="off" aria-label="Buscar veículo"
          role="combobox" aria-expanded={open && Boolean(hits?.items.length)} aria-controls={listId} aria-autocomplete="list"
          onFocus={() => setOpen(true)} onChange={(e) => { onTyped(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        {open && typed.trim().length >= 2 && hits && hits.items.length > 0 && (
          <ul id={listId} className="vpicker-list" role="listbox" aria-label="Veículos">
            {hits.items.slice(0, 8).map((h) => (
              <li key={`${h.brand.code}-${h.model.code}`} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); void choose(h, hits.year); }}>
                <b>{shortBrand(h.brand.name)} {h.model.name}</b>
              </li>
            ))}
          </ul>
        )}
      </div>

      {enabled !== false && (
        <div className="finder-selects">
          <Select value={brand} onChange={(e) => void onBrand(e.target.value)} aria-label="Marca" disabled={!brands.length}>
            <option value="">{brands.length ? 'Marca' : 'Carregando…'}</option>
            {brands.map((b) => <option key={b.code} value={b.code}>{shortBrand(b.name)}</option>)}
          </Select>
          <Select value={family} onChange={(e) => void onFamily(e.target.value)} aria-label="Modelo" disabled={!brand || !models.length}>
            <option value="">{brand && !models.length ? 'Carregando…' : 'Modelo'}</option>
            {[...families.keys()].map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
          <Select value={model} onChange={(e) => onVersion(e.target.value)} aria-label="Versão" disabled={!family}>
            <option value="">Versão</option>
            {versions.map((m) => <option key={m.code} value={m.code}>{splitFipeModel(m.name).version}</option>)}
          </Select>
          <Select value={year} onChange={(e) => onYear(e.target.value)} aria-label="Ano" disabled={!model || !years.length}>
            <option value="">Ano</option>
            {years.map((y) => <option key={y.code} value={y.code}>{y.name}</option>)}
          </Select>
        </div>
      )}
      {error && <p className="muted" role="status" style={{ margin: 0, fontSize: 13 }}>{error}</p>}

      {model && chosenModel && (
        <div className="finder-result" aria-live="polite">
          <div className="finder-result-head">
            <div>
              <span className="eyebrow">{typeInfo.label.replace(/s$/, '')}</span>
              <h2>{title}</h2>
              {chosenYear && <p className="muted">{chosenYear.name}</p>}
            </div>
            <div className="finder-price">
              {priceLoading && <Skeleton h={44} r={12} />}
              {price && <><span className="muted">Valor médio · {price.referenceMonth}</span><b className="num">{price.valueLabel}</b></>}
              {!price && !priceLoading && <span className="muted">Escolha o ano para ver o valor.</span>}
            </div>
          </div>
          {fichas && fichas.length > 0 && <div className="guide-grid">{fichas.map((m) => <ModelCard key={m.slug} m={m} />)}</div>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <LinkButton to={`/simulador/${typeInfo.sim}?${simQuery}`} variant="primary" icon="calculator">Simular financiamento</LinkButton>
            <LinkButton to="/consultar" icon="search">Consultar uma placa</LinkButton>
          </div>
          {fichas && fichas.length === 0 && <p className="muted" style={{ fontSize: 13.5, margin: 0 }}><Icon name="info" size={14} /> Este veículo ainda não tem ficha no guia.</p>}
        </div>
      )}
    </div>
  );
}
