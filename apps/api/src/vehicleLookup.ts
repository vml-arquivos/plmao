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
  productId?: string;
  /** Completa a resposta do provedor (ex.: histórico da FIPE). Nunca deve lançar; se lançar, a consulta segue sem o complemento. */
  enrich?: (raw: unknown) => Promise<unknown>;
  timeoutMs: number;
  normalize: (raw: unknown) => NormalizedVehicle;
};

export async function executeVehicleLookup({ provider, plate, searchType = 'PLATE', productId, enrich, timeoutMs, normalize }: LookupInput): Promise<{ providerQueryId?: string; raw: unknown; normalized: NormalizedVehicle; timing: { providerMs: number; enrichMs: number; normalizeMs: number } }> {
  const t0 = Date.now();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error('PROVIDER_TIMEOUT') as Error & { code: string };
      error.code = 'PROVIDER_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    const call = searchType === 'PLATE' ? provider.queryByPlate(plate, { productId }) : provider.queryBy!(searchType, plate);
    const output = await Promise.race([call as Promise<LookupOutput>, timeoutPromise]);
    const t1 = Date.now();
    let raw = output.raw;
    if (enrich && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const extra = await Promise.race([enrich(raw).catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000).unref())]);
      if (extra) raw = { ...(raw as Record<string, unknown>), enrichment: extra };
    }
    const t2 = Date.now();
    const normalized = normalize(raw);
    return { providerQueryId: output.providerQueryId, raw, normalized, timing: { providerMs: t1 - t0, enrichMs: t2 - t1, normalizeMs: Date.now() - t2 } };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
