import express, { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool, tx } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit } from '../lib/http.js';
import { requirePermission } from '../permissions.js';
import { BODY_TYPES, SPEC_FIELDS, SPEC_BY_KEY, TIP_CATEGORIES, cleanSpecs, normalizeText, slugify } from '../lib/vehicleSpecs.js';
import { parseCsv } from '../lib/csvParse.js';
import { csvEscape, toCsv } from '../lib/br.js';
import { fipeSearch, fipeYears, getFipePrice } from '../lib/fipeLookup.js';
import { SNAPSHOT_RE, likeEscape, parseSenatranCsv, rematchCatalog, searchTerms, upsertCatalog } from '../lib/catalog.js';

/** Gestão do Guia de veículos no painel: modelos, versões (ficha técnica), opiniões, dicas e importação por planilha. */
export const adminVehiclesRouter = Router();
adminVehiclesRouter.use(adminAuth, requirePermission('MANAGE_CONTENT'));

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bad = (code = 'INVALID_INPUT') => appError(code, { code, http: 400, expose: true });
const notFound = (code: string) => appError(code, { code, http: 404, expose: true });
const conflict = (code: string) => appError(code, { code, http: 409, expose: true });
const tipKeys = TIP_CATEGORIES.map((c) => c.key) as [string, ...string[]];
const httpsUrl = z.string().trim().max(500).url().refine((u) => u.startsWith('https://'), 'URL_MUST_BE_HTTPS');
const yearField = z.number().int().min(1950).max(2100).nullish();
const stringList = z.array(z.string().trim().min(1).max(160)).max(10).default([]);

const modelFields = {
  brand: z.string().trim().min(2).max(60),
  name: z.string().trim().min(1).max(80),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE', 'TRUCK']).default('CAR'),
  bodyType: z.string().trim().max(40).nullish().transform((v) => v || null),
  yearFrom: yearField, yearTo: yearField,
  summary: z.string().trim().max(400).default(''),
  review: z.string().max(20000).default(''),
  pros: stringList, cons: stringList,
  buyerTips: z.string().max(8000).default(''),
  imageUrl: httpsUrl.nullish().transform((v) => v || null),
  specSource: z.string().trim().max(300).nullish().transform((v) => v || null),
  imageCredit: z.string().trim().max(200).nullish().transform((v) => v || null),
  imageLicense: z.string().trim().max(120).nullish().transform((v) => v || null),
  imageSourceUrl: httpsUrl.nullish().transform((v) => v || null),
  featured: z.boolean().default(false),
  featuredOrder: z.number().int().min(1).max(99).nullish(),
  catalogBrands: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  catalogNames: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  catalogExclude: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT')
};
const modelCreate = z.object(modelFields).strict();
const modelUpdate = z.object({ ...modelFields, slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(90) }).partial().strict();
const versionFields = {
  name: z.string().trim().min(1).max(120),
  yearModel: yearField,
  fuel: z.string().trim().max(40).nullish().transform((v) => v || null),
  fipeCode: z.string().trim().max(20).nullish().transform((v) => v || null),
  specs: z.record(z.unknown()).default({}),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true)
};
const versionCreate = z.object(versionFields).strict();
const versionUpdate = z.object(versionFields).partial().strict();

