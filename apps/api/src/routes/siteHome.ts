import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth } from '../auth.js';
import { env } from '../config.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { readImageInfo } from '../lib/imageInfo.js';

/**
 * Página inicial editável pelo painel: textos, aviso de campanha, seções e imagens.
 * Tudo é opcional: campo vazio (null) = texto padrão do site. As imagens ficam no banco para sobreviver a cada deploy.
 */
export const SLOTS = ['hero', 'showcase', 'final'] as const;
export type Slot = (typeof SLOTS)[number];

const text = (max: number) => z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v), z.string().max(max).nullable()).default(null);
/** Link do aviso: caminho interno (/planos) ou https. Nunca javascript: ou outro esquema. */
const link = z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v), z.string().max(200).refine((s) => /^\/(?!\/)[A-Za-z0-9._~\-/?=&%#]*$/.test(s) || /^https:\/\/[^\s"'<>]+$/.test(s), 'INVALID_LINK').nullable()).default(null);

export const homeConfigSchema = z.object({
  heroTag: text(90),
  heroLead: text(220),
  consultasTitle: text(70),
  consultasSub: text(120),
  showcaseTitle: text(90),
  showcaseBullets: z.array(z.string().trim().min(1).max(90)).max(5).default([]),
  packsTitle: text(70),
  packsSub: text(120),
  finalTitle: text(80),
  finalSub: text(120),
  announce: z.object({ enabled: z.boolean().default(false), text: text(140), linkLabel: text(30), linkTo: link }).strict().default({ enabled: false, text: null, linkLabel: null, linkTo: null }),
  show: z.object({ steps: z.boolean().default(true), tools: z.boolean().default(true), testimonials: z.boolean().default(true), lojista: z.boolean().default(true) }).strict().default({ steps: true, tools: true, testimonials: true, lojista: true })
}).strict();
export type HomeConfig = z.infer<typeof homeConfigSchema>;
export const EMPTY_HOME: HomeConfig = homeConfigSchema.parse({});

const IMG_MAX = 3 * 1024 * 1024;
const IMG_MIN_SIDE = 300;
const MIN_BYTES = 1000;
const upload = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: IMG_MAX });
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const slotOf = (v: unknown): Slot => { const s = typeof v === 'string' ? v : ''; if (!(SLOTS as readonly string[]).includes(s)) throw bad('HOME_SLOT_INVALID'); return s as Slot; };

interface ImgRow { slot: Slot; mime: string; size_bytes: number; width: number | null; height: number | null; sha256: string }
export interface HomeImage { url: string; width: number | null; height: number | null; sizeBytes: number; mime: string }
const imgUrl = (r: ImgRow) => `/api/public/home-img/${r.slot}?v=${r.sha256.slice(0, 12)}`;
const imgDto = (r: ImgRow): HomeImage => ({ url: imgUrl(r), width: r.width, height: r.height, sizeBytes: r.size_bytes, mime: r.mime });

let cache: { at: number; value: { config: HomeConfig; images: Partial<Record<Slot, HomeImage>>; updatedAt: string | null } } | null = null;
export const invalidateHome = () => { cache = null; };

export async function loadHome(): Promise<{ config: HomeConfig; images: Partial<Record<Slot, HomeImage>>; updatedAt: string | null }> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [c, i] = await Promise.all([
    pool.query('SELECT data, updated_at FROM site_home WHERE id=$1', ['home']),
    pool.query('SELECT slot,mime,size_bytes,width,height,sha256 FROM site_home_images')
  ]);
  const parsed = homeConfigSchema.safeParse(c.rows[0]?.data ?? {});
  const images: Partial<Record<Slot, HomeImage>> = {};
  for (const r of i.rows as ImgRow[]) images[r.slot] = imgDto(r);
  const value = { config: parsed.success ? parsed.data : EMPTY_HOME, images, updatedAt: c.rows[0]?.updated_at ? new Date(c.rows[0].updated_at as string).toISOString() : null };
  cache = { at: Date.now(), value };
  return value;
}

// ------------------------------------------------------------- público
const limiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' });
export const siteHomePublicRouter = Router();

siteHomePublicRouter.get('/public/home', limiter, asyncRoute(async (_req, res) => {
  const { config, images } = await loadHome();
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({ config, images });
}));

