import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth, TEAM_ROLES } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { BR_STATES, documentKind, formatDocument, maskDocument, onlyDigits, toCsv } from '../lib/br.js';
import { hasPermission, outranks, permissionsFor, requirePermission, rolesBelow, TEAM_ROLE_INFO, TEAM_ROLE_RANK } from '../permissions.js';
import { assertEmailConfigured, sendResetLink } from '../lib/passwordResetLink.js';

/**
 * Pessoas e empresas no painel:
 *  - Equipe: quem trabalha no sistema, com nível de acesso (papel).
 *  - Clientes: quem compra e consulta (particular, autônomo/vendedor, empresa), com dados fiscais.
 *  - Empresas: agências, revendas e lojas que agrupam clientes e têm preço próprio.
 */
export const adminPeopleRouter = Router();
adminPeopleRouter.use(adminAuth);

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const conflict = (code: string) => appError(code, { code, http: 409, expose: true });
const forbidden = (code = 'FORBIDDEN') => appError(code, { code, http: 403, expose: true });
const notFound = (code: string) => appError(code, { code, http: 404, expose: true });

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const emailField = z.string().trim().toLowerCase().email().max(254);

// ------------------------------------------------------------------ equipe

/** Convite novo vale 3 dias; a pessoa cria a própria senha pelo link. */
const INVITE_TTL_MINUTES = 3 * 24 * 60;

/** Só dá para gerenciar quem está abaixo na hierarquia (o super admin alcança todos). */
function canManageRole(actorRole: string, targetRole: string): boolean {
  return outranks(actorRole, targetRole);
}

const teamCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailField,
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'FINANCEIRO', 'OPERADOR', 'SUPORTE', 'CONTEUDO'])
}).strict();
// Nome, e-mail e senha são dados pessoais: só o próprio usuário altera (em "Minha conta").
const teamUpdateSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'FINANCEIRO', 'OPERADOR', 'SUPORTE', 'CONTEUDO']).optional(),
  active: z.boolean().optional()
}).strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

const presentTeam = (r: Record<string, unknown>) => ({
  id: r.id, name: r.name, email: r.email, role: r.role, active: Boolean(r.active), createdAt: r.created_at, lastLoginAt: r.last_login_at ?? null,
  twoFactorEnabled: Boolean(r.totp_enabled), lockedUntil: r.locked_until ?? null
});
const TEAM_SELECT = `SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.last_login_at,u.locked_until,
    EXISTS (SELECT 1 FROM team_totp t WHERE t.user_id=u.id AND t.enabled_at IS NOT NULL) AS totp_enabled
  FROM users u`;

adminPeopleRouter.get('/team/roles', requirePermission('MANAGE_TEAM'), (req, res) => {
  res.json({
    roles: TEAM_ROLE_INFO.map((r) => ({ ...r, rank: TEAM_ROLE_RANK[r.role], assignable: canManageRole(req.user!.role, r.role), permissions: permissionsFor(r.role) }))
  });
});

adminPeopleRouter.get('/team', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  // Cada um enxerga a si mesmo e quem está abaixo; níveis acima não aparecem.
  const rows = await pool.query(`${TEAM_SELECT} WHERE u.deleted_at IS NULL AND (u.role = ANY($1::text[]) OR u.id=$2) ORDER BY u.active DESC, u.created_at`, [rolesBelow(req.user!.role), req.user!.id]);
  res.json({ items: rows.rows.map(presentTeam) });
}));

adminPeopleRouter.post('/team', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  const parsed = teamCreateSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  if (!canManageRole(req.user!.role, v.role)) throw forbidden('ROLE_NOT_ALLOWED');
  assertEmailConfigured();
  // Senha aleatória que ninguém conhece: a pessoa define a dela pelo link do convite.
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
  try {
    const created = await tx(async (client) => {
      const user = await client.query(`INSERT INTO users(email,password_hash,name,role,password_enabled) VALUES($1,$2,$3,$4,true) RETURNING id`, [v.email, hash, v.name, v.role]);
      await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [user.rows[0].id]);
      return String(user.rows[0].id);
    });
    await audit(req.user!.id, 'TEAM_USER_CREATED', 'USER', created, { role: v.role, requestId: requestId(req) });
    const row = await pool.query(`${TEAM_SELECT} WHERE u.id=$1`, [created]);
    const inviteSent = await sendResetLink({ id: created, email: v.email, name: v.name }, INVITE_TTL_MINUTES);
    res.status(201).json({ member: presentTeam(row.rows[0]), inviteSent });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') throw conflict('EMAIL_ALREADY_EXISTS');
    throw error;
  }
}));

