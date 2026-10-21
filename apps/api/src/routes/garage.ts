import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { auth } from '../auth.js';
import { appError, asyncRoute } from '../lib/http.js';

/**
 * Minha garagem: a pessoa guarda seus veículos, vê os relatórios que já fez e registra lembretes,
 * manutenções e gastos. Tudo o que ela digita fica marcado como "informado por você": não vem de fonte contratada.
 * Só o dono vê e altera; dá para exportar tudo e apagar.
 */
export const garageRouter = Router();

const MAX_VEHICLES = 10;
const MAX_ITEMS = 200;
const limiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas ações em pouco tempo. Aguarde um instante.' } });
garageRouter.use('/garage', limiter, auth);

const bad = (message: string, code = 'INVALID_INPUT') => appError(message, { code, http: 400, expose: true });
const notFound = () => appError('Não encontrado.', { code: 'GARAGE_NOT_FOUND', http: 404, expose: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown) => { if (typeof v !== 'string' || !UUID.test(v)) throw notFound(); return v; };

const plate = z.string().trim().transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine((v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), 'INVALID_PLATE');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'INVALID_DATE');
const km = z.number().int().min(0).max(3_000_000);

const vehicleCreate = z.object({
  plate,
  nickname: z.string().trim().max(60).default(''),
  modelLabel: z.string().trim().max(80).default(''),
  modelYear: z.number().int().min(1950).max(2100).nullish(),
  km: km.nullish(),
  notes: z.string().trim().max(500).default('')
}).strict();
const vehiclePatch = z.object({
  nickname: z.string().trim().max(60),
  modelLabel: z.string().trim().max(80),
  modelYear: z.number().int().min(1950).max(2100).nullable(),
  km: km.nullable(),
  notes: z.string().trim().max(500)
}).partial().strict();

const itemCreate = z.object({
  kind: z.enum(['REMINDER', 'MAINTENANCE', 'EXPENSE']),
  title: z.string().trim().min(1).max(120),
  dueDate: day.nullish(),
  dueKm: km.nullish(),
  eventDate: day.nullish(),
  km: km.nullish(),
  amountCents: z.number().int().min(0).max(1_000_000_000).nullish()
}).strict();
const itemPatch = z.object({
  title: z.string().trim().min(1).max(120),
  dueDate: day.nullable(),
  dueKm: km.nullable(),
  eventDate: day.nullable(),
  km: km.nullable(),
  amountCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  done: z.boolean()
}).partial().strict();

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

type ItemRow = Record<string, unknown>;
export type ReminderStatus = 'DONE' | 'OVERDUE' | 'SOON' | 'OPEN';
/** Vencido: data passou ou a quilometragem informada já chegou. "Em breve": até 30 dias ou 500 km. */
export function reminderStatus(row: { done_at: unknown; due_date: string | null; due_km: number | null }, vehicleKm: number | null, now = today(), soon = plusDays(30)): ReminderStatus {
  if (row.done_at) return 'DONE';
  if ((row.due_date && row.due_date < now) || (row.due_km != null && vehicleKm != null && vehicleKm >= row.due_km)) return 'OVERDUE';
  if ((row.due_date && row.due_date <= soon) || (row.due_km != null && vehicleKm != null && row.due_km - vehicleKm <= 500)) return 'SOON';
  return 'OPEN';
}

function itemOut(r: ItemRow, vehicleKm: number | null) {
  const dueDate = iso(r.due_date);
  const dueKm = r.due_km == null ? null : Number(r.due_km);
  return {
    id: String(r.id), vehicleId: String(r.vehicle_id), kind: String(r.kind), title: String(r.title),
    dueDate, dueKm, eventDate: iso(r.event_date), km: r.km == null ? null : Number(r.km),
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents),
    done: Boolean(r.done_at), createdAt: r.created_at,
    status: r.kind === 'REMINDER' ? reminderStatus({ done_at: r.done_at, due_date: dueDate, due_km: dueKm }, vehicleKm) : null
  };
}

function vehicleOut(r: ItemRow) {
  return {
    id: String(r.id), plate: String(r.plate), nickname: String(r.nickname ?? ''), modelLabel: String(r.model_label ?? ''),
    modelYear: r.model_year == null ? null : Number(r.model_year), km: r.km == null ? null : Number(r.km),
    kmUpdatedAt: r.km_updated_at ?? null, notes: String(r.notes ?? ''), createdAt: r.created_at
  };
}

async function ownVehicle(userId: string, id: string): Promise<ItemRow> {
  const r = await pool.query('SELECT * FROM saved_vehicles WHERE id=$1 AND user_id=$2', [id, userId]);
  if (!r.rowCount) throw notFound();
  return r.rows[0] as ItemRow;
}

