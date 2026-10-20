import { pool } from '../db.js';
import type { VehicleDataProvider } from '../types.js';

type ProviderFailure = Error & { code?: string; http?: number };

function providerError(message: string, code: string, http?: number): ProviderFailure {
  const error = new Error(message) as ProviderFailure;
  error.code = code;
  error.http = http;
  return error;
}

export class MockVehicleProvider implements VehicleDataProvider {
  name = 'mock-bdrp';

  async queryByPlate(plate: string) {
    if (plate === 'TIM0E00') {
      await new Promise((resolve) => setTimeout(resolve, 120));
      throw providerError('PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT');
    }

    const result = await pool.query('SELECT raw_response FROM sandbox_vehicles WHERE plate=$1', [plate]);
    if (!result.rowCount) {
      throw providerError('PLACA_NAO_ENCONTRADA_SANDBOX', 'NOT_FOUND', 404);
    }

    return { providerQueryId: `MOCK-${crypto.randomUUID()}`, raw: result.rows[0].raw_response as unknown };
  }
}
