import { documentKind } from '../lib/br.js';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { formatBRL } from '../lib/money.js';
import { hasPermission, requirePermission } from '../permissions.js';
import { FISCAL_WARNING, SUGGESTED_TAX_RATES_BPS, calculatePricing, isPricingError, type PricingInput } from '../pricing/engine.js';
import { floorPriceFor, marginAtPrice, pricingInputFor, proposeProductPrice } from '../pricing/productPricing.js';
import { loadPaymentSettings, maskTail, type PaymentSettings } from '../pricing/settings.js';

export const financeRouter = Router();
financeRouter.use(adminAuth);

const bps = (max: number) => z.number().int().min(0).max(max);
const methods = z.enum(['PIX', 'BOLETO', 'DEBITO', 'CREDITO_A_VISTA', 'CREDITO_PARCELADO']);
const settingsSchema = z.object({
  taxRegime: z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MANUAL']).optional(),
  applySuggestedTaxes: z.boolean().optional(),
  taxCashBps: bps(5000).optional(), taxBoletoBps: bps(5000).optional(), taxDebitBps: bps(5000).optional(), taxCreditCashBps: bps(5000).optional(), taxCreditInstallmentBps: bps(5000).optional(),
  pixFeeBps: bps(2000).optional(), pixFixedFeeCents: z.number().int().min(0).max(10000).optional(),
  boletoFixedFeeCents: z.number().int().min(0).max(10000).optional(), boletoDefaultRiskBps: bps(3000).optional(), boletoMonths: z.number().int().min(1).max(12).optional(), boletoMonthlyInterestBps: bps(1000).optional(),
  debitFeeBps: bps(2000).optional(), creditCashFeeBps: bps(2000).optional(), creditInstallmentFeeBps: bps(2000).optional(), anticipationBps: bps(2000).optional(),
  installmentsMax: z.number().int().min(1).max(12).optional(), cardMonthlyInterestBps: bps(1000).optional(), customerPaysInterest: z.boolean().optional(),
  enabledMethods: z.array(methods).min(1).max(5).optional(),
  operationalCostCents: z.number().int().min(0).max(1_000_000).optional(),
  desiredMarginBps: bps(100000).optional(), minMarginBps: bps(100000).optional(), marginBase: z.enum(['COST_PRICE', 'TOTAL_COST']).optional(),
  referenceDiscountBps: bps(5000).optional(), priceEndingCents: z.number().int().min(0).max(99).optional(),
  commissionBase: z.enum(['GROSS', 'NET', 'MARGIN']).optional(), commissionDefaultBps: bps(5000).optional(), commissionHoldDays: z.number().int().min(0).max(90).optional(), payoutMinCents: z.number().int().min(0).max(100_000_000).optional(),
  receiverName: z.string().trim().max(160).nullable().optional(), receiverDocument: z.string().trim().max(30).nullable().optional(), receiverPixKey: z.string().trim().max(140).nullable().optional(),
  receiverBankNotes: z.string().trim().max(500).nullable().optional(), receiptFooter: z.string().trim().max(500).nullable().optional()
}).strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

const columnMap: Record<string, string> = {
  taxRegime: 'tax_regime', taxCashBps: 'tax_cash_bps', taxBoletoBps: 'tax_boleto_bps', taxDebitBps: 'tax_debit_bps', taxCreditCashBps: 'tax_credit_cash_bps', taxCreditInstallmentBps: 'tax_credit_installment_bps',
  pixFeeBps: 'pix_fee_bps', pixFixedFeeCents: 'pix_fixed_fee_cents', boletoFixedFeeCents: 'boleto_fixed_fee_cents', boletoDefaultRiskBps: 'boleto_default_risk_bps', boletoMonths: 'boleto_months', boletoMonthlyInterestBps: 'boleto_monthly_interest_bps',
  debitFeeBps: 'debit_fee_bps', creditCashFeeBps: 'credit_cash_fee_bps', creditInstallmentFeeBps: 'credit_installment_fee_bps', anticipationBps: 'anticipation_bps', installmentsMax: 'installments_max', cardMonthlyInterestBps: 'card_monthly_interest_bps', customerPaysInterest: 'customer_pays_interest',
  enabledMethods: 'enabled_methods', operationalCostCents: 'operational_cost_cents', desiredMarginBps: 'desired_margin_bps', minMarginBps: 'min_margin_bps', marginBase: 'margin_base', referenceDiscountBps: 'reference_discount_bps', priceEndingCents: 'price_ending_cents',
  commissionBase: 'commission_base', commissionDefaultBps: 'commission_default_bps', commissionHoldDays: 'commission_hold_days', payoutMinCents: 'payout_min_cents',
  receiverName: 'receiver_name', receiverDocument: 'receiver_document', receiverPixKey: 'receiver_pix_key', receiverBankNotes: 'receiver_bank_notes', receiptFooter: 'receipt_footer'
};
const receiverKeys = new Set(['receiverName', 'receiverDocument', 'receiverPixKey', 'receiverBankNotes']);