async function uniqueSlug(client: Pick<PoolClient, 'query'>, brand: string, name: string, ignoreId?: string): Promise<string> {
  const base = slugify(`${brand} ${name}`) || 'veiculo';
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const r = await client.query('SELECT id FROM vehicle_models WHERE slug=$1', [slug]);
    if (!r.rowCount || r.rows[0].id === ignoreId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function specsOrThrow(input: unknown): Record<string, string | number | boolean> {
  const { specs, errors } = cleanSpecs(input);
  if (errors.length) throw Object.assign(bad('INVALID_SPECS'), { details: errors });
  return specs;
}

const presentModel = (m: Record<string, any>) => ({
  id: m.id, slug: m.slug, brand: m.brand, name: m.name, vehicleType: m.vehicle_type, bodyType: m.body_type, yearFrom: m.year_from, yearTo: m.year_to,
  summary: m.summary, review: m.review, pros: m.pros ?? [], cons: m.cons ?? [], buyerTips: m.buyer_tips, imageUrl: m.image_url, specSource: m.spec_source ?? null, status: m.status,
  imageCredit: m.image_credit ?? null, imageLicense: m.image_license ?? null, imageSourceUrl: m.image_source_url ?? null,
  featured: Boolean(m.featured), featuredOrder: m.featured_order ?? null,
  catalogBrands: m.catalog_brands ?? [], catalogNames: m.catalog_names ?? [], catalogExclude: m.catalog_exclude ?? [],
  archived: m.archived_at != null, createdAt: m.created_at, updatedAt: m.updated_at
});
const presentVersion = (v: Record<string, any>) => ({ id: v.id, modelId: v.model_id, name: v.name, yearModel: v.year_model, fuel: v.fuel, fipeCode: v.fipe_code, specs: v.specs ?? {}, displayOrder: v.display_order, active: v.active });

// ---------------------------------------------------------------- visão geral
adminVehiclesRouter.get('/meta', asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT
      (SELECT count(*) FROM vehicle_models WHERE archived_at IS NULL)::int AS models,
      (SELECT count(*) FROM vehicle_models WHERE archived_at IS NULL AND status='PUBLISHED')::int AS published,
      (SELECT count(*) FROM vehicle_opinions WHERE status='PENDING')::int AS pending_opinions,
      (SELECT count(*) FROM vehicle_tips WHERE archived_at IS NULL)::int AS tips`);
  const m = r.rows[0]!;
  res.json({ models: Number(m.models), published: Number(m.published), pendingOpinions: Number(m.pending_opinions), tips: Number(m.tips), bodyTypes: BODY_TYPES, specFields: SPEC_FIELDS, tipCategories: TIP_CATEGORIES });
}));

// ---------------------------------------------------------------- opiniões (moderação)
adminVehiclesRouter.get('/opinions', asyncRoute(async (req, res) => {
  const status = ['PENDING', 'APPROVED', 'REJECTED'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const params: unknown[] = [];
  const where: string[] = [];
  if (status) { params.push(status); where.push(`o.status=$${params.length}`); }
  if (isUuid(req.query.modelId)) { params.push(req.query.modelId); where.push(`o.model_id=$${params.length}`); }
  const r = await pool.query(`SELECT o.*, m.brand, m.name AS model_name, m.slug, v.name AS version_name, u.name AS author_name, u.email AS author_email
    FROM vehicle_opinions o JOIN vehicle_models m ON m.id=o.model_id JOIN users u ON u.id=o.user_id LEFT JOIN vehicle_versions v ON v.id=o.version_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (o.status='PENDING') DESC, o.created_at DESC LIMIT 200`, params);
  res.json({
    items: r.rows.map((o) => ({
      id: o.id, status: o.status, rating: Number(o.rating), ratings: o.ratings ?? {}, title: o.title, liked: o.liked, disliked: o.disliked, comment: o.comment,
      ownerSince: o.owner_since, km: o.km, rejectReason: o.reject_reason, createdAt: o.created_at, moderatedAt: o.moderated_at,
      model: { id: o.model_id, slug: o.slug, label: `${o.brand} ${o.model_name}` }, versionName: o.version_name,
      author: { id: o.user_id, name: o.author_name, email: o.author_email }
    }))
  });
}));

adminVehiclesRouter.post('/opinions/:id/approve', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('OPINION_NOT_FOUND');
  const r = await pool.query(`UPDATE vehicle_opinions SET status='APPROVED', reject_reason=NULL, moderated_by=$2, moderated_at=now() WHERE id=$1 RETURNING id,model_id`, [id, req.user!.id]);
  if (!r.rowCount) throw notFound('OPINION_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_OPINION_APPROVED', 'vehicle_opinion', id, { modelId: r.rows[0].model_id });
  res.json({ ok: true });
}));

adminVehiclesRouter.post('/opinions/:id/reject', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const body = z.object({ reason: z.string().trim().max(300).default('') }).strict().safeParse(req.body ?? {});
  if (!isUuid(id)) throw notFound('OPINION_NOT_FOUND');
  if (!body.success) throw bad();
  const r = await pool.query(`UPDATE vehicle_opinions SET status='REJECTED', reject_reason=$3, moderated_by=$2, moderated_at=now() WHERE id=$1 RETURNING id,model_id`, [id, req.user!.id, body.data.reason || null]);
  if (!r.rowCount) throw notFound('OPINION_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_OPINION_REJECTED', 'vehicle_opinion', id, { modelId: r.rows[0].model_id });
  res.json({ ok: true });
}));

adminVehiclesRouter.delete('/opinions/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('OPINION_NOT_FOUND');
  const r = await pool.query('DELETE FROM vehicle_opinions WHERE id=$1 RETURNING model_id', [id]);
  if (!r.rowCount) throw notFound('OPINION_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_OPINION_DELETED', 'vehicle_opinion', id, { modelId: r.rows[0].model_id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- dicas
const tipFields = {
  category: z.enum(tipKeys).default('CUIDADOS'),
  title: z.string().trim().min(3).max(140),
  body: z.string().max(8000).default(''),
  modelId: z.string().refine(isUuid).nullish(),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
  displayOrder: z.number().int().min(0).max(10000).default(0)
};
const presentTip = (t: Record<string, any>) => ({
  id: t.id, category: t.category, title: t.title, body: t.body, modelId: t.model_id, modelLabel: t.brand ? `${t.brand} ${t.model_name}` : null,
  status: t.status, displayOrder: t.display_order, archived: t.archived_at != null, updatedAt: t.updated_at
});
const TIP_SELECT = `SELECT t.*, m.brand, m.name AS model_name FROM vehicle_tips t LEFT JOIN vehicle_models m ON m.id=t.model_id`;

adminVehiclesRouter.get('/tips', asyncRoute(async (req, res) => {
  const archived = req.query.archived === 'true';
  const r = await pool.query(`${TIP_SELECT} WHERE ${archived ? 't.archived_at IS NOT NULL' : 't.archived_at IS NULL'} ORDER BY t.display_order, t.created_at DESC LIMIT 500`);
  res.json({ items: r.rows.map(presentTip) });
}));

adminVehiclesRouter.post('/tips', asyncRoute(async (req, res) => {
  const p = z.object(tipFields).strict().safeParse(req.body);
  if (!p.success) throw bad();
  const d = p.data;
  if (d.modelId && !(await pool.query('SELECT 1 FROM vehicle_models WHERE id=$1', [d.modelId])).rowCount) throw bad('VEHICLE_NOT_FOUND');
  const r = await pool.query('INSERT INTO vehicle_tips(category,title,body,model_id,status,display_order,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [d.category, d.title, d.body, d.modelId ?? null, d.status, d.displayOrder, req.user!.id]);
  await audit(req.user!.id, 'VEHICLE_TIP_CREATED', 'vehicle_tip', r.rows[0].id, { category: d.category });
  const row = await pool.query(`${TIP_SELECT} WHERE t.id=$1`, [r.rows[0].id]);
  res.status(201).json({ tip: presentTip(row.rows[0]) });
}));

adminVehiclesRouter.patch('/tips/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const p = z.object(tipFields).partial().strict().safeParse(req.body);
  if (!isUuid(id)) throw notFound('TIP_NOT_FOUND');
  if (!p.success || !Object.keys(p.data).length) throw bad();
  const d = p.data;
  const sets: string[] = []; const params: unknown[] = [id];
  const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col}=$${params.length}`); };
  if (d.category !== undefined) set('category', d.category);
  if (d.title !== undefined) set('title', d.title);
  if (d.body !== undefined) set('body', d.body);
  if (d.modelId !== undefined) {
    if (d.modelId && !(await pool.query('SELECT 1 FROM vehicle_models WHERE id=$1', [d.modelId])).rowCount) throw bad('VEHICLE_NOT_FOUND');
    set('model_id', d.modelId ?? null);
  }
  if (d.status !== undefined) { set('status', d.status); if (d.status === 'PUBLISHED') sets.push('archived_at=NULL'); }
  if (d.displayOrder !== undefined) set('display_order', d.displayOrder);
  const r = await pool.query(`UPDATE vehicle_tips SET ${sets.join(',')}, updated_at=now() WHERE id=$1 RETURNING id`, params);
  if (!r.rowCount) throw notFound('TIP_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_TIP_UPDATED', 'vehicle_tip', id, {});
  res.json({ tip: presentTip((await pool.query(`${TIP_SELECT} WHERE t.id=$1`, [id])).rows[0]) });
}));

adminVehiclesRouter.post('/tips/:id/archive', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const archived = z.object({ archived: z.boolean() }).strict().safeParse(req.body);
  if (!isUuid(id)) throw notFound('TIP_NOT_FOUND');
  if (!archived.success) throw bad();
  const r = await pool.query(archived.data.archived ? `UPDATE vehicle_tips SET archived_at=now(), status='DRAFT', updated_at=now() WHERE id=$1 RETURNING id` : `UPDATE vehicle_tips SET archived_at=NULL, updated_at=now() WHERE id=$1 RETURNING id`, [id]);
  if (!r.rowCount) throw notFound('TIP_NOT_FOUND');
  await audit(req.user!.id, archived.data.archived ? 'VEHICLE_TIP_ARCHIVED' : 'VEHICLE_TIP_RESTORED', 'vehicle_tip', id, {});
  res.json({ ok: true });
}));

