import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Select } from '../shared/ui';
import { api } from './api';

type Item = { code: string; name: string };
export type FipeVType = 'cars' | 'motorcycles' | 'trucks';
export interface FipePrice { valueCents: number; valueLabel: string; referenceMonth: string; fipeCode: string; brand: Item; model: Item; year: Item; fuel: string | null }
interface Hit { brand: Item; model: Item }
interface SearchResult { items: Hit[]; year: number | null; truncated: boolean }

/** "GM - Chevrolet" vira "Chevrolet", "VW - VolksWagen" vira "VolksWagen". */
export const shortBrand = (name: string) => name.replace(/^[A-Z]{2,4}\s+-\s+/, '').trim();
export const fipeLabel = (brand: string, model: string, year: string) => `${shortBrand(brand)} ${model} ${year.replace(/\s+.*$/, '')}`.replace(/\s+/g, ' ').trim().slice(0, 80);

/**
 * Escolha de veículo pela Tabela FIPE: digite marca/modelo/ano (ex.: "onix 2020") ou escolha marca, modelo e ano nas listas.
 * Ao escolher o ano, mostra o valor FIPE do mês. Nada é obrigatório: o valor que a pessoa digita no simulador continua valendo.
 */
export function FipePicker({ vehicleType, valueCents, onUseValue, onLabel }: {
  vehicleType: FipeVType;
  valueCents: number;
  onUseValue: (cents: number) => void;
  onLabel: (label: string) => void;
}) {
  const listId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [brands, setBrands] = useState<Item[]>([]);
  const [models, setModels] = useState<Item[]>([]);
  const [years, setYears] = useState<Item[]>([]);
  const [brand, setBrand] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState('');
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<FipePrice | null>(null);
  const [loading, setLoading] = useState<'' | 'brands' | 'models' | 'years' | 'price'>('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const fail = () => setError('Não consegui carregar a Tabela FIPE agora. Você pode digitar o valor do veículo normalmente.');

  const loadBrands = useCallback(async (vt: FipeVType, token: number) => {
    setLoading('brands');
    try {
      const r = await api.get<{ brands: Item[] }>('/fipe/brands', { query: { vehicleType: vt } });
      if (token === seq.current) setBrands(r.brands);
    } catch { if (token === seq.current) fail(); } finally { if (token === seq.current) setLoading(''); }
  }, []);

  useEffect(() => { api.get<{ enabled: boolean }>('/fipe/status').then((s) => setEnabled(s.enabled), () => setEnabled(false)); }, []);
  useEffect(() => {
    if (!enabled) return;
    const token = ++seq.current;
    setBrands([]); setModels([]); setYears([]); setBrand(''); setModel(''); setYear(''); setFilter(''); setQ(''); setHits(null); setPrice(null); setError('');
    void loadBrands(vehicleType, token);
  }, [enabled, vehicleType, loadBrands]);

  async function fetchModels(brandCode: string, token: number): Promise<Item[]> {
    setLoading('models');
    try {
      const r = await api.get<{ models: Item[] }>('/fipe/models', { query: { vehicleType, brandCode } });
      if (token === seq.current) setModels(r.models);
      return r.models;
    } catch { if (token === seq.current) fail(); return []; } finally { if (token === seq.current) setLoading(''); }
  }
  async function fetchYears(brandCode: string, modelCode: string, token: number): Promise<Item[]> {
    setLoading('years');
    try {
      const r = await api.get<{ years: Item[] }>('/fipe/years', { query: { vehicleType, brandCode, modelCode } });
      if (token === seq.current) setYears(r.years);
      return r.years;
    } catch { if (token === seq.current) fail(); return []; } finally { if (token === seq.current) setLoading(''); }
  }
  async function fetchPrice(brandCode: string, modelCode: string, yearCode: string, token: number) {
    setLoading('price'); setPrice(null);
    try {
      const p = await api.get<FipePrice>('/fipe/price', { query: { vehicleType, brandCode, modelCode, yearCode } });
      if (token !== seq.current) return;
      setPrice(p);
      onLabel(fipeLabel(p.brand.name, p.model.name, p.year.name));
    } catch { if (token === seq.current) setError('Não achamos o valor FIPE desse ano agora. Confira o ano ou digite o valor do veículo.'); } finally { if (token === seq.current) setLoading(''); }
  }

  const onBrand = (code: string) => {
    const token = ++seq.current;
    setBrand(code); setModel(''); setYear(''); setModels([]); setYears([]); setFilter(''); setPrice(null); setError('');
    if (code) void fetchModels(code, token);
  };
  const onModel = (code: string) => {
    const token = ++seq.current;
    setModel(code); setYear(''); setYears([]); setPrice(null); setError('');
    if (code) void fetchYears(brand, code, token);
  };
  const onYear = (code: string) => {
    const token = ++seq.current;
    setYear(code); setPrice(null); setError('');
    if (code) void fetchPrice(brand, model, code, token);
  };

  // busca por texto na própria FIPE
  useEffect(() => {
    const text = q.trim();
    if (!enabled || text.length < 2) { setHits(null); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.get<SearchResult>('/fipe/search', { query: { vehicleType, q: text } }).then((r) => { if (alive) setHits(r); }, () => { if (alive) setHits({ items: [], year: null, truncated: false }); }).finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); setSearching(false); };
  }, [q, enabled, vehicleType]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  async function choose(h: Hit, wantedYear: number | null) {
    const token = ++seq.current;
    setOpen(false); setPrice(null); setError('');
    setBrand(h.brand.code); setModel(h.model.code); setYear(''); setFilter('');
    const [ml, yl] = await Promise.all([fetchModels(h.brand.code, token), fetchYears(h.brand.code, h.model.code, token)]);
    if (token !== seq.current) return;
    void ml;
    const match = wantedYear ? yl.filter((y) => y.code.startsWith(`${wantedYear}-`) || y.name.startsWith(String(wantedYear))) : [];
    if (match.length === 1) { setYear(match[0]!.code); await fetchPrice(h.brand.code, h.model.code, match[0]!.code, token); }
  }

  if (!enabled) return null;
  const shownModels = filter.trim() ? models.filter((m) => m.name.toLowerCase().includes(filter.trim().toLowerCase())) : models;
  const diff = price && valueCents > 0 ? Math.round(((valueCents - price.valueCents) / price.valueCents) * 1000) / 10 : null;

  return (
    <div className="fipe-pick" ref={box} aria-label="Escolher pela Tabela FIPE">
      <div>
        <b>Ou escolha pela Tabela FIPE</b>
        <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>Digite marca, modelo e ano, ou escolha nas listas. Mostramos o valor FIPE do mês; você decide o valor da simulação.</p>
      </div>
      <div className="vpicker">
        <Input
          icon="search" value={q} maxLength={80} placeholder="Ex.: onix 2020, civic, cg 160 2022…" autoComplete="off" aria-label="Buscar veículo na Tabela FIPE"
          role="combobox" aria-expanded={open && hits != null} aria-controls={listId} aria-autocomplete="list"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        {open && q.trim().length >= 2 && (
          <ul id={listId} className="vpicker-list" role="listbox" aria-label="Veículos da Tabela FIPE">
            {searching && !hits && <li className="empty" role="presentation">Buscando…</li>}
            {hits?.items.map((h) => (
              <li key={`${h.brand.code}-${h.model.code}`} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); void choose(h, hits.year); }}>
                <b>{shortBrand(h.brand.name)} {h.model.name}</b>
                <small>{hits.year ? `Ano ${hits.year} se estiver na tabela` : 'Depois escolha o ano'}</small>
              </li>
            ))}
            {hits && !hits.items.length && !searching && <li className="empty" role="presentation">Não achamos na Tabela FIPE. Tente só a marca ou use as listas abaixo.</li>}
            {hits?.truncated && <li className="foot" role="presentation">Mostrando os primeiros resultados. Acrescente a versão para afinar.</li>}
          </ul>
        )}
      </div>
      <div className="form-grid">
        <Field label="Marca">
          <Select value={brand} onChange={(e) => onBrand(e.target.value)} disabled={loading === 'brands' && !brands.length}>
            <option value="">{loading === 'brands' ? 'Carregando…' : 'Selecione'}</option>
            {brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Modelo e versão" hint={models.length > 12 ? `${models.length} opções. Use o filtro para achar mais rápido.` : undefined}>
          {models.length > 12 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar (ex.: 1.0, LT, turbo)" aria-label="Filtrar modelos" maxLength={30} />}
          <Select value={model} onChange={(e) => onModel(e.target.value)} disabled={!brand || (loading === 'models' && !models.length)}>
            <option value="">{loading === 'models' ? 'Carregando…' : 'Selecione'}</option>
            {shownModels.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            {model && !shownModels.some((m) => m.code === model) && models.filter((m) => m.code === model).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Ano e combustível">
          <Select value={year} onChange={(e) => onYear(e.target.value)} disabled={!model || (loading === 'years' && !years.length)}>
            <option value="">{loading === 'years' ? 'Carregando…' : 'Selecione'}</option>
            {years.map((y) => <option key={y.code} value={y.code}>{y.name}</option>)}
          </Select>
        </Field>
      </div>
      {error && <Alert tone="warn" icon="info">{error}</Alert>}
      {loading === 'price' && <p className="muted" role="status">Buscando o valor FIPE…</p>}
      {price && (
        <div className="fipe-price" aria-live="polite">
          <span className="muted">Tabela FIPE · referência {price.referenceMonth}</span>
          <b className="num fipe-price-v">{price.valueLabel}</b>
          <small>{shortBrand(price.brand.name)} {price.model.name} · {price.year.name} · código FIPE {price.fipeCode}</small>
          {diff != null && Math.abs(diff) >= 0.1 && <small>O valor da simulação está {String(Math.abs(diff)).replace('.', ',')}% {diff > 0 ? 'acima' : 'abaixo'} da FIPE.</small>}
          <div><Button size="sm" onClick={() => onUseValue(price.valueCents)}>Usar como valor do veículo</Button></div>
          <small className="muted">A FIPE é uma referência de preço médio. O preço de venda varia com estado, quilometragem e região.</small>
        </div>
      )}
    </div>
  );
}
