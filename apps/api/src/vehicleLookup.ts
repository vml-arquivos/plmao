import type { NormalizedVehicle, VehicleDataProvider } from './types.js';

type LookupOutput = { providerQueryId?: string; raw: unknown };

type LookupInput = {
  provider: VehicleDataProvider;
  plate: string;
  timeoutMs: number;
  normalize: (raw: unknown) => NormalizedVehicle;
};

export async function executeVehicleLookup({ provider, plate, timeoutMs, normalize }: LookupInput): Promise<{ providerQueryId?: string; raw: unknown; normalized: NormalizedVehicle }> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('PROVIDER_TIMEOUT') as Error & { code: string };
      error.code = 'PROVIDER_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    const output = await Promise.race([provider.queryByPlate(plate) as Promise<LookupOutput>, timeoutPromise]);
    return { providerQueryId: output.providerQueryId, raw: output.raw, normalized: normalize(output.raw) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
