import { env } from '../config.js';
import { MockVehicleProvider } from './mockProvider.js';
import { ContractedVehicleProvider } from './contractedVehicleProvider.js';
import type { VehicleDataProvider } from '../types.js';

export function getProvider(): VehicleDataProvider {
  if (env.DATA_PROVIDER === 'real') return new ContractedVehicleProvider();
  if (env.NODE_ENV === 'production') {
    const error = new Error('DATA_PROVIDER_NOT_CONFIGURED') as Error & { code: string };
    error.code = 'DATA_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return new MockVehicleProvider();
}
