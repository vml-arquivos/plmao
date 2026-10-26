import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool, tx } from '../db.js';
import { auth } from '../auth.js';
import { env } from '../config.js';
import { asyncRoute, audit, requestId } from '../lib/http.js';
import { createDealership } from '../dealer/create.js';
import { importCandidates, suggestForPlate } from '../dealer/vehicleHistory.js';
import {
  type DealerCtx, bad, can, centsZ, conflict, dayOut, dayZ, dealerAccess, emailZ, forbidden, iso, isUnique, loadMembership, notFound, phoneZ,
  plateZ, ROLE_RANK, slugify, storeFromRow, uuidParam
} from '../dealer/context.js';

/**
 * Loja: cadastro da loja, equipe com papéis (dono, gerente, vendedor) e estoque de veículos.
 * Tudo é filtrado pela loja do usuário logado, lida do banco a cada chamada; identificador de outra loja responde 404.
 * Valores em centavos inteiros. Custo e margem só aparecem para dono e gerente.
 */
export const dealerRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas ações em pouco tempo. Aguarde um instante.' } });
dealerRouter.use('/dealer', limiter, auth);

const dealer = (req: { dealer?: DealerCtx }) => req.dealer!;

// ---------------------------------------------------------------- loja

dealerRouter.get('/dealer/me', asyncRoute(async (req, res) => {
  const ctx = await loadMembership(req.user!.id);
  if (!ctx) { res.json({ store: null, role: null }); return; }
  res.json({ store: ctx.store, role: ctx.role, canManage: can.manage(ctx), canSeeCost: can.seeCost(ctx), suspended: !ctx.store.active, archived: Boolean(ctx.store.archivedAt) });
}));

const storeCreate = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(40).optional(),
  whatsapp: phoneZ.nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish()
}).strict();

dealerRouter.post('/dealer', asyncRoute(async (req, res) => {
  const parsed = storeCreate.safeParse(req.body);
  if (!parsed.success) throw bad('Confira o nome da loja e os dados informados.');
  const b = parsed.data;
  const store = await createDealership(req.user!.id, b);
  await audit(req.user!.id, 'DEALER_CREATED', 'DEALERSHIP', store.id, { requestId: requestId(req) });
  res.status(201).json({ store, role: 'OWNER' });
}));

const httpsUrl = z.string().trim().max(500).url().refine((u) => /^https:\/\//i.test(u), 'HTTPS_REQUIRED');
const storePatch = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(40),
  whatsapp: phoneZ.nullable(),
  email: emailZ.nullable(),
  city: z.string().trim().max(80).nullable(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  about: z.string().trim().max(1000),
  publicEnabled: z.boolean(),
  tradeInDiscountBps: z.number().int().min(0).max(5000),
  staleDays: z.number().int().min(7).max(720),
  logoUrl: httpsUrl.nullable(),
  coverUrl: httpsUrl.nullable(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  instagram: z.string().trim().transform((v) => v.replace(/^@/, '')).pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/)).nullable(),
  address: z.string().trim().max(160).nullable(),
  hours: z.string().trim().max(120).nullable()
}).partial().strict();