adminVehiclesRouter.delete('/tips/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('TIP_NOT_FOUND');
  const r = await pool.query('DELETE FROM vehicle_tips WHERE id=$1 RETURNING id', [id]);
  if (!r.rowCount) throw notFound('TIP_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_TIP_DELETED', 'vehicle_tip', id, {});
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- importação por planilha
const HEADER_ALIASES: Record<string, string> = {
  marca: 'brand', modelo: 'model', tipo: 'type', carroceria: 'body', versao: 'version', ano: 'year', combustivel: 'fuel', codigo_fipe: 'fipe', fipe: 'fipe'
};

adminVehiclesRouter.get('/import/template.csv', (_req, res) => {
  const headers = ['marca', 'modelo', 'tipo', 'carroceria', 'versao', 'ano', 'combustivel', 'codigo_fipe', ...SPEC_FIELDS.map((f) => f.key)];
  const example: Record<string, string> = { marca: 'Marca Exemplo', modelo: 'Modelo Exemplo', tipo: 'carro', carroceria: 'Hatch', versao: 'Versão de exemplo 1.0 Flex', ano: '2020', combustivel: 'Flex', engine: '1.0 12V', power_hp: '80', abs: 'sim' };
  const body = `﻿${headers.join(';')}\r\n${headers.map((h) => csvEscape(example[h] ?? '')).join(';')}\r\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-guia-veiculos.csv"');
  res.send(body);
});

interface ImportReport { dryRun: boolean; rows: number; modelsNew: number; modelsExisting: number; versionsNew: number; versionsUpdated: number; errors: Array<{ line: number; message: string }> }

adminVehiclesRouter.post('/import', asyncRoute(async (req, res) => {
  const p = z.object({ csv: z.string().min(10).max(2_000_000), dryRun: z.boolean().default(true) }).strict().safeParse(req.body);
  if (!p.success) throw bad('IMPORT_INVALID');
  const table = parseCsv(p.data.csv);
  if (table.length < 2) throw bad('IMPORT_EMPTY');
  if (table.length > 2001) throw bad('IMPORT_TOO_LARGE');
  const header = table[0]!.map((h) => { const k = normalizeText(h).replace(/\s+/g, '_'); return HEADER_ALIASES[k] ?? (SPEC_BY_KEY.has(h.trim()) ? h.trim() : SPEC_BY_KEY.has(k) ? k : null); });
  for (const need of ['brand', 'model', 'version']) if (!header.includes(need)) throw bad('IMPORT_MISSING_COLUMNS');
  const report: ImportReport = { dryRun: p.data.dryRun, rows: table.length - 1, modelsNew: 0, modelsExisting: 0, versionsNew: 0, versionsUpdated: 0, errors: [] };
  const typeOf = (v: string) => (/moto/i.test(v) ? 'MOTORCYCLE' : /caminh|onibus|ônibus/i.test(v) ? 'TRUCK' : 'CAR');

  const run = async (client: Pick<PoolClient, 'query'>) => {
    const seenModels = new Map<string, string>();
    for (let i = 1; i < table.length; i++) {
      const cells = table[i]!;
      const get = (key: string) => (cells[header.indexOf(key)] ?? '').trim();
      const line = i + 1;
      const brand = get('brand'); const model = get('model'); const version = get('version');
      if (brand.length < 2 || !model || !version) { report.errors.push({ line, message: 'Marca, modelo e versão são obrigatórios.' }); continue; }
      const year = get('year') ? Number(get('year')) : null;
      if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)) { report.errors.push({ line, message: `Ano inválido: ${get('year')}` }); continue; }
      const rawSpecs: Record<string, string> = {};
      header.forEach((h, idx) => { if (h && SPEC_BY_KEY.has(h)) rawSpecs[h] = cells[idx] ?? ''; });
      const { specs, errors } = cleanSpecs(rawSpecs);
      if (errors.length) { report.errors.push({ line, message: errors.join('; ') }); continue; }
      const slugBase = slugify(`${brand} ${model}`);
      let modelId = seenModels.get(slugBase);
      if (!modelId) {
        const existing = await client.query('SELECT id FROM vehicle_models WHERE slug=$1', [slugBase]);
        if (existing.rowCount) { modelId = existing.rows[0].id as string; report.modelsExisting++; }
        else {
          report.modelsNew++;
          if (p.data.dryRun) modelId = `dry-${slugBase}`;
          else {
            const ins = await client.query(`INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,status,created_by) VALUES($1,$2,$3,$4,$5,'DRAFT',$6) RETURNING id`, [slugBase, brand, model, typeOf(get('type')), get('body') || null, req.user!.id]);
            modelId = ins.rows[0].id as string;
          }
        }
        seenModels.set(slugBase, modelId);
      }
      if (p.data.dryRun && modelId.startsWith('dry-')) { report.versionsNew++; continue; }
      const found = await client.query('SELECT id,specs FROM vehicle_versions WHERE model_id=$1 AND lower(name)=lower($2) AND coalesce(year_model,0)=$3', [modelId, version, year ?? 0]);
      if (found.rowCount) {
        report.versionsUpdated++;
        if (!p.data.dryRun) await client.query('UPDATE vehicle_versions SET specs=specs || $2::jsonb, fuel=coalesce(nullif($3,\'\'),fuel), fipe_code=coalesce(nullif($4,\'\'),fipe_code), updated_at=now() WHERE id=$1', [found.rows[0].id, JSON.stringify(specs), get('fuel'), get('fipe')]);
      } else {
        report.versionsNew++;
        if (!p.data.dryRun) await client.query('INSERT INTO vehicle_versions(model_id,name,year_model,fuel,fipe_code,specs) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [modelId, version, year, get('fuel') || null, get('fipe') || null, JSON.stringify(specs)]);
      }
    }
  };
  if (p.data.dryRun) await run(pool);
  else {
    await tx(run);
    await audit(req.user!.id, 'VEHICLE_GUIDE_IMPORTED', 'vehicle_models', null, { rows: report.rows, modelsNew: report.modelsNew, versionsNew: report.versionsNew, versionsUpdated: report.versionsUpdated, errors: report.errors.length });
  }
  res.json(report);
}));

// ---------------------------------------------------------------- consumo oficial (observações por fonte)
const CONSUMPTION_HEADERS: Record<string, string> = {
  id: 'id', marca: 'brand', modelo: 'model', ano_modelo: 'year', versao_pbev: 'version', versao: 'version', segmento_pbev: 'segment', propulsao: 'propulsion',
  combustivel_comparado: 'fuel', combustivel: 'fuel', consumo_urbano_km_l: 'city', consumo_rodoviario_km_l: 'road', unidade_consumo: 'unit',
  fonte_consumo: 'url', fonte: 'url', ciclo_pbev: 'cycle', ciclo: 'cycle', observacoes: 'note'
};
const FUELS: Record<string, string> = { gasolina: 'Gasolina', etanol: 'Etanol', alcool: 'Etanol', diesel: 'Diesel' };
const isNa = (v: string) => v === '' || /^(na|n\/a|nd|-|—)$/i.test(v.trim());
const kml = (v: string): number | null | 'bad' => {
  if (isNa(v)) return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 60 ? Math.round(n * 10) / 10 : 'bad';
};

adminVehiclesRouter.get('/consumption/template.csv', (_req, res) => {
  const headers = ['id', 'marca', 'modelo', 'ano_modelo', 'versao_pbev', 'segmento_pbev', 'propulsao', 'combustivel_comparado', 'consumo_urbano_km_l', 'consumo_rodoviario_km_l', 'unidade_consumo', 'fonte_consumo', 'ciclo_pbev', 'observacoes'];
  const example = ['EXEMPLO-1', 'MARCA', 'MODELO', 'NA', 'VERSÃO LITERAL DA TABELA', 'Compacto', 'Combustão', 'Gasolina', '13,5', '15,0', 'km/l', 'https://www.gov.br/inmetro/exemplo.pdf', 'PBEV 2024', 'Copie o rótulo da versão exatamente como está na fonte.'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-consumo-oficial.csv"');
  res.send(`﻿${headers.join(';')}\r\n${example.map(csvEscape).join(';')}\r\n`);
});

adminVehiclesRouter.get('/consumption', asyncRoute(async (req, res) => {
  const status = ['CONFERIDO', 'A_CONFERIR'].includes(String(req.query.status)) ? String(req.query.status) : null;
  const params: unknown[] = [];
  const where: string[] = [];
  if (status) { params.push(status); where.push(`o.status=$${params.length}`); }
  for (const token of String(req.query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 4)) {
    params.push(`%${token.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(o.brand || ' ' || o.model || ' ' || o.version_label) ILIKE $${params.length}`);
  }
  const r = await pool.query(`SELECT o.*, m.slug AS model_slug FROM vehicle_consumption_obs o LEFT JOIN vehicle_models m ON m.id=o.model_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.status DESC, o.brand, o.model, o.version_label, o.fuel LIMIT 500`, params);
  const counts = await pool.query(`SELECT count(*) FILTER (WHERE status='CONFERIDO')::int AS ok, count(*) FILTER (WHERE status='A_CONFERIR')::int AS pending FROM vehicle_consumption_obs`);
  res.json({
    counts: { conferido: Number(counts.rows[0]?.ok ?? 0), aConferir: Number(counts.rows[0]?.pending ?? 0) },
    items: r.rows.map((o) => ({
      id: o.id, brand: o.brand, model: o.model, versionLabel: o.version_label, modelYear: o.model_year, segment: o.segment, propulsion: o.propulsion, fuel: o.fuel,
      cityKml: o.city_kml == null ? null : Number(o.city_kml), roadKml: o.road_kml == null ? null : Number(o.road_kml), cycle: o.cycle, sourceKind: o.source_kind, sourceName: o.source_name,
      sourceUrl: o.source_url, collectedAt: o.collected_at instanceof Date ? o.collected_at.toISOString().slice(0, 10) : String(o.collected_at).slice(0, 10), status: o.status, note: o.note, modelSlug: o.model_slug ?? null
    }))
  });
}));

interface ConsumptionReport { dryRun: boolean; rows: number; created: number; updated: number; keptConfirmed: number; errors: Array<{ line: number; message: string }> }

/**
 * Importa linhas da tabela oficial (formato da planilha de pesquisa). Nada entra como "conferido": a pessoa
 * da equipe compara com a fonte e confirma linha a linha, e só então o consumo aparece no site.
 */
adminVehiclesRouter.post('/consumption/import', asyncRoute(async (req, res) => {
  const p = z.object({ csv: z.string().min(10).max(1_000_000), dryRun: z.boolean().default(true) }).strict().safeParse(req.body);
  if (!p.success) throw bad('IMPORT_INVALID');
  const table = parseCsv(p.data.csv);
  if (table.length < 2) throw bad('IMPORT_EMPTY');
  if (table.length > 2001) throw bad('IMPORT_TOO_LARGE');
  const header = table[0]!.map((h) => CONSUMPTION_HEADERS[normalizeText(h).replace(/\s+/g, '_')] ?? null);
  for (const need of ['brand', 'model', 'version', 'fuel', 'url', 'cycle']) if (!header.includes(need)) throw bad('IMPORT_MISSING_COLUMNS');
  if (!header.includes('city') && !header.includes('road')) throw bad('IMPORT_MISSING_COLUMNS');
  const report: ConsumptionReport = { dryRun: p.data.dryRun, rows: table.length - 1, created: 0, updated: 0, keptConfirmed: 0, errors: [] };
  const today = new Date().toISOString().slice(0, 10);

  const run = async (client: Pick<PoolClient, 'query'>) => {
    for (let i = 1; i < table.length; i++) {
      const cells = table[i]!;
      const get = (key: string) => { const idx = header.indexOf(key); return idx < 0 ? '' : (cells[idx] ?? '').trim(); };
      const line = i + 1;
      const brand = get('brand'); const model = get('model'); const versionLabel = get('version'); const cycle = get('cycle');
      if (brand.length < 2 || !model || !versionLabel || !cycle) { report.errors.push({ line, message: 'Marca, modelo, versão e ciclo são obrigatórios.' }); continue; }
      const fuel = FUELS[normalizeText(get('fuel'))];
      if (!fuel) { report.errors.push({ line, message: `Combustível não reconhecido: ${get('fuel')}` }); continue; }
      const unit = get('unit');
      if (unit && unit.toLowerCase().replace(/\s+/g, '') !== 'km/l') { report.errors.push({ line, message: `Unidade não aceita: ${unit} (use km/l).` }); continue; }
      const city = kml(get('city')); const road = kml(get('road'));
      if (city === 'bad' || road === 'bad') { report.errors.push({ line, message: 'Consumo inválido: use número entre 0,1 e 60 km/l ou NA.' }); continue; }
      if (city === null && road === null) { report.errors.push({ line, message: 'Informe o consumo urbano ou o rodoviário.' }); continue; }
      const url = get('url');
      let host = '';
      try { const u = new URL(url); if (u.protocol !== 'https:') throw new Error('http'); host = u.hostname.toLowerCase(); } catch { report.errors.push({ line, message: 'A fonte precisa ser uma URL https.' }); continue; }
      const year = isNa(get('year')) ? null : Number(get('year'));
      if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)) { report.errors.push({ line, message: `Ano inválido: ${get('year')}` }); continue; }
      const kind = host.endsWith('gov.br') && /inmetro|conpet/i.test(url) ? 'INMETRO' : /honda|toyota|fiat|chevrolet|volkswagen|vw\.com|hyundai|renault|jeep|ford|nissan|byd|caoa|peugeot|citroen/i.test(host) ? 'FABRICANTE' : 'OUTRA';
      const sourceName = kind === 'INMETRO' ? `Inmetro, Tabela PBE Veicular ${(cycle.match(/\d{4}/) ?? [''])[0]}`.trim() : host;
      const slug = slugify(`${brand} ${model}`);
      const m = await client.query('SELECT id FROM vehicle_models WHERE slug=$1', [slug]);
      const modelId = (m.rows[0]?.id as string | undefined) ?? null;
      const existing = await client.query(
        `SELECT id,status FROM vehicle_consumption_obs WHERE lower(brand)=lower($1) AND lower(model)=lower($2) AND lower(version_label)=lower($3) AND coalesce(model_year,0)=$4 AND lower(fuel)=lower($5) AND lower(cycle)=lower($6) AND source_kind=$7`,
        [brand, model, versionLabel, year ?? 0, fuel, cycle, kind]);
      if (existing.rowCount) {
        if (existing.rows[0].status === 'CONFERIDO') { report.keptConfirmed++; continue; }
        report.updated++;
        if (!p.data.dryRun) await client.query(`UPDATE vehicle_consumption_obs SET city_kml=$2, road_kml=$3, source_name=$4, source_url=$5, note=$6, segment=$7, propulsion=$8, model_id=$9, collected_at=$10, updated_at=now() WHERE id=$1`,
          [existing.rows[0].id, city, road, sourceName, url, get('note'), get('segment') || null, get('propulsion') || null, modelId, today]);
        continue;
      }
      report.created++;
      if (!p.data.dryRun) await client.query(
        `INSERT INTO vehicle_consumption_obs(brand,model,version_label,model_year,segment,propulsion,fuel,city_kml,road_kml,cycle,source_kind,source_name,source_url,collected_at,status,note,model_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'A_CONFERIR',$15,$16)`,
        [brand, model, versionLabel, year, get('segment') || null, get('propulsion') || null, fuel, city, road, cycle, kind, sourceName, url, today, get('note'), modelId]);
    }
  };
  if (p.data.dryRun) await run(pool);
  else {
    await tx(run);
    await audit(req.user!.id, 'VEHICLE_CONSUMPTION_IMPORTED', 'vehicle_consumption_obs', null, { rows: report.rows, created: report.created, updated: report.updated, errors: report.errors.length });
  }
  res.json(report);
}));

adminVehiclesRouter.patch('/consumption/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('CONSUMPTION_NOT_FOUND');
  const p = z.object({ status: z.enum(['CONFERIDO', 'A_CONFERIR']).optional(), versionId: z.string().refine(isUuid).nullish(), note: z.string().trim().max(600).optional() }).strict().safeParse(req.body);
  if (!p.success) throw bad();
  const cur = await pool.query('SELECT id, model_id FROM vehicle_consumption_obs WHERE id=$1', [id]);
  if (!cur.rowCount) throw notFound('CONSUMPTION_NOT_FOUND');
  if (p.data.versionId) {
    const v = await pool.query('SELECT 1 FROM vehicle_versions WHERE id=$1 AND model_id=$2', [p.data.versionId, cur.rows[0].model_id]);
    if (!v.rowCount) throw bad('VERSION_NOT_FOUND');
  }
  const sets: string[] = []; const vals: unknown[] = [id];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (p.data.status) add('status', p.data.status);
  if (p.data.versionId !== undefined) add('version_id', p.data.versionId ?? null);
  if (p.data.note !== undefined) add('note', p.data.note);
  if (!sets.length) throw bad();
  await pool.query(`UPDATE vehicle_consumption_obs SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, vals);
  await audit(req.user!.id, 'VEHICLE_CONSUMPTION_UPDATED', 'vehicle_consumption_obs', id, p.data);
  res.json({ ok: true });
}));

