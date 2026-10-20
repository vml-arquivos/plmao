import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { BR_STATES, documentKind, formatDocument, onlyDigits, toCsv } from '../lib/br.js';
import { requirePermission } from '../permissions.js';

/**
 * Cobranças com parcelas (planos de pagamento) e controle de notas fiscais.
 *
 * Importante: este módulo CONTROLA a emissão (o que precisa de nota, dados do cliente, número,
 * chave, PDF/XML, cancelamento e exportação para o contador). A emissão automática na prefeitura/SEFAZ
 * exige certificado digital e um emissor contratado, e não está ligada: a nota é emitida no emissor
 * e registrada aqui.
 */
export const adminBillingRouter = Router();
adminBillingRouter.use(adminAuth);

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const conflict = (code: string) => appError(code, { code, http: 409, expose: true });
const notFound = (code: string) => appError(code, { code, http: 404, expose: true });
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'INVALID_DATE');
const httpsUrl = z.string().trim().max(500).url().refine((u) => u.startsWith('https://'), 'URL_MUST_BE_HTTPS');

// ------------------------------------------------------------------ cobranças

const METHODS = ['PIX', 'BOLETO', 'CARTAO', 'TRANSFERENCIA', 'DINHEIRO', 'OUTRO'] as const;

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10);
}

/** Divide o total em parcelas iguais; o resto de centavos vai para a última. */
export function planInstallments(totalCents: number, count: number, firstDue: string, frequency: 'MONTHLY' | 'WEEKLY'): Array<{ amountCents: number; dueDate: string }> {
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, i) => ({
    amountCents: i === count - 1 ? totalCents - base * (count - 1) : base,
    dueDate: frequency === 'MONTHLY' ? addMonths(firstDue, i) : addDays(firstDue, i * 7)
  }));
}

const chargeCreateSchema = z.object({
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  description: z.string().trim().min(3).max(200),
  totalCents: z.number().int().min(100).max(1_000_000_000),
  notes: optionalText(1000),
  plan: z.object({ count: z.number().int().min(1).max(36), firstDueDate: dateField, frequency: z.enum(['MONTHLY', 'WEEKLY']).default('MONTHLY') }).strict().optional(),
  installments: z.array(z.object({ amountCents: z.number().int().min(1), dueDate: dateField }).strict()).min(1).max(36).optional()
}).strict().superRefine((v, ctx) => {
  if (!v.customerId && !v.organizationId) ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'PAYER_REQUIRED' });
  if (!v.plan && !v.installments) ctx.addIssue({ code: 'custom', path: ['plan'], message: 'PLAN_REQUIRED' });
  if (v.installments && v.installments.reduce((s, i) => s + i.amountCents, 0) !== v.totalCents) ctx.addIssue({ code: 'custom', path: ['installments'], message: 'INSTALLMENTS_SUM_MISMATCH' });
});

const CHARGE_SELECT = `SELECT c.id,c.description,c.total_cents,c.status,c.notes,c.created_at,c.user_id,c.organization_id,
    coalesce(u.name,o.name) AS payer_name, u.email AS payer_email,
    CASE WHEN c.user_id IS NULL THEN 'EMPRESA' ELSE coalesce(p.customer_type,'PARTICULAR') END AS payer_type,
    o.name AS org_name,
    coalesce(s.paid_cents,0)::bigint AS paid_cents, coalesce(s.pending_cents,0)::bigint AS pending_cents, coalesce(s.overdue_cents,0)::bigint AS overdue_cents,
    coalesce(s.total_n,0)::int AS installments_total, coalesce(s.paid_n,0)::int AS installments_paid,
    to_char(s.next_due,'YYYY-MM-DD') AS next_due
  FROM charges c
  LEFT JOIN users u ON u.id=c.user_id
  LEFT JOIN user_profiles p ON p.user_id=c.user_id
  LEFT JOIN organizations o ON o.id=coalesce(c.organization_id, (SELECT organization_id FROM organization_members WHERE user_id=c.user_id LIMIT 1))
  LEFT JOIN LATERAL (
    SELECT sum(coalesce(i.paid_amount_cents,i.amount_cents)) FILTER (WHERE i.status='PAID') AS paid_cents,
           sum(i.amount_cents) FILTER (WHERE i.status='PENDING') AS pending_cents,
           sum(i.amount_cents) FILTER (WHERE i.status='PENDING' AND i.due_date < current_date) AS overdue_cents,
           count(*) FILTER (WHERE i.status <> 'CANCELLED') AS total_n,
           count(*) FILTER (WHERE i.status='PAID') AS paid_n,
           min(i.due_date) FILTER (WHERE i.status='PENDING') AS next_due
    FROM charge_installments i WHERE i.charge_id=c.id
  ) s ON true`;

function presentCharge(r: Record<string, unknown>) {
  const overdue = Number(r.overdue_cents ?? 0);
  const status = String(r.status);
  return {
    id: r.id, description: r.description, totalCents: Number(r.total_cents), status, notes: r.notes ?? null, createdAt: r.created_at,
    payer: { userId: r.user_id ?? null, organizationId: r.organization_id ?? null, name: r.payer_name ?? '—', email: r.payer_email ?? null, type: r.payer_type, companyName: r.org_name ?? null },
    paidCents: Number(r.paid_cents ?? 0), pendingCents: Number(r.pending_cents ?? 0), overdueCents: overdue,
    installmentsTotal: Number(r.installments_total ?? 0), installmentsPaid: Number(r.installments_paid ?? 0), nextDue: r.next_due ?? null,
    situation: status === 'CANCELLED' ? 'CANCELLED' : status === 'PAID' ? 'PAID' : overdue > 0 ? 'OVERDUE' : 'OPEN'
  };
}