dealerRouter.patch('/dealer', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = storePatch.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) throw bad('Confira os dados da loja.');
  const b = parsed.data;
  if ((b.slug !== undefined || b.publicEnabled !== undefined) && ctx.role !== 'OWNER') throw forbidden('Só o dono altera o endereço e a publicação da vitrine.');
  const map: Record<string, string> = { name: 'name', slug: 'slug', whatsapp: 'whatsapp', email: 'email', city: 'city', state: 'state', about: 'about', publicEnabled: 'public_enabled', tradeInDiscountBps: 'trade_in_discount_bps', staleDays: 'stale_days', logoUrl: 'logo_url', coverUrl: 'cover_url', accentColor: 'accent_color', instagram: 'instagram', address: 'address', hours: 'hours' };
  const sets: string[] = []; const values: unknown[] = [];
  for (const [k, v] of Object.entries(b)) { values.push(v); sets.push(`${map[k]}=$${values.length}`); }
  values.push(ctx.store.id);
  try {
    const r = await pool.query(`UPDATE dealerships SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
    await audit(req.user!.id, 'DEALER_UPDATED', 'DEALERSHIP', ctx.store.id, { fields: Object.keys(b), requestId: requestId(req) });
    res.json({ store: storeFromRow(r.rows[0] as Record<string, unknown>) });
  } catch (e) { if (isUnique(e)) throw conflict('Este endereço já está em uso. Escolha outro.', 'DEALER_SLUG_TAKEN'); throw e; }
}));

// ---------------------------------------------------------------- equipe

dealerRouter.get('/dealer/members', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const r = await pool.query(`SELECT m.user_id,m.role,m.active,m.created_at,u.name,u.email FROM dealership_members m JOIN users u ON u.id=m.user_id WHERE m.dealership_id=$1 ORDER BY m.active DESC, CASE m.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, u.name`, [ctx.store.id]);
  const manage = can.manage(ctx);
  res.json({ limit: ctx.store.memberLimit, members: r.rows.map((m) => ({ userId: m.user_id, name: m.name, email: manage || m.user_id === ctx.userId ? m.email : null, role: m.role, active: m.active, since: iso(m.created_at) })) });
}));

const memberAdd = z.object({ email: emailZ, role: z.enum(['MANAGER', 'SELLER']) }).strict();
dealerRouter.post('/dealer/members', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = memberAdd.safeParse(req.body);
  if (!parsed.success) throw bad('Informe o e-mail da pessoa e o papel.');
  if (parsed.data.role === 'MANAGER' && ctx.role !== 'OWNER') throw forbidden('Só o dono adiciona gerentes.');
  const out = await tx(async (client) => {
    await client.query('SELECT 1 FROM dealerships WHERE id=$1 FOR UPDATE', [ctx.store.id]);
    const u = await client.query(`SELECT id,name,email,role FROM users WHERE lower(email)=$1 AND active=true AND deleted_at IS NULL`, [parsed.data.email]);
    if (!u.rowCount || u.rows[0].role !== 'CLIENTE') throw notFound('Não há conta ativa com este e-mail. A pessoa precisa criar a conta antes.', 'DEALER_USER_NOT_FOUND');
    const uid = String(u.rows[0].id);
    const other = await client.query('SELECT dealership_id FROM dealership_members WHERE user_id=$1 AND active', [uid]);
    if (other.rowCount) throw conflict(other.rows[0].dealership_id === ctx.store.id ? 'Esta pessoa já está na equipe.' : 'Esta pessoa já participa de outra loja.', 'DEALER_ALREADY_MEMBER');
    const count = await client.query('SELECT count(*)::int AS n FROM dealership_members WHERE dealership_id=$1 AND active', [ctx.store.id]);
    if (Number(count.rows[0].n) >= ctx.store.memberLimit) throw conflict(`O limite de ${ctx.store.memberLimit} pessoas na equipe foi atingido.`, 'DEALER_MEMBER_LIMIT');
    await client.query(`INSERT INTO dealership_members(dealership_id,user_id,role,active) VALUES($1,$2,$3,true) ON CONFLICT(dealership_id,user_id) DO UPDATE SET role=EXCLUDED.role,active=true,updated_at=now()`, [ctx.store.id, uid, parsed.data.role]);
    return { userId: uid, name: u.rows[0].name as string, email: u.rows[0].email as string, role: parsed.data.role };
  });
  await audit(req.user!.id, 'DEALER_MEMBER_ADDED', 'DEALERSHIP', ctx.store.id, { member: out.userId, role: out.role, requestId: requestId(req) });
  res.status(201).json({ member: out });
}));

const memberPatch = z.object({ role: z.enum(['MANAGER', 'SELLER']).optional(), active: z.boolean().optional() }).strict();
dealerRouter.patch('/dealer/members/:userId', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const target = uuidParam(req.params.userId);
  const parsed = memberPatch.safeParse(req.body);
  if (!parsed.success || (parsed.data.role === undefined && parsed.data.active === undefined)) throw bad('Nada para alterar.');
  const out = await tx(async (client) => {
    await client.query('SELECT 1 FROM dealerships WHERE id=$1 FOR UPDATE', [ctx.store.id]);
    const m = await client.query('SELECT role,active FROM dealership_members WHERE dealership_id=$1 AND user_id=$2 FOR UPDATE', [ctx.store.id, target]);
    if (!m.rowCount) throw notFound('Pessoa não encontrada na equipe.');
    const cur = m.rows[0] as { role: 'OWNER' | 'MANAGER' | 'SELLER'; active: boolean };
    if (cur.role === 'OWNER') throw forbidden('O dono da loja não pode ser alterado.');
    if (target === ctx.userId) throw forbidden('Você não pode alterar a si mesmo.');
    if (ROLE_RANK[cur.role] >= ROLE_RANK[ctx.role]) throw forbidden('Você não pode alterar alguém do seu nível ou acima.');
    if (parsed.data.role === 'MANAGER' && ctx.role !== 'OWNER') throw forbidden('Só o dono promove a gerente.');
    const role = parsed.data.role ?? cur.role; const active = parsed.data.active ?? cur.active;
    if (active && !cur.active) {
      const other = await client.query('SELECT 1 FROM dealership_members WHERE user_id=$1 AND active AND dealership_id<>$2', [target, ctx.store.id]);
      if (other.rowCount) throw conflict('Esta pessoa já participa de outra loja.', 'DEALER_ALREADY_MEMBER');
      const count = await client.query('SELECT count(*)::int AS n FROM dealership_members WHERE dealership_id=$1 AND active', [ctx.store.id]);
      if (Number(count.rows[0].n) >= ctx.store.memberLimit) throw conflict(`O limite de ${ctx.store.memberLimit} pessoas na equipe foi atingido.`, 'DEALER_MEMBER_LIMIT');
    }
    await client.query('UPDATE dealership_members SET role=$3,active=$4,updated_at=now() WHERE dealership_id=$1 AND user_id=$2', [ctx.store.id, target, role, active]);
    return { userId: target, role, active };
  });
  await audit(req.user!.id, 'DEALER_MEMBER_UPDATED', 'DEALERSHIP', ctx.store.id, { member: target, ...parsed.data, requestId: requestId(req) });
  res.json({ member: out });
}));

// ---------------------------------------------------------------- estoque

const photoZ = z.string().trim().max(500).url().refine((u) => u.startsWith('https://'), 'HTTPS_ONLY');
const yearZ = z.number().int().min(1950).max(2100);
const vehicleBase = z.object({
  plate: plateZ.nullable(),
  brand: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(60),
  version: z.string().trim().max(80),
  yearManufacture: yearZ.nullable(),
  yearModel: yearZ.nullable(),
  color: z.string().trim().max(30),
  fuel: z.string().trim().max(30),
  transmission: z.string().trim().max(30),
  mileageKm: z.number().int().min(0).max(3_000_000).nullable(),
  priceCents: centsZ,
  costCents: centsZ.nullable(),
  fipeCents: centsZ.nullable(),
  publicListed: z.boolean(),
  sealEnabled: z.boolean(),
  description: z.string().trim().max(2000),
  photos: z.array(photoZ).max(8),
  ipvaDueOn: dayZ.nullable(),
  licensingDueOn: dayZ.nullable(),
  enteredOn: dayZ
}).strict();
const vehicleCreate = vehicleBase.partial().required({ brand: true, model: true, priceCents: true }).strict();
const vehiclePatch = vehicleBase.partial().strict();

const VCOLS: Record<string, string> = {
  plate: 'plate', brand: 'brand', model: 'model', version: 'version', yearManufacture: 'year_manufacture', yearModel: 'year_model', color: 'color', fuel: 'fuel', transmission: 'transmission',
  mileageKm: 'mileage_km', priceCents: 'price_cents', costCents: 'cost_cents', fipeCents: 'fipe_cents', publicListed: 'public_listed', sealEnabled: 'seal_enabled', description: 'description',
  ipvaDueOn: 'ipva_due_on', licensingDueOn: 'licensing_due_on', enteredOn: 'entered_on'
};

const VEHICLE_SELECT = `SELECT v.*, (current_date - v.entered_on)::int AS days_in_stock, q.id AS q_id, q.completed_at AS q_at
  FROM stock_vehicles v LEFT JOIN vehicle_queries q ON q.id=v.query_id AND q.status='SUCCESS'`;

export function vehicleOut(r: Record<string, unknown>, ctx: DealerCtx) {
  const seeCost = can.seeCost(ctx);
  const price = Number(r.price_cents); const cost = r.cost_cents == null ? null : Number(r.cost_cents); const fipe = r.fipe_cents == null ? null : Number(r.fipe_cents);
  return {
    id: r.id, plate: r.plate ?? null, brand: r.brand, model: r.model, version: r.version, yearManufacture: r.year_manufacture ?? null, yearModel: r.year_model ?? null, color: r.color, fuel: r.fuel, transmission: r.transmission,
    mileageKm: r.mileage_km ?? null, priceCents: price, costCents: seeCost ? cost : null, marginCents: seeCost && cost != null ? price - cost : null, fipeCents: fipe,
    aboveFipePct: fipe && fipe > 0 ? Math.round(((price - fipe) / fipe) * 1000) / 10 : null,
    status: r.status, publicListed: r.public_listed, sealEnabled: r.seal_enabled, description: r.description, photos: r.photos,
    ipvaDueOn: dayOut(r.ipva_due_on), licensingDueOn: dayOut(r.licensing_due_on), enteredOn: dayOut(r.entered_on), daysInStock: r.days_in_stock == null ? null : Number(r.days_in_stock),
    soldAt: iso(r.sold_at), soldPriceCents: r.sold_price_cents == null ? null : Number(r.sold_price_cents),
    verification: r.q_id ? { code: String(r.q_id).slice(0, 8).toUpperCase(), consultedAt: iso(r.q_at) } : null,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at)
  };
}

/** Liga ao veículo a consulta concluída mais recente da placa feita por alguém da equipe. */
async function latestTeamQuery(client: PoolClient, dealershipId: string, plate: string | null): Promise<string | null> {
  if (!plate) return null;
  const r = await client.query(`SELECT q.id FROM vehicle_queries q JOIN dealership_members m ON m.user_id=q.user_id AND m.dealership_id=$1 AND m.active
    WHERE q.plate=$2 AND q.status='SUCCESS' ORDER BY q.completed_at DESC NULLS LAST LIMIT 1`, [dealershipId, plate]);
  return r.rowCount ? String(r.rows[0].id) : null;
}

async function assertVehicleRoom(client: PoolClient, ctx: DealerCtx, excludeId?: string) {
  await client.query('SELECT 1 FROM dealerships WHERE id=$1 FOR UPDATE', [ctx.store.id]);
  const n = await client.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED') AND ($2::uuid IS NULL OR id<>$2)`, [ctx.store.id, excludeId ?? null]);
  if (Number(n.rows[0].n) >= ctx.store.vehicleLimit) throw conflict(`O limite de ${ctx.store.vehicleLimit} veículos em estoque foi atingido. Arquive ou venda algum, ou fale com o suporte.`, 'DEALER_VEHICLE_LIMIT');
}

