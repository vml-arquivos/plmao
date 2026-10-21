import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { auth, optionalAuth } from '../auth.js';
import { appError, asyncRoute } from '../lib/http.js';
import { RATING_CATEGORIES, SPEC_FIELDS, SPEC_GROUPS, TIP_CATEGORIES, bestIndexes, computeWinners } from '../lib/vehicleSpecs.js';

/**
 * Guia de veículos (público): busca de modelos, ficha técnica, nota e opinião de donos, dicas e comparador.
 * Visitantes veem o resumo; a ficha completa, as opiniões e o comparador exigem conta (grátis).
 * Nenhum dado pessoal sai daqui: autores de opinião aparecem só como "Nome S.".
 */
export const publicVehiclesRouter = Router();

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const notFound = (code = 'VEHICLE_NOT_FOUND') => appError(code, { code, http: 404, expose: true });
const tipLabel = new Map<string, string>(TIP_CATEGORIES.map((c) => [c.key, c.label]));

const opinionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas opiniões em pouco tempo. Tente novamente mais tarde.' }
});

/** Nome público do autor: primeiro nome + inicial do último sobrenome. */
export function publicAuthorName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Dono verificado';
  const first = parts[0]!;
  const cap = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return parts.length > 1 ? `${cap} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.` : cap;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const CATEGORY_AVG_SQL = RATING_CATEGORIES.map((c) => `round(avg(NULLIF(ratings->>'${c.key}','')::numeric),1) AS c_${c.key}`).join(', ');

interface RatingSummary { count: number; average: number | null; categories: Record<string, number | null>; distribution: Record<string, number> }

async function ratingSummaries(modelIds: string[]): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (!modelIds.length) return out;
  const r = await pool.query(`SELECT model_id, count(*)::int AS n, round(avg(rating)::numeric,1) AS avg, ${CATEGORY_AVG_SQL},
      count(*) FILTER (WHERE rating=1)::int AS d1, count(*) FILTER (WHERE rating=2)::int AS d2, count(*) FILTER (WHERE rating=3)::int AS d3,
      count(*) FILTER (WHERE rating=4)::int AS d4, count(*) FILTER (WHERE rating=5)::int AS d5
    FROM vehicle_opinions WHERE status='APPROVED' AND model_id = ANY($1::uuid[]) GROUP BY model_id`, [modelIds]);
  for (const row of r.rows) {
    out.set(String(row.model_id), {
      count: Number(row.n), average: num(row.avg),
      categories: Object.fromEntries(RATING_CATEGORIES.map((c) => [c.key, num(row[`c_${c.key}`])])),
      distribution: { 1: Number(row.d1), 2: Number(row.d2), 3: Number(row.d3), 4: Number(row.d4), 5: Number(row.d5) }
    });
  }
  return out;
}
const emptySummary = (): RatingSummary => ({ count: 0, average: null, categories: Object.fromEntries(RATING_CATEGORIES.map((c) => [c.key, null])), distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });

const HIGHLIGHT_KEYS = SPEC_FIELDS.filter((f) => f.highlight).map((f) => f.key);
const pickHighlights = (specs: Record<string, unknown>) => Object.fromEntries(HIGHLIGHT_KEYS.filter((k) => specs[k] !== undefined).map((k) => [k, specs[k]]));

const PUBLISHED = `m.status='PUBLISHED' AND m.archived_at IS NULL`;

publicVehiclesRouter.get('/vehicles/spec-fields', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ groups: SPEC_GROUPS, fields: SPEC_FIELDS, ratingCategories: RATING_CATEGORIES, tipCategories: TIP_CATEGORIES });
});

