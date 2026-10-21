import crypto from 'node:crypto';

import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { settlePaymentEvent } from './payments/settle.js';
import { adminAuth, adminEdgeGuard, auth, clientApiGuard, isAdminHost, isTeamRole, issueSession, revokeSession, type AuthUser } from './auth.js';
import { hashIp } from './lib/totpFlow.js';
import { adminAuthRouter } from './routes/adminAuth.js';
import { financeRouter } from './routes/finance.js';
import { enforceMarginFloor } from './pricing/guard.js';
import { partnersRouter, releaseCommissions } from './routes/partners.js';
import { adminQueriesRouter } from './routes/adminQueries.js';
import { completeAuthorization, consumeLoginTicket, createAuthorizationRequest, oauthErrorUrl, oauthSuccessUrl, socialProviderStatus, type OAuthProvider } from './oauth.js';
import { adminHosts, env, publicAppUrl } from './config.js';
import { sendContactConfirmationEmail, sendContactMessageEmail, sendPasswordResetEmail, isEmailConfigured } from './email.js';
import { pool, tx } from './db.js';
import type { PoolClient } from 'pg';
import { normalizeBdrp } from './normalizer.js';
import { hasPermission, permissionsFor, requirePermission } from './permissions.js';
import { getProvider } from './providers/index.js';
import { getFipeProvider, quoteWithFallback, type FipeCatalogProvider } from './providers/fipeProvider.js';
import { fipePdf, fipePrintHtml, makeFipeQuote, reportSnapshot, type ReportBranding } from './fipeReport.js';
import { getPaymentProvider, getPaymentProviderFor, type PaymentProviderName } from './payments/index.js';
import { ensureSchema } from './schema.js';
import { performAdminLookup } from './adminLookup.js';
import { executeVehicleLookup } from './vehicleLookup.js';
import { calculateAffiliateCommission, calculateCouponDiscount, couponHasCapacity, couponWindowIsOpen, effectiveQueryPriceCents, queryAmountAfterCoupon } from './commercial.js';
import { publicVehicleResult, sanitizeAuditMetadata } from './privacy.js';
import { NORMALIZER_VERSION, tierForProductCode, viewReport } from './report/normalizeV2.js';
import { defaultReportTemplate } from './reportEngine.js';
import { renderVehiclePdf, type ReportMeta } from './report/pdf.js';
import { renderVehicleHtml } from './report/printHtml.js';
import { encryptRaw } from './lib/rawStore.js';
import { refundProcessingQuery, sweepStuckQueries } from './lib/queryRefund.js';
import { adminPeopleRouter } from './routes/adminPeople.js';
import { adminBillingRouter } from './routes/adminBilling.js';
import { adminVehiclesRouter } from './routes/adminVehicles.js';
import { publicVehiclesRouter } from './routes/vehicles.js';
import { fipeBrands, fipeModels, fipeYears, fipeSearch, getFipePrice } from './lib/fipeLookup.js';
import { adminSimulatorRouter } from './routes/adminSimulator.js';
import { garageRouter } from './routes/garage.js';
import { simulatorRouter } from './routes/simulator.js';
import { scoreModelMatch } from './lib/vehicleSpecs.js';
import { adminContentRouter, articleSeo, publicContentRouter, publishedArticleSlugs } from './routes/content.js';
import { refreshProductSections, sectionsForProduct, startProductSectionsRefresh } from './lib/productSections.js';
import { renderRobotsTxt, renderSeoHtml, renderSitemapXml, type SeoOverride } from './seo.js';
import { appError, asyncRoute, audit, log, requestId, type AppError } from './lib/http.js';
import type { FipeQuote, FipeSelectionItem, FipeVehicleDetails, FipeVehicleType, NormalizedVehicle } from './types.js';

await ensureSchema();
await refreshProductSections();
startProductSectionsRefresh();

const app = express();
const api = express.Router();
// Duas frentes: o painel só existe nos hosts de admin; o app do cliente não é servido nesses hosts.
api.use((req, res, next) => (req.path.startsWith('/admin') ? adminEdgeGuard(req, res, next) : clientApiGuard(req, res, next)));
api.use('/admin/auth', adminAuthRouter);
api.use('/admin/finance', financeRouter);
api.use('/admin/finance', partnersRouter);
api.use('/admin/queries', adminQueriesRouter);
api.use('/admin/content', adminContentRouter);
api.use('/admin/vehicles', adminVehiclesRouter);
api.use('/admin/simulator', adminSimulatorRouter);
api.use('/admin', adminPeopleRouter);
api.use('/admin', adminBillingRouter);
api.use((_req, res, next) => {
  // API responses are not cacheable: authenticated clients must never receive a conditional 304 without a body.
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
const plateSchema = z.string().trim().min(7).max(16).transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine((value) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(value), 'INVALID_PLATE');
const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  acceptTerms: z.literal(true),
  acceptPrivacy: z.literal(true),
  marketingOptIn: z.boolean().optional().default(false),
  affiliateCode: z.string().trim().min(3).max(40).optional(),
  accountType: z.enum(['PARTICULAR', 'AUTONOMO', 'EMPRESA']).optional().default('PARTICULAR')
});
const oauthTicketSchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/) });
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();
const requestQuerySchema = z.object({ plate: plateSchema, productId: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/), paymentOrderId: z.string().uuid().optional() }).strict();
const fipeVehicleTypeSchema = z.enum(['cars', 'motorcycles', 'trucks']);
const fipeItemSchema = z.object({ code: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(180) });
const fipeSelectionSchema = z.object({
  vehicleType: fipeVehicleTypeSchema.optional(),
  brand: fipeItemSchema.optional(),
  model: fipeItemSchema.optional(),
  year: fipeItemSchema.optional(),
  plate: z.string().trim().max(16).optional()
}).refine((input) => Boolean(input.plate) || Boolean(input.vehicleType && input.brand && input.model && input.year), 'FIPE_SELECTION_REQUIRED');
const sandboxCreditSchema = z.object({ amountCents: z.number().int().min(1000).max(1000000) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128).optional(), newPassword: z.string().min(8).max(128) }).strict();
const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cpfCnpj: z.string().trim().max(30).optional(),
  phone: z.string().trim().max(30).optional(),
  companyName: z.string().trim().max(160).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
  marketingOptIn: z.boolean().optional()
});
const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
  const resetPasswordSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), newPassword: z.string().min(8).max(128) }).strict();
  const totpChallengeSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().min(6).max(16) }).strict();
  const totpEnrollmentSchema = z.object({ challenge: z.string().regex(/^[A-Za-z0-9_-]{30,160}$/), code: z.string().trim().regex(/^\d{6}$/) }).strict();
  const reportFieldAdminSchema = z.object({ key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_.]{0,119}$/), label: z.string().trim().min(1).max(120), visible: z.boolean().optional().default(true) }).strict().refine((field) => !/(owner|cpf|cnpj|document|address|endereco|logradouro|phone|telefone|email)/i.test(field.key), 'PRIVATE_FIELD_FORBIDDEN');
  const reportSectionAdminSchema = z.object({ key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/), label: z.string().trim().min(1).max(120), order: z.number().int().min(-10000).max(10000).optional(), visible: z.boolean().optional().default(true), fields: z.array(reportFieldAdminSchema).max(60) }).strict();
  const reportTemplateConfigSchema = z.object({ title: z.string().trim().min(1).max(160).optional(), subtitle: z.string().trim().min(1).max(240).optional(), sections: z.array(reportSectionAdminSchema).min(1).max(40) }).strict();
  const productUpdateSchema = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(2).max(400).optional(),
    referencePriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
    priceCents: z.number().int().min(0).max(100000000).optional(),
    providerCostCents: z.number().int().min(0).max(100000000).optional(),
    supplierCostCents: z.number().int().min(0).max(100000000).optional(),
    overrideMarginLock: z.object({ reason: z.string().trim().min(10).max(280) }).optional(),
    slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
    features: z.array(z.string().trim().min(1).max(180)).max(30).optional(),
    source: z.string().trim().max(240).nullable().optional(),
    coverage: z.string().trim().max(500).nullable().optional(),
    commercialStatus: z.enum(['ACTIVE', 'SOON', 'FREE', 'HIDDEN']).optional(),
    tagline: z.string().trim().max(160).optional(),
    longDescription: z.string().trim().max(2000).optional(),
    badge: z.string().trim().max(30).nullable().optional(),
    listPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
    showOnHome: z.boolean().optional(),
    reportSections: z.array(z.string()).max(12).nullable().optional(),
    featured: z.boolean().optional(),
    displayOrder: z.number().int().min(-10000).max(10000).optional(),
    isFree: z.boolean().optional(),
    active: z.boolean().optional()
  }).strict().refine((input) => Object.keys(input).length > 0, 'EMPTY_UPDATE');
  const reportTemplateCreateSchema = z.object({ name: z.string().trim().min(2).max(160), status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'), config: reportTemplateConfigSchema }).strict();
  const orgPackagePriceSchema = z.object({ packageSlug: z.string().trim().min(2).max(80), priceCents: z.number().int().min(1).max(100000000), active: z.boolean().default(true), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).strict().refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, 'INVALID_PRICE_WINDOW');
  const orgQueryPriceSchema = z.object({ productId: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/), priceCents: z.number().int().min(0).max(100000000), active: z.boolean().default(true), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() }).strict().refine((value) => !value.startsAt || !value.endsAt || value.endsAt > value.startsAt, 'INVALID_PRICE_WINDOW');
  const contactMessageSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), subject: z.string().trim().min(2).max(160), message: z.string().trim().min(10).max(5000), category: z.enum(['SUPPORT', 'PRIVACY', 'LGPD', 'COMMERCIAL']).default('SUPPORT') }).strict();
  const contactStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']) }).strict();
  const auditRetentionSchema = z.object({ olderThanDays: z.number().int().min(180).max(3650).default(180), execute: z.boolean().default(false) }).strict();
  const productCreateSchema = z.object({
    id: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(2).max(400),
    priceCents: z.number().int().min(0).max(100000000),
    providerCostCents: z.number().int().min(0).max(100000000).default(0),
    supplierCostCents: z.number().int().min(0).max(100000000).default(0),
    overrideMarginLock: z.object({ reason: z.string().trim().min(10).max(280) }).optional(),
    referencePriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
    slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
    features: z.array(z.string().trim().min(1).max(180)).max(30).default([]),
    source: z.string().trim().max(240).nullable().optional(),
    coverage: z.string().trim().max(500).nullable().optional(),
    commercialStatus: z.enum(['ACTIVE', 'SOON', 'FREE', 'HIDDEN']).default('SOON'),
    tagline: z.string().trim().max(160).default(''),
    longDescription: z.string().trim().max(2000).default(''),
    badge: z.string().trim().max(30).nullable().optional(),
    listPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
    showOnHome: z.boolean().default(true),
    reportSections: z.array(z.string()).max(12).nullable().optional(),
    featured: z.boolean().default(false),
    displayOrder: z.number().int().min(-10000).max(10000).default(100),
    isFree: z.boolean().default(false),
    active: z.boolean().default(true),
    reportConfig: reportTemplateConfigSchema.optional()
  }).strict();
const adminUserUpdateSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(['OPERADOR', 'ADMIN', 'CLIENTE']).optional()
}).refine((input) => Object.keys(input).length > 0, 'EMPTY_UPDATE');
  const adminWalletAdjustmentSchema = z.object({
  amountCents: z.number().int().min(-100000000).max(100000000).refine((value) => value !== 0, 'ZERO_ADJUSTMENT'),
  description: z.string().trim().min(8).max(280)
}).strict();
  const checkoutSchema = z.object({ packageSlug: z.string().trim().min(2).max(80), couponCode: z.string().trim().min(3).max(40).optional(), affiliateCode: z.string().trim().min(3).max(40).optional() }).strict();
  const queryCheckoutSchema = z.object({ productId: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/), plate: plateSchema, couponCode: z.string().trim().min(3).max(40).optional(), affiliateCode: z.string().trim().min(3).max(40).optional() }).strict();
  const couponFieldsSchema = z.object({ code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), discountType: z.enum(['PERCENT', 'FIXED']), discountValue: z.number().int().positive().max(100000), maxRedemptions: z.number().int().positive().max(1000000).nullable().optional(), startsAt: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), active: z.boolean().optional().default(true) });
  const couponCreateSchema = couponFieldsSchema.superRefine((value, ctx) => { if (value.discountType === 'PERCENT' && value.discountValue > 100) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: 100, type: 'number', inclusive: true, path: ['discountValue'], message: 'PERCENT_MAX_100' }); });
  const couponUpdateSchema = couponFieldsSchema.partial().refine((input) => Object.keys(input).length > 0, 'EMPTY_UPDATE');
  const affiliateCreateSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).optional().or(z.literal('')), code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), commissionBps: z.number().int().min(0).max(5000), active: z.boolean().optional().default(true) });
  const affiliateUpdateSchema = affiliateCreateSchema.partial().refine((input) => Object.keys(input).length > 0, 'EMPTY_UPDATE');
  const affiliateActivationSchema = z.object({ code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional() });
  const organizationBrandingSchema = z.object({ name: z.string().trim().min(2).max(160), document: z.string().trim().max(30).optional().nullable(), slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional().nullable(), primaryColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(), accentColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(), logoUrl: z.string().url().max(500).optional().nullable(), customDomain: z.string().trim().max(255).optional().nullable(), settings: z.record(z.string(), z.string().trim().max(280)).optional(), active: z.boolean().optional() });
  const organizationMemberSchema = z.object({ userId: z.string().uuid(), role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER') });
  const planInterestSchema = z.object({ email: z.string().trim().email().max(254), plan: z.enum(['PREMIUM', 'RISK']) });
  const funnelEventSchema = z.object({
    event: z.enum(['HOME_PAGE_VIEW', 'SEO_PAGE_VIEW', 'FIPE_PAGE_VIEW', 'CTA_CLICKED', 'PLATE_CAPTURED', 'FIPE_FORM_SUBMITTED', 'FIPE_RESULT_VIEWED', 'FIPE_REPORT_ACTION', 'AUTH_VIEWED', 'AUTH_SUBMITTED', 'ACCOUNT_CREATED', 'AUTH_SUCCEEDED', 'CHECKOUT_QUOTE_VIEWED', 'CHECKOUT_STARTED']),
    sessionId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
    path: z.string().trim().regex(/^\/[a-zA-Z0-9/_-]*$/).max(180),
    metadata: z.record(z.string().max(60), z.union([z.string().max(160), z.number().finite(), z.boolean(), z.null()])).optional().default({})
  }).strict();
  const publicFunnelMetadataKeys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'referrer', 'landing', 'intent', 'placement', 'destination', 'vehicleType', 'hasVehicleDetails', 'referenceMonth', 'action', 'authenticated', 'plateFormat', 'productId', 'amountCents', 'paymentConfigured', 'hasCoupon', 'hasAffiliate']);
  function sanitizePublicFunnelMetadata(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(input).filter(([key]) => publicFunnelMetadataKeys.has(key)));
  }
  const safeSettingsSchema = z.object({
    siteTagline: z.string().trim().max(180).nullable().optional(),
    supportEmail: z.string().trim().email().max(254).nullable().optional(),
    maintenanceNotice: z.string().trim().max(280).nullable().optional(),
    defaultAffiliateRateBps: z.number().int().min(0).max(5000).optional(),
    fipeGuestDailyLimit: z.number().int().min(1).max(100000).optional()
  }).refine((input) => Object.keys(input).length > 0, 'EMPTY_UPDATE');

type RawBodyRequest = Request & { rawBody?: Buffer };
type FipeStoredResult = { __type: 'FIPE_QUOTE'; quote: FipeQuote };
type QueryRow = { id: string; status: string; credits_cost: number; price_cents?: number; charge_source?: string; product_id?: string; normalized: NormalizedVehicle | FipeStoredResult | null };

function publicUser(row: { id: string; email: string; name: string; role: string }): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

async function authResultForUser(user: AuthUser, flow: string, req: Request): Promise<Record<string, unknown>> {
  // O app do cliente só emite sessões `client`. Contas de equipe entram exclusivamente pelo painel (/api/admin/auth).
  if (isTeamRole(user.role)) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  const issued = await issueSession(user, { flow, requestId: requestId(req) }, 'client');
  return { token: issued.token, user };
}

function toSafeQueryError(error: unknown): { status: number; code: string; message: string } {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code === 'NOT_FOUND') return { status: 404, code: 'PLACA_NAO_ENCONTRADA_SANDBOX', message: 'Esta placa não está disponível no ambiente de testes.' };
  if (code === 'INVALID_PLATE') return { status: 400, code, message: 'Informe uma placa válida no padrão brasileiro.' };
  if (code === 'INSUFFICIENT_BALANCE' || code === 'INSUFFICIENT_CREDITS') return { status: 402, code: 'INSUFFICIENT_BALANCE', message: 'Seu saldo pré-pago não é suficiente para esta consulta.' };
  if (code === 'QUERY_PAYMENT_NOT_READY') return { status: 409, code, message: 'A confirmação do pagamento ainda não está disponível. Aguarde a atualização do provedor.' };
  if (code === 'QUERY_PAYMENT_ALREADY_USED') return { status: 409, code, message: 'Este pagamento já foi utilizado ou não pode ser reutilizado.' };
  if (code === 'PROVIDER_TIMEOUT') return { status: 502, code: 'QUERY_RETRY_AVAILABLE', message: 'Não foi possível concluir a consulta agora. O saldo será estornado quando debitado; uma consulta já paga permanece disponível para nova tentativa.' };
  if (code === 'DATA_PROVIDER_NOT_CONFIGURED') return { status: 503, code, message: 'A consulta está em ativação. Tente novamente quando a fonte de dados estiver disponível.' };
  if (code === 'DATA_PROVIDER_AUTH_FAILED' || code === 'DATA_PROVIDER_UNAVAILABLE' || code === 'DATA_PROVIDER_INVALID_RESPONSE') return { status: 502, code: 'QUERY_RETRY_AVAILABLE', message: 'A fonte de dados não respondeu de forma válida. Se houve débito de saldo, ele foi estornado; pagamento direto confirmado permanece disponível para nova tentativa.' };
  if (code === 'PRODUCT_NOT_FOUND') return { status: 404, code, message: 'Este produto de consulta não está disponível.' };
  return { status: 502, code: 'QUERY_RETRY_AVAILABLE', message: 'Não foi possível concluir a consulta agora. Se houve débito de saldo, ele foi estornado; pagamento direto confirmado permanece disponível para nova tentativa.' };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(appError('PROVIDER_TIMEOUT', { code: 'PROVIDER_TIMEOUT' })), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function diagnostic(result: NormalizedVehicle): { level: 'CLEAR' | 'ATTENTION' | 'HIGH_RISK' | 'INCONCLUSIVE'; title: string; reason: string } {
  if (result.v2) return { level: result.v2.verdict.level, title: result.v2.verdict.title, reason: result.v2.verdict.reason };
  const debts = result.debts.filter((item) => item.hasDebt);
  const restrictions = result.restrictions.filter((item) => item.alert);
  if (restrictions.length > 0) {
    const names = restrictions.slice(0, 2).map((item) => item.label.toLowerCase()).join(' e ');
    return { level: 'HIGH_RISK', title: 'Atenção necessária', reason: `Foram identificadas ocorrências em ${names}. Analise os detalhes antes de seguir.` };
  }
  if (debts.length > 0) return { level: 'ATTENTION', title: 'Há débitos a regularizar', reason: `Foram identificados ${debts.length === 1 ? 'um débito' : `${debts.length} débitos`} no retorno do provedor.` };
  return { level: 'CLEAR', title: 'Sem alertas relevantes', reason: 'Não foram identificadas ocorrências relevantes nos dados retornados por esta consulta.' };
}

function serializeQuery(row: QueryRow & Record<string, unknown>): Record<string, unknown> {
  const normalized = row.normalized;
  const isFipe = Boolean(normalized && typeof normalized === 'object' && '__type' in normalized && normalized.__type === 'FIPE_QUOTE');
  const vehicle = !isFipe && normalized ? normalized as NormalizedVehicle : null;
  const result = isFipe
    ? { fipe: publicFipeQuote((normalized as FipeStoredResult).quote), blocks: (normalized as FipeStoredResult).quote.blocks, diagnostic: { level: 'CLEAR', title: 'Valor FIPE consultado', reason: 'A Tabela FIPE foi consultada; a situação documental não está incluída nesta modalidade.' } }
    : vehicle ? { ...publicVehicleResult(vehicle, tierForProductCode(String(row.product_id ?? '')), sectionsForProduct(String(row.product_id ?? ''))), coverage: vehicle.coverage ?? { identification: vehicle.identification ? 'FOUND' : 'NOT_QUERIED', debts: vehicle.debts.length ? 'FOUND' : 'NOT_QUERIED', restrictions: vehicle.restrictions.length ? 'FOUND' : 'NOT_QUERIED', recall: vehicle.recall ? 'FOUND' : 'NOT_QUERIED' }, diagnostic: diagnostic(vehicle) } : null;
  return {
    id: row.id,
    plate: row.plate,
    productId: row.product_id,
    productName: row.product_name,
    status: row.status,
    priceCents: Number(row.price_cents ?? 0),
    chargeSource: row.charge_source ?? (Number(row.credits_cost ?? 0) > 0 ? 'LEGACY_CREDIT' : 'WALLET_MONEY'),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    verificationCode: !isFipe ? String(row.id).slice(0, 8).toUpperCase() : undefined,
    result
  };
}

app.set('trust proxy', env.TRUST_PROXY);
app.disable('x-powered-by');
app.use((req, res, next) => {
  const id = typeof req.headers['x-request-id'] === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(req.headers['x-request-id'])
    ? req.headers['x-request-id']
    : crypto.randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  const started = performance.now();
  res.on('finish', () => log('info', 'request_complete', { requestId: id, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", env.WEB_ORIGIN],
      ...(env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {})
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(cors({ origin: env.WEB_ORIGIN, credentials: false }));
app.use(express.json({
  limit: '256kb',
  // O import do catálogo de frota (CSV de vários MB) tem parser próprio na rota, com limite maior.
  type: (req) => /^application\/json/i.test(req.headers['content-type'] ?? '') && !String(req.url).split('?')[0]!.endsWith('/admin/vehicles/catalog/import'),
  verify: (req, _res, body) => {
    if (req.url?.split('?')[0] === '/api/payments/mercadopago/webhook') {
      (req as RawBodyRequest).rawBody = Buffer.from(body);
    }
  }
}));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
if (env.RATE_LIMIT_ENABLED) {
  app.use(rateLimit({ windowMs: env.RATE_LIMIT_WINDOW_MS, limit: env.RATE_LIMIT_MAX_REQUESTS, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === '/health' }));
}

app.get('/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, app: env.APP_NAME, database: 'ok' });
}));

const loginRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas. Aguarde alguns minutos para tentar novamente.' }
});
const passwordResetRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas solicitações. Aguarde alguns minutos para tentar novamente.' }
});
const contactRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas mensagens. Aguarde alguns minutos para tentar novamente.' }
});

function passwordResetTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function passwordResetUnavailable(): AppError {
  return appError('PASSWORD_RESET_UNAVAILABLE', { code: 'PASSWORD_RESET_UNAVAILABLE', http: 503, expose: true });
}