const chargeListQuery = z.object({
  status: z.enum(['open', 'overdue', 'paid', 'cancelled', 'all']).default('open'),
  customerType: z.enum(['PARTICULAR', 'AUTONOMO', 'EMPRESA']).optional(),
  customerId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

adminBillingRouter.get('/charges', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = chargeListQuery.safeParse(req.query);
  if (!parsed.success) throw bad();
  const q = parsed.data;
  const where: string[] = []; const values: unknown[] = [];
  const push = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (q.status === 'open') where.push(`c.status='OPEN'`);
  if (q.status === 'overdue') where.push(`c.status='OPEN' AND coalesce(s.overdue_cents,0) > 0`);
  if (q.status === 'paid') where.push(`c.status='PAID'`);
  if (q.status === 'cancelled') where.push(`c.status='CANCELLED'`);
  if (q.customerType) where.push(`(CASE WHEN c.user_id IS NULL THEN 'EMPRESA' ELSE coalesce(p.customer_type,'PARTICULAR') END)=${push(q.customerType)}`);
  if (q.customerId) where.push(`c.user_id=${push(q.customerId)}`);
  if (q.organizationId) where.push(`(c.organization_id=${push(q.organizationId)} OR c.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=$${values.length}))`);
  if (q.search) { const l = push(`%${q.search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`); where.push(`(c.description ILIKE ${l} OR u.name ILIKE ${l} OR u.email ILIKE ${l} OR o.name ILIKE ${l})`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, total, summary] = await Promise.all([
    pool.query(`${CHARGE_SELECT} ${whereSql} ORDER BY (c.status='OPEN') DESC, s.next_due NULLS LAST, c.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`, values),
    pool.query(`SELECT count(*)::int AS n FROM charges c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN user_profiles p ON p.user_id=c.user_id
      LEFT JOIN organizations o ON o.id=coalesce(c.organization_id, (SELECT organization_id FROM organization_members WHERE user_id=c.user_id LIMIT 1))
      LEFT JOIN LATERAL (SELECT sum(i.amount_cents) FILTER (WHERE i.status='PENDING' AND i.due_date < current_date) AS overdue_cents FROM charge_installments i WHERE i.charge_id=c.id) s ON true ${whereSql}`, values),
    pool.query(`SELECT
        coalesce(sum(i.amount_cents) FILTER (WHERE i.status='PENDING' AND c.status='OPEN'),0)::bigint AS receivable_cents,
        coalesce(sum(i.amount_cents) FILTER (WHERE i.status='PENDING' AND c.status='OPEN' AND i.due_date < current_date),0)::bigint AS overdue_cents,
        coalesce(sum(i.amount_cents) FILTER (WHERE i.status='PENDING' AND c.status='OPEN' AND i.due_date BETWEEN current_date AND current_date + 7),0)::bigint AS due_week_cents,
        coalesce(sum(coalesce(i.paid_amount_cents,i.amount_cents)) FILTER (WHERE i.status='PAID' AND i.paid_at >= date_trunc('month', now())),0)::bigint AS received_month_cents,
        coalesce(sum(coalesce(i.paid_amount_cents,i.amount_cents)) FILTER (WHERE i.status='PAID'),0)::bigint AS received_total_cents,
        count(DISTINCT c.id) FILTER (WHERE i.status='PENDING' AND c.status='OPEN' AND i.due_date < current_date)::int AS overdue_charges
      FROM charge_installments i JOIN charges c ON c.id=i.charge_id`)
  ]);
  const s = summary.rows[0];
  res.json({
    items: rows.rows.map(presentCharge), total: Number(total.rows[0].n),
    summary: { receivableCents: Number(s.receivable_cents), overdueCents: Number(s.overdue_cents), dueWeekCents: Number(s.due_week_cents), receivedMonthCents: Number(s.received_month_cents), receivedTotalCents: Number(s.received_total_cents), overdueCharges: Number(s.overdue_charges) }
  });
}));

adminBillingRouter.post('/charges', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = chargeCreateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const v = parsed.data;
  if (v.customerId) {
    const c = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role='CLIENTE' AND deleted_at IS NULL`, [v.customerId]);
    if (!c.rowCount) throw notFound('CUSTOMER_NOT_FOUND');
  }
  if (v.organizationId) {
    const o = await pool.query('SELECT 1 FROM organizations WHERE id=$1', [v.organizationId]);
    if (!o.rowCount) throw notFound('COMPANY_NOT_FOUND');
  }
  const plan = v.installments ?? planInstallments(v.totalCents, v.plan!.count, v.plan!.firstDueDate, v.plan!.frequency);
  const id = await tx(async (client) => {
    const charge = await client.query(`INSERT INTO charges(user_id,organization_id,description,total_cents,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [v.customerId ?? null, v.organizationId ?? null, v.description, v.totalCents, v.notes, req.user!.id]);
    const chargeId = String(charge.rows[0].id);
    for (const [index, item] of plan.entries()) {
      await client.query('INSERT INTO charge_installments(charge_id,number,amount_cents,due_date) VALUES($1,$2,$3,$4)', [chargeId, index + 1, item.amountCents, item.dueDate]);
    }
    return chargeId;
  });
  await audit(req.user!.id, 'CHARGE_CREATED', 'CHARGE', id, { totalCents: v.totalCents, installments: plan.length, requestId: requestId(req) });
  res.status(201).json(await loadCharge(id));
}));

