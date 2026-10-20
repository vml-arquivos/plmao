import { env } from '../config.js';
import { MockVehicleProvider } from './mockProvider.js';
import { OfficialVehicleProvider } from './officialVehicleProvider.js';
export function getProvider() {
    if (env.DATA_PROVIDER === 'real')
        return new OfficialVehicleProvider();
    if (env.NODE_ENV === 'production') {
        const error = new Error('DATA_PROVIDER_NOT_CONFIGURED');
        error.code = 'DATA_PROVIDER_NOT_CONFIGURED';
        throw error;
    }
    return new MockVehicleProvider();
}
