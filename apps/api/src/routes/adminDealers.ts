import { Router } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool, tx } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { createDealership } from '../dealer/create.js';
import { emailZ, phoneZ } from '../dealer/context.js';

/** Lojas (concessionárias, agências, vendedores): lista, limites de veículos/equipe e suspensão. */
export const adminDealersRouter = Router();
adminDealersRouter.use(adminAuth);
const idParam = z.string().uuid();
const bad = (code = 'INVALID_INPUT') => appError('Confira os dados informados.', { code, http: 400, expose: true });

adminDealersRouter.get('/dealerships', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const values: unknown[] = [];
  let where = 'TRUE';
  if (q) { values.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where = `(d.name ILIKE $1 OR d.slug ILIKE $1 OR u.email ILIKE $1)`; }
  const r = await pool.query(`SELECT d.id,d.name,d.slug,d.city,d.state,d.active,d.archived_at,d.public_enabled,d.vehicle_limit,d.member_limit,d.created_at,u.name AS owner_name,u.email AS owner_email,
      (SELECT count(*)::int FROM stock_vehicles v WHERE v.dealership_id=d.id AND v.status IN ('AVAILABLE','RESERVED')) AS vehicles,
      (SELECT count(*)::int FROM dealership_members m WHERE m.dealership_id=d.id AND m.active) AS members,
      (SELECT count(*)::int FROM dealer_leads l WHERE l.dealership_id=d.id) AS leads
    FROM dealerships d JOIN users u ON u.id=d.owner_user_id WHERE ${where} ORDER BY d.created_at DESC LIMIT 200`, values);
  res.json(r.rows.map((x) => ({
    id: x.id, name: x.name, slug: x.slug, city: x.city, state: x.state, active: x.active, archived: Boolean(x.archived_at), publicEnabled: x.public_enabled, vehicleLimit: x.vehicle_limit, memberLimit: x.member_limit,
    vehicles: x.vehicles, members: x.members, leads: x.leads, ownerName: x.owner_name, ownerEmail: x.owner_email, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at
  })));
}));

const httpsUrl = z.string().trim().max(500).url().refine((u) => /^https:\/\//i.test(u));
const patchBody = z.object({
  active: z.boolean(),
  archived: z.boolean(),
  vehicleLimit: z.number().int().min(1).max(10_000),
  memberLimit: z.number().int().min(1).max(200),
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(40),
  whatsapp: phoneZ.nullable(),
  email: emailZ.nullable(),
  city: z.string().trim().max(80).nullable(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  about: z.string().trim().max(1000),
  publicEnabled: z.boolean(),
  logoUrl: httpsUrl.nullable(),
  coverUrl: httpsUrl.nullable(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  instagram: z.string().trim().transform((v) => v.replace(/^@/, '')).pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/)).nullable(),
  address: z.string().trim().max(160).nullable(),
  hours: z.string().trim().max(120).nullable(),
  tradeInDiscountBps: z.number().int().min(0).max(5000),
  staleDays: z.number().int().min(7).max(720)
}).partial().strict();

const COLS: Record<string, string> = { active: 'active', vehicleLimit: 'vehicle_limit', memberLimit: 'member_limit', name: 'name', slug: 'slug', whatsapp: 'whatsapp', email: 'email', city: 'city', state: 'state', about: 'about', publicEnabled: 'public_enabled', logoUrl: 'logo_url', coverUrl: 'cover_url', accentColor: 'accent_color', instagram: 'instagram', address: 'address', hours: 'hours', tradeInDiscountBps: 'trade_in_discount_bps', staleDays: 'stale_days' };

adminDealersRouter.get('/dealerships/:id', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) throw bad();
  const r = await pool.query(`SELECT d.*,u.name AS owner_name,u.email AS owner_email FROM dealerships d JOIN users u ON u.id=d.owner_user_id WHERE d.id=$1`, [id.data]);
  if (!r.rowCount) throw appError('Loja não encontrada.', { code: 'DEALER_NOT_FOUND', http: 404, expose: true });
  const x = r.rows[0] as Record<string, unknown>;
  res.json({ id: x.id, name: x.name, slug: x.slug, whatsapp: x.whatsapp, email: x.email, city: x.city, state: x.state, about: x.about, publicEnabled: x.public_enabled, active: x.active, archived: Boolean(x.archived_at),
    vehicleLimit: x.vehicle_limit, memberLimit: x.member_limit, logoUrl: x.logo_url, coverUrl: x.cover_url, accentColor: x.accent_color, instagram: x.instagram, address: x.address, hours: x.hours,
    tradeInDiscountBps: x.trade_in_discount_bps, staleDays: x.stale_days, ownerName: x.owner_name, ownerEmail: x.owner_email });
}));

adminDealersRouter.patch('/dealerships/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = patchBody.safeParse(req.body);
  if (!id.success || !body.success || !Object.keys(body.data).length) throw bad();
  const { archived, ...b } = body.data;
  const sets: string[] = []; const values: unknown[] = [];
  for (const [k, v] of Object.entries(b)) { values.push(v); sets.push(`${COLS[k]}=$${values.length}`); }
  if (archived !== undefined) sets.push(archived ? 'archived_at=COALESCE(archived_at,now())' : 'archived_at=NULL');
  values.push(id.data);
  try {
    const r = await pool.query(`UPDATE dealerships SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING id,active,vehicle_limit,member_limit,archived_at`, values);
    if (!r.rowCount) throw appError('Loja não encontrada.', { code: 'DEALER_NOT_FOUND', http: 404, expose: true });
    await audit(req.user!.id, 'ADMIN_DEALER_UPDATED', 'DEALERSHIP', id.data, { fields: body.data, requestId: requestId(req) });
    res.json({ id: r.rows[0].id, active: r.rows[0].active, vehicleLimit: r.rows[0].vehicle_limit, memberLimit: r.rows[0].member_limit, archived: Boolean(r.rows[0].archived_at) });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw appError('Este endereço já está em uso.', { code: 'DEALER_SLUG_TAKEN', http: 409, expose: true });
    throw e;
  }
}));

