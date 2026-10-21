import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, Field, Input, LinkButton, PlateBadge, Select, Tabs, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { isValidPlate, money, normalizePlate } from '../../shared/format';
import { api } from '../api';
import { useSession } from '../session';
import { trackFunnel } from '../funnel';

type Item = { code: string; name: string };
type VType = 'cars' | 'motorcycles' | 'trucks';
interface Quote { documentCode: string; consultedAt: string; referenceMonth: string; vehicleType: VType; brand: Item; model: Item; year: Item; fuel?: string; fipeCode: string; valueCents: number; valueLabel: string; estimatedNegotiation?: { minCents: number; maxCents: number; disclaimer: string }; blocks: Array<{ key: string; label: string; message: string }>; plate?: string }

export default function Fipe() {
  usePageTitle('Consulta FIPE grátis');
  const { status } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'plate' | 'select'>('plate');
  const [plate, setPlate] = useState(normalizePlate(params.get('placa') ?? ''));
  const [vt, setVt] = useState<VType>('cars');
  const [brands, setBrands] = useState<Item[]>([]); const [models, setModels] = useState<Item[]>([]); const [years, setYears] = useState<Item[]>([]);
  const [brand, setBrand] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { trackFunnel('FIPE_PAGE_VIEW', {}); api.get<{ enabled: boolean }>('/fipe/status').then((s) => setEnabled(s.enabled), () => undefined); }, []);
  // escolha vinda da busca por texto: aplica modelo e ano quando as listas chegam
  const pending = useRef<{ model: string; year: number | null } | null>(null);
  const [q, setQ] = useState(''); const [hits, setHits] = useState<{ items: Array<{ brand: Item; model: Item }>; year: number | null } | null>(null); const [openList, setOpenList] = useState(false);
  useEffect(() => { if (mode !== 'select') return; setBrand(''); setModel(''); setYear(''); setModels([]); setYears([]); api.get<{ brands: Item[] }>('/fipe/brands', { query: { vehicleType: vt } }).then((r) => setBrands(r.brands), (e) => setErr(errorMessage(e))); }, [mode, vt]);
  useEffect(() => {
    setYear(''); setYears([]);
    if (!brand) { setModel(''); return setModels([]); }
    const want = pending.current;
    if (!want) setModel('');
    api.get<{ models: Item[] }>('/fipe/models', { query: { vehicleType: vt, brandCode: brand } }).then((r) => { setModels(r.models); if (want) setModel(want.model); }, (e) => setErr(errorMessage(e)));
  }, [brand, vt]);
  useEffect(() => {
    setYear('');
    if (!brand || !model) return setYears([]);
    const want = pending.current;
    if (want && model !== want.model) return;
    pending.current = null;
    api.get<{ years: Item[] }>('/fipe/years', { query: { vehicleType: vt, brandCode: brand, modelCode: model } }).then((r) => {
      setYears(r.years);
      const m = want?.year ? r.years.filter((y) => y.name.startsWith(String(want.year))) : [];
      if (m.length === 1) setYear(m[0]!.code);
    }, (e) => setErr(errorMessage(e)));
  }, [model, brand, vt]);
  useEffect(() => {
    const text = q.trim();
    if (mode !== 'select' || text.length < 2) { setHits(null); return; }
    let alive = true;
    const t = setTimeout(() => { api.get<{ items: Array<{ brand: Item; model: Item }>; year: number | null }>('/fipe/search', { query: { vehicleType: vt, q: text } }).then((r) => { if (alive) setHits(r); }, () => { if (alive) setHits(null); }); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, vt, mode]);
  const pickHit = (h: { brand: Item; model: Item }, y: number | null) => {
    pending.current = { model: h.model.code, year: y };
    setOpenList(false); setQ(`${h.brand.name.replace(/^[A-Z]{2,4}\s+-\s+/, '')} ${h.model.name}`);
    if (brand === h.brand.code) { setModel(h.model.code); } else setBrand(h.brand.code);
  };

  async function submit() {
    setBusy(true); setErr(''); setQuote(null);
    trackFunnel('FIPE_FORM_SUBMITTED', { vehicleType: vt, hasVehicleDetails: mode === 'plate' });
    try {
      const body = mode === 'plate' ? { plate } : { vehicleType: vt, brand: brands.find((b) => b.code === brand), model: models.find((m) => m.code === model), year: years.find((y) => y.code === year) };
      const q = await api.post<Quote>('/fipe/quote', body);
      setQuote(q); trackFunnel('FIPE_RESULT_VIEWED', { vehicleType: q.vehicleType, referenceMonth: q.referenceMonth });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function pdf() {
    if (!quote) return;
    trackFunnel('FIPE_REPORT_ACTION', { action: 'pdf' });
    try { await api.download(`/fipe/reports/${quote.documentCode}/pdf`, `placa-na-mao-fipe-${quote.documentCode}.pdf`); } catch (e) { toast.error(errorMessage(e)); }
  }
  const ready = mode === 'plate' ? isValidPlate(plate) : Boolean(brand && model && year);
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">FIPE grátis</span><h1 style={{ maxWidth: '22ch' }}>Quanto vale o veículo? Consulte a Tabela FIPE.</h1><p className="lead">Gratuito, sem cadastro. Informe a placa ou escolha marca, modelo e ano e veja o valor médio de referência do mês.</p></div></section>
      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container" style={{ maxWidth: 860 }}>
          {!enabled && <Alert tone="warn" title="Consulta FIPE em ativação.">Esta consulta ainda não está disponível neste ambiente.</Alert>}
          <div className="card card-pad stack">
            <Tabs label="Forma de busca" value={mode} onChange={(m) => { setMode(m); setErr(''); }} items={[{ id: 'plate', label: 'Por placa' }, { id: 'select', label: 'Por marca e modelo' }]} />
            {mode === 'plate' ? (
              <div className="plate-input-wrap"><div className="plate-input"><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" aria-label="Placa" maxLength={8} autoComplete="off" autoCapitalize="characters" /></div></div>
            ) : (
              <div className="form-grid cols-2">
                <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
                  <Field label="Digite o veículo"><Input icon="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenList(true); }} onFocus={() => setOpenList(true)} placeholder="Ex.: Onix 2020, Civic, CG 160" autoComplete="off" maxLength={80} /></Field>
                  {openList && hits && hits.items.length > 0 && <ul className="vpicker-list" role="listbox">{hits.items.map((h) => <li key={`${h.brand.code}-${h.model.code}`} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); pickHit(h, hits.year); }}><b>{h.brand.name.replace(/^[A-Z]{2,4}\s+-\s+/, '')} {h.model.name}</b></li>)}</ul>}
                </div>
                <Field label="Tipo"><Select value={vt} onChange={(e) => setVt(e.target.value as VType)}><option value="cars">Carro</option><option value="motorcycles">Moto</option><option value="trucks">Caminhão</option></Select></Field>
                <Field label="Marca"><Select value={brand} onChange={(e) => setBrand(e.target.value)}><option value="">Selecione</option>{brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</Select></Field>
                <Field label="Modelo"><Select value={model} onChange={(e) => setModel(e.target.value)} disabled={!brand}><option value="">Selecione</option>{models.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</Select></Field>
                <Field label="Ano / combustível"><Select value={year} onChange={(e) => setYear(e.target.value)} disabled={!model}><option value="">Selecione</option>{years.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</Select></Field>
              </div>
            )}
            {err && <Alert tone="danger">{err}</Alert>}
            <div><Button variant="primary" size="lg" icon="search" disabled={!ready || !enabled} loading={busy} onClick={submit}>Consultar FIPE</Button></div>
          </div>

          {quote && (
            <div className="card card-pad fipe-result" style={{ marginTop: 22 }} aria-live="polite">
              <div className="row">{quote.plate && <PlateBadge plate={quote.plate} size="lg" />}<div><h2>{quote.brand.name} {quote.model.name}</h2><p className="muted">{quote.year.name}{quote.fuel ? ` · ${quote.fuel}` : ''} · Código FIPE {quote.fipeCode}</p></div></div>
              <div><span className="muted">Valor médio · referência {quote.referenceMonth}</span><div className="fipe-value num">{quote.valueLabel}</div>{quote.estimatedNegotiation && <p className="muted" style={{ fontSize: 14 }}>Faixa estimada de negociação: {money(quote.estimatedNegotiation.minCents)} a {money(quote.estimatedNegotiation.maxCents)}. {quote.estimatedNegotiation.disclaimer}</p>}</div>
              <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{quote.blocks.map((b) => <li key={b.key} className="alert"><Icon name="info" /><div><b>{b.label}.</b> {b.message}</div></li>)}</ul>
              <div className="row">
                {status === 'authed' ? <Button icon="download" onClick={pdf}>Baixar PDF</Button> : <Link className="btn" to="/entrar?next=/fipe"><Icon name="download" size={18} /> Entrar para baixar o PDF</Link>}
                <LinkButton to={`/consultar${quote.plate ? `?placa=${quote.plate}` : ''}`} variant="primary" iconRight="arrow-right">Ver situação do veículo (débitos e restrições)</LinkButton>
              </div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13, marginTop: 20 }}>A Tabela FIPE é uma referência de preço médio de mercado e não considera estado de conservação, quilometragem nem situação documental.</p>
        </div>
      </section>
    </>
  );
}
