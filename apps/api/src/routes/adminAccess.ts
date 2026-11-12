import { Router } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { env } from '../config.js';
import { pool, tx } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { ACCESS_FEATURES, ACCESS_LABEL, resolveAccess, type AccessFeature } from '../lib/access.js';
import { loadProfileState } from '../lib/profiles.js';
import { requirePermission } from '../permissions.js';
import { createDealership } from '../dealer/create.js';
import { phoneZ, slugify } from '../dealer/context.js';

/**
 * Pacote e acessos de cada conta de cliente, decididos pelo administrador:
 *  - ativar ou suspender a loja (área do lojista + vitrine pública) da conta, valendo na hora;
 *  - ligar ou desligar recursos da conta (garagem, monitoramento).
 * Tudo exige MANAGE_CUSTOMERS e fica na auditoria.
 */
export const adminAccessRouter = Router();
adminAccessRouter.use(adminAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (message = 'Confira os dados informados.', code = 'INVALID_INPUT') => appError(message, { code, http: 400, expose: true, showMessage: true });

async function customer(id: string): Promise<{ id: string; name: string; email: string; companyName: string | null; legalName: string | null; phone: string | null; city: string | null; state: string | null; customerType: string | null; accessOverrides: unknown }> {
  if (!UUID.test(id)) throw appError('Cliente não encontrado.', { code: 'CUSTOMER_NOT_FOUND', http: 404, expose: true, showMessage: true });
  const r = await pool.query(`SELECT u.id,u.name,u.email,u.access_overrides,p.company_name,p.legal_name,p.phone,p.city,p.state,p.customer_type
    FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.role='CLIENTE' AND u.deleted_at IS NULL`, [id]);
  if (!r.rowCount) throw appError('Cliente não encontrado.', { code: 'CUSTOMER_NOT_FOUND', http: 404, expose: true, showMessage: true });
  const x = r.rows[0];
  return { id: String(x.id), name: String(x.name), email: String(x.email), companyName: x.company_name ?? null, legalName: x.legal_name ?? null, phone: x.phone ?? null, city: x.city ?? null, state: x.state ?? null, customerType: x.customer_type ?? null, accessOverrides: x.access_overrides };
}

/** A loja da conta: a que ela é dona ou, se não for dona, aquela de que participa. */
async function storeOf(userId: string): Promise<Record<string, unknown> | null> {
  const owned = await pool.query('SELECT * FROM dealerships WHERE owner_user_id=$1 LIMIT 1', [userId]);
  if (owned.rowCount) return { ...owned.rows[0], member_role: 'OWNER' };
  const member = await pool.query(`SELECT d.*, m.role AS member_role FROM dealership_members m JOIN dealerships d ON d.id=m.dealership_id WHERE m.user_id=$1 AND m.active LIMIT 1`, [userId]);
  return member.rowCount ? member.rows[0] as Record<string, unknown> : null;
}

async function present(c: Awaited<ReturnType<typeof customer>>) {
  const store = await storeOf(c.id);
  const storeActive = Boolean(store && store.active && !store.archived_at);
  const profile = await loadProfileState(c.id, { hasStore: storeActive });
  const access = resolveAccess(c.accessOverrides);
  const lim = await pool.query('SELECT u.fipe_daily_limit, (SELECT value FROM platform_settings WHERE key=\'safe_business\') AS safe FROM users u WHERE u.id=$1', [c.id]);
  const configured = (lim.rows[0]?.safe as Record<string, unknown> | null)?.fipeAuthDailyLimit;
  const fipeDefaultLimit = typeof configured === 'number' && configured > 0 ? configured : env.FIPE_AUTH_DAILY_LIMIT;
  const used = await pool.query('SELECT count FROM fipe_usage WHERE scope_key=$1 AND bucket_date=$2', [`v2:user:${c.id}`, new Date().toISOString().slice(0, 10)]);
  const vehicles = store ? Number((await pool.query(`SELECT count(*)::int AS n FROM stock_vehicles WHERE dealership_id=$1 AND status IN ('AVAILABLE','RESERVED')`, [store.id])).rows[0].n) : 0;
  return {
    customerId: c.id,
    fipeDailyLimit: lim.rows[0]?.fipe_daily_limit === null || lim.rows[0]?.fipe_daily_limit === undefined ? null : Number(lim.rows[0].fipe_daily_limit), fipeDefaultLimit, fipeUsedToday: Number(used.rows[0]?.count ?? 0),
    features: ACCESS_FEATURES.map((key) => ({ key, label: ACCESS_LABEL[key], enabled: access[key] })),
    store: store ? {
      id: String(store.id), name: String(store.name), slug: String(store.slug), active: Boolean(store.active), archived: Boolean(store.archived_at), publicEnabled: Boolean(store.public_enabled),
      vehicleLimit: Number(store.vehicle_limit), memberLimit: Number(store.member_limit), vehicles, role: String(store.member_role), city: (store.city as string | null) ?? null, state: (store.state as string | null) ?? null
    } : null,
    profiles: profile.profiles, activeProfile: profile.activeProfile,
    suggestedStoreName: (c.companyName || c.legalName || c.name).slice(0, 80)
  };
}

adminAccessRouter.get('/customers/:id/access', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  res.json(await present(await customer(String(req.params.id))));
}));

const accessBody = z.object({ features: z.record(z.string(), z.boolean()) }).strict();

