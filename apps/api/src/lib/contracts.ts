import { createHash, createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { env, publicAppUrl } from '../config.js';
import { pool, tx } from '../db.js';
import { documentKind, onlyDigits } from './br.js';
import { CONTRACT_VARIABLES, CONTRACT_VARIABLE_DOCS } from './contractModels.js';
import { appError } from './http.js';
import { enqueueEmail } from './emailOutbox.js';
import { consumeSecureLink, createSecureLink, peekSecureLink, revokeSecureLinks } from './secureLinks.js';

/**
 * Contratos da Placa na Mão: modelos versionados (aprovação jurídica registrada), contratos com dados congelados,
 * aprovação por segunda pessoa, assinatura eletrônica simples pelo próprio sistema (evidências registradas)
 * e trilha imutável. Nada aqui libera consulta ou cobra: aplicar condições é uma ação separada, autorizada.
 */
export type ContractKind = 'PF_AVULSO' | 'PJ_B2B' | 'PACOTE_PERSONALIZADO' | 'PARCEIRO' | 'ADITIVO';
export type ContractStatus = 'RASCUNHO' | 'EM_APROVACAO' | 'APROVADO' | 'AGUARDANDO_ASSINATURA' | 'ASSINADO' | 'RECUSADO' | 'EXPIRADO' | 'CANCELADO';
const err = (code: string, http = 422) => appError(code, { code, http, expose: true });

// ---------------------------------------------------------------- termos

const item = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUERY'), productId: z.string().trim().min(1).max(60), agreedPriceCents: z.number().int().min(1).max(10_000_000) }).strict(),
  z.object({ type: z.literal('CUSTOM'), name: z.string().trim().min(2).max(120), description: z.string().trim().max(300).optional(),
    quantity: z.number().int().min(1).max(1_000_000), unitPriceCents: z.number().int().min(0).max(100_000_000), discountPercent: z.number().min(0).max(100).optional() }).strict()
]);
export const termsSchema = z.object({
  items: z.array(item).max(30).default([]),
  validityMonths: z.number().int().min(1).max(60),
  paymentTerms: z.string().trim().min(3).max(500),
  autoRenew: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
  commission: z.object({ bps: z.number().int().min(0).max(5000), base: z.enum(['GROSS', 'NET', 'MARGIN']) }).strict().optional()
}).strict();
export type Terms = z.infer<typeof termsSchema>;

export const brl = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const BASE: Record<string, string> = { GROSS: 'valor bruto pago pelo cliente', NET: 'valor líquido (após taxas do meio de pagamento)', MARGIN: 'margem (valor pago menos custos diretos da consulta)' };

export interface ResolvedItem { type: 'QUERY' | 'CUSTOM'; name: string; description?: string; productId?: string; basePriceCents?: number; unitPriceCents: number; quantity?: number; discountPercent?: number; totalCents?: number }
export interface ResolvedTerms { items: ResolvedItem[]; commission?: Terms['commission'] }

/** Confere itens do catálogo (existência e piso de preço) e congela nomes e preços de tabela da data do contrato. */
export async function resolveTerms(kind: ContractKind, terms: Terms, db: Pick<PoolClient, 'query'> = pool): Promise<ResolvedTerms> {
  if (kind === 'PARCEIRO' && !terms.commission) throw err('CONTRACT_COMMISSION_REQUIRED');
  if (kind !== 'PARCEIRO' && terms.commission) throw err('CONTRACT_COMMISSION_NOT_ALLOWED');
  if (kind !== 'PARCEIRO' && kind !== 'ADITIVO' && terms.items.length === 0) throw err('CONTRACT_ITEMS_REQUIRED');
  if (kind === 'ADITIVO' && terms.items.length === 0 && !terms.commission) throw err('CONTRACT_ITEMS_REQUIRED');
  const items: ResolvedItem[] = [];
  for (const it of terms.items) {
    if (it.type === 'QUERY') {
      const p = await db.query('SELECT id,name,price_cents,floor_price_cents,provider_cost_cents FROM query_products WHERE id=$1', [it.productId]);
      if (!p.rowCount) throw err('PRODUCT_NOT_FOUND', 404);
      const row = p.rows[0]; const floor = Number(row.floor_price_cents ?? row.provider_cost_cents ?? 0);
      if (it.agreedPriceCents < Math.max(floor, 1)) throw Object.assign(err('PRICE_BELOW_FLOOR'), { details: [{ productId: it.productId, floorCents: floor }] });
      const base = Number(row.price_cents);
      items.push({ type: 'QUERY', productId: row.id, name: row.name, basePriceCents: base, unitPriceCents: it.agreedPriceCents, discountPercent: base > 0 ? Math.max(0, Math.round((1 - it.agreedPriceCents / base) * 1000) / 10) : 0 });
    } else {
      const unit = Math.round(it.unitPriceCents * (100 - (it.discountPercent ?? 0)) / 100);
      items.push({ type: 'CUSTOM', name: it.name, description: it.description, unitPriceCents: unit, quantity: it.quantity, discountPercent: it.discountPercent ?? 0, basePriceCents: it.unitPriceCents, totalCents: unit * it.quantity });
    }
  }
  return { items, ...(terms.commission ? { commission: terms.commission } : {}) };
}