async function loadTeamTarget(req: { params: Record<string, string>; user?: { id: string; role: string } }) {
  if (!isUuid(req.params.id)) throw notFound('USER_NOT_FOUND');
  const target = await pool.query('SELECT id,name,email,role,active FROM users WHERE id=$1 AND deleted_at IS NULL AND role = ANY($2::text[])', [req.params.id, TEAM_ROLES]);
  if (!target.rowCount) throw notFound('USER_NOT_FOUND');
  if (req.params.id === req.user!.id) throw conflict('ADMIN_SELF_CHANGE_FORBIDDEN');
  const role = String(target.rows[0].role);
  // Quem está acima (ou no mesmo nível) não existe para o ator.
  if (!canManageRole(req.user!.role, role)) throw notFound('USER_NOT_FOUND');
  return { id: String(target.rows[0].id), name: String(target.rows[0].name), email: String(target.rows[0].email), role, active: Boolean(target.rows[0].active) };
}

async function assertNotLastSuperAdmin(userId: string): Promise<void> {
  const others = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role='SUPER_ADMIN' AND active=true AND deleted_at IS NULL AND id <> $1`, [userId]);
  if (Number(others.rows[0].n) < 1) throw conflict('LAST_SUPER_ADMIN');
}

adminPeopleRouter.patch('/team/:id', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  const parsed = teamUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const target = await loadTeamTarget(req as never);
  const v = parsed.data;
  if (v.role && !canManageRole(req.user!.role, v.role)) throw forbidden('ROLE_NOT_ALLOWED');
  if (target.role === 'SUPER_ADMIN' && ((v.role && v.role !== 'SUPER_ADMIN') || v.active === false)) await assertNotLastSuperAdmin(target.id);
  const sets: string[] = []; const values: unknown[] = [];
  if (v.role !== undefined) { values.push(v.role); sets.push(`role=$${values.length}`); }
  if (v.active !== undefined) { values.push(v.active); sets.push(`active=$${values.length}`); }
  values.push(target.id);
  await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${values.length}`, values);
  if (v.active === false || (v.role && v.role !== target.role)) await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [target.id]);
  await audit(req.user!.id, 'TEAM_USER_UPDATED', 'USER', target.id, { fields: Object.keys(v), fromRole: target.role, toRole: v.role ?? target.role, requestId: requestId(req) });
  const row = await pool.query(`${TEAM_SELECT} WHERE u.id=$1`, [target.id]);
  res.json({ member: presentTeam(row.rows[0]) });
}));

adminPeopleRouter.post('/team/:id/reset-password', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  const target = await loadTeamTarget(req as never);
  // Ninguém vê nem define a senha de outra pessoa: ela recebe um link e cria a nova.
  if (!(await sendResetLink({ id: target.id, email: target.email, name: target.name }))) throw appError('EMAIL_SEND_FAILED', { code: 'EMAIL_SEND_FAILED', http: 502, expose: true });
  await audit(req.user!.id, 'TEAM_PASSWORD_RESET_LINK_SENT', 'USER', target.id, { requestId: requestId(req) });
  res.json({ sent: true });
}));

adminPeopleRouter.post('/team/:id/reset-2fa', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  const target = await loadTeamTarget(req as never);
  await tx(async (client) => {
    await client.query('DELETE FROM team_totp_recovery_codes WHERE user_id=$1', [target.id]);
    await client.query('DELETE FROM team_totp WHERE user_id=$1', [target.id]);
    await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [target.id]);
  });
  await audit(req.user!.id, 'TEAM_2FA_RESET', 'USER', target.id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

adminPeopleRouter.delete('/team/:id', requirePermission('MANAGE_TEAM'), asyncRoute(async (req, res) => {
  const target = await loadTeamTarget(req as never);
  if (target.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(target.id);
  await tx(async (client) => {
    await client.query(`UPDATE users SET active=false,deleted_at=now(),email=email || '.removido.' || substr(id::text,1,8) WHERE id=$1`, [target.id]);
    await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [target.id]);
  });
  await audit(req.user!.id, 'TEAM_USER_REMOVED', 'USER', target.id, { role: target.role, requestId: requestId(req) });
  res.status(204).end();
}));

// ------------------------------------------------------------------ clientes

const CUSTOMER_TYPES = ['PARTICULAR', 'AUTONOMO', 'EMPRESA'] as const;
const stateField = z.string().trim().toUpperCase().refine((s) => (BR_STATES as readonly string[]).includes(s), 'INVALID_STATE').nullish().transform((v) => (v ? v : null));
const docField = z.string().trim().max(30).nullish().transform((v) => (v ? onlyDigits(v) : null)).refine((v) => v === null || documentKind(v) !== null, 'INVALID_DOCUMENT');

const customerFields = {
  name: z.string().trim().min(2).max(120),
  email: emailField,
  type: z.enum(CUSTOMER_TYPES),
  segment: optionalText(60),
  cpfCnpj: docField,
  phone: optionalText(30),
  companyName: optionalText(160),
  legalName: optionalText(160),
  stateRegistration: optionalText(30),
  municipalRegistration: optionalText(30),
  billingEmail: z.string().trim().toLowerCase().email().max(254).nullish().transform((v) => v ?? null),
  zip: z.string().trim().max(12).nullish().transform((v) => (v ? onlyDigits(v) || null : null)),
  street: optionalText(160), streetNumber: optionalText(20), complement: optionalText(80), district: optionalText(80), city: optionalText(80), state: stateField,
  notes: optionalText(1000),
  organizationId: z.string().uuid().nullish().transform((v) => v ?? null)
};
const customerCreateSchema = z.object({
  ...customerFields,
  portalAccess: z.boolean().default(true)
}).strict().superRefine((v, ctx) => {
  if (v.type === 'EMPRESA' && v.cpfCnpj && documentKind(v.cpfCnpj) !== 'CNPJ') ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'EMPRESA_REQUIRES_CNPJ' });
  if (v.type === 'PARTICULAR' && v.cpfCnpj && documentKind(v.cpfCnpj) !== 'CPF') ctx.addIssue({ code: 'custom', path: ['cpfCnpj'], message: 'PARTICULAR_REQUIRES_CPF' });
});
const customerUpdateSchema = z.object(customerFields).partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

