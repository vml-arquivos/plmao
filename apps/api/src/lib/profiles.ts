import { pool } from '../db.js';

/**
 * Perfis de uso da conta. A mesma pessoa pode ter mais de um e alternar sem sair da conta:
 *  - CLIENTE: consulta, histórico, garagem, simulações, saldo. Todo mundo tem.
 *  - LOJISTA: quem faz parte de uma loja ativa (área da loja, consulta em lote, carteira de veículos).
 *  - AFILIADO: quem ativou o "Indique e ganhe" (painel de indicações).
 * O perfil escolhido muda o menu e a página inicial. O acesso às áreas protegidas continua decidido pelo servidor
 * a cada chamada (participação na loja, dono do link de indicação), nunca pelo perfil escolhido.
 */
export const PROFILES = ['CLIENTE', 'LOJISTA', 'AFILIADO'] as const;
export type UsageProfile = (typeof PROFILES)[number];

export interface ProfileState { profiles: UsageProfile[]; activeProfile: UsageProfile; hasAffiliate: boolean; hasStore: boolean }

export function isProfile(value: unknown): value is UsageProfile { return typeof value === 'string' && (PROFILES as readonly string[]).includes(value); }

/** Perfis disponíveis a partir do que a conta tem de fato. */
export function availableProfiles(opts: { hasStore: boolean; hasAffiliate: boolean }): UsageProfile[] {
  const out: UsageProfile[] = ['CLIENTE'];
  if (opts.hasStore) out.push('LOJISTA');
  if (opts.hasAffiliate) out.push('AFILIADO');
  return out;
}

/** O perfil guardado vale só se ainda estiver disponível (loja removida, link desativado): senão volta para cliente. */
export function resolveActive(stored: unknown, available: UsageProfile[]): UsageProfile {
  return isProfile(stored) && available.includes(stored) ? stored : 'CLIENTE';
}

export async function loadProfileState(userId: string, opts: { hasStore: boolean }): Promise<ProfileState> {
  const r = await pool.query(`SELECT u.active_profile, EXISTS (SELECT 1 FROM affiliates a WHERE a.user_id=u.id AND a.active) AS has_affiliate FROM users u WHERE u.id=$1`, [userId]);
  const hasAffiliate = Boolean(r.rows[0]?.has_affiliate);
  const profiles = availableProfiles({ hasStore: opts.hasStore, hasAffiliate });
  return { profiles, activeProfile: resolveActive(r.rows[0]?.active_profile, profiles), hasAffiliate, hasStore: opts.hasStore };
}
