import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { dataEncryptionKey } from './secrets.js';

/**
 * Criptografia em repouso do retorno bruto do provedor (contém CPF/CNPJ/nome em claro).
 * AES-256-GCM, IV aleatório de 12 bytes, tag de 16 bytes; formato `v1.<iv>.<tag>.<cipher>` (base64url).
 * O contexto entra como AAD, então um blob de um contexto não abre em outro.
 */
const CONTEXT = 'raw-provider-response';

export function encryptRaw(value: unknown, context = CONTEXT): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataEncryptionKey(context), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function decryptRaw<T = unknown>(blob: string, context = CONTEXT): T {
  const [version, iv, tag, body] = blob.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('RAW_BLOB_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', dataEncryptionKey(context), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as T;
}
