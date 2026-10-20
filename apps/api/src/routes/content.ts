import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { env } from '../config.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { SECTIONS } from '../report/catalog.js';

/** Conteúdo público do site: catálogo (produtos, matriz e pacotes), FAQ e artigos. Só leitura, sem dados internos. */
export const publicContentRouter = Router();
/** Edição do conteúdo no painel (somente host do painel, sessão de admin e permissão MANAGE_CONTENT). */
export const adminContentRouter = Router();
adminContentRouter.use(adminAuth, requirePermission('MANAGE_CONTENT'));

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const notFound = (code: string) => appError(code, { code, http: 404, expose: true });
const SELLABLE_SECTIONS = SECTIONS.filter((s) => s.key !== 'INTERNO' && s.key !== 'PROPRIETARIO').map((s) => s.key);

// ---------------------------------------------------------------- público

/** Catálogo público: só o que está ativo; nunca expõe custo, preço de referência nem margens. */
publicContentRouter.get('/catalog', asyncRoute(async (_req, res) => {
  const [products, packages, settings, features, matrix] = await Promise.all([
    pool.query(`SELECT p.id,p.name,p.description,p.price_cents,p.list_price_cents,p.is_free,p.features,p.coverage,p.slug,p.featured,p.tagline,p.long_description,p.badge,p.show_on_home,
        CASE WHEN p.is_free OR ($1::boolean AND EXISTS (SELECT 1 FROM query_source_rules rule WHERE rule.product_id=p.id AND rule.active=true)) THEN p.commercial_status ELSE 'SOON' END AS commercial_status
      FROM query_products p WHERE p.active=true AND p.commercial_status <> 'HIDDEN' ORDER BY p.display_order,p.price_cents`, [env.DATA_PROVIDER !== 'disabled']),
    pool.query('SELECT slug,name,description,tagline,badge,highlights,credits,price_cents FROM credit_packages WHERE active=true ORDER BY display_order,price_cents'),
    pool.query('SELECT enabled_methods FROM payment_settings WHERE id=1'),
    pool.query('SELECT id,key,label,description FROM catalog_features WHERE active=true ORDER BY display_order,label'),
    pool.query('SELECT product_id,feature_id,status,note FROM product_catalog_features')
  ]);
  const byProduct = new Map<string, Record<string, { status: string; note: string | null }>>();
  for (const m of matrix.rows) {
    const bucket = byProduct.get(String(m.product_id)) ?? {};
    bucket[String(m.feature_id)] = { status: String(m.status), note: m.note ?? null };
    byProduct.set(String(m.product_id), bucket);
  }
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    products: products.rows.map((p) => {
      const price = p.is_free ? 0 : Number(p.price_cents ?? 0);
      const list = p.list_price_cents == null ? null : Number(p.list_price_cents);
      const showList = list != null && !p.is_free && list > price;
      const matrixRow = byProduct.get(String(p.id)) ?? {};
      return {
        id: p.id, slug: p.slug, name: p.name, tagline: p.tagline ?? '', description: p.description, longDescription: p.long_description ?? '', coverage: p.coverage,
        priceCents: price, listPriceCents: showList ? list : null, discountPercent: showList ? Math.round(((list! - price) / list!) * 100) : null,
        badge: p.badge ?? null, isFree: Boolean(p.is_free), features: Array.isArray(p.features) ? p.features : [], commercialStatus: p.commercial_status, featured: Boolean(p.featured), showOnHome: Boolean(p.show_on_home),
        matrix: Object.fromEntries(features.rows.map((f) => [String(f.id), matrixRow[String(f.id)]?.status ?? 'NOT_INCLUDED']))
      };
    }),
    features: features.rows.map((f) => ({ id: f.id, key: f.key, label: f.label, description: f.description })),
    packages: packages.rows.map((p) => ({ slug: p.slug, name: p.name, description: p.description, tagline: p.tagline ?? '', badge: p.badge ?? null, highlights: Array.isArray(p.highlights) ? p.highlights : [], credits: Number(p.credits), priceCents: Number(p.price_cents), bonusCents: Math.max(Number(p.credits) * 100 - Number(p.price_cents), 0) })),
    paymentMethods: (settings.rows[0]?.enabled_methods as string[] | undefined) ?? []
  });
}));

