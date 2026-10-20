import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './config.js';
import { pool } from './db.js';

export type AuthUser = { id: string; email: string; name: string; role: string };
type TokenClaims = AuthUser & jwt.JwtPayload & { sid?: string };
declare global { namespace Express { interface Request { user?: AuthUser; sessionId?: string } } }

export function signToken(user: AuthUser, sessionId?: string) {
  return jwt.sign(sessionId ? { ...user, sid: sessionId } : user, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export async function issueSession(user: AuthUser, metadata: Record<string, unknown> = {}): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const expiresAt = jwt.decode(signToken(user, sessionId)) as jwt.JwtPayload | null;
  if (typeof expiresAt?.exp !== 'number') throw new Error('SESSION_EXPIRY_UNAVAILABLE');
  await pool.query(`INSERT INTO user_sessions(id,user_id,expires_at,metadata)
    VALUES($1,$2,to_timestamp($3),$4::jsonb)`, [sessionId, user.id, expiresAt.exp, JSON.stringify(metadata)]);
  return { token: signToken(user, sessionId), sessionId };
}

export async function revokeSession(sessionId?: string): Promise<void> {
  if (!sessionId) return;
  await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [sessionId]);
}

export async function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const claims = jwt.verify(token, env.JWT_SECRET) as TokenClaims;
    if (!claims.id || !claims.email || !claims.name || !claims.role) return res.status(401).json({ error: 'INVALID_TOKEN' });
    if (['OPERADOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(claims.role)) && !claims.sid) return res.status(401).json({ error: 'INVALID_TOKEN' });
    if (claims.sid) {
      const session = await pool.query(`SELECT metadata FROM user_sessions
        WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > now()`, [claims.sid, claims.id]);
      if (!session.rowCount) return res.status(401).json({ error: 'INVALID_TOKEN' });
      const metadata = (session.rows[0]?.metadata ?? {}) as Record<string, unknown>;
      if (env.TEAM_TOTP_REQUIRED && ['OPERADOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(claims.role)) && metadata.totpVerified !== true) return res.status(401).json({ error: 'TOTP_REQUIRED' });
      req.sessionId = claims.sid;
    }
    req.user = { id: claims.id, email: claims.email, name: claims.name, role: claims.role };
    return next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
