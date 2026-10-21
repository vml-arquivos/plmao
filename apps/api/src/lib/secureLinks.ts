import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config.js';
import { pool } from '../db.js';

/**
 * Links seguros e expiráveis para contratos e documentos fiscais.
 * O token só existe no e-mail/na tela de quem o recebe; no banco fica apenas o hash.
 */
export type LinkPurpose = 'CONTRACT_SIGN' | 'CONTRACT_VIEW' | 'FISCAL_DOCUMENT';
export interface SecureLinkRow { id: string; purpose: LinkPurpose; resource_type: string; resource_id: string; recipient_email: string | null; expires_at: Date; uses: number; max_uses: number }

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type Db = Pick<PoolClient, 'query'>;

export async function createSecureLink(input: { purpose: LinkPurpose; resourceType: string; resourceId: string; recipientEmail?: string | null; ttlHours?: number; maxUses?: number; createdBy?: string | null }, db: Db = pool): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const ttl = input.ttlHours ?? env.SECURE_LINK_TTL_HOURS;
  const r = await db.query(
    `INSERT INTO secure_links(token_hash,purpose,resource_type,resource_id,recipient_email,expires_at,max_uses,created_by)
     VALUES($1,$2,$3,$4,$5,now() + make_interval(hours => $6::int),$7,$8) RETURNING id,expires_at`,
    [hashToken(token), input.purpose, input.resourceType, input.resourceId, input.recipientEmail ?? null, ttl, input.maxUses ?? 10, input.createdBy ?? null]
  );
  return { id: r.rows[0].id as string, token, expiresAt: r.rows[0].expires_at as Date };
}

/** Valida e conta um uso de forma atômica. Devolve null para token inexistente, expirado, revogado ou esgotado. */
export async function consumeSecureLink(token: string, purposes: LinkPurpose[], db: Db = pool): Promise<SecureLinkRow | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const r = await db.query(
    `UPDATE secure_links SET uses=uses+1,last_used_at=now()
     WHERE token_hash=$1 AND purpose = ANY($2::text[]) AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses
     RETURNING id,purpose,resource_type,resource_id,recipient_email,expires_at,uses,max_uses`, [hashToken(token), purposes]);
  return r.rowCount ? (r.rows[0] as SecureLinkRow) : null;
}

/** Consulta sem consumir uso (ex.: validar antes de exibir um formulário). */
export async function peekSecureLink(token: string, purposes: LinkPurpose[], db: Db = pool): Promise<SecureLinkRow | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const r = await db.query(
    `SELECT id,purpose,resource_type,resource_id,recipient_email,expires_at,uses,max_uses FROM secure_links
     WHERE token_hash=$1 AND purpose = ANY($2::text[]) AND revoked_at IS NULL AND expires_at > now() AND uses < max_uses`, [hashToken(token), purposes]);
  return r.rowCount ? (r.rows[0] as SecureLinkRow) : null;
}

export async function revokeSecureLinks(resourceType: string, resourceId: string, db: Db = pool): Promise<number> {
  const r = await db.query(`UPDATE secure_links SET revoked_at=now() WHERE resource_type=$1 AND resource_id=$2 AND revoked_at IS NULL`, [resourceType, resourceId]);
  return r.rowCount ?? 0;
}