adminVehiclesRouter.delete('/consumption/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('CONSUMPTION_NOT_FOUND');
  const r = await pool.query('DELETE FROM vehicle_consumption_obs WHERE id=$1 RETURNING id', [id]);
  if (!r.rowCount) throw notFound('CONSUMPTION_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_CONSUMPTION_DELETED', 'vehicle_consumption_obs', id, {});
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- busca na FIPE para preencher modelo e versão
const fipeTypeSchema = z.enum(['cars', 'motorcycles', 'trucks']);
const fipeCode = z.string().regex(/^[A-Za-z0-9._-]{1,24}$/);
adminVehiclesRouter.get('/fipe/search', asyncRoute(async (req, res) => {
  const vt = fipeTypeSchema.safeParse(req.query.vehicleType ?? 'cars');
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (!vt.success || q.length < 2) throw bad();
  try { res.json(await fipeSearch(vt.data, q)); } catch { throw appError('FIPE_PROVIDER_UNAVAILABLE', { code: 'FIPE_PROVIDER_UNAVAILABLE', http: 502, expose: true }); }
}));
adminVehiclesRouter.get('/fipe/years', asyncRoute(async (req, res) => {
  const vt = fipeTypeSchema.safeParse(req.query.vehicleType ?? 'cars'); const b = fipeCode.safeParse(req.query.brandCode); const m = fipeCode.safeParse(req.query.modelCode);
  if (!vt.success || !b.success || !m.success) throw bad();
  try { res.json({ years: await fipeYears(vt.data, b.data, m.data) }); } catch { throw appError('FIPE_PROVIDER_UNAVAILABLE', { code: 'FIPE_PROVIDER_UNAVAILABLE', http: 502, expose: true }); }
}));
adminVehiclesRouter.get('/fipe/price', asyncRoute(async (req, res) => {
  const vt = fipeTypeSchema.safeParse(req.query.vehicleType ?? 'cars'); const b = fipeCode.safeParse(req.query.brandCode); const m = fipeCode.safeParse(req.query.modelCode); const y = fipeCode.safeParse(req.query.yearCode);
  if (!vt.success || !b.success || !m.success || !y.success) throw bad();
  try {
    const { result } = await getFipePrice(vt.data, b.data, m.data, y.data);
    res.json({ valueCents: result.valueCents, valueLabel: result.valueLabel, referenceMonth: result.referenceMonth, fipeCode: result.fipeCode, brand: result.brand, model: result.model, year: result.year, fuel: result.fuel ?? null, modelYear: result.modelYear ?? null });
  } catch (error) {
    const notFound = error instanceof Error && 'code' in error && error.code === 'FIPE_NOT_FOUND';
    throw appError(notFound ? 'FIPE_NOT_FOUND' : 'FIPE_PROVIDER_UNAVAILABLE', { code: notFound ? 'FIPE_NOT_FOUND' : 'FIPE_PROVIDER_UNAVAILABLE', http: notFound ? 404 : 502, expose: true });
  }
}));

// ---------------------------------------------------------------- catálogo de frota (Senatran)
adminVehiclesRouter.get('/catalog/summary', asyncRoute(async (_req, res) => {
  const [snaps, totals, models] = await Promise.all([
    pool.query(`SELECT snapshot,names,fleet_total,source_name,license,loaded_at FROM vehicle_catalog_snapshots ORDER BY snapshot DESC`),
    pool.query(`SELECT count(*)::int AS names, coalesce(sum(fleet_total),0)::bigint AS fleet, count(*) FILTER (WHERE model_id IS NOT NULL)::int AS matched_names,
        coalesce(sum(fleet_total) FILTER (WHERE model_id IS NOT NULL),0)::bigint AS matched_fleet FROM vehicle_catalog`),
    pool.query(`SELECT m.id,m.brand,m.name,m.slug,count(c.id)::int AS names, coalesce(sum(c.fleet_total),0)::bigint AS fleet
      FROM vehicle_models m LEFT JOIN vehicle_catalog c ON c.model_id=m.id WHERE m.archived_at IS NULL GROUP BY m.id ORDER BY fleet DESC, m.brand, m.name`)
  ]);
  const t = totals.rows[0]!;
  res.json({
    snapshots: snaps.rows.map((s2) => ({ snapshot: s2.snapshot, names: Number(s2.names), fleet: Number(s2.fleet_total), sourceName: s2.source_name, license: s2.license, loadedAt: s2.loaded_at })),
    names: Number(t.names), fleet: Number(t.fleet), matchedNames: Number(t.matched_names), matchedFleet: Number(t.matched_fleet),
    models: models.rows.map((m) => ({ id: m.id, brand: m.brand, name: m.name, slug: m.slug, names: Number(m.names), fleet: Number(m.fleet) }))
  });
}));

/** Filtros comuns da lista e da exportação: palavras do nome, ligado ao guia (sim/não) e modelo do guia. */
function catalogFilter(q: Record<string, unknown>): { where: string; params: unknown[] } {
  const params: unknown[] = []; const where: string[] = [];
  for (const t of searchTerms(typeof q.q === 'string' ? q.q.slice(0, 80) : '')) {
    params.push(`%${likeEscape(t)}%`); where.push(`c.search_text LIKE $${params.length}`);
  }
  if (q.matched === 'yes') where.push('c.model_id IS NOT NULL'); else if (q.matched === 'no') where.push('c.model_id IS NULL');
  if (typeof q.modelId === 'string' && /^[0-9a-f-]{36}$/i.test(q.modelId)) { params.push(q.modelId); where.push(`c.model_id=$${params.length}`); }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}
const CATALOG_ORDER: Record<string, string> = { fleet: 'c.fleet_total DESC, c.raw_name', name: 'c.raw_name', year: 'c.year_max DESC NULLS LAST, c.fleet_total DESC' };

/** Lista paginada de todos os veículos do catálogo (cada nome como o Senatran cadastra), com a ligação ao guia. */
adminVehiclesRouter.get('/catalog/list', asyncRoute(async (req, res) => {
  const { where, params } = catalogFilter(req.query);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const order = CATALOG_ORDER[String(req.query.sort)] ?? CATALOG_ORDER.fleet;
  const [count, rows] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n, coalesce(sum(c.fleet_total),0)::bigint AS fleet FROM vehicle_catalog c ${where}`, params),
    pool.query(`SELECT c.id,c.raw_name,c.fleet_total,c.year_min,c.year_max,c.years,c.snapshot,c.model_id,m.brand,m.name AS model_name,m.slug
      FROM vehicle_catalog c LEFT JOIN vehicle_models m ON m.id=c.model_id ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params)
  ]);
  res.json({
    total: Number(count.rows[0]!.n), fleet: Number(count.rows[0]!.fleet), page, pageSize,
    items: rows.rows.map((c) => ({
      id: Number(c.id), name: c.raw_name, prefix: String(c.raw_name).includes('/') ? String(c.raw_name).split('/')[0] : null,
      fleet: Number(c.fleet_total), yearMin: c.year_min, yearMax: c.year_max, years: c.years as Record<string, number>, snapshot: c.snapshot,
      guide: c.model_id ? { id: c.model_id, brand: c.brand, name: c.model_name, slug: c.slug } : null
    }))
  });
}));