api.get('/auth/providers', (_req, res) => {
  res.json({ providers: socialProviderStatus() });
});

api.get('/auth/oauth/:provider/start', asyncRoute(async (req, res) => {
  const provider = parseOAuthProvider(String(req.params.provider));
  const { authorizationUrl } = await createAuthorizationRequest(provider);
  res.redirect(302, authorizationUrl);
}));

const oauthCallback: RequestHandler = asyncRoute(async (req, res) => {
  const provider = parseOAuthProvider(String(req.params.provider));
  try {
    const result = await completeAuthorization(provider, {
      code: typeof req.body?.code === 'string' ? req.body.code : typeof req.query.code === 'string' ? req.query.code : undefined,
      state: typeof req.body?.state === 'string' ? req.body.state : typeof req.query.state === 'string' ? req.query.state : undefined,
      error: typeof req.body?.error === 'string' ? req.body.error : typeof req.query.error === 'string' ? req.query.error : undefined,
      errorDescription: typeof req.body?.error_description === 'string' ? req.body.error_description : typeof req.query.error_description === 'string' ? req.query.error_description : undefined,
      appleUser: typeof req.body?.user === 'string' ? req.body.user : undefined
    });
    res.redirect(302, oauthSuccessUrl(result.ticket));
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'OAUTH_CALLBACK_FAILED';
    res.redirect(302, oauthErrorUrl(code));
  }
});
api.get('/auth/oauth/:provider/callback', oauthCallback);
api.post('/auth/oauth/:provider/callback', oauthCallback);

api.post('/auth/oauth/consume', loginRateLimit, asyncRoute(async (req, res) => {
  const parsed = oauthTicketSchema.safeParse(req.body);
  if (!parsed.success) throw appError('OAUTH_TICKET_INVALID', { code: 'OAUTH_TICKET_INVALID', http: 401, expose: true });
  const user = await consumeLoginTicket(parsed.data.ticket);
  const result = await authResultForUser(user, 'social', req);
  await audit(user.id, 'OAUTH_LOGIN', 'USER', user.id, { requestId: requestId(req), flow: 'client' });
  res.json(result);
}));

api.post('/auth/register', asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const email = parsed.data.email.toLowerCase();
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  try {
    const created = await tx(async (client) => {
      let affiliateId: string | null = null;
      if (parsed.data.affiliateCode) {
        const affiliate = await client.query('SELECT id,user_id FROM affiliates WHERE upper(code)=upper($1) AND active=true', [parsed.data.affiliateCode]);
        if (!affiliate.rowCount) throw appError('AFFILIATE_INVALID', { code: 'AFFILIATE_INVALID', http: 400, expose: true });
        affiliateId = String(affiliate.rows[0].id);
      }
      const user = await client.query('INSERT INTO users(email,password_hash,name,role,affiliate_id) VALUES($1,$2,$3,$4,$5) RETURNING id,email,name,role', [email, passwordHash, parsed.data.name, 'CLIENTE', affiliateId]);
      await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [user.rows[0].id]);
      await client.query('INSERT INTO user_profiles(user_id,marketing_opt_in,customer_type) VALUES($1,$2,$3)', [user.rows[0].id, parsed.data.marketingOptIn, parsed.data.accountType]);
      await client.query(`INSERT INTO user_consents(user_id,consent_type,granted,policy_version,source,ip_hash)
        VALUES($1,'TERMS_OF_SERVICE',true,'2026-08','registration',$2),
              ($1,'PRIVACY_POLICY',true,'2026-08','registration',$2),
              ($1,'MARKETING_EMAIL',$3,'2026-08','registration',$2)`, [user.rows[0].id, hashIp(req.ip), parsed.data.marketingOptIn]);
      return user.rows[0] as AuthUser;
    });
    const issued = await issueSession(created, { flow: 'password_registration', requestId: requestId(req) });
    await audit(created.id, 'REGISTER', 'USER', created.id, { requestId: requestId(req) });
    res.status(201).json({ token: issued.token, user: created });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw appError('EMAIL_ALREADY_EXISTS', { code: 'EMAIL_ALREADY_EXISTS', http: 409, expose: true });
    throw error;
  }
}));

api.post('/auth/login', loginRateLimit, asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  const email = parsed.data.email.toLowerCase();
  const result = await pool.query('SELECT id,email,password_hash,name,role,active,password_enabled,failed_login_attempts,locked_until FROM users WHERE lower(email)=lower($1)', [email]);
  const account = result.rows[0] as (Record<string, unknown> | undefined);
  const lockedUntil = account?.locked_until ? new Date(String(account.locked_until)) : undefined;
  const isLocked = lockedUntil && lockedUntil.getTime() > Date.now();
  const passwordMatches = account ? await bcrypt.compare(parsed.data.password, String(account.password_hash)) : false;
  if (!account || !account.active || account.password_enabled !== true || isLocked || !passwordMatches) {
    if (account?.id) {
      const failures = Number(account.failed_login_attempts ?? 0) + 1;
      const lock = failures >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      await pool.query('UPDATE users SET failed_login_attempts=$2, locked_until=$3 WHERE id=$1', [account.id, failures >= 5 ? 0 : failures, lock]);
      await audit(String(account.id), 'LOGIN_FAILURE', 'USER', String(account.id), { requestId: requestId(req) });
    }
    throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  }
  const user = publicUser({ id: String(account.id), email: String(account.email), name: String(account.name), role: String(account.role) });
  await pool.query('UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [user.id]);
  const resultForUser = await authResultForUser(user, 'password', req);
  await audit(user.id, 'LOGIN', 'USER', user.id, { requestId: requestId(req), flow: 'client' });
  res.json(resultForUser);
}));

api.post('/auth/logout', auth, asyncRoute(async (req, res) => {
  await revokeSession(req.sessionId);
  await audit(req.user!.id, 'LOGOUT', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/profile', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT u.id,u.email,u.name,u.role,u.password_enabled,p.cpf_cnpj,p.phone,p.company_name,p.city,p.state,p.marketing_opt_in
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.active=true`, [req.user!.id]);
  if (!result.rowCount) throw appError('ACCOUNT_NOT_FOUND', { code: 'ACCOUNT_NOT_FOUND', http: 404, expose: true });
  const row = result.rows[0];
  res.json({ profile: { id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role), passwordEnabled: Boolean(row.password_enabled), cpfCnpj: row.cpf_cnpj ?? '', phone: row.phone ?? '', companyName: row.company_name ?? '', city: row.city ?? '', state: row.state ?? '', marketingOptIn: Boolean(row.marketing_opt_in) } });
}));

api.put('/profile', auth, asyncRoute(async (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const input = parsed.data;
  const profile = await tx(async (client) => {
    const user = await client.query('UPDATE users SET name=$2 WHERE id=$1 AND active=true RETURNING id,email,name,role,password_enabled', [req.user!.id, input.name]);
    if (!user.rowCount) throw appError('ACCOUNT_NOT_FOUND', { code: 'ACCOUNT_NOT_FOUND', http: 404, expose: true });
    const updated = await client.query(`INSERT INTO user_profiles(user_id,cpf_cnpj,phone,company_name,city,state,marketing_opt_in)
      VALUES($1,$2,$3,$4,$5,$6,COALESCE($7,false))
      ON CONFLICT(user_id) DO UPDATE SET cpf_cnpj=EXCLUDED.cpf_cnpj,phone=EXCLUDED.phone,company_name=EXCLUDED.company_name,city=EXCLUDED.city,state=EXCLUDED.state,marketing_opt_in=COALESCE($7,user_profiles.marketing_opt_in),updated_at=now()
      RETURNING cpf_cnpj,phone,company_name,city,state,marketing_opt_in`, [req.user!.id, input.cpfCnpj ?? null, input.phone ?? null, input.companyName ?? null, input.city ?? null, input.state?.toUpperCase() ?? null, input.marketingOptIn ?? null]);
    if (input.marketingOptIn !== undefined) {
      await client.query(`INSERT INTO user_consents(user_id,consent_type,granted,policy_version,source,ip_hash)
        VALUES($1,'MARKETING_EMAIL',$2,'2026-08','profile_update',$3)`, [req.user!.id, input.marketingOptIn, hashIp(req.ip)]);
    }
    return { user: user.rows[0], profile: updated.rows[0] };
  });
  const publicAccount = publicUser({ id: String(profile.user.id), email: String(profile.user.email), name: String(profile.user.name), role: String(profile.user.role) });
  await audit(req.user!.id, 'PROFILE_UPDATED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.json({ user: publicAccount, profile: { id: publicAccount.id, email: publicAccount.email, name: publicAccount.name, role: publicAccount.role, passwordEnabled: Boolean(profile.user.password_enabled), cpfCnpj: profile.profile.cpf_cnpj ?? '', phone: profile.profile.phone ?? '', companyName: profile.profile.company_name ?? '', city: profile.profile.city ?? '', state: profile.profile.state ?? '', marketingOptIn: Boolean(profile.profile.marketing_opt_in) } });
}));

api.post('/auth/forgot-password', passwordResetRateLimit, asyncRoute(async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const email = parsed.data.email.toLowerCase();
  const genericMessage = 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir sua senha.';
  if (!isEmailConfigured()) {
    log('warn', 'password_reset_email_not_configured', { requestId: requestId(req) });
    throw passwordResetUnavailable();
  }
  const result = await pool.query('SELECT id,email,name FROM users WHERE lower(email)=lower($1) AND active=true', [email]);
  if (!result.rowCount) {
    res.status(202).json({ message: genericMessage });
    return;
  }
  const token = randomBytes(48).toString('base64url');
  const tokenHash = passwordResetTokenHash(token);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  await tx(async (client) => {
    await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [result.rows[0].id]);
    await client.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,request_ip_hash) VALUES($1,$2,$3,$4)', [result.rows[0].id, tokenHash, expiresAt, hashIp(req.ip)]);
  });
  try {
    await sendPasswordResetEmail({ to: String(result.rows[0].email), name: String(result.rows[0].name), token });
  } catch (error) {
    await pool.query('DELETE FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
    log('warn', 'password_reset_email_failed', { requestId: requestId(req), userId: String(result.rows[0].id), reason: error instanceof Error ? error.message : 'unknown' });
    res.status(202).json({ message: genericMessage });
    return;
  }
  await audit(String(result.rows[0].id), 'PASSWORD_RESET_REQUESTED', 'USER', String(result.rows[0].id), { requestId: requestId(req) });
  res.status(202).json({ message: genericMessage });
}));

api.post('/auth/reset-password', passwordResetRateLimit, asyncRoute(async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const tokenHash = passwordResetTokenHash(parsed.data.token);
  const result = await tx(async (client) => {
    const token = await client.query(`SELECT t.id,t.user_id,u.email,u.name,u.role
      FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>now() AND u.active=true
      FOR UPDATE`, [tokenHash]);
    if (!token.rowCount) throw appError('PASSWORD_RESET_TOKEN_INVALID', { code: 'PASSWORD_RESET_TOKEN_INVALID', http: 400, expose: true });
    const row = token.rows[0];
    await client.query('UPDATE users SET password_hash=$2,password_enabled=true,failed_login_attempts=0,locked_until=NULL WHERE id=$1', [row.user_id, await bcrypt.hash(parsed.data.newPassword, 12)]);
    await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1', [row.id]);
    await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
    return row as { id: string; user_id: string; email: string; name: string; role: string };
  });
  const user = publicUser({ id: String(result.user_id), email: String(result.email), name: String(result.name), role: String(result.role) });
  const resultForUser = await authResultForUser(user, 'password_reset', req);
  await audit(user.id, 'PASSWORD_RESET_COMPLETED', 'USER', user.id, { requestId: requestId(req), flow: 'client' });
  res.json({ ...resultForUser, message: 'Senha redefinida com sucesso.' });
}));

api.post('/auth/change-password', auth, asyncRoute(async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await pool.query('SELECT password_hash,password_enabled FROM users WHERE id=$1 AND active=true', [req.user!.id]);
  const passwordEnabled = result.rows[0]?.password_enabled === true;
  if (!result.rowCount || (passwordEnabled && (!parsed.data.currentPassword || !(await bcrypt.compare(parsed.data.currentPassword, result.rows[0].password_hash))))) {
    throw appError('INVALID_CREDENTIALS', { code: 'INVALID_CREDENTIALS', http: 401, expose: true });
  }
  await pool.query('UPDATE users SET password_hash=$2,password_enabled=true WHERE id=$1', [req.user!.id, await bcrypt.hash(parsed.data.newPassword, 12)]);
  await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND id <> $2 AND revoked_at IS NULL', [req.user!.id, req.sessionId ?? '']);
  await audit(req.user!.id, 'PASSWORD_CHANGED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/me', auth, asyncRoute(async (req, res) => {
  const [account, wallet, identities] = await Promise.all([
    pool.query(`SELECT u.id,u.email,u.name,u.role,p.cpf_cnpj,p.phone,p.company_name,p.city,p.state,p.marketing_opt_in
      FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.active=true`, [req.user!.id]),
    pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [req.user!.id]),
    pool.query('SELECT provider FROM user_identities WHERE user_id=$1 ORDER BY provider', [req.user!.id])
  ]);
  if (!account.rowCount) throw appError('ACCOUNT_NOT_FOUND', { code: 'ACCOUNT_NOT_FOUND', http: 404, expose: true });
  const row = account.rows[0];
  const user = publicUser({ id: String(row.id), email: String(row.email), name: String(row.name), role: String(row.role) });
  res.json({ user, balanceCents: Number(wallet.rows[0]?.balance_cents ?? 0), permissions: permissionsFor(user.role), sandbox: env.DATA_PROVIDER === 'mock', identities: identities.rows.map((identity) => identity.provider), profile: { id: user.id, email: user.email, name: user.name, role: user.role, passwordEnabled: Boolean(row.password_enabled), cpfCnpj: row.cpf_cnpj ?? '', phone: row.phone ?? '', companyName: row.company_name ?? '', city: row.city ?? '', state: row.state ?? '', marketingOptIn: Boolean(row.marketing_opt_in) } });
}));

function fipeUnavailable(): AppError {
  return appError('FIPE_FEATURE_DISABLED', { code: 'FIPE_FEATURE_DISABLED', http: 404, expose: true });
}

function fipeProviderError(error: unknown): AppError {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'FIPE_PROVIDER_UNAVAILABLE';
  const knownCodes = ['FIPE_NOT_FOUND', 'FIPE_REFERENCE_MISSING', 'FIPE_PLATE_NOT_FOUND', 'FIPE_PLATE_UNAVAILABLE', 'FIPE_PLATE_DATA_INVALID', 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', 'FIPE_SELECTION_REQUIRED'];
  const publicCode = knownCodes.includes(code) ? code : 'FIPE_PROVIDER_UNAVAILABLE';
  const http = publicCode === 'FIPE_NOT_FOUND' || publicCode === 'FIPE_PLATE_NOT_FOUND' ? 404 : publicCode === 'FIPE_PLATE_DATA_INVALID' || publicCode === 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED' || publicCode === 'FIPE_SELECTION_REQUIRED' ? 422 : 502;
  return appError(publicCode, { code: publicCode, http, expose: true });
}

async function reserveFipeQuota(scopeKey: string, limit: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await tx(async (client) => {
    const result = await client.query(`INSERT INTO fipe_usage(scope_key,bucket_date,count) VALUES($1,$2,1)
      ON CONFLICT(scope_key,bucket_date) DO UPDATE SET count=fipe_usage.count+1,updated_at=now() RETURNING count`, [scopeKey, today]);
    if (Number(result.rows[0].count) <= limit) return;
    await client.query('UPDATE fipe_usage SET count=count-1,updated_at=now() WHERE scope_key=$1 AND bucket_date=$2', [scopeKey, today]);
    throw appError('FIPE_DAILY_LIMIT', { code: 'FIPE_DAILY_LIMIT', http: 429, expose: true });
  });
}

async function releaseFipeQuota(scopeKey: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await pool.query('UPDATE fipe_usage SET count=GREATEST(count-1,0),updated_at=now() WHERE scope_key=$1 AND bucket_date=$2 AND count>0', [scopeKey, today]);
  } catch {
    // A falha de telemetria da cota não pode substituir o erro original da consulta.
  }
}

function requestSourceIp(req: Request): string | undefined {
  const cloudflareIp = req.get('cf-connecting-ip')?.trim();
  if (cloudflareIp && isIP(cloudflareIp)) return cloudflareIp;
  return req.ip;
}

async function recordFunnelEvent(userId: string | null, req: Request, eventType: string, metadata: Record<string, unknown> = {}, clientSessionId?: string): Promise<void> {
  try {
    await pool.query('INSERT INTO funnel_events(user_id,session_key,event_type,metadata) VALUES($1,$2,$3,$4::jsonb)', [userId, hashIp(clientSessionId ?? requestSourceIp(req)), eventType, JSON.stringify(metadata)]);
  } catch {
    // Métricas são auxiliares: uma falha de telemetria não pode alterar a resposta do produto.
  }
}

async function recordProviderHealth(provider: string, status: 'SUCCESS' | 'FAILED', latencyMs: number, errorCode: string | null = null): Promise<void> {
  try {
    await pool.query('INSERT INTO provider_health_events(provider,source_type,status,latency_ms,error_code) VALUES($1,\'FIPE\',$2,$3,$4)', [provider, status, latencyMs, errorCode]);
  } catch {
    // Health check persistido é observabilidade, não dependência do fluxo de consulta.
  }
}

function monthEndExpiry(): Date {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ttl = new Date(now.getTime() + env.FIPE_CACHE_TTL_DAYS * 86400000);
  return ttl < nextMonth ? ttl : nextMonth;
}

async function cacheFipeResult(result: Awaited<ReturnType<typeof quoteWithFallback>>): Promise<void> {
  await pool.query(`INSERT INTO fipe_cache(cache_key,provider,vehicle_type,brand_id,model_id,year_id,reference_code,reference_month,payload,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,reference_code=EXCLUDED.reference_code,reference_month=EXCLUDED.reference_month,expires_at=EXCLUDED.expires_at,updated_at=now()`, [
    result.cacheKey, result.provider, result.vehicleType, result.brand.code, result.model.code, result.year.code, result.referenceCode ?? null, result.referenceMonth, JSON.stringify(result), monthEndExpiry()
  ]);
}

async function findCachedFipeResult(input: { vehicleType: FipeVehicleType; brand: FipeSelectionItem; model: FipeSelectionItem; year: FipeSelectionItem }): Promise<Awaited<ReturnType<typeof quoteWithFallback>> | null> {
  const prefix = `parallelum:${input.vehicleType}:${input.brand.code}:${input.model.code}:${input.year.code}:%`;
  const cached = await pool.query('SELECT payload FROM fipe_cache WHERE cache_key LIKE $1 AND expires_at > now() ORDER BY updated_at DESC LIMIT 1', [prefix]);
  if (!cached.rowCount) return null;
  return cached.rows[0].payload as Awaited<ReturnType<typeof quoteWithFallback>>;
}

async function organizationBrandingForUser(userId: string): Promise<ReportBranding> {
  const result = await pool.query(`SELECT o.name,o.primary_color,o.accent_color,o.logo_url
    FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND o.active=true ORDER BY o.created_at LIMIT 1`, [userId]);
  if (!result.rowCount) return {};
  const row = result.rows[0] as Record<string, unknown>;
  return {
    name: typeof row.name === 'string' ? row.name : undefined,
    primaryColor: typeof row.primary_color === 'string' ? row.primary_color : undefined,
    accentColor: typeof row.accent_color === 'string' ? row.accent_color : undefined,
    logoUrl: typeof row.logo_url === 'string' ? row.logo_url : undefined
  };
}

async function effectivePackagePrice(client: PoolClient, userId: string, packageId: string, basePriceCents: number): Promise<{ priceCents: number; negotiated: boolean }> {
  const membership = await client.query(`SELECT m.organization_id
    FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND o.active=true ORDER BY o.created_at LIMIT 1`, [userId]);
  if (!membership.rowCount) return { priceCents: basePriceCents, negotiated: false };
  const agreement = await client.query(`SELECT price_cents FROM organization_credit_package_prices
    WHERE organization_id=$1 AND package_id=$2 AND active=true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at > now())`, [membership.rows[0].organization_id, packageId]);
  if (!agreement.rowCount) return { priceCents: basePriceCents, negotiated: false };
  const priceCents = Number(agreement.rows[0].price_cents);
  return Number.isInteger(priceCents) && priceCents > 0 ? { priceCents, negotiated: true } : { priceCents: basePriceCents, negotiated: false };
}

async function effectiveQueryPrice(client: PoolClient, userId: string, productId: string, basePriceCents: number, isFree: boolean): Promise<{ priceCents: number; negotiated: boolean }> {
  const base = effectiveQueryPriceCents({ priceCents: basePriceCents, isFree });
  if (isFree) return { priceCents: 0, negotiated: false };
  const membership = await client.query(`SELECT m.organization_id
    FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND o.active=true ORDER BY o.created_at LIMIT 1`, [userId]);
  if (!membership.rowCount) return { priceCents: base, negotiated: false };
  const agreement = await client.query(`SELECT price_cents FROM organization_query_prices
    WHERE organization_id=$1 AND product_id=$2 AND active=true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (ends_at IS NULL OR ends_at > now())`, [membership.rows[0].organization_id, productId]);
  if (!agreement.rowCount) return { priceCents: base, negotiated: false };
  const negotiated = Number(agreement.rows[0].price_cents);
  return Number.isInteger(negotiated) && negotiated >= 0 ? { priceCents: negotiated, negotiated: true } : { priceCents: base, negotiated: false };
}

async function saveFipeDocument(quote: FipeQuote): Promise<void> {
  await pool.query(`INSERT INTO report_documents(document_code,report_kind,provider,report_hash,snapshot)
    VALUES($1,'FIPE_FREE',$2,$3,$4::jsonb) ON CONFLICT(document_code) DO NOTHING`, [quote.documentCode, quote.provider, quote.reportHash, JSON.stringify(reportSnapshot(quote))]);
}

function snapshotQuote(document: Record<string, unknown>): FipeQuote {
  const snapshot = document.snapshot as { report?: FipeQuote } | undefined;
  if (!snapshot?.report?.documentCode || !snapshot.report.reportHash) throw appError('FIPE_INVALID_REPORT', { code: 'FIPE_INVALID_REPORT', http: 500 });
  return snapshot.report;
}

function publicFipeQuote(quote: FipeQuote): Omit<FipeQuote, 'provider' | 'source'> {
  const { provider: _provider, source: _source, ...publicQuote } = quote;
  return publicQuote;
}

async function safeBusinessSettings(): Promise<Record<string, unknown>> {
  const stored = await pool.query('SELECT value FROM platform_settings WHERE key=$1', ['safe_business']);
  return (stored.rows[0]?.value ?? {}) as Record<string, unknown>;
}

async function createContactTicket(userId: string | null, input: { name: string; email: string; subject: string; message: string; category: string }): Promise<{ id: string; emailSent: boolean }> {
  const inserted = await pool.query(`INSERT INTO contact_messages(user_id,name,email,subject,message,category) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at`, [userId, input.name, input.email.toLowerCase(), input.subject, input.message, input.category]);
  const ticketId = String(inserted.rows[0].id);
  const settings = await safeBusinessSettings();
  const supportEmail = typeof settings.supportEmail === 'string' && settings.supportEmail ? settings.supportEmail : null;
  if (!supportEmail || !isEmailConfigured()) return { id: ticketId, emailSent: false };
  try {
    await sendContactMessageEmail({ to: supportEmail, requesterName: input.name, requesterEmail: input.email, subject: input.subject, message: input.message, category: input.category, ticketId });
    await sendContactConfirmationEmail({ to: input.email, requesterName: input.name, subject: input.subject, ticketId });
    return { id: ticketId, emailSent: true };
  } catch (error) {
    log('warn', 'contact_email_failed', { requestId: 'internal', ticketId, reason: error instanceof Error ? error.message : 'unknown' });
    return { id: ticketId, emailSent: false };
  }
}

function publicOfferDescription(_id: string, fallback: string): string {
  return fallback.replace(/\b(provedor|provider|fonte|source|API)\b/gi, 'consulta');
}

function normalizeMatchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchScore(candidate: string, target: string): number {
  const c = normalizeMatchText(candidate);
  const t = normalizeMatchText(target);
  if (!c || !t) return 0;
  if (c === t) return 100;
  if (c.includes(t) || t.includes(c)) return 84;
  const targetTokens = t.split(' ').filter((token) => token.length > 1);
  if (!targetTokens.length) return 0;
  const matched = targetTokens.filter((token) => c.includes(token)).length;
  return Math.round((matched / targetTokens.length) * 70);
}

function bestFipeItem(items: FipeSelectionItem[], target: string, kind: 'brand' | 'model' | 'year'): FipeSelectionItem {
  const targetText = normalizeMatchText(target);
  const exact = items.filter((item) => normalizeMatchText(item.name) === targetText);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw appError('FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', { code: 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', http: 422, expose: true });
  const ranked = items.map((item) => ({ item, score: matchScore(item.name, target) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const threshold = kind === 'brand' ? 60 : kind === 'model' ? 55 : 50;
  const minimumGap = kind === 'model' ? 10 : 6;
  if (!best || best.score < threshold || (second && best.score - second.score < minimumGap)) {
    throw appError('FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', { code: 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', http: 422, expose: true });
  }
  if (kind === 'year') {
    const targetYear = target.match(/\b(?:19|20)\d{2}\b/)?.[0];
    if (targetYear && !normalizeMatchText(best.item.name).includes(targetYear)) {
      throw appError('FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', { code: 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', http: 422, expose: true });
    }
  }
  return best.item;
}

function fipeVehicleDetails(vehicle: NormalizedVehicle): FipeVehicleDetails {
  return {
    plate: vehicle.identification.plate,
    brand: vehicle.identification.brand,
    model: vehicle.identification.model,
    fullModel: vehicle.identification.fullModel,
    manufactureYear: vehicle.characteristics.manufactureYear,
    modelYear: vehicle.characteristics.modelYear,
    color: vehicle.characteristics.color,
    fuel: vehicle.characteristics.fuel,
    power: vehicle.characteristics.power,
    displacement: vehicle.characteristics.displacement,
    type: vehicle.characteristics.type,
    species: vehicle.characteristics.species,
    category: vehicle.characteristics.category,
    body: vehicle.characteristics.body,
    passengers: vehicle.characteristics.passengers,
    loadCapacity: vehicle.characteristics.loadCapacity,
    origin: vehicle.characteristics.origin,
    city: vehicle.registration.city,
    state: vehicle.registration.state,
    licensingYear: vehicle.registration.licensingYear,
    status: vehicle.registration.status
  };
}

function fipeModelTarget(vehicle: NormalizedVehicle): string {
  const model = vehicle.identification.model ?? vehicle.identification.fullModel ?? '';
  const brand = normalizeMatchText(vehicle.identification.brand ?? '');
  if (!brand) return model;
  const modelParts = normalizeMatchText(model).split(' ');
  const brandParts = brand.split(' ');
  if (brandParts.every((part) => modelParts.includes(part))) {
    return modelParts.filter((part) => !brandParts.includes(part)).join(' ') || model;
  }
  return model;
}

function inferFipeVehicleType(vehicle: NormalizedVehicle): FipeVehicleType {
  const text = normalizeMatchText([vehicle.characteristics.type, vehicle.characteristics.species, vehicle.characteristics.category].filter(Boolean).join(' '));
  if (/moto|motocic|ciclomotor|scooter/.test(text)) return 'motorcycles';
  if (/caminhao|caminh|onibus|trator|reboque|semirreboque/.test(text)) return 'trucks';
  return 'cars';
}

async function resolveFipeSelectionFromPlate(plate: string): Promise<{ provider: 'parallelum' | 'brasilapi'; vehicleType: FipeVehicleType; brand: FipeSelectionItem; model: FipeSelectionItem; year: FipeSelectionItem; vehicleDetails: FipeVehicleDetails }> {
  let normalized: NormalizedVehicle;
  try {
    const vehicleProvider = getProvider();
    const output = await withTimeout(vehicleProvider.queryByPlate(plate), env.QUERY_REQUEST_TIMEOUT_MS);
    normalized = normalizeBdrp(output.raw);
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    if (code === 'NOT_FOUND') throw appError('FIPE_PLATE_NOT_FOUND', { code: 'FIPE_PLATE_NOT_FOUND', http: 404, expose: true });
    if (code === 'PROVIDER_TIMEOUT' || code.startsWith('DATA_PROVIDER_')) throw appError('FIPE_PLATE_UNAVAILABLE', { code: 'FIPE_PLATE_UNAVAILABLE', http: 502, expose: true });
    throw appError('FIPE_PLATE_DATA_INVALID', { code: 'FIPE_PLATE_DATA_INVALID', http: 422, expose: true });
  }
  const brandTarget = normalized.identification.brand ?? normalized.identification.fullModel?.split(/\s+/)[0] ?? '';
  const modelTarget = fipeModelTarget(normalized);
  const yearTarget = `${normalized.characteristics.modelYear ?? normalized.characteristics.manufactureYear ?? ''} ${normalized.characteristics.fuel ?? ''}`.trim();
  if (!brandTarget || !modelTarget || !yearTarget) throw appError('FIPE_PLATE_DATA_INVALID', { code: 'FIPE_PLATE_DATA_INVALID', http: 422, expose: true });
  const vehicleType = inferFipeVehicleType(normalized);
  let lastError: unknown;
  for (const providerName of ['parallelum', 'brasilapi'] as const) {
    try {
      const catalog = getFipeProvider(providerName);
      const reference = (await catalog.references())[0];
      if (!reference) throw appError('FIPE_REFERENCE_MISSING', { code: 'FIPE_REFERENCE_MISSING', http: 502, expose: true });
      const brand = bestFipeItem(await catalog.brands(vehicleType, reference.code), brandTarget, 'brand');
      const model = bestFipeItem(await catalog.models(vehicleType, brand, reference.code), modelTarget, 'model');
      const year = bestFipeItem(await catalog.years(vehicleType, brand, model, reference.code), yearTarget, 'year');
      return { provider: providerName, vehicleType, brand, model, year, vehicleDetails: fipeVehicleDetails(normalized) };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error && 'code' in lastError && typeof lastError.code === 'string') {
    if (lastError.code === 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED') throw lastError;
    if (lastError.code.startsWith('FIPE_PROVIDER_') || lastError.code === 'FIPE_INVALID_RESPONSE' || lastError.code === 'FIPE_RATE_LIMITED') {
      throw appError('FIPE_PLATE_UNAVAILABLE', { code: 'FIPE_PLATE_UNAVAILABLE', http: 502, expose: true });
    }
  }
  throw appError('FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', { code: 'FIPE_PLATE_VEHICLE_NOT_IDENTIFIED', http: 422, expose: true });
}

api.get('/fipe/status', (_req, res) => {
  res.json({ enabled: env.FEATURE_FREE_FIPE, pdfEnabled: env.FEATURE_FREE_FIPE && env.FEATURE_REPORT_PDF });
});

api.get('/fipe/references', asyncRoute(async (_req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  try {
    const provider = getFipeProvider('parallelum');
    res.json({ references: await provider.references() });
  } catch (error) { throw fipeProviderError(error); }
}));

api.get('/fipe/brands', asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const vehicleType = fipeVehicleTypeSchema.safeParse(req.query.vehicleType);
  if (!vehicleType.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  try { res.json({ brands: await fipeBrands(vehicleType.data, typeof req.query.reference === 'string' ? req.query.reference : undefined) }); }
  catch (error) { throw fipeProviderError(error); }
}));

api.get('/fipe/models', asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const vehicleType = fipeVehicleTypeSchema.safeParse(req.query.vehicleType);
  const brandCode = typeof req.query.brandCode === 'string' ? req.query.brandCode : '';
  if (!vehicleType.success || !brandCode) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  try { res.json({ models: await fipeModels(vehicleType.data, brandCode, typeof req.query.reference === 'string' ? req.query.reference : undefined) }); }
  catch (error) { throw fipeProviderError(error); }
}));

api.get('/fipe/years', asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const vehicleType = fipeVehicleTypeSchema.safeParse(req.query.vehicleType);
  const brandCode = typeof req.query.brandCode === 'string' ? req.query.brandCode : '';
  const modelCode = typeof req.query.modelCode === 'string' ? req.query.modelCode : '';
  if (!vehicleType.success || !brandCode || !modelCode) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  try { res.json({ years: await fipeYears(vehicleType.data, brandCode, modelCode, typeof req.query.reference === 'string' ? req.query.reference : undefined) }); }
  catch (error) { throw fipeProviderError(error); }
}));

const fipeLookupLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false, skip: () => !env.RATE_LIMIT_ENABLED,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas consultas em pouco tempo. Aguarde um instante e tente de novo.' }
});
const fipeCodeSchema = z.string().regex(/^[A-Za-z0-9._-]{1,24}$/);

/** Busca por texto na própria Tabela FIPE: "onix 2020", "honda cg 160", "chevrolet onix". Devolve modelos (com a marca) e o ano digitado, se houver. */
api.get('/fipe/search', fipeLookupLimiter, asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const vehicleType = fipeVehicleTypeSchema.safeParse(req.query.vehicleType ?? 'cars');
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (!vehicleType.success || q.length < 2) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  try {
    const found = await fipeSearch(vehicleType.data, q);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(found);
  } catch (error) { throw fipeProviderError(error); }
}));

/**
 * Valor FIPE de um veículo já escolhido (marca, modelo, ano), para mostrar no simulador.
 * Não gasta a cota da consulta gratuita e não cria relatório: é só leitura de preço, com cache do mês.
 */
api.get('/fipe/price', fipeLookupLimiter, asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const vehicleType = fipeVehicleTypeSchema.safeParse(req.query.vehicleType ?? 'cars');
  const brandCode = fipeCodeSchema.safeParse(req.query.brandCode);
  const modelCode = fipeCodeSchema.safeParse(req.query.modelCode);
  const yearCode = fipeCodeSchema.safeParse(req.query.yearCode);
  if (!vehicleType.success || !brandCode.success || !modelCode.success || !yearCode.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  try {
    const startedAt = Date.now();
    const { result, cached: cachedResult } = await getFipePrice(vehicleType.data, brandCode.data, modelCode.data, yearCode.data);
    if (!cachedResult) await recordProviderHealth(result.provider, 'SUCCESS', Date.now() - startedAt);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      valueCents: result.valueCents, valueLabel: result.valueLabel, referenceMonth: result.referenceMonth, fipeCode: result.fipeCode,
      brand: result.brand, model: result.model, year: result.year, fuel: result.fuel ?? null, modelYear: result.modelYear ?? null,
      source: result.source, cached: cachedResult
    });
  } catch (error) { throw fipeProviderError(error); }
}));

api.post('/fipe/quote', asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const parsed = fipeSelectionSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const normalizedPlate = parsed.data.plate ? plateSchema.safeParse(parsed.data.plate) : null;
  if (parsed.data.plate && !normalizedPlate?.success) throw appError('INVALID_PLATE', { code: 'INVALID_PLATE', http: 400, expose: true });
  const plate = normalizedPlate?.success ? normalizedPlate.data : undefined;
  // O prefixo v2 isola contadores criados antes da correção de proxy e evita
  // que um IP compartilhado do Cloudflare consuma a cota de todos os visitantes.
  const scopeKey = `v2:ip:${hashIp(requestSourceIp(req)) ?? 'unknown'}`;
  const safeBusiness = await safeBusinessSettings();
  const configuredGuestLimit = safeBusiness.fipeGuestDailyLimit;
  const guestLimit = typeof configuredGuestLimit === 'number' && Number.isInteger(configuredGuestLimit) && configuredGuestLimit > 0 ? configuredGuestLimit : env.FIPE_GUEST_DAILY_LIMIT;
  await reserveFipeQuota(scopeKey, guestLimit);
  let quotaReserved = true;
  let input: { vehicleType: FipeVehicleType; brand: FipeSelectionItem; model: FipeSelectionItem; year: FipeSelectionItem };
  let vehicleDetails: FipeVehicleDetails | undefined;
  let preferredProvider: 'parallelum' | 'brasilapi' = 'parallelum';
  try {
    if (parsed.data.vehicleType && parsed.data.brand && parsed.data.model && parsed.data.year) {
      input = { vehicleType: parsed.data.vehicleType, brand: parsed.data.brand, model: parsed.data.model, year: parsed.data.year };
    } else if (plate) {
      const resolved = await resolveFipeSelectionFromPlate(plate);
      input = { vehicleType: resolved.vehicleType, brand: resolved.brand, model: resolved.model, year: resolved.year };
      vehicleDetails = resolved.vehicleDetails;
      preferredProvider = resolved.provider;
    } else {
      throw appError('FIPE_SELECTION_REQUIRED', { code: 'FIPE_SELECTION_REQUIRED', http: 400, expose: true });
    }
    await recordFunnelEvent(null, req, 'FREE_QUERY_STARTED', { vehicleType: input.vehicleType, plateLookup: Boolean(plate) });
    const providerStartedAt = Date.now();
    const cached = preferredProvider === 'parallelum' ? await findCachedFipeResult(input) : null;
    const result = cached ?? await quoteWithFallback({ ...input, provider: preferredProvider });
    if (!cached) await cacheFipeResult(result);
    const quote = makeFipeQuote(result, plate, vehicleDetails);
    await recordProviderHealth(quote.provider, 'SUCCESS', Date.now() - providerStartedAt);
    await saveFipeDocument(quote);
    await recordFunnelEvent(null, req, 'FREE_QUERY_COMPLETED', { provider: quote.provider, documentCode: quote.documentCode, cached: Boolean(cached), plateLookup: Boolean(plate) });
    res.status(201).json(publicFipeQuote(quote));
  } catch (error) {
    if (quotaReserved) {
      quotaReserved = false;
      await releaseFipeQuota(scopeKey);
    }
    await recordFunnelEvent(null, req, 'FREE_QUERY_FAILED', { error: error instanceof Error ? error.message : 'provider_error', plateLookup: Boolean(plate) });
    throw fipeProviderError(error);
  }
}));

api.post('/fipe/quotes/:code/save', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const document = await pool.query('SELECT * FROM report_documents WHERE document_code=$1 AND report_kind=\'FIPE_FREE\'', [req.params.code]);
  if (!document.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const row = document.rows[0] as Record<string, unknown>;
  if (row.user_id && row.user_id !== req.user!.id) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  if (row.query_id) return res.json({ queryId: row.query_id, documentCode: row.document_code });
  const quote = snapshotQuote(row);
  const saved = await tx(async (client) => {
    const query = await client.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,provider,request_metadata,completed_at)
      VALUES($1,$2,'FIPE_FREE','SUCCESS',0,$3,$4::jsonb,now()) RETURNING id`, [req.user!.id, quote.plate ?? 'SEM-PLACA', quote.provider, JSON.stringify({ documentCode: quote.documentCode, source: quote.source })]);
    const queryId = query.rows[0].id as string;
    await client.query('INSERT INTO vehicle_query_results(query_id,normalized,raw_response) VALUES($1,$2::jsonb,$3::jsonb)', [queryId, JSON.stringify({ __type: 'FIPE_QUOTE', quote }), JSON.stringify({ stored: false })]);
    await client.query('UPDATE report_documents SET user_id=$2,query_id=$3 WHERE document_code=$1', [quote.documentCode, req.user!.id, queryId]);
    return queryId;
  });
  await recordFunnelEvent(req.user!.id, req, 'FREE_QUERY_SAVED', { documentCode: quote.documentCode, queryId: saved });
  await audit(req.user!.id, 'SAVE_FIPE_REPORT', 'REPORT', quote.documentCode, { queryId: saved, requestId: requestId(req) });
  res.status(201).json({ queryId: saved, documentCode: quote.documentCode });
}));