export function describeTerms(r: ResolvedTerms, holdDays = 7): { conditions: string; commission: string } {
  const lines = r.items.map((i, n) => i.type === 'QUERY'
    ? `${n + 1}) Consulta "${i.name}": ${brl(i.unitPriceCents)} por consulta${i.basePriceCents ? ` (preço de tabela ${brl(i.basePriceCents)}${i.discountPercent ? `, desconto de ${i.discountPercent.toLocaleString('pt-BR')}%` : ''})` : ''}.`
    : `${n + 1}) Pacote personalizado "${i.name}"${i.description ? ` — ${i.description}` : ''}: ${i.quantity} un. × ${brl(i.unitPriceCents)}${i.discountPercent ? ` (após desconto de ${i.discountPercent.toLocaleString('pt-BR')}% sobre ${brl(i.basePriceCents ?? 0)})` : ''} = ${brl(i.totalCents ?? 0)}.`);
  const c = r.commission;
  return {
    conditions: lines.length ? lines.join('\n') : 'Sem itens de preço neste instrumento.',
    commission: c ? `Comissão de ${pct(c.bps)} sobre o ${BASE[c.base]}, com prazo de segurança de ${holdDays} dia(s) após a confirmação do pagamento.` : 'Não se aplica.'
  };
}

// ---------------------------------------------------------------- partes

export interface Party { type: 'PF' | 'PJ' | 'PARCEIRO'; name: string; document: string; email: string; address: string }
const addr = (r: Record<string, unknown>) => [r.street, r.street_number, r.complement, r.district, r.city, r.state, r.zip].filter((x) => typeof x === 'string' && x.trim()).join(', ');

export async function buildParty(ref: { userId?: string; organizationId?: string; affiliateId?: string }, documentOverride?: string, db: Pick<PoolClient, 'query'> = pool): Promise<Party> {
  let p: Party;
  if (ref.organizationId) {
    const r = await db.query('SELECT * FROM organizations WHERE id=$1', [ref.organizationId]);
    if (!r.rowCount) throw err('ORGANIZATION_NOT_FOUND', 404);
    const o = r.rows[0]; p = { type: 'PJ', name: String(o.legal_name || o.name), document: onlyDigits(documentOverride || o.document), email: String(o.email ?? ''), address: addr(o) };
  } else if (ref.affiliateId) {
    const r = await db.query('SELECT name,email,document FROM affiliates WHERE id=$1', [ref.affiliateId]);
    if (!r.rowCount) throw err('AFFILIATE_NOT_FOUND', 404);
    p = { type: 'PARCEIRO', name: r.rows[0].name, document: onlyDigits(documentOverride || r.rows[0].document), email: String(r.rows[0].email ?? ''), address: '' };
  } else if (ref.userId) {
    const r = await db.query(`SELECT u.name,u.email,pr.cpf_cnpj,pr.zip,pr.street,pr.street_number,pr.complement,pr.district,pr.city,pr.state FROM users u LEFT JOIN user_profiles pr ON pr.user_id=u.id WHERE u.id=$1`, [ref.userId]);
    if (!r.rowCount) throw err('CUSTOMER_NOT_FOUND', 404);
    const u = r.rows[0]; p = { type: 'PF', name: u.name, document: onlyDigits(documentOverride || u.cpf_cnpj), email: u.email, address: addr(u) };
  } else throw err('CONTRACT_PARTY_REQUIRED', 400);
  const kind = documentKind(p.document);
  if (!kind || (p.type === 'PF' && kind !== 'CPF') || (p.type === 'PJ' && kind !== 'CNPJ')) throw err('CONTRACT_PARTY_DOCUMENT_INVALID');
  return p;
}