publicContentRouter.get('/faqs', asyncRoute(async (_req, res) => {
  const rows = await pool.query('SELECT id,category,question,answer FROM faqs WHERE active=true ORDER BY display_order,created_at');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ faqs: rows.rows });
}));

const articleListColumns = 'id,slug,title,excerpt,category,tags,cover_image_url,author,published_at,updated_at,char_length(body) AS body_length';
const presentArticle = (r: Record<string, unknown>) => ({
  id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, category: r.category, tags: r.tags ?? [], coverImageUrl: r.cover_image_url ?? null, author: r.author,
  publishedAt: r.published_at, updatedAt: r.updated_at, readingMinutes: Math.max(1, Math.round(Number(r.body_length ?? 0) / 1100))
});

publicContentRouter.get('/articles', asyncRoute(async (req, res) => {
  const category = typeof req.query.category === 'string' && req.query.category.length <= 60 ? req.query.category : null;
  const rows = await pool.query(`SELECT ${articleListColumns} FROM articles WHERE status='PUBLISHED' AND published_at <= now() AND ($1::text IS NULL OR category=$1) ORDER BY published_at DESC LIMIT 100`, [category]);
  const categories = await pool.query(`SELECT category, count(*)::int AS total FROM articles WHERE status='PUBLISHED' AND published_at <= now() GROUP BY category ORDER BY category`);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ articles: rows.rows.map(presentArticle), categories: categories.rows });
}));

publicContentRouter.get('/articles/:slug', asyncRoute(async (req, res) => {
  const slug = String(req.params.slug);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw notFound('ARTICLE_NOT_FOUND');
  const row = await pool.query(`SELECT ${articleListColumns},body,seo_title,seo_description FROM articles WHERE slug=$1 AND status='PUBLISHED' AND published_at <= now()`, [slug]);
  if (!row.rowCount) throw notFound('ARTICLE_NOT_FOUND');
  const related = await pool.query(`SELECT ${articleListColumns} FROM articles WHERE status='PUBLISHED' AND published_at <= now() AND slug <> $1 ORDER BY (category = $2) DESC, published_at DESC LIMIT 3`, [slug, row.rows[0].category]);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ article: { ...presentArticle(row.rows[0]), body: row.rows[0].body, seoTitle: row.rows[0].seo_title ?? null, seoDescription: row.rows[0].seo_description ?? null }, related: related.rows.map(presentArticle) });
}));

/** Metadados de artigo para SEO no servidor (título, descrição, data). Retorna null se não publicado. */
export async function articleSeo(slug: string): Promise<{ title: string; description: string; publishedAt: string; updatedAt: string; author: string } | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const row = await pool.query(`SELECT title,excerpt,seo_title,seo_description,published_at,updated_at,author FROM articles WHERE slug=$1 AND status='PUBLISHED' AND published_at <= now()`, [slug]);
  if (!row.rowCount) return null;
  const r = row.rows[0];
  return { title: String(r.seo_title || r.title), description: String(r.seo_description || r.excerpt || r.title).slice(0, 300), publishedAt: new Date(String(r.published_at)).toISOString(), updatedAt: new Date(String(r.updated_at)).toISOString(), author: String(r.author) };
}

export async function publishedArticleSlugs(): Promise<Array<{ slug: string; updatedAt: Date }>> {
  const rows = await pool.query(`SELECT slug,updated_at FROM articles WHERE status='PUBLISHED' AND published_at <= now() ORDER BY published_at DESC LIMIT 500`);
  return rows.rows.map((r) => ({ slug: String(r.slug), updatedAt: new Date(String(r.updated_at)) }));
}

// ---------------------------------------------------------------- painel: recursos e matriz