/** Liga ou desliga recursos da conta. Ligar apaga a marca de "desligado", então a conta volta ao padrão. */
adminAccessRouter.put('/customers/:id/access', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const c = await customer(String(req.params.id));
  const body = accessBody.safeParse(req.body);
  if (!body.success || !Object.keys(body.data.features).length) throw bad();
  const changes = Object.entries(body.data.features);
  if (changes.some(([k]) => !(ACCESS_FEATURES as readonly string[]).includes(k))) throw bad('Recurso desconhecido.', 'UNKNOWN_FEATURE');
  const current = (c.accessOverrides && typeof c.accessOverrides === 'object' ? { ...(c.accessOverrides as Record<string, unknown>) } : {}) as Record<string, unknown>;
  for (const [k, enabled] of changes) { if (enabled) delete current[k]; else current[k] = false; }
  await pool.query('UPDATE users SET access_overrides=$2::jsonb WHERE id=$1', [c.id, JSON.stringify(current)]);
  await audit(req.user!.id, 'ADMIN_ACCESS_UPDATED', 'USER', c.id, { features: Object.fromEntries(changes), requestId: requestId(req) });
  res.json(await present({ ...c, accessOverrides: current }));
}));

const fipeLimitBody = z.object({ limit: z.number().int().min(1).max(100000).nullable() }).strict();

/** Limite diário de FIPE grátis desta conta. Vazio (null) = usa o padrão do sistema (Sistema → configurações). */
adminAccessRouter.put('/customers/:id/fipe-limit', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const c = await customer(String(req.params.id));
  const body = fipeLimitBody.safeParse(req.body);
  if (!body.success) throw bad('Informe um número de 1 a 100000, ou deixe vazio para usar o padrão.');
  await pool.query('UPDATE users SET fipe_daily_limit=$2 WHERE id=$1', [c.id, body.data.limit]);
  await audit(req.user!.id, 'ADMIN_FIPE_LIMIT_UPDATED', 'USER', c.id, { limit: body.data.limit, requestId: requestId(req) });
  res.json(await present(c));
}));

const storeBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(40).optional(),
  whatsapp: phoneZ.nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullish(),
  publicEnabled: z.boolean().optional(),
  vehicleLimit: z.number().int().min(1).max(10_000).optional(),
  memberLimit: z.number().int().min(1).max(200).optional()
}).strict();

/**
 * Ativa a loja da conta (cria ou reativa) e já coloca a pessoa no perfil de lojista, para o menu da loja aparecer no próximo carregamento.
 * Nome, cidade, UF e WhatsApp vêm do cadastro do cliente; o dono ajusta o resto em Minha loja.
 */
adminAccessRouter.post('/customers/:id/store', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const c = await customer(String(req.params.id));
  const body = storeBody.safeParse(req.body ?? {});
  if (!body.success) throw bad();
  const b = body.data;
  const existing = await pool.query('SELECT id FROM dealerships WHERE owner_user_id=$1', [c.id]);
  let storeId: string; let created = false;
  if (existing.rowCount) {
    storeId = String(existing.rows[0].id);
    await tx(async (client) => {
      await client.query(`UPDATE dealerships SET active=true, archived_at=NULL, updated_at=now() WHERE id=$1`, [storeId]);
      await client.query(`INSERT INTO dealership_members(dealership_id,user_id,role,active) VALUES($1,$2,'OWNER',true) ON CONFLICT(dealership_id,user_id) DO UPDATE SET role='OWNER',active=true,updated_at=now()`, [storeId, c.id]);
    });
  } else {
    const phone = b.whatsapp ? { success: true as const, data: b.whatsapp } : c.phone ? phoneZ.safeParse(c.phone) : null;
    const state = b.state ?? (c.state && /^[A-Za-z]{2}$/.test(c.state) ? c.state.toUpperCase() : null);
    const name = b.name ?? (c.companyName || c.legalName || c.name).slice(0, 80);
    const store = await createDealership(c.id, { name: name.length >= 2 ? name : c.name, slug: b.slug ?? slugify(name), whatsapp: phone?.success ? phone.data : null, city: b.city ?? c.city, state });
    storeId = store.id; created = true;
  }
  const sets: string[] = []; const values: unknown[] = [];
  if (b.publicEnabled !== undefined) { values.push(b.publicEnabled); sets.push(`public_enabled=$${values.length}`); }
  if (b.vehicleLimit !== undefined) { values.push(b.vehicleLimit); sets.push(`vehicle_limit=$${values.length}`); }
  if (b.memberLimit !== undefined) { values.push(b.memberLimit); sets.push(`member_limit=$${values.length}`); }
  if (sets.length) { values.push(storeId); await pool.query(`UPDATE dealerships SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length}`, values); }
  await pool.query(`UPDATE users SET active_profile='LOJISTA' WHERE id=$1`, [c.id]);
  await audit(req.user!.id, created ? 'ADMIN_STORE_ENABLED' : 'ADMIN_STORE_REACTIVATED', 'DEALERSHIP', storeId, { owner: c.id, requestId: requestId(req) });
  res.status(created ? 201 : 200).json(await present(c));
}));

/** Suspende a loja da conta (some a vitrine e o menu do lojista). Os veículos e a equipe ficam guardados; ativar de novo traz tudo de volta. */
adminAccessRouter.post('/customers/:id/store/disable', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const c = await customer(String(req.params.id));
  const store = await storeOf(c.id);
  if (!store) throw appError('Esta conta não tem loja.', { code: 'DEALER_NOT_FOUND', http: 404, expose: true, showMessage: true });
  await pool.query('UPDATE dealerships SET active=false, updated_at=now() WHERE id=$1', [store.id]);
  await pool.query(`UPDATE users SET active_profile='CLIENTE' WHERE id=$1`, [c.id]);
  await audit(req.user!.id, 'ADMIN_STORE_SUSPENDED', 'DEALERSHIP', String(store.id), { owner: c.id, requestId: requestId(req) });
  res.json(await present(c));
}));

export type { AccessFeature };
