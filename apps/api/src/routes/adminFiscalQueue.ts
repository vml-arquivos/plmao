import { Router } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { deliverFiscalDocument, enqueueFiscalEmission, retryFiscalJob } from '../lib/fiscal.js';
import { consumeSecureLink } from '../lib/secureLinks.js';
import { requirePermission } from '../permissions.js';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config.js';

export const adminFiscalQueueRouter = Router();
adminFiscalQueueRouter.use(adminAuth);
const guard = requirePermission('MANAGE_FISCAL');
const uuid = z.string().uuid();
const idOf = (v: unknown) => { const p = uuid.safeParse(v); if (!p.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true }); return p.data; };

adminFiscalQueueRouter.get('/fiscal/jobs', guard, asyncRoute(async (_req, res) => {
  const r = await pool.query(`SELECT j.id,j.document_id,j.status,j.provider,j.attempts,j.max_attempts,j.next_attempt_at,j.last_error,j.created_at,d.number,d.amount_cents
    FROM fiscal_jobs j JOIN fiscal_documents d ON d.id=j.document_id ORDER BY j.created_at DESC LIMIT 100`);
  res.json({ items: r.rows });
}));

adminFiscalQueueRouter.post('/fiscal/documents/:id/enqueue', guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  const job = await enqueueFiscalEmission(id, req.user!.id);
  await audit(req.user!.id, 'FISCAL_EMISSION_ENQUEUED', 'FISCAL_DOCUMENT', id, { jobId: job.id, duplicate: job.duplicate, requestId: requestId(req) });
  res.status(job.duplicate ? 200 : 202).json(job);
}));

adminFiscalQueueRouter.post('/fiscal/jobs/:id/retry', guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  if (!(await retryFiscalJob(id))) throw appError('FISCAL_JOB_NOT_RETRYABLE', { code: 'FISCAL_JOB_NOT_RETRYABLE', http: 409, expose: true });
  await audit(req.user!.id, 'FISCAL_JOB_RETRIED', 'FISCAL_JOB', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));

adminFiscalQueueRouter.post('/fiscal/documents/:id/send-email', guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await deliverFiscalDocument(id, req.user!.id);
  await audit(req.user!.id, 'FISCAL_DOCUMENT_EMAILED', 'FISCAL_DOCUMENT', id, { emailId: out.emailId, requestId: requestId(req) });
  res.status(202).json(out);
}));

/** Página pública do documento, por link seguro: sem dados pessoais do cliente. */
export const fiscalPublicRouter = Router();
fiscalPublicRouter.use(rateLimit({ windowMs: 10 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test' }));
fiscalPublicRouter.get('/documents/:token', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const link = await consumeSecureLink(String(req.params.token), ['FISCAL_DOCUMENT']);
  const d = link ? await pool.query(`SELECT kind,number,series,issued_at,amount_cents,description,verification_code,pdf_url,xml_url FROM fiscal_documents WHERE id=$1 AND status='ISSUED'`, [link.resource_id]) : null;
  if (!d?.rowCount) { res.status(404).json({ error: 'LINK_INVALID', message: 'Link inválido ou expirado.' }); return; }
  const r = d.rows[0]; const https = (u: unknown) => (typeof u === 'string' && u.startsWith('https://') ? u : null);
  res.json({ kind: r.kind, number: r.number, series: r.series, issuedAt: r.issued_at, amountCents: Number(r.amount_cents), description: r.description, verificationCode: r.verification_code, pdfUrl: https(r.pdf_url), xmlUrl: https(r.xml_url) });
}));