const CUSTOMER_COLS: Record<string, string> = {
  type: 'customer_type', segment: 'segment', cpfCnpj: 'cpf_cnpj', phone: 'phone', companyName: 'company_name', legalName: 'legal_name', stateRegistration: 'state_registration',
  municipalRegistration: 'municipal_registration', billingEmail: 'billing_email', zip: 'zip', street: 'street', streetNumber: 'street_number', complement: 'complement', district: 'district',
  city: 'city', state: 'state', notes: 'notes'
};

const CUSTOMER_SELECT = `SELECT u.id,u.name,u.email,u.active,u.created_at,u.last_login_at,u.password_enabled,
    coalesce(p.customer_type,'PARTICULAR') AS customer_type,p.segment,p.cpf_cnpj,p.phone,p.company_name,p.legal_name,p.state_registration,p.municipal_registration,p.billing_email,p.zip,p.street,p.street_number,p.complement,p.district,p.city,p.state,p.notes,p.archived_at,
    coalesce(w.balance_cents,0) AS balance_cents,
    org.id AS org_id, org.name AS org_name,
    (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id=u.id) AS queries_count,
    (SELECT max(q.created_at) FROM vehicle_queries q WHERE q.user_id=u.id) AS last_query_at,
    (SELECT coalesce(sum(pay.amount_cents),0)::bigint FROM payments pay WHERE pay.user_id=u.id AND pay.status='PAID')
      + (SELECT coalesce(sum(coalesce(i.paid_amount_cents,i.amount_cents)),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.user_id=u.id AND i.status='PAID') AS paid_cents,
    (SELECT coalesce(sum(i.amount_cents),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.user_id=u.id AND c.status='OPEN' AND i.status='PENDING') AS open_cents,
    (SELECT coalesce(sum(i.amount_cents),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.user_id=u.id AND c.status='OPEN' AND i.status='PENDING' AND i.due_date < current_date) AS overdue_cents
  FROM users u
  LEFT JOIN user_profiles p ON p.user_id=u.id
  LEFT JOIN wallets w ON w.user_id=u.id
  LEFT JOIN LATERAL (SELECT o.id,o.name FROM organization_members m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=u.id ORDER BY m.role='OWNER' DESC LIMIT 1) org ON true`;

