import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Field, Input, Select } from '../shared/ui';
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
 * Campo único do veículo: a pessoa digita (ex.: "onix 2020") e escolhe na lista, ou escolhe marca, modelo e ano nas listas.
 * Ao escolher o ano, mostra o valor FIPE; o valor da simulação só muda se a pessoa pedir.
 */
export function FipePicker({ vehicleType, label, onLabel, onUseValue }: {
  vehicleType: FipeVType;
  label: string;
  onLabel: (label: string) => void;
  onUseValue: (cents: number) => void;
}) {
  const listId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [brands, setBrands] = useState<Item[]>([]);
  const [models, setModels] = useState<Item[]>([]);
  const [years, setYears] = useState<Item[]>([]);
  const [brand, setBrand] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState('');
  const [filter, setFilter] = useState('');
  const [hits, setHits] = useState<SearchResult | null>(null);
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState<FipePrice | null>(null);
  const [loading, setLoading] = useState<'' | 'brands' | 'models' | 'years' | 'price'>('');
  const [error, setError] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const fail = () => setError('Não foi possível carregar a lista agora. Digite o valor do veículo normalmente.');

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
    setBrands([]); setModels([]); setYears([]); setBrand(''); setModel(''); setYear(''); setFilter(''); setHits(null); setPrice(null); setError('');
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
    } catch { if (token === seq.current) setError('Não achamos o valor desse ano. Digite o valor do veículo.'); } finally { if (token === seq.current) setLoading(''); }
  }

  const onBrand = (code: string) => {
    const token = ++seq.current;
    setBrand(code); setModel(''); setYear(''); setModels([]); setYears([]); setFilter(''); setPrice(null); setError('');
    if (code) void fetchModels(code, token);
  };
  const onModel = (code: string) => {
    const token = ++seq.current;
    setModel(code); setYear(''); setYears([]); setPrice(null); setError('');
    if (code) { const m = models.find((x) => x.code === code); const b = brands.find((x) => x.code === brand); if (m && b) onLabel(`${shortBrand(b.name)} ${m.name}`.slice(0, 80)); void fetchYears(brand, code, token); }
  };
  const onYear = (code: string) => {
    const token = ++seq.current;
    setYear(code); setPrice(null); setError('');
    if (code) void fetchPrice(brand, model, code, token);
  };

  // sugestões enquanto a pessoa digita
  useEffect(() => {
    const text = label.trim();
    if (!enabled || !typed || text.length < 2) { setHits(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.get<SearchResult>('/fipe/search', { query: { vehicleType, q: text } }).then((r) => { if (alive) setHits(r); }, () => { if (alive) setHits(null); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [label, typed, enabled, vehicleType]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  async function choose(h: Hit, wantedYear: number | null) {
    const token = ++seq.current;
    setOpen(false); setTyped(false); setHits(null); setPrice(null); setError('');
    setBrand(h.brand.code); setModel(h.model.code); setYear(''); setFilter('');
    onLabel(`${shortBrand(h.brand.name)} ${h.model.name}`.slice(0, 80));
    const [, yl] = await Promise.all([fetchModels(h.brand.code, token), fetchYears(h.brand.code, h.model.code, token)]);
    if (token !== seq.current) return;
    const match = wantedYear ? yl.filter((y) => y.code.startsWith(`${wantedYear}-`) || y.name.startsWith(String(wantedYear))) : [];
    if (match.length === 1) { setYear(match[0]!.code); await fetchPrice(h.brand.code, h.model.code, match[0]!.code, token); }
  }

  const input = (
    <Input
      icon="search" value={label} maxLength={80} placeholder="Ex.: Onix 2020, Civic, CG 160" autoComplete="off" aria-label="Qual veículo você quer financiar?"
      role="combobox" aria-expanded={open && Boolean(hits?.items.length)} aria-controls={listId} aria-autocomplete="list"
      onFocus={() => setOpen(true)} onChange={(e) => { onLabel(e.target.value); setTyped(true); setOpen(true); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
    />
  );
  if (!enabled) return <Field label="Qual veículo você quer financiar?">{input}</Field>;
  const shownModels = filter.trim() ? models.filter((m) => m.name.toLowerCase().includes(filter.trim().toLowerCase())) : models;

  return (
    <div className="fipe-pick" ref={box}>
      <Field label="Qual veículo você quer financiar?">
        <div className="vpicker">
          {input}
          {open && typed && hits && hits.items.length > 0 && (
            <ul id={listId} className="vpicker-list" role="listbox" aria-label="Veículos">
              {hits.items.map((h) => (
                <li key={`${h.brand.code}-${h.model.code}`} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); void choose(h, hits.year); }}>
                  <b>{shortBrand(h.brand.name)} {h.model.name}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>
      <div className="fipe-selects">
        <Select value={brand} onChange={(e) => onBrand(e.target.value)} aria-label="Marca" disabled={loading === 'brands' && !brands.length}>
          <option value="">Marca</option>
          {brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </Select>
        {models.length > 12 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar modelo" aria-label="Filtrar modelo" maxLength={30} />}
        <Select value={model} onChange={(e) => onModel(e.target.value)} aria-label="Modelo e versão" disabled={!brand || (loading === 'models' && !models.length)}>
          <option value="">Modelo e versão</option>
          {shownModels.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
          {model && !shownModels.some((m) => m.code === model) && models.filter((m) => m.code === model).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </Select>
        <Select value={year} onChange={(e) => onYear(e.target.value)} aria-label="Ano" disabled={!model || (loading === 'years' && !years.length)}>
          <option value="">Ano</option>
          {years.map((y) => <option key={y.code} value={y.code}>{y.name}</option>)}
        </Select>
      </div>
      {error && <p className="muted" role="status" style={{ margin: 0, fontSize: 13 }}>{error}</p>}
      {price && (
        <div className="fipe-price" aria-live="polite">
          <span className="muted">Valor FIPE · {price.referenceMonth}</span>
          <b className="num fipe-price-v">{price.valueLabel}</b>
          <div><Button size="sm" onClick={() => onUseValue(price.valueCents)}>Usar este valor</Button></div>
        </div>
      )}
    </div>
  );
}
