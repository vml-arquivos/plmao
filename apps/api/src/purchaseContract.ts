import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env, publicAppUrl } from './config.js';
import { pool, tx } from './db.js';
import { documentKind, onlyDigits } from './lib/br.js';
import { brl, brlExtenso, sha256 } from './lib/contracts.js';
import { enqueueEmail } from './lib/emailOutbox.js';
import { appError } from './lib/http.js';

/**
 * Contrato de adesão por compra (pacote de saldo ou consulta avulsa).
 * Fluxo: o servidor monta o contrato com os dados do cliente, da empresa e do pedido, guarda o texto exato (hash),
 * envia um código de 6 dígitos ao e-mail do cliente e só libera o pagamento depois que o código confere.
 * O aceite fica gravado com data, e-mail, IP em hash e navegador. Texto-base: revisão jurídica ainda necessária.
 */
export const CONTRACT_MODEL_VERSION = '2026-10-c1';
export type PurchaseKind = 'PACKAGE' | 'QUERY';
const err = (code: string, http = 400) => appError(code, { code, http, expose: true });

export interface ContractParty { name: string; document: string; docType: 'CPF' | 'CNPJ'; email: string; phone: string; address: string; representative: string }
export interface ContractContractor { name: string; document: string; address: string; email: string; phone: string }
export interface ContractItem { kind: PurchaseKind; name: string; description: string; creditsCents: number }
export interface ContractAmounts { subtotalCents: number; discountCents: number; amountCents: number; couponCode: string | null }

const fmtDoc = (d: string) => d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
const dateLong = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });
const timeShort = (d: Date) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