/** Exporta o catálogo (com os mesmos filtros) em CSV: uma linha por nome, com a frota por ano de fabricação em colunas. */
adminVehiclesRouter.get('/catalog/export', asyncRoute(async (req, res) => {
  const { where, params } = catalogFilter(req.query);
  const r = await pool.query(`SELECT c.raw_name,c.fleet_total,c.year_min,c.year_max,c.years,c.snapshot,m.brand,m.name AS model_name
    FROM vehicle_catalog c LEFT JOIN vehicle_models m ON m.id=c.model_id ${where} ORDER BY c.fleet_total DESC, c.raw_name LIMIT 60000`, params);
  const csv = toCsv(['nome_senatran', 'frota_total', 'fabricacao_de', 'fabricacao_ate', 'frota_por_ano_fabricacao', 'snapshot', 'marca_guia', 'modelo_guia'],
    r.rows.map((c) => [c.raw_name, c.fleet_total, c.year_min ?? '', c.year_max ?? '',
      Object.entries(c.years as Record<string, number>).sort(([a], [b]) => Number(a) - Number(b)).map(([y, n]) => `${y === '0' ? 'sem ano' : y}:${n}`).join(' '), c.snapshot, c.brand ?? '', c.model_name ?? '']));
  await audit(req.user!.id, 'VEHICLE_CATALOG_EXPORTED', 'vehicle_catalog', null, { rows: r.rowCount });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="catalogo-frota.csv"');
  res.send(csv);
}));