const listQuery = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'SOLD', 'ARCHIVED', 'OPEN']).default('OPEN'),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['recent', 'oldest', 'price_asc', 'price_desc']).default('recent'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

dealerRouter.get('/dealer/vehicles', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const p = listQuery.safeParse(req.query);
  if (!p.success) throw bad('Filtro inválido.');
  const f = p.data;
  const values: unknown[] = [ctx.store.id];
  let where = 'v.dealership_id=$1';
  if (f.status === 'OPEN') where += ` AND v.status IN ('AVAILABLE','RESERVED')`; else { values.push(f.status); where += ` AND v.status=$${values.length}`; }
  if (f.q) { values.push(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where += ` AND (v.brand ILIKE $${values.length} OR v.model ILIKE $${values.length} OR v.version ILIKE $${values.length} OR v.plate ILIKE $${values.length})`; }
  const order = { recent: 'v.created_at DESC', oldest: 'v.entered_on ASC, v.created_at ASC', price_asc: 'v.price_cents ASC', price_desc: 'v.price_cents DESC' }[f.sort];
  values.push(f.limit, f.offset);
  const r = await pool.query(`${VEHICLE_SELECT} WHERE ${where} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  res.json(r.rows.map((x) => vehicleOut(x, ctx)));
}));

dealerRouter.post('/dealer/vehicles', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = vehicleCreate.safeParse(req.body);
  if (!parsed.success) throw bad('Confira os dados do veículo (marca, modelo e preço são obrigatórios).');
  const b = parsed.data;
  if (b.costCents != null && !can.seeCost(ctx)) throw forbidden('Só dono e gerente informam o custo.');
  if (b.publicListed === true && b.priceCents === 0) throw bad('Informe o preço para mostrar na vitrine.');
  try {
    const id = await tx(async (client) => {
      await assertVehicleRoom(client, ctx);
      const queryId = await latestTeamQuery(client, ctx.store.id, b.plate ?? null);
      const cols = ['dealership_id', 'created_by', 'query_id']; const values: unknown[] = [ctx.store.id, ctx.userId, queryId];
      for (const [k, v] of Object.entries(b)) { if (k === 'photos') continue; cols.push(VCOLS[k]!); values.push(v); }
      cols.push('photos'); values.push(JSON.stringify(b.photos ?? []));
      const r = await client.query(`INSERT INTO stock_vehicles(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, values);
      return String(r.rows[0].id);
    });
    await audit(req.user!.id, 'STOCK_VEHICLE_CREATED', 'STOCK_VEHICLE', id, { dealershipId: ctx.store.id, requestId: requestId(req) });
    const r = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1`, [id]);
    res.status(201).json(vehicleOut(r.rows[0], ctx));
  } catch (e) { if (isUnique(e)) throw conflict('Já existe um veículo em estoque com esta placa.', 'DEALER_PLATE_DUPLICATE'); throw e; }
}));

async function ownVehicle(ctx: DealerCtx, id: string, client: Pick<PoolClient, 'query'> = pool, lock = false) {
  const r = await client.query(`SELECT * FROM stock_vehicles WHERE id=$1 AND dealership_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, ctx.store.id]);
  if (!r.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
  return r.rows[0] as Record<string, unknown>;
}

