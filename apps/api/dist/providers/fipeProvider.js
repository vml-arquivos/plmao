import { env } from '../config.js';
import { normalizeFipe } from '../normalizer.js';
function providerError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}
async function getJson(baseUrl, path, headers = {}) {
    let response;
    try {
        response = await fetch(new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`), {
            headers: { accept: 'application/json', ...headers },
            signal: AbortSignal.timeout(env.FIPE_REQUEST_TIMEOUT_MS)
        });
    }
    catch {
        throw providerError('FIPE_PROVIDER_TIMEOUT');
    }
    if (response.status === 404)
        throw providerError('FIPE_NOT_FOUND');
    if (response.status === 429)
        throw providerError('FIPE_RATE_LIMITED');
    if (!response.ok)
        throw providerError('FIPE_PROVIDER_UNAVAILABLE');
    const body = await response.json().catch(() => { throw providerError('FIPE_INVALID_RESPONSE'); });
    return body;
}
function asItems(value) {
    if (!Array.isArray(value))
        throw providerError('FIPE_INVALID_RESPONSE');
    return value.map((item) => ({
        code: String(item.code ?? item.codigo ?? item.codigoMarca ?? item.codigoModelo ?? item.codigoAno ?? '').trim(),
        name: String(item.name ?? item.nome ?? item.marca ?? item.modelo ?? item.ano ?? '').trim()
    })).filter((item) => item.code && item.name);
}
const primaryVehicleType = (type) => type;
const brasilVehicleType = (type) => type === 'cars' ? 'carros' : type === 'motorcycles' ? 'motos' : 'caminhoes';
export class ParallelumFipeProvider {
    name = 'parallelum';
    source = 'Parallelum/FIPE API v2';
    headers() {
        return env.FIPE_PRIMARY_TOKEN ? { 'X-Subscription-Token': env.FIPE_PRIMARY_TOKEN } : {};
    }
    async references() {
        return asItems((await getJson(env.FIPE_PRIMARY_BASE_URL, '/references', this.headers())).map((item) => ({ code: item.code, name: item.month })));
    }
    async latestReference() {
        const refs = await this.references();
        if (!refs[0])
            throw providerError('FIPE_REFERENCE_MISSING');
        return refs[0];
    }
    async brands(vehicleType, referenceCode) {
        const reference = referenceCode ?? (await this.latestReference()).code;
        return asItems(await getJson(env.FIPE_PRIMARY_BASE_URL, `/${primaryVehicleType(vehicleType)}/brands?reference=${encodeURIComponent(reference)}`, this.headers()));
    }
    async models(vehicleType, brand, referenceCode) {
        const reference = referenceCode ?? (await this.latestReference()).code;
        return asItems(await getJson(env.FIPE_PRIMARY_BASE_URL, `/${primaryVehicleType(vehicleType)}/brands/${encodeURIComponent(brand.code)}/models?reference=${encodeURIComponent(reference)}`, this.headers()));
    }
    async years(vehicleType, brand, model, referenceCode) {
        const reference = referenceCode ?? (await this.latestReference()).code;
        return asItems(await getJson(env.FIPE_PRIMARY_BASE_URL, `/${primaryVehicleType(vehicleType)}/brands/${encodeURIComponent(brand.code)}/models/${encodeURIComponent(model.code)}/years?reference=${encodeURIComponent(reference)}`, this.headers()));
    }
    async quote(input) {
        const reference = await this.latestReference();
        const raw = await getJson(env.FIPE_PRIMARY_BASE_URL, `/${primaryVehicleType(input.vehicleType)}/brands/${encodeURIComponent(input.brand.code)}/models/${encodeURIComponent(input.model.code)}/years/${encodeURIComponent(input.year.code)}?reference=${encodeURIComponent(reference.code)}`, this.headers());
        const normalized = normalizeFipe({ ...raw, provider: this.name, source: this.source, referenceCode: reference.code, brandCode: input.brand.code, modelCode: input.model.code, yearCode: input.year.code });
        return { ...normalized, cacheKey: `${this.name}:${input.vehicleType}:${input.brand.code}:${input.model.code}:${input.year.code}:${reference.code}` };
    }
}
export class BrasilApiFipeProvider {
    name = 'brasilapi';
    source = 'BrasilAPI FIPE';
    headers() {
        return env.FIPE_SECONDARY_TOKEN ? { authorization: `Bearer ${env.FIPE_SECONDARY_TOKEN}` } : {};
    }
    async references() {
        const body = await getJson(env.FIPE_SECONDARY_BASE_URL, '/fipe/tabelas/v1', this.headers());
        return asItems(body.map((item) => ({ code: item.codigo ?? item.code, name: item.mes ?? item.month }))).slice(0, 12);
    }
    async brands(vehicleType) {
        return asItems(await getJson(env.FIPE_SECONDARY_BASE_URL, `/fipe/marcas/v1/${brasilVehicleType(vehicleType)}`, this.headers()));
    }
    async models(vehicleType, brand) {
        return asItems(await getJson(env.FIPE_SECONDARY_BASE_URL, `/fipe/veiculos/v1/${brasilVehicleType(vehicleType)}/${encodeURIComponent(brand.code)}`, this.headers()));
    }
    async years(vehicleType, brand, model) {
        return asItems(await getJson(env.FIPE_SECONDARY_BASE_URL, `/fipe/anos/v1/${brasilVehicleType(vehicleType)}/${encodeURIComponent(brand.code)}/${encodeURIComponent(model.code)}`, this.headers()));
    }
    async quote(input) {
        const raw = await getJson(env.FIPE_SECONDARY_BASE_URL, `/fipe/detalhes/v1/${brasilVehicleType(input.vehicleType)}/${encodeURIComponent(input.brand.code)}/${encodeURIComponent(input.model.code)}/${encodeURIComponent(input.year.code)}`, this.headers());
        const normalized = normalizeFipe({ ...raw, provider: this.name, source: this.source, brandCode: input.brand.code, modelCode: input.model.code, yearCode: input.year.code, vehicleType: input.vehicleType === 'cars' ? 1 : input.vehicleType === 'motorcycles' ? 2 : 3 });
        return { ...normalized, cacheKey: `${this.name}:${input.vehicleType}:${input.brand.code}:${input.model.code}:${input.year.code}:${normalized.referenceMonth}` };
    }
}
export function getFipeProvider(name = 'parallelum') {
    return name === 'brasilapi' ? new BrasilApiFipeProvider() : new ParallelumFipeProvider();
}
export async function quoteWithFallback(input) {
    const preferred = input.provider ?? 'parallelum';
    try {
        return await getFipeProvider(preferred).quote(input);
    }
    catch (error) {
        if (preferred !== 'brasilapi')
            return getFipeProvider('brasilapi').quote(input);
        throw error;
    }
}
