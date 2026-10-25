import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { auth } from '../auth.js';
import { env } from '../config.js';
import { asyncRoute, audit, requestId } from '../lib/http.js';
import { toCsv } from '../lib/br.js';
import { type DealerCtx, bad, can, conflict, dealerAccess, emailZ, forbidden, iso, notFound, phoneZ, centsZ, uuidParam } from '../dealer/context.js';

/** Funil de leads da loja. Vendedor vê os seus e os sem responsável (para assumir); dono e gerente veem todos. */
export const dealerLeadsRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas ações em pouco tempo. Aguarde um instante.' } });
dealerLeadsRouter.use('/dealer/leads', limiter, auth);
dealerLeadsRouter.use('/dealer/leads.csv', limiter, auth);

export const STAGES = ['NEW', 'CONTACT', 'PROPOSAL', 'VISIT', 'WON', 'LOST'] as const;
type Stage = typeof STAGES[number];
const OPEN: Stage[] = ['NEW', 'CONTACT', 'PROPOSAL', 'VISIT'];
const dealer = (req: { dealer?: DealerCtx }) => req.dealer!;

/** Trecho de WHERE (alias `l`) com a visibilidade do usuário; acrescenta o id do usuário em `values` quando precisa. */
export function leadScope(ctx: DealerCtx, values: unknown[]): string {
  if (can.manage(ctx)) return '';
  values.push(ctx.userId);
  return ` AND (l.assigned_to=$${values.length} OR l.assigned_to IS NULL OR l.created_by=$${values.length})`;
}

const LEAD_SELECT = `SELECT l.*, v.brand AS v_brand, v.model AS v_model, v.version AS v_version, v.year_model AS v_year, v.price_cents AS v_price, a.name AS assignee_name
  FROM dealer_leads l LEFT JOIN stock_vehicles v ON v.id=l.vehicle_id LEFT JOIN users a ON a.id=l.assigned_to`;

export function leadOut(r: Record<string, unknown>) {
  const label = r.v_brand ? [r.v_brand, r.v_model, r.v_version, r.v_year].filter(Boolean).join(' ') : null;
  return {
    id: r.id, name: r.name, phone: r.phone ?? null, email: r.email ?? null, source: r.source, stage: r.stage, notes: r.notes, lostReason: r.lost_reason ?? null,
    valueCents: r.value_cents == null ? null : Number(r.value_cents), nextContactAt: iso(r.next_contact_at), vehicleId: r.vehicle_id ?? null, vehicleLabel: label,
    assignedTo: r.assigned_to ?? null, assigneeName: r.assignee_name ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), closedAt: iso(r.closed_at), consent: Boolean(r.consent_at)
  };
}

async function loadLead(ctx: DealerCtx, id: string, lock = false, client: { query: typeof pool.query } = pool) {
  const values: unknown[] = [id, ctx.store.id];
  const scope = leadScope(ctx, values);
  const r = await client.query(`SELECT l.* FROM dealer_leads l WHERE l.id=$1 AND l.dealership_id=$2${scope}${lock ? ' FOR UPDATE OF l' : ''}`, values);
  if (!r.rowCount) throw notFound('Lead não encontrado.', 'DEALER_LEAD_NOT_FOUND');
  return r.rows[0] as Record<string, unknown>;
}

async function assertVehicleOfStore(ctx: DealerCtx, vehicleId: string | null | undefined) {
  if (!vehicleId) return;
  const r = await pool.query('SELECT 1 FROM stock_vehicles WHERE id=$1 AND dealership_id=$2', [vehicleId, ctx.store.id]);
  if (!r.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
}
async function assertAssignee(ctx: DealerCtx, userId: string | null | undefined) {
  if (!userId) return;
  const r = await pool.query('SELECT 1 FROM dealership_members WHERE dealership_id=$1 AND user_id=$2 AND active', [ctx.store.id, userId]);
  if (!r.rowCount) throw bad('A pessoa escolhida não está na equipe.', 'DEALER_ASSIGNEE_INVALID');
}

const dateTimeZ = z.string().datetime({ offset: true });
const leadCreate = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneZ.nullish(),
  email: emailZ.nullish(),
  vehicleId: z.string().uuid().nullish(),
  source: z.enum(['SITE', 'WHATSAPP', 'INDICACAO', 'LOJA', 'OUTRO']).default('LOJA'),
  notes: z.string().trim().max(2000).default(''),
  valueCents: centsZ.nullish(),
  nextContactAt: dateTimeZ.nullish(),
  assignedTo: z.string().uuid().nullish()
}).strict();