function presentSettings(settings: PaymentSettings, canSeeReceiver: boolean) {
  return {
    ...settings,
    receiverDocument: canSeeReceiver ? settings.receiverDocument : maskTail(settings.receiverDocument),
    receiverPixKey: canSeeReceiver ? settings.receiverPixKey : maskTail(settings.receiverPixKey),
    fiscalWarning: FISCAL_WARNING,
    fiscalAcknowledged: Boolean(settings.fiscalAcknowledgedAt)
  };
}

financeRouter.get('/settings', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  res.json({ settings: presentSettings(await loadPaymentSettings(), hasPermission(req.user!.role, 'ADMIN_SYSTEM')), suggestedTaxRatesBps: SUGGESTED_TAX_RATES_BPS });
}));

financeRouter.put('/settings', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const input = { ...parsed.data } as Record<string, unknown>;
  const isSuper = hasPermission(req.user!.role, 'ADMIN_SYSTEM');
  if (Object.keys(input).some((k) => receiverKeys.has(k)) && !isSuper) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  if (input.applySuggestedTaxes) {
    const regime = String(input.taxRegime ?? (await loadPaymentSettings()).taxRegime) as keyof typeof SUGGESTED_TAX_RATES_BPS;
    const s = SUGGESTED_TAX_RATES_BPS[regime];
    Object.assign(input, { taxCashBps: s.cash, taxBoletoBps: s.boleto, taxDebitBps: s.debit, taxCreditCashBps: s.creditCash, taxCreditInstallmentBps: s.creditInstallment });
  }
  delete input.applySuggestedTaxes;
  const before = await loadPaymentSettings();
  const updated = await tx(async (client) => {
    const values: unknown[] = []; const sets: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const column = columnMap[key];
      if (!column || value === undefined) continue;
      values.push(value); sets.push(`${column}=$${values.length}`);
    }
    if (!sets.length) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
    values.push(req.user!.id);
    await client.query(`UPDATE payment_settings SET ${sets.join(',')},updated_by=$${values.length},updated_at=now() WHERE id=1`, values);
    const next = await loadPaymentSettings(client);
    // a configuração precisa ser economicamente viável: testa o motor com um custo de referência.
    const probe = calculatePricing(pricingInputFor(next, { id: 'probe', name: 'probe', providerCostCents: 1000 }));
    if (isPricingError(probe)) throw appError(probe.code, { code: 'SETTINGS_INFEASIBLE', http: 422, expose: true });
    if (next.minMarginBps > next.desiredMarginBps) throw appError('MIN_MARGIN_ABOVE_DESIRED', { code: 'MIN_MARGIN_ABOVE_DESIRED', http: 422, expose: true });
    return next;
  });
  const changed = Object.keys(input).filter((k) => !receiverKeys.has(k));
  await audit(req.user!.id, 'UPDATE_PAYMENT_SETTINGS', 'PAYMENT_SETTINGS', '1', { requestId: requestId(req), changed, receiverChanged: Object.keys(input).some((k) => receiverKeys.has(k)), before: { commissionBase: before.commissionBase, minMarginBps: before.minMarginBps, desiredMarginBps: before.desiredMarginBps }, after: { commissionBase: updated.commissionBase, minMarginBps: updated.minMarginBps, desiredMarginBps: updated.desiredMarginBps } });
  res.json({ settings: presentSettings(updated, isSuper) });
}));

