import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { adminAuth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { hashIp } from '../lib/totpFlow.js';
import { decryptRaw } from '../lib/rawStore.js';
import { requirePermission } from '../permissions.js';
import { extractReturn, viewReport, type ReportV2 } from '../report/normalizeV2.js';
import type { NormalizedVehicle } from '../types.js';

/**
 * Consultas vistas pela equipe (LGPD): relatório com dados pessoais mascarados e revelação
 * pontual, motivada e auditada do valor original (decifrado do JSON bruto armazenado).
 */
export const adminQueriesRouter = Router();
adminQueriesRouter.use(adminAuth);

export const REVEALABLE_FIELDS = ['PRONOME', 'PRONOMEANTERIOR', 'CPF_CNPJ_PROPRIETARIO', 'CPFCNPJFATURADO', 'CPFCNPJCOMPRADOR', 'CHASSI', 'RENAVAM', 'MOTOR'] as const;

adminQueriesRouter.get('/:id', requirePermission('VIEW_QUERIES'), asyncRoute(async (req, res) => {
  const row = await pool.query(`SELECT q.id,q.plate,q.status,q.price_cents,q.charge_source,q.provider,q.source,q.created_at,q.completed_at,q.error_code,
      p.id AS product_id,p.name AS product_name,u.name AS customer_name,u.email AS customer_email,r.normalized,(r.raw_enc IS NOT NULL) AS has_raw
    FROM vehicle_queries q JOIN users u ON u.id=q.user_id JOIN query_products p ON p.id=q.product_id LEFT JOIN vehicle_query_results r ON r.query_id=q.id
    WHERE q.id=$1`, [req.params.id]);
  if (!row.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  const q = row.rows[0] as Record<string, unknown>;
  const normalized = q.normalized as NormalizedVehicle | null;
  const report: ReportV2 | null = normalized?.v2 ? viewReport(normalized.v2, { audience: 'team', tier: 3 }) : null;
  res.json({
    id: q.id, plate: q.plate, status: q.status, priceCents: Number(q.price_cents ?? 0), chargeSource: q.charge_source, provider: q.provider, source: q.source,
    productId: q.product_id, productName: q.product_name, createdAt: q.created_at, completedAt: q.completed_at, errorCode: q.error_code,
    customer: { name: q.customer_name, email: q.customer_email }, hasRaw: Boolean(q.has_raw), revealableFields: REVEALABLE_FIELDS, report
  });
}));

const revealSchema = z.object({ field: z.enum(REVEALABLE_FIELDS), reason: z.string().trim().min(10).max(280) });

adminQueriesRouter.post('/:id/reveal', requirePermission('REVEAL_PII'), asyncRoute(async (req, res) => {
  const parsed = revealSchema.safeParse(req.body);
  if (!parsed.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const row = await pool.query('SELECT r.raw_enc FROM vehicle_queries q JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1', [req.params.id]);
  if (!row.rowCount) throw appError('QUERY_NOT_FOUND', { code: 'QUERY_NOT_FOUND', http: 404, expose: true });
  if (!row.rows[0].raw_enc) throw appError('RAW_NOT_STORED', { code: 'RAW_NOT_STORED', http: 409, expose: true });
  let value: string | null = null;
  try {
    const raw = decryptRaw(String(row.rows[0].raw_enc));
    const ret = extractReturn(raw);
    const found = ret ? Object.entries(ret).find(([k]) => k.toUpperCase() === parsed.data.field)?.[1] : undefined;
    value = found == null || (Array.isArray(found) && !found.length) || found === '' ? null : String(Array.isArray(found) ? found[0] : found);
  } catch {
    throw appError('RAW_DECRYPT_FAILED', { code: 'RAW_DECRYPT_FAILED', http: 500, expose: true });
  }
  // A revelação é registrada ANTES de devolver o dado e nunca guarda o valor revelado.
  await pool.query('INSERT INTO pii_reveals(user_id,query_id,field,reason,ip_hash) VALUES($1,$2,$3,$4,$5)', [req.user!.id, req.params.id, parsed.data.field, parsed.data.reason, hashIp(req.ip ?? '')]);
  await audit(req.user!.id, 'PII_REVEAL', 'VEHICLE_QUERY', String(req.params.id), { field: parsed.data.field, reason: parsed.data.reason, requestId: requestId(req) });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ field: parsed.data.field, value });
}));

adminQueriesRouter.get('/:id/reveals', requirePermission('VIEW_AUDIT'), asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT v.id,v.field,v.reason,v.created_at,u.name,u.email FROM pii_reveals v JOIN users u ON u.id=v.user_id WHERE v.query_id=$1 ORDER BY v.created_at DESC LIMIT 100`, [req.params.id]);
  res.json(r.rows.map((x) => ({ id: x.id, field: x.field, reason: x.reason, createdAt: x.created_at, by: { name: x.name, email: x.email } })));
}));
