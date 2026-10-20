import { createApi } from '../shared/api';

export const TOKEN_KEY = 'pnm_token';
export const api = createApi({
  tokenKey: TOKEN_KEY,
  store: 'local',
  onUnauthorized: () => window.dispatchEvent(new CustomEvent('pnm:unauthorized'))
});

export type CellStatus = 'INCLUDED' | 'NOT_INCLUDED' | 'SOON';
export interface CatalogProduct {
  id: string; slug: string; name: string; tagline: string; description: string; longDescription: string; coverage?: string | null; priceCents: number; listPriceCents: number | null; discountPercent: number | null;
  badge: string | null; isFree: boolean; features: string[]; commercialStatus: 'ACTIVE' | 'SOON' | string; featured: boolean; showOnHome: boolean; matrix: Record<string, CellStatus>;
}
export interface CatalogFeature { id: string; key: string; label: string; description: string }
export interface CatalogPackage { slug: string; name: string; description: string; tagline: string; badge: string | null; highlights: string[]; credits: number; priceCents: number; bonusCents: number }
export interface Catalog { products: CatalogProduct[]; features: CatalogFeature[]; packages: CatalogPackage[]; paymentMethods: string[] }
export interface FaqItem { id: string; category: string; question: string; answer: string }
export interface ArticleSummary { id: string; slug: string; title: string; excerpt: string; category: string; tags: string[]; coverImageUrl: string | null; author: string; publishedAt: string; updatedAt: string; readingMinutes: number }
export interface ArticleFull extends ArticleSummary { body: string; seoTitle: string | null; seoDescription: string | null }