const listQuery = z.object({
  stage: z.enum(STAGES).optional(),
  assigned: z.union([z.literal('me'), z.literal('none'), z.string().uuid()]).optional(),
  vehicleId: z.string().uuid().optional(),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});

function filtered(ctx: DealerCtx, f: z.infer<typeof listQuery>) {
  const values: unknown[] = [ctx.store.id];
  let where = 'l.dealership_id=$1';
  if (f.stage) { values.push(f.stage); where += ` AND l.stage=$${values.length}`; }
  if (f.assigned === 'me') { values.push(ctx.userId); where += ` AND l.assigned_to=$${values.length}`; }
  else if (f.assigned === 'none') where += ' AND l.assigned_to IS NULL';
  else if (f.assigned) { values.push(f.assigned); where += ` AND l.assigned_to=$${values.length}`; }
  if (f.vehicleId) { values.push(f.vehicleId); where += ` AND l.vehicle_id=$${values.length}`; }
  if (f.q) { values.push(`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where += ` AND (l.name ILIKE $${values.length} OR l.phone LIKE $${values.length} OR l.email ILIKE $${values.length})`; }
  where += leadScope(ctx, values);
  return { where, values };
}

dealerLeadsRouter.get('/dealer/leads', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const p = listQuery.safeParse(req.query);
  if (!p.success) throw bad('Filtro inválido.');
  const { where, values } = filtered(ctx, p.data);
  values.push(p.data.limit, p.data.offset);
  const r = await pool.query(`${LEAD_SELECT} WHERE ${where} ORDER BY l.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  res.json(r.rows.map((x) => leadOut(x)));
}));

// exportação (LGPD / planilha): só dono e gerente. Fica antes de /:id.
dealerLeadsRouter.get('/dealer/leads.csv', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const p = listQuery.safeParse({ ...req.query, limit: 500, offset: 0 });
  if (!p.success) throw bad('Filtro inválido.');
  const { where, values } = filtered(ctx, p.data);
  const r = await pool.query(`${LEAD_SELECT} WHERE ${where} ORDER BY l.created_at DESC LIMIT 5000`, values);
  const stage: Record<string, string> = { NEW: 'Novo', CONTACT: 'Contato', PROPOSAL: 'Proposta', VISIT: 'Visita', WON: 'Fechado', LOST: 'Perdido' };
  const csv = toCsv(['Data', 'Nome', 'Telefone', 'E-mail', 'Origem', 'Etapa', 'Veículo', 'Responsável', 'Valor (R$)', 'Observações'],
    r.rows.map((x) => { const o = leadOut(x); return [String(x.created_at instanceof Date ? x.created_at.toISOString() : x.created_at).slice(0, 16).replace('T', ' '), o.name, o.phone, o.email, o.source, stage[String(o.stage)], o.vehicleLabel, o.assigneeName, o.valueCents == null ? '' : (o.valueCents / 100).toFixed(2).replace('.', ','), o.notes]; }));
  await audit(req.user!.id, 'DEALER_LEADS_EXPORTED', 'DEALERSHIP', ctx.store.id, { rows: r.rowCount, requestId: requestId(req) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(csv);
}));