async function loadCharge(id: string) {
  const [charge, installments, docs] = await Promise.all([
    pool.query(`${CHARGE_SELECT} WHERE c.id=$1`, [id]),
    pool.query(`SELECT i.id,i.number,i.amount_cents,to_char(i.due_date,'YYYY-MM-DD') AS due_date,i.status,i.paid_at,i.paid_amount_cents,i.method,i.reference,
        (i.status='PENDING' AND i.due_date < current_date) AS overdue,
        (SELECT d.id FROM fiscal_documents d WHERE d.installment_id=i.id AND d.status <> 'CANCELLED' LIMIT 1) AS fiscal_document_id
      FROM charge_installments i WHERE i.charge_id=$1 ORDER BY i.number`, [id]),
    pool.query(`SELECT id,kind,status,amount_cents,number FROM fiscal_documents WHERE charge_id=$1 AND status <> 'CANCELLED' ORDER BY created_at`, [id])
  ]);
  if (!charge.rowCount) throw notFound('CHARGE_NOT_FOUND');
  return {
    charge: presentCharge(charge.rows[0]),
    installments: installments.rows.map((i) => ({ id: i.id, number: i.number, amountCents: Number(i.amount_cents), dueDate: i.due_date, status: i.status, overdue: Boolean(i.overdue), paidAt: i.paid_at ?? null,
      paidAmountCents: i.paid_amount_cents == null ? null : Number(i.paid_amount_cents), method: i.method ?? null, reference: i.reference ?? null, fiscalDocumentId: i.fiscal_document_id ?? null })),
    fiscalDocuments: docs.rows.map((d) => ({ id: d.id, kind: d.kind, status: d.status, amountCents: Number(d.amount_cents), number: d.number ?? null }))
  };
}

adminBillingRouter.get('/charges/:id', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('CHARGE_NOT_FOUND');
  res.json(await loadCharge(req.params.id));
}));

/** Recalcula a situação da cobrança a partir das parcelas. */
async function refreshChargeStatus(client: PoolClient, chargeId: string): Promise<void> {
  await client.query(`UPDATE charges c SET updated_at=now(), status = CASE
      WHEN NOT EXISTS (SELECT 1 FROM charge_installments i WHERE i.charge_id=c.id AND i.status <> 'CANCELLED') THEN 'CANCELLED'
      WHEN NOT EXISTS (SELECT 1 FROM charge_installments i WHERE i.charge_id=c.id AND i.status = 'PENDING') THEN 'PAID'
      ELSE 'OPEN' END,
    cancelled_at = CASE WHEN NOT EXISTS (SELECT 1 FROM charge_installments i WHERE i.charge_id=c.id AND i.status <> 'CANCELLED') THEN coalesce(c.cancelled_at, now()) ELSE NULL END
    WHERE c.id=$1`, [chargeId]);
}

const paySchema = z.object({
  method: z.enum(METHODS),
  paidAt: dateField.optional(),
  paidAmountCents: z.number().int().min(1).max(1_000_000_000).optional(),
  reference: optionalText(120),
  createFiscalDocument: z.boolean().default(false)
}).strict();

adminBillingRouter.post('/charges/:id/installments/:installmentId/pay', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.installmentId)) throw notFound('CHARGE_NOT_FOUND');
  const parsed = paySchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  await tx(async (client) => {
    const row = await client.query(`SELECT i.id,i.amount_cents,i.status,i.number,c.status AS charge_status,c.user_id,c.organization_id,c.description
      FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE i.id=$1 AND c.id=$2 FOR UPDATE OF i`, [req.params.installmentId, req.params.id]);
    if (!row.rowCount) throw notFound('INSTALLMENT_NOT_FOUND');
    const i = row.rows[0];
    if (i.charge_status === 'CANCELLED') throw conflict('CHARGE_CANCELLED');
    if (i.status !== 'PENDING') throw conflict('INSTALLMENT_NOT_PENDING');
    const paidAmount = v.paidAmountCents ?? Number(i.amount_cents);
    await client.query(`UPDATE charge_installments SET status='PAID',paid_at=coalesce($2::date + time '12:00', now()),paid_amount_cents=$3,method=$4,reference=$5 WHERE id=$1`,
      [i.id, v.paidAt ?? null, paidAmount, v.method, v.reference]);
    await refreshChargeStatus(client, String(req.params.id));
    if (v.createFiscalDocument) {
      await createFiscalDocumentRow(client, {
        userId: i.user_id, organizationId: i.organization_id, amountCents: paidAmount, description: `${i.description} — parcela ${i.number}`,
        chargeId: String(req.params.id), installmentId: String(i.id), createdBy: req.user!.id
      });
    }
  });
  await audit(req.user!.id, 'INSTALLMENT_PAID', 'CHARGE', String(req.params.id), { installmentId: req.params.installmentId, method: v.method, requestId: requestId(req) });
  res.json(await loadCharge(String(req.params.id)));
}));

