import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth, auth } from '../auth.js';
import { env, publicAppUrl } from '../config.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { enqueueEmail } from '../lib/emailOutbox.js';
import { hashIp } from '../lib/totpFlow.js';
import {
  CAPTURE_TOOLS, CHANNELS, CHANNEL_SQL, CONSUMPTION_JOIN, KINDS, LEVELS, LEVEL_SQL, PROFILES, PROFILE_SQL, STAGES, channelOf, classifyConsumption, addLeadEvent, claimLeadLink, cleanLinkCode, createLeadLink, normEmail, normPhone, phoneForAds,
  publicLeadLink, recordLeadLinkClick, refreshLeads, sessionKeyFor, sha256Hex, unsubscribeByToken, unsubscribeUrl, upsertLead, type LeadKind
} from '../lib/leads.js';

/**
 * CRM de leads do site + links de consulta enviados pela equipe.
 * Público: captura (com aceite de marketing opcional), abertura do link, descadastro. Painel: esteira, detalhe, contato, links, campanha, exportação.
 */
export const leadsPublicRouter = Router();
export const adminLeadsRouter = Router();
adminLeadsRouter.use(adminAuth);

const sourceIp = (req: Request): string | undefined => {
  const cf = req.get('cf-connecting-ip')?.trim();
  return cf && isIP(cf) ? cf : req.ip;
};
const publicLimit = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
const clickLimit = rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
const invalid = () => appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
const first = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] ?? '';

// ------------------------------------------------------------------ público

const captureSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  kind: z.enum(KINDS).optional(),
  tool: z.enum(CAPTURE_TOOLS),
  interest: z.string().trim().max(160).optional(),
  consent: z.boolean().optional().default(false),
  sessionId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/).optional(),
  utm: z.record(z.string().max(60), z.string().max(160)).optional(),
  website: z.string().max(200).optional() // campo-armadilha: pessoa não vê, robô preenche
}).strict();

leadsPublicRouter.post('/leads/capture', publicLimit, asyncRoute(async (req, res) => {
  const parsed = captureSchema.safeParse(req.body);
  if (!parsed.success) throw invalid();
  const d = parsed.data;
  if (d.website) { res.status(201).json({ ok: true }); return; }
  if (!normEmail(d.email) && !normPhone(d.phone)) throw appError('LEAD_CONTACT_INVALID', { code: 'LEAD_CONTACT_INVALID', http: 400, expose: true });
  await upsertLead({
    name: d.name, email: d.email, phone: d.phone, kind: d.kind, source: d.tool, interest: d.interest, utm: d.utm,
    sessionKey: sessionKeyFor(d.sessionId), consent: { granted: d.consent, ipHash: hashIp(sourceIp(req)) }
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ ok: true }); // não diz se a pessoa já existia
}));

leadsPublicRouter.post('/leads/unsubscribe', publicLimit, asyncRoute(async (req, res) => {
  const parsed = z.object({ token: z.string().max(120) }).strict().safeParse(req.body);
  if (!parsed.success) throw invalid();
  const ok = await unsubscribeByToken(parsed.data.token);
  if (!ok) throw appError('UNSUBSCRIBE_INVALID', { code: 'UNSUBSCRIBE_INVALID', http: 400, expose: true });
  res.json({ ok: true });
}));

leadsPublicRouter.get('/lead-links/:code', clickLimit, asyncRoute(async (req, res) => {
  const info = await publicLeadLink(req.params.code);
  res.setHeader('Cache-Control', 'no-store');
  res.json(info ?? { valid: false, expired: false });
}));

leadsPublicRouter.post('/lead-links/:code/click', clickLimit, asyncRoute(async (req, res) => {
  const ok = await recordLeadLinkClick(req.params.code);
  res.json({ valid: ok });
}));

