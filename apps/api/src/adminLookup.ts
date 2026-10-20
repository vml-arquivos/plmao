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
};

export async function performAdminLookup({ provider, plate, productId, productName, timeoutMs, normalize }: AdminLookupInput): Promise<AdminLookupResult> {
  const output = await executeVehicleLookup({ provider, plate, timeoutMs, normalize });
  return {
    plate,
    productId,
    productName,
    provider: provider.name,
    providerQueryId: output.providerQueryId,
    consultedAt: new Date().toISOString(),
    result: output.normalized
  };
}
