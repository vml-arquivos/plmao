import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config.js';
import { pool, tx } from '../db.js';
import { isEmailConfigured, sendPasswordResetEmail } from '../email.js';
import { appError, log } from './http.js';

/** Mesmo formato do fluxo "esqueci a senha": só o hash do token fica no banco. */
export const resetTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Falha cedo, antes de criar qualquer coisa, quando não há como enviar e-mail. */
export function assertEmailConfigured(): void {
  if (!isEmailConfigured()) throw appError('PASSWORD_RESET_UNAVAILABLE', { code: 'PASSWORD_RESET_UNAVAILABLE', http: 503, expose: true });
}

/**
 * Manda para a pessoa um link para ela mesma criar a nova senha. Quem pede (admin) nunca vê nem define a senha.
 * Devolve `false` se o envio falhar; o link gerado é descartado nesse caso.
 */
export async function sendResetLink(user: { id: string; email: string; name: string }, ttlMinutes: number = env.PASSWORD_RESET_TTL_MINUTES): Promise<boolean> {
  assertEmailConfigured();
  const token = randomBytes(48).toString('base64url');
  const hash = resetTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await tx(async (client) => {
    await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [user.id]);
    await client.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,$3)', [user.id, hash, expiresAt]);
  });
  try {
    await sendPasswordResetEmail({ to: user.email, name: user.name, token, ttlMinutes });
    return true;
  } catch (error) {
    await pool.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [hash]);
    log('warn', 'password_reset_link_failed', { userId: user.id, reason: error instanceof Error ? error.message : 'unknown' });
    return false;
  }
}