api.get('/fipe/reports/:code/pdf', auth, asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE || !env.FEATURE_REPORT_PDF) throw fipeUnavailable();
  const document = await pool.query('SELECT snapshot FROM report_documents WHERE document_code=$1 AND report_kind=\'FIPE_FREE\'', [req.params.code]);
  if (!document.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const quote = snapshotQuote(document.rows[0] as Record<string, unknown>);
  await recordFunnelEvent(null, req, 'FREE_REPORT_DOWNLOADED', { documentCode: quote.documentCode });
  res.setHeader('Content-Disposition', `attachment; filename="placa-na-mao-${quote.documentCode}.pdf"`);
  const branding = await organizationBrandingForUser(req.user!.id);
  res.type('application/pdf').send(fipePdf(quote, branding));
}));

api.get('/fipe/reports/:code/print', auth, asyncRoute(async (req, res) => {
  if (!env.FEATURE_FREE_FIPE) throw fipeUnavailable();
  const document = await pool.query('SELECT snapshot FROM report_documents WHERE document_code=$1 AND report_kind=\'FIPE_FREE\'', [req.params.code]);
  if (!document.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const quote = snapshotQuote(document.rows[0] as Record<string, unknown>);
  await recordFunnelEvent(null, req, 'REPORT_PRINTED', { documentCode: quote.documentCode });
  const branding = await organizationBrandingForUser(req.user!.id);
  res.type('html').send(fipePrintHtml(quote, branding));
}));

api.get('/stats', asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT count(*) AS total_queries FROM vehicle_queries WHERE status='SUCCESS'");
  res.json({ totalQueries: Number(result.rows[0].total_queries) });
}));

api.post('/contact', contactRateLimit, asyncRoute(async (req, res) => {
  const parsed = contactMessageSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await createContactTicket(null, parsed.data);
  res.status(201).json({ ticketId: result.id, emailSent: result.emailSent, message: result.emailSent ? 'Solicitação recebida. Enviamos uma confirmação para o e-mail informado.' : 'Solicitação recebida. O protocolo foi registrado; o retorno por e-mail será ativado quando o canal estiver configurado.' });
}));

api.post('/account/contact', auth, contactRateLimit, asyncRoute(async (req, res) => {
  const parsed = contactMessageSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await createContactTicket(req.user!.id, parsed.data);
  await audit(req.user!.id, 'CREATE_CONTACT_TICKET', 'CONTACT', result.id, { category: parsed.data.category, requestId: requestId(req) });
  res.status(201).json({ ticketId: result.id, emailSent: result.emailSent, message: result.emailSent ? 'Solicitação recebida. Enviamos uma confirmação para o e-mail informado.' : 'Solicitação recebida e registrada. O canal de e-mail ainda não está configurado.' });
}));

api.post('/plan-interest', asyncRoute(async (req, res) => {
  const parsed = planInterestSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  // O interesse comercial é aceito, mas analytics não recebe e-mail nem outro identificador direto.
  await recordFunnelEvent(null, req, parsed.data.plan === 'RISK' ? 'RISK_INTEREST' : 'PREMIUM_INTEREST', { plan: parsed.data.plan });
  res.status(201).json({ ok: true });
}));

api.post('/funnel/events', asyncRoute(async (req, res) => {
  const parsed = funnelEventSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  await recordFunnelEvent(null, req, parsed.data.event, sanitizePublicFunnelMetadata({ path: parsed.data.path, ...parsed.data.metadata }), parsed.data.sessionId);
  res.status(202).json({ accepted: true });
}));

api.get('/validar-relatorio/:code', asyncRoute(async (req, res) => {
  const document = await pool.query(`SELECT document_code,report_kind,report_version,provider,report_hash,snapshot,created_at,superseded_at
    FROM report_documents WHERE document_code=$1`, [req.params.code]);
  if (document.rowCount) {
    const row = document.rows[0] as Record<string, unknown>;
    const quote = row.report_kind === 'FIPE_FREE' ? snapshotQuote(row) : null;
    return res.json({ authentic: true, reportKind: row.report_kind, reportVersion: row.report_version, documentCode: row.document_code, createdAt: row.created_at, status: row.superseded_at ? 'UPDATED' : 'VALID', hash: row.report_hash, plate: quote?.plate ? `${quote.plate.slice(0, 3)}***${quote.plate.slice(-2)}` : null, fipeReferenceMonth: quote?.referenceMonth ?? null });
  }
  const code = String(req.params.code).trim().toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(code)) return res.status(404).json({ authentic: false, status: 'NOT_FOUND' });
  const query = await pool.query(`SELECT q.id,q.status,q.result_hash,q.created_at,q.plate
    FROM vehicle_queries q WHERE q.status='SUCCESS' AND upper(q.id::text) LIKE $1 ORDER BY q.created_at DESC LIMIT 1`, [`${code}%`]);
  if (!query.rowCount) return res.status(404).json({ authentic: false, status: 'NOT_FOUND' });
  const row = query.rows[0] as Record<string, unknown>;
  const plate = String(row.plate ?? '');
  return res.json({ authentic: true, reportKind: 'VEHICLE_QUERY', reportVersion: 1, documentCode: code, createdAt: row.created_at, status: 'VALID', hash: row.result_hash, plate: plate ? `${plate.slice(0, 3)}***${plate.slice(-2)}` : null, fipeReferenceMonth: null });
}));

api.get('/query-products', auth, asyncRoute(async (req, res) => {
  const products = await pool.query(`SELECT p.id,p.name,p.description,p.price_cents,p.slug,p.features,p.display_order,p.is_free,p.source,p.coverage,
      CASE WHEN p.is_free OR ($2::boolean AND EXISTS (SELECT 1 FROM query_source_rules rule WHERE rule.product_id=p.id AND rule.active=true)) THEN p.commercial_status ELSE 'SOON' END AS commercial_status,p.featured,
      CASE WHEN p.is_free THEN 0 ELSE COALESCE(orgp.price_cents,p.price_cents) END AS effective_price_cents,
      (orgp.price_cents IS NOT NULL AND NOT p.is_free) AS negotiated
    FROM query_products p
    LEFT JOIN LATERAL (
      SELECT qp.price_cents FROM organization_members m JOIN organizations o ON o.id=m.organization_id AND o.active=true
      JOIN organization_query_prices qp ON qp.organization_id=o.id AND qp.product_id=p.id AND qp.active=true
        AND (qp.starts_at IS NULL OR qp.starts_at <= now()) AND (qp.ends_at IS NULL OR qp.ends_at > now())
      WHERE m.user_id=$1 ORDER BY o.created_at LIMIT 1
    ) orgp ON true
    WHERE p.active=true ORDER BY p.display_order,p.price_cents`, [req.user!.id, env.DATA_PROVIDER !== 'disabled']);
  res.json(products.rows.map((product) => ({ id: product.id, name: product.name, description: product.description, basePriceCents: Number(product.price_cents ?? 0), priceCents: Number(product.effective_price_cents ?? 0), negotiated: Boolean(product.negotiated), slug: product.slug, features: product.features, isFree: Boolean(product.is_free), commercialStatus: product.commercial_status, featured: Boolean(product.featured) })));
}));