const featureBody = z.object({
  key: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).default(''),
  displayOrder: z.number().int().min(-10000).max(10000).default(100),
  active: z.boolean().default(true)
}).strict();
const featurePatch = featureBody.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');
const presentFeature = (r: Record<string, unknown>) => ({ id: r.id, key: r.key, label: r.label, description: r.description, displayOrder: Number(r.display_order), active: Boolean(r.active) });

adminContentRouter.get('/sections', (_req, res) => {
  res.json(SECTIONS.filter((s) => SELLABLE_SECTIONS.includes(s.key)).map((s) => ({ key: s.key, label: s.label, description: s.description })));
});

adminContentRouter.get('/features', asyncRoute(async (_req, res) => {
  const rows = await pool.query('SELECT * FROM catalog_features ORDER BY display_order,label');
  res.json(rows.rows.map(presentFeature));
}));

adminContentRouter.post('/features', asyncRoute(async (req, res) => {
  const parsed = featureBody.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  const dup = await pool.query('SELECT 1 FROM catalog_features WHERE key=$1', [v.key]);
  if (dup.rowCount) throw appError('FEATURE_KEY_IN_USE', { code: 'FEATURE_KEY_IN_USE', http: 409, expose: true });
  const row = await pool.query('INSERT INTO catalog_features(key,label,description,display_order,active) VALUES($1,$2,$3,$4,$5) RETURNING *', [v.key, v.label, v.description, v.displayOrder, v.active]);
  await audit(req.user!.id, 'CREATE_CATALOG_FEATURE', 'CATALOG_FEATURE', String(row.rows[0].id), { requestId: requestId(req) });
  res.status(201).json(presentFeature(row.rows[0]));
}));

