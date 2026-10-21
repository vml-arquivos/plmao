import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../shared/icons';
import { Field, Input, Select } from '../shared/ui';
import { api } from './api';
import { funnelSessionId } from './funnel';

/* ---------- Tipos do Guia de veículos ---------- */
export interface SpecField { key: string; group: string; label: string; kind: 'number' | 'text' | 'bool'; unit?: string; better?: 'high' | 'low'; highlight?: boolean }
export interface RatingCategory { key: string; label: string }
export interface SpecMeta { groups: string[]; fields: SpecField[]; ratingCategories: RatingCategory[]; tipCategories: Array<{ key: string; label: string }> }
export interface RatingSummary { count: number; average: number | null; categories: Record<string, number | null>; distribution: Record<string, number> }
export type Specs = Record<string, string | number | boolean>;

export interface GuideCard {
  slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK'; bodyType: string | null; yearFrom: number | null; yearTo: number | null; summary: string; imageUrl: string | null; versions: number; ratingCount: number; ratingAverage: number | null;
  fuel: string | null; officialConsumption: boolean;
  imageCredit?: string | null; imageLicense?: string | null; imageSourceUrl?: string | null; fleet?: number | null;
  quick: { cityGasKml: number | null; cityEthKml: number | null; cityDieselKml: number | null; powerHp: number | null; trunkL: number | null };
}
export interface ConsumptionObs {
  id: string; versionId: string | null; versionName: string | null; versionLabel: string; propulsion: string | null; segment: string | null; fuel: string; cityKml: number | null; roadKml: number | null;
  cycle: string; sourceKind: 'INMETRO' | 'FABRICANTE' | 'OUTRA'; sourceName: string; sourceUrl: string; collectedAt: string; note: string;
}
export interface EconomyItem {
  versionId: string; slug: string; brand: string; model: string; version: string; yearModel: number | null; fuel: string | null; bodyType: string | null; official: boolean; source: string | null;
  cityGasKml: number | null; roadGasKml: number | null; cityEthKml: number | null; roadEthKml: number | null; cityDieselKml: number | null; roadDieselKml: number | null;
}
export interface GuideVersion { id: string; name: string; yearModel: number | null; fuel: string | null; fipeCode?: string | null; specs?: Specs; highlights: Specs }
export interface GuideTip { id: string; category: string; categoryLabel: string; title: string; body: string }
export interface MyOpinion { id: string; rating: number; ratings: Record<string, number>; title: string; liked: string; disliked: string; comment: string; ownerSince: number | null; km: number | null; versionId: string | null; versionName: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rejectReason: string | null; createdAt: string }
export interface GuideModel {
  slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK'; bodyType: string | null; yearFrom: number | null; yearTo: number | null; summary: string; imageUrl: string | null; specSource?: string | null;
  rating: RatingSummary; locked: boolean; pros: string[]; cons: string[]; versions: GuideVersion[];
  reviewPreview?: string; review?: string; buyerTips?: string; tips?: GuideTip[]; opinionCount?: number; myOpinion?: MyOpinion | null;
  consumption: ConsumptionObs[];
  fleet?: { total: number; names: number; snapshot: string } | null;
  imageCredit?: string | null; imageLicense?: string | null; imageSourceUrl?: string | null;
}
export interface FeaturedCardData {
  slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK'; bodyType: string | null; summary: string; imageUrl: string | null;
  imageCredit: string | null; imageLicense: string | null; imageSourceUrl: string | null;
  fleet: number | null; views: number; ratingCount: number; ratingAverage: number | null; officialConsumption: boolean; fuel: string | null; editorial: boolean;
}
export interface FeaturedList { key: 'FROTA' | 'CONSULTADOS' | 'AVALIADOS'; label: string; note: string; items: FeaturedCardData[] }
export interface CatalogHit {
  id: number; name: string; fleet: number; yearMin: number | null; yearMax: number | null; snapshot: string;
  guide: { slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK' } | null;
}
export interface CatalogSearch { snapshot: { id: string; names: number; fleet: number } | null; items: CatalogHit[] }
export interface CatalogDetail {
  id: number; name: string; fleet: number; yearMin: number | null; yearMax: number | null; snapshot: string; years: Array<{ year: number; quantity: number }>; withoutYear: number;
  source: { name: string; license: string; names: number; fleet: number } | null; guide: { slug: string; brand: string; name: string } | null;
}
export interface PublicOpinion { id: string; rating: number; ratings: Record<string, number>; title: string; liked: string; disliked: string; comment: string; ownerSince: number | null; km: number | null; versionName: string | null; createdAt: string; author: string }

/* ---------- Catálogo de campos (carrega uma vez) ---------- */
let metaCache: Promise<SpecMeta> | null = null;
export function loadSpecMeta(): Promise<SpecMeta> {
  if (!metaCache) metaCache = api.get<SpecMeta>('/vehicles/spec-fields').catch((e) => { metaCache = null; throw e; });
  return metaCache;
}
export function useSpecMeta(): SpecMeta | null {
  const [meta, setMeta] = useState<SpecMeta | null>(null);
  useEffect(() => { let alive = true; loadSpecMeta().then((m) => { if (alive) setMeta(m); }, () => undefined); return () => { alive = false; }; }, []);
  return meta;
}

/* ---------- Formatação ---------- */
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export function formatSpec(field: SpecField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field.kind === 'bool') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return `${nf.format(value)}${field.unit ? ` ${field.unit}` : ''}`;
  return String(value);
}
export const yearsLabel = (from: number | null, to: number | null) => (from ? (to && to !== from ? `${from}–${to}` : `${from}`) : '');
export const typeLabel = (t: string) => (t === 'MOTORCYCLE' ? 'Moto' : t === 'TRUCK' ? 'Caminhão' : 'Carro');
export const versionLabel = (v: { name: string; yearModel: number | null; fuel?: string | null }) => `${v.name}${v.yearModel ? ` · ${v.yearModel}` : ''}`;
export const ratingText = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