/** Gera a nota "a emitir" de uma parcela já paga que ainda não tem nota. */
adminBillingRouter.post('/charges/:id/installments/:installmentId/fiscal-document', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.installmentId)) throw notFound('INSTALLMENT_NOT_FOUND');
  await tx(async (client) => {
    const row = await client.query(`SELECT i.id,i.number,i.status,coalesce(i.paid_amount_cents,i.amount_cents) AS amount,c.user_id,c.organization_id,c.description
      FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE i.id=$1 AND c.id=$2 FOR UPDATE OF i`, [req.params.installmentId, req.params.id]);
    if (!row.rowCount) throw notFound('INSTALLMENT_NOT_FOUND');
    const i = row.rows[0];
    if (i.status !== 'PAID') throw conflict('INSTALLMENT_NOT_PAID');
    const existing = await client.query(`SELECT 1 FROM fiscal_documents WHERE installment_id=$1 AND status <> 'CANCELLED'`, [i.id]);
    if (existing.rowCount) throw conflict('FISCAL_DOCUMENT_EXISTS');
    await createFiscalDocumentRow(client, { userId: i.user_id, organizationId: i.organization_id, amountCents: Number(i.amount), description: `${i.description} — parcela ${i.number}`, chargeId: String(req.params.id), installmentId: String(i.id), createdBy: req.user!.id });
  });
  await audit(req.user!.id, 'FISCAL_DOCUMENT_CREATED', 'CHARGE', String(req.params.id), { installmentId: req.params.installmentId, requestId: requestId(req) });
  res.json(await loadCharge(String(req.params.id)));
}));

adminBillingRouter.post('/charges/:id/installments/:installmentId/reopen', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.installmentId)) throw notFound('CHARGE_NOT_FOUND');
  await tx(async (client) => {
    const row = await client.query(`SELECT i.status,c.status AS charge_status,
        EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.installment_id=i.id AND d.status='ISSUED') AS has_issued
      FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE i.id=$1 AND c.id=$2 FOR UPDATE OF i`, [req.params.installmentId, req.params.id]);
    if (!row.rowCount) throw notFound('INSTALLMENT_NOT_FOUND');
    if (row.rows[0].charge_status === 'CANCELLED') throw conflict('CHARGE_CANCELLED');
    if (row.rows[0].status !== 'PAID') throw conflict('INSTALLMENT_NOT_PAID');
    if (row.rows[0].has_issued) throw conflict('INSTALLMENT_HAS_ISSUED_INVOICE');
    await client.query(`UPDATE fiscal_documents SET status='CANCELLED',cancelled_at=now(),cancel_reason='Pagamento da parcela foi desfeito',updated_at=now() WHERE installment_id=$1 AND status='PENDING'`, [req.params.installmentId]);
    await client.query(`UPDATE charge_installments SET status='PENDING',paid_at=NULL,paid_amount_cents=NULL,method=NULL,reference=NULL WHERE id=$1`, [req.params.installmentId]);
    await refreshChargeStatus(client, String(req.params.id));
  });
  await audit(req.user!.id, 'INSTALLMENT_REOPENED', 'CHARGE', String(req.params.id), { installmentId: req.params.installmentId, requestId: requestId(req) });
  res.json(await loadCharge(String(req.params.id)));
}));

adminBillingRouter.patch('/charges/:id/installments/:installmentId', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id) || !isUuid(req.params.installmentId)) throw notFound('CHARGE_NOT_FOUND');
  const parsed = z.object({ dueDate: dateField }).strict().safeParse(req.body);
  if (!parsed.success) throw bad();
  const r = await pool.query(`UPDATE charge_installments SET due_date=$3 WHERE id=$1 AND charge_id=$2 AND status='PENDING' RETURNING id`, [req.params.installmentId, req.params.id, parsed.data.dueDate]);
  if (!r.rowCount) throw conflict('INSTALLMENT_NOT_PENDING');
  await audit(req.user!.id, 'INSTALLMENT_RESCHEDULED', 'CHARGE', String(req.params.id), { installmentId: req.params.installmentId, requestId: requestId(req) });
  res.json(await loadCharge(String(req.params.id)));
}));

adminBillingRouter.post('/charges/:id/cancel', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('CHARGE_NOT_FOUND');
  await tx(async (client) => {
    const row = await client.query('SELECT status FROM charges WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!row.rowCount) throw notFound('CHARGE_NOT_FOUND');
    if (row.rows[0].status === 'CANCELLED') throw conflict('CHARGE_CANCELLED');
    await client.query(`UPDATE charge_installments SET status='CANCELLED' WHERE charge_id=$1 AND status='PENDING'`, [req.params.id]);
    await client.query(`UPDATE fiscal_documents SET status='CANCELLED',cancelled_at=now(),cancel_reason='Cobrança cancelada',updated_at=now() WHERE charge_id=$1 AND status='PENDING'`, [req.params.id]);
    await refreshChargeStatus(client, String(req.params.id));
    // se já havia parcelas pagas, a cobrança permanece como paga/parcial: só cancela de fato quando nada foi recebido
  });
  await audit(req.user!.id, 'CHARGE_CANCELLED', 'CHARGE', String(req.params.id), { requestId: requestId(req) });
  res.json(await loadCharge(String(req.params.id)));
}));

adminBillingRouter.delete('/charges/:id', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('CHARGE_NOT_FOUND');
  const used = await pool.query(`SELECT (SELECT count(*)::int FROM charge_installments WHERE charge_id=$1 AND status='PAID') AS paid, (SELECT count(*)::int FROM fiscal_documents WHERE charge_id=$1 AND status='ISSUED') AS issued`, [req.params.id]);
  if (Number(used.rows[0].paid) > 0 || Number(used.rows[0].issued) > 0) throw conflict('CHARGE_HAS_HISTORY');
  const r = await pool.query('DELETE FROM charges WHERE id=$1 RETURNING id', [req.params.id]);
  if (!r.rowCount) throw notFound('CHARGE_NOT_FOUND');
  await audit(req.user!.id, 'CHARGE_DELETED', 'CHARGE', String(req.params.id), { requestId: requestId(req) });
  res.status(204).end();
}));

// ------------------------------------------------------------------ fiscal: dados do cliente

