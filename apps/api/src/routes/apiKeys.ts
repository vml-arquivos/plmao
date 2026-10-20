import { createHash, randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config.js';
import { pool } from '../db.js';
import { auth, isTeamRole, type AuthUser } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';

const KEY_PREFIX = 'pnm_live_';
const MAX_ACTIVE_KEYS = 5;
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function requireEnabled(_req: Request, _res: Response, next: NextFunction) {
  if (!env.PUBLIC_API_ENABLED) return next(appError('PUBLIC_API_DISABLED', { code: 'NOT_FOUND', http: 404, expose: true }));
  next();
}

/** Gestão de chaves pelo cliente logado (a chave completa só aparece na criação). */
export const apiKeysRouter = Router();
apiKeysRouter.use(requireEnabled, auth, requirePermission('QUERY_VEHICLE'));

apiKeysRouter.get('/', asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,name,key_prefix,created_at,last_used_at FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC', [req.user!.id]);
  res.json(r.rows.map((k) => ({ id: k.id, name: k.name, prefix: k.key_prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at })));
}));

apiKeysRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(60) }).safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const active = await pool.query('SELECT count(*)::int AS n FROM api_keys WHERE user_id=$1 AND revoked_at IS NULL', [req.user!.id]);
  if (Number(active.rows[0].n) >= MAX_ACTIVE_KEYS) throw appError('API_KEY_LIMIT', { code: 'API_KEY_LIMIT', http: 409, expose: true });
  const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  const prefix = key.slice(0, KEY_PREFIX.length + 6);
  const r = await pool.query('INSERT INTO api_keys(user_id,name,key_prefix,key_hash) VALUES($1,$2,$3,$4) RETURNING id,created_at', [req.user!.id, parsed.data.name, prefix, hashKey(key)]);
  await audit(req.user!.id, 'API_KEY_CREATE', 'API_KEY', String(r.rows[0].id), { requestId: requestId(req), prefix });
  res.status(201).json({ id: r.rows[0].id, name: parsed.data.name, prefix, key, createdAt: r.rows[0].created_at, notice: 'Guarde esta chave agora: ela não será exibida novamente.' });
}));

apiKeysRouter.delete('/:id', asyncRoute(async (req, res) => {
  const r = await pool.query('UPDATE api_keys SET revoked_at=now(),active=false WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING key_prefix', [req.params.id, req.user!.id]);
  if (!r.rowCount) throw appError('API_KEY_NOT_FOUND', { code: 'API_KEY_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'API_KEY_REVOKE', 'API_KEY', String(req.params.id), { requestId: requestId(req) });
  res.status(204).end();
}));

/** Autenticação por chave (Authorization: Bearer pnm_live_… ou X-API-Key). Só contas de cliente. */
export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const raw = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!raw.startsWith(KEY_PREFIX) || raw.length < 24 || raw.length > 80) return res.status(401).json({ error: 'INVALID_API_KEY' });
    const r = await pool.query(`SELECT k.id AS key_id,k.last_used_at,u.id,u.email,u.name,u.role FROM api_keys k JOIN users u ON u.id=k.user_id
      WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND k.active=true`, [hashKey(raw)]);
    if (!r.rowCount) return res.status(401).json({ error: 'INVALID_API_KEY' });
    const row = r.rows[0] as { key_id: string; last_used_at: Date | null } & AuthUser;
    if (isTeamRole(row.role)) return res.status(403).json({ error: 'FORBIDDEN' });
    req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
    res.locals.apiKeyId = row.key_id;
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) void pool.query('UPDATE api_keys SET last_used_at=now() WHERE id=$1', [row.key_id]).catch(() => undefined);
    next();
  } catch (error) { next(error); }
}

export const apiKeyRateLimit = rateLimit({
  windowMs: 60_000, limit: env.PUBLIC_API_RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.res?.locals.apiKeyId ?? req.ip),
  skip: () => !env.RATE_LIMIT_ENABLED
});

export { requireEnabled as requirePublicApiEnabled };