/** Dados que a equipe já tem para a placa (consultas, FIPE, garagem, estoque anterior). Não consulta fonte externa e não cobra. */
dealerRouter.get('/dealer/vehicle-lookup', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const plate = plateZ.safeParse(String(req.query.plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (!plate.success) throw bad('Informe uma placa válida.');
  const [s, open] = await Promise.all([
    suggestForPlate(ctx.store.id, plate.data),
    pool.query(`SELECT id FROM stock_vehicles WHERE dealership_id=$1 AND plate=$2 AND status IN ('AVAILABLE','RESERVED') LIMIT 1`, [ctx.store.id, plate.data])
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ plate: plate.data, found: s.sources.length > 0, fields: s.fields, sources: s.sources, inStock: open.rowCount ? String(open.rows[0].id) : null });
}));

/** Placas já consultadas ou guardadas na garagem pela equipe, ainda fora do estoque. */
dealerRouter.get('/dealer/import-candidates', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const q = z.object({ q: z.string().trim().max(40).optional() }).safeParse(req.query);
  if (!q.success) throw bad('Filtro inválido.');
  const items = await importCandidates(ctx.store.id, q.data.q ? q.data.q.toUpperCase() : undefined);
  const used = await pool.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED')`, [ctx.store.id]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items, room: Math.max(0, ctx.store.vehicleLimit - Number(used.rows[0].n)) });
}));

