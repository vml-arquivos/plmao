import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config.js';
import { pool } from '../db.js';

/**
 * Computadores confiáveis do painel: depois de confirmar o código uma vez, a pessoa pode marcar "confiar neste computador"
 * e o código deixa de ser pedido nele. O token fica só no aparelho; aqui guardamos apenas o hash.
 * Cada uso renova o prazo. Desativar o 2FA ou trocar a senha remove todos.
 */
const hash = (token: string) => createHash('sha256').update(`${env.JWT_SECRET}:device:${token}`).digest('hex');

export async function createTrustedDevice(userId: string, userAgent: string | undefined): Promise<string | null> {
  const days = env.TEAM_TRUSTED_DEVICE_DAYS;
  if (days <= 0) return null;
  const token = randomBytes(36).toString('base64url');
  await pool.query(
    `INSERT INTO admin_trusted_devices(user_id,token_hash,label,expires_at) VALUES($1,$2,$3, now() + ($4 || ' days')::interval)`,
    [userId, hash(token), (userAgent ?? '').replace(/\s+/g, ' ').slice(0, 160) || null, String(days)]
  );
  return token;
}

/** Confere o token do aparelho e, se valer, renova o prazo. */
export async function useTrustedDevice(userId: string, token: string): Promise<boolean> {
  const days = env.TEAM_TRUSTED_DEVICE_DAYS;
  if (days <= 0) return false;
  const r = await pool.query(
    `UPDATE admin_trusted_devices SET last_used_at=now(), expires_at=now() + ($3 || ' days')::interval
      WHERE user_id=$1 AND token_hash=$2 AND expires_at > now() RETURNING id`, [userId, hash(token), String(days)]);
  return Boolean(r.rowCount);
}

export async function listTrustedDevices(userId: string) {
  const r = await pool.query(`SELECT id,label,created_at,last_used_at,expires_at FROM admin_trusted_devices WHERE user_id=$1 AND expires_at > now() ORDER BY coalesce(last_used_at,created_at) DESC LIMIT 20`, [userId]);
  return r.rows.map((x) => ({ id: String(x.id), label: x.label as string | null, createdAt: x.created_at, lastUsedAt: x.last_used_at, expiresAt: x.expires_at }));
}

export async function revokeTrustedDevice(userId: string, id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM admin_trusted_devices WHERE user_id=$1 AND id=$2', [userId, id]);
  return Boolean(r.rowCount);
}

export async function revokeAllTrustedDevices(userId: string): Promise<void> {
  await pool.query('DELETE FROM admin_trusted_devices WHERE user_id=$1', [userId]);
}