publicVehiclesRouter.get('/vehicles/brands', asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT m.brand, count(*)::int AS total FROM vehicle_models m WHERE ${PUBLISHED} GROUP BY m.brand ORDER BY m.brand`);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ brands: r.rows.map((b) => ({ brand: b.brand, total: Number(b.total) })) });
}));

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(60).optional(),
  type: z.enum(['CAR', 'MOTORCYCLE', 'TRUCK']).optional(),
  body: z.string().trim().max(40).optional(),
  sort: z.enum(['name', 'rating', 'recent']).default('name'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(5000).default(0)
});

publicVehiclesRouter.get('/vehicles', asyncRoute(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) throw bad();
  const where: string[] = [PUBLISHED];
  const params: unknown[] = [];
  const add = (sql: (ph: string) => string, v: unknown) => { params.push(v); where.push(sql(`$${params.length}`)); };
  if (q.data.brand) add((p) => `lower(m.brand) = lower(${p})`, q.data.brand);
  if (q.data.type) add((p) => `m.vehicle_type = ${p}`, q.data.type);
  if (q.data.body) add((p) => `lower(m.body_type) = lower(${p})`, q.data.body);
  for (const token of (q.data.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5)) {
    add((p) => `(m.brand ILIKE ${p} OR m.name ILIKE ${p} OR coalesce(m.body_type,'') ILIKE ${p} OR EXISTS (SELECT 1 FROM vehicle_versions v WHERE v.model_id=m.id AND v.active AND v.name ILIKE ${p}))`, `%${token.replace(/[%_\\]/g, '\\$&')}%`);
  }
  const order = q.data.sort === 'rating' ? 'rating_avg DESC NULLS LAST, rating_count DESC, m.brand, m.name' : q.data.sort === 'recent' ? 'm.updated_at DESC' : 'm.brand, m.name';
  const base = `FROM vehicle_models m LEFT JOIN (SELECT model_id, count(*)::int AS rating_count, round(avg(rating)::numeric,1) AS rating_avg FROM vehicle_opinions WHERE status='APPROVED' GROUP BY model_id) r ON r.model_id=m.id
    LEFT JOIN LATERAL (SELECT v.fuel, v.specs FROM vehicle_versions v WHERE v.model_id=m.id AND v.active ORDER BY v.year_model DESC NULLS LAST, v.display_order, v.name LIMIT 1) fv ON true
    WHERE ${where.join(' AND ')}`;
  const [rows, total] = await Promise.all([
    pool.query(`SELECT m.slug,m.brand,m.name,m.vehicle_type,m.body_type,m.year_from,m.year_to,m.summary,m.image_url,
        (SELECT count(*) FROM vehicle_versions v WHERE v.model_id=m.id AND v.active)::int AS versions,
        coalesce(r.rating_count,0) AS rating_count, r.rating_avg, fv.fuel AS top_fuel, fv.specs AS top_specs,
        EXISTS (SELECT 1 FROM vehicle_consumption_obs o WHERE o.model_id=m.id AND o.status='CONFERIDO') AS has_official
        ${base}
        ORDER BY ${order} LIMIT ${q.data.limit} OFFSET ${q.data.offset}`, params),
    pool.query(`SELECT count(*)::int AS n ${base}`, params)
  ]);
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    total: Number(total.rows[0]?.n ?? 0),
    items: rows.rows.map((m) => ({
      slug: m.slug, brand: m.brand, name: m.name, vehicleType: m.vehicle_type, bodyType: m.body_type, yearFrom: m.year_from, yearTo: m.year_to,
      summary: m.summary, imageUrl: m.image_url, versions: Number(m.versions), ratingCount: Number(m.rating_count), ratingAverage: num(m.rating_avg),
      fuel: m.top_fuel ?? null, officialConsumption: Boolean(m.has_official),
      quick: { cityGasKml: num(m.top_specs?.cons_city_gas_kml), cityEthKml: num(m.top_specs?.cons_city_eth_kml), cityDieselKml: num(m.top_specs?.cons_city_diesel_kml), powerHp: num(m.top_specs?.power_hp), trunkL: num(m.top_specs?.trunk_l) }
    }))
  });
}));

/**
 * Consumo por versão para o ranking e para a calculadora de combustível.
 * `official` = existe observação conferida (Inmetro) ligada à versão; sem isso, o número é o da ficha de referência do modelo.
 */
publicVehiclesRouter.get('/vehicles/economy', asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT v.id, v.name, v.year_model, v.fuel, v.specs, m.slug, m.brand, m.name AS model_name, m.body_type, m.vehicle_type, m.spec_source,
      EXISTS (SELECT 1 FROM vehicle_consumption_obs o WHERE o.version_id=v.id AND o.status='CONFERIDO') AS official
    FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id
    WHERE ${PUBLISHED} AND v.active AND m.vehicle_type='CAR'
      AND (v.specs ? 'cons_city_gas_kml' OR v.specs ? 'cons_city_eth_kml' OR v.specs ? 'cons_city_diesel_kml')
    ORDER BY m.brand, m.name, v.year_model DESC NULLS LAST, v.display_order, v.name LIMIT 500`);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    items: r.rows.map((v) => ({
      versionId: v.id, slug: v.slug, brand: v.brand, model: v.model_name, version: v.name, yearModel: v.year_model, fuel: v.fuel, bodyType: v.body_type, official: Boolean(v.official), source: v.spec_source ?? null,
      cityGasKml: num(v.specs?.cons_city_gas_kml), roadGasKml: num(v.specs?.cons_road_gas_kml), cityEthKml: num(v.specs?.cons_city_eth_kml), roadEthKml: num(v.specs?.cons_road_eth_kml),
      cityDieselKml: num(v.specs?.cons_city_diesel_kml), roadDieselKml: num(v.specs?.cons_road_diesel_kml)
    }))
  });
}));