siteHomePublicRouter.get('/public/home-img/:slot', limiter, asyncRoute(async (req, res) => {
  const slot = (SLOTS as readonly string[]).includes(String(req.params.slot)) ? String(req.params.slot) : '';
  const r = slot ? await pool.query('SELECT mime,data,sha256 FROM site_home_images WHERE slot=$1', [slot]) : { rowCount: 0, rows: [] as Array<{ mime: string; data: Buffer; sha256: string }> };
  if (!r.rowCount) { res.status(404).end(); return; }
  const row = r.rows[0]!;
  const etag = `"${String(row.sha256).slice(0, 16)}"`;
  res.setHeader('Content-Type', String(row.mime));
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  if (req.headers['if-none-match'] === etag) { res.status(304).end(); return; }
  res.send(row.data);
}));

// ------------------------------------------------------------- painel
export const siteHomeAdminRouter = Router();
const guard = [adminAuth, requirePermission('MANAGE_CONTENT')];

siteHomeAdminRouter.get('/home', ...guard, asyncRoute(async (_req, res) => {
  invalidateHome();
  const v = await loadHome();
  res.json(v);
}));

siteHomeAdminRouter.put('/home', ...guard, asyncRoute(async (req, res) => {
  const p = homeConfigSchema.safeParse(req.body);
  if (!p.success) throw bad('HOME_INVALID');
  const a = p.data.announce;
  if (a.enabled && !a.text) throw bad('HOME_ANNOUNCE_TEXT');
  if (a.linkTo && !a.linkLabel) throw bad('HOME_ANNOUNCE_LINK_LABEL');
  await pool.query(
    `INSERT INTO site_home(id,data,updated_by,updated_at) VALUES('home',$1::jsonb,$2,now())
     ON CONFLICT (id) DO UPDATE SET data=$1::jsonb, updated_by=$2, updated_at=now()`,
    [JSON.stringify(p.data), req.user!.id]);
  invalidateHome();
  await audit(req.user!.id, 'UPDATE_SITE_HOME', 'SITE_HOME', 'home', { announceEnabled: a.enabled, requestId: requestId(req) });
  res.json(await loadHome());
}));

siteHomeAdminRouter.post('/home/image', ...guard, upload, asyncRoute(async (req, res) => {
  const slot = slotOf(req.query.slot);
  const data = req.body as Buffer;
  const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
  const info = Buffer.isBuffer(data) && data.length ? readImageInfo(data) : null;
  if (!info || info.mime !== type) throw appError('SEO_IMAGE_TYPE', { code: 'SEO_IMAGE_TYPE', http: 415, expose: true });
  if (data.length < MIN_BYTES || (info.width !== null && info.height !== null && (info.width < IMG_MIN_SIDE || info.height < IMG_MIN_SIDE))) throw appError('SEO_IMAGE_TOO_SMALL', { code: 'SEO_IMAGE_TOO_SMALL', http: 422, expose: true });
  const sha = createHash('sha256').update(data).digest('hex');
  await pool.query(
    `INSERT INTO site_home_images(slot,mime,size_bytes,width,height,sha256,data,updated_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (slot) DO UPDATE SET mime=$2,size_bytes=$3,width=$4,height=$5,sha256=$6,data=$7,updated_by=$8,updated_at=now()`,
    [slot, info.mime, data.length, info.width, info.height, sha, data, req.user!.id]);
  invalidateHome();
  await audit(req.user!.id, 'UPDATE_SITE_HOME_IMAGE', 'SITE_HOME', slot, { size: data.length, mime: info.mime, requestId: requestId(req) });
  const v = await loadHome();
  res.json({ ok: true, image: v.images[slot] ?? null });
}));

siteHomeAdminRouter.delete('/home/image', ...guard, asyncRoute(async (req, res) => {
  const slot = slotOf(req.query.slot);
  await pool.query('DELETE FROM site_home_images WHERE slot=$1', [slot]);
  invalidateHome();
  await audit(req.user!.id, 'DELETE_SITE_HOME_IMAGE', 'SITE_HOME', slot, { requestId: requestId(req) });
  res.json({ ok: true });
}));