interface Snapshot { name: string; document: string | null; documentKind: string | null; email: string | null; phone: string | null; legalName: string | null; stateRegistration: string | null; municipalRegistration: string | null;
  zip: string | null; street: string | null; streetNumber: string | null; complement: string | null; district: string | null; city: string | null; state: string | null; type: string }

export function missingFiscalFields(s: Pick<Snapshot, 'document' | 'documentKind' | 'street' | 'city' | 'state' | 'zip' | 'email'>): string[] {
  const missing: string[] = [];
  if (!s.document || !s.documentKind) missing.push('CPF/CNPJ');
  if (!s.street) missing.push('Endereço');
  if (!s.zip) missing.push('CEP');
  if (!s.city) missing.push('Cidade');
  if (!s.state) missing.push('UF');
  if (!s.email) missing.push('E-mail');
  return missing;
}

async function buildSnapshot(client: Pick<PoolClient, 'query'>, userId: string | null, organizationId: string | null): Promise<Snapshot> {
  if (organizationId || !userId) {
    const orgId = organizationId ?? null;
    const org = orgId ? await client.query('SELECT * FROM organizations WHERE id=$1', [orgId]) : null;
    if (org?.rowCount) {
      const o = org.rows[0];
      return { name: String(o.legal_name ?? o.name), document: o.document ?? null, documentKind: documentKind(o.document), email: o.email ?? null, phone: o.phone ?? null, legalName: o.legal_name ?? null,
        stateRegistration: o.state_registration ?? null, municipalRegistration: o.municipal_registration ?? null, zip: o.zip ?? null, street: o.street ?? null, streetNumber: o.street_number ?? null,
        complement: o.complement ?? null, district: o.district ?? null, city: o.city ?? null, state: o.state ? String(o.state).trim() : null, type: 'EMPRESA' };
    }
  }
  const row = await client.query(`SELECT u.name,u.email,p.* FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`, [userId]);
  const r = row.rows[0] ?? {};
  const doc = r.cpf_cnpj ? onlyDigits(r.cpf_cnpj) : null;
  return { name: String(r.legal_name ?? r.name ?? '—'), document: doc, documentKind: documentKind(doc), email: r.billing_email ?? r.email ?? null, phone: r.phone ?? null, legalName: r.legal_name ?? null,
    stateRegistration: r.state_registration ?? null, municipalRegistration: r.municipal_registration ?? null, zip: r.zip ?? null, street: r.street ?? null, streetNumber: r.street_number ?? null,
    complement: r.complement ?? null, district: r.district ?? null, city: r.city ?? null, state: r.state ? String(r.state).trim() : null, type: r.customer_type ?? 'PARTICULAR' };
}

async function createFiscalDocumentRow(client: PoolClient, input: {
  userId: string | null; organizationId: string | null; amountCents: number; description: string; kind?: 'NFSE' | 'NFE';
  paymentId?: string | null; chargeId?: string | null; installmentId?: string | null; notes?: string | null; createdBy: string | null;
}): Promise<string> {
  const snapshot = await buildSnapshot(client, input.userId, input.organizationId);
  const row = await client.query(`INSERT INTO fiscal_documents(kind,user_id,organization_id,payment_id,charge_id,installment_id,amount_cents,description,customer_snapshot,notes,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING id`,
  [input.kind ?? 'NFSE', input.userId, input.organizationId, input.paymentId ?? null, input.chargeId ?? null, input.installmentId ?? null, input.amountCents, input.description, JSON.stringify(snapshot), input.notes ?? null, input.createdBy]);
  return String(row.rows[0].id);
}

// ------------------------------------------------------------------ fiscal: configuração do emissor

const settingsSchema = z.object({
  legalName: optionalText(160), tradeName: optionalText(160),
  cnpj: z.string().trim().max(30).nullish().transform((v) => (v ? onlyDigits(v) : null)).refine((v) => v === null || documentKind(v) === 'CNPJ', 'INVALID_CNPJ'),
  stateRegistration: optionalText(30), municipalRegistration: optionalText(30),
  taxRegime: z.enum(['MEI', 'SIMPLES', 'PRESUMIDO', 'REAL']),
  cnae: optionalText(20), serviceCode: optionalText(20), serviceDescription: optionalText(400),
  issRateBps: z.number().int().min(0).max(1000).nullish().transform((v) => v ?? null),
  city: optionalText(80), state: z.string().trim().toUpperCase().refine((s) => (BR_STATES as readonly string[]).includes(s), 'INVALID_STATE').nullish().transform((v) => v ?? null),
  cityIbgeCode: z.string().trim().regex(/^\d{7}$/).nullish().transform((v) => v ?? null),
  zip: z.string().trim().max(12).nullish().transform((v) => (v ? onlyDigits(v) || null : null)),
  street: optionalText(160), streetNumber: optionalText(20), district: optionalText(80),
  email: z.string().trim().toLowerCase().email().max(254).nullish().transform((v) => v ?? null), phone: optionalText(30),
  environment: z.enum(['HOMOLOGACAO', 'PRODUCAO']), series: z.string().trim().min(1).max(5),
  accountantEmail: z.string().trim().toLowerCase().email().max(254).nullish().transform((v) => v ?? null),
  notes: optionalText(1000)
}).strict();
const SETTINGS_COLS: Record<string, string> = {
  legalName: 'legal_name', tradeName: 'trade_name', cnpj: 'cnpj', stateRegistration: 'state_registration', municipalRegistration: 'municipal_registration', taxRegime: 'tax_regime', cnae: 'cnae',
  serviceCode: 'service_code', serviceDescription: 'service_description', issRateBps: 'iss_rate_bps', city: 'city', state: 'state', cityIbgeCode: 'city_ibge_code', zip: 'zip', street: 'street',
  streetNumber: 'street_number', district: 'district', email: 'email', phone: 'phone', environment: 'environment', series: 'series', accountantEmail: 'accountant_email', notes: 'notes'
};
function presentSettings(r: Record<string, unknown>): Record<string, unknown> & { ready: boolean; missing: string[] } {
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(SETTINGS_COLS)) out[k] = k === 'cnpj' ? formatDocument(r[col] as string | null) : (k === 'state' && r[col] ? String(r[col]).trim() : (r[col] ?? null));
  const required = ['legal_name', 'cnpj', 'municipal_registration', 'service_code', 'city', 'state', 'tax_regime'];
  return { ...out, emissionMode: r.emission_mode, ready: required.every((c) => Boolean(r[c])), missing: required.filter((c) => !r[c]) };
}

