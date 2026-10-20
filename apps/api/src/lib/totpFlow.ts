import { createHash, randomBytes } from 'node:crypto';
import { pool, tx } from '../db.js';
import type { AuthUser } from '../auth.js';
import { appError } from './http.js';
import { env } from '../config.js';
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSetup, hashRecoveryCode, verifyTotpCode } from '../totp.js';

export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${env.JWT_SECRET}:${ip}`).digest('hex');
}

function challengeHash(challenge: string): string {
  return createHash('sha256').update(challenge).digest('hex');
}

async function createAuthChallenge(userId: string, kind: 'TOTP_LOGIN' | 'TOTP_ENROLL', ip: string): Promise<string> {
  const challenge = randomBytes(48).toString('base64url');
  await pool.query(`INSERT INTO auth_challenges(user_id,kind,token_hash,expires_at,ip_hash) VALUES($1,$2,$3,now()+interval '10 minutes',$4)`, [userId, kind, challengeHash(challenge), hashIp(ip)]);
  return challenge;
}

/** Passo 2 do login do painel: verificação (conta já tem TOTP) ou cadastro (primeiro acesso). Nunca emite sessão sem TOTP. */
export async function startAdminTotpStep(user: AuthUser, ip: string): Promise<Record<string, unknown>> {
  const existing = await pool.query('SELECT enabled_at FROM team_totp WHERE user_id=$1', [user.id]);
  if (existing.rowCount && existing.rows[0].enabled_at) {
    const challenge = await createAuthChallenge(user.id, 'TOTP_LOGIN', ip);
    return { totpRequired: 'VERIFY', challenge, expiresInSeconds: 600 };
  }
  const setup = generateTotpSetup(user.email);
  await pool.query(`INSERT INTO team_totp(user_id,encrypted_secret,enabled_at) VALUES($1,$2,NULL)
    ON CONFLICT(user_id) DO UPDATE SET encrypted_secret=EXCLUDED.encrypted_secret,enabled_at=NULL,updated_at=now()`, [user.id, encryptTotpSecret(setup.secret)]);
  const challenge = await createAuthChallenge(user.id, 'TOTP_ENROLL', ip);
  return { totpRequired: 'ENROLL', challenge, setup, expiresInSeconds: 600 };
}

export async function completeTotpEnrollment(challenge: string, code: string): Promise<{ user: AuthUser; recoveryCodes: string[] }> {
  return tx(async (client) => {
    const found = await client.query(`SELECT c.id,c.user_id,u.id AS uid,u.email,u.name,u.role,t.encrypted_secret
      FROM auth_challenges c JOIN users u ON u.id=c.user_id JOIN team_totp t ON t.user_id=u.id
      WHERE c.token_hash=$1 AND c.kind='TOTP_ENROLL' AND c.used_at IS NULL AND c.expires_at>now() AND u.active=true FOR UPDATE OF c`, [challengeHash(challenge)]);
    if (!found.rowCount) throw appError('TOTP_CHALLENGE_INVALID', { code: 'TOTP_CHALLENGE_INVALID', http: 401, expose: true });
    const row = found.rows[0] as Record<string, unknown>;
    let valid = false;
    try { valid = verifyTotpCode(decryptTotpSecret(String(row.encrypted_secret)), code); } catch { valid = false; }
    if (!valid) throw appError('TOTP_CODE_INVALID', { code: 'TOTP_CODE_INVALID', http: 401, expose: true });
    const recoveryCodes = generateRecoveryCodes();
    await client.query('UPDATE team_totp SET enabled_at=now(),last_verified_at=now(),updated_at=now() WHERE user_id=$1', [row.user_id]);
    await client.query('DELETE FROM team_totp_recovery_codes WHERE user_id=$1', [row.user_id]);
    for (const recoveryCode of recoveryCodes) await client.query('INSERT INTO team_totp_recovery_codes(user_id,code_hash) VALUES($1,$2)', [row.user_id, hashRecoveryCode(recoveryCode)]);
    await client.query('UPDATE auth_challenges SET used_at=now() WHERE id=$1', [row.id]);
    return { user: { id: String(row.uid), email: String(row.email), name: String(row.name), role: String(row.role) } as AuthUser, recoveryCodes };
  });
}

export async function completeTotpLogin(challenge: string, code: string): Promise<{ user: AuthUser; recoveryCodeUsed: boolean }> {
  return tx(async (client) => {
    const found = await client.query(`SELECT c.id,c.user_id,u.id AS uid,u.email,u.name,u.role,t.encrypted_secret,t.enabled_at
      FROM auth_challenges c JOIN users u ON u.id=c.user_id LEFT JOIN team_totp t ON t.user_id=u.id
      WHERE c.token_hash=$1 AND c.kind='TOTP_LOGIN' AND c.used_at IS NULL AND c.expires_at>now() AND u.active=true FOR UPDATE OF c`, [challengeHash(challenge)]);
    if (!found.rowCount) throw appError('TOTP_CHALLENGE_INVALID', { code: 'TOTP_CHALLENGE_INVALID', http: 401, expose: true });
    const row = found.rows[0] as Record<string, unknown>;
    if (!row.encrypted_secret || !row.enabled_at) throw appError('TOTP_ENROLLMENT_REQUIRED', { code: 'TOTP_ENROLLMENT_REQUIRED', http: 403, expose: true });
    let valid = false;
    let recoveryCodeUsed = false;
    try { valid = verifyTotpCode(decryptTotpSecret(String(row.encrypted_secret)), code); } catch { valid = false; }
    if (!valid) {
      const recovery = await client.query(`SELECT id FROM team_totp_recovery_codes WHERE user_id=$1 AND used_at IS NULL AND code_hash=$2 LIMIT 1 FOR UPDATE`, [row.user_id, hashRecoveryCode(code)]);
      if (!recovery.rowCount) throw appError('TOTP_CODE_INVALID', { code: 'TOTP_CODE_INVALID', http: 401, expose: true });
      await client.query('UPDATE team_totp_recovery_codes SET used_at=now() WHERE id=$1', [recovery.rows[0].id]);
      recoveryCodeUsed = true;
    }
    await client.query('UPDATE auth_challenges SET used_at=now() WHERE id=$1', [row.id]);
    await client.query('UPDATE team_totp SET last_verified_at=now() WHERE user_id=$1', [row.user_id]);
    return { user: { id: String(row.uid), email: String(row.email), name: String(row.name), role: String(row.role) } as AuthUser, recoveryCodeUsed };
  });
}
