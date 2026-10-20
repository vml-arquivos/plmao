import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { formatBRL, formatBps } from '../lib/money.js';
import { hasPermission, requirePermission } from '../permissions.js';
import { loadPaymentSettings, maskTail } from '../pricing/settings.js';

export const partnersRouter = Router();
partnersRouter.use(adminAuth);

/** Libera comissões cuja carência (proteção contra chargeback) terminou. Idempotente. */
export async function releaseCommissions(): Promise<number> {
  const r = await pool.query(`UPDATE affiliate_commissions SET status='AVAILABLE' WHERE status='PENDING' AND available_at IS NOT NULL AND available_at <= now() RETURNING id`);
  return r.rowCount ?? 0;
}

const code = z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/);
const partnerCreate = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  code,
  partnerType: z.enum(['AFFILIATE', 'INFLUENCER', 'SELLER', 'ORGANIZATION']).default('AFFILIATE'),
  commissionBps: z.number().int().min(0).max(5000),
  commissionBase: z.enum(['GROSS', 'NET', 'MARGIN']).nullable().optional(),
  pixKey: z.string().trim().max(140).nullable().optional(),
  document: z.string().trim().max(30).nullable().optional(),
  payoutNotes: z.string().trim().max(280).nullable().optional(),
  active: z.boolean().default(true)
}).strict();
const partnerUpdate = partnerCreate.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

const present = (row: Record<string, unknown>, reveal: boolean) => ({
  id: row.id, name: row.name, email: row.email, code: row.code, partnerType: row.partner_type, commissionBps: Number(row.commission_bps), commissionBase: row.commission_base ?? null,
  pixKey: reveal ? row.pix_key ?? null : maskTail((row.pix_key as string | null) ?? null), document: reveal ? row.document ?? null : maskTail((row.document as string | null) ?? null), payoutNotes: row.payout_notes ?? null,
  active: row.active, createdAt: row.created_at
});

partnersRouter.get('/partners', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  await releaseCommissions();
  const reveal = hasPermission(req.user!.role, 'ADMIN_SYSTEM');
  const r = await pool.query(`SELECT a.*,
      coalesce(sum(c.amount_cents) FILTER (WHERE c.status='PENDING'),0)::int pending_cents,
      coalesce(sum(c.amount_cents) FILTER (WHERE c.status='AVAILABLE' AND c.payout_id IS NULL),0)::int available_cents,
      coalesce(sum(c.amount_cents) FILTER (WHERE c.status='AVAILABLE' AND c.payout_id IS NOT NULL),0)::int in_payout_cents,
      coalesce(sum(c.amount_cents) FILTER (WHERE c.status='PAID'),0)::int paid_cents,
      coalesce(sum(c.amount_cents) FILTER (WHERE c.status='CLAWBACK_DUE'),0)::int clawback_cents,
      count(c.id)::int commissions_count
    FROM affiliates a LEFT JOIN affiliate_commissions c ON c.affiliate_id=a.id GROUP BY a.id ORDER BY a.created_at DESC`);
  res.json(r.rows.map((row) => ({ ...present(row, reveal), pendingCents: row.pending_cents, availableCents: row.available_cents, inPayoutCents: row.in_payout_cents, paidCents: row.paid_cents, clawbackDueCents: row.clawback_cents, commissionsCount: row.commissions_count })));
}));

partnersRouter.post('/partners', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = partnerCreate.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const v = parsed.data;
  if ((v.pixKey || v.document) && !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  try {
    const r = await pool.query(`INSERT INTO affiliates(name,email,code,partner_type,commission_bps,commission_base,pix_key,document,payout_notes,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [v.name, v.email || null, v.code.toUpperCase(), v.partnerType, v.commissionBps, v.commissionBase ?? null, v.pixKey ?? null, v.document ?? null, v.payoutNotes ?? null, v.active]);
    await audit(req.user!.id, 'CREATE_PARTNER', 'AFFILIATE', String(r.rows[0].id), { requestId: requestId(req), partnerType: v.partnerType, commissionBps: v.commissionBps });
    res.status(201).json(present(r.rows[0], true));
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') throw appError('PARTNER_CODE_EXISTS', { code: 'PARTNER_CODE_EXISTS', http: 409, expose: true });
    throw error;
  }
}));

const columns: Record<string, string> = { name: 'name', email: 'email', code: 'code', partnerType: 'partner_type', commissionBps: 'commission_bps', commissionBase: 'commission_base', pixKey: 'pix_key', document: 'document', payoutNotes: 'payout_notes', active: 'active' };
partnersRouter.patch('/partners/:id', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = partnerUpdate.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  if ((parsed.data.pixKey !== undefined || parsed.data.document !== undefined) && !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  const values: unknown[] = []; const sets: string[] = [];
  for (const [k, value] of Object.entries(parsed.data)) {
    values.push(k === 'code' ? String(value).toUpperCase() : k === 'email' && value === '' ? null : value);
    sets.push(`${columns[k]}=$${values.length}`);
  }
  values.push(req.params.id);
  try {
    const r = await pool.query(`UPDATE affiliates SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
    if (!r.rowCount) throw appError('AFFILIATE_NOT_FOUND', { code: 'AFFILIATE_NOT_FOUND', http: 404, expose: true });
    await audit(req.user!.id, 'UPDATE_PARTNER', 'AFFILIATE', String(req.params.id), { requestId: requestId(req), fields: Object.keys(parsed.data) });
    res.json(present(r.rows[0], hasPermission(req.user!.role, 'ADMIN_SYSTEM')));
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') throw appError('PARTNER_CODE_EXISTS', { code: 'PARTNER_CODE_EXISTS', http: 409, expose: true });
    throw error;
  }
}));

