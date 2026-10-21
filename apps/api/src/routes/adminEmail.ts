import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { env } from '../config.js';
import { pool } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { applyDeliveryEvent, cancelEmail, resendEmail, verifyEmailWebhookSignature } from '../lib/emailOutbox.js';
import { requirePermission } from '../permissions.js';

/** Fila de e-mails transacionais: consulta, reenvio e cancelamento (nunca expõe corpo, token ou payload). */
export const adminEmailRouter = Router();
adminEmailRouter.use(adminAuth);
const guard = requirePermission('MANAGE_BILLING'); // por rota: um guard no router barraria as demais rotas /admin

const listQuery = z.object({ status: z.enum(['AGENDADO', 'ENVIANDO', 'RETRY', 'ENVIADO', 'ENTREGUE', 'BOUNCED', 'FALHOU', 'CANCELADO']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

adminEmailRouter.get('/email-outbox', guard, asyncRoute(async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const r = await pool.query(
    `SELECT id,template,to_email,subject,status,attempts,max_attempts,next_attempt_at,last_error,related_type,related_id,resend_count,created_at,sent_at,delivered_at
     FROM email_outbox WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2`, [q.data.status ?? null, q.data.limit]);
  const counts = await pool.query('SELECT status,count(*)::int AS n FROM email_outbox GROUP BY status');
  res.json({ items: r.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) });
}));

adminEmailRouter.get('/email-outbox/:id/events', guard, asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const r = await pool.query('SELECT event,detail,created_at FROM email_events WHERE outbox_id=$1 ORDER BY created_at', [id.data]);
  res.json({ events: r.rows });
}));

adminEmailRouter.post('/email-outbox/:id/resend', guard, asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const result = await resendEmail(id.data, req.user!.id);
  if (result === 'NOT_FOUND') throw appError('EMAIL_NOT_FOUND', { code: 'EMAIL_NOT_FOUND', http: 404, expose: true });
  if (result !== 'OK') throw appError(result === 'LIMIT' ? 'EMAIL_RESEND_LIMIT' : 'EMAIL_RESEND_NOT_ALLOWED', { code: result === 'LIMIT' ? 'EMAIL_RESEND_LIMIT' : 'EMAIL_RESEND_NOT_ALLOWED', http: 409, expose: true });
  await audit(req.user!.id, 'RESEND_EMAIL', 'EMAIL_OUTBOX', id.data, { requestId: requestId(req) });
  res.json({ ok: true });
}));

adminEmailRouter.post('/email-outbox/:id/cancel', guard, asyncRoute(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  if (!(await cancelEmail(id.data, req.user!.id))) throw appError('EMAIL_CANCEL_NOT_ALLOWED', { code: 'EMAIL_CANCEL_NOT_ALLOWED', http: 409, expose: true });
  await audit(req.user!.id, 'CANCEL_EMAIL', 'EMAIL_OUTBOX', id.data, { requestId: requestId(req) });
  res.json({ ok: true });
}));

/**
 * Webhook genérico de entrega: corpo JSON {messageId, event: delivered|bounced|complained, reason?}
 * assinado com HMAC-SHA256 (cabeçalho x-signature). Desligado (404) sem EMAIL_WEBHOOK_SECRET.
 * Quando o provedor for escolhido, adapte o formato dele a este contrato.
 */
export const emailWebhookRouter = Router();
const hookBody = z.object({ messageId: z.string().min(3).max(300), event: z.enum(['delivered', 'bounced', 'complained']), reason: z.string().max(300).optional() });

emailWebhookRouter.post('/email', asyncRoute(async (req, res) => {
  if (!env.EMAIL_WEBHOOK_SECRET) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
  const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
  if (!verifyEmailWebhookSignature(raw, req.header('x-signature') ?? undefined)) throw appError('EMAIL_WEBHOOK_UNAUTHORIZED', { code: 'EMAIL_WEBHOOK_UNAUTHORIZED', http: 401, expose: false });
  const body = hookBody.safeParse(req.body);
  if (!body.success) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
  const applied = await applyDeliveryEvent(body.data.messageId, body.data.event, body.data.reason);
  res.json({ ok: true, applied });
}));