/** Para quem entrou por Google (ou já tinha sessão): liga a conta nova ao link, só se a conta for recente. */
leadsPublicRouter.post('/me/lead-link/claim', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(4).max(20), sessionId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/).optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) throw invalid();
  const fresh = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role='CLIENTE' AND created_at > now() - interval '7 days'`, [req.user!.id]);
  if (!fresh.rowCount) { res.json({ linked: false }); return; }
  const r = await claimLeadLink(req.user!.id, parsed.data.code, { sessionKey: sessionKeyFor(parsed.data.sessionId) });
  if (r.linked) await audit(req.user!.id, 'LEAD_LINK_CLAIMED', 'USER', req.user!.id, { requestId: requestId(req) });
  res.json(r);
}));

// ------------------------------------------------------------------ painel

const uuid = z.string().uuid();
const stageEnum = z.enum(STAGES);

function whereFromQuery(q: Record<string, unknown>): { where: string; params: unknown[]; join: string } {
  const conds: string[] = []; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (typeof q.stage === 'string' && (STAGES as readonly string[]).includes(q.stage)) add('l.stage=?', q.stage);
  if (typeof q.kind === 'string' && (KINDS as readonly string[]).includes(q.kind)) add('l.kind=?', q.kind);
  if (typeof q.source === 'string' && /^[A-Z_]{2,30}$/.test(q.source)) add('l.source=?', q.source);
  let join = '';
  if (typeof q.channel === 'string' && (CHANNELS as readonly string[]).includes(q.channel)) add(`${CHANNEL_SQL}=?`, q.channel);
  if (typeof q.profile === 'string' && (PROFILES as readonly string[]).includes(q.profile)) { join = CONSUMPTION_JOIN; add(`${PROFILE_SQL}=?`, q.profile); }
  if (typeof q.notprofile === 'string' && (PROFILES as readonly string[]).includes(q.notprofile)) { join = CONSUMPTION_JOIN; conds.push(`${PROFILE_SQL} IS DISTINCT FROM '${q.notprofile}'`); }
  if (typeof q.level === 'string' && (LEVELS as readonly string[]).includes(q.level)) { join = CONSUMPTION_JOIN; add(`${LEVEL_SQL}=?`, q.level); }
  if (typeof q.tag === 'string' && q.tag.trim()) add('? = ANY(l.tags)', q.tag.trim().toLowerCase().slice(0, 30));
  if (q.consent === '1') conds.push('l.marketing_consent=true AND l.unsubscribed_at IS NULL');
  if (q.followup === '1') conds.push(`l.next_contact_at IS NOT NULL AND l.next_contact_at <= now() AND l.stage NOT IN ('CLIENTE','PERDIDO')`);
  if (q.stale === '1') conds.push(`l.stage IN ('NOVO','CONTATADO','INTERESSADO') AND coalesce(l.last_contact_at,l.created_at) < now() - interval '7 days'`);
  if (typeof q.q === 'string' && q.q.trim()) {
    params.push(`%${q.q.trim().slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
    const n = params.length;
    conds.push(`(l.name ILIKE $${n} OR l.email ILIKE $${n} OR l.phone LIKE $${n})`);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params, join };
}
const LEAD_COLS = `l.id,l.name,l.email,l.phone,l.kind,l.stage,l.source,l.interest,l.tags,l.marketing_consent,l.unsubscribed_at,l.user_id,l.owner_id,
  l.first_seen_at,l.last_seen_at,l.last_contact_at,l.next_contact_at,l.created_at,l.utm`;
const leadOut = (r: Record<string, unknown>) => ({
  id: String(r.id), name: r.name ? String(r.name) : null, email: r.email ? String(r.email) : null, phone: r.phone ? String(r.phone) : null,
  kind: String(r.kind), stage: String(r.stage), source: String(r.source), interest: r.interest ? String(r.interest) : null,
  tags: (r.tags as string[]) ?? [], marketingConsent: Boolean(r.marketing_consent) && !r.unsubscribed_at, unsubscribed: Boolean(r.unsubscribed_at),
  userId: r.user_id ? String(r.user_id) : null, ownerId: r.owner_id ? String(r.owner_id) : null,
  firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, lastContactAt: r.last_contact_at ?? null, nextContactAt: r.next_contact_at ?? null, createdAt: r.created_at,
  origin: { channel: channelOf(r.utm as Record<string, unknown> | null, String(r.source)), campaign: typeof (r.utm as Record<string, unknown> | null)?.utm_campaign === 'string' ? String((r.utm as Record<string, unknown>).utm_campaign) : null }
});

/** Consumo do contato com conta: quantas consultas pagas, quanto gastou, quais consultas, e o tipo/nível que isso dá. */
const consumptionOut = (r: Record<string, unknown>) => {
  const n = Number(r.q_n ?? 0); const spent = Number(r.q_spent ?? 0);
  const cls = classifyConsumption(n, Number(r.q_n90 ?? 0), spent);
  return { queries: n, spentCents: spent, lastQueryAt: r.q_last ?? null, products: ((r.q_products as string[] | null) ?? []).filter(Boolean), profile: cls.profile, level: cls.level };
};