financeRouter.post('/settings/fiscal-ack', requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  await pool.query('UPDATE payment_settings SET fiscal_acknowledged_at=now(),fiscal_acknowledged_by=$1 WHERE id=1', [req.user!.id]);
  await audit(req.user!.id, 'FISCAL_WARNING_ACKNOWLEDGED', 'PAYMENT_SETTINGS', '1', { requestId: requestId(req) });
  res.json({ settings: presentSettings(await loadPaymentSettings(), true) });
}));

const simulateSchema = z.object({
  productName: z.string().trim().max(120).default('Simulação'),
  providerCostCents: z.number().int().min(0).max(100_000_000),
  otherCostsCents: z.number().int().min(0).max(100_000_000).optional(),
  desiredMarginBps: bps(100000).optional(),
  priceCents: z.number().int().min(1).max(100_000_000).optional()
}).strict();

financeRouter.post('/simulate', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const settings = await loadPaymentSettings();
  const product = { id: 'sim', name: parsed.data.productName, providerCostCents: parsed.data.providerCostCents };
  const input: PricingInput = { ...pricingInputFor(settings, product, { desiredMarginBps: parsed.data.desiredMarginBps }), ...(parsed.data.otherCostsCents !== undefined ? { otherCostsCents: parsed.data.otherCostsCents } : {}) };
  const result = calculatePricing(input);
  if (isPricingError(result)) throw appError(result.code, { code: 'SIMULATION_INVALID', http: 422, expose: true });
  const floor = floorPriceFor(settings, product);
  res.json({
    result, floorCents: floor.floorCents, floorMethod: floor.worstMethod,
    atPrice: parsed.data.priceCents ? marginAtPrice(settings, product, parsed.data.priceCents) : null,
    fiscalWarning: FISCAL_WARNING
  });
}));

async function productRows() {
  const result = await pool.query(`SELECT id,name,price_cents,reference_price_cents,provider_cost_cents,supplier_cost_cents,is_free,active,commercial_status,pricing_mode,floor_price_cents,margin_locked,price_updated_at,price_version
    FROM query_products ORDER BY display_order,price_cents`);
  return result.rows as Array<Record<string, unknown>>;
}

financeRouter.get('/products', requirePermission('MANAGE_PRICING'), asyncRoute(async (_req, res) => {
  const settings = await loadPaymentSettings();
  const rows = await productRows();
  res.json({
    settings: { desiredMarginBps: settings.desiredMarginBps, minMarginBps: settings.minMarginBps, referenceDiscountBps: settings.referenceDiscountBps, priceEndingCents: settings.priceEndingCents, enabledMethods: settings.enabledMethods },
    products: rows.map((r) => {
      const product = { id: String(r.id), name: String(r.name), providerCostCents: Number(r.provider_cost_cents ?? 0), supplierCostCents: Number(r.supplier_cost_cents ?? 0) };
      const price = Number(r.price_cents ?? 0);
      const reference = r.reference_price_cents == null ? null : Number(r.reference_price_cents);
      const proposal = proposeProductPrice(settings, { ...product, referenceCents: reference, currentCents: price, isFree: Boolean(r.is_free) });
      const margins = price > 0 ? marginAtPrice(settings, product, price) : [];
      const worst = margins.length ? margins.reduce((a, b) => (b.marginBps < a.marginBps ? b : a)) : null;
      return {
        ...product, priceCents: price, referencePriceCents: reference, isFree: Boolean(r.is_free), active: Boolean(r.active), commercialStatus: r.commercial_status,
        pricingMode: r.pricing_mode, floorCents: proposal.floorCents, marginLocked: Boolean(r.margin_locked), priceVersion: Number(r.price_version ?? 1), priceUpdatedAt: r.price_updated_at,
        proposal: { ruleCents: proposal.ruleCents, finalCents: proposal.finalCents, marginLocked: proposal.marginLocked, belowMarketBps: proposal.belowMarketBps, reason: proposal.reason, changed: proposal.changed },
        margins, worstMarginBps: worst?.marginBps ?? null,
        belowFloor: proposal.floorCents != null && price > 0 && price < proposal.floorCents
      };
    })
  });
}));

