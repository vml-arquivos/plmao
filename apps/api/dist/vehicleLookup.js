export async function executeVehicleLookup({ provider, plate, timeoutMs, normalize }) {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            const error = new Error('PROVIDER_TIMEOUT');
            error.code = 'PROVIDER_TIMEOUT';
            reject(error);
        }, timeoutMs);
    });
    try {
        const output = await Promise.race([provider.queryByPlate(plate), timeoutPromise]);
        return { providerQueryId: output.providerQueryId, raw: output.raw, normalized: normalize(output.raw) };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
