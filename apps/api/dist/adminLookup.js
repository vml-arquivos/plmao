import { executeVehicleLookup } from './vehicleLookup.js';
export async function performAdminLookup({ provider, plate, productId, productName, timeoutMs, normalize }) {
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