const importBody = z.object({ plates: z.array(plateZ).min(1).max(30) }).strict();
/** Cria no estoque, de uma vez, os veículos escolhidos. Entram como rascunho: sem preço e fora da vitrine. */
dealerRouter.post('/dealer/vehicles/import', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const p = importBody.safeParse(req.body);
  if (!p.success) throw bad('Escolha de 1 a 30 placas.');
  const plates = [...new Set(p.data.plates)];
  const created = await tx(async (client) => {
    await client.query('SELECT 1 FROM dealerships WHERE id=$1 FOR UPDATE', [ctx.store.id]);
    const n = await client.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED')`, [ctx.store.id]);
    if (Number(n.rows[0].n) + plates.length > ctx.store.vehicleLimit) throw conflict(`O limite de ${ctx.store.vehicleLimit} veículos em estoque seria ultrapassado. Importe menos veículos, arquive ou venda algum, ou fale com o suporte.`, 'DEALER_VEHICLE_LIMIT');
    const ids: string[] = []; let skipped = 0;
    for (const plate of plates) {
      const dup = await client.query(`SELECT 1 FROM stock_vehicles WHERE dealership_id=$1 AND plate=$2 AND status IN ('AVAILABLE','RESERVED')`, [ctx.store.id, plate]);
      if (dup.rowCount) { skipped += 1; continue; }
      const s = await suggestForPlate(ctx.store.id, plate, client);
      if (!s.sources.length) { skipped += 1; continue; }
      const f = s.fields;
      const queryId = await latestTeamQuery(client, ctx.store.id, plate);
      const r = await client.query(`INSERT INTO stock_vehicles(dealership_id,created_by,query_id,plate,brand,model,version,year_manufacture,year_model,color,fuel,transmission,mileage_km,price_cents,fipe_cents,public_listed,seal_enabled)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,false,true) RETURNING id`,
        [ctx.store.id, ctx.userId, queryId, plate, f.brand || 'Sem marca', f.model || 'Sem modelo', f.version ?? '', f.yearManufacture ?? null, f.yearModel ?? null, f.color ?? '', f.fuel ?? '', f.transmission ?? '', f.mileageKm ?? null, f.fipeCents ?? null]);
      ids.push(String(r.rows[0].id));
    }
    return { ids, skipped };
  });
  for (const id of created.ids) await audit(req.user!.id, 'STOCK_VEHICLE_IMPORTED', 'STOCK_VEHICLE', id, { dealershipId: ctx.store.id, requestId: requestId(req) });
  res.status(201).json({ imported: created.ids.length, skipped: created.skipped, ids: created.ids });
}));