async function reportsFor(userId: string, plates: string[]) {
  if (!plates.length) return new Map<string, Array<{ id: string; productId: string; createdAt: unknown }>>();
  const r = await pool.query(`SELECT id,plate,product_id,created_at FROM vehicle_queries WHERE user_id=$1 AND plate = ANY($2::text[]) AND status='SUCCESS' ORDER BY created_at DESC`, [userId, plates]);
  const out = new Map<string, Array<{ id: string; productId: string; createdAt: unknown }>>();
  for (const row of r.rows) {
    const list = out.get(String(row.plate)) ?? [];
    if (list.length < 5) list.push({ id: String(row.id), productId: String(row.product_id), createdAt: row.created_at });
    out.set(String(row.plate), list);
  }
  return out;
}

garageRouter.get('/garage', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const vehicles = await pool.query('SELECT * FROM saved_vehicles WHERE user_id=$1 ORDER BY created_at DESC', [uid]);
  const items = await pool.query(`SELECT * FROM garage_items WHERE user_id=$1 AND kind='REMINDER' AND done_at IS NULL`, [uid]);
  const reports = await reportsFor(uid, vehicles.rows.map((v) => String(v.plate)));
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    limit: MAX_VEHICLES,
    vehicles: vehicles.rows.map((v) => {
      const base = vehicleOut(v);
      const open = items.rows.filter((i) => i.vehicle_id === v.id).map((i) => itemOut(i, base.km));
      const sorted = [...open].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
      return { ...base, reminders: { open: open.length, overdue: open.filter((i) => i.status === 'OVERDUE').length, soon: open.filter((i) => i.status === 'SOON').length }, nextReminder: sorted[0] ?? null, reports: reports.get(base.plate) ?? [] };
    })
  });
}));

garageRouter.post('/garage/vehicles', asyncRoute(async (req, res) => {
  const parsed = vehicleCreate.safeParse(req.body);
  if (!parsed.success) throw bad(parsed.error.issues.some((i) => i.message === 'INVALID_PLATE') ? 'Placa inválida.' : 'Confira os dados do veículo.', parsed.error.issues.some((i) => i.message === 'INVALID_PLATE') ? 'INVALID_PLATE' : 'INVALID_INPUT');
  const v = parsed.data;
  const uid = req.user!.id;
  const count = Number((await pool.query('SELECT count(*) FROM saved_vehicles WHERE user_id=$1', [uid])).rows[0].count);
  if (count >= MAX_VEHICLES) throw bad(`Você pode guardar até ${MAX_VEHICLES} veículos.`, 'GARAGE_LIMIT');
  try {
    const r = await pool.query(`INSERT INTO saved_vehicles(user_id,plate,nickname,notes,model_label,model_year,km,km_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::int IS NULL THEN NULL ELSE now() END) RETURNING *`,
      [uid, v.plate, v.nickname || null, v.notes || null, v.modelLabel || null, v.modelYear ?? null, v.km ?? null]);
    res.status(201).json(vehicleOut(r.rows[0]));
  } catch (e) {
    if (typeof e === 'object' && e && 'code' in e && e.code === '23505') throw appError('Esse veículo já está na sua garagem.', { code: 'GARAGE_VEHICLE_EXISTS', http: 409, expose: true });
    throw e;
  }
}));

garageRouter.get('/garage/vehicles/:id', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const v = vehicleOut(await ownVehicle(uid, uuid(req.params.id)));
  const items = await pool.query('SELECT * FROM garage_items WHERE vehicle_id=$1 AND user_id=$2 ORDER BY coalesce(due_date,event_date) DESC NULLS LAST, created_at DESC', [v.id, uid]);
  const reports = await reportsFor(uid, [v.plate]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ vehicle: v, items: items.rows.map((i) => itemOut(i, v.km)), reports: reports.get(v.plate) ?? [] });
}));

