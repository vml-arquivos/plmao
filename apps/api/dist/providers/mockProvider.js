import { pool } from '../db.js';
function providerError(message, code, http) {
    const error = new Error(message);
    error.code = code;
    error.http = http;
    return error;
}
export class MockVehicleProvider {
    name = 'mock-bdrp';
    async queryByPlate(plate) {
        if (plate === 'TIM0E00') {
            await new Promise((resolve) => setTimeout(resolve, 120));
            throw providerError('PROVIDER_TIMEOUT', 'PROVIDER_TIMEOUT');
        }
        const result = await pool.query('SELECT raw_response FROM sandbox_vehicles WHERE plate=$1', [plate]);
        if (!result.rowCount) {
            throw providerError('PLACA_NAO_ENCONTRADA_SANDBOX', 'NOT_FOUND', 404);
        }
        return { providerQueryId: `MOCK-${crypto.randomUUID()}`, raw: result.rows[0].raw_response };
    }
}