dealerRouter.get('/dealer/vehicles/:id', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const r = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1 AND v.dealership_id=$2`, [id, ctx.store.id]);
  if (!r.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
  res.json(vehicleOut(r.rows[0], ctx));
}));

dealerRouter.patch('/dealer/vehicles/:id', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = vehiclePatch.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) throw bad('Confira os dados do veículo.');
  const b = parsed.data;
  if (b.costCents !== undefined && !can.seeCost(ctx)) throw forbidden('Só dono e gerente informam o custo.');
  try {
    await tx(async (client) => {
      const cur = await ownVehicle(ctx, id, client, true);
      if (cur.status === 'SOLD' && !can.manage(ctx)) throw forbidden('Veículo vendido: só dono e gerente alteram.');
      if ((b.publicListed ?? cur.public_listed) === true && Number(b.priceCents ?? cur.price_cents) <= 0) throw bad('Informe o preço para mostrar na vitrine.');
      const sets: string[] = []; const values: unknown[] = [];
      for (const [k, v] of Object.entries(b)) { if (k === 'photos') { values.push(JSON.stringify(v)); sets.push(`photos=$${values.length}`); } else { values.push(v); sets.push(`${VCOLS[k]}=$${values.length}`); } }
      if (b.plate !== undefined && b.plate !== cur.plate) { values.push(await latestTeamQuery(client, ctx.store.id, b.plate)); sets.push(`query_id=$${values.length}`); }
      values.push(id);
      await client.query(`UPDATE stock_vehicles SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length}`, values);
    });
  } catch (e) { if (isUnique(e)) throw conflict('Já existe um veículo em estoque com esta placa.', 'DEALER_PLATE_DUPLICATE'); throw e; }
  await audit(req.user!.id, 'STOCK_VEHICLE_UPDATED', 'STOCK_VEHICLE', id, { fields: Object.keys(b), requestId: requestId(req) });
  const r = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1`, [id]);
  res.json(vehicleOut(r.rows[0], ctx));
}));