const costSchema = z.object({
  providerCostCents: z.number().int().min(0).max(100_000_000).optional(),
  supplierCostCents: z.number().int().min(0).max(100_000_000).optional(),
  pricingMode: z.enum(['MANUAL', 'REFERENCE']).optional(),
  referencePriceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  overrideMarginLock: z.object({ reason: z.string().trim().min(10).max(280) }).optional()
}).strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

financeRouter.patch('/products/:id/pricing', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = costSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const settings = await loadPaymentSettings();
  const out = await tx(async (client) => {
    const found = await client.query('SELECT * FROM query_products WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!found.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const row = found.rows[0] as Record<string, unknown>;
    const providerCost = parsed.data.providerCostCents ?? Number(row.provider_cost_cents ?? 0);
    const supplierCost = parsed.data.supplierCostCents ?? Number(row.supplier_cost_cents ?? 0);
    const mode = parsed.data.pricingMode ?? String(row.pricing_mode);
    const reference = parsed.data.referencePriceCents !== undefined ? parsed.data.referencePriceCents : (row.reference_price_cents == null ? null : Number(row.reference_price_cents));
    const product = { id: String(row.id), name: String(row.name), providerCostCents: providerCost, supplierCostCents: supplierCost };
    const currentPrice = Number(row.price_cents ?? 0);
    const floor = floorPriceFor(settings, product).floorCents;
    let newPrice = parsed.data.priceCents ?? currentPrice;
    let lockedFlag = false; let reason = 'Ajuste manual de custo/modo';
    if (mode === 'REFERENCE' && parsed.data.priceCents === undefined) {
      const p = proposeProductPrice(settings, { ...product, referenceCents: reference, currentCents: currentPrice, isFree: Boolean(row.is_free) });
      newPrice = p.finalCents; lockedFlag = p.marginLocked; reason = p.marginLocked ? 'Regra de referência com trava de margem' : p.reason === 'RULE' ? 'Regra de referência (5% abaixo do mercado)' : 'Sem referência: preço mantido';
    } else if (parsed.data.priceCents !== undefined) {
      reason = 'Preço manual';
      if (!row.is_free && floor > 0 && newPrice < floor) {
        const override = parsed.data.overrideMarginLock;
        if (!override || !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('MARGIN_LOCK', { code: 'MARGIN_LOCK', http: 422, expose: true });
        lockedFlag = false; reason = `Preço abaixo do piso (${formatBRL(floor)}) autorizado: ${override.reason}`;
      }
    }
    if (!row.is_free && floor > 0 && newPrice > 0 && newPrice < floor && !parsed.data.overrideMarginLock) newPrice = Math.max(newPrice, floor);
    const priceChanged = newPrice !== currentPrice;
    const version = Number(row.price_version ?? 1) + (priceChanged ? 1 : 0);
    await client.query(`UPDATE query_products SET provider_cost_cents=$2,supplier_cost_cents=$3,pricing_mode=$4,reference_price_cents=$5,price_cents=$6::int,floor_price_cents=$7::int,margin_locked=$8,price_version=$9,
      price_updated_at=CASE WHEN $10::boolean THEN now() ELSE price_updated_at END,credit_cost=$11::int,updated_at=now() WHERE id=$1`, [row.id, providerCost, supplierCost, mode, reference, newPrice, floor || null, lockedFlag, version, priceChanged, Math.max(1, Math.ceil(newPrice / 100))]);
    if (priceChanged) await client.query(`INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,provider_cost_cents,margin_locked,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [row.id, version, currentPrice, newPrice, reference, floor || null, providerCost, lockedFlag, reason, req.user!.id]);
    return { id: String(row.id), priceCents: newPrice, floorCents: floor, marginLocked: lockedFlag, priceVersion: version, changed: priceChanged, reason };
  });
  await audit(req.user!.id, 'UPDATE_PRODUCT_PRICING', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req), priceCents: out.priceCents, floorCents: out.floorCents, marginLocked: out.marginLocked, overrideUsed: Boolean(parsed.data.overrideMarginLock) });
  res.json(out);
}));

const recalcSchema = z.object({ apply: z.boolean().default(false), productIds: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).max(100).optional() }).strict();

/** Recalcula preços de produtos em modo REFERENCE (simulação por padrão; `apply` grava com histórico/versão). */
financeRouter.post('/recalculate', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = recalcSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const settings = await loadPaymentSettings();
  const rows = (await productRows()).filter((r) => String(r.pricing_mode) === 'REFERENCE' && (!parsed.data.productIds || parsed.data.productIds.includes(String(r.id))));
  const proposals = rows.map((r) => proposeProductPrice(settings, { id: String(r.id), name: String(r.name), providerCostCents: Number(r.provider_cost_cents ?? 0), supplierCostCents: Number(r.supplier_cost_cents ?? 0), referenceCents: r.reference_price_cents == null ? null : Number(r.reference_price_cents), currentCents: Number(r.price_cents ?? 0), isFree: Boolean(r.is_free) }));
  if (parsed.data.apply) {
    await tx(async (client) => {
      for (const p of proposals.filter((x) => x.changed || x.marginLocked)) {
        const version = await client.query('UPDATE query_products SET price_cents=$2::int,floor_price_cents=$3::int,margin_locked=$4,price_version=price_version+1,price_updated_at=now(),credit_cost=$5::int,updated_at=now() WHERE id=$1 RETURNING price_version,provider_cost_cents', [p.productId, p.finalCents, p.floorCents, p.marginLocked, Math.max(1, Math.ceil(p.finalCents / 100))]);
        await client.query(`INSERT INTO product_price_history(product_id,version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,provider_cost_cents,margin_locked,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [p.productId, version.rows[0].price_version, p.currentCents, p.finalCents, p.referenceCents, p.floorCents, version.rows[0].provider_cost_cents, p.marginLocked, p.marginLocked ? 'Recálculo: trava de margem' : 'Recálculo pela referência de mercado', req.user!.id]);
      }
    });
    await audit(req.user!.id, 'RECALCULATE_PRODUCT_PRICES', 'QUERY_PRODUCT', null, { requestId: requestId(req), changed: proposals.filter((p) => p.changed).length });
  }
  res.json({ applied: parsed.data.apply, proposals });
}));

