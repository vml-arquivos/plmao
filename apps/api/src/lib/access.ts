import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { pool } from '../db.js';
import { appError } from './http.js';

/**
 * Acessos por conta. Toda conta de cliente tem estes recursos liberados; o administrador pode desligar um deles para uma conta.
 * Só um "false" explícito desliga: conta sem nada guardado continua com tudo liberado, como era antes.
 * A loja (área do lojista, vitrine) não entra aqui: ela vem da própria loja da conta, que o administrador ativa à parte.
 */
export const ACCESS_FEATURES = ['GARAGE', 'WATCHES'] as const;
export type AccessFeature = (typeof ACCESS_FEATURES)[number];
export type AccessMap = Record<AccessFeature, boolean>;
export const ACCESS_LABEL: Record<AccessFeature, string> = { GARAGE: 'Minha garagem', WATCHES: 'Monitoramento de placas' };

export function isAccessFeature(v: unknown): v is AccessFeature { return typeof v === 'string' && (ACCESS_FEATURES as readonly string[]).includes(v); }

/** Lê o que está guardado e completa com o padrão (tudo liberado). Chaves desconhecidas são ignoradas. */
export function resolveAccess(stored: unknown): AccessMap {
  const src = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  return Object.fromEntries(ACCESS_FEATURES.map((f) => [f, src[f] !== false])) as AccessMap;
}

export async function loadAccess(userId: string): Promise<AccessMap> {
  const r = await pool.query('SELECT access_overrides FROM users WHERE id=$1', [userId]);
  return resolveAccess(r.rows[0]?.access_overrides);
}

/** Barra o recurso quando o administrador o desligou para esta conta. Usar depois do login. */
export function requireFeature(feature: AccessFeature): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    (async () => {
      if (!req.user) throw appError('Faça login.', { code: 'INVALID_TOKEN', http: 401, expose: true });
      const access = await loadAccess(req.user.id);
      if (!access[feature]) throw appError(`${ACCESS_LABEL[feature]} não está liberado para a sua conta. Fale com o suporte.`, { code: 'FEATURE_DISABLED', http: 403, expose: true, showMessage: true });
    })().then(() => next(), next);
  };
}