api.use(publicContentRouter);

/** Guia de veículos: a rota por placa fica aqui porque usa o provedor de dados e a cota diária, e precisa vir antes das rotas `/vehicles/:slug`. */
const VEHICLE_PLATE_DAILY_LIMIT = 5;
api.post('/vehicles/by-plate', auth, asyncRoute(async (req, res) => {
  const plate = plateSchema.safeParse((req.body as { plate?: unknown } | undefined)?.plate);
  if (!plate.success) throw appError('INVALID_PLATE', { code: 'INVALID_PLATE', http: 400, expose: true });
  const scopeKey = `vguide:plate:${req.user!.id}`;
  await reserveFipeQuota(scopeKey, VEHICLE_PLATE_DAILY_LIMIT);
  let normalized: NormalizedVehicle;
  try {
    const output = await withTimeout(getProvider().queryByPlate(plate.data), env.QUERY_REQUEST_TIMEOUT_MS);
    normalized = normalizeBdrp(output.raw);
  } catch (error) {
    await releaseFipeQuota(scopeKey);
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
    if (code === 'NOT_FOUND') throw appError('FIPE_PLATE_NOT_FOUND', { code: 'FIPE_PLATE_NOT_FOUND', http: 404, expose: true });
    throw appError('VEHICLE_PLATE_UNAVAILABLE', { code: 'VEHICLE_PLATE_UNAVAILABLE', http: 503, expose: true });
  }
  const brand = normalized.identification.brand ?? normalized.identification.fullModel?.split(/\s+/)[0] ?? '';
  const model = fipeModelTarget(normalized);
  const fullModel = normalized.identification.fullModel ?? model;
  const year = Number(normalized.characteristics.modelYear ?? normalized.characteristics.manufactureYear ?? '') || null;
  const candidates = brand ? await pool.query(`SELECT m.id,m.slug,m.brand,m.name FROM vehicle_models m WHERE m.status='PUBLISHED' AND m.archived_at IS NULL AND m.brand ILIKE $1`, [`%${brand.split(/\s+/)[0]!.replace(/[%_\\]/g, '')}%`]) : { rows: [] as Array<Record<string, any>> };
  const scored = candidates.rows
    .map((c) => ({ c, score: Math.max(scoreModelMatch({ brand, model }, { brand: c.brand, name: c.name }), scoreModelMatch({ brand, model: fullModel }, { brand: c.brand, name: c.name })) }))
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  const versions = scored.length ? await pool.query('SELECT id,model_id,name,year_model,fuel FROM vehicle_versions WHERE model_id = ANY($1::uuid[]) AND active ORDER BY year_model DESC NULLS LAST, display_order, name', [scored.map((x) => x.c.id)]) : { rows: [] as Array<Record<string, any>> };
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    vehicle: { plate: plate.data, brand: normalized.identification.brand ?? null, model: fullModel || null, year, fuel: normalized.characteristics.fuel ?? null },
    matches: scored.map((x) => ({
      slug: x.c.slug, brand: x.c.brand, name: x.c.name,
      versions: versions.rows.filter((v) => v.model_id === x.c.id).map((v) => ({ id: v.id, name: v.name, yearModel: v.year_model, fuel: v.fuel, sameYear: year != null && v.year_model === year }))
    }))
  });
}));
api.use(publicVehiclesRouter);
api.use(simulatorRouter);
api.use(garageRouter);

api.get('/fipe/offers', asyncRoute(async (_req, res) => {
  const products = await pool.query(`SELECT p.id,p.name,p.description,p.price_cents,p.is_free,p.features,
      CASE WHEN p.is_free OR ($1::boolean AND EXISTS (SELECT 1 FROM query_source_rules rule WHERE rule.product_id=p.id AND rule.active=true)) THEN p.commercial_status ELSE 'SOON' END AS commercial_status,p.featured
    FROM query_products p WHERE p.active=true ORDER BY p.display_order,p.price_cents`, [env.DATA_PROVIDER !== 'disabled']);
  res.json({ offers: products.rows.map((product) => ({ id: product.id, name: product.name, description: publicOfferDescription(product.id, product.description), priceCents: Boolean(product.is_free) ? 0 : Number(product.price_cents ?? 0), features: product.features, commercialStatus: product.commercial_status, featured: Boolean(product.featured) })) });
}));

type RunQueryInput = { userId: string; plate: string; productId: string; paymentOrderId?: string; idempotencyKey: string | null; reqId: string; source: 'WEB' | 'API' };

/** Executa uma consulta de ponta a ponta (cobrança, provedor, armazenamento, estorno em falha). Usada pelo web e pela API pública. */
async function runVehicleQuery(input: RunQueryInput): Promise<{ status: number; body: Record<string, unknown> }> {
  const { userId, idempotencyKey } = input;
  const provider = getProvider();
  let queryId: string | null = null;
  let cost = 0;
  let chargeSource = 'WALLET_MONEY';
  let entitlementId: string | null = null;

  if (idempotencyKey) {
    const duplicate = await pool.query(`SELECT q.id,q.plate,q.product_id,q.status,q.credits_cost,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,p.name AS product_name,r.normalized
      FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
      WHERE q.user_id=$1 AND q.idempotency_key=$2`, [userId, idempotencyKey]);
    if (duplicate.rowCount) {
      const existing = serializeQuery(duplicate.rows[0] as QueryRow & Record<string, unknown>);
      if (existing.status === 'SUCCESS') return { status: 200, body: { ...existing, idempotent: true } };
      throw appError('QUERY_IN_PROGRESS', { code: 'QUERY_IN_PROGRESS', http: 409, expose: true });
    }
  }

  try {
    await tx(async (client) => {
      const product = await client.query('SELECT price_cents,is_free FROM query_products WHERE id=$1 AND active=true', [input.productId]);
      if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404 });
      const pricing = await effectiveQueryPrice(client, userId, input.productId, Number(product.rows[0].price_cents ?? 0), Boolean(product.rows[0].is_free));
      cost = pricing.priceCents;
      let before = 0;
      let after = 0;
      if (input.paymentOrderId) {
        const entitlement = await client.query(`SELECT e.id,e.status,e.user_id,e.product_id,e.plate,o.status AS order_status,o.amount_cents
          FROM query_payment_entitlements e JOIN payment_orders o ON o.id=e.order_id
          WHERE e.order_id=$1 AND e.user_id=$2 AND e.product_id=$3 AND e.plate=$4 FOR UPDATE`, [input.paymentOrderId, userId, input.productId, input.plate]);
        if (!entitlement.rowCount) throw appError('QUERY_PAYMENT_NOT_READY', { code: 'QUERY_PAYMENT_NOT_READY', http: 409, expose: true });
        if (String(entitlement.rows[0].status) !== 'READY' || String(entitlement.rows[0].order_status) !== 'PAID') throw appError('QUERY_PAYMENT_ALREADY_USED', { code: 'QUERY_PAYMENT_ALREADY_USED', http: 409, expose: true });
        cost = Number(entitlement.rows[0].amount_cents);
        chargeSource = 'DIRECT_PAYMENT';
        entitlementId = String(entitlement.rows[0].id);
      } else {
        const wallet = await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [userId]);
        if (!wallet.rowCount || Number(wallet.rows[0].balance_cents) < cost) throw appError('INSUFFICIENT_BALANCE', { code: 'INSUFFICIENT_BALANCE', http: 402, expose: true });
        before = Number(wallet.rows[0].balance_cents);
        after = before - cost;
      }
      const created = await client.query(`INSERT INTO vehicle_queries(user_id,plate,product_id,status,credits_cost,price_cents,charge_source,provider,idempotency_key,payment_order_id,request_metadata,source)
        VALUES($1,$2,$3,'PROCESSING',0,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING id`, [userId, input.plate, input.productId, cost, chargeSource, provider.name, idempotencyKey, input.paymentOrderId ?? null, JSON.stringify({ requestId: input.reqId, negotiated: pricing.negotiated }), input.source]);
      queryId = created.rows[0].id as string;
      if (!input.paymentOrderId) {
        await client.query('UPDATE wallets SET balance_cents=$2,updated_at=now() WHERE user_id=$1', [userId, after]);
        await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,query_id,description,metadata)
          VALUES($1,'QUERY',0,0,0,$2,$3,$4,$5,$6,$7::jsonb)`, [userId, -cost, before, after, queryId, `Consulta ${input.plate}`, JSON.stringify({ productId: input.productId, negotiated: pricing.negotiated, requestId: input.reqId })]);
      } else {
        await client.query(`UPDATE query_payment_entitlements SET status='CONSUMED',query_id=$2,consumed_at=now() WHERE id=$1 AND status='READY'`, [entitlementId, queryId]);
      }
    });

    const output = await executeVehicleLookup({ provider, plate: input.plate, timeoutMs: env.QUERY_REQUEST_TIMEOUT_MS, normalize: normalizeBdrp });
    const normalized = output.normalized;
    const resultHash = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    await tx(async (client) => {
      await client.query('INSERT INTO vehicle_query_results(query_id,normalized,raw_response,raw_enc,normalizer_version) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)', [queryId, JSON.stringify(normalized), JSON.stringify({ stored: env.STORE_RAW_PROVIDER_RESPONSE, encrypted: env.STORE_RAW_PROVIDER_RESPONSE }), env.STORE_RAW_PROVIDER_RESPONSE ? encryptRaw(output.raw) : null, NORMALIZER_VERSION]);
      await client.query(`UPDATE vehicle_queries SET status='SUCCESS',provider_query_id=$2,result_hash=$3,completed_at=now() WHERE id=$1`, [queryId, output.providerQueryId ?? null, resultHash]);
    });
    await audit(userId, 'VEHICLE_QUERY', 'VEHICLE_QUERY', queryId, { plate: input.plate, productId: input.productId, provider: provider.name, requestId: input.reqId });
    const completed = await pool.query(`SELECT q.id,q.plate,q.product_id,q.status,q.credits_cost,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,p.name AS product_name,r.normalized
      FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1`, [queryId]);
    const completedRow = completed.rows[0] as QueryRow & Record<string, unknown>;
    return { status: 201, body: serializeQuery(completedRow) };
  } catch (error: unknown) {
    if (queryId) {
      const errorCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'PROVIDER_ERROR';
      await tx((client) => refundProcessingQuery(client, queryId!, errorCode));
      await audit(userId, 'QUERY_REFUND', 'VEHICLE_QUERY', queryId, { plate: input.plate, requestId: input.reqId });
    }
    const safe = toSafeQueryError(error);
    return { status: safe.status, body: { error: safe.code, message: safe.message, refunded: Boolean(queryId) && chargeSource !== 'DIRECT_PAYMENT' } };
  }
}

api.post('/queries', auth, requirePermission('QUERY_VEHICLE'), asyncRoute(async (req, res) => {
  const parsed = requestQuerySchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_PLATE', { code: 'INVALID_PLATE', http: 400, expose: true });
  const idempotencyKeyHeader = req.headers['idempotency-key'];
  const idempotencyKey = typeof idempotencyKeyHeader === 'string' && /^[a-zA-Z0-9_-]{12,128}$/.test(idempotencyKeyHeader) ? idempotencyKeyHeader : null;
  const out = await runVehicleQuery({ userId: req.user!.id, plate: parsed.data.plate, productId: parsed.data.productId, paymentOrderId: parsed.data.paymentOrderId, idempotencyKey, reqId: requestId(req), source: 'WEB' });
  res.status(out.status).json(out.body);
}));

api.get('/queries', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const plate = typeof req.query.plate === 'string' ? req.query.plate.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) : '';
  const status = typeof req.query.status === 'string' && ['PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED'].includes(req.query.status) ? req.query.status : null;
  const results = await pool.query(`SELECT q.id,q.plate,q.product_id,q.status,q.credits_cost,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,p.name AS product_name,r.normalized
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.user_id=$1 AND ($2='' OR q.plate LIKE $2 || '%') AND ($3::text IS NULL OR q.status=$3)
    ORDER BY q.created_at DESC LIMIT 100`, [req.user!.id, plate, status]);
  res.json(results.rows.map((row) => serializeQuery(row as QueryRow & Record<string, unknown>)));
}));

api.get('/queries/:id', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const query = await pool.query(`SELECT q.id,q.plate,q.product_id,q.status,q.credits_cost,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,p.name AS product_name,r.normalized
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.id=$1 AND q.user_id=$2`, [req.params.id, req.user!.id]);
  if (!query.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'VIEW_SAVED_QUERY', 'VEHICLE_QUERY', String(req.params.id), { requestId: requestId(req) });
  res.json(serializeQuery(query.rows[0] as QueryRow & Record<string, unknown>));
}));

api.get('/queries/:id/export', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const query = await pool.query(`SELECT q.id,q.plate,q.product_id,q.status,q.credits_cost,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,p.name AS product_name,r.normalized
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.id=$1 AND q.user_id=$2`, [req.params.id, req.user!.id]);
  if (!query.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'EXPORT_QUERY_JSON', 'VEHICLE_QUERY', String(req.params.id), { requestId: requestId(req) });
  res.setHeader('Content-Disposition', `attachment; filename="placa-na-mao-${req.params.id}.json"`);
  res.type('application/json').send(JSON.stringify(serializeQuery(query.rows[0] as QueryRow & Record<string, unknown>), null, 2));
}));

async function vehicleReportForQuery(queryId: string, userId: string) {
  const query = await pool.query(`SELECT q.id,q.plate,q.product_id,q.created_at,q.completed_at,q.result_hash,p.name AS product_name,r.normalized
    FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.id=$1 AND q.user_id=$2 AND q.status='SUCCESS'`, [queryId, userId]);
  if (!query.rowCount) throw appError('REPORT_NOT_FOUND', { code: 'REPORT_NOT_FOUND', http: 404, expose: true });
  const row = query.rows[0] as Record<string, unknown>;
  const vehicle = row.normalized as NormalizedVehicle | null;
  if (!vehicle?.v2) throw appError('REPORT_UNAVAILABLE', { code: 'REPORT_UNAVAILABLE', http: 409, expose: true });
  const report = viewReport(vehicle.v2, { audience: 'client', tier: tierForProductCode(String(row.product_id)), sections: sectionsForProduct(String(row.product_id)) });
  const code = String(row.id).slice(0, 8).toUpperCase();
  const base = (env.APP_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');
  const meta: ReportMeta = { productName: String(row.product_name), verificationCode: code, verificationUrl: `${base}/validar/${code}`, consultedAt: new Date(String(row.completed_at ?? row.created_at)), resultHash: row.result_hash ? String(row.result_hash) : null, audience: 'client' };
  return { report, meta };
}

api.get('/queries/:id/report', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const { report, meta } = await vehicleReportForQuery(String(req.params.id), req.user!.id);
  await recordFunnelEvent(req.user!.id, req, 'REPORT_OPENED', { queryId: String(req.params.id) });
  res.json({ report, verificationCode: meta.verificationCode, verificationUrl: meta.verificationUrl, consultedAt: meta.consultedAt, productName: meta.productName });
}));

const disputeBody = z.object({ field: z.string().trim().max(80).default(''), message: z.string().trim().min(10).max(800) }).strict();
/** Contestação: a pessoa aponta um dado que parece errado; vira um chamado no Suporte com a placa e o código do relatório. */
api.post('/queries/:id/report/dispute', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const parsed = disputeBody.safeParse(req.body);
  if (!parsed.success) throw appError('Descreva o que parece errado (mínimo 10 caracteres).', { code: 'INVALID_INPUT', http: 400, expose: true });
  const { report, meta } = await vehicleReportForQuery(String(req.params.id), req.user!.id);
  const recent = await pool.query(`SELECT count(*)::int AS n FROM contact_messages WHERE user_id=$1 AND subject LIKE 'Contestação de dado%' AND created_at > now() - interval '1 day'`, [req.user!.id]);
  if (Number(recent.rows[0].n) >= 5) throw appError('Você já enviou várias contestações hoje. Aguarde o retorno do suporte.', { code: 'TOO_MANY_ATTEMPTS', http: 429, expose: true });
  const ticket = await createContactTicket(req.user!.id, {
    name: req.user!.name, email: req.user!.email, category: 'SUPPORT',
    subject: `Contestação de dado - placa ${report.plate} - código ${meta.verificationCode}`,
    message: `${parsed.data.field ? `Campo: ${parsed.data.field}\n` : ''}${parsed.data.message}\n\nProduto: ${meta.productName}\nConsultado em: ${meta.consultedAt}`
  });
  await recordFunnelEvent(req.user!.id, req, 'REPORT_DISPUTED', { productName: meta.productName });
  res.status(201).json({ id: ticket.id });
}));

api.get('/queries/:id/report/pdf', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const { report, meta } = await vehicleReportForQuery(String(req.params.id), req.user!.id);
  await audit(req.user!.id, 'EXPORT_QUERY_REPORT_PDF', 'VEHICLE_QUERY', String(req.params.id), { requestId: requestId(req) });
  res.setHeader('Content-Disposition', `attachment; filename="placa-na-mao-${meta.verificationCode}.pdf"`);
  res.type('application/pdf').send(await renderVehiclePdf(report, meta));
}));

api.get('/queries/:id/report/print', auth, requirePermission('VIEW_HISTORY'), asyncRoute(async (req, res) => {
  const { report, meta } = await vehicleReportForQuery(String(req.params.id), req.user!.id);
  await audit(req.user!.id, 'PRINT_QUERY_REPORT', 'VEHICLE_QUERY', String(req.params.id), { requestId: requestId(req) });
  res.type('html').send(renderVehicleHtml(report, meta));
}));

api.get('/wallet/transactions', auth, asyncRoute(async (req, res) => {
  const transactions = await pool.query('SELECT id,kind,amount_cents,balance_before_cents,balance_after_cents,description,created_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user!.id]);
  res.json(transactions.rows.map((row) => ({ id: row.id, kind: row.kind, amountCents: Number(row.amount_cents ?? 0), balanceBeforeCents: Number(row.balance_before_cents ?? 0), balanceAfterCents: Number(row.balance_after_cents ?? 0), description: row.description, createdAt: row.created_at })));
}));

api.post('/payments/sandbox', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  if (!env.SANDBOX_CREDIT_PURCHASE_ENABLED) throw appError('SANDBOX_DISABLED', { code: 'SANDBOX_DISABLED', http: 403, expose: true });
  const parsed = sandboxCreditSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const { amountCents } = parsed.data;
  const result = await tx(async (client) => {
    const payment = await client.query(`INSERT INTO payments(user_id,provider,status,amount_cents,credits,paid_at,metadata)
      VALUES($1,'sandbox','PAID',$2,0,now(),$3::jsonb) RETURNING id`, [req.user!.id, amountCents, JSON.stringify({ requestId: requestId(req), sandbox: true })]);
    const wallet = await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [req.user!.id]);
    const before = Number(wallet.rows[0]?.balance_cents ?? 0);
    const after = before + amountCents;
    await client.query('UPDATE wallets SET balance_cents=$2,updated_at=now() WHERE user_id=$1', [req.user!.id, after]);
    await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,payment_id,description,metadata)
      VALUES($1,'PURCHASE',0,0,0,$2,$3,$4,$5,$6,$7::jsonb)`, [req.user!.id, amountCents, before, after, payment.rows[0].id, 'Saldo de teste (sandbox)', JSON.stringify({ requestId: requestId(req), sandbox: true })]);
    return { paymentId: payment.rows[0].id, balanceCents: after };
  });
  await audit(req.user!.id, 'SANDBOX_CREDIT_PURCHASE', 'PAYMENT', result.paymentId, { amountCents, requestId: requestId(req) });
  res.status(201).json({ status: 'PAID', amountCents, ...result });
}));

api.get('/credit-packages', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const packages = await pool.query('SELECT id,slug,name,description,credits,price_cents FROM credit_packages WHERE active=true ORDER BY display_order,price_cents');
  const items = await Promise.all(packages.rows.map(async (item) => {
    const pricing = await tx((client) => effectivePackagePrice(client, req.user!.id, String(item.id), Number(item.price_cents)));
    return { slug: item.slug, name: item.name, description: item.description, credits: Number(item.credits), basePriceCents: Number(item.price_cents), priceCents: pricing.priceCents, negotiated: pricing.negotiated };
  }));
  res.json(items);
}));

