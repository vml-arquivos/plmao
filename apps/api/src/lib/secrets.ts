import { hkdfSync } from 'node:crypto';
import { env } from '../config.js';

/** Segredo de JWT do painel admin. Em produção é obrigatório e distinto (config.ts); fora dela deriva do JWT_SECRET. */
export function adminJwtSecret(): string {
  if (env.ADMIN_JWT_SECRET) return env.ADMIN_JWT_SECRET;
  return Buffer.from(hkdfSync('sha256', Buffer.from(env.JWT_SECRET), Buffer.from('placanamao-admin-jwt'), Buffer.from('admin audience v1'), 48)).toString('base64url');
}

/** Chave AES-256 (32 bytes) para dados em repouso. */
export function dataEncryptionKey(context: string): Buffer {
  const ikm = Buffer.from(env.DATA_ENCRYPTION_KEY ?? env.JWT_SECRET, 'utf8');
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from('placanamao-data-salt'), Buffer.from(`placanamao data encryption v1:${context}`), 32));
}