adminContentRouter.patch('/features/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FEATURE_NOT_FOUND');
  const parsed = featurePatch.safeParse(req.body);
  if (!parsed.success) throw bad();
  const map: Record<string, string> = { key: 'key', label: 'label', description: 'description', displayOrder: 'display_order', active: 'active' };
  const values: unknown[] = [];
  const sets = Object.entries(parsed.data).map(([k, v]) => { values.push(v); return `${map[k]}=$${values.length}`; });
  values.push(req.params.id);
  const row = await pool.query(`UPDATE catalog_features SET ${sets.join(',')}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  if (!row.rowCount) throw notFound('FEATURE_NOT_FOUND');
  await audit(req.user!.id, 'UPDATE_CATALOG_FEATURE', 'CATALOG_FEATURE', String(req.params.id), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  res.json(presentFeature(row.rows[0]));
}));

adminContentRouter.delete('/features/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FEATURE_NOT_FOUND');
  const row = await pool.query('DELETE FROM catalog_features WHERE id=$1 RETURNING id', [req.params.id]);
  if (!row.rowCount) throw notFound('FEATURE_NOT_FOUND');
  await audit(req.user!.id, 'DELETE_CATALOG_FEATURE', 'CATALOG_FEATURE', String(req.params.id), { requestId: requestId(req) });
  res.json({ ok: true });
}));

adminContentRouter.get('/matrix', asyncRoute(async (_req, res) => {
  const [features, products, cells] = await Promise.all([
    pool.query('SELECT * FROM catalog_features ORDER BY display_order,label'),
    pool.query('SELECT id,name,active,commercial_status FROM query_products WHERE active=true AND is_free=false ORDER BY display_order,price_cents'),
    pool.query('SELECT product_id,feature_id,status,note FROM product_catalog_features')
  ]);
  const by = new Map<string, Record<string, { status: string; note: string | null }>>();
  for (const c of cells.rows) { const b = by.get(String(c.product_id)) ?? {}; b[String(c.feature_id)] = { status: String(c.status), note: c.note ?? null }; by.set(String(c.product_id), b); }
  res.json({
    features: features.rows.map(presentFeature),
    products: products.rows.map((p) => ({ id: p.id, name: p.name, cells: Object.fromEntries(features.rows.map((f) => [String(f.id), by.get(String(p.id))?.[String(f.id)] ?? { status: 'NOT_INCLUDED', note: null }])) }))
  });
}));

const matrixBody = z.object({ cells: z.record(z.string(), z.object({ status: z.enum(['INCLUDED', 'NOT_INCLUDED', 'SOON']), note: z.string().trim().max(120).nullable().optional() }).strict()) }).strict();
adminContentRouter.put('/matrix/:productId', asyncRoute(async (req, res) => {
  const parsed = matrixBody.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data.cells).every(isUuid)) throw bad();
  const product = await pool.query('SELECT 1 FROM query_products WHERE id=$1', [req.params.productId]);
  if (!product.rowCount) throw notFound('PRODUCT_NOT_FOUND');
  await tx(async (client) => {
    for (const [featureId, cell] of Object.entries(parsed.data.cells)) {
      await client.query(`INSERT INTO product_catalog_features(product_id,feature_id,status,note) SELECT $1,id,$3,$4 FROM catalog_features WHERE id=$2
        ON CONFLICT (product_id,feature_id) DO UPDATE SET status=EXCLUDED.status, note=EXCLUDED.note`, [req.params.productId, featureId, cell.status, cell.note ?? null]);
    }
  });
  await audit(req.user!.id, 'UPDATE_PRODUCT_MATRIX', 'QUERY_PRODUCT', String(req.params.productId), { cells: Object.keys(parsed.data.cells).length, requestId: requestId(req) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- painel: pacotes

const packageBase = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(400),
  tagline: z.string().trim().max(160).default(''),
  badge: z.string().trim().max(30).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  credits: z.number().int().min(1).max(100000),
  priceCents: z.number().int().min(1).max(100000000),
  displayOrder: z.number().int().min(-10000).max(10000).default(100),
  active: z.boolean().default(true)
});
const packageCreate = packageBase.extend({ slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }).strict();
const packagePatch = packageBase.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');
const presentPackage = (r: Record<string, unknown>) => ({ slug: r.slug, name: r.name, description: r.description, tagline: r.tagline ?? '', badge: r.badge ?? null, highlights: Array.isArray(r.highlights) ? r.highlights : [], credits: Number(r.credits), priceCents: Number(r.price_cents), displayOrder: Number(r.display_order), active: Boolean(r.active) });

adminContentRouter.get('/packages', asyncRoute(async (_req, res) => {
  const rows = await pool.query('SELECT slug,name,description,tagline,badge,highlights,credits,price_cents,display_order,active FROM credit_packages ORDER BY display_order,price_cents');
  res.json(rows.rows.map(presentPackage));
}));

adminContentRouter.post('/packages', asyncRoute(async (req, res) => {
  const parsed = packageCreate.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  const dup = await pool.query('SELECT 1 FROM credit_packages WHERE slug=$1', [v.slug]);
  if (dup.rowCount) throw appError('PACKAGE_SLUG_IN_USE', { code: 'PACKAGE_SLUG_IN_USE', http: 409, expose: true });
  const row = await pool.query(`INSERT INTO credit_packages(slug,name,description,tagline,badge,highlights,credits,price_cents,display_order,active) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING slug,name,description,tagline,badge,highlights,credits,price_cents,display_order,active`,
    [v.slug, v.name, v.description, v.tagline, v.badge ?? null, JSON.stringify(v.highlights), v.credits, v.priceCents, v.displayOrder, v.active]);
  await audit(req.user!.id, 'CREATE_CREDIT_PACKAGE', 'CREDIT_PACKAGE', v.slug, { requestId: requestId(req) });
  res.status(201).json(presentPackage(row.rows[0]));
}));

adminContentRouter.patch('/packages/:slug', asyncRoute(async (req, res) => {
  const parsed = packagePatch.safeParse(req.body);
  if (!parsed.success) throw bad();
  const map: Record<string, string> = { name: 'name', description: 'description', tagline: 'tagline', badge: 'badge', highlights: 'highlights', credits: 'credits', priceCents: 'price_cents', displayOrder: 'display_order', active: 'active' };
  const values: unknown[] = [];
  const sets = Object.entries(parsed.data).map(([k, v]) => { values.push(k === 'highlights' ? JSON.stringify(v) : v); return `${map[k]}=$${values.length}${k === 'highlights' ? '::jsonb' : ''}`; });
  values.push(req.params.slug);
  const row = await pool.query(`UPDATE credit_packages SET ${sets.join(',')}, updated_at=now() WHERE slug=$${values.length} RETURNING slug,name,description,tagline,badge,highlights,credits,price_cents,display_order,active`, values);
  if (!row.rowCount) throw notFound('PACKAGE_NOT_FOUND');
  await audit(req.user!.id, 'UPDATE_CREDIT_PACKAGE', 'CREDIT_PACKAGE', String(req.params.slug), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  res.json(presentPackage(row.rows[0]));
}));

// ---------------------------------------------------------------- painel: FAQ

const faqBody = z.object({
  category: z.string().trim().min(2).max(40).default('Geral'),
  question: z.string().trim().min(5).max(240),
  answer: z.string().trim().min(5).max(4000),
  displayOrder: z.number().int().min(-10000).max(10000).default(100),
  active: z.boolean().default(true)
}).strict();
const faqPatch = faqBody.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');
const presentFaq = (r: Record<string, unknown>) => ({ id: r.id, category: r.category, question: r.question, answer: r.answer, displayOrder: Number(r.display_order), active: Boolean(r.active), archived: Boolean(r.archived_at) });

adminContentRouter.get('/faqs', asyncRoute(async (_req, res) => {
  const rows = await pool.query('SELECT * FROM faqs ORDER BY display_order,created_at');
  res.json(rows.rows.map(presentFaq));
}));
adminContentRouter.post('/faqs', asyncRoute(async (req, res) => {
  const parsed = faqBody.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  const row = await pool.query('INSERT INTO faqs(category,question,answer,display_order,active) VALUES($1,$2,$3,$4,$5) RETURNING *', [v.category, v.question, v.answer, v.displayOrder, v.active]);
  await audit(req.user!.id, 'CREATE_FAQ', 'FAQ', String(row.rows[0].id), { requestId: requestId(req) });
  res.status(201).json(presentFaq(row.rows[0]));
}));
adminContentRouter.patch('/faqs/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FAQ_NOT_FOUND');
  const parsed = faqPatch.safeParse(req.body);
  if (!parsed.success) throw bad();
  const map: Record<string, string> = { category: 'category', question: 'question', answer: 'answer', displayOrder: 'display_order', active: 'active' };
  const values: unknown[] = [];
  const sets = Object.entries(parsed.data).map(([k, v]) => { values.push(v); return `${map[k]}=$${values.length}`; });
  values.push(req.params.id);
  const row = await pool.query(`UPDATE faqs SET ${sets.join(',')}${parsed.data.active === true ? ', archived_at=NULL' : ''}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  if (!row.rowCount) throw notFound('FAQ_NOT_FOUND');
  await audit(req.user!.id, 'UPDATE_FAQ', 'FAQ', String(req.params.id), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  res.json(presentFaq(row.rows[0]));
}));
adminContentRouter.post('/faqs/:id/archive', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FAQ_NOT_FOUND');
  const archive = req.body?.archived !== false;
  const row = await pool.query(`UPDATE faqs SET archived_at=${archive ? 'now()' : 'NULL'}, active=$2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, !archive]);
  if (!row.rowCount) throw notFound('FAQ_NOT_FOUND');
  await audit(req.user!.id, archive ? 'ARCHIVE_FAQ' : 'RESTORE_FAQ', 'FAQ', String(req.params.id), { requestId: requestId(req) });
  res.json(presentFaq(row.rows[0]));
}));
adminContentRouter.delete('/faqs/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('FAQ_NOT_FOUND');
  const row = await pool.query('DELETE FROM faqs WHERE id=$1 RETURNING id', [req.params.id]);
  if (!row.rowCount) throw notFound('FAQ_NOT_FOUND');
  await audit(req.user!.id, 'DELETE_FAQ', 'FAQ', String(req.params.id), { requestId: requestId(req) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- painel: artigos

const imageUrl = z.string().trim().max(500).refine((v) => /^https:\/\//.test(v) || /^\/[A-Za-z0-9._\-/]*$/.test(v), 'INVALID_IMAGE_URL');
const articleBody = z.object({
  slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().trim().min(5).max(180),
  excerpt: z.string().trim().max(400).default(''),
  body: z.string().max(60000).default(''),
  category: z.string().trim().min(2).max(40).default('Geral'),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  coverImageUrl: imageUrl.nullable().optional(),
  author: z.string().trim().min(2).max(80).default('Equipe Placa na Mão'),
  seoTitle: z.string().trim().max(120).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  publishedAt: z.string().datetime().nullable().optional()
}).strict();
const articlePatch = articleBody.partial().strict().refine((v) => Object.keys(v).length > 0, 'EMPTY_UPDATE');
const presentAdminArticle = (r: Record<string, unknown>) => ({
  id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt, body: r.body, category: r.category, tags: r.tags ?? [], coverImageUrl: r.cover_image_url ?? null, author: r.author,
  seoTitle: r.seo_title ?? null, seoDescription: r.seo_description ?? null, status: r.status, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at, archived: Boolean(r.archived_at)
});

adminContentRouter.get('/articles', asyncRoute(async (_req, res) => {
  const rows = await pool.query('SELECT * FROM articles ORDER BY COALESCE(published_at, created_at) DESC LIMIT 300');
  res.json(rows.rows.map(presentAdminArticle));
}));
adminContentRouter.post('/articles', asyncRoute(async (req, res) => {
  const parsed = articleBody.safeParse(req.body);
  if (!parsed.success) throw bad();
  const v = parsed.data;
  const dup = await pool.query('SELECT 1 FROM articles WHERE slug=$1', [v.slug]);
  if (dup.rowCount) throw appError('ARTICLE_SLUG_IN_USE', { code: 'ARTICLE_SLUG_IN_USE', http: 409, expose: true });
  const publishedAt = v.status === 'PUBLISHED' ? (v.publishedAt ?? new Date().toISOString()) : null;
  const row = await pool.query(`INSERT INTO articles(slug,title,excerpt,body,category,tags,cover_image_url,author,seo_title,seo_description,status,published_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [v.slug, v.title, v.excerpt, v.body, v.category, v.tags, v.coverImageUrl ?? null, v.author, v.seoTitle ?? null, v.seoDescription ?? null, v.status, publishedAt, req.user!.id]);
  await audit(req.user!.id, 'CREATE_ARTICLE', 'ARTICLE', String(row.rows[0].id), { slug: v.slug, status: v.status, requestId: requestId(req) });
  res.status(201).json(presentAdminArticle(row.rows[0]));
}));
adminContentRouter.patch('/articles/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('ARTICLE_NOT_FOUND');
  const parsed = articlePatch.safeParse(req.body);
  if (!parsed.success) throw bad();
  const current = await pool.query('SELECT status,published_at FROM articles WHERE id=$1', [req.params.id]);
  if (!current.rowCount) throw notFound('ARTICLE_NOT_FOUND');
  if (parsed.data.slug) {
    const dup = await pool.query('SELECT 1 FROM articles WHERE slug=$1 AND id<>$2', [parsed.data.slug, req.params.id]);
    if (dup.rowCount) throw appError('ARTICLE_SLUG_IN_USE', { code: 'ARTICLE_SLUG_IN_USE', http: 409, expose: true });
  }
  const map: Record<string, string> = { slug: 'slug', title: 'title', excerpt: 'excerpt', body: 'body', category: 'category', tags: 'tags', coverImageUrl: 'cover_image_url', author: 'author', seoTitle: 'seo_title', seoDescription: 'seo_description', status: 'status', publishedAt: 'published_at' };
  const values: unknown[] = [];
  const sets: string[] = [];
  for (const [k, v] of Object.entries(parsed.data)) { values.push(v); sets.push(`${map[k]}=$${values.length}${k === 'tags' ? '::text[]' : ''}`); }
  const nextStatus = parsed.data.status ?? String(current.rows[0].status);
  if (nextStatus === 'PUBLISHED' && !current.rows[0].published_at && parsed.data.publishedAt === undefined) sets.push('published_at=now()');
  if (nextStatus === 'DRAFT' && parsed.data.status === 'DRAFT') sets.push('published_at=NULL');
  if (parsed.data.status === 'PUBLISHED') sets.push('archived_at=NULL');
  values.push(req.params.id);
  const row = await pool.query(`UPDATE articles SET ${sets.join(',')}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  await audit(req.user!.id, 'UPDATE_ARTICLE', 'ARTICLE', String(req.params.id), { fields: Object.keys(parsed.data), requestId: requestId(req) });
  res.json(presentAdminArticle(row.rows[0]));
}));
adminContentRouter.post('/articles/:id/archive', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('ARTICLE_NOT_FOUND');
  const archive = req.body?.archived !== false;
  const row = await pool.query(`UPDATE articles SET archived_at=${archive ? 'now()' : 'NULL'}, ${archive ? "status='DRAFT', published_at=NULL," : ''} updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
  if (!row.rowCount) throw notFound('ARTICLE_NOT_FOUND');
  await audit(req.user!.id, archive ? 'ARCHIVE_ARTICLE' : 'RESTORE_ARTICLE', 'ARTICLE', String(req.params.id), { requestId: requestId(req) });
  res.json(presentAdminArticle(row.rows[0]));
}));
adminContentRouter.delete('/articles/:id', asyncRoute(async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('ARTICLE_NOT_FOUND');
  const row = await pool.query('DELETE FROM articles WHERE id=$1 RETURNING id,slug', [req.params.id]);
  if (!row.rowCount) throw notFound('ARTICLE_NOT_FOUND');
  await audit(req.user!.id, 'DELETE_ARTICLE', 'ARTICLE', String(req.params.id), { slug: row.rows[0].slug, requestId: requestId(req) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- painel: vitrine (arquivar, restaurar e apagar produtos)

adminContentRouter.post('/products/:id/archive', asyncRoute(async (req, res) => {
  const archive = req.body?.archived !== false;
  const row = await pool.query(
    archive ? `UPDATE query_products SET archived_at=now(), active=false, show_on_home=false WHERE id=$1 RETURNING id`
      : `UPDATE query_products SET archived_at=NULL WHERE id=$1 RETURNING id`, [req.params.id]);
  if (!row.rowCount) throw notFound('PRODUCT_NOT_FOUND');
  await audit(req.user!.id, archive ? 'ARCHIVE_QUERY_PRODUCT' : 'RESTORE_QUERY_PRODUCT', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req) });
  res.json({ ok: true, archived: archive });
}));

/** Só apaga produto que nunca foi vendido nem consultado; caso contrário a orientação é arquivar. */
adminContentRouter.delete('/products/:id', asyncRoute(async (req, res) => {
  try {
    await tx(async (client) => {
      const exists = await client.query('SELECT 1 FROM query_products WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!exists.rowCount) throw notFound('PRODUCT_NOT_FOUND');
      await client.query('DELETE FROM product_catalog_features WHERE product_id=$1', [req.params.id]);
      await client.query('DELETE FROM product_report_configs WHERE product_id=$1', [req.params.id]);
      await client.query('DELETE FROM report_templates WHERE product_id=$1', [req.params.id]);
      await client.query('DELETE FROM query_products WHERE id=$1', [req.params.id]);
    });
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503') throw appError('PRODUCT_IN_USE', { code: 'PRODUCT_IN_USE', http: 409, expose: true });
    throw error;
  }
  await audit(req.user!.id, 'DELETE_QUERY_PRODUCT', 'QUERY_PRODUCT', String(req.params.id), { requestId: requestId(req) });
  res.json({ ok: true });
}));
