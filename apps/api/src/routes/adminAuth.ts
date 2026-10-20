import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { adminAuth, isTeamRole, issueSession, revokeSession, type AuthUser } from '../auth.js';
import { env } from '../config.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { completeTotpEnrollment, completeTotpLogin, startAdminTotpStep } from '../lib/totpFlow.js';
import { permissionsFor } from '../permissions.js';

const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();
const challengeSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().min(6).max(16) }).strict();
const enrollSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) }).strict();

const limiter = rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.LOGIN_RATE_LIMIT_MAX, standardHeaders: true, legacyHeaders: false, skip: () => !env.RATE_LIMIT_ENABLED, message: { error: 'TOO_MANY_REQUESTS' } });

export const adminAuthRouter = Router();

adminAuthRouter.post('/login', limiter, asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  const result = await pool.query('SELECT id,email,password_hash,name,role,active,password_enabled,failed_login_attempts,locked_until FROM users WHERE lower(email)=lower($1)', [parsed.data.email]);
  const account = result.rows[0] as Record<string, unknown> | undefined;
  const lockedUntil = account?.locked_until ? new Date(String(account.locked_until)) : undefined;
  const isLocked = Boolean(lockedUntil && lockedUntil.getTime() > Date.now());
  const passwordMatches = account ? await bcrypt.compare(parsed.data.password, String(account.password_hash)) : false;
  const eligible = Boolean(account && account.active && account.password_enabled === true && isTeamRole(String(account.role)));
  if (!account || !eligible || isLocked || !passwordMatches) {
    if (account?.id) {
      const failures = Number(account.failed_login_attempts ?? 0) + 1;
      await pool.query('UPDATE users SET failed_login_attempts=$2, locked_until=$3 WHERE id=$1', [account.id, failures >= 5 ? 0 : failures, failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null]);
    }
    await audit(account?.id ? String(account.id) : null, 'ADMIN_LOGIN_FAILURE', 'USER', account?.id ? String(account.id) : null, { requestId: requestId(req), eligible });
    throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  }
  const user: AuthUser = { id: String(account.id), email: String(account.email), name: String(account.name), role: String(account.role) };
  await pool.query('UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1', [user.id]);
  const step = await startAdminTotpStep(user, req.ip ?? 'unknown');
  await audit(user.id, 'ADMIN_LOGIN_PASSWORD_OK', 'USER', user.id, { requestId: requestId(req), step: step.totpRequired });
  res.json({ user: { name: user.name, email: user.email }, ...step });
}));

adminAuthRouter.post('/totp/verify', limiter, asyncRoute(async (req, res) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const { user, recoveryCodeUsed } = await completeTotpLogin(parsed.data.challenge, parsed.data.code);
  if (!isTeamRole(user.role)) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  const issued = await issueSession(user, { flow: 'admin_totp_login', requestId: requestId(req), totpVerified: true }, 'admin');
  await audit(user.id, 'ADMIN_LOGIN', 'USER', user.id, { requestId: requestId(req), recoveryCodeUsed });
  res.json({ token: issued.token, user, permissions: permissionsFor(user.role) });
}));

adminAuthRouter.post('/totp/enroll/confirm', limiter, asyncRoute(async (req, res) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const enrolled = await completeTotpEnrollment(parsed.data.challenge, parsed.data.code);
  if (!isTeamRole(enrolled.user.role)) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [enrolled.user.id]);
  const issued = await issueSession(enrolled.user, { flow: 'admin_totp_enrollment', requestId: requestId(req), totpVerified: true }, 'admin');
  await audit(enrolled.user.id, 'ADMIN_TOTP_ENROLLED', 'USER', enrolled.user.id, { requestId: requestId(req) });
  res.json({ token: issued.token, user: enrolled.user, permissions: permissionsFor(enrolled.user.role), recoveryCodes: enrolled.recoveryCodes });
}));

adminAuthRouter.get('/me', adminAuth, asyncRoute(async (req, res) => {
  const recovery = await pool.query('SELECT count(*)::int AS remaining FROM team_totp_recovery_codes WHERE user_id=$1 AND used_at IS NULL', [req.user!.id]);
  res.json({ user: req.user, permissions: permissionsFor(req.user!.role), recoveryCodesRemaining: Number(recovery.rows[0]?.remaining ?? 0) });
}));

adminAuthRouter.post('/logout', adminAuth, asyncRoute(async (req, res) => {
  await revokeSession(req.sessionId);
  await audit(req.user!.id, 'ADMIN_LOGOUT', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

adminAuthRouter.post('/change-password', adminAuth, asyncRoute(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [req.user!.id]);
  if (!result.rowCount || !(await bcrypt.compare(parsed.data.currentPassword, String(result.rows[0].password_hash)))) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  await pool.query('UPDATE users SET password_hash=$2,password_enabled=true WHERE id=$1', [req.user!.id, await bcrypt.hash(parsed.data.newPassword, 12)]);
  await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id <> $2 AND revoked_at IS NULL', [req.user!.id, req.sessionId ?? '']);
  await audit(req.user!.id, 'ADMIN_PASSWORD_CHANGED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));