dealerLeadsRouter.post('/dealer/leads', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const parsed = leadCreate.safeParse(req.body);
  if (!parsed.success) throw bad('Confira o nome e informe telefone ou e-mail.');
  const b = parsed.data;
  if (!b.phone && !b.email) throw bad('Informe telefone ou e-mail do lead.');
  await assertVehicleOfStore(ctx, b.vehicleId);
  let assigned = b.assignedTo ?? null;
  if (!can.manage(ctx)) { if (assigned && assigned !== ctx.userId) throw forbidden('Vendedor só pode atribuir a si mesmo.'); assigned = ctx.userId; }
  await assertAssignee(ctx, assigned);
  const id = await tx(async (client) => {
    const r = await client.query(`INSERT INTO dealer_leads(dealership_id,vehicle_id,assigned_to,name,phone,email,source,notes,value_cents,next_contact_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [ctx.store.id, b.vehicleId ?? null, assigned, b.name, b.phone ?? null, b.email ?? null, b.source, b.notes, b.valueCents ?? null, b.nextContactAt ?? null, ctx.userId]);
    await client.query(`INSERT INTO dealer_lead_events(lead_id,type,to_stage,actor_user_id) VALUES($1,'CREATED','NEW',$2)`, [r.rows[0].id, ctx.userId]);
    return String(r.rows[0].id);
  });
  await audit(req.user!.id, 'DEALER_LEAD_CREATED', 'DEALER_LEAD', id, { requestId: requestId(req) });
  const r = await pool.query(`${LEAD_SELECT} WHERE l.id=$1`, [id]);
  res.status(201).json(leadOut(r.rows[0]));
}));

dealerLeadsRouter.get('/dealer/leads/:id', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  await loadLead(ctx, id);
  const [lead, events, proposals] = await Promise.all([
    pool.query(`${LEAD_SELECT} WHERE l.id=$1`, [id]),
    pool.query(`SELECT e.id,e.type,e.from_stage,e.to_stage,e.note,e.created_at,u.name AS actor FROM dealer_lead_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.lead_id=$1 ORDER BY e.id DESC LIMIT 200`, [id]),
    pool.query(`SELECT id,code,vehicle_label,price_cents,created_at FROM dealer_proposals WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [id])
  ]);
  res.json({
    lead: leadOut(lead.rows[0]),
    events: events.rows.map((e) => ({ id: String(e.id), type: e.type, fromStage: e.from_stage, toStage: e.to_stage, note: e.note, actor: e.actor ?? null, createdAt: iso(e.created_at) })),
    proposals: proposals.rows.map((p) => ({ id: p.id, code: p.code, vehicleLabel: p.vehicle_label, priceCents: Number(p.price_cents), createdAt: iso(p.created_at) }))
  });
}));

const leadPatch = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneZ.nullable(),
  email: emailZ.nullable(),
  vehicleId: z.string().uuid().nullable(),
  notes: z.string().trim().max(2000),
  valueCents: centsZ.nullable(),
  nextContactAt: dateTimeZ.nullable(),
  assignedTo: z.string().uuid().nullable()
}).partial().strict();

dealerLeadsRouter.patch('/dealer/leads/:id', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = leadPatch.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) throw bad('Confira os dados do lead.');
  const b = parsed.data;
  await assertVehicleOfStore(ctx, b.vehicleId);
  if (b.assignedTo !== undefined) {
    if (!can.manage(ctx) && b.assignedTo !== ctx.userId) throw forbidden('Só dono e gerente repassam leads para outras pessoas.');
    await assertAssignee(ctx, b.assignedTo);
  }
  await tx(async (client) => {
    const cur = await loadLead(ctx, id, true, client);
    const phone = b.phone !== undefined ? b.phone : cur.phone; const email = b.email !== undefined ? b.email : cur.email;
    if (!phone && !email) throw bad('O lead precisa de telefone ou e-mail.');
    if (b.assignedTo !== undefined && !can.manage(ctx) && cur.assigned_to && cur.assigned_to !== ctx.userId) throw forbidden();
    const map: Record<string, string> = { name: 'name', phone: 'phone', email: 'email', vehicleId: 'vehicle_id', notes: 'notes', valueCents: 'value_cents', nextContactAt: 'next_contact_at', assignedTo: 'assigned_to' };
    const sets: string[] = []; const values: unknown[] = [];
    for (const [k, v] of Object.entries(b)) { values.push(v); sets.push(`${map[k]}=$${values.length}`); }
    values.push(id);
    await client.query(`UPDATE dealer_leads SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length}`, values);
    if (b.assignedTo !== undefined && b.assignedTo !== cur.assigned_to) await client.query(`INSERT INTO dealer_lead_events(lead_id,type,note,actor_user_id) VALUES($1,'ASSIGNED',$2,$3)`, [id, b.assignedTo ? 'Responsável alterado' : 'Responsável removido', ctx.userId]);
  });
  await audit(req.user!.id, 'DEALER_LEAD_UPDATED', 'DEALER_LEAD', id, { fields: Object.keys(b), requestId: requestId(req) });
  const r = await pool.query(`${LEAD_SELECT} WHERE l.id=$1`, [id]);
  res.json(leadOut(r.rows[0]));
}));

