import type { Pool, PoolClient } from 'pg';
import type { PixKeyType } from './pix.js';

type Db = Pick<Pool | PoolClient, 'query'>;

/**
 * Grava a chave PIX do usuário no perfil e espelha no cadastro de parceiro/indicação dele (usada para o repasse).
 * `force`: o próprio parceiro informou a chave para receber, vale no lugar da que estava. `fill`: só preenche se o parceiro ainda não tem chave
 * ou tinha a mesma chave antiga do perfil (não apaga uma chave que a equipe tenha digitado à mão).
 */
export async function saveUserPix(db: Db, userId: string, pix: { key: string; type: PixKeyType } | null, mode: 'force' | 'fill'): Promise<void> {
  const old = (await db.query('SELECT pix_key FROM user_profiles WHERE user_id=$1', [userId])).rows[0]?.pix_key as string | null | undefined;
  await db.query(
    `INSERT INTO user_profiles(user_id,pix_key,pix_key_type,pix_key_updated_at) VALUES($1,$2,$3,CASE WHEN $2::text IS NOT NULL THEN now() END)
     ON CONFLICT(user_id) DO UPDATE SET pix_key=EXCLUDED.pix_key,pix_key_type=EXCLUDED.pix_key_type,pix_key_updated_at=now(),updated_at=now()`,
    [userId, pix?.key ?? null, pix?.type ?? null]);
  if (mode === 'force') await db.query('UPDATE affiliates SET pix_key=$2,updated_at=now() WHERE user_id=$1', [userId, pix?.key ?? null]);
  else await db.query('UPDATE affiliates SET pix_key=$2,updated_at=now() WHERE user_id=$1 AND (pix_key IS NULL OR pix_key=$3)', [userId, pix?.key ?? null, old ?? null]);
}

/** Chave do repasse de um parceiro: a dele no cadastro de parceiro ou, se não tiver, a do perfil da conta dele. */
export async function payoutPixKey(db: Db, affiliateId: string): Promise<string | null> {
  const r = await db.query(
    `SELECT coalesce(a.pix_key,p.pix_key) AS pix FROM affiliates a LEFT JOIN user_profiles p ON p.user_id=a.user_id WHERE a.id=$1`, [affiliateId]);
  return (r.rows[0]?.pix as string | null | undefined) ?? null;
}
