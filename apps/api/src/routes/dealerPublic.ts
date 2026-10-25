import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { env, publicAppUrl } from '../config.js';
import { asyncRoute, log } from '../lib/http.js';
import { enqueueEmail } from '../lib/emailOutbox.js';
import { bad, emailZ, iso, notFound, phoneZ, uuidParam } from '../dealer/context.js';

/** Vitrine pública da loja. Só aparece loja ativa e com a vitrine ligada; nunca expõe custo, placa inteira nem dados da equipe. */
export const dealerPublicRouter = Router();
const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas consultas em pouco tempo.' } });
const leadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 8, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Você enviou muitas mensagens. Tente mais tarde ou chame no WhatsApp.' } });

const slugParam = (v: unknown) => {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) || s.length < 3 || s.length > 40) throw notFound('Loja não encontrada.', 'STORE_NOT_FOUND');
  return s;
};

async function publicStore(slug: string) {
  const r = await pool.query(`SELECT id,name,slug,whatsapp,email,city,state,about,owner_user_id FROM dealerships WHERE lower(slug)=$1 AND public_enabled AND active`, [slug]);
  if (!r.rowCount) throw notFound('Loja não encontrada.', 'STORE_NOT_FOUND');
  return r.rows[0] as Record<string, unknown>;
}

function vehicleView(r: Record<string, unknown>) {
  const plate = r.plate ? String(r.plate) : null;
  return {
    id: r.id, brand: r.brand, model: r.model, version: r.version, yearManufacture: r.year_manufacture ?? null, yearModel: r.year_model ?? null, color: r.color, fuel: r.fuel, transmission: r.transmission,
    mileageKm: r.mileage_km ?? null, priceCents: Number(r.price_cents), description: r.description, photos: r.photos, reserved: r.status === 'RESERVED',
    plateEnd: plate ? plate.slice(-1) : null,
    verified: r.seal_enabled && r.q_id ? { code: String(r.q_id).slice(0, 8).toUpperCase(), consultedAt: iso(r.q_at) } : null
  };
}
const VEHICLE_SELECT = `SELECT v.*, q.id AS q_id, q.completed_at AS q_at FROM stock_vehicles v LEFT JOIN vehicle_queries q ON q.id=v.query_id AND q.status='SUCCESS'`;

dealerPublicRouter.get('/public/stores/:slug', readLimiter, asyncRoute(async (req, res) => {
  const s = await publicStore(slugParam(req.params.slug));
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
  const values: unknown[] = [s.id];
  let where = `v.dealership_id=$1 AND v.public_listed AND v.status IN ('AVAILABLE','RESERVED')`;
  if (q) { values.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); where += ` AND (v.brand ILIKE $${values.length} OR v.model ILIKE $${values.length} OR v.version ILIKE $${values.length})`; }
  const v = await pool.query(`${VEHICLE_SELECT} WHERE ${where} ORDER BY (v.status='AVAILABLE') DESC, v.created_at DESC LIMIT 100`, values);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    store: { name: s.name, slug: s.slug, whatsapp: s.whatsapp ?? null, city: s.city ?? null, state: s.state ?? null, about: s.about },
    vehicles: v.rows.map(vehicleView)
  });
}));

dealerPublicRouter.get('/public/stores/:slug/vehicles/:id', readLimiter, asyncRoute(async (req, res) => {
  const s = await publicStore(slugParam(req.params.slug));
  const v = await pool.query(`${VEHICLE_SELECT} WHERE v.id=$1 AND v.dealership_id=$2 AND v.public_listed AND v.status IN ('AVAILABLE','RESERVED')`, [uuidParam(req.params.id), s.id]);
  if (!v.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ store: { name: s.name, slug: s.slug, whatsapp: s.whatsapp ?? null, city: s.city ?? null, state: s.state ?? null }, vehicle: vehicleView(v.rows[0]) });
}));