adminBillingRouter.get('/fiscal/settings', requirePermission('MANAGE_FISCAL'), asyncRoute(async (_req, res) => {
  const row = await pool.query('SELECT * FROM fiscal_settings WHERE id=1');
  res.json(presentSettings(row.rows[0]));
}));

adminBillingRouter.put('/fiscal/settings', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const v = parsed.data as Record<string, unknown>;
  const keys = Object.keys(SETTINGS_COLS);
  await pool.query(`UPDATE fiscal_settings SET ${keys.map((k, i) => `${SETTINGS_COLS[k]}=$${i + 1}`).join(',')},updated_by=$${keys.length + 1},updated_at=now() WHERE id=1`, [...keys.map((k) => v[k] ?? null), req.user!.id]);
  await audit(req.user!.id, 'FISCAL_SETTINGS_UPDATED', 'FISCAL_SETTINGS', '1', { environment: v.environment, requestId: requestId(req) });
  const row = await pool.query('SELECT * FROM fiscal_settings WHERE id=1');
  res.json(presentSettings(row.rows[0]));
}));

// ------------------------------------------------------------------ fiscal: documentos

const DOC_SELECT = `SELECT d.*, coalesce(d.customer_snapshot->>'type', 'PARTICULAR') AS payer_type
  FROM fiscal_documents d`;
function presentDoc(r: Record<string, unknown>) {
  const snap = (r.customer_snapshot ?? {}) as Record<string, unknown>;
  const doc = typeof snap.document === 'string' ? snap.document : null;
  return {
    id: r.id, kind: r.kind, status: r.status, amountCents: Number(r.amount_cents), description: r.description, number: r.number ?? null, series: r.series ?? null,
    accessKey: r.access_key ?? null, verificationCode: r.verification_code ?? null, issuedAt: r.issued_at ?? null, pdfUrl: r.pdf_url ?? null, xmlUrl: r.xml_url ?? null,
    cancelReason: r.cancel_reason ?? null, cancelledAt: r.cancelled_at ?? null, notes: r.notes ?? null, createdAt: r.created_at,
    paymentId: r.payment_id ?? null, chargeId: r.charge_id ?? null, installmentId: r.installment_id ?? null, userId: r.user_id ?? null, organizationId: r.organization_id ?? null,
    customer: { name: snap.name ?? '—', document: formatDocument(doc), documentKind: snap.documentKind ?? null, email: snap.email ?? null, type: r.payer_type, city: snap.city ?? null, state: snap.state ?? null },
    missing: r.status === 'PENDING' ? missingFiscalFields({ document: doc, documentKind: (snap.documentKind as string | null) ?? null, street: (snap.street as string | null) ?? null, city: (snap.city as string | null) ?? null, state: (snap.state as string | null) ?? null, zip: (snap.zip as string | null) ?? null, email: (snap.email as string | null) ?? null }) : []
  };
}

