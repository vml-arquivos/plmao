import { createApi } from '../shared/api';

export const TOKEN_KEY = 'pnm_token';
export const api = createApi({
  tokenKey: TOKEN_KEY,
  store: 'local',
  onUnauthorized: () => window.dispatchEvent(new CustomEvent('pnm:unauthorized'))
});

export interface CatalogProduct { id: string; slug: string; name: string; description: string; coverage?: unknown; priceCents: number; isFree: boolean; features: string[] | null; commercialStatus: 'ACTIVE' | 'SOON' | string; featured: boolean }
export interface CatalogPackage { slug: string; name: string; description: string; credits: number; priceCents: number; bonusCents: number }
export interface Catalog { products: CatalogProduct[]; packages: CatalogPackage[]; paymentMethods: string[] }