partnersRouter.get('/commissions', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  await releaseCommissions();
  const status = typeof req.query.status === 'string' && /^[A-Z_]+$/.test(req.query.status) ? req.query.status : null;
  const r = await pool.query(`SELECT c.id,c.amount_cents,c.base_type,c.base_cents,c.rate_bps,c.status,c.available_at,c.created_at,c.paid_at,c.reversed_at,c.reversal_reason,c.payout_id,a.name partner_name,a.code,p.external_reference,p.amount_cents order_cents,p.payment_method
    FROM affiliate_commissions c JOIN affiliates a ON a.id=c.affiliate_id LEFT JOIN payment_orders p ON p.id=c.order_id
    WHERE ($1::text IS NULL OR c.status=$1) ORDER BY c.created_at DESC LIMIT 300`, [status]);
  res.json(r.rows.map((x) => ({ id: x.id, amountCents: Number(x.amount_cents), baseType: x.base_type, baseCents: Number(x.base_cents), rateBps: Number(x.rate_bps), status: x.status, availableAt: x.available_at, createdAt: x.created_at, paidAt: x.paid_at, reversedAt: x.reversed_at, reversalReason: x.reversal_reason, payoutId: x.payout_id, partner: { name: x.partner_name, code: x.code }, orderCents: x.order_cents == null ? null : Number(x.order_cents), paymentMethod: x.payment_method, externalReference: x.external_reference })));
}));

// ── Repasses (payouts)
partnersRouter.get('/payouts', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const reveal = hasPermission(req.user!.role, 'ADMIN_SYSTEM');
  const r = await pool.query(`SELECT p.*,a.name partner_name,a.code partner_code,(SELECT count(*)::int FROM affiliate_commissions c WHERE c.payout_id=p.id) items
    FROM payouts p JOIN affiliates a ON a.id=p.affiliate_id ORDER BY p.created_at DESC LIMIT 200`);
  res.json(r.rows.map((x) => ({ id: x.id, partner: { id: x.affiliate_id, name: x.partner_name, code: x.partner_code }, amountCents: Number(x.amount_cents), status: x.status, pixKey: reveal ? x.pix_key_snapshot : maskTail(x.pix_key_snapshot), receiptReference: x.receipt_reference, notes: x.notes, items: x.items, requestedAt: x.requested_at, approvedAt: x.approved_at, paidAt: x.paid_at })));
}));