const docListQuery = z.object({
  status: z.enum(['PENDING', 'ISSUED', 'CANCELLED', 'all']).default('PENDING'),
  kind: z.enum(['NFSE', 'NFE']).optional(),
  customerType: z.enum(['PARTICULAR', 'AUTONOMO', 'EMPRESA']).optional(),
  search: z.string().trim().max(80).optional(),
  from: dateField.optional(), to: dateField.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
function docFilters(q: z.infer<typeof docListQuery>) {
  const where: string[] = []; const values: unknown[] = [];
  const push = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (q.status !== 'all') where.push(`d.status=${push(q.status)}`);
  if (q.kind) where.push(`d.kind=${push(q.kind)}`);
  if (q.customerType) where.push(`coalesce(d.customer_snapshot->>'type','PARTICULAR')=${push(q.customerType)}`);
  if (q.search) { const l = push(`%${q.search.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`); where.push(`(d.customer_snapshot->>'name' ILIKE ${l} OR d.description ILIKE ${l} OR d.number ILIKE ${l} OR d.customer_snapshot->>'document' LIKE ${l})`); }
  if (q.from) where.push(`coalesce(d.issued_at,d.created_at) >= ${push(q.from)}::date`);
  if (q.to) where.push(`coalesce(d.issued_at,d.created_at) < ${push(q.to)}::date + 1`);
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

adminBillingRouter.get('/fiscal/summary', requirePermission('MANAGE_FISCAL'), asyncRoute(async (_req, res) => {
  const [docs, unbilled, settings] = await Promise.all([
    pool.query(`SELECT
        count(*) FILTER (WHERE status='PENDING')::int AS pending, coalesce(sum(amount_cents) FILTER (WHERE status='PENDING'),0)::bigint AS pending_cents,
        count(*) FILTER (WHERE status='ISSUED' AND issued_at >= date_trunc('month', now()))::int AS issued_month, coalesce(sum(amount_cents) FILTER (WHERE status='ISSUED' AND issued_at >= date_trunc('month', now())),0)::bigint AS issued_month_cents,
        count(*) FILTER (WHERE status='CANCELLED' AND cancelled_at >= date_trunc('month', now()))::int AS cancelled_month
      FROM fiscal_documents`),
    pool.query(`SELECT count(*)::int AS n, coalesce(sum(p.amount_cents),0)::bigint AS cents FROM payments p
      WHERE p.status='PAID' AND p.paid_at >= now() - interval '120 days' AND NOT EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.payment_id=p.id AND d.status <> 'CANCELLED')`),
    pool.query('SELECT * FROM fiscal_settings WHERE id=1')
  ]);
  const d = docs.rows[0];
  const s = presentSettings(settings.rows[0]);
  res.json({ pending: Number(d.pending), pendingCents: Number(d.pending_cents), issuedMonth: Number(d.issued_month), issuedMonthCents: Number(d.issued_month_cents), cancelledMonth: Number(d.cancelled_month),
    paymentsWithoutDocument: Number(unbilled.rows[0].n), paymentsWithoutDocumentCents: Number(unbilled.rows[0].cents), settingsReady: s.ready, settingsMissing: s.missing, environment: s.environment });
}));

adminBillingRouter.get('/fiscal/documents', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  const parsed = docListQuery.safeParse(req.query);
  if (!parsed.success) throw bad();
  const { whereSql, values } = docFilters(parsed.data);
  const [rows, total] = await Promise.all([
    pool.query(`${DOC_SELECT} ${whereSql} ORDER BY coalesce(d.issued_at,d.created_at) DESC LIMIT ${parsed.data.limit} OFFSET ${parsed.data.offset}`, values),
    pool.query(`SELECT count(*)::int AS n FROM fiscal_documents d ${whereSql}`, values)
  ]);
  res.json({ items: rows.rows.map(presentDoc), total: Number(total.rows[0].n) });
}));

adminBillingRouter.get('/fiscal/documents/export.csv', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  const parsed = docListQuery.safeParse({ ...req.query, limit: 500, offset: 0 });
  if (!parsed.success) throw bad();
  const { whereSql, values } = docFilters(parsed.data);
  const rows = await pool.query(`${DOC_SELECT} ${whereSql} ORDER BY coalesce(d.issued_at,d.created_at) DESC LIMIT 5000`, values);
  const money = (c: unknown) => (Number(c) / 100).toFixed(2).replace('.', ',');
  const date = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '');
  const csv = toCsv(['Tipo', 'Situação', 'Número', 'Série', 'Emissão', 'Cliente', 'CPF/CNPJ', 'E-mail', 'Descrição', 'Valor (R$)', 'Chave de acesso', 'Código de verificação'],
    rows.rows.map((r) => { const p = presentDoc(r); return [p.kind === 'NFSE' ? 'NFS-e' : 'NF-e', p.status === 'ISSUED' ? 'Emitida' : p.status === 'PENDING' ? 'A emitir' : 'Cancelada', p.number, p.series, date(r.issued_at ?? r.created_at), p.customer.name, p.customer.document, p.customer.email, p.description, money(p.amountCents), p.accessKey, p.verificationCode]; }));
  await audit(req.user!.id, 'FISCAL_EXPORTED', 'FISCAL_DOCUMENT', null, { rows: rows.rowCount, requestId: requestId(req) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="notas-fiscais.csv"');
  res.send(csv);
}));

const docCreateSchema = z.object({
  customerId: z.string().uuid().optional(), organizationId: z.string().uuid().optional(),
  kind: z.enum(['NFSE', 'NFE']).default('NFSE'),
  description: z.string().trim().min(3).max(300),
  amountCents: z.number().int().min(1).max(1_000_000_000),
  notes: optionalText(500)
}).strict().refine((v) => v.customerId || v.organizationId, 'PAYER_REQUIRED');

