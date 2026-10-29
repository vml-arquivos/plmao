import { pool } from '../db.js';
import type { VehicleDataProvider } from '../types.js';
import type { SearchType } from '../searchKey.js';

type ProviderFailure = Error & { code?: string; http?: number };

function providerError(message: string, code: string, http?: number): ProviderFailure {
  const error = new Error(message) as ProviderFailure;
  error.code = code;
  error.http = http;
  return error;
}

export class MockVehicleProvider implements VehicleDataProvider {
  name = 'mock-bdrp';
  readonly supportedSearchTypes: readonly SearchType[] = ['PLATE', 'CHASSIS'];

  /** Ambiente de teste: o chassi fictício de cada placa de exemplo (ex.: 9ZZSANDBXXDEV1B11). */
  async queryBy(type: SearchType, value: string) {
    if (type !== 'CHASSIS' || !/^[A-Z0-9]{8,17}$/.test(value)) throw providerError('SEARCH_TYPE_NOT_SUPPORTED', 'SEARCH_TYPE_NOT_SUPPORTED');
    const result = await pool.query('SELECT raw_response FROM sandbox_vehicles WHERE raw_response::text LIKE $1 LIMIT 1', [`%"CHASSI": "${value}"%`]);
    if (!result.rowCount) throw providerError('PLACA_NAO_ENCONTRADA_SANDBOX', 'NOT_FOUND', 404);
    return { providerQueryId: `MOCK-${crypto.randomUUID()}`, raw: result.rows[0].raw_response as unknown };
  }

  async queryByPlate(plate: string) {
    if (plate === 'TIM0E00') {
      await new Promise((resolve) => setTimeout(resolve, 120));
      throw providerError('PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT');
    }

    // Ambiente de teste: fonte lenta (a consulta passa do tempo de espera da tela e termina em segundo plano).
    if (plate === 'SLW0E00') {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const slow = await pool.query('SELECT raw_response FROM sandbox_vehicles ORDER BY plate LIMIT 1');
      return { providerQueryId: `MOCK-${crypto.randomUUID()}`, raw: slow.rows[0].raw_response as unknown };
    }

    const result = await pool.query('SELECT raw_response FROM sandbox_vehicles WHERE plate=$1', [plate]);
    if (!result.rowCount) {
      throw providerError('PLACA_NAO_ENCONTRADA_SANDBOX', 'NOT_FOUND', 404);
    }

    return { providerQueryId: `MOCK-${crypto.randomUUID()}`, raw: result.rows[0].raw_response as unknown };
  }
}