adminLeadsRouter.get('/summary', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (_req, res) => {
  await refreshLeads();
  const [stages, sources, totals, links, channels, consumption] = await Promise.all([
    pool.query(`SELECT stage, count(*)::int AS n FROM site_leads GROUP BY stage`),
    pool.query(`SELECT source, count(*)::int AS n FROM site_leads GROUP BY source ORDER BY n DESC LIMIT 12`),
    pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7,
        count(*) FILTER (WHERE marketing_consent AND unsubscribed_at IS NULL)::int AS consented,
        count(*) FILTER (WHERE next_contact_at IS NOT NULL AND next_contact_at <= now() AND stage NOT IN ('CLIENTE','PERDIDO'))::int AS followups,
        count(*) FILTER (WHERE stage IN ('NOVO','CONTATADO','INTERESSADO') AND coalesce(last_contact_at,created_at) < now() - interval '7 days')::int AS stale
      FROM site_leads`),
    pool.query(`SELECT count(*)::int AS total, coalesce(sum(clicks),0)::int AS clicks, count(registered_at)::int AS registered FROM lead_links`),
    pool.query(`SELECT ${CHANNEL_SQL} AS channel, count(*)::int AS n FROM site_leads l GROUP BY 1 ORDER BY n DESC`),
    pool.query(`SELECT ${PROFILE_SQL} AS profile, ${LEVEL_SQL} AS level, count(*)::int AS n FROM site_leads l ${CONSUMPTION_JOIN} WHERE l.user_id IS NOT NULL GROUP BY 1,2`)
  ]);
  const profiles: Record<string, number> = { ESPORADICO: 0, RECORRENTE: 0 }; const levels: Record<string, number> = { BRONZE: 0, PRATA: 0, OURO: 0 };
  for (const r of consumption.rows) { if (r.profile) profiles[String(r.profile)] = (profiles[String(r.profile)] ?? 0) + Number(r.n); if (r.level) levels[String(r.level)] = (levels[String(r.level)] ?? 0) + Number(r.n); }
  const by: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of stages.rows) by[String(r.stage)] = Number(r.n);
  const t = totals.rows[0]!; const k = links.rows[0]!;
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    stages: by, sources: sources.rows.map((r) => ({ source: String(r.source), n: Number(r.n) })),
    total: Number(t.total), new7: Number(t.new7), consented: Number(t.consented), followups: Number(t.followups), stale: Number(t.stale),
    links: { total: Number(k.total), clicks: Number(k.clicks), registered: Number(k.registered) },
    channels: channels.rows.map((r) => ({ channel: String(r.channel), n: Number(r.n) })), profiles, levels, siteUrl: publicAppUrl()
  });
}));

adminLeadsRouter.get('/leads', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  await refreshLeads();
  const built = whereFromQuery(req.query as Record<string, unknown>);
  const where = built.where;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const order = req.query.sort === 'contact' ? 'l.next_contact_at ASC NULLS LAST, l.last_seen_at DESC' : 'l.last_seen_at DESC';
  const [rows, count] = await Promise.all([
    pool.query(`SELECT ${LEAD_COLS},
        coalesce(c.n,0) AS q_n, coalesce(c.n90,0) AS q_n90, coalesce(c.spent,0) AS q_spent, c.last_at AS q_last, coalesce(c.products,'{}') AS q_products
      FROM site_leads l ${CONSUMPTION_JOIN} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, built.params),
    pool.query(`SELECT count(*)::int AS n FROM site_leads l ${built.join} ${where}`, built.params)
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ total: Number(count.rows[0]!.n), leads: rows.rows.map((r) => ({ ...leadOut(r), ...consumptionOut(r) })) });
}));