financeRouter.get('/products/:id/history', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT version,old_price_cents,new_price_cents,reference_price_cents,floor_price_cents,provider_cost_cents,margin_locked,reason,created_at FROM product_price_history WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`, [req.params.id]);
  res.json({ history: r.rows.map((x) => ({ version: x.version, oldPriceCents: x.old_price_cents, newPriceCents: x.new_price_cents, referencePriceCents: x.reference_price_cents, floorPriceCents: x.floor_price_cents, providerCostCents: x.provider_cost_cents, marginLocked: x.margin_locked, reason: x.reason, createdAt: x.created_at })) });
}));

// ── Preços de referência de mercado: dado interno, preenchido manualmente; nunca exposto ao público nem coletado automaticamente.
const refSchema = z.object({ sourceLabel: z.string().trim().min(2).max(80), priceCents: z.number().int().min(1).max(100_000_000), observedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(280).optional() }).strict();

async function refreshReference(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, productId: string): Promise<number | null> {
  const r = await client.query(`SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY price_cents) AS median FROM price_references WHERE product_id=$1 AND observed_at >= current_date - 90`, [productId]);
  const median = r.rows[0]?.median == null ? null : Number(r.rows[0].median);
  if (median != null) await client.query('UPDATE query_products SET reference_price_cents=$2,updated_at=now() WHERE id=$1', [productId, median]);
  return median;
}

financeRouter.get('/products/:id/references', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const r = await pool.query('SELECT id,source_label,price_cents,observed_at,note,created_at FROM price_references WHERE product_id=$1 ORDER BY observed_at DESC,created_at DESC LIMIT 100', [req.params.id]);
  res.json({ references: r.rows.map((x) => ({ id: x.id, sourceLabel: x.source_label, priceCents: Number(x.price_cents), observedAt: x.observed_at, note: x.note, createdAt: x.created_at })) });
}));

financeRouter.post('/products/:id/references', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = refSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const out = await tx(async (client) => {
    const product = await client.query('SELECT 1 FROM query_products WHERE id=$1', [req.params.id]);
    if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const ins = await client.query(`INSERT INTO price_references(product_id,source_label,price_cents,observed_at,note,created_by) VALUES($1,$2,$3,COALESCE($4::date,current_date),$5,$6) RETURNING id`, [req.params.id, parsed.data.sourceLabel, parsed.data.priceCents, parsed.data.observedAt ?? null, parsed.data.note ?? null, req.user!.id]);
    return { id: ins.rows[0].id, referenceCents: await refreshReference(client, String(req.params.id)) };
  });
  await audit(req.user!.id, 'ADD_PRICE_REFERENCE', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req), referenceCents: out.referenceCents });
  res.status(201).json(out);
}));

financeRouter.delete('/products/:id/references/:refId', requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const out = await tx(async (client) => {
    const del = await client.query('DELETE FROM price_references WHERE id=$1 AND product_id=$2 RETURNING id', [req.params.refId, req.params.id]);
    if (!del.rowCount) throw appError('REFERENCE_NOT_FOUND', { code: 'REFERENCE_NOT_FOUND', http: 404, expose: true });
    return { referenceCents: await refreshReference(client, String(req.params.id)) };
  });
  await audit(req.user!.id, 'DELETE_PRICE_REFERENCE', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req) });
  res.json(out);
}));

// ── Visão financeira consolidada (período em dias).
financeRouter.get('/overview', requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30) || 30));
  const settings = await loadPaymentSettings();
  const [paid, reversed, costs, commissions] = await Promise.all([
    pool.query(`SELECT count(*)::int n, coalesce(sum(amount_cents),0)::bigint gross, coalesce(sum(gateway_fee_cents),0)::bigint fees, coalesce(sum(net_cents),0)::bigint net
      FROM payment_orders WHERE status='PAID' AND paid_at >= now() - make_interval(days => $1)`, [days]),
    pool.query(`SELECT count(*)::int n, coalesce(sum(amount_cents),0)::bigint total, count(*) FILTER (WHERE reversal_kind='CHARGEBACK')::int chargebacks
      FROM payment_orders WHERE status='REFUNDED' AND refunded_at >= now() - make_interval(days => $1)`, [days]),
    pool.query(`SELECT count(*)::int n, coalesce(sum(p.provider_cost_cents + p.supplier_cost_cents),0)::bigint cost
      FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id WHERE q.status='SUCCESS' AND q.created_at >= now() - make_interval(days => $1)`, [days]),
    pool.query(`SELECT status, coalesce(sum(amount_cents),0)::bigint total, count(*)::int n FROM affiliate_commissions WHERE created_at >= now() - make_interval(days => $1) GROUP BY status`, [days])
  ]);
  const gross = Number(paid.rows[0].gross); const fees = Number(paid.rows[0].fees);
  const taxEstimated = Math.round((gross * settings.taxRates.cash) / 10_000);
  const refunded = Number(reversed.rows[0].total);
  const providerCost = Number(costs.rows[0].cost);
  const commissionAccrued = commissions.rows.filter((r) => ['PENDING', 'AVAILABLE', 'PAID', 'CLAWBACK_DUE'].includes(String(r.status))).reduce((a, r) => a + Number(r.total), 0);
  const netProfit = gross - refunded - fees - taxEstimated - providerCost - commissionAccrued;
  res.json({
    days, orders: Number(paid.rows[0].n), grossCents: gross, refundedCents: refunded, refunds: Number(reversed.rows[0].n), chargebacks: Number(reversed.rows[0].chargebacks),
    gatewayFeesCents: fees, estimatedTaxCents: taxEstimated, providerCostCents: providerCost, queries: Number(costs.rows[0].n), commissionsCents: commissionAccrued,
    commissionsByStatus: Object.fromEntries(commissions.rows.map((r) => [String(r.status), { totalCents: Number(r.total), count: Number(r.n) }])),
    netProfitCents: netProfit, netMarginBps: gross > 0 ? Math.round((netProfit * 10_000) / gross) : null,
    fiscalWarning: FISCAL_WARNING, taxIsEstimate: true
  });
}));

// ── Checklist de implantação: o que ainda falta para vender com margem protegida.
financeRouter.get('/setup-checklist', requirePermission('MANAGE_BILLING'), asyncRoute(async (_req, res) => {
  const settings = await loadPaymentSettings();
  const products = await pool.query(`SELECT p.id,p.name,p.provider_cost_cents,p.supplier_cost_cents,p.reference_price_cents,p.price_cents,
      (SELECT count(*) FROM price_references r WHERE r.product_id=p.id AND r.created_at > now() - interval '90 days')::int AS refs
    FROM query_products p WHERE p.active=true AND p.is_free=false ORDER BY p.display_order`);
  type Item = { key: string; ok: boolean; severity: 'BLOCKER' | 'WARNING'; title: string; detail: string };
  const items: Item[] = [
    { key: 'fiscal', ok: Boolean(settings.fiscalAcknowledgedAt), severity: 'BLOCKER', title: 'Alíquotas validadas pelo contador', detail: 'As alíquotas são estimativas configuráveis; confirme o regime e os percentuais com o contador e registre a ciência.' },
    { key: 'receiver', ok: Boolean(settings.receiverName && settings.receiverPixKey), severity: 'WARNING', title: 'Dados de recebimento', detail: 'Informe razão social e chave Pix/dados bancários usados nos recibos e repasses.' },
    { key: 'receipt', ok: Boolean(settings.receiptFooter), severity: 'WARNING', title: 'Rodapé do recibo', detail: 'Texto legal exibido nos recibos de repasse.' }
  ];
  for (const p of products.rows as Array<Record<string, unknown>>) {
    const cost = Number(p.provider_cost_cents ?? 0) + Number(p.supplier_cost_cents ?? 0);
    items.push({ key: `cost:${p.id}`, ok: cost > 0, severity: 'BLOCKER', title: `Custo do provedor — ${p.name}`, detail: 'Sem o custo, a trava de margem não consegue proteger o preço deste produto.' });
    items.push({ key: `ref:${p.id}`, ok: Number(p.refs) > 0, severity: 'WARNING', title: `Preço de referência de mercado — ${p.name}`, detail: 'Cadastre manualmente preços de referência (uso interno; nunca exibidos ao público).' });
  }
  const [tpl, mfa, vq] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM contract_template_versions WHERE status='PUBLISHED'`),
    pool.query(`SELECT count(*)::int AS n FROM users u WHERE u.active=true AND u.deleted_at IS NULL AND u.role IN ('SUPER_ADMIN','ADMIN','FINANCEIRO','OPERADOR','SUPORTE','CONTEUDO') AND NOT EXISTS (SELECT 1 FROM team_totp t WHERE t.user_id=u.id AND t.enabled_at IS NOT NULL)`),
    pool.query(`SELECT count(*)::int AS n FROM faqs WHERE active=true`)
  ]);
  const company = (await pool.query('SELECT legal_name,cnpj FROM fiscal_settings WHERE id=1')).rows[0] as { legal_name?: string | null; cnpj?: string | null } | undefined;
  const companyOk = Boolean(company?.legal_name?.trim()) && documentKind(String(company?.cnpj ?? '')) === 'CNPJ';
  items.push(
    { key: 'purchase-contract-company', ok: companyOk, severity: 'BLOCKER', title: 'Dados da empresa para o contrato de compra', detail: 'Preencha razão social e CNPJ válido em Notas fiscais. Sem isso o contrato de compra não é gerado e ninguém consegue pagar.' },
    { key: 'purchase-contract-email', ok: env.EMAIL_PROVIDER !== 'disabled', severity: 'WARNING', title: 'E-mail do comprovante de compra', detail: 'Depois de pagar, o cliente recebe o comprovante por e-mail. Sem o envio configurado a compra funciona, mas o comprovante não chega (o contrato fica em Carteira, Contratos).' },
    { key: 'support-channels', ok: Boolean(env.SUPPORT_EMAIL), severity: 'WARNING', title: 'Canais de atendimento', detail: 'Defina SUPPORT_EMAIL (um e-mail que receba mensagens) e, se houver, SUPPORT_PHONE, SUPPORT_WHATSAPP e SUPPORT_HOURS. Aparecem no site e dentro do contrato.' },
    { key: 'raw-retention', ok: !env.STORE_RAW_PROVIDER_RESPONSE || env.RAW_RETENTION_DAYS > 0, severity: 'WARNING', title: 'Prazo para guardar o dado bruto do fornecedor', detail: 'O dado bruto fica cifrado e só é lido pela equipe com motivo registrado. Defina RAW_RETENTION_DAYS (ex.: 90) para apagá-lo depois do prazo; o relatório do cliente continua.' }
  );
  const ref = (await pool.query('SELECT rates_reference_month AS m FROM financing_settings LIMIT 1')).rows[0]?.m as string | undefined;
  const refAge = ref && /^\d{4}-\d{2}$/.test(ref) ? (new Date().getFullYear() - Number(ref.slice(0, 4))) * 12 + (new Date().getMonth() + 1 - Number(ref.slice(5, 7))) : null;
  items.push(
    { key: 'sim-rates', ok: refAge !== null && refAge <= 3, severity: 'WARNING', title: 'Taxas do simulador atualizadas', detail: refAge === null ? 'Referência das taxas não encontrada.' : `Referência das taxas: ${ref}. Com mais de 3 meses, o simulador mostra aviso de defasagem. Atualize pelo painel ou ative a atualização automática.` },
    { key: 'mfa', ok: Number(mfa.rows[0].n) === 0, severity: 'WARNING', title: 'Verificação em duas etapas da equipe', detail: `${mfa.rows[0].n} conta(s) da equipe sem a verificação ativa. Ela continua opcional; ative para quem acessa financeiro, clientes e contratos.` },
    { key: 'email', ok: env.EMAIL_PROVIDER !== 'disabled', severity: 'WARNING', title: 'Envio de e-mail', detail: 'Sem provedor, contratos, documentos fiscais e avisos do suporte não são enviados. Configure SMTP e o webhook de entrega.' },
    { key: 'email-webhook', ok: Boolean(env.EMAIL_WEBHOOK_SECRET), severity: 'WARNING', title: 'Retorno de entrega de e-mail', detail: 'Defina EMAIL_WEBHOOK_SECRET para registrar entregas e devoluções.' },
    { key: 'contract-legal', ok: Number(tpl.rows[0].n) > 0, severity: 'WARNING', title: 'Minuta de contrato publicada', detail: 'Nenhuma minuta foi publicada. Cada versão precisa de revisão jurídica registrada antes de ir ao ar.' },
    { key: 'esign', ok: env.ESIGN_PROVIDER !== 'disabled', severity: 'WARNING', title: 'Assinatura de contratos', detail: 'Sem provedor, contratos não saem para assinatura. O aceite interno é eletrônico simples; valide com o jurídico se basta.' },
    { key: 'fiscal-provider', ok: env.FISCAL_PROVIDER !== 'disabled' && env.FISCAL_PROVIDER !== 'mock', severity: 'WARNING', title: 'Emissão fiscal', detail: 'Sem provedor integrado, a nota é emitida pelo contador e registrada manualmente.' },
    { key: 'mercadopago', ok: Boolean(env.MP_ACCESS_TOKEN && env.MP_WEBHOOK_SECRET), severity: 'WARNING', title: 'Mercado Pago', detail: 'Configure token e segredo do webhook; teste pagamento, estorno e conciliação no ambiente de testes antes de ativar.' },
    { key: 'vehicle-api', ok: env.DATA_PROVIDER === 'real', severity: 'WARNING', title: 'Fonte das consultas veiculares', detail: 'Consultas reais dependem de credenciais, corpo da requisição e contrato com o fornecedor.' },
    { key: 'cnpj', ok: env.CNPJ_PROVIDER !== 'disabled', severity: 'WARNING', title: 'Preenchimento por CNPJ', detail: 'Ative a consulta de CNPJ para facilitar o cadastro de empresas.' },
    { key: 'faq', ok: Number(vq.rows[0].n) > 0, severity: 'WARNING', title: 'Perguntas frequentes', detail: 'O assistente do chat só responde com perguntas publicadas. Sem elas, encaminha tudo para a equipe.' }
  );
  res.json({ ready: items.every((i) => i.ok || i.severity !== 'BLOCKER'), items, fiscalWarning: FISCAL_WARNING });
}));