const statusBody = z.object({ status: z.enum(['AVAILABLE', 'RESERVED', 'ARCHIVED']) }).strict();
dealerRouter.post('/dealer/vehicles/:id/status', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = statusBody.safeParse(req.body);
  if (!parsed.success) throw bad('Situação inválida.');
  try {
    await tx(async (client) => {
      const cur = await ownVehicle(ctx, id, client, true);
      if (cur.status === 'SOLD' && !can.manage(ctx)) throw forbidden('Só dono e gerente reabrem um veículo vendido.');
      if (['AVAILABLE', 'RESERVED'].includes(parsed.data.status) && !['AVAILABLE', 'RESERVED'].includes(String(cur.status))) await assertVehicleRoom(client, ctx, id);
      await client.query(`UPDATE stock_vehicles SET status=$2,sold_at=NULL,sold_price_cents=NULL,updated_at=now() WHERE id=$1`, [id, parsed.data.status]);
    });
  } catch (e) { if (isUnique(e)) throw conflict('Já existe outro veículo em estoque com esta placa.', 'DEALER_PLATE_DUPLICATE'); throw e; }
  await audit(req.user!.id, 'STOCK_VEHICLE_STATUS', 'STOCK_VEHICLE', id, { status: parsed.data.status, requestId: requestId(req) });
  const r = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1`, [id]);
  res.json(vehicleOut(r.rows[0], ctx));
}));

const sellBody = z.object({ soldPriceCents: centsZ, leadId: z.string().uuid().nullish(), soldOn: dayZ.optional() }).strict();
dealerRouter.post('/dealer/vehicles/:id/sell', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = sellBody.safeParse(req.body);
  if (!parsed.success) throw bad('Informe o valor da venda.');
  await tx(async (client) => {
    const cur = await ownVehicle(ctx, id, client, true);
    if (!['AVAILABLE', 'RESERVED'].includes(String(cur.status))) throw conflict('Este veículo não está disponível para venda.', 'DEALER_VEHICLE_NOT_OPEN');
    await client.query(`UPDATE stock_vehicles SET status='SOLD',sold_at=COALESCE($3::date::timestamptz, now()),sold_price_cents=$2,updated_at=now() WHERE id=$1`, [id, parsed.data.soldPriceCents, parsed.data.soldOn ?? null]);
    if (parsed.data.leadId) {
      const lead = await client.query(`SELECT stage,assigned_to,created_by FROM dealer_leads WHERE id=$1 AND dealership_id=$2 FOR UPDATE`, [parsed.data.leadId, ctx.store.id]);
      if (!lead.rowCount) throw notFound('Lead não encontrado.', 'DEALER_LEAD_NOT_FOUND');
      if (!can.manage(ctx) && lead.rows[0].assigned_to && lead.rows[0].assigned_to !== ctx.userId) throw forbidden();
      const from = String(lead.rows[0].stage);
      if (from !== 'WON') {
        await client.query(`UPDATE dealer_leads SET stage='WON',closed_at=now(),lost_reason=NULL,value_cents=$2,vehicle_id=$3,assigned_to=COALESCE(assigned_to,$4),updated_at=now() WHERE id=$1`, [parsed.data.leadId, parsed.data.soldPriceCents, id, ctx.userId]);
        await client.query(`INSERT INTO dealer_lead_events(lead_id,type,from_stage,to_stage,note,actor_user_id) VALUES($1,'STAGE',$2,'WON','Venda registrada no estoque',$3)`, [parsed.data.leadId, from, ctx.userId]);
      }
    }
  });
  await audit(req.user!.id, 'STOCK_VEHICLE_SOLD', 'STOCK_VEHICLE', id, { leadId: parsed.data.leadId ?? null, requestId: requestId(req) });
  const r = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1`, [id]);
  res.json(vehicleOut(r.rows[0], ctx));
}));