function presentCustomer(r: Record<string, unknown>, full: boolean) {
  const doc = typeof r.cpf_cnpj === 'string' ? r.cpf_cnpj : null;
  return {
    id: r.id, name: r.name, email: r.email, active: Boolean(r.active), archived: Boolean(r.archived_at), archivedAt: r.archived_at ?? null,
    createdAt: r.created_at, lastLoginAt: r.last_login_at ?? null, portalAccess: Boolean(r.password_enabled),
    type: r.customer_type ?? 'PARTICULAR', segment: r.segment ?? null,
    cpfCnpj: full ? formatDocument(doc) : maskDocument(doc), documentKind: documentKind(doc),
    phone: r.phone ?? null, companyName: r.company_name ?? null, legalName: r.legal_name ?? null,
    stateRegistration: r.state_registration ?? null, municipalRegistration: r.municipal_registration ?? null, billingEmail: r.billing_email ?? null,
    zip: r.zip ?? null, street: r.street ?? null, streetNumber: r.street_number ?? null, complement: r.complement ?? null, district: r.district ?? null, city: r.city ?? null, state: r.state ? String(r.state).trim() : null,
    notes: r.notes ?? null,
    organization: r.org_id ? { id: r.org_id, name: r.org_name } : null,
    balanceCents: Number(r.balance_cents ?? 0), queriesCount: Number(r.queries_count ?? 0), lastQueryAt: r.last_query_at ?? null,
    paidCents: Number(r.paid_cents ?? 0), openCents: Number(r.open_cents ?? 0), overdueCents: Number(r.overdue_cents ?? 0),
    fiscalReady: Boolean(doc && documentKind(doc) && r.street && r.city && r.state && r.zip)
  };
}

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  type: z.enum(CUSTOMER_TYPES).optional(),
  segment: z.string().trim().max(60).optional(),
  organizationId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'archived', 'all']).default('active'),
  billing: z.enum(['overdue', 'open', 'clear']).optional(),
  sort: z.enum(['recent', 'name', 'spent', 'queries']).default('recent'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

function customerFilters(q: z.infer<typeof listQuery>) {
  const where = ['u.deleted_at IS NULL', `u.role='CLIENTE'`]; const values: unknown[] = [];
  const push = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (q.status === 'active') where.push('u.active=true AND p.archived_at IS NULL');
  else if (q.status === 'inactive') where.push('u.active=false AND p.archived_at IS NULL');
  else if (q.status === 'archived') where.push('p.archived_at IS NOT NULL');
  if (q.type) where.push(`coalesce(p.customer_type,'PARTICULAR')=${push(q.type)}`);
  if (q.segment) where.push(`p.segment=${push(q.segment)}`);
  if (q.organizationId) where.push(`EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id=u.id AND m.organization_id=${push(q.organizationId)})`);
  if (q.search) {
    const like = `%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const digits = onlyDigits(q.search);
    const l = push(like);
    const d = digits.length >= 3 ? push(`%${digits}%`) : null;
    where.push(`(u.name ILIKE ${l} OR u.email ILIKE ${l} OR p.company_name ILIKE ${l} OR p.legal_name ILIKE ${l}${d ? ` OR p.cpf_cnpj LIKE ${d} OR p.phone LIKE ${d}` : ''})`);
  }
  const base = where.join(' AND ');
  const having: string[] = [];
  if (q.billing === 'overdue') having.push('x.overdue_cents > 0');
  if (q.billing === 'open') having.push('x.open_cents > 0');
  if (q.billing === 'clear') having.push('x.open_cents = 0');
  return { base, values, having };
}

adminPeopleRouter.get('/customers', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) throw bad();
  const q = parsed.data;
  const { base, values, having } = customerFilters(q);
  const order = { recent: 'x.created_at DESC', name: 'lower(x.name) ASC', spent: 'x.paid_cents DESC, x.created_at DESC', queries: 'x.queries_count DESC, x.created_at DESC' }[q.sort];
  const wrapped = `SELECT * FROM (${CUSTOMER_SELECT} WHERE ${base}) x ${having.length ? `WHERE ${having.join(' AND ')}` : ''}`;
  const [rows, total, summary] = await Promise.all([
    pool.query(`${wrapped} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${q.offset}`, values),
    pool.query(`SELECT count(*)::int AS n FROM (${wrapped}) t`, values),
    pool.query(`SELECT x.customer_type AS type, count(*)::int AS n FROM (${CUSTOMER_SELECT} WHERE u.deleted_at IS NULL AND u.role='CLIENTE' AND u.active=true AND p.archived_at IS NULL) x GROUP BY x.customer_type`)
  ]);
  const byType: Record<string, number> = { PARTICULAR: 0, AUTONOMO: 0, EMPRESA: 0 };
  for (const r of summary.rows) byType[String(r.type ?? 'PARTICULAR')] = Number(r.n);
  res.json({ items: rows.rows.map((r) => presentCustomer(r, false)), total: Number(total.rows[0].n), byType });
}));

adminPeopleRouter.get('/customers/segments', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (_req, res) => {
  const rows = await pool.query(`SELECT segment, count(*)::int AS n FROM user_profiles WHERE segment IS NOT NULL AND archived_at IS NULL GROUP BY segment ORDER BY n DESC, segment LIMIT 40`);
  res.json({ items: rows.rows.map((r) => ({ segment: r.segment, count: Number(r.n) })) });
}));

adminPeopleRouter.get('/customers/export.csv', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = listQuery.safeParse({ ...req.query, limit: 500, offset: 0 });
  if (!parsed.success) throw bad();
  const { base, values, having } = customerFilters(parsed.data);
  const rows = await pool.query(`SELECT * FROM (${CUSTOMER_SELECT} WHERE ${base}) x ${having.length ? `WHERE ${having.join(' AND ')}` : ''} ORDER BY lower(x.name) LIMIT 5000`, values);
  const TYPE = { PARTICULAR: 'Particular', AUTONOMO: 'Autônomo', EMPRESA: 'Empresa' } as Record<string, string>;
  const csv = toCsv(
    ['Nome', 'E-mail', 'Tipo', 'Segmento', 'CPF/CNPJ', 'Telefone', 'Empresa', 'Cidade', 'UF', 'Consultas', 'Total pago (R$)', 'Em aberto (R$)', 'Em atraso (R$)', 'Cadastro'],
    rows.rows.map((r) => [r.name, r.email, TYPE[String(r.customer_type ?? 'PARTICULAR')], r.segment, formatDocument(r.cpf_cnpj), r.phone, r.org_name ?? r.company_name, r.city, r.state ? String(r.state).trim() : '',
      r.queries_count, (Number(r.paid_cents) / 100).toFixed(2).replace('.', ','), (Number(r.open_cents) / 100).toFixed(2).replace('.', ','), (Number(r.overdue_cents) / 100).toFixed(2).replace('.', ','), new Date(r.created_at as string).toISOString().slice(0, 10)])
  );
  await audit(req.user!.id, 'CUSTOMERS_EXPORTED', 'USER', null, { rows: rows.rowCount, requestId: requestId(req) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clientes.csv"');
  res.send(csv);
}));

async function assertOrganization(id: string | null): Promise<void> {
  if (!id) return;
  const org = await pool.query('SELECT 1 FROM organizations WHERE id=$1 AND archived_at IS NULL', [id]);
  if (!org.rowCount) throw bad('ORGANIZATION_NOT_FOUND');
}

adminPeopleRouter.post('/customers', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = customerCreateSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const v = parsed.data;
  await assertOrganization(v.organizationId);
  const portal = v.portalAccess;
  // Senha aleatória que ninguém conhece: com acesso ao portal, o cliente define a dele pelo link enviado por e-mail.
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 12);
  try {
    const id = await tx(async (client) => {
      const user = await client.query(`INSERT INTO users(email,password_hash,name,role,password_enabled) VALUES($1,$2,$3,'CLIENTE',$4) RETURNING id`, [v.email, hash, v.name, portal]);
      const userId = String(user.rows[0].id);
      await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [userId]);
      await client.query(`INSERT INTO user_profiles(user_id,customer_type,segment,cpf_cnpj,phone,company_name,legal_name,state_registration,municipal_registration,billing_email,zip,street,street_number,complement,district,city,state,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [userId, v.type, v.segment, v.cpfCnpj, v.phone, v.companyName, v.legalName, v.stateRegistration, v.municipalRegistration, v.billingEmail, v.zip, v.street, v.streetNumber, v.complement, v.district, v.city, v.state, v.notes, req.user!.id]);
      if (v.organizationId) await client.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'MEMBER')`, [v.organizationId, userId]);
      return userId;
    });
    await audit(req.user!.id, 'CUSTOMER_CREATED', 'USER', id, { type: v.type, portalAccess: portal, requestId: requestId(req) });
    const row = await pool.query(`${CUSTOMER_SELECT} WHERE u.id=$1`, [id]);
    const inviteSent = portal ? await sendResetLink({ id, email: v.email, name: v.name }, INVITE_TTL_MINUTES).catch(() => false) : false;
    res.status(201).json({ customer: presentCustomer(row.rows[0], true), inviteSent });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') throw conflict('EMAIL_ALREADY_EXISTS');
    throw error;
  }
}));

async function customerOr404(id: string): Promise<void> {
  if (!isUuid(id)) throw notFound('CUSTOMER_NOT_FOUND');
  const row = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role='CLIENTE' AND deleted_at IS NULL`, [id]);
  if (!row.rowCount) throw notFound('CUSTOMER_NOT_FOUND');
}