publicVehiclesRouter.get('/vehicles/search-versions', asyncRoute(async (req, res) => {
  const text = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const params: unknown[] = [];
  const where = [PUBLISHED, 'v.active'];
  for (const token of text.split(/\s+/).filter(Boolean).slice(0, 5)) {
    params.push(`%${token.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(m.brand || ' ' || m.name || ' ' || v.name || ' ' || coalesce(v.year_model::text,'')) ILIKE $${params.length}`);
  }
  const r = await pool.query(`SELECT v.id, v.name, v.year_model, v.fuel, m.slug, m.brand, m.name AS model_name FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id
    WHERE ${where.join(' AND ')} ORDER BY m.brand, m.name, v.year_model DESC NULLS LAST, v.display_order, v.name LIMIT 12`, params);
  res.json({ items: r.rows.map((v) => ({ versionId: v.id, slug: v.slug, label: `${v.brand} ${v.model_name} ${v.name}${v.year_model ? ` ${v.year_model}` : ''}`.replace(/\s+/g, ' ').trim(), fuel: v.fuel })) });
}));

/** Rótulos de versões já escolhidas (usado pelo comparador para montar os "slots" a partir da URL). */
publicVehiclesRouter.get('/vehicles/version-labels', asyncRoute(async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  if (!ids.every(isUuid)) throw bad();
  if (!ids.length) return res.json({ items: [] });
  const r = await pool.query(`SELECT v.id, v.name, v.year_model, m.slug, m.brand, m.name AS model_name FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE v.id = ANY($1::uuid[]) AND v.active AND ${PUBLISHED}`, [ids]);
  res.json({ items: r.rows.map((v) => ({ versionId: v.id, slug: v.slug, label: `${v.brand} ${v.model_name} ${v.name}${v.year_model ? ` ${v.year_model}` : ''}`.replace(/\s+/g, ' ').trim() })) });
}));

publicVehiclesRouter.get('/vehicles/tips', asyncRoute(async (req, res) => {
  const category = typeof req.query.category === 'string' && tipLabel.has(req.query.category) ? req.query.category : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
  const r = await pool.query(`SELECT t.id,t.category,t.title,t.body,t.updated_at FROM vehicle_tips t WHERE t.status='PUBLISHED' AND t.archived_at IS NULL AND t.model_id IS NULL ${category ? 'AND t.category=$2' : ''}
    ORDER BY t.display_order, t.created_at DESC LIMIT $1`, category ? [limit, category] : [limit]);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ tips: r.rows.map((t) => ({ id: t.id, category: t.category, categoryLabel: tipLabel.get(t.category) ?? t.category, title: t.title, body: t.body })) });
}));

