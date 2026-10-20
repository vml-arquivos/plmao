export type NormalizedVehicle = {
  identification: { plate:string; renavam?:string; chassis?:string; engine?:string; gearbox?:string; brand?:string; model?:string; fullModel?:string };
  characteristics: { manufactureYear?:string; modelYear?:string; color?:string; fuel?:string; power?:string; displacement?:string; type?:string; species?:string; category?:string; body?:string; axles?:string; passengers?:string; loadCapacity?:string; origin?:string };
  registration: { city?:string; state?:string; licensingDate?:string; licensingYear?:string; status?:string };
  owner: { name?:string; document?:string; documentType?:string };
  debts: { key:string; label:string; amountCents:number; hasDebt:boolean }[];
  restrictions: { key:string; label:string; status:string; alert:boolean }[];
  recall?:string;
  coverage?: { identification: 'FOUND' | 'NOT_QUERIED'; debts: 'FOUND' | 'NOT_QUERIED'; restrictions: 'FOUND' | 'NOT_QUERIED'; recall: 'FOUND' | 'NOT_QUERIED' };
};

export type FipeVehicleType = 'cars' | 'motorcycles' | 'trucks';
export type InformationState = 'FOUND' | 'CLEAR' | 'NOT_QUERIED' | 'NOT_AVAILABLE' | 'PARTIAL' | 'PROVIDER_ERROR' | 'STALE';

export type FipeSelectionItem = { code: string; name: string };

export type FipeVehicleDetails = {
  plate: string;
  brand?: string;
  model?: string;
  fullModel?: string;
  manufactureYear?: string;
  modelYear?: string;
  color?: string;
  fuel?: string;
  power?: string;
  displacement?: string;
  type?: string;
  species?: string;
  category?: string;
  body?: string;
  passengers?: string;
  loadCapacity?: string;
  origin?: string;
  city?: string;
  state?: string;
  licensingYear?: string;
  status?: string;
};

export type FipeQuote = {
  documentCode: string;
  reportHash: string;
  provider: string;
  source: string;
  consultedAt: string;
  referenceMonth: string;
  referenceCode?: string;
  vehicleType: FipeVehicleType;
  brand: FipeSelectionItem;
  model: FipeSelectionItem;
  year: FipeSelectionItem;
  fuel?: string;
  modelYear?: number;
  fipeCode: string;
  valueCents: number;
  valueLabel: string;
  estimatedNegotiation?: { minCents: number; maxCents: number; disclaimer: string };
  blocks: Array<{ key: string; label: string; state: InformationState; message: string }>;
  plate?: string;
  vehicleDetails?: FipeVehicleDetails;
};

export type FipeProviderResult = Omit<FipeQuote, 'documentCode' | 'reportHash' | 'blocks' | 'estimatedNegotiation' | 'plate'> & {
  cacheKey: string;
};

export interface VehicleDataProvider {
  name: string;
  queryByPlate(plate: string): Promise<{ providerQueryId?: string; raw: unknown }>;
}

export interface FipeProvider {
  readonly name: string;
  readonly source: string;
  quote(input: { vehicleType: FipeVehicleType; brand: FipeSelectionItem; model: FipeSelectionItem; year: FipeSelectionItem }): Promise<FipeProviderResult>;
}

export interface VehicleIdentityProvider { readonly name: string; }
export interface RestrictionsProvider { readonly name: string; }
export interface GravameProvider { readonly name: string; }
export interface DebtsProvider { readonly name: string; }
export interface RecallProvider { readonly name: string; }
export interface HistoryProvider { readonly name: string; }