adminVehiclesRouter.post('/catalog/rematch', asyncRoute(async (req, res) => {
  const r = await rematchCatalog(pool);
  await audit(req.user!.id, 'VEHICLE_CATALOG_REMATCHED', 'vehicle_catalog', null, r);
  res.json(r);
}));

/** Importa um snapshot novo do Senatran (CSV `;`). Corpo JSON: { csv, snapshot: 'AAAA-MM', dryRun }. Nomes ausentes no arquivo novo ficam como estavam. */
adminVehiclesRouter.post('/catalog/import', express.json({ limit: '12mb' }), asyncRoute(async (req, res) => {
  const p = z.object({ csv: z.string().min(30).max(12_000_000), snapshot: z.string(), dryRun: z.boolean().default(true) }).strict().safeParse(req.body);
  if (!p.success) throw bad('IMPORT_INVALID');
  const { snapshot, dryRun } = p.data;
  if (!SNAPSHOT_RE.test(snapshot)) throw bad('CATALOG_SNAPSHOT_INVALID');
  const parsed = parseSenatranCsv(parseCsv(p.data.csv));
  if (parsed.errors.length && !parsed.snapshot.rows.length) throw Object.assign(bad('IMPORT_INVALID'), { details: parsed.errors });
  const names = parsed.snapshot.rows.map((r) => r.name);
  let existing = 0;
  for (let i = 0; i < names.length; i += 5000) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM vehicle_catalog WHERE raw_name = ANY($1::text[])`, [names.slice(i, i + 5000)]);
    existing += Number(r.rows[0]?.n ?? 0);
  }
  const previous = await pool.query(`SELECT snapshot,names,fleet_total FROM vehicle_catalog_snapshots WHERE snapshot < $1 ORDER BY snapshot DESC LIMIT 1`, [snapshot]);
  const report = {
    dryRun, snapshot, names: names.length, fleet: parsed.snapshot.total, newNames: names.length - existing, existingNames: existing, errors: parsed.errors,
    previous: previous.rows[0] ? { snapshot: previous.rows[0].snapshot, names: Number(previous.rows[0].names), fleet: Number(previous.rows[0].fleet_total) } : null,
    matched: null as null | { matched: number; models: number }
  };
  if (!dryRun) {
    if (parsed.errors.length) throw Object.assign(bad('IMPORT_HAS_ERRORS'), { details: parsed.errors });
    report.matched = await tx(async (client) => {
      await upsertCatalog(client, { snapshot, total: parsed.snapshot.total, rows: parsed.snapshot.rows });
      return rematchCatalog(client);
    });
    await audit(req.user!.id, 'VEHICLE_CATALOG_IMPORTED', 'vehicle_catalog', null, { snapshot, names: report.names, fleet: report.fleet, newNames: report.newNames });
  }
  res.json(report);
}));

/** O que as pessoas procuram: escolhas no simulador, na busca, visitas às fichas e buscas sem resultado. */
adminVehiclesRouter.get('/interest', asyncRoute(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = `now() - make_interval(days => ${days})`;
  const [totals, picks, models, noResult] = await Promise.all([
    pool.query(`SELECT event_type, count(*)::int AS n, count(DISTINCT session_key)::int AS sessions FROM vehicle_interest_events WHERE created_at > ${since} GROUP BY event_type`),
    pool.query(`SELECT c.id,c.raw_name,c.fleet_total,e.event_type,count(*)::int AS n FROM vehicle_interest_events e JOIN vehicle_catalog c ON c.id=e.catalog_id
      WHERE e.event_type IN ('SIMULATOR_PICK','SEARCH_PICK') AND e.created_at > ${since} GROUP BY c.id,c.raw_name,c.fleet_total,e.event_type ORDER BY n DESC, c.fleet_total DESC LIMIT 60`),
    pool.query(`SELECT m.brand,m.name,m.slug,count(*)::int AS n FROM vehicle_interest_events e JOIN vehicle_models m ON m.id=e.model_id
      WHERE e.event_type='MODEL_VIEW' AND e.created_at > ${since} GROUP BY m.id ORDER BY n DESC LIMIT 30`),
    pool.query(`SELECT term,count(*)::int AS n FROM vehicle_interest_events WHERE event_type='SEARCH_NO_RESULT' AND created_at > ${since} GROUP BY term ORDER BY n DESC, term LIMIT 40`)
  ]);
  res.json({
    days,
    totals: Object.fromEntries(totals.rows.map((t) => [t.event_type, { events: Number(t.n), sessions: Number(t.sessions) }])),
    picks: picks.rows.map((p2) => ({ id: Number(p2.id), name: p2.raw_name, fleet: Number(p2.fleet_total), type: p2.event_type, count: Number(p2.n) })),
    models: models.rows.map((m) => ({ brand: m.brand, name: m.name, slug: m.slug, views: Number(m.n) })),
    noResult: noResult.rows.map((t) => ({ term: t.term, count: Number(t.n) }))
  });
}));

// ---------------------------------------------------------------- modelos
adminVehiclesRouter.get('/', asyncRoute(async (req, res) => {
  const view = ['all', 'draft', 'published', 'archived'].includes(String(req.query.view)) ? String(req.query.view) : 'all';
  const where: string[] = [view === 'archived' ? 'm.archived_at IS NOT NULL' : 'm.archived_at IS NULL'];
  if (view === 'draft') where.push(`m.status='DRAFT'`);
  if (view === 'published') where.push(`m.status='PUBLISHED'`);
  const params: unknown[] = [];
  for (const token of String(req.query.search ?? '').split(/\s+/).filter(Boolean).slice(0, 5)) {
    params.push(`%${token.replace(/[%_\\]/g, '\\$&')}%`);
    where.push(`(m.brand || ' ' || m.name) ILIKE $${params.length}`);
  }
  const r = await pool.query(`SELECT m.id,m.slug,m.brand,m.name,m.vehicle_type,m.body_type,m.year_from,m.year_to,m.status,m.archived_at,m.updated_at,
      (SELECT count(*) FROM vehicle_versions v WHERE v.model_id=m.id)::int AS versions,
      (SELECT count(*) FROM vehicle_opinions o WHERE o.model_id=m.id AND o.status='APPROVED')::int AS opinions,
      (SELECT count(*) FROM vehicle_opinions o WHERE o.model_id=m.id AND o.status='PENDING')::int AS pending_opinions,
      (m.summary <> '' AND m.review <> '') AS has_text, m.featured, m.image_url IS NOT NULL AS has_image,
      (SELECT sum(c.fleet_total) FROM vehicle_catalog c WHERE c.model_id=m.id)::bigint AS fleet
    FROM vehicle_models m WHERE ${where.join(' AND ')} ORDER BY m.brand, m.name LIMIT 500`, params);
  res.json({
    items: r.rows.map((m) => ({
      id: m.id, slug: m.slug, brand: m.brand, name: m.name, vehicleType: m.vehicle_type, bodyType: m.body_type, yearFrom: m.year_from, yearTo: m.year_to,
      status: m.status, archived: m.archived_at != null, updatedAt: m.updated_at, versions: Number(m.versions), opinions: Number(m.opinions), pendingOpinions: Number(m.pending_opinions), hasText: Boolean(m.has_text),
      featured: Boolean(m.featured), hasImage: Boolean(m.has_image), fleet: m.fleet === null ? null : Number(m.fleet)
    }))
  });
}));

adminVehiclesRouter.post('/', asyncRoute(async (req, res) => {
  const p = modelCreate.safeParse(req.body);
  if (!p.success) throw bad();
  const d = p.data;
  const id = await tx(async (client) => {
    const slug = await uniqueSlug(client, d.brand, d.name);
    const r = await client.query(`INSERT INTO vehicle_models(slug,brand,name,vehicle_type,body_type,year_from,year_to,summary,review,pros,cons,buyer_tips,image_url,status,created_by,spec_source,image_credit,image_license,image_source_url,featured,featured_order,catalog_brands,catalog_names,catalog_exclude)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
      [slug, d.brand, d.name, d.vehicleType, d.bodyType, d.yearFrom ?? null, d.yearTo ?? null, d.summary, d.review, JSON.stringify(d.pros), JSON.stringify(d.cons), d.buyerTips, d.imageUrl, d.status, req.user!.id, d.specSource,
        d.imageCredit, d.imageLicense, d.imageSourceUrl, d.featured, d.featuredOrder ?? null, d.catalogBrands, d.catalogNames, d.catalogExclude]);
    return r.rows[0].id as string;
  });
  await rematchCatalog(pool);
  await audit(req.user!.id, 'VEHICLE_MODEL_CREATED', 'vehicle_model', id, { brand: d.brand, name: d.name });
  res.status(201).json({ model: presentModel((await pool.query('SELECT * FROM vehicle_models WHERE id=$1', [id])).rows[0]) });
}));