// ---------------------------------------------------------------- comparador (exige conta)
publicVehiclesRouter.get('/vehicles/compare', auth, asyncRoute(async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length || !ids.every(isUuid)) throw bad('COMPARE_NEEDS_2_OR_3');
  const r = await pool.query(`SELECT v.id AS version_id, v.name AS version_name, v.year_model, v.fuel, v.fipe_code, v.specs, m.id AS model_id, m.slug, m.brand, m.name AS model_name, m.vehicle_type, m.body_type, m.image_url
    FROM vehicle_versions v JOIN vehicle_models m ON m.id=v.model_id WHERE v.id = ANY($1::uuid[]) AND v.active AND ${PUBLISHED}`, [ids]);
  if (r.rowCount !== ids.length) throw notFound('COMPARE_VEHICLE_NOT_FOUND');
  const byId = new Map(r.rows.map((row) => [String(row.version_id), row]));
  const ordered = ids.map((id) => byId.get(id)!);
  const summaries = await ratingSummaries([...new Set(ordered.map((o) => String(o.model_id)))]);
  const items = ordered.map((o) => {
    const rating = summaries.get(String(o.model_id)) ?? emptySummary();
    return {
      versionId: o.version_id, label: `${o.brand} ${o.model_name} ${o.version_name}${o.year_model ? ` ${o.year_model}` : ''}`.replace(/\s+/g, ' ').trim(),
      model: { slug: o.slug, brand: o.brand, name: o.model_name, bodyType: o.body_type, vehicleType: o.vehicle_type, imageUrl: o.image_url },
      version: { name: o.version_name, yearModel: o.year_model, fuel: o.fuel, fipeCode: o.fipe_code },
      specs: o.specs as Record<string, unknown>, rating
    };
  });
  const ratingWinners: Record<string, number[]> = {};
  const overall = bestIndexes(items.map((i) => i.rating.average), 'high');
  if (overall.length) ratingWinners.overall = overall;
  for (const c of RATING_CATEGORIES) {
    const idx = bestIndexes(items.map((i) => i.rating.categories[c.key]), 'high');
    if (idx.length) ratingWinners[c.key] = idx;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ groups: SPEC_GROUPS, fields: SPEC_FIELDS, ratingCategories: RATING_CATEGORIES, items, winners: computeWinners(items.map((i) => i.specs)), ratingWinners });
}));

// ---------------------------------------------------------------- ficha do modelo
async function loadModel(slug: string) {
  const r = await pool.query(`SELECT m.* FROM vehicle_models m WHERE m.slug=$1 AND ${PUBLISHED}`, [slug]);
  if (!r.rowCount) throw notFound();
  return r.rows[0]!;
}