adminBillingRouter.post('/fiscal/documents', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  const parsed = docCreateSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  if (v.customerId) { const c = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role='CLIENTE' AND deleted_at IS NULL`, [v.customerId]); if (!c.rowCount) throw notFound('CUSTOMER_NOT_FOUND'); }
  if (v.organizationId) { const o = await pool.query('SELECT 1 FROM organizations WHERE id=$1', [v.organizationId]); if (!o.rowCount) throw notFound('COMPANY_NOT_FOUND'); }
  const id = await tx((client) => createFiscalDocumentRow(client, { userId: v.customerId ?? null, organizationId: v.organizationId ?? null, amountCents: v.amountCents, description: v.description, kind: v.kind, notes: v.notes, createdBy: req.user!.id }));
  await audit(req.user!.id, 'FISCAL_DOCUMENT_CREATED', 'FISCAL_DOCUMENT', id, { amountCents: v.amountCents, requestId: requestId(req) });
  const row = await pool.query(`${DOC_SELECT} WHERE d.id=$1`, [id]);
  res.status(201).json(presentDoc(row.rows[0]));
}));

/** Cria "notas a emitir" para pagamentos confirmados que ainda não têm nota. */
adminBillingRouter.post('/fiscal/sync', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  const created = await tx(async (client) => {
    const payments = await client.query(`SELECT p.id,p.user_id,p.amount_cents,o.purchase_type,pr.name AS product_name
      FROM payments p LEFT JOIN payment_orders o ON o.id=p.order_id LEFT JOIN query_products pr ON pr.id=o.product_id
      WHERE p.status='PAID' AND p.paid_at >= now() - interval '120 days' AND p.amount_cents > 0
        AND NOT EXISTS (SELECT 1 FROM fiscal_documents d WHERE d.payment_id=p.id AND d.status <> 'CANCELLED')
      ORDER BY p.paid_at LIMIT 300`);
    for (const p of payments.rows) {
      const description = p.purchase_type === 'QUERY' && p.product_name ? `Serviço de consulta veicular — ${p.product_name}` : 'Saldo pré-pago para consultas veiculares';
      await createFiscalDocumentRow(client, { userId: String(p.user_id), organizationId: null, amountCents: Number(p.amount_cents), description, paymentId: String(p.id), createdBy: req.user!.id });
    }
    return payments.rowCount ?? 0;
  });
  await audit(req.user!.id, 'FISCAL_SYNC', 'FISCAL_DOCUMENT', null, { created, requestId: requestId(req) });
  res.json({ created });
}));

const issueSchema = z.object({
  number: z.string().trim().min(1).max(30), series: z.string().trim().max(5).nullish().transform((v) => v ?? null),
  accessKey: z.string().trim().max(60).nullish().transform((v) => (v ? v : null)),
  verificationCode: z.string().trim().max(60).nullish().transform((v) => (v ? v : null)),
  issuedAt: dateField.optional(),
  pdfUrl: httpsUrl.nullish().transform((v) => v ?? null), xmlUrl: httpsUrl.nullish().transform((v) => v ?? null)
}).strict();

adminBillingRouter.post('/fiscal/documents/:id/issue', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  await tx(async (client) => {
    const row = await client.query('SELECT status,kind FROM fiscal_documents WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!row.rowCount) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
    if (row.rows[0].status !== 'PENDING') throw conflict('FISCAL_DOCUMENT_NOT_PENDING');
    const dup = await client.query(`SELECT 1 FROM fiscal_documents WHERE kind=$1 AND number=$2 AND coalesce(series,'')=coalesce($3,'') AND status='ISSUED'`, [row.rows[0].kind, v.number, v.series]);
    if (dup.rowCount) throw conflict('FISCAL_NUMBER_IN_USE');
    await client.query(`UPDATE fiscal_documents SET status='ISSUED',number=$2,series=$3,access_key=$4,verification_code=$5,issued_at=coalesce($6::date + time '12:00', now()),pdf_url=$7,xml_url=$8,updated_at=now() WHERE id=$1`,
      [req.params.id, v.number, v.series, v.accessKey, v.verificationCode, v.issuedAt ?? null, v.pdfUrl, v.xmlUrl]);
  });
  await audit(req.user!.id, 'FISCAL_DOCUMENT_ISSUED', 'FISCAL_DOCUMENT', String(req.params.id), { number: v.number, requestId: requestId(req) });
  const out = await pool.query(`${DOC_SELECT} WHERE d.id=$1`, [req.params.id]);
  res.json(presentDoc(out.rows[0]));
}));

adminBillingRouter.post('/fiscal/documents/:id/cancel', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
  const parsed = z.object({ reason: z.string().trim().min(5).max(300) }).strict().safeParse(req.body);
  if (!parsed.success) throw bad();
  const r = await pool.query(`UPDATE fiscal_documents SET status='CANCELLED',cancelled_at=now(),cancel_reason=$2,updated_at=now() WHERE id=$1 AND status IN ('PENDING','ISSUED') RETURNING id`, [req.params.id, parsed.data.reason]);
  if (!r.rowCount) throw conflict('FISCAL_DOCUMENT_NOT_ACTIVE');
  await audit(req.user!.id, 'FISCAL_DOCUMENT_CANCELLED', 'FISCAL_DOCUMENT', String(req.params.id), { requestId: requestId(req) });
  const out = await pool.query(`${DOC_SELECT} WHERE d.id=$1`, [req.params.id]);
  res.json(presentDoc(out.rows[0]));
}));

adminBillingRouter.delete('/fiscal/documents/:id', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
  const r = await pool.query(`DELETE FROM fiscal_documents WHERE id=$1 AND status='PENDING' RETURNING id`, [req.params.id]);
  if (!r.rowCount) throw conflict('FISCAL_DOCUMENT_NOT_PENDING');
  await audit(req.user!.id, 'FISCAL_DOCUMENT_DELETED', 'FISCAL_DOCUMENT', String(req.params.id), { requestId: requestId(req) });
  res.status(204).end();
}));

/** Atualiza os dados de um documento pendente com o cadastro atual do cliente (após corrigir CPF/CNPJ, endereço etc.). */
adminBillingRouter.post('/fiscal/documents/:id/refresh-customer', requirePermission('MANAGE_FISCAL'), asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
  const row = await pool.query(`SELECT user_id,organization_id,status FROM fiscal_documents WHERE id=$1`, [req.params.id]);
  if (!row.rowCount) throw notFound('FISCAL_DOCUMENT_NOT_FOUND');
  if (row.rows[0].status !== 'PENDING') throw conflict('FISCAL_DOCUMENT_NOT_PENDING');
  const snap = await buildSnapshot(pool, row.rows[0].user_id, row.rows[0].organization_id);
  await pool.query(`UPDATE fiscal_documents SET customer_snapshot=$2::jsonb,updated_at=now() WHERE id=$1`, [req.params.id, JSON.stringify(snap)]);
  const out = await pool.query(`${DOC_SELECT} WHERE d.id=$1`, [req.params.id]);
  res.json(presentDoc(out.rows[0]));
}));