partnersRouter.post('/payouts', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = z.object({ partnerId: z.string().uuid(), notes: z.string().trim().max(280).optional() }).strict().safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  await releaseCommissions();
  const settings = await loadPaymentSettings();
  const payout = await tx(async (client) => {
    const partner = await client.query('SELECT id,pix_key,active FROM affiliates WHERE id=$1 FOR UPDATE', [parsed.data.partnerId]);
    if (!partner.rowCount) throw appError('AFFILIATE_NOT_FOUND', { code: 'AFFILIATE_NOT_FOUND', http: 404, expose: true });
    if (!partner.rows[0].pix_key) throw appError('PARTNER_PIX_KEY_REQUIRED', { code: 'PARTNER_PIX_KEY_REQUIRED', http: 422, expose: true });
    const available = await client.query(`SELECT id,amount_cents FROM affiliate_commissions WHERE affiliate_id=$1 AND status='AVAILABLE' AND payout_id IS NULL FOR UPDATE`, [parsed.data.partnerId]);
    const clawbacks = await client.query(`SELECT id,amount_cents FROM affiliate_commissions WHERE affiliate_id=$1 AND status='CLAWBACK_DUE' AND payout_id IS NULL FOR UPDATE`, [parsed.data.partnerId]);
    const gross = available.rows.reduce((a, r) => a + Number(r.amount_cents), 0);
    const claw = clawbacks.rows.reduce((a, r) => a + Number(r.amount_cents), 0);
    const amount = gross - claw;
    if (amount <= 0 || gross < settings.payoutMinCents || amount < settings.payoutMinCents) throw appError('PAYOUT_BELOW_MINIMUM', { code: 'PAYOUT_BELOW_MINIMUM', http: 422, expose: true });
    const created = await client.query(`INSERT INTO payouts(affiliate_id,amount_cents,pix_key_snapshot,notes,requested_by) VALUES($1,$2,$3,$4,$5) RETURNING id`, [parsed.data.partnerId, amount, partner.rows[0].pix_key, parsed.data.notes ?? (claw ? `Líquido de ${formatBRL(claw)} em estornos/chargebacks` : null), req.user!.id]);
    const payoutId = created.rows[0].id as string;
    await client.query('UPDATE affiliate_commissions SET payout_id=$2 WHERE id = ANY($1::uuid[])', [available.rows.map((r) => r.id), payoutId]);
    if (clawbacks.rowCount) await client.query(`UPDATE affiliate_commissions SET payout_id=$2,status='REVERSED' WHERE id = ANY($1::uuid[])`, [clawbacks.rows.map((r) => r.id), payoutId]);
    return { id: payoutId, amountCents: amount, grossCents: gross, clawbackCents: claw, items: available.rowCount };
  });
  await audit(req.user!.id, 'CREATE_PAYOUT', 'PAYOUT', payout.id, { requestId: requestId(req), amountCents: payout.amountCents, clawbackCents: payout.clawbackCents });
  res.status(201).json(payout);
}));

const payoutAction = z.object({ action: z.enum(['APPROVE', 'REJECT', 'CANCEL', 'MARK_PAID']), receiptReference: z.string().trim().max(120).optional(), notes: z.string().trim().max(280).optional() }).strict();