adminLeadsRouter.get('/leads/:id', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  const lead = await pool.query(`SELECT ${LEAD_COLS}, l.notes, l.session_key, l.consent_at FROM site_leads l WHERE l.id=$1`, [req.params.id]);
  if (!lead.rowCount) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  const l = lead.rows[0]!;
  const [events, funnel, links, account] = await Promise.all([
    pool.query(`SELECT e.id,e.kind,e.detail,e.created_at,u.name AS actor FROM site_lead_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.lead_id=$1 ORDER BY e.id DESC LIMIT 100`, [req.params.id]),
    pool.query(`SELECT event_type,metadata,created_at FROM funnel_events WHERE (session_key IS NOT NULL AND session_key=$1) OR (user_id IS NOT NULL AND user_id=$2) ORDER BY id DESC LIMIT 60`, [l.session_key ?? null, l.user_id ?? null]),
    pool.query(`SELECT id,code,kind,product_id,plate,channel,expires_at,revoked_at,clicks,last_click_at,registered_at,created_at FROM lead_links WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.params.id]),
    l.user_id ? pool.query(`SELECT coalesce(c.n,0) AS q_n, coalesce(c.n90,0) AS q_n90, coalesce(c.spent,0) AS q_spent, c.last_at AS q_last, coalesce(c.products,'{}') AS q_products
        FROM site_leads l ${CONSUMPTION_JOIN} WHERE l.id=$1`, [req.params.id]) : Promise.resolve(null)
  ]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    lead: { ...leadOut(l), notes: l.notes ? String(l.notes) : '', utm: l.utm ?? {}, consentAt: l.consent_at ?? null },
    account: account?.rowCount ? consumptionOut(account.rows[0]!) : null,
    events: events.rows.map((e) => ({ id: Number(e.id), kind: String(e.kind), detail: e.detail ?? {}, actor: e.actor ? String(e.actor) : null, at: e.created_at })),
    site: funnel.rows.map((f) => ({ type: String(f.event_type), path: (f.metadata as Record<string, unknown> | null)?.path ?? null, at: f.created_at })),
    links: links.rows.map((k) => ({ id: String(k.id), code: String(k.code), url: new URL(`/c/${k.code}`, publicAppUrl()).toString(), kind: String(k.kind), productId: k.product_id ? String(k.product_id) : null, channel: String(k.channel), expiresAt: k.expires_at, revoked: Boolean(k.revoked_at), clicks: Number(k.clicks), lastClickAt: k.last_click_at ?? null, registeredAt: k.registered_at ?? null, createdAt: k.created_at }))
  });
}));

const tagSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9áàâãéêíóôõúç _-]{1,30}$/);
const patchSchema = z.object({
  stage: stageEnum.optional(), name: z.string().trim().max(120).nullable().optional(), phone: z.string().trim().max(30).nullable().optional(),
  kind: z.enum(KINDS).optional(), tags: z.array(tagSchema).max(20).optional(), notes: z.string().max(2000).optional(),
  nextContactAt: z.string().datetime().nullable().optional(), ownerId: uuid.nullable().optional()
}).strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');

adminLeadsRouter.patch('/leads/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = uuid.safeParse(req.params.id); const parsed = patchSchema.safeParse(req.body);
  if (!id.success || !parsed.success) throw invalid();
  const d = parsed.data;
  const cur = await pool.query('SELECT stage,email,phone,user_id FROM site_leads WHERE id=$1', [id.data]);
  if (!cur.rowCount) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  let phone: string | null | undefined;
  if (d.phone !== undefined) {
    phone = d.phone ? normPhone(d.phone) : null;
    if (d.phone && !phone) throw appError('PHONE_INVALID', { code: 'PHONE_INVALID', http: 400, expose: true });
    if (!phone && !cur.rows[0]!.email && !cur.rows[0]!.user_id) throw appError('LEAD_CONTACT_REQUIRED', { code: 'LEAD_CONTACT_REQUIRED', http: 400, expose: true });
  }
  if (d.ownerId) {
    const staff = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND role<>'CLIENTE' AND active=true`, [d.ownerId]);
    if (!staff.rowCount) throw appError('OWNER_INVALID', { code: 'OWNER_INVALID', http: 400, expose: true });
  }
  const sets: string[] = ['updated_at=now()']; const params: unknown[] = [id.data];
  const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col}=$${params.length}${cast}`); };
  if (d.stage !== undefined) set('stage', d.stage);
  if (d.name !== undefined) set('name', d.name || null);
  if (phone !== undefined) set('phone', phone);
  if (d.kind !== undefined) set('kind', d.kind);
  if (d.tags !== undefined) set('tags', Array.from(new Set(d.tags)), '::text[]');
  if (d.notes !== undefined) set('notes', d.notes.trim() || null);
  if (d.nextContactAt !== undefined) set('next_contact_at', d.nextContactAt, '::timestamptz');
  if (d.ownerId !== undefined) set('owner_id', d.ownerId);
  await pool.query(`UPDATE site_leads SET ${sets.join(',')} WHERE id=$1`, params);
  if (d.stage !== undefined && d.stage !== cur.rows[0]!.stage) await addLeadEvent(id.data, 'STAGE', { from: cur.rows[0]!.stage, to: d.stage }, req.user!.id);
  if (d.notes !== undefined) await addLeadEvent(id.data, 'NOTE', {}, req.user!.id);
  if (d.nextContactAt !== undefined) await addLeadEvent(id.data, 'FOLLOWUP', { at: d.nextContactAt }, req.user!.id);
  await audit(req.user!.id, 'LEAD_UPDATED', 'LEAD', id.data, { requestId: requestId(req), fields: Object.keys(d) });
  res.json({ ok: true });
}));

const createSchema = z.object({
  name: z.string().trim().max(120).optional(), email: z.string().trim().max(254).optional(), phone: z.string().trim().max(30).optional(),
  kind: z.enum(KINDS).optional(), interest: z.string().trim().max(160).optional()
}).strict();
adminLeadsRouter.post('/leads', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw invalid();
  if (!normEmail(parsed.data.email) && !normPhone(parsed.data.phone)) throw appError('LEAD_CONTACT_INVALID', { code: 'LEAD_CONTACT_INVALID', http: 400, expose: true });
  // Aceite de marketing só vem da própria pessoa: lead cadastrado pela equipe entra sem consentimento.
  const r = await upsertLead({ ...parsed.data, source: 'MANUAL', actorId: req.user!.id });
  await audit(req.user!.id, 'LEAD_CREATED', 'LEAD', r.id, { requestId: requestId(req), created: r.created });
  res.status(r.created ? 201 : 200).json({ id: r.id, created: r.created });
}));

const bulkSchema = z.object({ ids: z.array(uuid).min(1).max(200), stage: stageEnum.optional(), addTag: tagSchema.optional() }).strict().refine((v) => v.stage || v.addTag, 'EMPTY_UPDATE');
adminLeadsRouter.post('/leads/bulk', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) throw invalid();
  const { ids, stage, addTag } = parsed.data;
  if (stage) {
    await pool.query(`INSERT INTO site_lead_events(lead_id,kind,detail,actor_id) SELECT id,'STAGE',jsonb_build_object('from',stage,'to',$2::text,'bulk',true),$3 FROM site_leads WHERE id = ANY($1::uuid[]) AND stage<>$2`, [ids, stage, req.user!.id]);
    await pool.query(`UPDATE site_leads SET stage=$2, updated_at=now() WHERE id = ANY($1::uuid[])`, [ids, stage]);
  }
  if (addTag) await pool.query(`UPDATE site_leads SET tags=(SELECT array_agg(DISTINCT t) FROM unnest(tags || ARRAY[$2]::text[]) t), updated_at=now() WHERE id = ANY($1::uuid[])`, [ids, addTag]);
  await audit(req.user!.id, 'LEAD_BULK_UPDATE', 'LEAD', null, { requestId: requestId(req), count: ids.length, stage: stage ?? null, addTag: addTag ?? null });
  res.json({ ok: true, count: ids.length });
}));

adminLeadsRouter.delete('/leads/:id', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw invalid();
  const cur = await pool.query('SELECT user_id FROM site_leads WHERE id=$1', [id.data]);
  if (!cur.rowCount) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  // Quem tem conta continua no CRM (a conta tem o próprio caminho de exclusão); só contatos soltos podem ser apagados.
  if (cur.rows[0]!.user_id) throw appError('LEAD_HAS_ACCOUNT', { code: 'LEAD_HAS_ACCOUNT', http: 409, expose: true });
  await pool.query('DELETE FROM site_leads WHERE id=$1', [id.data]);
  await audit(req.user!.id, 'LEAD_DELETED', 'LEAD', id.data, { requestId: requestId(req) });
  res.json({ ok: true });
}));

const contactSchema = z.object({ channel: z.enum(['WHATSAPP', 'EMAIL', 'TELEFONE', 'OUTRO']), note: z.string().trim().max(500).optional() }).strict();
/** Anota um contato feito fora do painel (ex.: abriu o WhatsApp). */
adminLeadsRouter.post('/leads/:id/contact', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = uuid.safeParse(req.params.id); const parsed = contactSchema.safeParse(req.body);
  if (!id.success || !parsed.success) throw invalid();
  const up = await pool.query(`UPDATE site_leads SET last_contact_at=now(), stage=CASE WHEN stage='NOVO' THEN 'CONTATADO' ELSE stage END, updated_at=now() WHERE id=$1 RETURNING id`, [id.data]);
  if (!up.rowCount) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  await addLeadEvent(id.data, 'CONTACT', { channel: parsed.data.channel, ...(parsed.data.note ? { note: parsed.data.note } : {}) }, req.user!.id);
  res.json({ ok: true });
}));

const campaignSchema = z.object({
  stage: stageEnum.optional(), kind: z.enum(KINDS).optional(), source: z.string().regex(/^[A-Z_]{2,30}$/).optional(), tag: tagSchema.optional(),
  subject: z.string().trim().min(2).max(120), message: z.string().trim().min(10).max(3000),
  ctaPath: z.string().trim().regex(/^\/[A-Za-z0-9/_\-.?=&%]{0,200}$/).refine((v) => !v.startsWith('//') && !v.includes('..'), 'PATH_INVALID').optional(), ctaLabel: z.string().trim().max(40).optional(),
  dryRun: z.boolean().optional().default(false), leadIds: z.array(uuid).max(500).optional()
}).strict();
const MAX_CAMPAIGN = 500;

async function marketingRecipients(f: z.infer<typeof campaignSchema>) {
  const conds = [`l.email IS NOT NULL`, `l.marketing_consent=true`, `l.unsubscribed_at IS NULL`, `l.stage<>'PERDIDO'`]; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (f.stage) add('l.stage=?', f.stage);
  if (f.kind) add('l.kind=?', f.kind);
  if (f.source) add('l.source=?', f.source);
  if (f.tag) add('? = ANY(l.tags)', f.tag);
  if (f.leadIds?.length) add('l.id = ANY(?::uuid[])', f.leadIds);
  const r = await pool.query(`SELECT l.id,l.name,l.email FROM site_leads l WHERE ${conds.join(' AND ')} ORDER BY l.created_at LIMIT ${MAX_CAMPAIGN + 1}`, params);
  return { capped: r.rows.length > MAX_CAMPAIGN, list: r.rows.slice(0, MAX_CAMPAIGN).map((x) => ({ id: String(x.id), name: x.name ? String(x.name) : null, email: String(x.email) })) };
}

/** Envia (ou só conta, com dryRun) um e-mail de conteúdo para os leads que aceitaram receber. Sempre com link para sair. */
adminLeadsRouter.post('/campaign', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) throw invalid();
  const f = parsed.data;
  const { list: to, capped } = await marketingRecipients(f);
  if (f.dryRun) { res.json({ dryRun: true, recipients: to.length, capped }); return; }
  const day = new Date().toISOString().slice(0, 10);
  const sig = createHash('sha256').update(`${f.subject}\n${f.message}\n${f.ctaPath ?? ''}`).digest('hex').slice(0, 20);
  let queued = 0;
  for (const lead of to) {
    const q = await enqueueEmail({
      idempotencyKey: `lead-campaign:${lead.id}:${sig}:${day}`, template: 'LEAD_MESSAGE', toEmail: lead.email, toName: lead.name,
      data: { name: lead.name ? first(lead.name) : undefined, documentTitle: f.subject, message: f.message, ...(f.ctaPath ? { ctaUrl: `${publicAppUrl()}${f.ctaPath}`, ctaLabel: f.ctaLabel || 'Abrir' } : {}), unsubscribeUrl: unsubscribeUrl(lead.id) },
      relatedType: 'LEAD', relatedId: lead.id, createdBy: req.user!.id
    });
    if (!q.duplicate) {
      queued += 1;
      await pool.query(`UPDATE site_leads SET last_contact_at=now(), stage=CASE WHEN stage='NOVO' THEN 'CONTATADO' ELSE stage END, updated_at=now() WHERE id=$1`, [lead.id]);
      await addLeadEvent(lead.id, 'EMAIL', { subject: f.subject, campaign: true }, req.user!.id);
    }
  }
  await audit(req.user!.id, 'LEAD_CAMPAIGN', 'LEAD', null, { requestId: requestId(req), recipients: to.length, queued, subject: f.subject.slice(0, 80) });
  res.json({ dryRun: false, recipients: to.length, queued, capped });
}));

// ------------------------------------------------------------------ links de consulta

const plateRe = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const linkSchema = z.object({
  leadId: uuid.optional(), name: z.string().trim().max(120).optional(), email: z.string().trim().max(254).optional(), phone: z.string().trim().max(30).optional(),
  kind: z.enum(KINDS).optional(), productId: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/).optional(), plate: z.string().trim().max(16).optional(),
  days: z.number().int().min(1).max(90).optional().default(14), channel: z.enum(['COPIA', 'WHATSAPP', 'EMAIL']).optional().default('COPIA')
}).strict();

const BRAZIL_DIAL = '55';
function linkIntro(kind: LeadKind, name: string | null, plate: string | null, productName: string | null): string {
  const hi = name ? `Olá, ${first(name)}!` : 'Olá!';
  const what = kind === 'LOJISTA'
    ? `Preparei este link para sua loja consultar veículos pela placa${plate ? ` (${plate})` : ''} e conhecer o painel de lojista`
    : `Preparei este link para você fazer a consulta${plate ? ` da placa ${plate}` : ' do veículo'}${productName ? ` (${productName})` : ''}`;
  return `${hi} Aqui é da Placa na Mão. ${what}`;
}

adminLeadsRouter.post('/links', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) throw invalid();
  const d = parsed.data;
  let plate: string | null = null;
  if (d.plate) {
    plate = d.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!plateRe.test(plate)) throw appError('INVALID_PLATE', { code: 'INVALID_PLATE', http: 400, expose: true });
  }
  let productName: string | null = null;
  if (d.productId) {
    const p = await pool.query(`SELECT name FROM query_products WHERE id=$1 AND active=true AND is_free=false`, [d.productId]);
    if (!p.rowCount) throw appError('PRODUCT_INVALID', { code: 'PRODUCT_INVALID', http: 400, expose: true });
    productName = String(p.rows[0]!.name);
  }
  let leadId = d.leadId ?? null;
  if (leadId) {
    const ex = await pool.query('SELECT id FROM site_leads WHERE id=$1', [leadId]);
    if (!ex.rowCount) throw appError('LEAD_NOT_FOUND', { code: 'LEAD_NOT_FOUND', http: 404, expose: true });
  } else {
    if (!normEmail(d.email) && !normPhone(d.phone)) throw appError('LEAD_CONTACT_INVALID', { code: 'LEAD_CONTACT_INVALID', http: 400, expose: true });
    leadId = (await upsertLead({ name: d.name, email: d.email, phone: d.phone, kind: d.kind, source: 'LINK_ADMIN', actorId: req.user!.id })).id;
  }
  const lead = (await pool.query('SELECT id,name,email,phone,kind,unsubscribed_at FROM site_leads WHERE id=$1', [leadId])).rows[0]!;
  const kind: LeadKind = (d.kind ?? String(lead.kind)) === 'LOJISTA' ? 'LOJISTA' : 'CLIENTE';
  if (d.channel === 'EMAIL') {
    if (!lead.email) throw appError('LEAD_NO_EMAIL', { code: 'LEAD_NO_EMAIL', http: 409, expose: true });
    if (lead.unsubscribed_at) throw appError('LEAD_UNSUBSCRIBED', { code: 'LEAD_UNSUBSCRIBED', http: 409, expose: true });
  }
  const link = await createLeadLink({ createdBy: req.user!.id, leadId, recipientName: lead.name ? String(lead.name) : d.name ?? null, kind, productId: d.productId ?? null, plate, channel: d.channel, days: d.days });
  const intro = linkIntro(kind, lead.name ? String(lead.name) : null, plate, productName);
  const text = `${intro}: ${link.url}\nÉ só abrir, criar o seu acesso e fazer a consulta.`;
  if (d.channel === 'EMAIL') {
    await enqueueEmail({
      idempotencyKey: `lead-link:${link.id}`, template: 'LEAD_MESSAGE', toEmail: String(lead.email), toName: lead.name ? String(lead.name) : null,
      data: { name: lead.name ? first(lead.name) : undefined, documentTitle: 'Seu link para consultar o veículo', message: `${intro}.\nÉ só abrir o botão, criar o seu acesso e fazer a consulta.`, ctaUrl: link.url, ctaLabel: 'Fazer a consulta', unsubscribeUrl: unsubscribeUrl(leadId) },
      relatedType: 'LEAD', relatedId: leadId, createdBy: req.user!.id
    });
  }
  await pool.query(`UPDATE site_leads SET last_contact_at=CASE WHEN $2::text <> 'COPIA' THEN now() ELSE last_contact_at END, stage=CASE WHEN stage='NOVO' AND $2::text <> 'COPIA' THEN 'CONTATADO' ELSE stage END, updated_at=now() WHERE id=$1`, [leadId, d.channel]);
  await audit(req.user!.id, 'LEAD_LINK_CREATED', 'LEAD', leadId, { requestId: requestId(req), channel: d.channel, productId: d.productId ?? null });
  const phone = lead.phone ? String(lead.phone) : null;
  res.status(201).json({
    id: link.id, code: link.code, url: link.url, expiresAt: link.expiresAt, text,
    whatsappUrl: phone ? `https://wa.me/${BRAZIL_DIAL}${phone}?text=${encodeURIComponent(text)}` : null,
    emailSent: d.channel === 'EMAIL', lead: { id: leadId, name: lead.name ? String(lead.name) : null, email: lead.email ? String(lead.email) : null, phone }
  });
}));