adminPeopleRouter.get('/customers/:id', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const full = hasPermission(req.user!.role, 'MANAGE_CUSTOMERS') || hasPermission(req.user!.role, 'MANAGE_FISCAL');
  const [row, queries, payments, charges, docs] = await Promise.all([
    pool.query(`${CUSTOMER_SELECT} WHERE u.id=$1`, [id]),
    pool.query(`SELECT q.id,q.plate,q.status,q.price_cents,q.created_at,p.name AS product_name FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id WHERE q.user_id=$1 ORDER BY q.created_at DESC LIMIT 10`, [id]),
    pool.query(`SELECT id,status,amount_cents,provider,created_at,paid_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [id]),
    pool.query(`SELECT c.id,c.description,c.total_cents,c.status,c.created_at,
        coalesce((SELECT sum(coalesce(i.paid_amount_cents,i.amount_cents)) FROM charge_installments i WHERE i.charge_id=c.id AND i.status='PAID'),0)::bigint AS paid_cents,
        (SELECT min(i.due_date) FROM charge_installments i WHERE i.charge_id=c.id AND i.status='PENDING') AS next_due
      FROM charges c WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 10`, [id]),
    hasPermission(req.user!.role, 'MANAGE_FISCAL')
      ? pool.query(`SELECT id,kind,status,amount_cents,number,issued_at,created_at FROM fiscal_documents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [id])
      : Promise.resolve({ rows: [] })
  ]);
  res.json({
    customer: presentCustomer(row.rows[0], full),
    queries: queries.rows.map((q) => ({ id: q.id, plate: q.plate, status: q.status, priceCents: Number(q.price_cents ?? 0), createdAt: q.created_at, productName: q.product_name })),
    payments: payments.rows.map((p) => ({ id: p.id, status: p.status, amountCents: Number(p.amount_cents), provider: p.provider, createdAt: p.created_at, paidAt: p.paid_at })),
    charges: charges.rows.map((c) => ({ id: c.id, description: c.description, totalCents: Number(c.total_cents), status: c.status, createdAt: c.created_at, paidCents: Number(c.paid_cents), nextDue: c.next_due })),
    fiscalDocuments: docs.rows.map((d) => ({ id: d.id, kind: d.kind, status: d.status, amountCents: Number(d.amount_cents), number: d.number ?? null, issuedAt: d.issued_at ?? null, createdAt: d.created_at }))
  });
}));

