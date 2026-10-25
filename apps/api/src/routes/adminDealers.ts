import { Router } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';

/** Lojas (concessionárias, agências, vendedores): lista, limites de veículos/equipe e suspensão. */
export const adminDealersRouter = Router();
adminDealersRouter.use(adminAuth);
const idParam = z.string().uuid();
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });

adminDealersRouter.get('/dealerships', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
  const values: unknown[] = [];
  let where = 'TRUE';
  if (q) { values.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where = `(d.name ILIKE $1 OR d.slug ILIKE $1 OR u.email ILIKE $1)`; }
  const r = await pool.query(`SELECT d.id,d.name,d.slug,d.city,d.state,d.active,d.public_enabled,d.vehicle_limit,d.member_limit,d.created_at,u.name AS owner_name,u.email AS owner_email,
      (SELECT count(*)::int FROM stock_vehicles v WHERE v.dealership_id=d.id AND v.status IN ('AVAILABLE','RESERVED')) AS vehicles,
      (SELECT count(*)::int FROM dealership_members m WHERE m.dealership_id=d.id AND m.active) AS members,
      (SELECT count(*)::int FROM dealer_leads l WHERE l.dealership_id=d.id) AS leads
    FROM dealerships d JOIN users u ON u.id=d.owner_user_id WHERE ${where} ORDER BY d.created_at DESC LIMIT 200`, values);
  res.json(r.rows.map((x) => ({
    id: x.id, name: x.name, slug: x.slug, city: x.city, state: x.state, active: x.active, publicEnabled: x.public_enabled, vehicleLimit: x.vehicle_limit, memberLimit: x.member_limit,
    vehicles: x.vehicles, members: x.members, leads: x.leads, ownerName: x.owner_name, ownerEmail: x.owner_email, createdAt: x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at
  })));
}));

const patchBody = z.object({
  active: z.boolean(),
  vehicleLimit: z.number().int().min(1).max(10_000),
  memberLimit: z.number().int().min(1).max(200)
}).partial().strict();

adminDealersRouter.patch('/dealerships/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = patchBody.safeParse(req.body);
  if (!id.success || !body.success || !Object.keys(body.data).length) throw bad();
  const b = body.data;
  const map: Record<string, string> = { active: 'active', vehicleLimit: 'vehicle_limit', memberLimit: 'member_limit' };
  const sets: string[] = []; const values: unknown[] = [];
  for (const [k, v] of Object.entries(b)) { values.push(v); sets.push(`${map[k]}=$${values.length}`); }
  values.push(id.data);
  const r = await pool.query(`UPDATE dealerships SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length} RETURNING id,active,vehicle_limit,member_limit`, values);
  if (!r.rowCount) throw appError('DEALER_NOT_FOUND', { code: 'DEALER_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'ADMIN_DEALER_UPDATED', 'DEALERSHIP', id.data, { fields: b, requestId: requestId(req) });
  res.json({ id: r.rows[0].id, active: r.rows[0].active, vehicleLimit: r.rows[0].vehicle_limit, memberLimit: r.rows[0].member_limit });
}));