adminLeadsRouter.get('/links', requirePermission('VIEW_CUSTOMERS'), asyncRoute(async (_req, res) => {
  const r = await pool.query(
    `SELECT k.id,k.code,k.kind,k.product_id,k.plate,k.channel,k.expires_at,k.revoked_at,k.clicks,k.last_click_at,k.registered_at,k.created_at,
            l.id AS lead_id,l.name,l.email,l.phone,u.name AS sender
       FROM lead_links k LEFT JOIN site_leads l ON l.id=k.lead_id LEFT JOIN users u ON u.id=k.created_by
      ORDER BY k.created_at DESC LIMIT 200`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ links: r.rows.map((k) => ({
    id: String(k.id), code: String(k.code), url: new URL(`/c/${k.code}`, publicAppUrl()).toString(), kind: String(k.kind), productId: k.product_id ? String(k.product_id) : null,
    plate: k.plate ? `${String(k.plate).slice(0, 3)}****` : null, channel: String(k.channel), expiresAt: k.expires_at, revoked: Boolean(k.revoked_at), expired: new Date(String(k.expires_at)).getTime() < Date.now(),
    clicks: Number(k.clicks), lastClickAt: k.last_click_at ?? null, registeredAt: k.registered_at ?? null, createdAt: k.created_at, sender: k.sender ? String(k.sender) : null,
    lead: k.lead_id ? { id: String(k.lead_id), name: k.name ? String(k.name) : null, email: k.email ? String(k.email) : null, phone: k.phone ? String(k.phone) : null } : null
  })) });
}));