const stageBody = z.object({ stage: z.enum(STAGES), lostReason: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional() }).strict();
dealerLeadsRouter.post('/dealer/leads/:id/stage', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = stageBody.safeParse(req.body);
  if (!parsed.success) throw bad('Etapa inválida.');
  const { stage, lostReason, note } = parsed.data;
  if (stage === 'LOST' && (lostReason ?? '').length < 3) throw bad('Informe o motivo da perda.', 'DEALER_LOST_REASON_REQUIRED');
  await tx(async (client) => {
    const cur = await loadLead(ctx, id, true, client);
    const from = String(cur.stage) as Stage;
    if (from === stage) return;
    if (!OPEN.includes(from) && OPEN.includes(stage) && !can.manage(ctx)) throw forbidden('Só dono e gerente reabrem um lead encerrado.');
    const closed = stage === 'WON' || stage === 'LOST';
    await client.query(`UPDATE dealer_leads SET stage=$2,closed_at=${closed ? 'now()' : 'NULL'},lost_reason=$3,assigned_to=COALESCE(assigned_to,$4),updated_at=now() WHERE id=$1`, [id, stage, stage === 'LOST' ? lostReason : null, ctx.userId]);
    await client.query(`INSERT INTO dealer_lead_events(lead_id,type,from_stage,to_stage,note,actor_user_id) VALUES($1,'STAGE',$2,$3,$4,$5)`, [id, from, stage, stage === 'LOST' ? lostReason : note ?? null, ctx.userId]);
  });
  await audit(req.user!.id, 'DEALER_LEAD_STAGE', 'DEALER_LEAD', id, { stage, requestId: requestId(req) });
  const r = await pool.query(`${LEAD_SELECT} WHERE l.id=$1`, [id]);
  res.json(leadOut(r.rows[0]));
}));

dealerLeadsRouter.post('/dealer/leads/:id/claim', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  await loadLead(ctx, id);
  const r = await pool.query(`UPDATE dealer_leads SET assigned_to=$2,updated_at=now() WHERE id=$1 AND dealership_id=$3 AND assigned_to IS NULL RETURNING id`, [id, ctx.userId, ctx.store.id]);
  if (!r.rowCount) throw conflict('Este lead já tem responsável.', 'DEALER_LEAD_ASSIGNED');
  await pool.query(`INSERT INTO dealer_lead_events(lead_id,type,note,actor_user_id) VALUES($1,'ASSIGNED','Lead assumido',$2)`, [id, ctx.userId]);
  const out = await pool.query(`${LEAD_SELECT} WHERE l.id=$1`, [id]);
  res.json(leadOut(out.rows[0]));
}));

const noteBody = z.object({ note: z.string().trim().min(1).max(1000) }).strict();
dealerLeadsRouter.post('/dealer/leads/:id/notes', dealerAccess('SELLER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const parsed = noteBody.safeParse(req.body);
  if (!parsed.success) throw bad('Escreva a anotação.');
  await loadLead(ctx, id);
  await pool.query(`INSERT INTO dealer_lead_events(lead_id,type,note,actor_user_id) VALUES($1,'NOTE',$2,$3)`, [id, parsed.data.note, ctx.userId]);
  await pool.query('UPDATE dealer_leads SET updated_at=now() WHERE id=$1', [id]);
  res.status(201).json({ ok: true });
}));

dealerLeadsRouter.delete('/dealer/leads/:id', dealerAccess('MANAGER'), asyncRoute(async (req, res) => {
  const ctx = dealer(req);
  const id = uuidParam(req.params.id);
  const r = await pool.query('DELETE FROM dealer_leads WHERE id=$1 AND dealership_id=$2 RETURNING id', [id, ctx.store.id]);
  if (!r.rowCount) throw notFound('Lead não encontrado.', 'DEALER_LEAD_NOT_FOUND');
  await audit(req.user!.id, 'DEALER_LEAD_DELETED', 'DEALER_LEAD', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