garageRouter.patch('/garage/vehicles/:id', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const id = uuid(req.params.id);
  await ownVehicle(uid, id);
  const parsed = vehiclePatch.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) throw bad('Confira os dados do veículo.');
  const p = parsed.data;
  const sets: string[] = []; const vals: unknown[] = [];
  const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col}=$${vals.length}`); };
  if (p.nickname !== undefined) add('nickname', p.nickname || null);
  if (p.modelLabel !== undefined) add('model_label', p.modelLabel || null);
  if (p.modelYear !== undefined) add('model_year', p.modelYear);
  if (p.notes !== undefined) add('notes', p.notes || null);
  if (p.km !== undefined) { add('km', p.km); sets.push(p.km == null ? 'km_updated_at=NULL' : 'km_updated_at=now()'); }
  vals.push(id, uid);
  const r = await pool.query(`UPDATE saved_vehicles SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND user_id=$${vals.length} RETURNING *`, vals);
  res.json(vehicleOut(r.rows[0]));
}));

garageRouter.delete('/garage/vehicles/:id', asyncRoute(async (req, res) => {
  const r = await pool.query('DELETE FROM saved_vehicles WHERE id=$1 AND user_id=$2', [uuid(req.params.id), req.user!.id]);
  if (!r.rowCount) throw notFound();
  res.status(204).end();
}));

garageRouter.post('/garage/vehicles/:id/items', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const vehicle = await ownVehicle(uid, uuid(req.params.id));
  const parsed = itemCreate.safeParse(req.body);
  if (!parsed.success) throw bad('Confira os dados do item.');
  const i = parsed.data;
  if (i.kind === 'REMINDER' && !i.dueDate && i.dueKm == null) throw bad('Informe a data ou a quilometragem do lembrete.', 'GARAGE_REMINDER_NEEDS_DUE');
  const count = Number((await pool.query('SELECT count(*) FROM garage_items WHERE vehicle_id=$1', [vehicle.id])).rows[0].count);
  if (count >= MAX_ITEMS) throw bad(`Cada veículo guarda até ${MAX_ITEMS} itens. Apague os mais antigos.`, 'GARAGE_LIMIT');
  const r = await pool.query(`INSERT INTO garage_items(user_id,vehicle_id,kind,title,due_date,due_km,event_date,km,amount_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [uid, vehicle.id, i.kind, i.title, i.kind === 'REMINDER' ? (i.dueDate ?? null) : null, i.kind === 'REMINDER' ? (i.dueKm ?? null) : null, i.kind === 'REMINDER' ? null : (i.eventDate ?? today()), i.kind === 'REMINDER' ? null : (i.km ?? null), i.kind === 'REMINDER' ? null : (i.amountCents ?? null)]);
  // quilometragem de uma manutenção maior que a do veículo atualiza o veículo
  if (i.kind !== 'REMINDER' && i.km != null && (vehicle.km == null || Number(vehicle.km) < i.km)) await pool.query('UPDATE saved_vehicles SET km=$1,km_updated_at=now() WHERE id=$2', [i.km, vehicle.id]);
  res.status(201).json(itemOut(r.rows[0], vehicle.km == null ? null : Number(vehicle.km)));
}));

garageRouter.patch('/garage/items/:id', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const id = uuid(req.params.id);
  const cur = await pool.query('SELECT * FROM garage_items WHERE id=$1 AND user_id=$2', [id, uid]);
  if (!cur.rowCount) throw notFound();
  const parsed = itemPatch.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) throw bad('Confira os dados do item.');
  const p = parsed.data;
  const sets: string[] = []; const vals: unknown[] = [];
  const add = (col: string, val: unknown) => { vals.push(val); sets.push(`${col}=$${vals.length}`); };
  if (p.title !== undefined) add('title', p.title);
  if (p.dueDate !== undefined) add('due_date', p.dueDate);
  if (p.dueKm !== undefined) add('due_km', p.dueKm);
  if (p.eventDate !== undefined) add('event_date', p.eventDate);
  if (p.km !== undefined) add('km', p.km);
  if (p.amountCents !== undefined) add('amount_cents', p.amountCents);
  if (p.done !== undefined) sets.push(p.done ? 'done_at=coalesce(done_at,now())' : 'done_at=NULL');
  vals.push(id, uid);
  const r = await pool.query(`UPDATE garage_items SET ${sets.join(',')} WHERE id=$${vals.length - 1} AND user_id=$${vals.length} RETURNING *`, vals);
  const v = await pool.query('SELECT km FROM saved_vehicles WHERE id=$1', [r.rows[0].vehicle_id]);
  res.json(itemOut(r.rows[0], v.rows[0]?.km == null ? null : Number(v.rows[0].km)));
}));

garageRouter.delete('/garage/items/:id', asyncRoute(async (req, res) => {
  const r = await pool.query('DELETE FROM garage_items WHERE id=$1 AND user_id=$2', [uuid(req.params.id), req.user!.id]);
  if (!r.rowCount) throw notFound();
  res.status(204).end();
}));

garageRouter.get('/garage/export', asyncRoute(async (req, res) => {
  const uid = req.user!.id;
  const vehicles = await pool.query('SELECT * FROM saved_vehicles WHERE user_id=$1 ORDER BY created_at', [uid]);
  const items = await pool.query('SELECT * FROM garage_items WHERE user_id=$1 ORDER BY created_at', [uid]);
  const kmOf = new Map(vehicles.rows.map((v) => [String(v.id), v.km == null ? null : Number(v.km)]));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="minha-garagem.json"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(JSON.stringify({
    exportedAt: new Date().toISOString(),
    note: 'Lembretes, manutenções e gastos foram informados por você.',
    vehicles: vehicles.rows.map((v) => ({ ...vehicleOut(v), items: items.rows.filter((i) => i.vehicle_id === v.id).map((i) => itemOut(i, kmOf.get(String(v.id)) ?? null)) }))
  }, null, 2));
}));
