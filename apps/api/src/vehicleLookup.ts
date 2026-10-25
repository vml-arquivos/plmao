import type { NormalizedVehicle, VehicleDataProvider } from './types.js';
import type { SearchType } from './searchKey.js';

type LookupOutput = { providerQueryId?: string; raw: unknown };

/** A placa é atendida por toda fonte; os demais tipos dependem do que o provedor declara. */
export function providerSupports(provider: VehicleDataProvider, type: SearchType): boolean {
  if (type === 'PLATE') return true;
  return Boolean(provider.queryBy && provider.supportedSearchTypes?.includes(type));
}

type LookupInput = {
  provider: VehicleDataProvider;
  plate: string;
  searchType?: SearchType;
  timeoutMs: number;
  normalize: (raw: unknown) => NormalizedVehicle;
};

export async function executeVehicleLookup({ provider, plate, searchType = 'PLATE', timeoutMs, normalize }: LookupInput): Promise<{ providerQueryId?: string; raw: unknown; normalized: NormalizedVehicle }> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('PROVIDER_TIMEOUT') as Error & { code: string };
      error.code = 'PROVIDER_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    const call = searchType === 'PLATE' ? provider.queryByPlate(plate) : provider.queryBy!(searchType, plate);
    const output = await Promise.race([call as Promise<LookupOutput>, timeoutPromise]);
    return { providerQueryId: output.providerQueryId, raw: output.raw, normalized: normalize(output.raw) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
