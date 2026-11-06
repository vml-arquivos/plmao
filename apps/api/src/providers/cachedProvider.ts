import type { VehicleDataProvider } from '../types.js';
import { pool } from '../db.js';
import { env } from '../config.js';
import { encryptRaw, decryptRaw } from '../lib/rawStore.js';
import { log } from '../lib/http.js';
import { sourcesSignature } from '../lib/dataSources.js';

const CONTEXT = 'plate-cache';
type Output = { providerQueryId?: string; raw: unknown };
const isRec = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Resposta incompleta (alguma consulta extra falhou ou ficou sem tempo): serve para esta consulta, mas não deve ser reaproveitada. */
export function isPartialResult(raw: unknown): boolean {
  if (!isRec(raw)) return true;
  if (raw.parcial === true) return true;
  return ['gravame', 'renajud', 'leilao'].some((k) => isRec(raw[k]) && (raw[k] as Record<string, unknown>).unavailable === true);
}

/**
 * Reaproveita a resposta paga da MESMA placa e do MESMO pacote por PLATE_CACHE_HOURS: quem consulta a placa de novo dentro
 * do prazo não gera nova cobrança do fornecedor. Guarda criptografado (a resposta tem CPF/CNPJ e nome), só respostas completas,
 * e apaga o que passou do prazo. Qualquer erro do cache cai na consulta normal.
 */
export function withPlateCache(provider: VehicleDataProvider, hours = env.PLATE_CACHE_HOURS): VehicleDataProvider {
  if (!(hours > 0)) return provider;
  const cached = async (plate: string, ctx?: { productId?: string; sources?: readonly string[] | null }): Promise<Output> => {
    // Fontes diferentes geram respostas diferentes: a assinatura entra na chave para não misturar configurações.
    const signature = sourcesSignature(ctx?.sources);
    const product = `${String(ctx?.productId ?? 'DEFAULT').toUpperCase()}${signature ? `#${signature}` : ''}`;
    const key = plate.toUpperCase();
    try {
      const hit = await pool.query<{ payload: string; provider_query_id: string | null }>(
        `SELECT payload, provider_query_id FROM provider_cache WHERE plate=$1 AND product_id=$2 AND provider=$3 AND created_at > now() - make_interval(hours => $4::int)`,
        [key, product, provider.name, hours]
      );
      if (hit.rowCount) {
        const raw = decryptRaw<unknown>(hit.rows[0]!.payload, CONTEXT);
        log('info', 'plate_cache_hit', { product });
        return { ...(hit.rows[0]!.provider_query_id ? { providerQueryId: hit.rows[0]!.provider_query_id } : {}), raw };
      }
    } catch (e) {
      log('warn', 'plate_cache_read_failed', { message: e instanceof Error ? e.message : 'erro' });
    }
    const out = await provider.queryByPlate(plate, ctx);
    if (!isPartialResult(out.raw)) {
      try {
        await pool.query(
          `INSERT INTO provider_cache(plate,product_id,provider,payload,provider_query_id,created_at) VALUES($1,$2,$3,$4,$5,now())
           ON CONFLICT (plate,product_id,provider) DO UPDATE SET payload=EXCLUDED.payload, provider_query_id=EXCLUDED.provider_query_id, created_at=now()`,
          [key, product, provider.name, encryptRaw(out.raw, CONTEXT), out.providerQueryId ?? null]
        );
        await pool.query(`DELETE FROM provider_cache WHERE created_at < now() - make_interval(hours => $1::int)`, [hours * 2]);
      } catch (e) {
        log('warn', 'plate_cache_write_failed', { message: e instanceof Error ? e.message : 'erro' });
      }
    }
    return out;
  };
  return new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'queryByPlate') return cached;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}
