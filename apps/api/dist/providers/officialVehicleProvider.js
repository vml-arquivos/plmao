import { env } from '../config.js';
function providerError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}
function queryId(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const object = raw;
    for (const key of ['id', 'requestId', 'request_id', 'queryId', 'consultaId']) {
        if (typeof object[key] === 'string' && object[key].trim())
            return object[key].trim();
    }
    for (const key of ['response', 'data', 'result', 'resultado', 'dados']) {
        const nested = queryId(object[key]);
        if (nested)
            return nested;
    }
    return undefined;
}
function isProviderError(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return false;
    const object = raw;
    return object.error === true || object.erro === true || object.success === false || object.sucesso === false;
}
/**
 * Adapter for an authorized vehicle-data provider. The endpoint and method are
 * runtime configuration so the existing contracted provider remains compatible,
 * while APIBrasil can use POST /consulta/veiculos/credits with a JSON body.
 */
export class OfficialVehicleProvider {
    name = 'official';
    async queryByPlate(plate) {
        if (!env.VEHICLE_API_BASE_URL || !env.VEHICLE_API_QUERY_PATH)
            throw providerError('DATA_PROVIDER_NOT_CONFIGURED');
        const bearerToken = env.APIBRASIL_BEARER_TOKEN ?? env.VEHICLE_API_TOKEN;
        if (env.VEHICLE_API_AUTH_SCHEME === 'bearer' && !bearerToken)
            throw providerError('DATA_PROVIDER_NOT_CONFIGURED');
        if (env.VEHICLE_API_AUTH_SCHEME === 'basic' && (!env.VEHICLE_API_LOGIN || !env.VEHICLE_API_PASSWORD))
            throw providerError('DATA_PROVIDER_NOT_CONFIGURED');
        const path = env.VEHICLE_API_QUERY_PATH.replaceAll('{plate}', encodeURIComponent(plate));
        const url = new URL(path.startsWith('/') ? path.slice(1) : path, `${env.VEHICLE_API_BASE_URL.replace(/\/$/, '')}/`);
        const authorization = env.VEHICLE_API_AUTH_SCHEME === 'basic'
            ? `Basic ${Buffer.from(`${env.VEHICLE_API_LOGIN}:${env.VEHICLE_API_PASSWORD}`).toString('base64')}`
            : `Bearer ${bearerToken}`;
        const headers = { accept: 'application/json', authorization };
        const deviceToken = env.VEHICLE_API_DEVICE_TOKEN ?? env.APIBRASIL_DEVICE_TOKEN;
        if (deviceToken)
            headers.DeviceToken = deviceToken;
        const init = { method: env.VEHICLE_API_QUERY_METHOD.toUpperCase(), headers, signal: AbortSignal.timeout(env.VEHICLE_API_TIMEOUT_MS) };
        if (env.VEHICLE_API_QUERY_METHOD === 'post') {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify({ placa: plate });
        }
        let response;
        try {
            response = await fetch(url, init);
        }
        catch {
            throw providerError('PROVIDER_TIMEOUT');
        }
        if (response.status === 404 || response.status === 410)
            throw providerError('NOT_FOUND');
        if (response.status === 401 || response.status === 403)
            throw providerError('DATA_PROVIDER_AUTH_FAILED');
        if (response.status === 408 || response.status === 429)
            throw providerError('DATA_PROVIDER_RATE_LIMITED');
        if (response.status === 402)
            throw providerError('DATA_PROVIDER_QUOTA_EXHAUSTED');
        if (!response.ok)
            throw providerError('DATA_PROVIDER_UNAVAILABLE');
        const raw = await response.json().catch(() => { throw providerError('DATA_PROVIDER_INVALID_RESPONSE'); });
        if (isProviderError(raw))
            throw providerError('DATA_PROVIDER_INVALID_RESPONSE');
        // The queried plate is trusted input, not a vehicle attribute inferred from
        // the provider. Keeping it at the root also supports providers that omit it.
        return { providerQueryId: queryId(raw), raw: { placa: plate, data: raw } };
    }
}
