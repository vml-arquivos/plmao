import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { appError } from './lib/http.js';

/**
 * Aceite dos Termos do Contrato de Uso e da Política de Privacidade (LGPD).
 * Cada aceite vira duas linhas em `user_consents` (uma por documento) com data, versão, IP, navegador e o que ele liberou
 * (compra ou consulta). Quem aceitou na versão vigente não precisa marcar de novo para consultar com saldo.
 * Texto-base dos documentos: revisão jurídica ainda necessária.
 */
export const LEGAL_VERSION = '2026-08';
export type AcceptanceSource = 'purchase' | 'query' | 'account';
export interface AcceptanceEvidence { ip: string | null; ipHash: string | null; userAgent: string | null }

const err = (code: string, http = 400) => appError(code, { code, http, expose: true });

export async function recordLegalAcceptance(db: Pick<PoolClient, 'query'>, userId: string, source: AcceptanceSource, ev: AcceptanceEvidence, related?: { type: string; id: string }): Promise<void> {
  await db.query(`INSERT INTO user_consents(user_id,consent_type,granted,policy_version,source,ip_hash,ip,user_agent,related_type,related_id)
    VALUES($1,'TERMS_OF_SERVICE',true,$2,$3,$4,$5,$6,$7,$8),($1,'PRIVACY_POLICY',true,$2,$3,$4,$5,$6,$7,$8)`,
  [userId, LEGAL_VERSION, source, ev.ipHash, ev.ip, ev.userAgent, related?.type ?? null, related?.id ?? null]);
}

/** Aceite vigente: os dois documentos aceitos, na versão atual, e não revogados depois. */
export async function legalAcceptanceStatus(userId: string, db: Pick<PoolClient, 'query'> = pool) {
  const r = await db.query(`SELECT DISTINCT ON (consent_type) consent_type,granted,policy_version,created_at
    FROM user_consents WHERE user_id=$1 AND consent_type IN ('TERMS_OF_SERVICE','PRIVACY_POLICY') ORDER BY consent_type,created_at DESC`, [userId]);
  const row = (type: string) => r.rows.find((x) => x.consent_type === type) as { granted: boolean; policy_version: string; created_at: Date } | undefined;
  const ok = (type: string) => { const x = row(type); return Boolean(x && x.granted && x.policy_version === LEGAL_VERSION); };
  const terms = ok('TERMS_OF_SERVICE'); const privacy = ok('PRIVACY_POLICY');
  return { version: LEGAL_VERSION, terms, privacy, accepted: terms && privacy, acceptedAt: terms && privacy ? (row('TERMS_OF_SERVICE')!.created_at) : null };
}

/**
 * Trava da consulta paga com saldo: ou o cliente marcou as duas caixas agora (e isso é gravado), ou já tem aceite vigente.
 * Consulta já paga no checkout (paymentOrderId) ou feita pela API de integração não passa por aqui.
 */
export async function requireLegalAcceptanceForQuery(userId: string, flags: { acceptContract?: boolean; acceptPrivacy?: boolean }, ev: AcceptanceEvidence): Promise<void> {
  const given = flags.acceptContract === true && flags.acceptPrivacy === true;
  if (given) { await recordLegalAcceptance(pool, userId, 'query', ev); return; }
  if (flags.acceptContract === true || flags.acceptPrivacy === true) throw err(flags.acceptContract ? 'PURCHASE_PRIVACY_REQUIRED' : 'PURCHASE_CONTRACT_REQUIRED');
  if (!(await legalAcceptanceStatus(userId)).accepted) throw err('TERMS_ACCEPTANCE_REQUIRED');
}