api.get('/payments/orders', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const orders = await pool.query(`SELECT id,status,amount_cents,purchase_type,product_id,query_plate,provider,checkout_url,created_at,paid_at
    FROM payment_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user!.id]);
  res.json(orders.rows.map((item) => ({ id: item.id, status: item.status, amountCents: Number(item.amount_cents ?? 0), purchaseType: item.purchase_type, productId: item.product_id, plate: item.query_plate, provider: item.provider, checkoutUrl: item.checkout_url, createdAt: item.created_at, paidAt: item.paid_at })));
}));

api.post('/payments/quote', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const quote = await tx(async (client) => {
    const pack = await client.query('SELECT id,slug,name,credits,price_cents FROM credit_packages WHERE slug=$1 AND active=true', [parsed.data.packageSlug]);
    if (!pack.rowCount) throw appError('CREDIT_PACKAGE_NOT_FOUND', { code: 'CREDIT_PACKAGE_NOT_FOUND', http: 404, expose: true });
    const packRow = pack.rows[0] as Record<string, unknown>;
    const basePriceCents = Number(packRow.price_cents);
    const pricing = await effectivePackagePrice(client, req.user!.id, String(packRow.id), basePriceCents);
    const subtotalCents = pricing.priceCents;
    let discountCents = 0;
    let couponCode: string | null = null;
    if (parsed.data.couponCode) {
      const coupon = await client.query(`SELECT id,code,discount_type,discount_value,max_redemptions,redeemed_count,active,starts_at,expires_at
        FROM coupons WHERE upper(code)=upper($1) FOR SHARE`, [parsed.data.couponCode]);
      if (!coupon.rowCount) throw appError('COUPON_INVALID', { code: 'COUPON_INVALID', http: 400, expose: true });
      const couponRow = coupon.rows[0] as Record<string, unknown>;
      const reservations = await client.query(`SELECT count(*)::int AS reserved_count FROM coupon_redemptions WHERE coupon_id=$1 AND status='RESERVED'`, [couponRow.id]);
      if (!couponWindowIsOpen({ active: Boolean(couponRow.active), startsAt: couponRow.starts_at as string | Date | null, expiresAt: couponRow.expires_at as string | Date | null }) || !couponHasCapacity(couponRow.max_redemptions == null ? null : Number(couponRow.max_redemptions), Number(couponRow.redeemed_count), Number(reservations.rows[0]?.reserved_count ?? 0))) {
        throw appError('COUPON_UNAVAILABLE', { code: 'COUPON_UNAVAILABLE', http: 400, expose: true });
      }
      couponCode = String(couponRow.code);
      discountCents = calculateCouponDiscount(subtotalCents, String(couponRow.discount_type) as 'PERCENT' | 'FIXED', Number(couponRow.discount_value));
      if (discountCents >= subtotalCents) throw appError('COUPON_ZERO_TOTAL_UNSUPPORTED', { code: 'COUPON_ZERO_TOTAL_UNSUPPORTED', http: 400, expose: true });
    }
    return { packageSlug: String(packRow.slug), packageName: String(packRow.name), credits: Number(packRow.credits), couponCode, affiliateCode: parsed.data.affiliateCode ?? null, basePriceCents, negotiated: pricing.negotiated, subtotalCents, discountCents, amountCents: Math.max(0, subtotalCents - discountCents) };
  });
  res.json({ ...quote, paymentProviderConfigured: getPaymentProvider().isConfigured(), usageCountChangesOnlyAfterPaid: true });
}));

api.post('/payments/checkout', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const paymentProvider = getPaymentProvider();
  if (!paymentProvider.isConfigured()) throw appError('PAYMENT_PROVIDER_NOT_CONFIGURED', { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', http: 503, expose: true });
  const draft = await tx(async (client) => {
    const pack = await client.query('SELECT id,slug,name,description,credits,price_cents FROM credit_packages WHERE slug=$1 AND active=true', [parsed.data.packageSlug]);
    if (!pack.rowCount) throw appError('CREDIT_PACKAGE_NOT_FOUND', { code: 'CREDIT_PACKAGE_NOT_FOUND', http: 404, expose: true });
    const profile = await client.query(`SELECT u.name,u.email,p.cpf_cnpj,p.phone FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.active=true`, [req.user!.id]);
    if (!profile.rowCount) throw appError('AUTH_REQUIRED', { code: 'AUTH_REQUIRED', http: 401, expose: true });
    const packRow = pack.rows[0] as Record<string, unknown>;
    const basePriceCents = Number(packRow.price_cents);
    const pricing = await effectivePackagePrice(client, req.user!.id, String(packRow.id), basePriceCents);
    const subtotalCents = pricing.priceCents;
    let discountCents = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    if (parsed.data.couponCode) {
      const coupon = await client.query(`SELECT id,code,discount_type,discount_value,max_redemptions,redeemed_count,active,starts_at,expires_at
        FROM coupons WHERE upper(code)=upper($1) FOR UPDATE`, [parsed.data.couponCode]);
      if (!coupon.rowCount) throw appError('COUPON_INVALID', { code: 'COUPON_INVALID', http: 400, expose: true });
      const couponRow = coupon.rows[0] as Record<string, unknown>;
      const reservations = await client.query(`SELECT count(*)::int AS reserved_count FROM coupon_redemptions WHERE coupon_id=$1 AND status='RESERVED'`, [couponRow.id]);
      if (!couponWindowIsOpen({ active: Boolean(couponRow.active), startsAt: couponRow.starts_at as string | Date | null, expiresAt: couponRow.expires_at as string | Date | null }) || !couponHasCapacity(couponRow.max_redemptions == null ? null : Number(couponRow.max_redemptions), Number(couponRow.redeemed_count), Number(reservations.rows[0]?.reserved_count ?? 0))) {
        throw appError('COUPON_UNAVAILABLE', { code: 'COUPON_UNAVAILABLE', http: 400, expose: true });
      }
      couponId = String(couponRow.id); couponCode = String(couponRow.code);
      discountCents = calculateCouponDiscount(subtotalCents, String(couponRow.discount_type) as 'PERCENT' | 'FIXED', Number(couponRow.discount_value));
      if (discountCents >= subtotalCents) throw appError('COUPON_ZERO_TOTAL_UNSUPPORTED', { code: 'COUPON_ZERO_TOTAL_UNSUPPORTED', http: 400, expose: true });
    }
    let affiliateId: string | null = null;
    let affiliateCommissionBps = 0;
    if (parsed.data.affiliateCode) {
      const affiliate = await client.query('SELECT id,user_id,commission_bps FROM affiliates WHERE upper(code)=upper($1) AND active=true', [parsed.data.affiliateCode]);
      if (!affiliate.rowCount || (affiliate.rows[0].user_id && String(affiliate.rows[0].user_id) === req.user!.id)) throw appError('AFFILIATE_INVALID', { code: 'AFFILIATE_INVALID', http: 400, expose: true });
      affiliateId = String(affiliate.rows[0].id); affiliateCommissionBps = Number(affiliate.rows[0].commission_bps);
    } else {
      const affiliate = await client.query(`SELECT a.id,a.user_id,a.commission_bps FROM users u JOIN affiliates a ON a.id=u.affiliate_id AND a.active=true WHERE u.id=$1`, [req.user!.id]);
      if (affiliate.rowCount && (!affiliate.rows[0].user_id || String(affiliate.rows[0].user_id) !== req.user!.id)) { affiliateId = String(affiliate.rows[0].id); affiliateCommissionBps = Number(affiliate.rows[0].commission_bps); }
    }
    const amountCents = Math.max(0, subtotalCents - discountCents);
    const externalReference = `pnm_${crypto.randomUUID()}`;
    const order = await client.query(`INSERT INTO payment_orders(user_id,package_id,status,subtotal_cents,amount_cents,credits,provider,external_reference,discount_cents,coupon_id,affiliate_id,affiliate_commission_bps)
      VALUES($1,$2,'CREATED',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [req.user!.id, packRow.id, subtotalCents, amountCents, packRow.credits, paymentProvider.name, externalReference, discountCents, couponId, affiliateId, affiliateCommissionBps]);
    if (couponId) await client.query(`INSERT INTO coupon_redemptions(coupon_id,payment_order_id,status) VALUES($1,$2,'RESERVED')`, [couponId, order.rows[0].id]);
    return { orderId: order.rows[0].id as string, externalReference, pack: packRow, customer: profile.rows[0] as Record<string, unknown>, subtotalCents, discountCents, amountCents, couponCode, couponId, affiliateId };
  });
  try {
    const checkout = await paymentProvider.createCheckout({
      orderId: draft.externalReference,
      itemName: String(draft.pack.name),
      itemDescription: String(draft.pack.description),
      amountCents: draft.amountCents,
      customer: { name: String(draft.customer.name), email: String(draft.customer.email), cpfCnpj: draft.customer.cpf_cnpj ? String(draft.customer.cpf_cnpj) : undefined, phone: draft.customer.phone ? String(draft.customer.phone) : undefined }
    });
    await pool.query(`UPDATE payment_orders SET status='CHECKOUT_ACTIVE',provider_checkout_id=$2,checkout_url=$3,updated_at=now() WHERE id=$1`, [draft.orderId, checkout.id, checkout.link]);
    await audit(req.user!.id, 'CREATE_PAYMENT_CHECKOUT', 'PAYMENT_ORDER', draft.orderId, { packageSlug: parsed.data.packageSlug, requestId: requestId(req) });
    res.status(201).json({ orderId: draft.orderId, checkoutUrl: checkout.link, provider: paymentProvider.name, subtotalCents: draft.subtotalCents, discountCents: draft.discountCents, amountCents: draft.amountCents, couponCode: draft.couponCode });
  } catch (error) {
    await pool.query(`UPDATE payment_orders SET status='FAILED',updated_at=now() WHERE id=$1`, [draft.orderId]);
    await pool.query(`UPDATE coupon_redemptions SET status='RELEASED',updated_at=now() WHERE payment_order_id=$1 AND status='RESERVED'`, [draft.orderId]);
    throw error;
  }
}));

api.post('/payments/query/quote', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const parsed = queryCheckoutSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const quote = await tx(async (client) => {
    const product = await client.query('SELECT id,name,description,price_cents,is_free FROM query_products WHERE id=$1 AND active=true', [parsed.data.productId]);
    if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const productRow = product.rows[0] as Record<string, unknown>;
    const pricing = await effectiveQueryPrice(client, req.user!.id, String(productRow.id), Number(productRow.price_cents ?? 0), Boolean(productRow.is_free));
    if (pricing.priceCents <= 0) throw appError('QUERY_NOT_CHARGEABLE', { code: 'QUERY_NOT_CHARGEABLE', http: 400, expose: true });
    let discountCents = 0;
    let couponCode: string | null = null;
    if (parsed.data.couponCode) {
      const coupon = await client.query(`SELECT id,code,discount_type,discount_value,max_redemptions,redeemed_count,active,starts_at,expires_at
        FROM coupons WHERE upper(code)=upper($1) FOR SHARE`, [parsed.data.couponCode]);
      if (!coupon.rowCount) throw appError('COUPON_INVALID', { code: 'COUPON_INVALID', http: 400, expose: true });
      const couponRow = coupon.rows[0] as Record<string, unknown>;
      const reservations = await client.query(`SELECT count(*)::int AS reserved_count FROM coupon_redemptions WHERE coupon_id=$1 AND status='RESERVED'`, [couponRow.id]);
      if (!couponWindowIsOpen({ active: Boolean(couponRow.active), startsAt: couponRow.starts_at as string | Date | null, expiresAt: couponRow.expires_at as string | Date | null }) || !couponHasCapacity(couponRow.max_redemptions == null ? null : Number(couponRow.max_redemptions), Number(couponRow.redeemed_count), Number(reservations.rows[0]?.reserved_count ?? 0))) {
        throw appError('COUPON_UNAVAILABLE', { code: 'COUPON_UNAVAILABLE', http: 400, expose: true });
      }
      couponCode = String(couponRow.code);
      discountCents = queryAmountAfterCoupon(pricing.priceCents, String(couponRow.discount_type) as 'PERCENT' | 'FIXED', Number(couponRow.discount_value)).discountCents;
    }
    if (parsed.data.affiliateCode) {
      const affiliate = await client.query('SELECT id,user_id FROM affiliates WHERE upper(code)=upper($1) AND active=true', [parsed.data.affiliateCode]);
      if (!affiliate.rowCount || (affiliate.rows[0].user_id && String(affiliate.rows[0].user_id) === req.user!.id)) throw appError('AFFILIATE_INVALID', { code: 'AFFILIATE_INVALID', http: 400, expose: true });
    }
    const totals = { subtotalCents: pricing.priceCents, discountCents, amountCents: Math.max(0, pricing.priceCents - discountCents) };
    return { purchaseType: 'QUERY', productId: String(productRow.id), productName: String(productRow.name), plate: parsed.data.plate, basePriceCents: Number(productRow.price_cents ?? 0), negotiated: pricing.negotiated, couponCode, affiliateCode: parsed.data.affiliateCode ?? null, ...totals };
  });
  res.json({ ...quote, paymentProviderConfigured: getPaymentProvider().isConfigured(), usageCountChangesOnlyAfterPaid: true });
}));

api.post('/payments/query/checkout', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const parsed = queryCheckoutSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const paymentProvider = getPaymentProvider();
  if (!paymentProvider.isConfigured()) throw appError('PAYMENT_PROVIDER_NOT_CONFIGURED', { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', http: 503, expose: true });
  const draft = await tx(async (client) => {
    const product = await client.query('SELECT id,name,description,price_cents,is_free FROM query_products WHERE id=$1 AND active=true', [parsed.data.productId]);
    if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const productRow = product.rows[0] as Record<string, unknown>;
    const pricing = await effectiveQueryPrice(client, req.user!.id, String(productRow.id), Number(productRow.price_cents ?? 0), Boolean(productRow.is_free));
    if (pricing.priceCents <= 0) throw appError('QUERY_NOT_CHARGEABLE', { code: 'QUERY_NOT_CHARGEABLE', http: 400, expose: true });
    const profile = await client.query(`SELECT u.name,u.email,p.cpf_cnpj,p.phone FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.active=true`, [req.user!.id]);
    if (!profile.rowCount) throw appError('AUTH_REQUIRED', { code: 'AUTH_REQUIRED', http: 401, expose: true });
    let discountCents = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    if (parsed.data.couponCode) {
      const coupon = await client.query(`SELECT id,code,discount_type,discount_value,max_redemptions,redeemed_count,active,starts_at,expires_at
        FROM coupons WHERE upper(code)=upper($1) FOR UPDATE`, [parsed.data.couponCode]);
      if (!coupon.rowCount) throw appError('COUPON_INVALID', { code: 'COUPON_INVALID', http: 400, expose: true });
      const couponRow = coupon.rows[0] as Record<string, unknown>;
      const reservations = await client.query(`SELECT count(*)::int AS reserved_count FROM coupon_redemptions WHERE coupon_id=$1 AND status='RESERVED'`, [couponRow.id]);
      if (!couponWindowIsOpen({ active: Boolean(couponRow.active), startsAt: couponRow.starts_at as string | Date | null, expiresAt: couponRow.expires_at as string | Date | null }) || !couponHasCapacity(couponRow.max_redemptions == null ? null : Number(couponRow.max_redemptions), Number(couponRow.redeemed_count), Number(reservations.rows[0]?.reserved_count ?? 0))) {
        throw appError('COUPON_UNAVAILABLE', { code: 'COUPON_UNAVAILABLE', http: 400, expose: true });
      }
      couponId = String(couponRow.id);
      couponCode = String(couponRow.code);
      discountCents = calculateCouponDiscount(pricing.priceCents, String(couponRow.discount_type) as 'PERCENT' | 'FIXED', Number(couponRow.discount_value));
      if (discountCents >= pricing.priceCents) throw appError('COUPON_ZERO_TOTAL_UNSUPPORTED', { code: 'COUPON_ZERO_TOTAL_UNSUPPORTED', http: 400, expose: true });
    }
    let affiliateId: string | null = null;
    let affiliateCommissionBps = 0;
    if (parsed.data.affiliateCode) {
      const affiliate = await client.query('SELECT id,user_id,commission_bps FROM affiliates WHERE upper(code)=upper($1) AND active=true', [parsed.data.affiliateCode]);
      if (!affiliate.rowCount || (affiliate.rows[0].user_id && String(affiliate.rows[0].user_id) === req.user!.id)) throw appError('AFFILIATE_INVALID', { code: 'AFFILIATE_INVALID', http: 400, expose: true });
      affiliateId = String(affiliate.rows[0].id);
      affiliateCommissionBps = Number(affiliate.rows[0].commission_bps);
    } else {
      const affiliate = await client.query(`SELECT a.id,a.user_id,a.commission_bps FROM users u JOIN affiliates a ON a.id=u.affiliate_id AND a.active=true WHERE u.id=$1`, [req.user!.id]);
      if (affiliate.rowCount && (!affiliate.rows[0].user_id || String(affiliate.rows[0].user_id) !== req.user!.id)) { affiliateId = String(affiliate.rows[0].id); affiliateCommissionBps = Number(affiliate.rows[0].commission_bps); }
    }
    const amountCents = Math.max(1, pricing.priceCents - discountCents);
    const externalReference = `pnm_query_${crypto.randomUUID()}`;
    const order = await client.query(`INSERT INTO payment_orders(user_id,package_id,purchase_type,product_id,query_plate,status,subtotal_cents,amount_cents,credits,provider,external_reference,discount_cents,coupon_id,affiliate_id,affiliate_commission_bps)
      VALUES($1,NULL,'QUERY',$2,$3,'CREATED',$4,$5,0,$6,$7,$8,$9,$10,$11) RETURNING id`, [req.user!.id, productRow.id, parsed.data.plate, pricing.priceCents, amountCents, paymentProvider.name, externalReference, discountCents, couponId, affiliateId, affiliateCommissionBps]);
    if (couponId) await client.query(`INSERT INTO coupon_redemptions(coupon_id,payment_order_id,status) VALUES($1,$2,'RESERVED')`, [couponId, order.rows[0].id]);
    return { orderId: String(order.rows[0].id), externalReference, product: productRow, customer: profile.rows[0] as Record<string, unknown>, subtotalCents: pricing.priceCents, discountCents, amountCents, couponCode };
  });
  try {
    const checkout = await paymentProvider.createCheckout({
      orderId: draft.externalReference,
      itemName: String(draft.product.name),
      itemDescription: String(draft.product.description),
      amountCents: draft.amountCents,
      customer: { name: String(draft.customer.name), email: String(draft.customer.email), cpfCnpj: draft.customer.cpf_cnpj ? String(draft.customer.cpf_cnpj) : undefined, phone: draft.customer.phone ? String(draft.customer.phone) : undefined }
    });
    await pool.query(`UPDATE payment_orders SET status='CHECKOUT_ACTIVE',provider_checkout_id=$2,checkout_url=$3,updated_at=now() WHERE id=$1`, [draft.orderId, checkout.id, checkout.link]);
    await audit(req.user!.id, 'CREATE_QUERY_CHECKOUT', 'PAYMENT_ORDER', draft.orderId, { productId: parsed.data.productId, plate: parsed.data.plate, amountCents: draft.amountCents, requestId: requestId(req) });
    res.status(201).json({ orderId: draft.orderId, checkoutUrl: checkout.link, provider: paymentProvider.name, purchaseType: 'QUERY', productId: parsed.data.productId, plate: parsed.data.plate, subtotalCents: draft.subtotalCents, discountCents: draft.discountCents, amountCents: draft.amountCents, couponCode: draft.couponCode });
  } catch (error) {
    await pool.query(`UPDATE payment_orders SET status='FAILED',updated_at=now() WHERE id=$1`, [draft.orderId]);
    await pool.query(`UPDATE coupon_redemptions SET status='RELEASED',updated_at=now() WHERE payment_order_id=$1 AND status='RESERVED'`, [draft.orderId]);
    throw error;
  }
}));

api.get('/payments/query/:id', auth, requirePermission('BUY_CREDITS'), asyncRoute(async (req, res) => {
  const order = await pool.query(`SELECT o.id,o.status,o.purchase_type,o.product_id,o.query_plate,o.amount_cents,e.status AS entitlement_status
    FROM payment_orders o LEFT JOIN query_payment_entitlements e ON e.order_id=o.id
    WHERE o.id=$1 AND o.user_id=$2 AND o.purchase_type='QUERY'`, [req.params.id, req.user!.id]);
  if (!order.rowCount) throw appError('PAYMENT_ORDER_NOT_FOUND', { code: 'PAYMENT_ORDER_NOT_FOUND', http: 404, expose: true });
  const row = order.rows[0] as Record<string, unknown>;
  res.json({ orderId: String(row.id), status: String(row.status), purchaseType: 'QUERY', productId: String(row.product_id), plate: String(row.query_plate), amountCents: Number(row.amount_cents ?? 0), entitlementStatus: row.entitlement_status ? String(row.entitlement_status) : null });
}));