adminVehiclesRouter.get('/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('VEHICLE_NOT_FOUND');
  const [m, versions, counts] = await Promise.all([
    pool.query('SELECT * FROM vehicle_models WHERE id=$1', [id]),
    pool.query('SELECT * FROM vehicle_versions WHERE model_id=$1 ORDER BY year_model DESC NULLS LAST, display_order, name', [id]),
    pool.query(`SELECT count(*) FILTER (WHERE status='APPROVED')::int AS approved, count(*) FILTER (WHERE status='PENDING')::int AS pending FROM vehicle_opinions WHERE model_id=$1`, [id])
  ]);
  if (!m.rowCount) throw notFound('VEHICLE_NOT_FOUND');
  res.json({ model: presentModel(m.rows[0]), versions: versions.rows.map(presentVersion), opinions: { approved: Number(counts.rows[0]!.approved), pending: Number(counts.rows[0]!.pending) } });
}));

adminVehiclesRouter.patch('/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const p = modelUpdate.safeParse(req.body);
  if (!isUuid(id)) throw notFound('VEHICLE_NOT_FOUND');
  if (!p.success || !Object.keys(p.data).length) throw bad();
  const d = p.data;
  const sets: string[] = []; const params: unknown[] = [id];
  const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col}=$${params.length}${cast}`); };
  if (d.slug !== undefined) {
    if ((await pool.query('SELECT 1 FROM vehicle_models WHERE slug=$1 AND id<>$2', [d.slug, id])).rowCount) throw conflict('SLUG_TAKEN');
    set('slug', d.slug);
  }
  if (d.brand !== undefined) set('brand', d.brand);
  if (d.name !== undefined) set('name', d.name);
  if (d.vehicleType !== undefined) set('vehicle_type', d.vehicleType);
  if (d.bodyType !== undefined) set('body_type', d.bodyType);
  if (d.yearFrom !== undefined) set('year_from', d.yearFrom ?? null);
  if (d.yearTo !== undefined) set('year_to', d.yearTo ?? null);
  if (d.summary !== undefined) set('summary', d.summary);
  if (d.review !== undefined) set('review', d.review);
  if (d.pros !== undefined) set('pros', JSON.stringify(d.pros), '::jsonb');
  if (d.cons !== undefined) set('cons', JSON.stringify(d.cons), '::jsonb');
  if (d.buyerTips !== undefined) set('buyer_tips', d.buyerTips);
  if (d.imageUrl !== undefined) set('image_url', d.imageUrl);
  if (d.specSource !== undefined) set('spec_source', d.specSource);
  if (d.imageCredit !== undefined) set('image_credit', d.imageCredit);
  if (d.imageLicense !== undefined) set('image_license', d.imageLicense);
  if (d.imageSourceUrl !== undefined) set('image_source_url', d.imageSourceUrl);
  if (d.featured !== undefined) set('featured', d.featured);
  if (d.featuredOrder !== undefined) set('featured_order', d.featuredOrder ?? null);
  if (d.catalogBrands !== undefined) set('catalog_brands', d.catalogBrands);
  if (d.catalogNames !== undefined) set('catalog_names', d.catalogNames);
  if (d.catalogExclude !== undefined) set('catalog_exclude', d.catalogExclude);
  if (d.status !== undefined) { set('status', d.status); if (d.status === 'PUBLISHED') sets.push('archived_at=NULL'); }
  const r = await pool.query(`UPDATE vehicle_models SET ${sets.join(',')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
  if (!r.rowCount) throw notFound('VEHICLE_NOT_FOUND');
  if (['brand', 'name', 'catalogBrands', 'catalogNames', 'catalogExclude'].some((k) => k in d)) await rematchCatalog(pool);
  await audit(req.user!.id, 'VEHICLE_MODEL_UPDATED', 'vehicle_model', id, { fields: Object.keys(d) });
  res.json({ model: presentModel(r.rows[0]) });
}));

