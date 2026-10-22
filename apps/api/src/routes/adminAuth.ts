import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { adminAuth, isTeamRole, issueSession, revokeSession, type AuthUser } from '../auth.js';
import { env } from '../config.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { beginTotpSetup, completeTotpEnrollment, completeTotpLogin, disableTotp, enableTotp, startAdminTotpStep } from '../lib/totpFlow.js';
import { permissionsFor } from '../permissions.js';
import { createTrustedDevice, listTrustedDevices, revokeAllTrustedDevices, revokeTrustedDevice, useTrustedDevice } from '../lib/trustedDevices.js';

const deviceTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{30,100}$/);
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128), deviceToken: deviceTokenSchema.optional() }).strict();
const challengeSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().min(6).max(16), trustDevice: z.boolean().optional() }).strict();
const enrollSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) }).strict();

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
  if (step.totpRequired === 'NONE') {
    // 2FA opcional e desligado nesta conta: a senha basta.
    await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    const issued = await issueSession(user, { flow: 'admin_password_login', requestId: requestId(req), totpVerified: false }, 'admin');
    await audit(user.id, 'ADMIN_LOGIN', 'USER', user.id, { requestId: requestId(req), twoFactor: false });
    return res.json({ totpRequired: 'NONE', token: issued.token, user, permissions: permissionsFor(user.role) });
  }
  if (step.totpRequired === 'VERIFY' && parsed.data.deviceToken && await useTrustedDevice(user.id, parsed.data.deviceToken)) {
    // Computador marcado como confiável: o código não é pedido de novo.
    await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
    const issued = await issueSession(user, { flow: 'admin_trusted_device', requestId: requestId(req), totpVerified: true }, 'admin');
    await audit(user.id, 'ADMIN_LOGIN', 'USER', user.id, { requestId: requestId(req), twoFactor: 'trusted_device' });
    return res.json({ totpRequired: 'NONE', token: issued.token, user, permissions: permissionsFor(user.role), trusted: true });
  }
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
  const deviceToken = parsed.data.trustDevice ? await createTrustedDevice(user.id, req.get('user-agent')) : null;
  res.json({ token: issued.token, user, permissions: permissionsFor(user.role), ...(deviceToken ? { deviceToken } : {}) });
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
  const totp = await pool.query('SELECT 1 FROM team_totp WHERE user_id=$1 AND enabled_at IS NOT NULL', [req.user!.id]);
  const fresh = await pool.query('SELECT name FROM users WHERE id=$1', [req.user!.id]);
  res.json({ user: { ...req.user, name: String(fresh.rows[0]?.name ?? req.user!.name) }, permissions: permissionsFor(req.user!.role), recoveryCodesRemaining: Number(recovery.rows[0]?.remaining ?? 0), totpEnabled: Boolean(totp.rowCount), totpRequired: env.TEAM_TOTP_REQUIRED, trustedDeviceDays: env.TEAM_TRUSTED_DEVICE_DAYS });
}));

// 2FA opcional: a própria pessoa liga e desliga o aplicativo autenticador em "Minha conta".
adminAuthRouter.post('/totp/setup', limiter, adminAuth, asyncRoute(async (req, res) => {
  const setup = await beginTotpSetup(req.user!);
  await audit(req.user!.id, 'ADMIN_TOTP_SETUP_STARTED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.json({ setup });
}));

adminAuthRouter.post('/totp/enable', limiter, adminAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict().safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const { recoveryCodes } = await enableTotp(req.user!.id, req.sessionId, parsed.data.code);
  await audit(req.user!.id, 'ADMIN_TOTP_ENABLED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.json({ recoveryCodes });
}));

adminAuthRouter.post('/totp/disable', limiter, adminAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(16) }).strict().safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  if (env.TEAM_TOTP_REQUIRED) throw appError('TOTP_REQUIRED_BY_POLICY', { code: 'TOTP_REQUIRED_BY_POLICY', http: 403, expose: true });
  const result = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [req.user!.id]);
  if (!result.rowCount || !(await bcrypt.compare(parsed.data.password, String(result.rows[0].password_hash)))) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  await disableTotp(req.user!.id, req.sessionId, parsed.data.code);
  await revokeAllTrustedDevices(req.user!.id);
  await audit(req.user!.id, 'ADMIN_TOTP_DISABLED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

adminAuthRouter.post('/logout', adminAuth, asyncRoute(async (req, res) => {
  await revokeSession(req.sessionId);
  await audit(req.user!.id, 'ADMIN_LOGOUT', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

// Dados pessoais: só a própria pessoa altera (ninguém, nem quem está acima, edita o nome de outro).
const profileSchema = z.object({ name: z.string().trim().min(2).max(120) }).strict();
adminAuthRouter.patch('/profile', adminAuth, asyncRoute(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  await pool.query('UPDATE users SET name=$2 WHERE id=$1', [req.user!.id, parsed.data.name]);
  await audit(req.user!.id, 'ADMIN_PROFILE_UPDATED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.json({ user: { ...req.user, name: parsed.data.name } });
}));

adminAuthRouter.post('/change-password', adminAuth, asyncRoute(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [req.user!.id]);
  if (!result.rowCount || !(await bcrypt.compare(parsed.data.currentPassword, String(result.rows[0].password_hash)))) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  await pool.query('UPDATE users SET password_hash=$2,password_enabled=true WHERE id=$1', [req.user!.id, await bcrypt.hash(parsed.data.newPassword, 12)]);
  await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id <> $2 AND revoked_at IS NULL', [req.user!.id, req.sessionId ?? '']);
  await revokeAllTrustedDevices(req.user!.id);
  await audit(req.user!.id, 'ADMIN_PASSWORD_CHANGED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

// Computadores confiáveis da própria pessoa.
adminAuthRouter.get('/devices', adminAuth, asyncRoute(async (req, res) => {
  res.json({ items: await listTrustedDevices(req.user!.id) });
}));
adminAuthRouter.delete('/devices', adminAuth, asyncRoute(async (req, res) => {
  await revokeAllTrustedDevices(req.user!.id);
  await audit(req.user!.id, 'ADMIN_TRUSTED_DEVICES_CLEARED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));
adminAuthRouter.delete('/devices/:id', adminAuth, asyncRoute(async (req, res) => {
  const id = String(req.params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await revokeTrustedDevice(req.user!.id, id))) throw appError('NOT_FOUND', { code: 'NOT_FOUND', http: 404, expose: true });
  res.status(204).end();
}));
