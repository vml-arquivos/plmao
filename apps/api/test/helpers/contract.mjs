import { hostRequest } from './server.mjs';

/** Deixa a empresa (contratada) e o cliente com CPF/CNPJ válidos, como exige o contrato de compra. */
export async function prepareContractData(pool, userId) {
  await pool.query(`INSERT INTO fiscal_settings(id,legal_name,cnpj) VALUES(1,'PLACA NA MAO TESTE LTDA','11222333000181')
    ON CONFLICT(id) DO UPDATE SET legal_name=COALESCE(NULLIF(fiscal_settings.legal_name,''),'PLACA NA MAO TESTE LTDA'), cnpj=COALESCE(NULLIF(fiscal_settings.cnpj,''),'11222333000181')`);
  if (userId) await pool.query(`INSERT INTO user_profiles(user_id,cpf_cnpj) VALUES($1,'52998224725') ON CONFLICT(user_id) DO UPDATE SET cpf_cnpj=COALESCE(NULLIF(user_profiles.cpf_cnpj,''),'52998224725')`, [userId]);
}

/** Código enviado por e-mail (guardado cifrado na fila até o envio). */
export async function lastOtp(pool, contractId) {
  const m = (await pool.query(`SELECT payload FROM email_outbox WHERE related_type='PURCHASE_CONTRACT' AND related_id=$1 AND template='PURCHASE_OTP' ORDER BY created_at DESC LIMIT 1`, [contractId])).rows[0];
  if (!m) return null;
  const { decryptRaw } = await import('../../dist/lib/rawStore.js');
  return decryptRaw(m.payload.tokenEnc);
}

/** Gera o contrato, lê o código no e-mail e aceita. Devolve a resposta do rascunho se ele falhar. */
export async function acceptPurchaseContract(base, pool, user, body) {
  await prepareContractData(pool, user.id);
  const draft = await hostRequest(base, '/api/purchase-contracts/draft', { method: 'POST', token: user.token, body });
  if (draft.status !== 201) return { failed: draft };
  const code = await lastOtp(pool, draft.json.id);
  const ok = await hostRequest(base, `/api/purchase-contracts/${draft.json.id}/confirm`, { method: 'POST', token: user.token, body: { code, accept: true } });
  if (ok.status !== 200) return { failed: ok };
  return { contractId: draft.json.id, draft: draft.json };
}

/** Atalho: aceita o contrato e chama o checkout com ele. */
export async function checkoutWithContract(base, pool, user, path, body) {
  const a = await acceptPurchaseContract(base, pool, user, body);
  if (a.failed) return a.failed;
  return hostRequest(base, path, { method: 'POST', token: user.token, body: { ...body, contractId: a.contractId } });
}