async function contractor(db: Pick<PoolClient, 'query'> = pool) {
  const r = await db.query('SELECT legal_name,cnpj,street,street_number,district,city,state,zip FROM fiscal_settings WHERE id=1');
  const f = r.rows[0] ?? {};
  if (!f.legal_name || documentKind(f.cnpj) !== 'CNPJ') throw err('CONTRACTOR_DATA_MISSING');
  return { name: String(f.legal_name), document: onlyDigits(f.cnpj), address: addr(f) || 'endereço informado no cadastro fiscal' };
}

const fmtDoc = (d: string) => d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUND = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function below1000(n: number): string {
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100); const r = n % 100; const parts: string[] = [];
  if (h) parts.push(HUND[h]!);
  if (r) parts.push(r < 20 ? UNITS[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` e ${UNITS[r % 10]}` : ''}`);
  return parts.join(' e ');
}
function integerWords(n: number): string {
  if (n === 0) return 'zero';
  if (n >= 1_000_000) {
    const mi = Math.floor(n / 1_000_000); const rest = n % 1_000_000;
    return `${integerWords(mi)} ${mi === 1 ? 'milhão' : 'milhões'}${rest ? (rest < 100 || (rest < 1000 && rest % 100 === 0) || (rest % 1000 === 0 && rest / 1000 < 100) ? ' e ' : ' ') + integerWords(rest) : ''}`;
  }
  const mil = Math.floor(n / 1000); const rest = n % 1000; const parts: string[] = [];
  if (mil) parts.push(mil === 1 ? 'mil' : `${integerWords(mil)} mil`);
  if (rest) parts.push(below1000(rest));
  return parts.join(rest && (rest < 100 || rest % 100 === 0) ? ' e ' : ' ');
}
/** 180000 -> "mil e oitocentos reais". Até 999.999.999 centavos; acima disso devolve só o número. */
export function brlExtenso(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0 || cents > 99_999_999_900) return '';
  const reais = Math.floor(cents / 100); const c = cents % 100;
  const r = reais ? `${integerWords(reais)} ${reais === 1 ? 'real' : 'reais'}` : '';
  const cs = c ? `${integerWords(c)} ${c === 1 ? 'centavo' : 'centavos'}` : '';
  return [r, cs].filter(Boolean).join(' e ') || 'zero reais';
}

export function renderBody(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in vars)) throw err(`CONTRACT_VARIABLE_UNKNOWN:${key}`);
    return vars[key]!;
  });
}
export function unknownVariables(text: string): string[] {
  const known = new Set<string>(CONTRACT_VARIABLES);
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z_.]+)\s*\}\}/g)].map((m) => m[1]!))].filter((k) => !known.has(k));
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- criação

export interface CreateInput { templateCode: ContractKind; userId?: string; organizationId?: string; affiliateId?: string; document?: string; signer: { name: string; email: string }; terms: Terms; parentContractId?: string }

function computedVars(resolved: ResolvedTerms, input: CreateInput, now: Date, holdDays: number): Record<string, string> {
  const custom = resolved.items.filter((i) => i.type === 'CUSTOM');
  const total = custom.reduce((a, i) => a + (i.totalCents ?? 0), 0);
  const gross = custom.reduce((a, i) => a + (i.basePriceCents ?? 0) * (i.quantity ?? 0), 0);
  const c = resolved.commission;
  return {
    data_extenso: now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' }),
    observacoes: input.terms.notes ?? '',
    'signatario.nome': input.signer.name, 'signatario.email': input.signer.email,
    'valor.total': brl(total), 'valor.total_extenso': brlExtenso(total), 'desconto.total': brl(Math.max(0, gross - total)),
    'itens.quantidade': String(resolved.items.length),
    'vigencia.meses': String(input.terms.validityMonths), renovacao: input.terms.autoRenew ? 'com renovação automática por igual período' : 'sem renovação automática',
    'comissao.percentual': c ? pct(c.bps) : 'não se aplica', 'comissao.base': c ? BASE[c.base]! : 'não se aplica', 'comissao.prazo_dias': String(holdDays)
  };
}

/** Dados fictícios para pré-visualizar uma minuta antes de criar contratos. */
export function sampleVars(): Record<string, string> {
  return Object.fromEntries(CONTRACT_VARIABLE_DOCS.map((v) => [v.key, v.example]));
}

async function assemble(input: CreateInput, db: Pick<PoolClient, 'query'>, number: string) {
  const tpl = await db.query(`SELECT v.id,v.title,v.body,t.kind FROM contract_templates t JOIN contract_template_versions v ON v.template_id=t.id AND v.status='PUBLISHED' WHERE t.code=$1`, [input.templateCode]);
  if (!tpl.rowCount) throw err('CONTRACT_MODEL_NOT_PUBLISHED', 409);
  const kind = tpl.rows[0].kind as ContractKind;
  const party = await buildParty(input, input.document, db);
  if (kind !== 'ADITIVO') {
    if ((kind === 'PF_AVULSO') !== (party.type === 'PF')) throw err('CONTRACT_PARTY_KIND_MISMATCH');
    if ((kind === 'PARCEIRO') !== (party.type === 'PARCEIRO')) throw err('CONTRACT_PARTY_KIND_MISMATCH');
    if ((kind === 'PJ_B2B' || kind === 'PACOTE_PERSONALIZADO') && party.type !== 'PJ') throw err('CONTRACT_PARTY_KIND_MISMATCH');
  }
  let parentNumber = '';
  if (kind === 'ADITIVO') {
    if (!input.parentContractId) throw err('CONTRACT_PARENT_REQUIRED', 400);
    const par = await db.query(`SELECT number,status,user_id,organization_id,affiliate_id FROM contracts WHERE id=$1`, [input.parentContractId]);
    if (!par.rowCount || par.rows[0].status !== 'ASSINADO') throw err('CONTRACT_PARENT_NOT_SIGNED', 409);
    const same = (par.rows[0].user_id ?? null) === (input.userId ?? null) && (par.rows[0].organization_id ?? null) === (input.organizationId ?? null) && (par.rows[0].affiliate_id ?? null) === (input.affiliateId ?? null);
    if (!same) throw err('CONTRACT_PARENT_PARTY_MISMATCH');
    parentNumber = par.rows[0].number;
  } else if (input.parentContractId) throw err('CONTRACT_PARENT_NOT_ALLOWED', 400);
  const resolved = await resolveTerms(kind, input.terms, db);
  const me = await contractor(db);
  const hold = Number((await db.query('SELECT commission_hold_days FROM payment_settings LIMIT 1')).rows[0]?.commission_hold_days ?? 7);
  const d = describeTerms(resolved, hold);
  const now = new Date();
  const vars: Record<string, string> = {
    numero: number, data: now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    'contratada.nome': me.name, 'contratada.documento': fmtDoc(me.document), 'contratada.endereco': me.address,
    'contratante.nome': party.name, 'contratante.documento': fmtDoc(party.document), 'contratante.endereco': party.address || 'não informado', 'contratante.email': input.signer.email,
    condicoes_comerciais: d.conditions, vigencia: `Vigência de ${input.terms.validityMonths} mês(es) a partir da assinatura${input.terms.autoRenew ? ', renovável automaticamente por igual período salvo aviso em contrário' : ', sem renovação automática'}.`,
    pagamento: input.terms.paymentTerms, comissao: d.commission, contrato_original: parentNumber || 'não se aplica',
    ...computedVars(resolved, input, now, hold)
  };
  const title = renderBody(tpl.rows[0].title, vars);
  const text = `${title}\n\n${renderBody(tpl.rows[0].body, vars)}${input.terms.notes ? `\n\nObservações: ${input.terms.notes}` : ''}`;
  return { templateVersionId: tpl.rows[0].id as string, kind, party, resolved, text, title };
}

async function logEvent(db: Pick<PoolClient, 'query'>, contractId: string, event: string, actor: string | null, detail: Record<string, unknown> = {}) {
  await db.query('INSERT INTO contract_events(contract_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4::jsonb)', [contractId, event, actor, JSON.stringify(detail)]);
}
const SIGNER = z.object({ name: z.string().trim().min(3).max(120), email: z.string().trim().toLowerCase().email().max(254) }).strict();

export async function previewContract(input: CreateInput) {
  const a = await assemble({ ...input, signer: SIGNER.parse(input.signer) }, pool, 'CT-PREVIA');
  return { title: a.title, body: a.text, party: a.party, resolved: a.resolved };
}

export async function createContract(input: CreateInput, actorId: string) {
  const signer = SIGNER.parse(input.signer);
  return tx(async (client) => {
    const n = await client.query(`SELECT nextval('contract_number_seq') AS n`);
    const number = `CT-${new Date().getFullYear()}-${String(n.rows[0].n).padStart(4, '0')}`;
    const a = await assemble({ ...input, signer }, client, number);
    const row = await client.query(
      `INSERT INTO contracts(number,kind,template_version_id,parent_contract_id,user_id,organization_id,affiliate_id,party,terms,rendered_body,body_hash,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12) RETURNING id,number,status`,
      [number, a.kind, a.templateVersionId, input.parentContractId ?? null, input.userId ?? null, input.organizationId ?? null, input.affiliateId ?? null, JSON.stringify(a.party),
        JSON.stringify({ input: input.terms, resolved: a.resolved }), a.text, sha256(a.text), actorId]);
    await client.query('INSERT INTO contract_signers(contract_id,name,email) VALUES($1,$2,$3)', [row.rows[0].id, signer.name, signer.email]);
    await logEvent(client, row.rows[0].id, 'CRIADO', actorId, { templateVersionId: a.templateVersionId });
    return row.rows[0] as { id: string; number: string; status: ContractStatus };
  });
}

/** Só rascunho muda; edita termos e/ou assinante e gera novo texto e hash. */
export async function updateDraft(id: string, patch: { terms?: Terms; signer?: { name: string; email: string }; document?: string }, actorId: string) {
  return tx(async (client) => {
    const c = await client.query('SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [id]);
    if (!c.rowCount) throw err('CONTRACT_NOT_FOUND', 404);
    const cur = c.rows[0];
    if (cur.status !== 'RASCUNHO') throw err('CONTRACT_NOT_EDITABLE', 409);
    const s = await client.query('SELECT name,email FROM contract_signers WHERE contract_id=$1', [id]);
    const signer = patch.signer ? SIGNER.parse(patch.signer) : { name: s.rows[0].name as string, email: s.rows[0].email as string };
    const tv = await client.query(`SELECT t.code FROM contract_template_versions v JOIN contract_templates t ON t.id=v.template_id WHERE v.id=$1`, [cur.template_version_id]);
    const input: CreateInput = { templateCode: tv.rows[0].code, userId: cur.user_id ?? undefined, organizationId: cur.organization_id ?? undefined, affiliateId: cur.affiliate_id ?? undefined,
      document: patch.document, signer, terms: patch.terms ?? cur.terms.input, parentContractId: cur.parent_contract_id ?? undefined };
    const a = await assemble(input, client, cur.number);
    await client.query(`UPDATE contracts SET party=$2::jsonb,terms=$3::jsonb,rendered_body=$4,body_hash=$5,template_version_id=$6,updated_at=now() WHERE id=$1`,
      [id, JSON.stringify(a.party), JSON.stringify({ input: input.terms, resolved: a.resolved }), a.text, sha256(a.text), a.templateVersionId]);
    await client.query('UPDATE contract_signers SET name=$2,email=$3 WHERE contract_id=$1', [id, signer.name, signer.email]);
    await logEvent(client, id, 'EDITADO', actorId, { hash: sha256(a.text) });
    return { id, number: cur.number as string };
  });
}

// ---------------------------------------------------------------- fluxo

async function lock(client: PoolClient, id: string) {
  const c = await client.query('SELECT * FROM contracts WHERE id=$1 FOR UPDATE', [id]);
  if (!c.rowCount) throw err('CONTRACT_NOT_FOUND', 404);
  return c.rows[0];
}

export async function submitForApproval(id: string, actor: string) {
  return tx(async (client) => {
    const c = await lock(client, id);
    if (c.status !== 'RASCUNHO') throw err('CONTRACT_INVALID_STATE', 409);
    await client.query(`UPDATE contracts SET status='EM_APROVACAO',updated_at=now() WHERE id=$1`, [id]);
    await logEvent(client, id, 'ENVIADO_PARA_APROVACAO', actor, { hash: c.body_hash });
  });
}

/** Quem criou o contrato não o aprova (segunda pessoa). */
export async function approve(id: string, actor: string) {
  return tx(async (client) => {
    const c = await lock(client, id);
    if (c.status !== 'EM_APROVACAO') throw err('CONTRACT_INVALID_STATE', 409);
    if (c.created_by === actor) throw err('CONTRACT_APPROVER_MUST_DIFFER', 403);
    await client.query(`UPDATE contracts SET status='APROVADO',approved_by=$2,approved_at=now(),approved_hash=body_hash,updated_at=now() WHERE id=$1`, [id, actor]);
    await logEvent(client, id, 'APROVADO', actor, { hash: c.body_hash });
  });
}

export async function reject(id: string, actor: string, reason: string) {
  return tx(async (client) => {
    const c = await lock(client, id);
    if (c.status !== 'EM_APROVACAO') throw err('CONTRACT_INVALID_STATE', 409);
    await client.query(`UPDATE contracts SET status='RASCUNHO',updated_at=now() WHERE id=$1`, [id]);
    await logEvent(client, id, 'REPROVADO', actor, { reason: reason.slice(0, 300) });
  });
}

export async function cancel(id: string, actor: string, reason: string) {
  return tx(async (client) => {
    const c = await lock(client, id);
    if (['ASSINADO', 'CANCELADO', 'EXPIRADO', 'RECUSADO'].includes(c.status)) throw err('CONTRACT_INVALID_STATE', 409);
    await client.query(`UPDATE contracts SET status='CANCELADO',cancel_reason=$2,updated_at=now() WHERE id=$1`, [id, reason.slice(0, 300)]);
    for (const sg of (await client.query('SELECT id FROM contract_signers WHERE contract_id=$1', [id])).rows) await revokeSecureLinks('contract_signer', sg.id as string, client);
    await logEvent(client, id, 'CANCELADO', actor, { reason: reason.slice(0, 300) });
  });
}

export const esignAvailable = () => env.ESIGN_PROVIDER === 'internal';

/** Envia o link de assinatura. Exige aprovação e texto idêntico ao aprovado. */
export async function sendForSignature(id: string, actor: string, validDays = 7) {
  if (!esignAvailable()) throw err('ESIGN_NOT_CONFIGURED', 503);
  const result = await tx(async (client) => {
    const c = await lock(client, id);
    if (c.status !== 'APROVADO') throw err('CONTRACT_INVALID_STATE', 409);
    if (c.approved_hash !== c.body_hash) throw err('CONTRACT_CHANGED_AFTER_APPROVAL', 409);
    const s = (await client.query('SELECT id,name,email FROM contract_signers WHERE contract_id=$1', [id])).rows[0];
    const link = await createSecureLink({ purpose: 'CONTRACT_SIGN', resourceType: 'contract_signer', resourceId: s.id, recipientEmail: s.email, ttlHours: validDays * 24, maxUses: 10, createdBy: actor }, client);
    await client.query(`UPDATE contracts SET status='AGUARDANDO_ASSINATURA',sent_at=now(),expires_at=$2,updated_at=now() WHERE id=$1`, [id, link.expiresAt]);
    await logEvent(client, id, 'ENVIADO_PARA_ASSINATURA', actor, { signerId: s.id, expiresAt: link.expiresAt });
    return { signer: s, link, number: c.number as string };
  });
  const mail = await enqueueEmail({ idempotencyKey: `contract-sign:${id}:${result.link.id}`, template: 'CONTRACT_SIGN_REQUEST', toEmail: result.signer.email, toName: result.signer.name,
    data: { name: result.signer.name, documentNumber: result.number, linkPath: '/contrato/assinar/{token}', token: result.link.token, expiresAt: result.link.expiresAt.toISOString() },
    relatedType: 'CONTRACT', relatedId: id, createdBy: actor });
  return { expiresAt: result.link.expiresAt, emailId: mail.id };
}

// ---------------------------------------------------------------- assinatura (pública, por token)

const ipHash = (ip: string) => createHmac('sha256', env.JWT_SECRET).update(ip).digest('hex').slice(0, 32);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function viewForSigning(token: string) {
  const link = await peekSecureLink(token, ['CONTRACT_SIGN']);
  if (!link) return null;
  const r = await pool.query(`SELECT c.number,c.status,c.rendered_body,c.body_hash,c.expires_at,s.name,s.status AS signer_status FROM contract_signers s JOIN contracts c ON c.id=s.contract_id WHERE s.id=$1`, [link.resource_id]);
  if (!r.rowCount) return null;
  const c = r.rows[0];
  const open = c.status === 'AGUARDANDO_ASSINATURA' && c.signer_status === 'PENDENTE' && (!c.expires_at || new Date(c.expires_at) > new Date());
  return { number: c.number as string, status: c.status as string, signerName: c.name as string, body: c.rendered_body as string, bodyHash: c.body_hash as string, expiresAt: c.expires_at as Date | null, canSign: open };
}

export type SignResult = 'SIGNED' | 'INVALID_LINK' | 'NOT_OPEN' | 'HASH_MISMATCH' | 'NAME_MISMATCH' | 'NOT_ACCEPTED';
export async function signWithToken(token: string, input: { name: string; accept: boolean; bodyHash: string }, ctx: { ip: string; userAgent: string }): Promise<SignResult> {
  if (!input.accept) return 'NOT_ACCEPTED';
  const peek = await peekSecureLink(token, ['CONTRACT_SIGN']);
  if (!peek) return 'INVALID_LINK';
  const outcome = await tx(async (client) => {
    const s = await client.query('SELECT s.*,c.status AS cstatus,c.body_hash,c.expires_at,c.id AS cid,c.number FROM contract_signers s JOIN contracts c ON c.id=s.contract_id WHERE s.id=$1 FOR UPDATE OF s, c', [peek.resource_id]);
    if (!s.rowCount) return { r: 'INVALID_LINK' as SignResult };
    const row = s.rows[0];
    if (row.cstatus !== 'AGUARDANDO_ASSINATURA' || row.status !== 'PENDENTE' || (row.expires_at && new Date(row.expires_at) <= new Date())) return { r: 'NOT_OPEN' as SignResult };
    if (input.bodyHash !== row.body_hash) return { r: 'HASH_MISMATCH' as SignResult };
    if (norm(input.name) !== norm(row.name)) return { r: 'NAME_MISMATCH' as SignResult };
    const used = await consumeSecureLink(token, ['CONTRACT_SIGN'], client);
    if (!used) return { r: 'INVALID_LINK' as SignResult };
    const evidence = { method: 'ACEITE_ELETRONICO_SIMPLES', signedAtIso: new Date().toISOString(), ipHash: ipHash(ctx.ip), userAgent: ctx.userAgent.slice(0, 200), bodyHash: row.body_hash, typedName: input.name.trim().slice(0, 120) };
    await client.query(`UPDATE contract_signers SET status='ASSINADO',signed_at=now(),evidence=$2::jsonb WHERE id=$1`, [row.id, JSON.stringify(evidence)]);
    await revokeSecureLinks('contract_signer', row.id as string, client);
    await logEvent(client, row.cid, 'ASSINADO_PELO_SIGNATARIO', null, { signerId: row.id, ipHash: evidence.ipHash, bodyHash: row.body_hash });
    const pending = await client.query(`SELECT 1 FROM contract_signers WHERE contract_id=$1 AND status<>'ASSINADO'`, [row.cid]);
    let done: { id: string; number: string; signers: Array<{ id: string; name: string; email: string }> } | null = null;
    if (!pending.rowCount) {
      await client.query(`UPDATE contracts SET status='ASSINADO',signed_at=now(),updated_at=now() WHERE id=$1`, [row.cid]);
      await logEvent(client, row.cid, 'CONTRATO_ASSINADO', null, { bodyHash: row.body_hash });
      done = { id: row.cid, number: row.number, signers: (await client.query('SELECT id,name,email FROM contract_signers WHERE contract_id=$1', [row.cid])).rows };
    }
    return { r: 'SIGNED' as SignResult, done };
  });
  if (outcome.r === 'SIGNED' && 'done' in outcome && outcome.done) {
    for (const sg of outcome.done.signers) {
      const view = await createSecureLink({ purpose: 'CONTRACT_VIEW', resourceType: 'contract', resourceId: outcome.done.id, recipientEmail: sg.email, ttlHours: 24 * 30, maxUses: 50 });
      await enqueueEmail({ idempotencyKey: `contract-signed:${outcome.done.id}:${sg.id}`, template: 'CONTRACT_SIGNED', toEmail: sg.email, toName: sg.name,
        data: { name: sg.name, documentNumber: outcome.done.number, linkPath: '/contrato/{token}', token: view.token, expiresAt: view.expiresAt.toISOString() }, relatedType: 'CONTRACT', relatedId: outcome.done.id });
    }
  }
  return outcome.r;
}

export async function viewSigned(token: string) {
  const link = await consumeSecureLink(token, ['CONTRACT_VIEW']);
  if (!link) return null;
  const r = await pool.query(`SELECT number,status,rendered_body,body_hash,signed_at FROM contracts WHERE id=$1 AND status='ASSINADO'`, [link.resource_id]);
  if (!r.rowCount) return null;
  const sg = await pool.query(`SELECT name,signed_at,evidence->>'method' AS method FROM contract_signers WHERE contract_id=$1`, [link.resource_id]);
  return { number: r.rows[0].number, body: r.rows[0].rendered_body, bodyHash: r.rows[0].body_hash, signedAt: r.rows[0].signed_at, signers: sg.rows };
}

/** Marca como expirados os contratos cujo prazo de assinatura passou. */
export async function expireOverdue(): Promise<number> {
  const r = await pool.query(`UPDATE contracts SET status='EXPIRADO',updated_at=now() WHERE status='AGUARDANDO_ASSINATURA' AND expires_at < now() RETURNING id`);
  for (const row of r.rows) await pool.query(`INSERT INTO contract_events(contract_id,event) VALUES($1,'EXPIRADO')`, [row.id]);
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------- aplicar condições (ação separada)

/** Depois de assinado: grava preços da empresa e/ou comissão do parceiro. Itens personalizados exigem configuração manual. */
export async function applyTerms(id: string, actor: string) {
  return tx(async (client) => {
    const c = await lock(client, id);
    if (c.status !== 'ASSINADO') throw err('CONTRACT_NOT_SIGNED', 409);
    if (c.applied_at) throw err('CONTRACT_ALREADY_APPLIED', 409);
    const resolved = await resolveTerms(c.kind, c.terms.input, client); // reconfere piso de preço de hoje
    const months = Number(c.terms.input.validityMonths);
    const applied: string[] = []; const manual: string[] = [];
    for (const it of resolved.items) {
      if (it.type === 'QUERY' && c.organization_id) {
        await client.query(`INSERT INTO organization_query_prices(organization_id,product_id,price_cents,active,starts_at,ends_at,created_by)
          VALUES($1,$2,$3,true,$4,($4::timestamptz + make_interval(months => $5::int)),$6)
          ON CONFLICT(organization_id,product_id) DO UPDATE SET price_cents=EXCLUDED.price_cents,active=true,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,created_by=EXCLUDED.created_by,updated_at=now()`,
          [c.organization_id, it.productId, it.unitPriceCents, c.signed_at, months, actor]);
        applied.push(`preço ${it.name}`);
      } else manual.push(it.name);
    }
    if (resolved.commission && c.affiliate_id) {
      await client.query(`UPDATE affiliates SET commission_bps=$2,commission_base=$3,updated_at=now() WHERE id=$1`, [c.affiliate_id, resolved.commission.bps, resolved.commission.base]);
      applied.push('comissão do parceiro');
    }
    await client.query('UPDATE contracts SET applied_at=now(),applied_by=$2,updated_at=now() WHERE id=$1', [id, actor]);
    await logEvent(client, id, 'CONDICOES_APLICADAS', actor, { applied, manual });
    return { applied, manual };
  });
}
export { publicAppUrl };