adminVehiclesRouter.post('/:id/archive', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const p = z.object({ archived: z.boolean() }).strict().safeParse(req.body);
  if (!isUuid(id)) throw notFound('VEHICLE_NOT_FOUND');
  if (!p.success) throw bad();
  const r = await pool.query(p.data.archived ? `UPDATE vehicle_models SET archived_at=now(), status='DRAFT', updated_at=now() WHERE id=$1 RETURNING id` : `UPDATE vehicle_models SET archived_at=NULL, updated_at=now() WHERE id=$1 RETURNING id`, [id]);
  if (!r.rowCount) throw notFound('VEHICLE_NOT_FOUND');
  await audit(req.user!.id, p.data.archived ? 'VEHICLE_MODEL_ARCHIVED' : 'VEHICLE_MODEL_RESTORED', 'vehicle_model', id, {});
  res.json({ ok: true });
}));

adminVehiclesRouter.delete('/:id', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!isUuid(id)) throw notFound('VEHICLE_NOT_FOUND');
  const used = await pool.query('SELECT count(*)::int AS n FROM vehicle_opinions WHERE model_id=$1', [id]);
  if (Number(used.rows[0]!.n) > 0) throw conflict('VEHICLE_HAS_OPINIONS');
  const r = await pool.query('DELETE FROM vehicle_models WHERE id=$1 RETURNING brand,name', [id]);
  if (!r.rowCount) throw notFound('VEHICLE_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_MODEL_DELETED', 'vehicle_model', id, { brand: r.rows[0].brand, name: r.rows[0].name });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- versões (ficha técnica)
const dupMessage = (e: unknown) => (e as { code?: string })?.code === '23505' ? conflict('VERSION_DUPLICATE') : e;

adminVehiclesRouter.post('/:id/versions', asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const p = versionCreate.safeParse(req.body);
  if (!isUuid(id)) throw notFound('VEHICLE_NOT_FOUND');
  if (!p.success) throw bad();
  const specs = specsOrThrow(p.data.specs);
  if (!(await pool.query('SELECT 1 FROM vehicle_models WHERE id=$1', [id])).rowCount) throw notFound('VEHICLE_NOT_FOUND');
  try {
    const r = await pool.query('INSERT INTO vehicle_versions(model_id,name,year_model,fuel,fipe_code,specs,display_order,active) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *',
      [id, p.data.name, p.data.yearModel ?? null, p.data.fuel, p.data.fipeCode, JSON.stringify(specs), p.data.displayOrder, p.data.active]);
    await audit(req.user!.id, 'VEHICLE_VERSION_CREATED', 'vehicle_version', r.rows[0].id, { modelId: id });
    res.status(201).json({ version: presentVersion(r.rows[0]) });
  } catch (e) { throw dupMessage(e); }
}));

adminVehiclesRouter.patch('/versions/:vid', asyncRoute(async (req, res) => {
  const vid = String(req.params.vid);
  const p = versionUpdate.safeParse(req.body);
  if (!isUuid(vid)) throw notFound('VERSION_NOT_FOUND');
  if (!p.success || !Object.keys(p.data).length) throw bad();
  const d = p.data;
  const sets: string[] = []; const params: unknown[] = [vid];
  const set = (col: string, v: unknown, cast = '') => { params.push(v); sets.push(`${col}=$${params.length}${cast}`); };
  if (d.name !== undefined) set('name', d.name);
  if (d.yearModel !== undefined) set('year_model', d.yearModel ?? null);
  if (d.fuel !== undefined) set('fuel', d.fuel);
  if (d.fipeCode !== undefined) set('fipe_code', d.fipeCode);
  if (d.specs !== undefined) set('specs', JSON.stringify(specsOrThrow(d.specs)), '::jsonb');
  if (d.displayOrder !== undefined) set('display_order', d.displayOrder);
  if (d.active !== undefined) set('active', d.active);
  try {
    const r = await pool.query(`UPDATE vehicle_versions SET ${sets.join(',')}, updated_at=now() WHERE id=$1 RETURNING *`, params);
    if (!r.rowCount) throw notFound('VERSION_NOT_FOUND');
    await audit(req.user!.id, 'VEHICLE_VERSION_UPDATED', 'vehicle_version', vid, { fields: Object.keys(d) });
    res.json({ version: presentVersion(r.rows[0]) });
  } catch (e) { throw dupMessage(e); }
}));

adminVehiclesRouter.post('/versions/:vid/duplicate', asyncRoute(async (req, res) => {
  const vid = String(req.params.vid);
  if (!isUuid(vid)) throw notFound('VERSION_NOT_FOUND');
  const src = await pool.query('SELECT * FROM vehicle_versions WHERE id=$1', [vid]);
  if (!src.rowCount) throw notFound('VERSION_NOT_FOUND');
  const v = src.rows[0]!;
  const copy = await tx(async (client) => {
    for (let i = 2; i < 30; i++) {
      const name = `${v.name} (cópia${i > 2 ? ` ${i - 1}` : ''})`;
      const exists = await client.query('SELECT 1 FROM vehicle_versions WHERE model_id=$1 AND lower(name)=lower($2) AND coalesce(year_model,0)=$3', [v.model_id, name, v.year_model ?? 0]);
      if (exists.rowCount) continue;
      return (await client.query('INSERT INTO vehicle_versions(model_id,name,year_model,fuel,fipe_code,specs,display_order,active) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,true) RETURNING *', [v.model_id, name, v.year_model, v.fuel, v.fipe_code, JSON.stringify(v.specs ?? {}), v.display_order])).rows[0];
    }
    return null;
  });
  if (!copy) throw conflict('VERSION_DUPLICATE');
  await audit(req.user!.id, 'VEHICLE_VERSION_CREATED', 'vehicle_version', copy.id, { modelId: copy.model_id, duplicatedFrom: vid });
  res.status(201).json({ version: presentVersion(copy) });
}));

adminVehiclesRouter.delete('/versions/:vid', asyncRoute(async (req, res) => {
  const vid = String(req.params.vid);
  if (!isUuid(vid)) throw notFound('VERSION_NOT_FOUND');
  const r = await pool.query('DELETE FROM vehicle_versions WHERE id=$1 RETURNING model_id', [vid]);
  if (!r.rowCount) throw notFound('VERSION_NOT_FOUND');
  await audit(req.user!.id, 'VEHICLE_VERSION_DELETED', 'vehicle_version', vid, { modelId: r.rows[0].model_id });
  res.json({ ok: true });
}));