partnersRouter.patch('/payouts/:id', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = payoutAction.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const { action } = parsed.data;
  // segregação: confirmar o pagamento (dinheiro saindo) exige permissão de super admin.
  if (action === 'MARK_PAID' && !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  const out = await tx(async (client) => {
    const found = await client.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount) throw appError('PAYOUT_NOT_FOUND', { code: 'PAYOUT_NOT_FOUND', http: 404, expose: true });
    const payout = found.rows[0] as Record<string, unknown>;
    const status = String(payout.status);
    const bad = () => appError('PAYOUT_INVALID_TRANSITION', { code: 'PAYOUT_INVALID_TRANSITION', http: 409, expose: true });
    if (action === 'APPROVE') {
      if (status !== 'REQUESTED') throw bad();
      await client.query(`UPDATE payouts SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1`, [payout.id, req.user!.id]);
      return 'APPROVED';
    }
    if (action === 'MARK_PAID') {
      if (status !== 'APPROVED') throw bad();
      await client.query(`UPDATE payouts SET status='PAID',paid_by=$2,paid_at=now(),receipt_reference=COALESCE($3,receipt_reference),notes=COALESCE($4,notes) WHERE id=$1`, [payout.id, req.user!.id, parsed.data.receiptReference ?? null, parsed.data.notes ?? null]);
      await client.query(`UPDATE affiliate_commissions SET status='PAID',paid_at=now() WHERE payout_id=$1 AND status='AVAILABLE'`, [payout.id]);
      return 'PAID';
    }
    if (status === 'PAID' || status === 'REJECTED' || status === 'CANCELLED') throw bad();
    await client.query(`UPDATE payouts SET status=$2,notes=COALESCE($3,notes) WHERE id=$1`, [payout.id, action === 'REJECT' ? 'REJECTED' : 'CANCELLED', parsed.data.notes ?? null]);
    // devolve as comissões ao saldo disponível; clawbacks netados voltam a "a recuperar"
    await client.query(`UPDATE affiliate_commissions SET payout_id=NULL WHERE payout_id=$1 AND status='AVAILABLE'`, [payout.id]);
    await client.query(`UPDATE affiliate_commissions SET payout_id=NULL,status='CLAWBACK_DUE' WHERE payout_id=$1 AND status='REVERSED' AND reversal_reason IS NOT NULL AND reversed_at IS NOT NULL`, [payout.id]);
    return action === 'REJECT' ? 'REJECTED' : 'CANCELLED';
  });
  await audit(req.user!.id, `PAYOUT_${action}`, 'PAYOUT', String(req.params.id), { requestId: requestId(req), result: out });
  res.json({ id: req.params.id, status: out });
}));

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Recibo de repasse imprimível (HTML), com os dados de recebimento configurados. */
partnersRouter.get('/payouts/:id/receipt', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const reveal = hasPermission(req.user!.role, 'ADMIN_SYSTEM');
  const p = await pool.query(`SELECT p.*,a.name partner_name,a.code partner_code,a.document partner_document FROM payouts p JOIN affiliates a ON a.id=p.affiliate_id WHERE p.id=$1`, [req.params.id]);
  if (!p.rowCount) throw appError('PAYOUT_NOT_FOUND', { code: 'PAYOUT_NOT_FOUND', http: 404, expose: true });
  const items = await pool.query(`SELECT c.amount_cents,c.base_type,c.base_cents,c.rate_bps,c.status,o.external_reference,c.created_at FROM affiliate_commissions c LEFT JOIN payment_orders o ON o.id=c.order_id WHERE c.payout_id=$1 ORDER BY c.created_at`, [req.params.id]);
  const settings = await loadPaymentSettings();
  const x = p.rows[0] as Record<string, unknown>;
  const rows = items.rows.map((i) => `<tr><td>${esc(i.external_reference ?? '—')}</td><td>${esc(i.base_type)} ${formatBRL(Number(i.base_cents))}</td><td>${formatBps(Number(i.rate_bps))}</td><td style="text-align:right">${formatBRL(Number(i.amount_cents))}</td></tr>`).join('');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo de repasse ${esc(String(x.id).slice(0, 8))}</title>
<style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 20px}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}.total{font-size:18px;font-weight:700;text-align:right}.muted{color:#666;font-size:12px}@media print{button{display:none}}</style></head><body>
<h1>Recibo de repasse</h1><div class="muted">Placa na Mão · nº ${esc(x.id)} · ${esc(x.status)}</div>
<p><b>Favorecido:</b> ${esc(x.partner_name)} (${esc(x.partner_code)})<br><b>Documento:</b> ${esc(reveal ? x.partner_document : maskTail(x.partner_document as string | null))}<br><b>Chave Pix:</b> ${esc(reveal ? x.pix_key_snapshot : maskTail(x.pix_key_snapshot as string | null))}<br><b>Pagador:</b> ${esc(settings.receiverName ?? 'Placa na Mão')}</p>
<table><thead><tr><th>Pedido</th><th>Base</th><th>Taxa</th><th style="text-align:right">Comissão</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">Total do repasse: ${formatBRL(Number(x.amount_cents))}</p>
<p class="muted">Solicitado em ${esc(new Date(String(x.requested_at)).toLocaleString('pt-BR'))}${x.paid_at ? ` · Pago em ${esc(new Date(String(x.paid_at)).toLocaleString('pt-BR'))}` : ''}${x.receipt_reference ? ` · Comprovante: ${esc(x.receipt_reference)}` : ''}</p>
<p class="muted">${esc(settings.receiptFooter ?? '')}</p><button onclick="print()">Imprimir</button></body></html>`);
}));

/** Exportação CSV segura contra injeção de fórmulas. */
const csvCell = (v: unknown) => { const s = String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };
partnersRouter.get('/commissions/export.csv', requirePermission('MANAGE_BILLING'), asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT c.id,a.name,a.code,c.status,c.base_type,c.base_cents,c.rate_bps,c.amount_cents,c.created_at,c.available_at,c.paid_at,o.external_reference FROM affiliate_commissions c JOIN affiliates a ON a.id=c.affiliate_id LEFT JOIN payment_orders o ON o.id=c.order_id ORDER BY c.created_at DESC LIMIT 5000`);
  const header = ['id', 'parceiro', 'codigo', 'status', 'base', 'base_centavos', 'taxa_bps', 'comissao_centavos', 'criada_em', 'disponivel_em', 'paga_em', 'pedido'];
  const lines = [header.join(','), ...r.rows.map((x) => [x.id, x.name, x.code, x.status, x.base_type, x.base_cents, x.rate_bps, x.amount_cents, x.created_at?.toISOString?.(), x.available_at?.toISOString?.(), x.paid_at?.toISOString?.(), x.external_reference].map(csvCell).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="comissoes.csv"');
  res.send(`﻿${lines.join('\r\n')}`);
}));