publicVehiclesRouter.get('/vehicles/:slug', optionalAuth, asyncRoute(async (req, res) => {
  const m = await loadModel(String(req.params.slug));
  const unlocked = Boolean(req.user);
  const [versions, summaries] = await Promise.all([
    pool.query('SELECT id,name,year_model,fuel,fipe_code,specs FROM vehicle_versions WHERE model_id=$1 AND active ORDER BY year_model DESC NULLS LAST, display_order, name', [m.id]),
    ratingSummaries([String(m.id)])
  ]);
  const pros: string[] = Array.isArray(m.pros) ? m.pros : [];
  const cons: string[] = Array.isArray(m.cons) ? m.cons : [];
  const obs = await pool.query(`SELECT o.*, v.name AS version_name FROM vehicle_consumption_obs o LEFT JOIN vehicle_versions v ON v.id=o.version_id WHERE o.model_id=$1 AND o.status='CONFERIDO' ORDER BY CASE o.source_kind WHEN 'INMETRO' THEN 0 WHEN 'FABRICANTE' THEN 1 ELSE 2 END, o.version_label, o.fuel`, [m.id]);
  const consumption = obs.rows.map((o) => ({
    id: o.id, versionId: o.version_id ?? null, versionName: o.version_name ?? null, versionLabel: o.version_label, brandLabel: o.brand, modelLabel: o.model, propulsion: o.propulsion, segment: o.segment,
    fuel: o.fuel, cityKml: num(o.city_kml), roadKml: num(o.road_kml), cycle: o.cycle, sourceKind: o.source_kind, sourceName: o.source_name, sourceUrl: o.source_url,
    collectedAt: o.collected_at instanceof Date ? o.collected_at.toISOString().slice(0, 10) : String(o.collected_at).slice(0, 10), note: o.note
  }));
  const base = {
    consumption,
    slug: m.slug, brand: m.brand, name: m.name, vehicleType: m.vehicle_type, bodyType: m.body_type, yearFrom: m.year_from, yearTo: m.year_to,
    summary: m.summary, imageUrl: m.image_url, specSource: m.spec_source ?? null, updatedAt: m.updated_at, rating: summaries.get(String(m.id)) ?? emptySummary(), locked: !unlocked
  };
  res.setHeader('Cache-Control', 'private, no-store');
  if (!unlocked) {
    return res.json({
      ...base, pros: pros.slice(0, 2), cons: cons.slice(0, 2), reviewPreview: plainPreview(String(m.review), 320),
      versions: versions.rows.map((v) => ({ id: v.id, name: v.name, yearModel: v.year_model, fuel: v.fuel, highlights: pickHighlights(v.specs as Record<string, unknown>) }))
    });
  }
  const [tips, mine, opinionCount] = await Promise.all([
    pool.query(`SELECT id,category,title,body FROM vehicle_tips WHERE status='PUBLISHED' AND archived_at IS NULL AND model_id=$1 ORDER BY display_order, created_at DESC LIMIT 20`, [m.id]),
    pool.query(`SELECT o.*, v.name AS version_name FROM vehicle_opinions o LEFT JOIN vehicle_versions v ON v.id=o.version_id WHERE o.model_id=$1 AND o.user_id=$2`, [m.id, req.user!.id]),
    pool.query(`SELECT count(*)::int AS n FROM vehicle_opinions WHERE model_id=$1 AND status='APPROVED'`, [m.id])
  ]);
  const me = mine.rows[0];
  res.json({
    ...base, review: m.review, pros, cons, buyerTips: m.buyer_tips,
    versions: versions.rows.map((v) => ({ id: v.id, name: v.name, yearModel: v.year_model, fuel: v.fuel, fipeCode: v.fipe_code, specs: v.specs, highlights: pickHighlights(v.specs as Record<string, unknown>) })),
    tips: tips.rows.map((t) => ({ id: t.id, category: t.category, categoryLabel: tipLabel.get(t.category) ?? t.category, title: t.title, body: t.body })),
    opinionCount: Number(opinionCount.rows[0]?.n ?? 0),
    myOpinion: me ? presentOpinion(me, true) : null
  });
}));

/** Prévia em texto puro (sem marcação markdown), cortada em limite de palavra. */
export function plainPreview(md: string, max: number): string {
  const text = md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function presentOpinion(o: Record<string, any>, mine = false) {
  return {
    id: o.id, rating: Number(o.rating), ratings: o.ratings ?? {}, title: o.title, liked: o.liked, disliked: o.disliked, comment: o.comment,
    ownerSince: o.owner_since, km: o.km, versionId: o.version_id ?? null, versionName: o.version_name ?? null, createdAt: o.created_at,
    ...(mine ? { status: o.status, rejectReason: o.status === 'REJECTED' ? o.reject_reason : null } : { author: publicAuthorName(o.author_name) })
  };
}

publicVehiclesRouter.get('/vehicles/:slug/opinions', auth, asyncRoute(async (req, res) => {
  const m = await loadModel(String(req.params.slug));
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const sort = req.query.sort === 'best' ? 'o.rating DESC, o.created_at DESC' : req.query.sort === 'worst' ? 'o.rating ASC, o.created_at DESC' : 'o.created_at DESC';
  const r = await pool.query(`SELECT o.*, u.name AS author_name, v.name AS version_name FROM vehicle_opinions o JOIN users u ON u.id=o.user_id LEFT JOIN vehicle_versions v ON v.id=o.version_id
    WHERE o.model_id=$1 AND o.status='APPROVED' ORDER BY ${sort} LIMIT $2 OFFSET $3`, [m.id, limit, offset]);
  const total = await pool.query(`SELECT count(*)::int AS n FROM vehicle_opinions WHERE model_id=$1 AND status='APPROVED'`, [m.id]);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ total: Number(total.rows[0]?.n ?? 0), items: r.rows.map((o) => presentOpinion(o)) });
}));

