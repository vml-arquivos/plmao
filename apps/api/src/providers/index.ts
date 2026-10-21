import { env } from '../config.js';
import { MockVehicleProvider } from './mockProvider.js';
import { CredifyVehicleProvider } from './credifyProvider.js';
import { ContractedVehicleProvider } from './contractedVehicleProvider.js';
import type { VehicleDataProvider } from '../types.js';

export function getProvider(): VehicleDataProvider {
  if (env.DATA_PROVIDER === 'real') return env.VEHICLE_API_PROVIDER === 'credify' ? new CredifyVehicleProvider() : new ContractedVehicleProvider();
  // 'disabled' = sistema no ar sem fonte de dados contratada: consultas pagas ficam "em breve" e nada é cobrado.
  if (env.DATA_PROVIDER === 'disabled' || env.NODE_ENV === 'production') {
    const error = new Error('DATA_PROVIDER_NOT_CONFIGURED') as Error & { code: string };
    error.code = 'DATA_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return new MockVehicleProvider();
}