// ---------------------------------------------------------------- arquivar, restaurar e excluir (só o dono)

/** Arquivar tira a vitrine do ar e trava a equipe; nada é apagado e o dono restaura quando quiser. */
dealerRouter.post('/dealer/archive', dealerAccess('OWNER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  await pool.query('UPDATE dealerships SET archived_at=now(),updated_at=now() WHERE id=$1', [ctx.store.id]);
  await audit(req.user!.id, 'DEALER_ARCHIVED', 'DEALERSHIP', ctx.store.id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

dealerRouter.post('/dealer/restore', dealerAccess('OWNER', { allowArchived: true }), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  await pool.query('UPDATE dealerships SET archived_at=NULL,updated_at=now() WHERE id=$1', [ctx.store.id]);
  await audit(req.user!.id, 'DEALER_RESTORED', 'DEALERSHIP', ctx.store.id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

/** Exclusão definitiva: só com a loja arquivada e confirmando o endereço. Apaga estoque, leads, propostas e equipe. */
dealerRouter.delete('/dealer', dealerAccess('OWNER', { allowArchived: true }), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = z.object({ confirm: z.string() }).strict().safeParse(req.body);
  if (!parsed.success || parsed.data.confirm.trim().toLowerCase() !== ctx.store.slug) throw bad('Digite o endereço da loja para confirmar.', 'DEALER_CONFIRM_MISMATCH');
  if (!ctx.store.archivedAt) throw conflict('Arquive a loja antes de excluir.', 'DEALER_NOT_ARCHIVED');
  await pool.query('DELETE FROM dealerships WHERE id=$1', [ctx.store.id]);
  await audit(req.user!.id, 'DEALER_DELETED', 'DEALERSHIP', ctx.store.id, { slug: ctx.store.slug, requestId: requestId(req) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- excluir veículo

/** Veículo vendido não se exclui (fica no histórico de vendas); os demais, dono e gerente. Propostas antigas mantêm o texto. */
dealerRouter.delete('/dealer/vehicles/:id', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const cur = await ownVehicle(ctx, id);
  if (cur.status === 'SOLD') throw conflict('Veículo vendido fica no histórico. Arquive ou mantenha.', 'DEALER_VEHICLE_SOLD');
  await pool.query('DELETE FROM stock_vehicles WHERE id=$1 AND dealership_id=$2', [id, ctx.store.id]);
  await audit(req.user!.id, 'STOCK_VEHICLE_DELETED', 'STOCK_VEHICLE', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