const ratingInt = z.number().int().min(1).max(5);
const opinionSchema = z.object({
  versionId: z.string().refine(isUuid).nullish(),
  rating: ratingInt,
  ratings: z.object(Object.fromEntries(RATING_CATEGORIES.map((c) => [c.key, ratingInt.optional()])) as Record<string, z.ZodOptional<z.ZodNumber>>).strict().default({}),
  title: z.string().trim().max(100).default(''),
  liked: z.string().trim().max(600).default(''),
  disliked: z.string().trim().max(600).default(''),
  comment: z.string().trim().max(1500).default(''),
  ownerSince: z.number().int().min(1950).max(2100).nullish(),
  km: z.number().int().min(0).max(2_000_000).nullish()
}).strict();

publicVehiclesRouter.post('/vehicles/:slug/opinions', auth, opinionLimiter, asyncRoute(async (req, res) => {
  const m = await loadModel(String(req.params.slug));
  const parsed = opinionSchema.safeParse(req.body);
  if (!parsed.success) throw bad();
  const d = parsed.data;
  if (d.liked.length + d.disliked.length + d.comment.length < 20) throw bad('OPINION_TOO_SHORT');
  if (/https?:\/\/|www\.|@\w+\.\w+/i.test(`${d.title} ${d.liked} ${d.disliked} ${d.comment}`)) throw bad('OPINION_LINKS_NOT_ALLOWED');
  if (d.versionId) {
    const v = await pool.query('SELECT 1 FROM vehicle_versions WHERE id=$1 AND model_id=$2', [d.versionId, m.id]);
    if (!v.rowCount) throw bad('VERSION_NOT_FOUND');
  }
  const r = await pool.query(`INSERT INTO vehicle_opinions(model_id,version_id,user_id,rating,ratings,title,liked,disliked,comment,owner_since,km,status)
    VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,'PENDING')
    ON CONFLICT (model_id,user_id) DO UPDATE SET version_id=EXCLUDED.version_id, rating=EXCLUDED.rating, ratings=EXCLUDED.ratings, title=EXCLUDED.title, liked=EXCLUDED.liked,
      disliked=EXCLUDED.disliked, comment=EXCLUDED.comment, owner_since=EXCLUDED.owner_since, km=EXCLUDED.km, status='PENDING', reject_reason=NULL, moderated_by=NULL, moderated_at=NULL, updated_at=now()
    RETURNING *`, [m.id, d.versionId ?? null, req.user!.id, d.rating, JSON.stringify(d.ratings), d.title, d.liked, d.disliked, d.comment, d.ownerSince ?? null, d.km ?? null]);
  res.status(201).json({ opinion: presentOpinion(r.rows[0]!, true), message: 'Recebemos sua opinião. Ela aparece no guia depois da revisão da equipe.' });
}));

publicVehiclesRouter.delete('/vehicles/:slug/opinions/mine', auth, asyncRoute(async (req, res) => {
  const m = await loadModel(String(req.params.slug));
  await pool.query('DELETE FROM vehicle_opinions WHERE model_id=$1 AND user_id=$2', [m.id, req.user!.id]);
  res.json({ ok: true });
}));