async function processPaymentWebhook(providerName: PaymentProviderName, req: Request, res: Response): Promise<void> {
  const provider = getPaymentProviderFor(providerName);
  if (!provider.isConfigured()) throw appError('PAYMENT_PROVIDER_NOT_CONFIGURED', { code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', http: 503, expose: false });
  const rawRequest = req as RawBodyRequest;
  if (!provider.isValidWebhookSignature({ headers: req.headers, rawBody: rawRequest.rawBody, query: req.query as Record<string, unknown> })) {
    throw appError('PAYMENT_WEBHOOK_UNAUTHORIZED', { code: 'PAYMENT_WEBHOOK_UNAUTHORIZED', http: 401, expose: false });
  }
  const parsed = provider.parseWebhookEvent(req.body, req.query as Record<string, unknown>);
  if (!parsed || (providerName === 'mercadopago' && !parsed.externalPaymentId)) {
    throw appError('PAYMENT_WEBHOOK_INVALID', { code: 'PAYMENT_WEBHOOK_INVALID', http: 400, expose: false });
  }

  let reference = parsed.externalReference;
  let rawStatus = parsed.rawStatus;
  let paymentType: string | null = null;
  let feeCents: number | null = null;
  let netCents: number | null = null;
  if (provider.fetchPaymentStatus && parsed.externalPaymentId) {
    const payment = await provider.fetchPaymentStatus(parsed.externalPaymentId);
    if (!payment) throw appError('PAYMENT_PROVIDER_REQUEST_FAILED', { code: 'PAYMENT_PROVIDER_REQUEST_FAILED', http: 502, expose: false });
    reference ??= payment.externalReference ?? null;
    rawStatus = payment.status;
    paymentType = payment.paymentType ?? null;
    feeCents = payment.feeCents ?? null;
    netCents = payment.netCents ?? null;
  }

  const event = req.body as Record<string, unknown>;
  const asaasEventId = typeof event.id === 'string' ? event.id : '';
  const eventType = providerName === 'mercadopago' ? `payment.${rawStatus ?? 'unknown'}` : rawStatus ?? '';
  const eventId = providerName === 'mercadopago'
    ? `payment:${parsed.externalPaymentId}:${rawStatus ?? 'unknown'}`
    : asaasEventId;
  if (!eventId || !eventType || (!reference && !parsed.externalPaymentId)) {
    throw appError('PAYMENT_WEBHOOK_INVALID', { code: 'PAYMENT_WEBHOOK_INVALID', http: 400, expose: false });
  }

  const settled = await tx((client) => settlePaymentEvent(client, {
    provider: providerName as 'asaas' | 'mercadopago',
    eventId,
    eventType,
    rawStatus: rawStatus ?? null,
    externalPaymentId: parsed.externalPaymentId,
    reference: reference ?? null,
    paymentType, feeCents, netCents
  }));
  const duplicate = settled.outcome === 'DUPLICATE';
  res.status(200).json({ received: true, duplicate });
}

api.post('/payments/asaas/webhook', asyncRoute(async (req, res) => {
  await processPaymentWebhook('asaas', req, res);
}));

api.post('/payments/mercadopago/webhook', asyncRoute(async (req, res) => {
  await processPaymentWebhook('mercadopago', req, res);
}));

api.get('/admin/overview', adminAuth, requirePermission('VIEW_DASHBOARD'), asyncRoute(async (_req, res) => {
  const summary = await pool.query(`SELECT
    (SELECT count(*) FROM users WHERE active=true AND deleted_at IS NULL) AS active_users,
    (SELECT count(*) FROM users WHERE active=true AND deleted_at IS NULL AND created_at >= now() - interval '30 days') AS new_users_30d,
    (SELECT count(*) FROM vehicle_queries WHERE created_at >= date_trunc('day', now())) AS queries_today,
    (SELECT count(*) FROM vehicle_queries WHERE status='SUCCESS') AS successful_queries,
    (SELECT count(*) FROM vehicle_queries WHERE status='FAILED') AS failed_queries,
    (SELECT count(*) FROM vehicle_queries WHERE status='REFUNDED') AS refunds,
    (SELECT coalesce(sum(abs(amount_cents)),0) FROM wallet_transactions WHERE kind='QUERY') AS queries_billed_cents,
    (SELECT coalesce(sum(p.amount_cents),0) FROM payments p JOIN payment_orders o ON o.id=p.order_id WHERE p.status='PAID' AND o.purchase_type='QUERY') AS query_revenue_cents,
    (SELECT count(*) FROM payments p JOIN payment_orders o ON o.id=p.order_id WHERE p.status='PAID' AND o.purchase_type='QUERY') AS query_sales,
    (SELECT coalesce(sum(amount_cents),0) FROM payments WHERE status='PAID') AS confirmed_revenue_cents,
    (SELECT count(*) FROM payments WHERE status='PAID') AS confirmed_sales,
    (SELECT coalesce(round(avg(amount_cents)),0) FROM payments WHERE status='PAID') AS average_ticket_cents,
    (SELECT coalesce(sum(amount_cents),0) FROM payment_orders WHERE status IN ('CREATED','CHECKOUT_ACTIVE')) AS open_checkout_cents,
    (SELECT coalesce(sum(amount_cents),0) FROM payment_orders WHERE status='REFUNDED') AS refunded_revenue_cents,
    (SELECT coalesce(sum(w.balance_cents),0) FROM wallets w JOIN users u ON u.id=w.user_id WHERE u.active=true AND u.deleted_at IS NULL) AS prepaid_balance_cents,
    (SELECT count(*) FROM funnel_events WHERE event_type='FREE_QUERY_STARTED') AS fipe_started,
    (SELECT count(*) FROM funnel_events WHERE event_type='FREE_QUERY_COMPLETED') AS fipe_completed,
    (SELECT count(*) FROM funnel_events WHERE event_type='FREE_QUERY_SAVED') AS fipe_saved,
    (SELECT count(*) FROM funnel_events WHERE event_type='FREE_REPORT_DOWNLOADED') AS fipe_pdf_downloads,
    (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type IN ('HOME_PAGE_VIEW','SEO_PAGE_VIEW','FIPE_PAGE_VIEW') AND created_at >= now() - interval '30 days') AS funnel_visitors_30d,
    (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type='SEO_PAGE_VIEW' AND created_at >= now() - interval '30 days') AS seo_visitors_30d,
    (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type='CTA_CLICKED' AND created_at >= now() - interval '30 days') AS cta_visitors_30d,
    (SELECT count(*) FROM funnel_events WHERE event_type='CHECKOUT_STARTED' AND created_at >= now() - interval '30 days') AS checkout_starts_30d,
    (SELECT coalesce(round(100.0 * (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type='ACCOUNT_CREATED' AND created_at >= now() - interval '30 days') / nullif((SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type IN ('HOME_PAGE_VIEW','SEO_PAGE_VIEW','FIPE_PAGE_VIEW') AND created_at >= now() - interval '30 days'),0),2),0)) AS visitor_registration_rate_pct,
    (SELECT count(*) FROM provider_health_events WHERE source_type='FIPE' AND status='FAILED' AND created_at >= now() - interval '24 hours') AS fipe_provider_failures_24h,
    (SELECT max(created_at) FROM provider_health_events WHERE source_type='FIPE' AND status='SUCCESS') AS fipe_provider_last_success,
    (SELECT coalesce(round(100.0 * (SELECT count(*) FROM funnel_events WHERE event_type='FREE_QUERY_SAVED') / nullif((SELECT count(*) FROM funnel_events WHERE event_type='FREE_QUERY_COMPLETED'),0),2),0)) AS fipe_save_rate_pct`);
  const daily = await pool.query(`WITH days AS (
    SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS day
  ), q AS (
    SELECT created_at::date AS day, count(*)::int AS queries, count(*) FILTER (WHERE status='SUCCESS')::int AS successful_queries
    FROM vehicle_queries WHERE created_at >= current_date - interval '29 days' GROUP BY created_at::date
  ), p AS (
    SELECT paid_at::date AS day, count(*)::int AS sales, coalesce(sum(amount_cents),0)::int AS revenue_cents
    FROM payments WHERE status='PAID' AND paid_at >= current_date - interval '29 days' GROUP BY paid_at::date
  ), u AS (
    SELECT created_at::date AS day, count(*)::int AS users FROM users WHERE created_at >= current_date - interval '29 days' GROUP BY created_at::date
  )
  SELECT to_char(days.day,'YYYY-MM-DD') AS date, coalesce(q.queries,0) AS queries, coalesce(q.successful_queries,0) AS successful_queries,
    coalesce(p.sales,0) AS sales, coalesce(p.revenue_cents,0) AS revenue_cents, coalesce(u.users,0) AS users
  FROM days LEFT JOIN q USING(day) LEFT JOIN p USING(day) LEFT JOIN u USING(day) ORDER BY days.day`);
  res.json({ ...summary.rows[0], daily: daily.rows });
}));

/** Funil completo dos últimos 30 dias: visita -> busca de placa -> cadastro -> checkout -> pagamento -> relatório entregue e aberto -> retorno. */
api.get('/admin/funnel', adminAuth, requirePermission('VIEW_DASHBOARD'), asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT
    (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type IN ('HOME_PAGE_VIEW','SEO_PAGE_VIEW','FIPE_PAGE_VIEW') AND created_at >= now() - interval '30 days')::int AS visitors,
    (SELECT count(DISTINCT session_key) FROM funnel_events WHERE event_type='PLATE_CAPTURED' AND created_at >= now() - interval '30 days')::int AS plate_searches,
    (SELECT count(*) FROM users WHERE created_at >= now() - interval '30 days' AND deleted_at IS NULL)::int AS signups,
    (SELECT count(*) FROM funnel_events WHERE event_type='CHECKOUT_STARTED' AND created_at >= now() - interval '30 days')::int AS checkouts_started,
    (SELECT count(*) FROM payments WHERE status='PAID' AND paid_at >= now() - interval '30 days')::int AS payments_paid,
    (SELECT count(*) FROM vehicle_queries WHERE status='SUCCESS' AND created_at >= now() - interval '30 days')::int AS reports_delivered,
    (SELECT count(DISTINCT metadata->>'queryId') FROM funnel_events WHERE event_type='REPORT_OPENED' AND created_at >= now() - interval '30 days')::int AS reports_opened,
    (SELECT count(*) FROM vehicle_queries WHERE status IN ('FAILED','REFUNDED') AND created_at >= now() - interval '30 days')::int AS failed_or_refunded,
    (SELECT count(*) FROM payment_orders WHERE status='REFUNDED' AND updated_at >= now() - interval '30 days')::int AS refunded_orders,
    (SELECT count(*) FROM funnel_events WHERE event_type='REPORT_DISPUTED' AND created_at >= now() - interval '30 days')::int AS disputes,
    (SELECT count(*) FROM (SELECT user_id FROM payments WHERE status='PAID' GROUP BY user_id HAVING count(*) >= 2) t)::int AS repeat_buyers,
    (SELECT count(DISTINCT user_id) FROM payments WHERE status='PAID')::int AS buyers`);
  res.json(r.rows[0]);
}));

api.get('/admin/overview/series', adminAuth, requirePermission('VIEW_DASHBOARD'), asyncRoute(async (_req, res) => {
  const daily = await pool.query(`WITH days AS (
    SELECT generate_series(current_date - interval '29 days', current_date, interval '1 day')::date AS day
  ), q AS (
    SELECT created_at::date AS day, count(*)::int AS queries, count(*) FILTER (WHERE status='SUCCESS')::int AS successful_queries
    FROM vehicle_queries WHERE created_at >= current_date - interval '29 days' GROUP BY created_at::date
  ), p AS (
    SELECT paid_at::date AS day, count(*)::int AS sales, coalesce(sum(amount_cents),0)::int AS revenue_cents
    FROM payments WHERE status='PAID' AND paid_at >= current_date - interval '29 days' GROUP BY paid_at::date
  ), u AS (
    SELECT created_at::date AS day, count(*)::int AS users FROM users WHERE created_at >= current_date - interval '29 days' GROUP BY created_at::date
  )
  SELECT to_char(days.day,'YYYY-MM-DD') AS date, coalesce(q.queries,0) AS queries, coalesce(q.successful_queries,0) AS successful_queries,
    coalesce(p.sales,0) AS sales, coalesce(p.revenue_cents,0) AS revenue_cents, coalesce(u.users,0) AS users
  FROM days LEFT JOIN q USING(day) LEFT JOIN p USING(day) LEFT JOIN u USING(day) ORDER BY days.day`);
  res.json({ daily: daily.rows });
}));

api.get('/admin/settings', adminAuth, requirePermission('VIEW_AUDIT'), asyncRoute(async (_req, res) => {
  const value = await safeBusinessSettings();
  res.json({
    environment: {
      appName: env.APP_NAME,
      appUrl: env.APP_URL,
      webOrigin: env.WEB_ORIGIN,
      nodeEnv: env.NODE_ENV,
      paymentProvider: env.PAYMENT_PROVIDER,
      dataProvider: env.DATA_PROVIDER,
      featureFreeFipe: env.FEATURE_FREE_FIPE,
      featureReportPdf: env.FEATURE_REPORT_PDF,
      queryCacheEnabled: env.QUERY_CACHE_ENABLED,
      queryCacheTtlSeconds: env.QUERY_CACHE_TTL_SECONDS,
      queryRequestTimeoutMs: env.QUERY_REQUEST_TIMEOUT_MS,
      rateLimitEnabled: env.RATE_LIMIT_ENABLED,
      auditLogEnabled: env.AUDIT_LOG_ENABLED,
      logLevel: env.LOG_LEVEL
    },
    configured: {
      payment: Boolean(env.PAYMENT_API_KEY),
      vehicleProvider: Boolean(env.VEHICLE_API_BASE_URL),
      email: isEmailConfigured(),
      fipe: Boolean(env.FIPE_PRIMARY_BASE_URL)
    },
    safe: {
      siteTagline: typeof value.siteTagline === 'string' ? value.siteTagline : 'Consulta zero para orientar o valor. Consulta completa para aprofundar a decisão.',
      supportEmail: typeof value.supportEmail === 'string' ? value.supportEmail : null,
      maintenanceNotice: typeof value.maintenanceNotice === 'string' ? value.maintenanceNotice : null,
      defaultAffiliateRateBps: typeof value.defaultAffiliateRateBps === 'number' ? value.defaultAffiliateRateBps : 1000,
      fipeGuestDailyLimit: typeof value.fipeGuestDailyLimit === 'number' ? value.fipeGuestDailyLimit : env.FIPE_GUEST_DAILY_LIMIT
    }
  });
}));

api.patch('/admin/settings', adminAuth, requirePermission('MANAGE_PROVIDERS'), asyncRoute(async (req, res) => {
  const parsed = safeSettingsSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const current = await safeBusinessSettings();
  const next = { ...current, ...parsed.data };
  await pool.query(`INSERT INTO platform_settings(key,value,updated_by,updated_at) VALUES('safe_business',$1::jsonb,$2,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`, [JSON.stringify(next), req.user!.id]);
  await audit(req.user!.id, 'UPDATE_SAFE_SETTINGS', 'PLATFORM_SETTINGS', 'safe_business', { keys: Object.keys(parsed.data), requestId: requestId(req) });
  res.json({ safe: next });
}));

api.get('/admin/coupons', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT id,code,discount_type,discount_value,max_redemptions,redeemed_count,starts_at,expires_at,active,created_at
    FROM coupons ORDER BY created_at DESC`);
  res.json(result.rows.map((row) => ({ id: row.id, code: row.code, discountType: row.discount_type, discountValue: Number(row.discount_value), maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions), redeemedCount: Number(row.redeemed_count), startsAt: row.starts_at, expiresAt: row.expires_at, active: row.active, createdAt: row.created_at })));
}));

api.post('/admin/coupons', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = couponCreateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const code = parsed.data.code.toUpperCase();
  const result = await pool.query(`INSERT INTO coupons(code,discount_type,discount_value,max_redemptions,starts_at,expires_at,active,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,code,discount_type,discount_value,max_redemptions,redeemed_count,starts_at,expires_at,active,created_at`, [code, parsed.data.discountType, parsed.data.discountValue, parsed.data.maxRedemptions ?? null, parsed.data.startsAt ?? null, parsed.data.expiresAt ?? null, parsed.data.active, req.user!.id]);
  await audit(req.user!.id, 'CREATE_COUPON', 'COUPON', result.rows[0].id, { code, requestId: requestId(req) });
  res.status(201).json(result.rows[0]);
}));

api.patch('/admin/coupons/:id', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = couponUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const fields = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  if (!fields.length) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const values: unknown[] = []; const assignments: string[] = [];
  for (const [key, value] of fields) {
    const column = key === 'discountType' ? 'discount_type' : key === 'discountValue' ? 'discount_value' : key === 'maxRedemptions' ? 'max_redemptions' : key === 'startsAt' ? 'starts_at' : key === 'expiresAt' ? 'expires_at' : key;
    values.push(key === 'code' ? String(value).toUpperCase() : value ?? null); assignments.push(`${column}=$${values.length}`);
  }
  values.push(req.params.id);
  const result = await pool.query(`UPDATE coupons SET ${assignments.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING id,code,discount_type,discount_value,max_redemptions,redeemed_count,starts_at,expires_at,active,created_at`, values);
  if (!result.rowCount) throw appError('COUPON_NOT_FOUND', { code: 'COUPON_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'UPDATE_COUPON', 'COUPON', String(req.params.id), { requestId: requestId(req) });
  res.json(result.rows[0]);
}));

api.delete('/admin/coupons/:id', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const result = await pool.query(`UPDATE coupons SET active=false,updated_at=now() WHERE id=$1 RETURNING id`, [req.params.id]);
  if (!result.rowCount) throw appError('COUPON_NOT_FOUND', { code: 'COUPON_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'DELETE_COUPON', 'COUPON', String(req.params.id), { requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/admin/organizations', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT id,name,document,active,slug,primary_color,accent_color,logo_url,custom_domain,settings,created_at
    FROM organizations ORDER BY created_at DESC`);
  res.json(result.rows.map((row) => ({ id: row.id, name: row.name, document: row.document, active: row.active, slug: row.slug, primaryColor: row.primary_color, accentColor: row.accent_color, logoUrl: row.logo_url, customDomain: row.custom_domain, settings: row.settings ?? {}, createdAt: row.created_at })));
}));

api.post('/admin/organizations', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  const parsed = organizationBrandingSchema.extend({ name: z.string().min(2), document: z.string().max(30).optional(), active: z.boolean().default(true) }).safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await pool.query(`INSERT INTO organizations(name,document,active,slug,primary_color,accent_color,logo_url,custom_domain,settings)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id,name,document,active,slug,primary_color,accent_color,logo_url,custom_domain,settings,created_at`, [parsed.data.name, parsed.data.document ?? null, parsed.data.active, parsed.data.slug ?? null, parsed.data.primaryColor ?? null, parsed.data.accentColor ?? null, parsed.data.logoUrl ?? null, parsed.data.customDomain ?? null, JSON.stringify(parsed.data.settings ?? {})]);
  await audit(req.user!.id, 'CREATE_ORGANIZATION', 'ORGANIZATION', result.rows[0].id, { requestId: requestId(req) });
  res.status(201).json(result.rows[0]);
}));

api.patch('/admin/organizations/:id', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  const parsed = organizationBrandingSchema.partial().safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const fields = Object.entries(parsed.data).filter(([, value]) => value !== undefined);
  if (!fields.length) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const values: unknown[] = []; const assignments: string[] = [];
  for (const [key, value] of fields) {
    const column = key === 'primaryColor' ? 'primary_color' : key === 'accentColor' ? 'accent_color' : key === 'logoUrl' ? 'logo_url' : key === 'customDomain' ? 'custom_domain' : key;
    values.push(key === 'settings' ? JSON.stringify(value ?? {}) : value ?? null); assignments.push(`${column}=${key === 'settings' ? `$${values.length}::jsonb` : `$${values.length}`}`);
  }
  values.push(req.params.id);
  const result = await pool.query(`UPDATE organizations SET ${assignments.join(',')} WHERE id=$${values.length} RETURNING id,name,document,active,slug,primary_color,accent_color,logo_url,custom_domain,settings,created_at`, values);
  if (!result.rowCount) throw appError('ORGANIZATION_NOT_FOUND', { code: 'ORGANIZATION_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'UPDATE_ORGANIZATION_BRANDING', 'ORGANIZATION', String(req.params.id), { requestId: requestId(req) });
  res.json(result.rows[0]);
}));

api.get('/affiliate/me', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT id,name,email,code,commission_bps,active,created_at FROM affiliates WHERE user_id=$1`, [req.user!.id]);
  if (!result.rowCount) { res.json({ affiliate: null }); return; }
  const row = result.rows[0];
  res.json({ affiliate: { id: row.id, name: row.name, email: row.email, code: row.code, commissionBps: Number(row.commission_bps), active: row.active, createdAt: row.created_at } });
}));

api.post('/affiliate/activate', auth, asyncRoute(async (req, res) => {
  const parsed = affiliateActivationSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const existing = await pool.query('SELECT id,name,email,code,commission_bps,active,created_at FROM affiliates WHERE user_id=$1', [req.user!.id]);
  if (existing.rowCount) { res.json({ affiliate: existing.rows[0] }); return; }
  const account = await pool.query('SELECT name,email FROM users WHERE id=$1 AND active=true', [req.user!.id]);
  if (!account.rowCount) throw appError('ACCOUNT_NOT_FOUND', { code: 'ACCOUNT_NOT_FOUND', http: 404, expose: true });
  const safeBusiness = await safeBusinessSettings();
  const configuredRate = safeBusiness.defaultAffiliateRateBps;
  const commissionBps = typeof configuredRate === 'number' && Number.isInteger(configuredRate) && configuredRate >= 0 && configuredRate <= 5000 ? configuredRate : 1000;
  const defaultCode = `PNM-${randomBytes(5).toString('hex').toUpperCase()}`;
  const code = (parsed.data.code ?? defaultCode).toUpperCase();
  const result = await pool.query(`INSERT INTO affiliates(user_id,name,email,code,commission_bps,active) VALUES($1,$2,$3,$4,$5,true)
    RETURNING id,name,email,code,commission_bps,active,created_at`, [req.user!.id, account.rows[0].name, account.rows[0].email, code, commissionBps]);
  await audit(req.user!.id, 'ACTIVATE_AFFILIATE', 'AFFILIATE', result.rows[0].id, { requestId: requestId(req) });
  res.status(201).json({ affiliate: result.rows[0] });
}));

api.get('/affiliate/link', auth, asyncRoute(async (req, res) => {
  const result = await pool.query('SELECT code,active FROM affiliates WHERE user_id=$1', [req.user!.id]);
  if (!result.rowCount || !result.rows[0].active) throw appError('AFFILIATE_NOT_ACTIVE', { code: 'AFFILIATE_NOT_ACTIVE', http: 404, expose: true });
  const link = new URL('/?ref=' + encodeURIComponent(String(result.rows[0].code)), publicAppUrl()).toString();
  res.json({ code: result.rows[0].code, link });
}));

api.get('/affiliate/stats', auth, asyncRoute(async (req, res) => {
  const affiliate = await pool.query('SELECT id,code FROM affiliates WHERE user_id=$1', [req.user!.id]);
  if (!affiliate.rowCount) { res.json({ affiliate: null, totals: { pendingCents: 0, paidCents: 0, commissions: 0 } }); return; }
  const totals = await pool.query(`SELECT count(*)::int AS commissions,
      coalesce(sum(amount_cents) FILTER (WHERE status='PENDING'),0)::int AS pending_cents,
      coalesce(sum(amount_cents) FILTER (WHERE status='PAID'),0)::int AS paid_cents,
      (SELECT count(*)::int FROM users WHERE affiliate_id=$1) AS referred_users
    FROM affiliate_commissions WHERE affiliate_id=$1`, [affiliate.rows[0].id]);
  const code = String(affiliate.rows[0].code);
  const shareUrl = new URL('/?ref=' + encodeURIComponent(code), publicAppUrl()).toString();
  const perf = await pool.query(`SELECT
      (SELECT count(DISTINCT session_key) FROM funnel_events WHERE upper(metadata->>'ref')=$2 AND created_at >= now() - interval '30 days')::int AS clicks_30d,
      (SELECT count(*) FROM payments p JOIN users u ON u.id=p.user_id WHERE u.affiliate_id=$1 AND p.status='PAID')::int AS paid_payments,
      (SELECT count(*) FROM affiliate_commissions WHERE affiliate_id=$1 AND status IN ('CANCELLED','REVERSED'))::int AS reversed`, [affiliate.rows[0].id, code.toUpperCase()]);
  const to = (path: string) => new URL(`${path}${path.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}`, publicAppUrl()).toString();
  const links = [
    { key: 'home', label: 'Página inicial', url: to('/') },
    { key: 'consulta', label: 'Consultar placa', url: to('/consultar') },
    { key: 'fipe', label: 'FIPE grátis', url: to('/fipe') },
    { key: 'simulador', label: 'Simulador de financiamento', url: to('/simulador') },
    { key: 'comparar', label: 'Comparar veículos', url: to('/comparar') },
    { key: 'guia', label: 'Guia de veículos', url: to('/veiculos') }
  ];
  res.json({ affiliate: { id: affiliate.rows[0].id, code }, shareUrl, links, performance: { clicks30d: Number(perf.rows[0].clicks_30d), paidPayments: Number(perf.rows[0].paid_payments), reversedCommissions: Number(perf.rows[0].reversed) }, totals: { commissions: Number(totals.rows[0].commissions), pendingCents: Number(totals.rows[0].pending_cents), paidCents: Number(totals.rows[0].paid_cents), referredUsers: Number(totals.rows[0].referred_users) } });
}));

api.get('/admin/organizations/:id/members', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT m.organization_id,m.user_id,m.role,u.name,u.email,u.active
    FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY u.name`, [req.params.id]);
  res.json(result.rows.map((row) => ({ organizationId: row.organization_id, userId: row.user_id, role: row.role, name: row.name, email: row.email, active: row.active })));
}));

api.post('/admin/organizations/:id/members', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  const parsed = organizationMemberSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await pool.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3)
    ON CONFLICT(organization_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING organization_id,user_id,role`, [req.params.id, parsed.data.userId, parsed.data.role]);
  await audit(req.user!.id, 'UPSERT_ORGANIZATION_MEMBER', 'ORGANIZATION', String(req.params.id), { memberId: parsed.data.userId, role: parsed.data.role, requestId: requestId(req) });
  res.status(201).json(result.rows[0]);
}));

