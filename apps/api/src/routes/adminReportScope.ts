import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool, tx } from '../db.js';
import { normalizeBdrp } from '../normalizer.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { defaultScopeForTier, refreshScopes, scopeCatalog, scopeForProduct, validateScopeConfig } from '../lib/reportScope.js';
import { requirePermission } from '../permissions.js';
import { tierForProductCode, viewReport } from '../report/normalizeV2.js';

/**
 * Escopo de relatório por produto (campos e seções), versionado, com prévia, publicação e rollback.
 * Vale para o relatório do app, API pública, HTML e PDF.
 */
export const adminReportScopeRouter = Router();
adminReportScopeRouter.use(adminAuth);
const guard = requirePermission('MANAGE_PRICING'); // por rota: um guard no router barraria as demais rotas /admin

const createBody = z.object({ name: z.string().trim().min(2).max(120), config: z.unknown(), publish: z.boolean().default(false) }).strict();

async function productOr404(id: string) {
  const r = await pool.query('SELECT id,name,report_sections FROM query_products WHERE id=$1', [id]);
  if (!r.rowCount) throw appError('PRODUCT_NOT_FOUND', { code: 'PRODUCT_NOT_FOUND', http: 404, expose: true });
  return r.rows[0] as { id: string; name: string; report_sections: string[] | null };
}

async function publishTemplate(client: PoolClient, templateId: string, productId: string, userId: string) {
  await client.query(`UPDATE report_template_publications SET superseded_at=now() WHERE product_id=$1 AND superseded_at IS NULL`, [productId]);
  await client.query(`UPDATE report_templates SET status='DRAFT' WHERE product_id=$1 AND status='PUBLISHED'`, [productId]);
  await client.query(`UPDATE report_templates SET status='PUBLISHED' WHERE id=$1`, [templateId]);
  await client.query(`INSERT INTO report_template_publications(product_id,template_id,published_by) VALUES($1,$2,$3)`, [productId, templateId, userId]);
  await client.query(`INSERT INTO product_report_configs(product_id,template_id,mode,formats,updated_by) VALUES($1,$2,'SNAPSHOT',ARRAY['JSON','HTML','PDF'],$3)
    ON CONFLICT(product_id) DO UPDATE SET template_id=EXCLUDED.template_id,updated_by=EXCLUDED.updated_by,updated_at=now()`, [productId, templateId, userId]);
}

adminReportScopeRouter.get('/report-scope/catalog', guard, (_req, res) => { res.json({ sections: scopeCatalog() }); });

adminReportScopeRouter.get('/products/:id/report-scope', guard, asyncRoute(async (req, res) => {
  const product = await productOr404(String(req.params.id));
  const versions = await pool.query(`SELECT t.id,t.version,t.name,t.status,t.config,t.created_at,
      (SELECT max(p.published_at) FROM report_template_publications p WHERE p.template_id=t.id) AS last_published_at
    FROM report_templates t WHERE t.product_id=$1 AND t.config->>'model'='CATALOG_V1' ORDER BY t.version DESC`, [product.id]);
  const current = scopeForProduct(product.id);
  res.json({
    productId: product.id, productName: product.name, legacySections: product.report_sections, tier: tierForProductCode(product.id),
    currentTemplateId: current.template?.id ?? null, currentVersion: current.template?.version ?? null,
    suggested: defaultScopeForTier(tierForProductCode(product.id)),
    versions: versions.rows.map((v) => ({ id: v.id, version: Number(v.version), name: v.name, status: v.status, config: v.config, createdAt: v.created_at, lastPublishedAt: v.last_published_at }))
  });
}));

adminReportScopeRouter.post('/products/:id/report-scope', guard, asyncRoute(async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const validation = validateScopeConfig(body.data.config);
  if (!validation.ok) { res.status(400).json({ error: 'INVALID_REPORT_SCOPE', errors: validation.errors }); return; }
  const product = await productOr404(String(req.params.id));
  const created = await tx(async (client) => {
    const next = await client.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM report_templates WHERE product_id=$1', [product.id]);
    const row = await client.query(`INSERT INTO report_templates(product_id,version,name,status,config,created_by) VALUES($1,$2,$3,'DRAFT',$4::jsonb,$5) RETURNING id,version,name,status,created_at`,
      [product.id, Number(next.rows[0].v), body.data.name, JSON.stringify(validation.config), req.user!.id]);
    if (body.data.publish) await publishTemplate(client, row.rows[0].id, product.id, req.user!.id);
    return row.rows[0];
  });
  await audit(req.user!.id, body.data.publish ? 'PUBLISH_REPORT_SCOPE' : 'CREATE_REPORT_SCOPE', 'REPORT_TEMPLATE', String(created.id), { productId: product.id, version: Number(created.version), requestId: requestId(req) });
  if (body.data.publish) await refreshScopes();
  res.status(201).json({ id: created.id, version: Number(created.version), name: created.name, status: body.data.publish ? 'PUBLISHED' : 'DRAFT' });
}));

/** Publica uma versão (também serve de rollback: publicar uma versão antiga). Consultas já feitas mantêm o modelo da época. */
adminReportScopeRouter.post('/report-scope/:templateId/publish', guard, asyncRoute(async (req, res) => {
  const t = await pool.query(`SELECT id,product_id,version,config FROM report_templates WHERE id=$1 AND config->>'model'='CATALOG_V1'`, [req.params.templateId]);
  if (!t.rowCount) throw appError('REPORT_TEMPLATE_NOT_FOUND', { code: 'REPORT_TEMPLATE_NOT_FOUND', http: 404, expose: true });
  const validation = validateScopeConfig(t.rows[0].config);
  if (!validation.ok) { res.status(400).json({ error: 'INVALID_REPORT_SCOPE', errors: validation.errors }); return; }
  await tx((client) => publishTemplate(client, t.rows[0].id, t.rows[0].product_id, req.user!.id));
  await audit(req.user!.id, 'PUBLISH_REPORT_SCOPE', 'REPORT_TEMPLATE', String(t.rows[0].id), { productId: t.rows[0].product_id, version: Number(t.rows[0].version), requestId: requestId(req) });
  await refreshScopes();
  res.json({ id: t.rows[0].id, productId: t.rows[0].product_id, version: Number(t.rows[0].version), status: 'PUBLISHED' });
}));

/** Prévia com a placa fictícia do ambiente de teste (nunca consulta provedor nem cobra). */
adminReportScopeRouter.post('/products/:id/report-scope/preview', guard, asyncRoute(async (req, res) => {
  const validation = validateScopeConfig((req.body as { config?: unknown } | undefined)?.config);
  if (!validation.ok) { res.status(400).json({ error: 'INVALID_REPORT_SCOPE', errors: validation.errors }); return; }
  const product = await productOr404(String(req.params.id));
  const sample = await pool.query('SELECT plate,raw_response FROM sandbox_vehicles ORDER BY plate LIMIT 1');
  if (!sample.rowCount) throw appError('PREVIEW_SAMPLE_UNAVAILABLE', { code: 'PREVIEW_SAMPLE_UNAVAILABLE', http: 409, expose: true });
  const v2 = normalizeBdrp(sample.rows[0].raw_response).v2;
  if (!v2) throw appError('PREVIEW_SAMPLE_UNAVAILABLE', { code: 'PREVIEW_SAMPLE_UNAVAILABLE', http: 409, expose: true });
  res.json({ sample: true, note: 'Dados fictícios de teste. Não há consulta real nem cobrança.', report: viewReport(v2, { audience: 'client', tier: tierForProductCode(product.id), template: { version: 0, config: validation.config } }) });
}));