adminPeopleRouter.patch('/customers/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const parsed = customerUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data as Record<string, unknown>;
  if (v.organizationId) await assertOrganization(String(v.organizationId));
  try {
    await tx(async (client) => {
      const userSets: string[] = []; const userValues: unknown[] = [];
      if (v.name !== undefined) { userValues.push(v.name); userSets.push(`name=$${userValues.length}`); }
      if (v.email !== undefined) { userValues.push(v.email); userSets.push(`email=$${userValues.length}`); }
      if (userSets.length) { userValues.push(id); await client.query(`UPDATE users SET ${userSets.join(',')} WHERE id=$${userValues.length}`, userValues); }
      const sets: string[] = ['updated_at=now()']; const values: unknown[] = [id];
      for (const [key, column] of Object.entries(CUSTOMER_COLS)) if (key in v) { values.push(v[key]); sets.push(`${column}=$${values.length}`); }
      await client.query(`INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [id]);
      await client.query(`UPDATE user_profiles SET ${sets.join(',')} WHERE user_id=$1`, values);
      if ('organizationId' in v) {
        await client.query('DELETE FROM organization_members WHERE user_id=$1', [id]);
        if (v.organizationId) await client.query(`INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'MEMBER')`, [v.organizationId, id]);
      }
    });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') throw conflict('EMAIL_ALREADY_EXISTS');
    throw error;
  }
  await audit(req.user!.id, 'CUSTOMER_UPDATED', 'USER', id, { fields: Object.keys(v), requestId: requestId(req) });
  const row = await pool.query(`${CUSTOMER_SELECT} WHERE u.id=$1`, [id]);
  res.json({ customer: presentCustomer(row.rows[0], true) });
}));

adminPeopleRouter.post('/customers/:id/block', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const active = req.body?.active === true;
  await pool.query('UPDATE users SET active=$2 WHERE id=$1', [id, active]);
  if (!active) await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
  await audit(req.user!.id, active ? 'CUSTOMER_UNBLOCKED' : 'CUSTOMER_BLOCKED', 'USER', id, { requestId: requestId(req) });
  res.json({ ok: true, active });
}));

adminPeopleRouter.post('/customers/:id/archive', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const archive = req.body?.archived !== false;
  await tx(async (client) => {
    await client.query(`INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`, [id]);
    await client.query(`UPDATE user_profiles SET archived_at=${archive ? 'now()' : 'NULL'},updated_at=now() WHERE user_id=$1`, [id]);
    await client.query('UPDATE users SET active=$2 WHERE id=$1', [id, !archive]);
    if (archive) await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
  });
  await audit(req.user!.id, archive ? 'CUSTOMER_ARCHIVED' : 'CUSTOMER_RESTORED', 'USER', id, { requestId: requestId(req) });
  res.json({ ok: true, archived: archive });
}));

adminPeopleRouter.post('/customers/:id/reset-password', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const who = await pool.query('SELECT email,name FROM users WHERE id=$1', [id]);
  if (!(await sendResetLink({ id, email: String(who.rows[0].email), name: String(who.rows[0].name) }))) throw appError('EMAIL_SEND_FAILED', { code: 'EMAIL_SEND_FAILED', http: 502, expose: true });
  await audit(req.user!.id, 'CUSTOMER_PASSWORD_RESET_LINK_SENT', 'USER', id, { requestId: requestId(req) });
  res.json({ sent: true });
}));

adminPeopleRouter.delete('/customers/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await customerOr404(id);
  const open = await pool.query(`SELECT count(*)::int AS n FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.user_id=$1 AND c.status='OPEN' AND i.status='PENDING'`, [id]);
  if (Number(open.rows[0].n) > 0) throw conflict('CUSTOMER_HAS_OPEN_CHARGES');
  const wallet = await pool.query('SELECT balance_cents FROM wallets WHERE user_id=$1', [id]);
  if (Number(wallet.rows[0]?.balance_cents ?? 0) > 0 && req.query.force !== 'true') throw conflict('CUSTOMER_HAS_BALANCE');
  await tx(async (client) => {
    await client.query(`UPDATE users SET active=false,deleted_at=now(),email=email || '.removido.' || substr(id::text,1,8) WHERE id=$1`, [id]);
    await client.query('UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [id]);
    await client.query('DELETE FROM organization_members WHERE user_id=$1', [id]);
  });
  await audit(req.user!.id, 'CUSTOMER_REMOVED', 'USER', id, { requestId: requestId(req) });
  res.status(204).end();
}));

// ------------------------------------------------------------------ empresas

const COMPANY_KINDS = ['EMPRESA', 'AGENCIA', 'REVENDA', 'LOJA', 'DESPACHANTE', 'OUTRO'] as const;
const companySchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(COMPANY_KINDS),
  segment: optionalText(60),
  document: z.string().trim().max(30).nullish().transform((v) => (v ? onlyDigits(v) : null)).refine((v) => v === null || documentKind(v) === 'CNPJ', 'INVALID_CNPJ'),
  legalName: optionalText(160), contactName: optionalText(120),
  email: z.string().trim().toLowerCase().email().max(254).nullish().transform((v) => v ?? null),
  phone: optionalText(30), stateRegistration: optionalText(30), municipalRegistration: optionalText(30),
  zip: z.string().trim().max(12).nullish().transform((v) => (v ? onlyDigits(v) || null : null)),
  street: optionalText(160), streetNumber: optionalText(20), complement: optionalText(80), district: optionalText(80), city: optionalText(80), state: stateField,
  notes: optionalText(1000)
}).strict();
const companyUpdateSchema = companySchema.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');
const COMPANY_COLS: Record<string, string> = {
  name: 'name', kind: 'kind', segment: 'segment', document: 'document', legalName: 'legal_name', contactName: 'contact_name', email: 'email', phone: 'phone',
  stateRegistration: 'state_registration', municipalRegistration: 'municipal_registration', zip: 'zip', street: 'street', streetNumber: 'street_number',
  complement: 'complement', district: 'district', city: 'city', state: 'state', notes: 'notes'
};
const COMPANY_SELECT = `SELECT o.*,
    (SELECT count(*)::int FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=o.id AND u.deleted_at IS NULL) AS members_count,
    (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=o.id)) AS queries_count,
    (SELECT coalesce(sum(pay.amount_cents),0)::bigint FROM payments pay WHERE pay.status='PAID' AND pay.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=o.id))
      + (SELECT coalesce(sum(coalesce(i.paid_amount_cents,i.amount_cents)),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE i.status='PAID' AND (c.organization_id=o.id OR c.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=o.id))) AS paid_cents,
    (SELECT coalesce(sum(i.amount_cents),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.status='OPEN' AND i.status='PENDING' AND (c.organization_id=o.id OR c.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=o.id))) AS open_cents,
    (SELECT coalesce(sum(i.amount_cents),0)::bigint FROM charge_installments i JOIN charges c ON c.id=i.charge_id WHERE c.status='OPEN' AND i.status='PENDING' AND i.due_date < current_date AND (c.organization_id=o.id OR c.user_id IN (SELECT user_id FROM organization_members WHERE organization_id=o.id))) AS overdue_cents
  FROM organizations o`;
function presentCompany(r: Record<string, unknown>, full: boolean) {
  const doc = typeof r.document === 'string' ? r.document : null;
  return {
    id: r.id, name: r.name, kind: r.kind ?? 'EMPRESA', segment: r.segment ?? null, document: full ? formatDocument(doc) : maskDocument(doc), legalName: r.legal_name ?? null,
    contactName: r.contact_name ?? null, email: r.email ?? null, phone: r.phone ?? null, stateRegistration: r.state_registration ?? null, municipalRegistration: r.municipal_registration ?? null,
    zip: r.zip ?? null, street: r.street ?? null, streetNumber: r.street_number ?? null, complement: r.complement ?? null, district: r.district ?? null, city: r.city ?? null,
    state: r.state ? String(r.state).trim() : null, notes: r.notes ?? null, active: Boolean(r.active), archived: Boolean(r.archived_at), createdAt: r.created_at,
    membersCount: Number(r.members_count ?? 0), queriesCount: Number(r.queries_count ?? 0), paidCents: Number(r.paid_cents ?? 0), openCents: Number(r.open_cents ?? 0), overdueCents: Number(r.overdue_cents ?? 0)
  };
}

adminPeopleRouter.get('/companies', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const status = z.enum(['active', 'archived', 'all']).catch('active').parse(req.query.status);
  const kind = z.enum(COMPANY_KINDS).safeParse(req.query.kind);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 80) : '';
  const where: string[] = []; const values: unknown[] = [];
  if (status === 'active') where.push('o.archived_at IS NULL'); else if (status === 'archived') where.push('o.archived_at IS NOT NULL');
  if (kind.success) { values.push(kind.data); where.push(`o.kind=$${values.length}`); }
  if (search) {
    values.push(`%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const digits = onlyDigits(search);
    where.push(`(o.name ILIKE $${values.length} OR o.legal_name ILIKE $${values.length} OR o.email ILIKE $${values.length}${digits.length >= 3 ? ` OR o.document LIKE '%${digits}%'` : ''})`);
  }
  const rows = await pool.query(`${COMPANY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.archived_at IS NOT NULL, lower(o.name) LIMIT 300`, values);
  res.json({ items: rows.rows.map((r) => presentCompany(r, false)) });
}));

