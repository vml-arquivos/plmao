import crypto from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminAllowedIps, adminHosts, env } from './config.js';
import { pool } from './db.js';
import { adminJwtSecret } from './lib/secrets.js';

export type AuthUser = { id: string; email: string; name: string; role: string };
export type Audience = 'client' | 'admin';
type TokenClaims = AuthUser & jwt.JwtPayload & { sid?: string; aud?: string };
declare global { namespace Express { interface Request { user?: AuthUser; sessionId?: string; audience?: Audience } } }

export const TEAM_ROLES = ['CONTEUDO', 'SUPORTE', 'OPERADOR', 'FINANCEIRO', 'ADMIN', 'SUPER_ADMIN'];
export function isTeamRole(role: string): boolean { return TEAM_ROLES.includes(role); }

function secretFor(audience: Audience): string {
  return audience === 'admin' ? adminJwtSecret() : env.JWT_SECRET;
}

export function signToken(user: AuthUser, sessionId: string | undefined, audience: Audience = 'client') {
  const payload = sessionId ? { ...user, sid: sessionId } : { ...user };
  return jwt.sign(payload, secretFor(audience), {
    audience,
    issuer: 'placanamao',
    expiresIn: (audience === 'admin' ? env.ADMIN_JWT_EXPIRES_IN : env.JWT_EXPIRES_IN) as jwt.SignOptions['expiresIn']
  });
}

export async function issueSession(user: AuthUser, metadata: Record<string, unknown> = {}, audience: Audience = 'client'): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const token = signToken(user, sessionId, audience);
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (typeof decoded?.exp !== 'number') throw new Error('SESSION_EXPIRY_UNAVAILABLE');
  await pool.query(`INSERT INTO user_sessions(id,user_id,expires_at,metadata,audience) VALUES($1,$2,to_timestamp($3),$4::jsonb,$5)`, [sessionId, user.id, decoded.exp, JSON.stringify(metadata), audience]);
  return { token, sessionId };
}

export async function revokeSession(sessionId?: string): Promise<void> {
  if (!sessionId) return;
  await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [sessionId]);
}

function bearer(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '') || undefined;
}

async function verify(req: Request, audience: Audience): Promise<{ user: AuthUser; sid: string | undefined } | { error: string; status: number }> {
  const token = bearer(req);
  if (!token) return { error: 'AUTH_REQUIRED', status: 401 };
  let claims: TokenClaims;
  try {
    claims = jwt.verify(token, secretFor(audience), { audience, issuer: 'placanamao' }) as TokenClaims;
  } catch {
    return { error: 'INVALID_TOKEN', status: 401 };
  }
  if (!claims.id || !claims.email || !claims.name || !claims.role) return { error: 'INVALID_TOKEN', status: 401 };
  if (audience === 'admin' && (!claims.sid || !isTeamRole(String(claims.role)))) return { error: 'INVALID_TOKEN', status: 401 };
  if (audience === 'client' && isTeamRole(String(claims.role))) return { error: 'INVALID_TOKEN', status: 401 };
  if (claims.sid) {
    const session = await pool.query(`SELECT s.metadata,s.audience,u.active,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at > now()`, [claims.sid, claims.id]);
    if (!session.rowCount) return { error: 'INVALID_TOKEN', status: 401 };
    const row = session.rows[0] as { metadata: Record<string, unknown> | null; audience: string; active: boolean; role: string };
    if (row.audience !== audience || !row.active) return { error: 'INVALID_TOKEN', status: 401 };
    // o papel vem SEMPRE do banco: rebaixamento de papel vale imediatamente, sem esperar o token expirar.
    if (audience === 'admin' && (!isTeamRole(row.role) || row.metadata?.totpVerified !== true)) return { error: 'TOTP_REQUIRED', status: 401 };
    claims.role = row.role;
  }
  return { user: { id: claims.id, email: claims.email, name: claims.name, role: claims.role }, sid: claims.sid };
}

/** Autenticação do app do cliente (audiência `client`). Tokens de equipe/admin são rejeitados. */
export async function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await verify(req, 'client');
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    req.user = result.user;
    req.sessionId = result.sid;
    req.audience = 'client';
    return next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

/** Como `auth`, mas sem exigir login: anexa `req.user` quando há token cliente válido e segue anônimo caso contrário. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    if (bearer(req)) {
      const result = await verify(req, 'client');
      if (!('error' in result)) { req.user = result.user; req.sessionId = result.sid; req.audience = 'client'; }
    }
  } catch { /* segue anônimo */ }
  next();
}

/** Autenticação do painel (audiência `admin`): segredo próprio, sessão com 2FA verificado, host e IP permitidos. */
export async function adminAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await verify(req, 'admin');
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    req.user = result.user;
    req.sessionId = result.sid;
    req.audience = 'admin';
    return next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

function hostOf(req: Request): string {
  return String(req.headers.host ?? '').toLowerCase();
}

export function isAdminHost(req: Request): boolean {
  const hosts = adminHosts();
  if (hosts.length === 0) return false;
  const host = hostOf(req);
  const bare = host.replace(/:\d+$/, '');
  return hosts.some((h) => h === host || h === bare || h.replace(/:\d+$/, '') === bare);
}

function ipToBigInt(ip: string): { v: 4 | 6; n: bigint } | null {
  const family = isIP(ip);
  if (family === 4) return { v: 4, n: ip.split('.').reduce((acc, part) => (acc << 8n) + BigInt(part), 0n) };
  if (family === 6) {
    const [head = '', tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const missing = 8 - h.length - t.length;
    const parts = ip.includes('::') ? [...h, ...Array(missing).fill('0'), ...t] : ip.split(':');
    return { v: 6, n: parts.reduce((acc, part) => (acc << 16n) + BigInt(`0x${part || '0'}`), 0n) };
  }
  return null;
}

export function ipAllowed(ip: string | undefined, allowList: string[]): boolean {
  if (allowList.length === 0) return true;
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  const target = ipToBigInt(normalized);
  if (!target) return false;
  return allowList.some((entry) => {
    const [base, bitsRaw] = entry.split('/');
    const net = ipToBigInt(base!.replace(/^::ffff:/, ''));
    if (!net || net.v !== target.v) return false;
    const total = net.v === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? total : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > total) return false;
    const shift = BigInt(total - bits);
    return (net.n >> shift) === (target.n >> shift);
  });
}

/**
 * Guarda de borda do painel: o admin só existe no(s) host(s) de ADMIN_HOSTS/ADMIN_URL e, se configurado,
 * somente para IPs de ADMIN_ALLOWED_IPS. Qualquer outro acesso recebe 404 (o painel não "existe" no domínio público).
 */
export function adminEdgeGuard(req: Request, res: Response, next: NextFunction) {
  const hosts = adminHosts();
  if (hosts.length > 0 && !isAdminHost(req)) return res.status(404).json({ error: 'NOT_FOUND' });
  if (!ipAllowed(req.ip, adminAllowedIps())) return res.status(404).json({ error: 'NOT_FOUND' });
  return next();
}

/** Em hosts de admin, somente a API admin, /health e o bundle admin são servidos. */
export function clientApiGuard(req: Request, res: Response, next: NextFunction) {
  if (isAdminHost(req)) return res.status(404).json({ error: 'NOT_FOUND' });
  return next();
}