export function maskEmail(email: string): string {
  const [user = '', host = ''] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${host}`;
}

/** Texto do contrato. Tudo o que muda de um cliente para outro entra pelos dados; as cláusulas só mudam com a versão do modelo. */
export function renderPurchaseContract(ctx: { number: string; at: Date; contractor: ContractContractor; party: ContractParty; item: ContractItem; amounts: ContractAmounts }): string {
  const { contractor: c, party: p, item, amounts: a } = ctx;
  const isPackage = item.kind === 'PACKAGE';
  const title = isPackage ? 'CONTRATO DE ADESÃO: COMPRA DE SALDO PRÉ-PAGO' : 'CONTRATO DE ADESÃO: CONSULTA VEICULAR AVULSA';
  const contact = [`e-mail ${c.email}`, c.phone ? `telefone/WhatsApp ${c.phone}` : ''].filter(Boolean).join(', ');
  const priceLine = a.amountCents === 0
    ? `Preço de tabela ${brl(a.subtotalCents)}, com desconto de ${brl(a.discountCents)}${a.couponCode ? ` (cupom ${a.couponCode})` : ''}. Total a pagar: R$ 0,00 (zero reais).`
    : `Preço de tabela ${brl(a.subtotalCents)}${a.discountCents > 0 ? `, desconto de ${brl(a.discountCents)}${a.couponCode ? ` (cupom ${a.couponCode})` : ''}` : ''}. Total a pagar: ${brl(a.amountCents)} (${brlExtenso(a.amountCents)}), pelos meios de pagamento mostrados no checkout.`;
  const parts: string[] = [
    `${title}\nNº ${ctx.number} | modelo ${CONTRACT_MODEL_VERSION} | ${dateLong(ctx.at)}, ${timeShort(ctx.at)}`,
    `PARTES\nCONTRATADA: ${c.name}, CNPJ ${fmtDoc(c.document)}, ${c.address}, titular da plataforma Placa na Mão (${publicAppUrl()}). Atendimento: ${contact}.\nCONTRATANTE: ${p.name}, ${p.docType} ${fmtDoc(p.document)}${p.representative ? `, representada por ${p.representative}` : ''}, e-mail ${p.email}${p.phone ? `, telefone ${p.phone}` : ''}${p.address ? `, ${p.address}` : ''}.`
  ];
  if (isPackage) {
    parts.push(
      `1. OBJETO\nA CONTRATADA vende e o CONTRATANTE compra o "${item.name}": saldo pré-pago de ${brl(item.creditsCents)} (${brlExtenso(item.creditsCents)}) para pagar consultas veiculares na plataforma. O saldo não é moeda, investimento nem conta de pagamento e não rende juros.`,
      `2. PREÇO E PAGAMENTO\n${priceLine}`,
      `3. ENTREGA E GARANTIA\nO saldo é lançado na carteira do CONTRATANTE assim que o pagamento é confirmado, normalmente em poucos minutos. Se o pagamento for confirmado e o saldo não aparecer em até 24 horas, a CONTRATADA lança o saldo ou devolve o valor pago por inteiro, a escolha do CONTRATANTE. O valor de cada consulta é mostrado antes de ser descontado do saldo. Consulta que falha por motivo técnico é estornada ao saldo automaticamente.`
    );
  } else {
    parts.push(
      `1. OBJETO\nA CONTRATADA presta ao CONTRATANTE uma consulta veicular "${item.name}"${item.description ? ` (${item.description.replace(/[.\s]+$/, '')})` : ''}, para o dado informado no pedido (placa, chassi, Renavam ou CPF/CNPJ do proprietário).`,
      `2. PREÇO E PAGAMENTO\n${priceLine}`,
      `3. ENTREGA E GARANTIA\nO relatório é liberado na área do CONTRATANTE assim que o pagamento é confirmado e a consulta termina, normalmente em poucos minutos. Se a consulta não for concluída por falha técnica ou por falta de resposta da fonte, o valor volta ao saldo ou o direito de consulta continua disponível, sem custo, de forma automática. Se o pagamento for confirmado e a consulta não ficar disponível em até 24 horas, a CONTRATADA entrega o relatório ou devolve o valor pago por inteiro.`
    );
  }
  parts.push(
    `4. O QUE A CONTRATADA SE COMPROMETE\nEntregar o que foi contratado como descrito na cláusula 3; informar o preço antes de cobrar; manter canais de suporte; emitir documento fiscal quando a lei exigir; e proteger os dados do CONTRATANTE conforme a Política de Privacidade.`,
    `5. O QUE O CONTRATANTE SE COMPROMETE\nPagar o preço; informar dados verdadeiros; guardar o acesso à sua conta; usar as consultas só para fins legítimos, como avaliar compra, venda, financiamento ou regularização de veículo; e não repassar nem revender relatórios que contenham dados pessoais de terceiros.`,
    `6. NATUREZA DO RELATÓRIO\nO relatório reúne dados de fornecedores e apoia a decisão do CONTRATANTE. Não substitui vistoria nem consulta aos órgãos competentes. Quando a fonte não informa um dado, o relatório mostra "não fornecido", nunca "nada consta".`,
    `7. ARREPENDIMENTO E REEMBOLSO\nA compra é feita pela internet: o CONTRATANTE pode desistir em até 7 dias e receber de volta o valor do que ainda não usou (Código de Defesa do Consumidor, art. 49). Consulta já entregue não é reembolsada, porque é serviço digital de execução imediata, salvo erro da CONTRATADA ou falha comprovada do relatório. O pedido de estorno é feito pelo suporte.`,
    `8. DADOS PESSOAIS (LGPD)\nA CONTRATADA trata os dados do CONTRATANTE para cumprir este contrato, cobrar, emitir documento fiscal, prestar suporte e cumprir obrigações legais, conforme a Política de Privacidade (${publicAppUrl()}/privacidade). O CONTRATANTE pode pedir acesso, correção ou exclusão dos seus dados pelo suporte.`,
    `9. ACEITE ELETRÔNICO E PROVA\nAs partes reconhecem como válido o aceite feito por código enviado ao e-mail do CONTRATANTE (assinatura eletrônica simples: Lei 14.063/2020, art. 4º, I, e MP 2.200-2/2001, art. 10, §2º). A CONTRATADA guarda o texto exato deste contrato (com impressão digital SHA-256), a data e a hora do aceite, o e-mail que recebeu o código, o IP em formato protegido e o navegador. O CONTRATANTE recebe aviso por e-mail e pode rever o contrato em "Meus contratos".`,
    `10. SUPORTE E FORO\nSuporte: ${contact}. Fica eleito o foro do domicílio do CONTRATANTE quando ele for consumidor; nos demais casos, o da sede da CONTRATADA.`
  );
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- código de confirmação

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 4;
const OTP_COOLDOWN_SEC = 45;
const CONTRACT_TTL_MIN = 30;
const DRAFTS_PER_HOUR = 12;

const otpHash = (contractId: string, code: string) => createHmac('sha256', env.JWT_SECRET ?? 'dev').update(`${contractId}:${code}`).digest('hex');
const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

async function sendOtp(client: Pick<PoolClient, 'query'>, row: { id: string; number: string; user_id: string; sent: number }, email: string, name: string): Promise<{ expiresAt: Date }> {
  const code = newCode();
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
  await client.query(`UPDATE purchase_contracts SET otp_hash=$2,otp_expires_at=$3,otp_attempts=0,otp_sent_count=otp_sent_count+1,otp_last_sent_at=now(),updated_at=now() WHERE id=$1`, [row.id, otpHash(row.id, code), expiresAt]);
  await enqueueEmail({
    idempotencyKey: `purchase-otp:${row.id}:${row.sent + 1}`, template: 'PURCHASE_OTP', toEmail: email, toName: name,
    data: { name: name.split(' ')[0], documentNumber: row.number, token: code, expiresAt: expiresAt.toISOString() }, relatedType: 'PURCHASE_CONTRACT', relatedId: row.id, createdBy: row.user_id
  });
  return { expiresAt };
}

// ---------------------------------------------------------------- dados

export async function loadContractor(db: Pick<PoolClient, 'query'> = pool): Promise<ContractContractor> {
  const r = await db.query('SELECT legal_name,cnpj,street,street_number,district,city,state,zip FROM fiscal_settings WHERE id=1');
  const f = (r.rows[0] ?? {}) as Record<string, unknown>;
  if (!f.legal_name || documentKind(String(f.cnpj ?? '')) !== 'CNPJ') throw err('PURCHASE_CONTRACTOR_MISSING', 503);
  const address = [f.street, f.street_number, f.district, f.city, f.state, f.zip].filter((x) => typeof x === 'string' && x.trim()).join(', ') || 'endereço do cadastro fiscal';
  return { name: String(f.legal_name), document: onlyDigits(String(f.cnpj)), address, email: env.SUPPORT_EMAIL?.trim() || env.EMAIL_REPLY_TO?.trim() || 'contato@placanamao.com.br', phone: env.SUPPORT_WHATSAPP?.trim() || env.SUPPORT_PHONE?.trim() || '' };
}

export async function loadParty(userId: string, db: Pick<PoolClient, 'query'> = pool): Promise<ContractParty> {
  const r = await db.query(`SELECT u.name,u.email,pr.cpf_cnpj,pr.phone,pr.company_name,pr.zip,pr.street,pr.street_number,pr.complement,pr.district,pr.city,pr.state
    FROM users u LEFT JOIN user_profiles pr ON pr.user_id=u.id WHERE u.id=$1 AND u.active=true`, [userId]);
  if (!r.rowCount) throw err('AUTH_REQUIRED', 401);
  const u = r.rows[0] as Record<string, unknown>;
  const doc = onlyDigits(String(u.cpf_cnpj ?? ''));
  const kind = documentKind(doc);
  if (!kind) throw err('CONTRACT_PROFILE_INCOMPLETE', 422);
  const address = [u.street, u.street_number, u.complement, u.district, u.city, u.state, u.zip].filter((x) => typeof x === 'string' && x.trim()).join(', ');
  const company = String(u.company_name ?? '').trim();
  const personName = String(u.name);
  return { name: kind === 'CNPJ' ? (company || personName) : personName, document: doc, docType: kind, email: String(u.email), phone: String(u.phone ?? ''), address, representative: kind === 'CNPJ' && company ? personName : '' };
}

export interface DraftInput { userId: string; kind: PurchaseKind; itemKey: string; item: ContractItem; amounts: ContractAmounts }

/** Monta, grava e envia o código. O texto gravado é o texto que o cliente vê. */
export async function draftPurchaseContract(input: DraftInput) {
  const contractor = await loadContractor();
  const party = await loadParty(input.userId);
  const recent = await pool.query(`SELECT count(*)::int AS n FROM purchase_contracts WHERE user_id=$1 AND created_at > now() - interval '1 hour'`, [input.userId]);
  if (Number(recent.rows[0]?.n ?? 0) >= DRAFTS_PER_HOUR) throw err('PURCHASE_CONTRACT_RATE_LIMIT', 429);
  return tx(async (client) => {
    await client.query(`UPDATE purchase_contracts SET status='EXPIRADO',updated_at=now() WHERE user_id=$1 AND status IN ('PENDENTE','ACEITO') AND kind=$2 AND item_key=$3`, [input.userId, input.kind, input.itemKey]);
    const seq = await client.query(`SELECT nextval('purchase_contract_seq') AS n`);
    const now = new Date();
    const number = `PNM-${now.getFullYear()}-${String(seq.rows[0].n).padStart(6, '0')}`;
    const body = renderPurchaseContract({ number, at: now, contractor, party, item: input.item, amounts: input.amounts });
    const row = await client.query(`INSERT INTO purchase_contracts(number,user_id,kind,item_key,amount_cents,model_version,party,body,body_hash,otp_destination,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,now() + make_interval(mins => $11::int)) RETURNING id`,
      [number, input.userId, input.kind, input.itemKey, input.amounts.amountCents, CONTRACT_MODEL_VERSION, JSON.stringify({ ...party, contractor: contractor.name }), body, sha256(body), maskEmail(party.email), CONTRACT_TTL_MIN]);
    const id = String(row.rows[0].id);
    const { expiresAt } = await sendOtp(client, { id, number, user_id: input.userId, sent: 0 }, party.email, party.name);
    return { id, number, text: body, hash: sha256(body), email: maskEmail(party.email), codeExpiresAt: expiresAt.toISOString(), resendAfterSeconds: OTP_COOLDOWN_SEC, modelVersion: CONTRACT_MODEL_VERSION };
  });
}

export async function resendPurchaseOtp(userId: string, contractId: string) {
  return tx(async (client) => {
    const r = await client.query(`SELECT id,number,user_id,status,expires_at,otp_sent_count,otp_last_sent_at,party FROM purchase_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE`, [contractId, userId]);
    if (!r.rowCount) throw err('PURCHASE_CONTRACT_NOT_FOUND', 404);
    const row = r.rows[0] as { id: string; number: string; user_id: string; status: string; expires_at: Date; otp_sent_count: number; otp_last_sent_at: Date | null; party: ContractParty };
    if (row.status !== 'PENDENTE') throw err('PURCHASE_CONTRACT_NOT_PENDING', 409);
    if (row.expires_at.getTime() < Date.now()) throw err('PURCHASE_CONTRACT_EXPIRED', 409);
    if (row.otp_sent_count >= OTP_MAX_SENDS) throw err('PURCHASE_OTP_SEND_LIMIT', 429);
    if (row.otp_last_sent_at && Date.now() - row.otp_last_sent_at.getTime() < OTP_COOLDOWN_SEC * 1000) throw err('PURCHASE_OTP_TOO_SOON', 429);
    const { expiresAt } = await sendOtp(client, { id: row.id, number: row.number, user_id: row.user_id, sent: row.otp_sent_count }, row.party.email, row.party.name);
    return { codeExpiresAt: expiresAt.toISOString(), resendAfterSeconds: OTP_COOLDOWN_SEC };
  });
}

/** Confere o código. Erros de código gastam tentativa e são gravados mesmo quando a requisição responde erro. */
export async function confirmPurchaseContract(userId: string, contractId: string, code: string, evidence: { ipHash: string | null; userAgent: string | null }) {
  let failure: string | null = null;
  const out = await tx(async (client) => {
    const r = await client.query(`SELECT id,number,status,expires_at,otp_hash,otp_expires_at,otp_attempts,body_hash,party FROM purchase_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE`, [contractId, userId]);
    if (!r.rowCount) throw err('PURCHASE_CONTRACT_NOT_FOUND', 404);
    const row = r.rows[0] as { id: string; number: string; status: string; expires_at: Date; otp_hash: string | null; otp_expires_at: Date | null; otp_attempts: number; body_hash: string; party: ContractParty };
    if (row.status === 'ACEITO') return { accepted: true as const, number: row.number };
    if (row.status !== 'PENDENTE') throw err('PURCHASE_CONTRACT_NOT_PENDING', 409);
    if (row.expires_at.getTime() < Date.now()) throw err('PURCHASE_CONTRACT_EXPIRED', 409);
    if (!row.otp_hash || !row.otp_expires_at || row.otp_expires_at.getTime() < Date.now()) { failure = 'PURCHASE_OTP_EXPIRED'; return { accepted: false as const }; }
    if (row.otp_attempts >= OTP_MAX_ATTEMPTS) { failure = 'PURCHASE_OTP_LOCKED'; return { accepted: false as const }; }
    const given = Buffer.from(otpHash(row.id, code)); const want = Buffer.from(row.otp_hash);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      await client.query('UPDATE purchase_contracts SET otp_attempts=otp_attempts+1,updated_at=now() WHERE id=$1', [row.id]);
      failure = 'PURCHASE_OTP_INVALID'; return { accepted: false as const };
    }
    await client.query(`UPDATE purchase_contracts SET status='ACEITO',accepted_at=now(),accept_ip_hash=$2,accept_user_agent=$3,otp_hash=NULL,expires_at=now() + make_interval(mins => $4::int),updated_at=now() WHERE id=$1`, [row.id, evidence.ipHash, evidence.userAgent, CONTRACT_TTL_MIN]);
    await enqueueEmail({
      idempotencyKey: `purchase-accepted:${row.id}`, template: 'GENERIC_NOTICE', toEmail: row.party.email, toName: row.party.name,
      data: { name: row.party.name.split(' ')[0], documentTitle: `Contrato ${row.number} aceito`, message: `Você aceitou o contrato ${row.number} por código enviado a este e-mail. Para ler ou baixar sua cópia, entre na sua conta e abra "Meus contratos". Se não foi você, avise o suporte agora.` },
      relatedType: 'PURCHASE_CONTRACT', relatedId: row.id, createdBy: userId
    });
    return { accepted: true as const, number: row.number };
  });
  if (!out.accepted) {
    const attemptsLeft = failure === 'PURCHASE_OTP_INVALID'
      ? Math.max(0, OTP_MAX_ATTEMPTS - Number((await pool.query('SELECT otp_attempts FROM purchase_contracts WHERE id=$1', [contractId])).rows[0]?.otp_attempts ?? 0))
      : 0;
    throw Object.assign(err(failure ?? 'PURCHASE_OTP_INVALID', failure === 'PURCHASE_OTP_LOCKED' ? 429 : 400), { attemptsLeft });
  }
  return { accepted: true, number: out.number };
}

/** Usado dentro da transação do checkout: o contrato tem de estar aceito, ser do cliente e bater com o pedido. */
export async function claimContractForOrder(client: PoolClient, userId: string, contractId: unknown, expected: { kind: PurchaseKind; itemKey: string; amountCents: number }): Promise<string> {
  const id = typeof contractId === 'string' && /^[0-9a-f-]{36}$/i.test(contractId) ? contractId : null;
  if (!id) throw err('PURCHASE_CONTRACT_REQUIRED', 400);
  const r = await client.query('SELECT id,status,expires_at,kind,item_key,amount_cents FROM purchase_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId]);
  if (!r.rowCount) throw err('PURCHASE_CONTRACT_REQUIRED', 400);
  const row = r.rows[0] as { status: string; expires_at: Date; kind: string; item_key: string; amount_cents: number };
  if (row.status === 'USADO') throw err('PURCHASE_CONTRACT_USED', 409);
  if (row.status === 'PENDENTE') throw err('PURCHASE_CONTRACT_NOT_ACCEPTED', 409);
  if (row.status !== 'ACEITO' || row.expires_at.getTime() < Date.now()) throw err('PURCHASE_CONTRACT_EXPIRED', 409);
  if (row.kind !== expected.kind || row.item_key !== expected.itemKey || Number(row.amount_cents) !== expected.amountCents) throw err('PURCHASE_CONTRACT_MISMATCH', 409);
  await client.query(`UPDATE purchase_contracts SET status='USADO',updated_at=now() WHERE id=$1`, [id]);
  return id;
}
export async function linkContractToOrder(client: Pick<PoolClient, 'query'>, contractId: string, orderId: string): Promise<void> {
  await client.query('UPDATE purchase_contracts SET order_id=$2,updated_at=now() WHERE id=$1', [contractId, orderId]);
}
/** Se o meio de pagamento falhar ao abrir o checkout, o contrato aceito volta a valer para uma nova tentativa. */
export async function reopenContractForOrder(orderId: string): Promise<void> {
  await pool.query(`UPDATE purchase_contracts SET status='ACEITO',order_id=NULL,expires_at=now() + make_interval(mins => $2::int),updated_at=now() WHERE order_id=$1 AND status='USADO'`, [orderId, CONTRACT_TTL_MIN]);
}

export async function listUserContracts(userId: string) {
  const r = await pool.query(`SELECT c.id,c.number,c.kind,c.status,c.amount_cents,c.model_version,c.accepted_at,c.created_at,c.order_id,o.status AS order_status
    FROM purchase_contracts c LEFT JOIN payment_orders o ON o.id=c.order_id
    WHERE c.user_id=$1 AND c.accepted_at IS NOT NULL ORDER BY c.accepted_at DESC LIMIT 100`, [userId]);
  return r.rows;
}
export async function getUserContract(userId: string, id: string) {
  const r = await pool.query(`SELECT id,number,kind,status,amount_cents,model_version,body,body_hash,accepted_at,order_id FROM purchase_contracts WHERE id=$1 AND user_id=$2`, [id, userId]);
  if (!r.rowCount) throw err('PURCHASE_CONTRACT_NOT_FOUND', 404);
  return r.rows[0];
}