api.delete('/admin/organizations/:id/members/:userId', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
  await audit(req.user!.id, 'REMOVE_ORGANIZATION_MEMBER', 'ORGANIZATION', String(req.params.id), { memberId: req.params.userId, requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/organization/context', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(`SELECT o.id,o.name,o.slug,o.primary_color,o.accent_color,o.logo_url,o.custom_domain,o.settings,m.role
    FROM organization_members m JOIN organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND o.active=true ORDER BY o.created_at LIMIT 1`, [req.user!.id]);
  if (!result.rowCount) { res.json({ organization: null }); return; }
  const row = result.rows[0];
  res.json({ organization: { id: row.id, name: row.name, slug: row.slug, primaryColor: row.primary_color, accentColor: row.accent_color, logoUrl: row.logo_url, customDomain: row.custom_domain, settings: row.settings ?? {}, role: row.role } });
}));

api.get('/admin/queries', adminAuth, requirePermission('VIEW_QUERIES'), asyncRoute(async (req, res) => {
  const filters = z.object({
    status: z.enum(['PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED']).optional(),
    customerType: z.enum(['PARTICULAR', 'AUTONOMO', 'EMPRESA']).optional(),
    productId: z.string().trim().max(40).optional(),
    customerId: z.string().uuid().optional(),
    search: z.string().trim().max(80).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).safeParse(req.query);
  if (!filters.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const f = filters.data; const where: string[] = []; const values: unknown[] = [];
  const push = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (f.status) where.push(`q.status=${push(f.status)}`);
  if (f.customerType) where.push(`coalesce(up.customer_type,'PARTICULAR')=${push(f.customerType)}`);
  if (f.productId) where.push(`q.product_id=${push(f.productId)}`);
  if (f.customerId) where.push(`q.user_id=${push(f.customerId)}`);
  if (f.search) { const l = push(`%${f.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`(q.plate ILIKE ${l} OR u.name ILIKE ${l} OR u.email ILIKE ${l})`); }
  if (f.from) where.push(`q.created_at >= ${push(f.from)}::date`);
  if (f.to) where.push(`q.created_at < ${push(f.to)}::date + 1`);
  const queries = await pool.query(`SELECT q.id,q.plate,q.status,q.price_cents,q.charge_source,q.provider,q.created_at,q.completed_at,q.error_code,
      p.name AS product_name,u.id AS customer_id,u.name AS customer_name,u.email AS customer_email,coalesce(up.customer_type,'PARTICULAR') AS customer_type
    FROM vehicle_queries q
    JOIN users u ON u.id=q.user_id
    LEFT JOIN user_profiles up ON up.user_id=q.user_id
    JOIN query_products p ON p.id=q.product_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY q.created_at DESC LIMIT 300`, values);
  res.json(queries.rows.map((row) => ({
    id: row.id,
    plate: row.plate,
    status: row.status,
    priceCents: Number(row.price_cents ?? 0),
    chargeSource: row.charge_source,
    provider: row.provider,
    productName: row.product_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    customerType: row.customer_type,
    customer: { id: row.customer_id, name: row.customer_name, email: row.customer_email }
  })));
}));

api.post('/admin/lookups', adminAuth, requirePermission('VIEW_SENSITIVE_DATA'), asyncRoute(async (req, res) => {
  const parsed = z.object({ plate: plateSchema, productId: z.string().trim().min(1).max(80) }).safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const product = await pool.query('SELECT id,name FROM query_products WHERE id=$1 AND active=true', [parsed.data.productId]);
  if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
  const provider = getProvider();
  try {
    const output = await performAdminLookup({ provider, plate: parsed.data.plate, productId: parsed.data.productId, productName: product.rows[0].name, timeoutMs: env.QUERY_REQUEST_TIMEOUT_MS, normalize: normalizeBdrp });
    await audit(req.user!.id, 'ADMIN_LOOKUP', 'VEHICLE_QUERY', null, { plate: parsed.data.plate, productId: parsed.data.productId, provider: provider.name, status: 'SUCCESS', requestId: requestId(req) });
    res.status(200).json({ ...output, result: { ...output.result, diagnostic: diagnostic(output.result) } });
  } catch (error) {
    const errorCode = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'PROVIDER_ERROR';
    await audit(req.user!.id, 'ADMIN_LOOKUP', 'VEHICLE_QUERY', null, { plate: parsed.data.plate, productId: parsed.data.productId, provider: provider.name, status: 'FAILED', errorCode, requestId: requestId(req) });
    throw error;
  }
}));

const ADMIN_PRODUCT_COLS = 'p.archived_at,p.id,p.name,p.description,p.price_cents,p.reference_price_cents,p.active,p.slug,p.features,p.is_free,p.commercial_status,p.featured,p.display_order,p.source,p.coverage,p.tagline,p.long_description,p.badge,p.list_price_cents,p.show_on_home,p.report_sections';
const SELLABLE_REPORT_SECTIONS = new Set(['IDENTIFICACAO', 'CARACTERISTICAS', 'REGISTRO', 'DEBITOS', 'RESTRICOES', 'GRAVAME', 'INSPECAO_RECALL']);
function presentAdminProduct(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, description: row.description, priceCents: Number(row.price_cents ?? 0), referencePriceCents: row.reference_price_cents == null ? null : Number(row.reference_price_cents),
    active: Boolean(row.active), slug: row.slug, features: row.features ?? [], isFree: Boolean(row.is_free), commercialStatus: row.commercial_status, featured: Boolean(row.featured),
    displayOrder: Number(row.display_order ?? 100), source: row.source, coverage: row.coverage, tagline: row.tagline ?? '', longDescription: row.long_description ?? '', badge: row.badge ?? null,
    listPriceCents: row.list_price_cents == null ? null : Number(row.list_price_cents), showOnHome: Boolean(row.show_on_home), reportSections: Array.isArray(row.report_sections) ? row.report_sections : null, archivedAt: row.archived_at ?? null
  };
}
function checkReportSections(sections: string[] | null | undefined): void {
  if (sections && !sections.every((k) => SELLABLE_REPORT_SECTIONS.has(k))) throw appError('INVALID_REPORT_SECTIONS', { code: 'INVALID_REPORT_SECTIONS', http: 400, expose: true });
}

api.get('/admin/products', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (_req, res) => {
  const products = await pool.query(`SELECT ${ADMIN_PRODUCT_COLS},
      t.id AS template_id,t.version AS template_version,t.name AS template_name,t.status AS template_status
    FROM query_products p LEFT JOIN product_report_configs c ON c.product_id=p.id LEFT JOIN report_templates t ON t.id=c.template_id ORDER BY p.display_order,p.price_cents`);
  res.json(products.rows.map((product) => ({ ...presentAdminProduct(product), reportTemplate: product.template_id ? { id: product.template_id, version: Number(product.template_version), name: product.template_name, status: product.template_status } : null })));
}));

api.post('/admin/products', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = productCreateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const value = parsed.data;
  const defaultTemplate = defaultReportTemplate(value.id, value.name);
  const templateConfig = value.reportConfig ?? { title: defaultTemplate.title, subtitle: defaultTemplate.subtitle, sections: defaultTemplate.sections };
  const templateName = value.reportConfig ? `${value.name} — template inicial` : defaultTemplate.name;
  const created = await tx(async (client) => {
    const priceCents = value.isFree ? 0 : value.priceCents;
    const legacyCreditCost = Math.ceil(priceCents / 100);
    const guard = await enforceMarginFloor(client, { name: value.name, providerCostCents: value.providerCostCents, supplierCostCents: value.supplierCostCents, priceCents, isFree: value.isFree }, req.user!.role, value.overrideMarginLock);
    if (guard.overridden) await audit(req.user!.id, 'MARGIN_LOCK_OVERRIDE', 'QUERY_PRODUCT', value.id, { requestId: requestId(req), floorCents: guard.floorCents, priceCents, reason: value.overrideMarginLock?.reason });
    checkReportSections(value.reportSections);
    const product = await client.query(`INSERT INTO query_products(id,name,description,credit_cost,price_cents,reference_price_cents,active,slug,features,display_order,source,coverage,commercial_status,featured,is_free,provider_cost_cents,supplier_cost_cents,floor_price_cents,tagline,long_description,badge,list_price_cents,show_on_home,report_sections)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::text[]) RETURNING id,name,description,price_cents,reference_price_cents,active,slug,features,display_order,source,coverage,commercial_status,featured,is_free,tagline,long_description,badge,list_price_cents,show_on_home,report_sections`, [value.id, value.name, value.description, legacyCreditCost, priceCents, value.referencePriceCents ?? null, value.active, value.slug, JSON.stringify(value.features), value.displayOrder, value.source ?? null, value.coverage ?? null, value.commercialStatus, value.featured, value.isFree, value.providerCostCents, value.supplierCostCents, guard.floorCents || null, value.tagline, value.longDescription, value.badge ?? null, value.listPriceCents ?? null, value.showOnHome, value.reportSections ?? null]);
    const insertedTemplate = await client.query(`INSERT INTO report_templates(product_id,version,name,status,config,created_by) VALUES($1,1,$2,'PUBLISHED',$3::jsonb,$4) RETURNING id,version,name,status`, [value.id, templateName, JSON.stringify(templateConfig), req.user!.id]);
    await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats,updated_by) VALUES($1,$2,'SNAPSHOT',ARRAY['JSON','HTML','PDF'],$3)`, [value.id, insertedTemplate.rows[0].id, req.user!.id]);
    return { product: product.rows[0], template: insertedTemplate.rows[0] };
  });
  await audit(req.user!.id, 'CREATE_QUERY_PRODUCT', 'QUERY_PRODUCT', value.id, { requestId: requestId(req) });
  res.status(201).json({ ...presentAdminProduct(created.product as Record<string, unknown>), reportTemplate: created.template });
}));

api.patch('/admin/products/:id', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = productUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const values: unknown[] = [];
  const assignments: string[] = [];
  if (parsed.data.priceCents !== undefined || parsed.data.providerCostCents !== undefined || parsed.data.supplierCostCents !== undefined) {
    const current = await pool.query('SELECT name,price_cents,provider_cost_cents,supplier_cost_cents,is_free FROM query_products WHERE id=$1', [req.params.id]);
    if (!current.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const row = current.rows[0] as Record<string, unknown>;
    const nextCost = parsed.data.providerCostCents ?? Number(row.provider_cost_cents ?? 0);
    const nextSupplier = parsed.data.supplierCostCents ?? Number(row.supplier_cost_cents ?? 0);
    const nextPrice = parsed.data.isFree ? 0 : parsed.data.priceCents ?? Number(row.price_cents ?? 0);
    const guard = await enforceMarginFloor(pool, { name: String(row.name), providerCostCents: nextCost, supplierCostCents: nextSupplier, priceCents: nextPrice, isFree: parsed.data.isFree ?? Boolean(row.is_free) }, req.user!.role, parsed.data.overrideMarginLock);
    if (guard.overridden) await audit(req.user!.id, 'MARGIN_LOCK_OVERRIDE', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req), floorCents: guard.floorCents, priceCents: nextPrice, reason: parsed.data.overrideMarginLock?.reason });
    if (parsed.data.providerCostCents !== undefined) { values.push(parsed.data.providerCostCents); assignments.push(`provider_cost_cents=$${values.length}`); }
    if (parsed.data.supplierCostCents !== undefined) { values.push(parsed.data.supplierCostCents); assignments.push(`supplier_cost_cents=$${values.length}`); }
    values.push(guard.floorCents || null); assignments.push(`floor_price_cents=$${values.length}`);
  }
  if (parsed.data.name !== undefined) { values.push(parsed.data.name); assignments.push(`name=$${values.length}`); }
  if (parsed.data.description !== undefined) { values.push(parsed.data.description); assignments.push(`description=$${values.length}`); }
  if (parsed.data.referencePriceCents !== undefined) { values.push(parsed.data.referencePriceCents); assignments.push(`reference_price_cents=$${values.length}`); }
  if (parsed.data.priceCents !== undefined) { values.push(parsed.data.isFree ? 0 : parsed.data.priceCents); assignments.push(`price_cents=$${values.length}`); }
  if (parsed.data.slug !== undefined) { values.push(parsed.data.slug); assignments.push(`slug=$${values.length}`); }
  if (parsed.data.features !== undefined) { values.push(JSON.stringify(parsed.data.features)); assignments.push(`features=$${values.length}::jsonb`); }
  if (parsed.data.source !== undefined) { values.push(parsed.data.source); assignments.push(`source=$${values.length}`); }
  if (parsed.data.coverage !== undefined) { values.push(parsed.data.coverage); assignments.push(`coverage=$${values.length}`); }
  if (parsed.data.commercialStatus !== undefined) { values.push(parsed.data.commercialStatus); assignments.push(`commercial_status=$${values.length}`); }
  if (parsed.data.featured !== undefined) { values.push(parsed.data.featured); assignments.push(`featured=$${values.length}`); }
  if (parsed.data.displayOrder !== undefined) { values.push(parsed.data.displayOrder); assignments.push(`display_order=$${values.length}`); }
  if (parsed.data.tagline !== undefined) { values.push(parsed.data.tagline); assignments.push(`tagline=$${values.length}`); }
  if (parsed.data.longDescription !== undefined) { values.push(parsed.data.longDescription); assignments.push(`long_description=$${values.length}`); }
  if (parsed.data.badge !== undefined) { values.push(parsed.data.badge || null); assignments.push(`badge=$${values.length}`); }
  if (parsed.data.listPriceCents !== undefined) { values.push(parsed.data.listPriceCents); assignments.push(`list_price_cents=$${values.length}`); }
  if (parsed.data.showOnHome !== undefined) { values.push(parsed.data.showOnHome); assignments.push(`show_on_home=$${values.length}`); }
  if (parsed.data.reportSections !== undefined) { checkReportSections(parsed.data.reportSections); values.push(parsed.data.reportSections && parsed.data.reportSections.length ? parsed.data.reportSections : null); assignments.push(`report_sections=$${values.length}::text[]`); }
  if (parsed.data.isFree !== undefined) { values.push(parsed.data.isFree); assignments.push(`is_free=$${values.length}`); }
  if (parsed.data.active !== undefined) { values.push(parsed.data.active); assignments.push(`active=$${values.length}`); }
  assignments.push('updated_at=now()');
  values.push(req.params.id);
  const product = await pool.query(`UPDATE query_products SET ${assignments.join(', ')} WHERE id=$${values.length} RETURNING id,name,description,price_cents,reference_price_cents,active,slug,features,display_order,source,coverage,commercial_status,featured,is_free,tagline,long_description,badge,list_price_cents,show_on_home,report_sections`, values);
  if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'UPDATE_QUERY_PRODUCT', 'QUERY_PRODUCT', String(req.params.id), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  if (parsed.data.reportSections !== undefined) await refreshProductSections();
  res.json(presentAdminProduct(product.rows[0]));
}));

api.get('/admin/products/:id/report-templates', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const templates = await pool.query(`SELECT id,product_id,version,name,status,config,created_by,created_at FROM report_templates WHERE product_id=$1 ORDER BY version DESC`, [req.params.id]);
  res.json(templates.rows.map((row) => ({ id: row.id, productId: row.product_id, version: Number(row.version), name: row.name, status: row.status, config: row.config, createdBy: row.created_by, createdAt: row.created_at })));
}));

api.post('/admin/products/:id/report-templates', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = reportTemplateCreateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const created = await tx(async (client) => {
    const product = await client.query('SELECT id FROM query_products WHERE id=$1', [req.params.id]);
    if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const next = await client.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM report_templates WHERE product_id=$1', [req.params.id]);
    const version = Number(next.rows[0].version);
    if (parsed.data.status === 'PUBLISHED') await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id=$1 AND status='PUBLISHED'`, [req.params.id]);
    const template = await client.query(`INSERT INTO report_templates(product_id,version,name,status,config,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,product_id,version,name,status,config,created_at`, [req.params.id, version, parsed.data.name, parsed.data.status, JSON.stringify(parsed.data.config), req.user!.id]);
    if (parsed.data.status === 'PUBLISHED') await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats,updated_by) VALUES($1,$2,'SNAPSHOT',ARRAY['JSON','HTML','PDF'],$3) ON CONFLICT(product_id) DO UPDATE SET template_id=EXCLUDED.template_id,updated_by=EXCLUDED.updated_by,updated_at=now()`, [req.params.id, template.rows[0].id, req.user!.id]);
    return template.rows[0];
  });
  await audit(req.user!.id, 'CREATE_REPORT_TEMPLATE', 'REPORT_TEMPLATE', String(created.id), { productId: req.params.id, status: parsed.data.status, requestId: requestId(req) });
  res.status(201).json({ id: created.id, productId: created.product_id, version: Number(created.version), name: created.name, status: created.status, config: created.config, createdAt: created.created_at });
}));

api.post('/admin/report-templates/:id/publish', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const published = await tx(async (client) => {
    const template = await client.query('SELECT id,product_id,version,name,config FROM report_templates WHERE id=$1', [req.params.id]);
    if (!template.rowCount) throw appError('REPORT_TEMPLATE_NOT_FOUND', { code: 'REPORT_TEMPLATE_NOT_FOUND', http: 404, expose: true });
    const row = template.rows[0];
    await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id=$1 AND status='PUBLISHED'`, [row.product_id]);
    await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [req.params.id]);
    await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats,updated_by) VALUES($1,$2,'SNAPSHOT',ARRAY['JSON','HTML','PDF'],$3) ON CONFLICT(product_id) DO UPDATE SET template_id=EXCLUDED.template_id,updated_by=EXCLUDED.updated_by,updated_at=now()`, [row.product_id, row.id, req.user!.id]);
    return row;
  });
  await audit(req.user!.id, 'PUBLISH_REPORT_TEMPLATE', 'REPORT_TEMPLATE', String(req.params.id), { productId: published.product_id, requestId: requestId(req) });
  res.json({ id: published.id, productId: published.product_id, version: Number(published.version), name: published.name, status: 'PUBLISHED', config: published.config });
}));

api.get('/admin/organizations/:id/query-prices', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const prices = await pool.query(`SELECT x.id,x.organization_id,x.product_id,p.name,p.price_cents AS base_price_cents,x.price_cents,x.active,x.starts_at,x.ends_at
    FROM organization_query_prices x JOIN query_products p ON p.id=x.product_id WHERE x.organization_id=$1 ORDER BY p.display_order,p.price_cents`, [req.params.id]);
  res.json(prices.rows.map((row) => ({ id: row.id, organizationId: row.organization_id, productId: row.product_id, productName: row.name, basePriceCents: Number(row.base_price_cents), priceCents: Number(row.price_cents), active: Boolean(row.active), startsAt: row.starts_at, endsAt: row.ends_at })));
}));

api.put('/admin/organizations/:id/query-prices', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = orgQueryPriceSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const value = parsed.data;
  const result = await tx(async (client) => {
    const organization = await client.query('SELECT id FROM organizations WHERE id=$1', [req.params.id]);
    if (!organization.rowCount) throw appError('ORGANIZATION_NOT_FOUND', { code: 'ORGANIZATION_NOT_FOUND', http: 404, expose: true });
    const product = await client.query('SELECT id,name,price_cents FROM query_products WHERE id=$1', [value.productId]);
    if (!product.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
    const saved = await client.query(`INSERT INTO organization_query_prices(organization_id,product_id,price_cents,active,starts_at,ends_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,product_id) DO UPDATE SET price_cents=EXCLUDED.price_cents,active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,created_by=EXCLUDED.created_by,updated_at=now()
      RETURNING id,organization_id,product_id,price_cents,active,starts_at,ends_at`, [req.params.id, value.productId, value.priceCents, value.active, value.startsAt ?? null, value.endsAt ?? null, req.user!.id]);
    return { row: saved.rows[0], product: product.rows[0] };
  });
  await audit(req.user!.id, 'UPSERT_ORGANIZATION_QUERY_PRICE', 'ORGANIZATION', String(req.params.id), { productId: value.productId, priceCents: value.priceCents, active: value.active, requestId: requestId(req) });
  res.json({ id: result.row.id, organizationId: result.row.organization_id, productId: result.row.product_id, productName: result.product.name, basePriceCents: Number(result.product.price_cents), priceCents: Number(result.row.price_cents), active: Boolean(result.row.active), startsAt: result.row.starts_at, endsAt: result.row.ends_at });
}));

api.delete('/admin/organizations/:id/query-prices/:productId', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const result = await pool.query('UPDATE organization_query_prices SET active=false,updated_at=now() WHERE organization_id=$1 AND product_id=$2 RETURNING id', [req.params.id, req.params.productId]);
  if (!result.rowCount) throw appError('ORGANIZATION_PRICE_NOT_FOUND', { code: 'ORGANIZATION_PRICE_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'DEACTIVATE_ORGANIZATION_QUERY_PRICE', 'ORGANIZATION', String(req.params.id), { productId: req.params.productId, requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/admin/organizations/:id/credit-package-prices', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const prices = await pool.query(`SELECT x.id,x.organization_id,x.package_id,p.slug,p.name,p.price_cents AS base_price_cents,x.price_cents,x.active,x.starts_at,x.ends_at
    FROM organization_credit_package_prices x JOIN credit_packages p ON p.id=x.package_id WHERE x.organization_id=$1 ORDER BY p.display_order,p.price_cents`, [req.params.id]);
  res.json(prices.rows.map((row) => ({ id: row.id, organizationId: row.organization_id, packageId: row.package_id, packageSlug: row.slug, packageName: row.name, basePriceCents: Number(row.base_price_cents), priceCents: Number(row.price_cents), active: Boolean(row.active), startsAt: row.starts_at, endsAt: row.ends_at })));
}));

api.put('/admin/organizations/:id/credit-package-prices', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const parsed = orgPackagePriceSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const value = parsed.data;
  const result = await tx(async (client) => {
    const organization = await client.query('SELECT id FROM organizations WHERE id=$1', [req.params.id]);
    if (!organization.rowCount) throw appError('ORGANIZATION_NOT_FOUND', { code: 'ORGANIZATION_NOT_FOUND', http: 404, expose: true });
    const pack = await client.query('SELECT id,slug,price_cents FROM credit_packages WHERE slug=$1', [value.packageSlug]);
    if (!pack.rowCount) throw appError('CREDIT_PACKAGE_NOT_FOUND', { code: 'CREDIT_PACKAGE_NOT_FOUND', http: 404, expose: true });
    const saved = await client.query(`INSERT INTO organization_credit_package_prices(organization_id,package_id,price_cents,active,starts_at,ends_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,package_id) DO UPDATE SET price_cents=EXCLUDED.price_cents,active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,created_by=EXCLUDED.created_by,updated_at=now()
      RETURNING id,organization_id,package_id,price_cents,active,starts_at,ends_at`, [req.params.id, pack.rows[0].id, value.priceCents, value.active, value.startsAt ?? null, value.endsAt ?? null, req.user!.id]);
    return { row: saved.rows[0], basePriceCents: Number(pack.rows[0].price_cents), packageSlug: pack.rows[0].slug };
  });
  await audit(req.user!.id, 'UPSERT_ORGANIZATION_PACKAGE_PRICE', 'ORGANIZATION', String(req.params.id), { packageSlug: result.packageSlug, active: value.active, requestId: requestId(req) });
  res.json({ id: result.row.id, organizationId: result.row.organization_id, packageId: result.row.package_id, packageSlug: result.packageSlug, basePriceCents: result.basePriceCents, priceCents: Number(result.row.price_cents), active: Boolean(result.row.active), startsAt: result.row.starts_at, endsAt: result.row.ends_at });
}));

api.delete('/admin/organizations/:id/credit-package-prices/:packageId', adminAuth, requirePermission('MANAGE_PRICING'), asyncRoute(async (req, res) => {
  const result = await pool.query(`UPDATE organization_credit_package_prices SET active=false,updated_at=now() WHERE organization_id=$1 AND package_id=$2 RETURNING id`, [req.params.id, req.params.packageId]);
  if (!result.rowCount) throw appError('ORGANIZATION_PRICE_NOT_FOUND', { code: 'ORGANIZATION_PRICE_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'DEACTIVATE_ORGANIZATION_PACKAGE_PRICE', 'ORGANIZATION', String(req.params.id), { packageId: req.params.packageId, requestId: requestId(req) });
  res.status(204).end();
}));

api.get('/admin/users', adminAuth, requirePermission('MANAGE_USERS'), asyncRoute(async (_req, res) => {
  const users = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.last_login_at,
    coalesce(w.balance_cents,0) AS balance_cents,
    (SELECT count(*) FROM vehicle_queries q WHERE q.user_id=u.id) AS queries_count
    FROM users u LEFT JOIN wallets w ON w.user_id=u.id
    WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 200`);
  res.json(users.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, active: row.active, createdAt: row.created_at, lastLoginAt: row.last_login_at, balanceCents: Number(row.balance_cents), queriesCount: Number(row.queries_count) })));
}));