/* ---------- Estrelas e barras ---------- */
export function Stars({ value, size = 18, label }: { value: number | null; size?: number; label?: string }) {
  const v = value ?? 0;
  return (
    <span className="stars" role="img" aria-label={label ?? (value == null ? 'Sem avaliações' : `Nota ${ratingText(value)} de 5`)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className="star" style={{ width: size, height: size }}>
            <Icon name="star" size={size} className="star-bg" />
            <span className="star-fg" style={{ width: `${fill * 100}%` }}><Icon name="star" size={size} fill="currentColor" /></span>
          </span>
        );
      })}
    </span>
  );
}

/** Seletor de nota (1 a 5) acessível por teclado. */
export function StarPicker({ value, onChange, label, size = 28 }: { value: number; onChange: (v: number) => void; label: string; size?: number }) {
  return (
    <span className="star-picker" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`} className={n <= value ? 'on' : ''} onClick={() => onChange(value === n ? 0 : n)}>
          <Icon name="star" size={size} fill={n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

export function RatingBars({ rating, categories }: { rating: RatingSummary; categories: RatingCategory[] }) {
  return (
    <div className="rating-bars">
      {categories.map((c) => {
        const v = rating.categories[c.key];
        return (
          <div key={c.key} className="rating-row">
            <span>{c.label}</span>
            <span className="bar" aria-hidden="true"><i style={{ width: `${v == null ? 0 : (v / 5) * 100}%` }} /></span>
            <b>{ratingText(v ?? null)}</b>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Capa (com foto, ou um painel de marca quando ainda não há foto) ---------- */
const hueOf = (text: string) => { let h = 0; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const photoCredit = (credit?: string | null, license?: string | null) => (credit ? `Foto: ${credit}${license ? ` · ${license}` : ''}` : '');

export function GuideCover({ imageUrl, alt, type, brand, name, credit, license }: { imageUrl: string | null; alt: string; type: string; brand?: string; name?: string; credit?: string | null; license?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [imageUrl]);
  const show = imageUrl && !failed;
  const hue = hueOf(`${brand ?? ''}${name ?? ''}`);
  return (
    <div className={`guide-cover${show ? '' : ' no-photo'}`} style={show ? undefined : ({ '--cover-h': hue } as CSSProperties)}>
      {show ? <img src={imageUrl} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : (
        <>
          <Icon name={type === 'MOTORCYCLE' ? 'bike' : type === 'TRUCK' ? 'truck' : 'car'} size={44} />
          {name && <span className="cover-name" aria-hidden="true">{brand ? `${brand} ` : ''}{name}</span>}
        </>
      )}
      {show && credit && <span className="photo-credit">{photoCredit(credit, license)}</span>}
    </div>
  );
}

/* ---------- Números da frota e registro de interesse ---------- */
const nfInt = new Intl.NumberFormat('pt-BR');
export const fleetLong = (n: number) => nfInt.format(n);
export function fleetShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} mi`;
  if (n >= 1_000) return `${nfInt.format(Math.round(n / 1_000))} mil`;
  return String(n);
}
export const snapshotLabel = (id: string) => id.split('-').reverse().join('/');
export const fabYears = (min: number | null, max: number | null) => (min ? (max && max !== min ? `${min} a ${max}` : `${min}`) : 'sem ano informado');

/** Registra o que a pessoa escolheu (sem conta, sem dado pessoal): ajuda a saber quais veículos são procurados. */
export function logInterest(body: { type: 'SIMULATOR_PICK' | 'SEARCH_PICK' | 'MODEL_VIEW' | 'SEARCH_NO_RESULT'; catalogId?: number; modelSlug?: string; term?: string }): void {
  try {
    void fetch('/api/vehicles/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId: funnelSessionId() }), keepalive: true, cache: 'no-store' }).catch(() => undefined);
  } catch { /* métrica auxiliar */ }
}

/** Card de destaque: foto grande, nome, números reais e um clique para a ficha. */
export function FeaturedCard({ m, rank }: { m: FeaturedCardData; rank?: number }) {
  const meta = [typeLabel(m.vehicleType), m.bodyType, m.fuel].filter(Boolean).join(' · ');
  return (
    <Link to={`/veiculos/${m.slug}`} className="fcard">
      <div className="fcard-photo">
        <GuideCover imageUrl={m.imageUrl} alt={`${m.brand} ${m.name}`} type={m.vehicleType} brand={m.brand} name={m.name} credit={m.imageCredit} license={m.imageLicense} />
        {rank != null && <span className="fcard-rank" aria-label={`Posição ${rank}`}>{rank}</span>}
        {m.officialConsumption && <span className="official-tag fcard-official" title="Consumo conferido com a tabela oficial do Inmetro"><Icon name="check-circle" size={13} /> Inmetro</span>}
      </div>
      <div className="fcard-body">
        <span className="cat-tag">{m.brand}</span>
        <h3>{m.name}</h3>
        {meta && <p className="muted guide-meta">{meta}</p>}
        <div className="fcard-stats">
          {m.fleet != null && <span title="Veículos com esse nome na frota brasileira (Senatran), somando versões e anos"><Icon name="car" size={15} /><b>{fleetShort(m.fleet)}</b> na frota</span>}
          {m.ratingCount > 0 && <span className="guide-rate"><Stars value={m.ratingAverage} size={13} /><b>{ratingText(m.ratingAverage)}</b><span>({m.ratingCount})</span></span>}
        </div>
        <span className="fcard-cta">Ver ficha <Icon name="arrow-right" size={15} /></span>
      </div>
    </Link>
  );
}

/** Linha de veículo do catálogo da frota (ainda sem ficha no guia). */
export function CatalogRow({ hit, onPick }: { hit: CatalogHit; onPick?: () => void }) {
  return (
    <li className="crow">
      <Link to={`/veiculos/frota/${hit.id}`} onClick={onPick} className="crow-main">
        <b>{hit.name}</b>
        <small>{fleetLong(hit.fleet)} {hit.fleet === 1 ? 'veículo' : 'veículos'} na frota · fabricados {fabYears(hit.yearMin, hit.yearMax)}</small>
      </Link>
      <Link to={`/simulador?${new URLSearchParams({ n: hit.name.slice(0, 80) }).toString()}`} className="crow-act" onClick={onPick}>Simular financiamento <Icon name="arrow-right" size={14} /></Link>
    </li>
  );
}

export function ModelCard({ m }: { m: GuideCard }) {
  const q = m.quick;
  const facts: string[] = [];
  if (q.cityGasKml != null) facts.push(`${kmlText(q.cityGasKml)} km/l cidade`);
  else if (q.cityDieselKml != null) facts.push(`${kmlText(q.cityDieselKml)} km/l cidade (diesel)`);
  if (q.powerHp != null) facts.push(`${Math.round(q.powerHp)} cv`);
  if (q.trunkL != null) facts.push(`${Math.round(q.trunkL)} L de porta-malas`);
  return (
    <Link to={`/veiculos/${m.slug}`} className="vcard">
      {m.imageUrl && <GuideCover imageUrl={m.imageUrl} alt={`${m.brand} ${m.name}`} type={m.vehicleType} brand={m.brand} name={m.name} credit={m.imageCredit} license={m.imageLicense} />}
      <div className="vcard-body">
        <div className="vcard-top"><span className="cat-tag">{m.brand}</span>{m.officialConsumption && <span className="official-tag" title="Consumo conferido com a tabela oficial do Inmetro"><Icon name="check-circle" size={13} /> Inmetro</span>}</div>
        <h3>{m.name}</h3>
        <p className="muted guide-meta">{[typeLabel(m.vehicleType), m.bodyType, m.fuel].filter(Boolean).join(' · ')}</p>
        {facts.length > 0 && <ul className="vcard-facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>}
        <div className="vcard-foot">
          {m.ratingCount > 0 ? <span className="guide-rate"><Stars value={m.ratingAverage} size={14} /><b>{ratingText(m.ratingAverage)}</b><span>({m.ratingCount})</span></span> : <span />}
          <span className="guide-more">{m.versions} {m.versions === 1 ? 'versão' : 'versões'} <Icon name="arrow-right" size={15} /></span>
        </div>
      </div>
    </Link>
  );
}

/* ---------- Consumo: formatação, fontes e calculadora ---------- */
export const kmlText = (v: number) => v.toFixed(1).replace('.', ',');
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseNum = (t: string): number | null => { const n = Number(t.trim().replace(/\./g, '').replace(',', '.')); return t.trim() && Number.isFinite(n) && n > 0 ? n : null; };

let economyCache: Promise<EconomyItem[]> | null = null;
export function loadEconomy(): Promise<EconomyItem[]> {
  if (!economyCache) economyCache = api.get<{ items: EconomyItem[] }>('/vehicles/economy').then((r) => r.items).catch((e) => { economyCache = null; throw e; });
  return economyCache;
}
export function useEconomy(): { items: EconomyItem[] | null; error: boolean } {
  const [items, setItems] = useState<EconomyItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { let alive = true; loadEconomy().then((r) => { if (alive) setItems(r); }, () => { if (alive) setError(true); }); return () => { alive = false; }; }, []);
  return { items, error };
}

const sourceKindLabel = (k: ConsumptionObs['sourceKind']) => (k === 'INMETRO' ? 'Inmetro' : k === 'FABRICANTE' ? 'Fabricante' : 'Outra fonte');
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Cada fonte em linha própria: nada de média nem de "valor único". Barras só para ler rápido. */
export function ConsumptionSources({ items }: { items: ConsumptionObs[] }) {
  if (!items.length) return null;
  const max = Math.max(...items.flatMap((o) => [o.cityKml ?? 0, o.roadKml ?? 0]), 1);
  const notes = items.filter((o) => o.note);
  return (
    <div className="card card-pad stack" id="consumo-oficial">
      <div>
        <h2 style={{ fontSize: 22 }}>Consumo oficial e fontes</h2>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 14.5 }}>Valores de ensaio de homologação, em km/l. O consumo no dia a dia varia com trânsito, carga e estilo de condução. Quando duas fontes divulgam números diferentes, mostramos as duas, sem fazer média.</p>
      </div>
      <div className="table-scroll">
        <table className="obs-table">
          <thead><tr><th>Fonte e versão</th><th>Combustível</th><th>Cidade</th><th>Estrada</th></tr></thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td>
                  <b>{o.versionLabel}</b>
                  <div className="muted obs-src"><span className={`src-tag ${o.sourceKind.toLowerCase()}`}>{sourceKindLabel(o.sourceKind)}</span> {o.cycle}{o.propulsion ? ` · ${o.propulsion}` : ''}{o.segment ? ` · categoria ${o.segment}` : ''}</div>
                </td>
                <td>{o.fuel}</td>
                <td>{o.cityKml != null ? <span className="kml-cell"><b>{kmlText(o.cityKml)}</b><i className="kml-bar" style={{ width: `${(o.cityKml / max) * 100}%` }} aria-hidden="true" /></span> : <span className="muted">n/d</span>}</td>
                <td>{o.roadKml != null ? <span className="kml-cell"><b>{kmlText(o.roadKml)}</b><i className="kml-bar alt" style={{ width: `${(o.roadKml / max) * 100}%` }} aria-hidden="true" /></span> : <span className="muted">n/d</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.length > 0 && <ul className="obs-notes">{[...new Map(notes.map((o) => [`${o.versionLabel}|${o.note}`, o])).values()].map((o) => <li key={o.id}><b>{o.versionLabel}:</b> {o.note}</li>)}</ul>}
      <p className="muted spec-source">
        Fontes: {[...new Map(items.map((o) => [o.sourceUrl, o])).values()].map((o, i) => <span key={o.sourceUrl}>{i > 0 && '; '}<a href={o.sourceUrl} target="_blank" rel="noopener noreferrer">{o.sourceName}</a> ({hostOf(o.sourceUrl)}, consultado em {o.collectedAt.split('-').reverse().join('/')})</span>)}.
      </p>
    </div>
  );
}