adminPeopleRouter.post('/companies', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data as Record<string, unknown>;
  const keys = Object.keys(COMPANY_COLS).filter((k) => k in v);
  const row = await pool.query(`INSERT INTO organizations(${keys.map((k) => COMPANY_COLS[k]).join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, keys.map((k) => v[k]));
  await audit(req.user!.id, 'COMPANY_CREATED', 'ORGANIZATION', String(row.rows[0].id), { kind: v.kind, requestId: requestId(req) });
  const out = await pool.query(`${COMPANY_SELECT} WHERE o.id=$1`, [row.rows[0].id]);
  res.status(201).json({ company: presentCompany(out.rows[0], true) });
}));

async function companyOr404(id: string): Promise<void> {
  if (!isUuid(id)) throw notFound('COMPANY_NOT_FOUND');
  const row = await pool.query('SELECT 1 FROM organizations WHERE id=$1', [id]);
  if (!row.rowCount) throw notFound('COMPANY_NOT_FOUND');
}

adminPeopleRouter.get('/companies/:id', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  const full = hasPermission(req.user!.role, 'MANAGE_CUSTOMERS') || hasPermission(req.user!.role, 'MANAGE_FISCAL');
  const [row, members] = await Promise.all([
    pool.query(`${COMPANY_SELECT} WHERE o.id=$1`, [id]),
    pool.query(`SELECT u.id,u.name,u.email,u.active,m.role AS member_role,p.customer_type,
        (SELECT count(*)::int FROM vehicle_queries q WHERE q.user_id=u.id) AS queries_count
      FROM organization_members m JOIN users u ON u.id=m.user_id LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE m.organization_id=$1 AND u.deleted_at IS NULL ORDER BY m.role='OWNER' DESC, lower(u.name)`, [id])
  ]);
  res.json({
    company: presentCompany(row.rows[0], full),
    members: members.rows.map((m) => ({ id: m.id, name: m.name, email: m.email, active: Boolean(m.active), memberRole: m.member_role, type: m.customer_type ?? 'PARTICULAR', queriesCount: Number(m.queries_count) }))
  });
}));

adminPeopleRouter.patch('/companies/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  const parsed = companyUpdateSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data as Record<string, unknown>;
  const keys = Object.keys(COMPANY_COLS).filter((k) => k in v);
  await pool.query(`UPDATE organizations SET ${keys.map((k, i) => `${COMPANY_COLS[k]}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...keys.map((k) => v[k])]);
  await audit(req.user!.id, 'COMPANY_UPDATED', 'ORGANIZATION', id, { fields: keys, requestId: requestId(req) });
  const out = await pool.query(`${COMPANY_SELECT} WHERE o.id=$1`, [id]);
  res.json({ company: presentCompany(out.rows[0], true) });
}));

adminPeopleRouter.post('/companies/:id/archive', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  const archive = req.body?.archived !== false;
  await pool.query(`UPDATE organizations SET archived_at=${archive ? 'now()' : 'NULL'},active=$2 WHERE id=$1`, [id, !archive]);
  await audit(req.user!.id, archive ? 'COMPANY_ARCHIVED' : 'COMPANY_RESTORED', 'ORGANIZATION', id, { requestId: requestId(req) });
  res.json({ ok: true, archived: archive });
}));

adminPeopleRouter.delete('/companies/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  const used = await pool.query(`SELECT
      (SELECT count(*)::int FROM organization_members WHERE organization_id=$1) AS members,
      (SELECT count(*)::int FROM charges WHERE organization_id=$1) AS charges,
      (SELECT count(*)::int FROM fiscal_documents WHERE organization_id=$1) AS docs`, [id]);
  const u = used.rows[0];
  if (Number(u.members) + Number(u.charges) + Number(u.docs) > 0) throw conflict('COMPANY_IN_USE');
  await pool.query('DELETE FROM organizations WHERE id=$1', [id]);
  await audit(req.user!.id, 'COMPANY_REMOVED', 'ORGANIZATION', id, { requestId: requestId(req) });
  res.status(204).end();
}));

adminPeopleRouter.post('/companies/:id/members', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  const parsed = z.object({ userId: z.string().uuid(), role: z.enum(['OWNER', 'MEMBER']).default('MEMBER') }).strict().safeParse(req.body);
  if (!parsed.success) throw bad();
  await customerOr404(parsed.data.userId);
  await tx(async (client) => {
    await client.query('DELETE FROM organization_members WHERE user_id=$1', [parsed.data.userId]);
    await client.query('INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3)', [id, parsed.data.userId, parsed.data.role]);
  });
  await audit(req.user!.id, 'COMPANY_MEMBER_ADDED', 'ORGANIZATION', id, { userId: parsed.data.userId, requestId: requestId(req) });
  res.status(201).json({ ok: true });
}));

adminPeopleRouter.delete('/companies/:id/members/:userId', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  await companyOr404(id);
  if (!isUuid(req.params.userId)) throw notFound('CUSTOMER_NOT_FOUND');
  await pool.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2', [id, req.params.userId]);
  await audit(req.user!.id, 'COMPANY_MEMBER_REMOVED', 'ORGANIZATION', id, { userId: req.params.userId, requestId: requestId(req) });
  res.status(204).end();
}));