/** Passa a titularidade da loja (o dono é quem responde pelo contrato). O dono anterior fica como gerente. */
adminDealersRouter.post('/dealerships/:id/transfer', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z.object({ ownerEmail: emailZ }).strict().safeParse(req.body);
  if (!id.success || !body.success) throw bad();
  await tx(async (client) => {
    const d = await client.query('SELECT owner_user_id FROM dealerships WHERE id=$1 FOR UPDATE', [id.data]);
    if (!d.rowCount) throw appError('Loja não encontrada.', { code: 'DEALER_NOT_FOUND', http: 404, expose: true });
    const u = await client.query(`SELECT id FROM users WHERE lower(email)=$1 AND role='CLIENTE' AND active=true AND deleted_at IS NULL`, [body.data.ownerEmail]);
    if (!u.rowCount) throw appError('Não há conta de cliente ativa com este e-mail.', { code: 'DEALER_OWNER_NOT_FOUND', http: 404, expose: true });
    const target = String(u.rows[0].id); const previous = String(d.rows[0].owner_user_id);
    if (target === previous) throw appError('Esta pessoa já é a dona.', { code: 'DEALER_SAME_OWNER', http: 409, expose: true });
    const other = await client.query('SELECT dealership_id FROM dealership_members WHERE user_id=$1 AND active AND dealership_id<>$2', [target, id.data]);
    const owned = await client.query('SELECT 1 FROM dealerships WHERE owner_user_id=$1', [target]);
    if (other.rowCount || owned.rowCount) throw appError('Esta pessoa já participa de outra loja.', { code: 'DEALER_ALREADY_MEMBER', http: 409, expose: true });
    await client.query(`UPDATE dealership_members SET role='MANAGER',updated_at=now() WHERE dealership_id=$1 AND user_id=$2`, [id.data, previous]);
    await client.query(`INSERT INTO dealership_members(dealership_id,user_id,role,active) VALUES($1,$2,'OWNER',true) ON CONFLICT(dealership_id,user_id) DO UPDATE SET role='OWNER',active=true,updated_at=now()`, [id.data, target]);
    await client.query('UPDATE dealerships SET owner_user_id=$2,updated_at=now() WHERE id=$1', [id.data, target]);
    await audit(req.user!.id, 'ADMIN_DEALER_TRANSFERRED', 'DEALERSHIP', id.data, { from: previous, to: target, requestId: requestId(req) });
  });
  res.json({ ok: true });
}));

/** Exclusão definitiva (LGPD/encerramento de contrato): confirma pelo endereço e apaga tudo da loja. */
adminDealersRouter.delete('/dealerships/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z.object({ confirm: z.string() }).strict().safeParse(req.body);
  if (!id.success || !body.success) throw bad();
  const d = await pool.query('SELECT slug FROM dealerships WHERE id=$1', [id.data]);
  if (!d.rowCount) throw appError('Loja não encontrada.', { code: 'DEALER_NOT_FOUND', http: 404, expose: true });
  if (body.data.confirm.trim().toLowerCase() !== d.rows[0].slug) throw appError('Digite o endereço da loja para confirmar.', { code: 'DEALER_CONFIRM_MISMATCH', http: 400, expose: true });
  await pool.query('DELETE FROM dealerships WHERE id=$1', [id.data]);
  await audit(req.user!.id, 'ADMIN_DEALER_DELETED', 'DEALERSHIP', id.data, { slug: d.rows[0].slug, requestId: requestId(req) });
  res.json({ ok: true });
}));

const createBody = z.object({
  ownerEmail: emailZ,
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(40).optional(),
  whatsapp: phoneZ.nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish(),
  publicEnabled: z.boolean().default(false)
}).strict();

/** Cria a loja de um cliente já cadastrado (conta ativa). O cliente passa a ser o dono e edita o resto em Minha loja. */
adminDealersRouter.post('/dealerships', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) throw bad();
  const u = await pool.query(`SELECT id FROM users WHERE lower(email)=$1 AND role='CLIENTE' AND active=true AND deleted_at IS NULL`, [body.data.ownerEmail]);
  if (!u.rowCount) throw appError('Não há conta de cliente ativa com este e-mail. A pessoa precisa criar a conta antes.', { code: 'DEALER_OWNER_NOT_FOUND', http: 404, expose: true });
  const { ownerEmail: _o, publicEnabled, ...input } = body.data;
  const store = await createDealership(String(u.rows[0].id), input);
  if (publicEnabled) await pool.query('UPDATE dealerships SET public_enabled=true WHERE id=$1', [store.id]);
  await audit(req.user!.id, 'ADMIN_DEALER_CREATED', 'DEALERSHIP', store.id, { owner: u.rows[0].id, requestId: requestId(req) });
  res.status(201).json({ id: store.id, slug: store.slug });
}));