const publicLead = z.object({
  name: z.string().trim().min(2).max(80),
  phone: phoneZ.nullish(),
  email: emailZ.nullish(),
  message: z.string().trim().max(500).default(''),
  vehicleId: z.string().uuid().nullish(),
  consent: z.literal(true),
  website: z.string().max(200).optional() // isca para robôs: pessoas não veem nem preenchem
}).strict();

dealerPublicRouter.post('/public/stores/:slug/leads', leadLimiter, asyncRoute(async (req, res) => {
  const s = await publicStore(slugParam(req.params.slug));
  const parsed = publicLead.safeParse(req.body);
  if (!parsed.success) throw bad('Informe seu nome, um telefone ou e-mail e aceite o contato.');
  const b = parsed.data;
  if (b.website) { res.status(202).json({ ok: true }); return; }
  if (!b.phone && !b.email) throw bad('Informe um telefone ou e-mail para retorno.');

  let vehicleId: string | null = null; let vehicleName = '';
  if (b.vehicleId) {
    const v = await pool.query(`SELECT id,brand,model,year_model FROM stock_vehicles WHERE id=$1 AND dealership_id=$2 AND public_listed AND status IN ('AVAILABLE','RESERVED')`, [b.vehicleId, s.id]);
    if (!v.rowCount) throw notFound('Veículo não encontrado.', 'DEALER_VEHICLE_NOT_FOUND');
    vehicleId = String(v.rows[0].id); vehicleName = [v.rows[0].brand, v.rows[0].model, v.rows[0].year_model].filter(Boolean).join(' ');
  }

  const created = await tx(async (client) => {
    // mesma pessoa, mesma loja e mesmo veículo em 24 h: não duplica, só registra a nova mensagem
    const dup = await client.query(`SELECT id FROM dealer_leads WHERE dealership_id=$1 AND ((phone IS NOT NULL AND phone=$2) OR (email IS NOT NULL AND email=$3))
      AND vehicle_id IS NOT DISTINCT FROM $4 AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [s.id, b.phone ?? null, b.email ?? null, vehicleId]);
    if (dup.rowCount) {
      if (b.message) await client.query(`INSERT INTO dealer_lead_events(lead_id,type,note) VALUES($1,'NOTE',$2)`, [dup.rows[0].id, `Nova mensagem pela vitrine: ${b.message}`]);
      await client.query('UPDATE dealer_leads SET updated_at=now() WHERE id=$1', [dup.rows[0].id]);
      return null;
    }
    const r = await client.query(`INSERT INTO dealer_leads(dealership_id,vehicle_id,name,phone,email,source,notes,consent_at) VALUES($1,$2,$3,$4,$5,'VITRINE',$6,now()) RETURNING id`,
      [s.id, vehicleId, b.name, b.phone ?? null, b.email ?? null, b.message]);
    await client.query(`INSERT INTO dealer_lead_events(lead_id,type,to_stage,note) VALUES($1,'CREATED','NEW','Pela vitrine da loja')`, [r.rows[0].id]);
    return String(r.rows[0].id);
  });

  if (created) {
    try { // aviso por e-mail é um extra: se falhar, o lead já está salvo
      const to = (s.email as string | null) ?? ((await pool.query('SELECT email FROM users WHERE id=$1', [s.owner_user_id])).rows[0]?.email as string | undefined);
      if (to) await enqueueEmail({ idempotencyKey: `dealer-lead:${created}`, template: 'GENERIC_NOTICE', toEmail: to, relatedType: 'DEALER_LEAD', relatedId: created,
        data: { name: String(s.name), message: `Novo contato pela vitrine${vehicleName ? ` sobre ${vehicleName}` : ''}: ${b.name}${b.phone ? `, ${b.phone}` : ''}. Veja no painel da loja: ${publicAppUrl()}/app/loja/leads` } });
    } catch (e) { log('warn', 'dealer.lead_notice_failed', { error: e instanceof Error ? e.message : String(e) }); }
  }
  res.status(created ? 201 : 200).json({ ok: true });
}));
