import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../shared/icons';
import { api } from './api';

/* ---------- Tipos do Guia de veículos ---------- */
export interface SpecField { key: string; group: string; label: string; kind: 'number' | 'text' | 'bool'; unit?: string; better?: 'high' | 'low'; highlight?: boolean }
export interface RatingCategory { key: string; label: string }
export interface SpecMeta { groups: string[]; fields: SpecField[]; ratingCategories: RatingCategory[]; tipCategories: Array<{ key: string; label: string }> }
export interface RatingSummary { count: number; average: number | null; categories: Record<string, number | null>; distribution: Record<string, number> }
export type Specs = Record<string, string | number | boolean>;

export interface GuideCard { slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK'; bodyType: string | null; yearFrom: number | null; yearTo: number | null; summary: string; imageUrl: string | null; versions: number; ratingCount: number; ratingAverage: number | null }
export interface GuideVersion { id: string; name: string; yearModel: number | null; fuel: string | null; fipeCode?: string | null; specs?: Specs; highlights: Specs }
export interface GuideTip { id: string; category: string; categoryLabel: string; title: string; body: string }
export interface MyOpinion { id: string; rating: number; ratings: Record<string, number>; title: string; liked: string; disliked: string; comment: string; ownerSince: number | null; km: number | null; versionId: string | null; versionName: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rejectReason: string | null; createdAt: string }
export interface GuideModel {
  slug: string; brand: string; name: string; vehicleType: 'CAR' | 'MOTORCYCLE' | 'TRUCK'; bodyType: string | null; yearFrom: number | null; yearTo: number | null; summary: string; imageUrl: string | null;
  rating: RatingSummary; locked: boolean; pros: string[]; cons: string[]; versions: GuideVersion[];
  reviewPreview?: string; review?: string; buyerTips?: string; tips?: GuideTip[]; opinionCount?: number; myOpinion?: MyOpinion | null;
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

/* ---------- Capa (sem foto, usa ilustração por tipo) ---------- */
export function GuideCover({ imageUrl, alt, type }: { imageUrl: string | null; alt: string; type: string }) {
  return (
    <div className="guide-cover">
      {imageUrl ? <img src={imageUrl} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <Icon name={type === 'MOTORCYCLE' ? 'zap' : 'car'} size={46} />}
    </div>
  );
}

export function ModelCard({ m }: { m: GuideCard }) {
  return (
    <Link to={`/veiculos/${m.slug}`} className="guide-card">
      <GuideCover imageUrl={m.imageUrl} alt={`${m.brand} ${m.name}`} type={m.vehicleType} />
      <div className="guide-card-body">
        <span className="cat-tag">{m.brand}</span>
        <h3>{m.name}</h3>
        <p className="muted guide-meta">{[typeLabel(m.vehicleType), m.bodyType, yearsLabel(m.yearFrom, m.yearTo)].filter(Boolean).join(' · ')}</p>
        <div className="guide-rate"><Stars value={m.ratingAverage} size={16} /><span>{m.ratingCount ? `${ratingText(m.ratingAverage)} · ${m.ratingCount} ${m.ratingCount === 1 ? 'opinião' : 'opiniões'}` : 'Seja o primeiro a opinar'}</span></div>
        {m.summary && <p className="guide-sum">{m.summary}</p>}
        <span className="guide-more">{m.versions} {m.versions === 1 ? 'versão' : 'versões'} <Icon name="arrow-right" size={16} /></span>
      </div>
    </Link>
  );
}
