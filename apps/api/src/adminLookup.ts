import { executeVehicleLookup } from './vehicleLookup.js';
import type { NormalizedVehicle, VehicleDataProvider } from './types.js';

type AdminLookupInput = {
  provider: VehicleDataProvider;
  plate: string;
  productId: string;
  productName: string;
  timeoutMs: number;
  normalize: (raw: unknown) => NormalizedVehicle;
};

export type AdminLookupResult = {
  plate: string;
  productId: string;
  productName: string;
  provider: string;
  providerQueryId?: string;
  consultedAt: string;
  result: NormalizedVehicle;
  /** Resposta bruta da fonte: só para guardar cifrada junto da consulta; nunca vai para a resposta da API. */
  raw?: unknown;
};

export async function performAdminLookup({ provider, plate, productId, productName, timeoutMs, normalize }: AdminLookupInput): Promise<AdminLookupResult> {
  const output = await executeVehicleLookup({ provider, plate, productId, timeoutMs, normalize });
  return {
    plate,
    productId,
    productName,
    provider: provider.name,
    providerQueryId: output.providerQueryId,
    consultedAt: new Date().toISOString(),
    result: output.normalized,
    raw: output.raw
  };
}