type Mix = 'city' | 'mixed' | 'road';
const MIX_LABEL: Record<Mix, string> = { city: 'Só cidade', mixed: 'Misto (50/50)', road: 'Só estrada' };
/** Consumo combinado por distância (média harmônica). */
function combined(city: number | null, road: number | null, mix: Mix): number | null {
  if (mix === 'city') return city ?? null;
  if (mix === 'road') return road ?? null;
  if (city != null && road != null) return 2 / (1 / city + 1 / road);
  return city ?? road ?? null;
}

export function FuelCalc({ gas, eth, diesel, title = 'Quanto este carro gasta?', compact = false }: {
  gas?: { city: number | null; road: number | null }; eth?: { city: number | null; road: number | null }; diesel?: { city: number | null; road: number | null }; title?: string; compact?: boolean;
}) {
  const [km, setKm] = useState('1000');
  const [mix, setMix] = useState<Mix>('mixed');
  const [pg, setPg] = useState('');
  const [pe, setPe] = useState('');
  const [pd, setPd] = useState('');
  const cg = gas ? combined(gas.city, gas.road, mix) : null;
  const ce = eth ? combined(eth.city, eth.road, mix) : null;
  const cd = diesel ? combined(diesel.city, diesel.road, mix) : null;
  const kmN = parseNum(km);
  const priceG = parseNum(pg); const priceE = parseNum(pe); const priceD = parseNum(pd);
  const monthly = (c: number | null, price: number | null) => (c && price && kmN ? (kmN / c) * price : null);
  const costG = monthly(cg, priceG); const costE = monthly(ce, priceE); const costD = monthly(cd, priceD);
  const ratio = cg && ce ? ce / cg : null; // etanol compensa quando preço_etanol / preço_gasolina <= ratio
  const flex = cg != null && ce != null;
  let verdict: string | null = null;
  if (flex && costG != null && costE != null) {
    const diff = Math.abs(costG - costE);
    verdict = costE < costG ? `Etanol compensa: economiza ${brl(diff)} por mês.` : costE > costG ? `Gasolina compensa: economiza ${brl(diff)} por mês.` : 'Empate: custam o mesmo.';
  }
  if (!cg && !ce && !cd) return null;
  return (
    <div className={`card card-pad stack-sm fuel-calc${compact ? ' compact' : ''}`}>
      <h3>{title}</h3>
      <div className="form-grid cols-2">
        <Field label="Km por mês"><Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))} /></Field>
        <Field label="Uso"><Select value={mix} onChange={(e) => setMix(e.target.value as Mix)}>{(Object.keys(MIX_LABEL) as Mix[]).map((k) => <option key={k} value={k}>{MIX_LABEL[k]}</option>)}</Select></Field>
        {cg != null && <Field label="Gasolina (R$/litro)"><Input inputMode="decimal" value={pg} onChange={(e) => setPg(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} placeholder="preço no posto" /></Field>}
        {ce != null && <Field label="Etanol (R$/litro)"><Input inputMode="decimal" value={pe} onChange={(e) => setPe(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} placeholder="preço no posto" /></Field>}
        {cd != null && <Field label="Diesel (R$/litro)"><Input inputMode="decimal" value={pd} onChange={(e) => setPd(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))} placeholder="preço no posto" /></Field>}
      </div>
      {(costG != null || costE != null || costD != null) && (
        <div className="fuel-results" aria-live="polite">
          {costG != null && <div><span className="muted">Gasolina</span><b>{brl(costG)}</b><small>{kmN && cg ? `${Math.round(kmN / cg)} L por mês` : ''}</small></div>}
          {costE != null && <div><span className="muted">Etanol</span><b>{brl(costE)}</b><small>{kmN && ce ? `${Math.round(kmN / ce)} L por mês` : ''}</small></div>}
          {costD != null && <div><span className="muted">Diesel</span><b>{brl(costD)}</b><small>{kmN && cd ? `${Math.round(kmN / cd)} L por mês` : ''}</small></div>}
        </div>
      )}
      {verdict && <p className="fuel-verdict"><Icon name="check-circle" size={16} /> {verdict}</p>}
      {ratio != null && <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>Neste carro, o etanol só compensa se custar até <b>{(ratio * 100).toFixed(1).replace('.', ',')}%</b> do preço da gasolina{priceG ? <> (hoje, até <b>{brl(priceG * ratio)}</b> por litro)</> : null}. A regra dos 70% é só uma média: o ponto de equilíbrio muda de carro para carro.</p>}
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Cálculo com o consumo de ensaio do Inmetro/ficha do modelo. Os preços são os que você digita; o consumo real pode ser diferente.</p>
    </div>
  );
}