api.patch('/admin/users/:id', adminAuth, requirePermission('MANAGE_USERS'), asyncRoute(async (req, res) => {
  const parsed = adminUserUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  if (String(req.params.id) === req.user!.id) throw appError('ADMIN_SELF_CHANGE_FORBIDDEN', { code: 'ADMIN_SELF_CHANGE_FORBIDDEN', http: 409, expose: true });
  if (parsed.data.role === 'ADMIN' && !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  const target = await pool.query('SELECT id,role FROM users WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
  if (!target.rowCount) throw appError('USER_NOT_FOUND', { code: 'USER_NOT_FOUND', http: 404, expose: true });
  if (target.rows[0].role === 'SUPER_ADMIN' && !hasPermission(req.user!.role, 'ADMIN_SYSTEM')) throw appError('FORBIDDEN', { code: 'FORBIDDEN', http: 403, expose: true });
  const assignments: string[] = []; const values: unknown[] = [];
  if (parsed.data.active !== undefined) { values.push(parsed.data.active); assignments.push(`active=$${values.length}`); }
  if (parsed.data.role !== undefined) { values.push(parsed.data.role); assignments.push(`role=$${values.length}`); }
  values.push(req.params.id);
  const updated = await pool.query(`UPDATE users SET ${assignments.join(', ')} WHERE id=$${values.length} RETURNING id,name,email,role,active`, values);
  await audit(req.user!.id, 'ADMIN_UPDATE_USER', 'USER', String(req.params.id), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  res.json(updated.rows[0]);
}));

api.delete('/admin/users/:id', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  if (String(req.params.id) === req.user!.id) {
    throw appError('ADMIN_SELF_DELETION_FORBIDDEN', { code: 'ADMIN_SELF_DELETION_FORBIDDEN', http: 409, expose: true });
  }
  const removed = await tx(async (client) => {
    const target = await client.query('SELECT id,name,email,role FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!target.rowCount) throw appError('USER_NOT_FOUND', { code: 'USER_NOT_FOUND', http: 404, expose: true });
    await client.query('UPDATE users SET active=false,deleted_at=now() WHERE id=$1', [req.params.id]);
    await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [req.params.id]);
    return target.rows[0] as { id: string; email: string; role: string };
  });
  await audit(req.user!.id, 'ADMIN_SOFT_DELETE_USER', 'USER', removed.id, { targetEmail: removed.email, targetRole: removed.role, requestId: requestId(req) });
  res.status(204).end();
}));

api.post('/admin/users/:id/wallet-adjustments', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const parsed = adminWalletAdjustmentSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await tx(async (client) => {
    const user = await client.query('SELECT id FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL', [req.params.id]);
    if (!user.rowCount) throw appError('USER_NOT_FOUND', { code: 'USER_NOT_FOUND', http: 404, expose: true });
    const wallet = await client.query('SELECT balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE', [req.params.id]);
    const before = Number(wallet.rows[0]?.balance_cents ?? 0); const after = before + parsed.data.amountCents;
    if (after < 0) throw appError('WALLET_BALANCE_INVALID', { code: 'WALLET_BALANCE_INVALID', http: 409, expose: true });
    await client.query('INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,0,$2) ON CONFLICT(user_id) DO UPDATE SET balance=0,balance_cents=EXCLUDED.balance_cents,updated_at=now()', [req.params.id, after]);
    const transaction = await client.query(`INSERT INTO wallet_transactions(user_id,kind,amount,balance_before,balance_after,amount_cents,balance_before_cents,balance_after_cents,description,metadata)
      VALUES($1,'ADMIN_ADJUSTMENT',0,0,0,$2,$3,$4,$5,$6::jsonb) RETURNING id`, [req.params.id, parsed.data.amountCents, before, after, parsed.data.description, JSON.stringify({ adminId: req.user!.id, requestId: requestId(req) })]);
    return { transactionId: transaction.rows[0].id, balanceBeforeCents: before, balanceAfterCents: after, balanceCents: after };
  });
  await audit(req.user!.id, 'ADMIN_WALLET_ADJUSTMENT', 'WALLET', String(req.params.id), { amountCents: parsed.data.amountCents, requestId: requestId(req) });
  res.status(201).json(result);
}));

api.get('/admin/payments', adminAuth, requirePermission('MANAGE_BILLING'), asyncRoute(async (req, res) => {
  const filters = z.object({
    status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'FAILED', 'REFUNDED']).optional(),
    customerType: z.enum(['PARTICULAR', 'AUTONOMO', 'EMPRESA']).optional(),
    search: z.string().trim().max(80).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }).safeParse(req.query);
  if (!filters.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const f = filters.data; const where: string[] = []; const values: unknown[] = [];
  const push = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (f.status) where.push(`p.status=${push(f.status)}`);
  if (f.customerType) where.push(`coalesce(up.customer_type,'PARTICULAR')=${push(f.customerType)}`);
  if (f.search) { const l = push(`%${f.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where.push(`(u.name ILIKE ${l} OR u.email ILIKE ${l} OR o.query_plate ILIKE ${l})`); }
  if (f.from) where.push(`p.created_at >= ${push(f.from)}::date`);
  if (f.to) where.push(`p.created_at < ${push(f.to)}::date + 1`);
  const payments = await pool.query(`SELECT p.id,p.status,p.amount_cents,p.provider,p.external_id,p.created_at,p.paid_at,o.purchase_type,o.product_id,o.query_plate,u.name,u.email,
      coalesce(up.customer_type,'PARTICULAR') AS customer_type,
      (SELECT d.status FROM fiscal_documents d WHERE d.payment_id=p.id AND d.status <> 'CANCELLED' LIMIT 1) AS fiscal_status
    FROM payments p JOIN users u ON u.id=p.user_id LEFT JOIN user_profiles up ON up.user_id=p.user_id LEFT JOIN payment_orders o ON o.id=p.order_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 300`, values);
  res.json(payments.rows.map((row) => ({ id: row.id, status: row.status, amountCents: Number(row.amount_cents), purchaseType: row.purchase_type ?? null, productId: row.product_id ?? null, plate: row.query_plate ?? null, provider: row.provider, externalId: row.external_id ?? null, createdAt: row.created_at, paidAt: row.paid_at ?? null, customer: { name: row.name, email: row.email }, customerType: row.customer_type, fiscalStatus: row.fiscal_status ?? null })));
}));

api.get('/admin/contact-messages', adminAuth, requirePermission('MANAGE_SUPPORT'), asyncRoute(async (_req, res) => {
  const messages = await pool.query(`SELECT id,user_id,name,email,subject,message,category,status,created_at,closed_at
    FROM contact_messages ORDER BY created_at DESC LIMIT 200`);
  res.json(messages.rows.map((row) => ({ id: row.id, userId: row.user_id, name: row.name, email: row.email, subject: row.subject, message: row.message, category: row.category, status: row.status, createdAt: row.created_at, closedAt: row.closed_at })));
}));

api.patch('/admin/contact-messages/:id', adminAuth, requirePermission('MANAGE_SUPPORT'), asyncRoute(async (req, res) => {
  const parsed = contactStatusSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const updated = await pool.query(`UPDATE contact_messages SET status=$2,closed_at=CASE WHEN $2='CLOSED' THEN now() ELSE NULL END WHERE id=$1 RETURNING id,status,closed_at`, [req.params.id, parsed.data.status]);
  if (!updated.rowCount) throw appError('CONTACT_NOT_FOUND', { code: 'CONTACT_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'UPDATE_CONTACT_TICKET', 'CONTACT', String(req.params.id), { status: parsed.data.status, requestId: requestId(req) });
  res.json({ id: updated.rows[0].id, status: updated.rows[0].status, closedAt: updated.rows[0].closed_at });
}));

api.post('/admin/audit/retention', adminAuth, requirePermission('ADMIN_SYSTEM'), asyncRoute(async (req, res) => {
  const parsed = auditRetentionSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const cutoff = new Date(Date.now() - parsed.data.olderThanDays * 24 * 60 * 60 * 1000);
  const candidates = await pool.query('SELECT count(*)::int AS count FROM audit_logs WHERE created_at<$1', [cutoff]);
  const candidateCount = Number(candidates.rows[0]?.count ?? 0);
  if (!parsed.data.execute) {
    res.json({ dryRun: true, cutoffAt: cutoff.toISOString(), candidateCount, retentionDays: parsed.data.olderThanDays });
    return;
  }
  const deleted = await tx(async (client) => {
    const removed = await client.query('DELETE FROM audit_logs WHERE created_at<$1', [cutoff]);
    await client.query('INSERT INTO audit_retention_runs(cutoff_at,deleted_count,executed_by) VALUES($1,$2,$3)', [cutoff, removed.rowCount ?? 0, req.user!.id]);
    return removed.rowCount ?? 0;
  });
  await audit(req.user!.id, 'AUDIT_RETENTION_EXECUTED', 'AUDIT_LOG', null, { cutoffAt: cutoff.toISOString(), deletedCount: deleted, retentionDays: parsed.data.olderThanDays, requestId: requestId(req) });
  res.json({ dryRun: false, cutoffAt: cutoff.toISOString(), deletedCount: deleted, retentionDays: parsed.data.olderThanDays });
}));

api.get('/admin/audit', adminAuth, requirePermission('VIEW_AUDIT'), asyncRoute(async (_req, res) => {
  const entries = await pool.query(`SELECT a.id,a.action,a.entity,a.entity_id,a.created_at,u.name AS actor_name,u.email AS actor_email
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`);
  res.json(entries.rows.map((row) => ({ id: row.id, action: row.action, entity: row.entity, entityId: row.entity_id, createdAt: row.created_at, actor: row.actor_name ? { name: row.actor_name, email: row.actor_email } : null })));
}));

api.get('/admin/permissions', adminAuth, requirePermission('ADMIN_SYSTEM'), (req, res) => {
  res.json({ role: req.user!.role, permissions: permissionsFor(req.user!.role), canManagePricing: hasPermission(req.user!.role, 'MANAGE_PRICING') });
});

app.use('/api', api);
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const known = error as AppError;
  const status = known.http ?? 500;
  const code = known.code ?? 'INTERNAL_ERROR';
  log('error', 'request_failed', { requestId: requestId(req), path: req.path, method: req.method, status, code, message: error instanceof Error ? error.message : 'Unknown error' });
  const details = known.expose ? (known as AppError & { details?: unknown }).details : undefined;
  res.status(status).json({ error: code, message: known.expose ? (code.startsWith('SIM_') ? known.message : humanMessage(code)) : 'Não foi possível concluir esta operação agora. Tente novamente.', ...(Array.isArray(details) ? { details } : {}) });
});

function parseOAuthProvider(value: string): OAuthProvider {
  if (value === 'google' || value === 'microsoft' || value === 'apple') return value;
  throw appError('OAUTH_PROVIDER_UNSUPPORTED', { code: 'OAUTH_PROVIDER_UNSUPPORTED', http: 404, expose: true });
}

function humanMessage(code: string): string {
  const messages: Record<string, string> = {
    INVALID_INPUT: 'Revise os dados informados e tente novamente.',
    INVALID_PLATE: 'Informe uma placa válida no padrão brasileiro.',
    INVALID_CREDENTIALS: 'E-mail ou senha inválidos.',
    EMAIL_ALREADY_EXISTS: 'Já existe uma conta para este e-mail.',
    AUTH_REQUIRED: 'Entre na sua conta para continuar.',
    INVALID_TOKEN: 'Sua sessão expirou. Entre novamente para continuar.',
    FORBIDDEN: 'Sua conta não tem permissão para realizar esta ação.',
    PRODUCT_NOT_FOUND: 'Este produto de consulta não está disponível.',
    QUERY_NOT_FOUND: 'A consulta solicitada não foi encontrada.',
    QUERY_IN_PROGRESS: 'Já existe uma consulta em processamento para esta solicitação.',
    SANDBOX_DISABLED: 'A compra de saldo pré-pago de teste não está disponível neste ambiente.',
    OAUTH_PROVIDER_UNSUPPORTED: 'Este provedor de acesso não é suportado.',
    OAUTH_PROVIDER_NOT_CONFIGURED: 'Este provedor de acesso ainda não foi configurado pela plataforma.',
    OAUTH_TICKET_INVALID: 'Esta solicitação de acesso expirou. Tente entrar novamente.',
    PASSWORD_RESET_UNAVAILABLE: 'A recuperação por e-mail está temporariamente indisponível porque o envio de e-mail ainda não foi configurado. Tente novamente mais tarde ou fale com o suporte.',
    USER_NOT_FOUND: 'O usuário solicitado não foi encontrado.',
    ADMIN_SELF_CHANGE_FORBIDDEN: 'Para segurança, use outro administrador para alterar o próprio acesso.',
    WALLET_BALANCE_INVALID: 'Este ajuste deixaria a carteira com saldo negativo.',
    CREDIT_PACKAGE_NOT_FOUND: 'A oferta legada de saldo pré-pago solicitada não está disponível.',
    PAYMENT_PROVIDER_NOT_CONFIGURED: 'O checkout de pagamento ainda não foi configurado para este ambiente.',
    PAYMENT_PROVIDER_REQUEST_FAILED: 'Não foi possível abrir o checkout agora. Tente novamente em alguns instantes.',
    FIPE_FEATURE_DISABLED: 'A consulta FIPE gratuita está em ativação para este ambiente.',
    FIPE_PROVIDER_UNAVAILABLE: 'A consulta não respondeu de forma válida. Tente novamente em alguns instantes.',
    FIPE_NOT_FOUND: 'A combinação de veículo informada não foi encontrada na tabela vigente.',
    FIPE_REFERENCE_MISSING: 'A referência mensal da consulta não está disponível no momento.',
    FIPE_PLATE_DATA_INVALID: 'Não foi possível identificar os dados do veículo para esta placa.',
    VEHICLE_NOT_FOUND: 'Não encontramos este veículo no guia.',
    CONSUMPTION_NOT_FOUND: 'Não encontramos este registro de consumo.',
    CATALOG_NOT_FOUND: 'Não encontramos este veículo no catálogo.',
    CATALOG_SNAPSHOT_INVALID: 'Informe o mês do arquivo no formato AAAA-MM, por exemplo 2026-09.',
    IMPORT_HAS_ERRORS: 'O arquivo tem linhas inválidas. Corrija e rode a prévia de novo antes de importar.',
    INVALID_SPECS: 'Há campos da ficha técnica com valor inválido. Revise os campos indicados.',
    VEHICLE_HAS_OPINIONS: 'Este modelo já tem opiniões de donos. Arquive o modelo em vez de apagar.',
    SLUG_TAKEN: 'Já existe um modelo com este endereço (slug).',
    TIP_NOT_FOUND: 'A dica não foi encontrada.',
    OPINION_NOT_FOUND: 'A opinião não foi encontrada.',
    VERSION_DUPLICATE: 'Já existe uma versão com este nome e ano neste modelo.',
    IMPORT_INVALID: 'O arquivo de importação é inválido.',
    IMPORT_EMPTY: 'A planilha não tem linhas para importar.',
    IMPORT_TOO_LARGE: 'A planilha tem linhas demais. Importe até 2.000 linhas por vez.',
    IMPORT_MISSING_COLUMNS: 'A planilha precisa das colunas marca, modelo e versao. Baixe o modelo de planilha.',
    COMPARE_NEEDS_2_OR_3: 'Escolha de 2 a 3 veículos diferentes para comparar.',
    COMPARE_VEHICLE_NOT_FOUND: 'Um dos veículos escolhidos não está mais disponível no guia.',
    OPINION_TOO_SHORT: 'Conte um pouco mais: escreva ao menos 20 caracteres entre o que gostou, o que não gostou e o comentário.',
    OPINION_LINKS_NOT_ALLOWED: 'Não é permitido colocar links ou e-mails na opinião.',
    VERSION_NOT_FOUND: 'A versão escolhida não existe para este modelo.',
    SIMULATION_NOT_FOUND: 'Simulação não encontrada.',
    BANK_EXISTS: 'Já existe um banco com esse nome.',
    BANK_NOT_FOUND: 'Banco não encontrado.',
    BCB_UNAVAILABLE: 'Não foi possível consultar o Banco Central agora. As taxas atuais foram mantidas; tente novamente mais tarde.',
    VEHICLE_PLATE_UNAVAILABLE: 'A busca por placa está indisponível no momento. Busque pelo nome do modelo.',
    FIPE_PLATE_NOT_FOUND: 'Não identificamos um veículo para esta placa. Confira os dados e tente novamente.',
    FIPE_PLATE_UNAVAILABLE: 'Não foi possível consultar os dados do veículo agora. Tente novamente em instantes.',
    FIPE_PLATE_VEHICLE_NOT_IDENTIFIED: 'Não encontramos a versão FIPE correspondente a esta placa.',
    FIPE_SELECTION_REQUIRED: 'Informe a placa ou selecione o veículo para consultar a FIPE.',
    FIPE_DAILY_LIMIT: 'O limite diário de consultas FIPE foi atingido. Tente novamente amanhã.',
    REPORT_NOT_FOUND: 'O relatório solicitado não foi encontrado ou não está disponível.',
    FIPE_INVALID_REPORT: 'O relatório FIPE não pôde ser validado.'
  };
  return messages[code] ?? 'Não foi possível concluir esta operação agora. Tente novamente.';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');
const indexHtmlPath = path.join(webDist, 'index.html');
const indexHtmlTemplate = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf8') : '';
const adminHtmlPath = path.join(webDist, 'admin.html');
const adminHtmlTemplate = existsSync(adminHtmlPath) ? readFileSync(adminHtmlPath, 'utf8') : undefined;
const staticOptions = { index: false, maxAge: env.NODE_ENV === 'production' ? '1h' : 0, etag: true } as const;
const serveStatic = express.static(webDist, staticOptions);
app.get('/robots.txt', (req, res) => { res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600'); res.send(renderRobotsTxt(env.APP_URL ?? env.WEB_ORIGIN, isAdminHost(req))); });
app.get('/sitemap.xml', asyncRoute(async (req, res) => {
  if (isAdminHost(req)) return res.status(404).end();
  const articles = await publishedArticleSlugs();
  const vehicles = await pool.query(`SELECT slug,updated_at FROM vehicle_models WHERE status='PUBLISHED' AND archived_at IS NULL ORDER BY brand,name LIMIT 5000`);
  res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(renderSitemapXml(env.APP_URL ?? env.WEB_ORIGIN, [...articles.map((a) => ({ path: `/blog/${a.slug}`, lastmod: a.updatedAt })), ...vehicles.rows.map((v) => ({ path: `/veiculos/${v.slug}`, lastmod: v.updated_at as Date }))]));
}));
const hasAdminHosts = adminHosts().length > 0;
// Duas frentes: bundle admin (admin.html + assets/admin-*) só é entregue no host do painel (ou em /painel quando não há host dedicado, apenas dev).
const isAdminAsset = (p: string) => p === '/admin.html' || p.startsWith('/assets/admin-');
app.use((req, res, next) => {
  if (isAdminHost(req)) return serveStatic(req, res, next);
  if (isAdminAsset(req.path) && hasAdminHosts) return res.status(404).end();
  if (req.path === '/admin.html') return res.status(404).end();
  return serveStatic(req, res, next);
});
function sendAdminShell(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.type('html').send(adminHtmlTemplate);
}
app.get('*', asyncRoute(async (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/health') return next();
  if (isAdminHost(req)) {
    if (!adminHtmlTemplate) return next();
    return sendAdminShell(res);
  }
  if (!hasAdminHosts && adminHtmlTemplate && (req.path === '/painel' || req.path.startsWith('/painel/'))) return sendAdminShell(res);
  if (!indexHtmlTemplate) return next();
  res.setHeader('Cache-Control', 'no-store');
  const baseUrl = (env.APP_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');
  let override: SeoOverride = {};
  const article = /^\/blog\/([a-z0-9-]+)\/?$/.exec(req.path);
  if (article) {
    const meta = await articleSeo(article[1]);
    if (!meta) res.status(404);
    else override = { title: `${meta.title} | Placa na Mão`, description: meta.description, jsonLd: [{ '@context': 'https://schema.org', '@type': 'Article', headline: meta.title, description: meta.description, datePublished: meta.publishedAt, dateModified: meta.updatedAt, inLanguage: 'pt-BR', author: { '@type': 'Organization', name: meta.author }, publisher: { '@type': 'Organization', name: 'Placa na Mão', url: `${baseUrl}/` }, mainEntityOfPage: `${baseUrl}/blog/${article[1]}` }] };
  } else if (/^\/veiculos\/[a-z0-9-]+\/?$/.test(req.path)) {
    const v = await pool.query(`SELECT brand,name,summary,year_from,year_to,body_type FROM vehicle_models WHERE slug=$1 AND status='PUBLISHED' AND archived_at IS NULL`, [req.path.split('/')[2]]);
    if (!v.rowCount) res.status(404);
    else {
      const m = v.rows[0]!;
      const years = m.year_from ? ` (${m.year_from}${m.year_to && m.year_to !== m.year_from ? `–${m.year_to}` : ''})` : '';
      override = { title: `${m.brand} ${m.name}${years}: ficha técnica e opinião dos donos | Placa na Mão`, description: String(m.summary || `Ficha técnica, consumo, nota e opinião de donos do ${m.brand} ${m.name}.`).slice(0, 160) };
    }
  } else if (req.path.replace(/\/$/, '') === '/perguntas-frequentes') {
    const faqs = await pool.query('SELECT question,answer FROM faqs WHERE active=true ORDER BY display_order,created_at LIMIT 60');
    if (faqs.rowCount) override = { jsonLd: [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.rows.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }] };
  }
  res.type('html').send(renderSeoHtml(indexHtmlTemplate, req.path, env.APP_URL ?? env.WEB_ORIGIN, override));
}));

setInterval(() => { sweepStuckQueries(env.QUERY_STUCK_MINUTES).catch((error) => log('error', 'query_sweeper_failed', { message: error instanceof Error ? error.message : 'unknown' })); }, 2 * 60 * 1000).unref();
setInterval(() => { releaseCommissions().catch((error) => log('error', 'commission_release_failed', { message: error instanceof Error ? error.message : 'unknown' })); }, 60 * 60 * 1000).unref();
const httpServer = app.listen(env.PORT, '0.0.0.0', () => log('info', 'server_started', { port: env.PORT, provider: env.DATA_PROVIDER, environment: env.NODE_ENV }));
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'server_shutdown_started', { signal });
  const forceExit = setTimeout(() => process.exit(1), 10000);
  forceExit.unref();
  httpServer.close(async (error) => {
    try {
      await pool.end();
      clearTimeout(forceExit);
      if (error) {
        log('error', 'server_shutdown_failed', { signal, error: error.message });
        process.exitCode = 1;
      } else {
        log('info', 'server_shutdown_completed', { signal });
      }
    } catch (closeError) {
      clearTimeout(forceExit);
      log('error', 'server_shutdown_failed', { signal, error: closeError instanceof Error ? closeError.message : 'unknown' });
      process.exitCode = 1;
    }
  });
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