adminLeadsRouter.post('/links/:id/revoke', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const id = uuid.safeParse(req.params.id);
  if (!id.success) throw invalid();
  const r = await pool.query('UPDATE lead_links SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING lead_id', [id.data]);
  if (!r.rowCount) throw appError('LINK_NOT_FOUND', { code: 'LINK_NOT_FOUND', http: 404, expose: true });
  if (r.rows[0]!.lead_id) await addLeadEvent(String(r.rows[0]!.lead_id), 'LINK_REVOKED', {}, req.user!.id);
  await audit(req.user!.id, 'LEAD_LINK_REVOKED', 'LEAD_LINK', id.data, { requestId: requestId(req) });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ exportação

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // não deixa a planilha executar fórmula vinda de texto digitado por visitante
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head: string[], rows: unknown[][]) => `﻿${[head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;

adminLeadsRouter.get('/export', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const built = whereFromQuery(req.query as Record<string, unknown>);
  const where = built.where;
  const r = await pool.query(`SELECT ${LEAD_COLS} FROM site_leads l ${built.join} ${where} ORDER BY l.created_at DESC LIMIT 20000`, built.params);
  await audit(req.user!.id, 'LEAD_EXPORT', 'LEAD', null, { requestId: requestId(req), rows: r.rowCount, kind: 'FULL' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv(['nome', 'email', 'telefone', 'tipo', 'etapa', 'origem', 'interesse', 'etiquetas', 'aceitou_marketing', 'descadastrado', 'criado_em', 'ultimo_contato', 'utm_source', 'utm_medium', 'utm_campaign'],
    r.rows.map((x) => { const u = (x.utm ?? {}) as Record<string, string>; return [x.name, x.email, x.phone, x.kind, x.stage, x.source, x.interest, (x.tags as string[]).join(','), x.marketing_consent && !x.unsubscribed_at ? 'sim' : 'não', x.unsubscribed_at ? 'sim' : 'não', new Date(String(x.created_at)).toISOString(), x.last_contact_at ? new Date(String(x.last_contact_at)).toISOString() : '', u.utm_source, u.utm_medium, u.utm_campaign]; })));
}));

/**
 * Lista para anúncios (público semelhante / remarketing): só quem aceitou marketing e não saiu, com e-mail e telefone em SHA-256.
 * Nenhum dado legível sai daqui.
 */
adminLeadsRouter.get('/export/audience', requirePermission('MANAGE_CUSTOMERS'), asyncRoute(async (req, res) => {
  const built = whereFromQuery({ ...(req.query as Record<string, unknown>), consent: '1' });
  const where = built.where;
  const r = await pool.query(`SELECT l.email,l.phone FROM site_leads l ${where} ORDER BY l.created_at DESC LIMIT 50000`, built.params);
  await audit(req.user!.id, 'LEAD_EXPORT', 'LEAD', null, { requestId: requestId(req), rows: r.rowCount, kind: 'AUDIENCE_HASHED' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="publico-anuncios.csv"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv(['email', 'phone'], r.rows.map((x) => [x.email ? sha256Hex(String(x.email).trim().toLowerCase()) : '', x.phone ? phoneForAds(String(x.phone)) : ''])));
}));

export { cleanLinkCode };
