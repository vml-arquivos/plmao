import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config.js';
import { pool } from '../db.js';
import { isEmailConfigured, sendMailRaw, type OutgoingMail } from '../email.js';
import { decryptRaw, encryptRaw } from './rawStore.js';
import { log } from './http.js';
import { renderEmail, type EmailTemplateName, type TemplateData } from './emailTemplates.js';

/**
 * Fila de e-mail transacional (outbox): idempotente, com retries exponenciais, trilha de eventos e reenvio controlado.
 * Entrega é "pelo menos uma vez"; o Message-ID é determinístico para o destinatário/servidor reconhecer duplicatas.
 * O token do link seguro fica cifrado no payload só até o envio e é apagado depois.
 */
export type OutboxStatus = 'AGENDADO' | 'ENVIANDO' | 'RETRY' | 'ENVIADO' | 'ENTREGUE' | 'BOUNCED' | 'FALHOU' | 'CANCELADO';
export type Sender = (mail: OutgoingMail) => Promise<{ messageId: string }>;

export interface EnqueueInput {
  idempotencyKey: string; template: EmailTemplateName; toEmail: string; toName?: string | null;
  data: Omit<TemplateData, 'token'> & { token?: string }; relatedType?: string; relatedId?: string; createdBy?: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function enqueueEmail(input: EnqueueInput): Promise<{ id: string; duplicate: boolean }> {
  const to = input.toEmail.trim().toLowerCase();
  if (!EMAIL.test(to) || to.length > 254) throw Object.assign(new Error('EMAIL_RECIPIENT_INVALID'), { code: 'EMAIL_RECIPIENT_INVALID' });
  const { token, ...data } = input.data;
  const rendered = renderEmail(input.template, { ...data, token: token ?? 'x'.repeat(40) });
  const payload = { data, ...(token ? { tokenEnc: encryptRaw(token) } : {}) };
  const r = await pool.query(
    `INSERT INTO email_outbox(idempotency_key,template,to_email,to_name,subject,payload,related_type,related_id,created_by,max_attempts)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [input.idempotencyKey, input.template, to, input.toName ?? null, rendered.subject, JSON.stringify(payload), input.relatedType ?? null, input.relatedId ?? null, input.createdBy ?? null, env.EMAIL_MAX_ATTEMPTS]);
  if (r.rowCount) { await event(r.rows[0].id, 'AGENDADO', {}); return { id: r.rows[0].id as string, duplicate: false }; }
  const existing = await pool.query('SELECT id FROM email_outbox WHERE idempotency_key=$1', [input.idempotencyKey]);
  return { id: existing.rows[0].id as string, duplicate: true };
}

async function event(outboxId: string, name: string, detail: Record<string, unknown>) {
  await pool.query('INSERT INTO email_events(outbox_id,event,detail) VALUES($1,$2,$3::jsonb)', [outboxId, name, JSON.stringify(detail)]);
}

/** Atraso: 30 s, 1 min, 2 min… até 6 h, com variação para não sincronizar tentativas. */
export function backoffSeconds(attempt: number, jitter = Math.random()): number {
  return Math.min(6 * 3600, Math.round(30 * 2 ** Math.min(20, Math.max(0, attempt - 1)) * (0.85 + jitter * 0.3)));
}

const PERMANENT = /(^|\D)(550|551|552|553|554)(\D|$)|invalid (recipient|address)|mailbox unavailable|user unknown|no such user/i;

export interface ProcessResult { claimed: number; sent: number; retried: number; failed: number }

/** Processa até `limit` e-mails vencidos. `sender` é injetável (testes). */
export async function processOutbox(opts: { limit?: number; sender?: Sender } = {}): Promise<ProcessResult> {
  const sender = opts.sender ?? sendMailRaw;
  const result: ProcessResult = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  // recupera envios travados (processo caiu no meio)
  await pool.query(`UPDATE email_outbox SET status='RETRY',locked_at=NULL,updated_at=now() WHERE status='ENVIANDO' AND locked_at < now() - interval '10 minutes'`);
  const claimed = await pool.query(
    `UPDATE email_outbox SET status='ENVIANDO',locked_at=now(),attempts=attempts+1,updated_at=now()
     WHERE id IN (SELECT id FROM email_outbox WHERE status IN ('AGENDADO','RETRY') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id,idempotency_key,template,to_email,to_name,payload,attempts,max_attempts`, [opts.limit ?? 10]);
  for (const row of claimed.rows) {
    result.claimed += 1;
    try {
      const payload = row.payload as { data: Record<string, unknown>; tokenEnc?: string };
      const token = payload.tokenEnc ? String(decryptRaw(payload.tokenEnc)) : undefined;
      const mail = renderEmail(row.template as EmailTemplateName, { ...(payload.data as TemplateData), ...(token ? { token } : {}) });
      const domain = (env.EMAIL_FROM.match(/@([^>\s]+)/)?.[1] ?? 'placanamao.com.br');
      const sent = await sender({ to: row.to_email, ...mail, messageId: `<outbox-${row.id}@${domain}>` });
      await pool.query(`UPDATE email_outbox SET status='ENVIADO',sent_at=now(),locked_at=NULL,last_error=NULL,message_id=$2,payload=payload - 'tokenEnc',updated_at=now() WHERE id=$1`, [row.id, sent.messageId || null]);
      await event(row.id, 'ENVIADO', { attempt: row.attempts });
      result.sent += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      const permanent = PERMANENT.test(message) || message === 'EMAIL_TEMPLATE_LINK_REQUIRED' || message === 'RAW_BLOB_INVALID';
      if (permanent || row.attempts >= row.max_attempts) {
        await pool.query(`UPDATE email_outbox SET status='FALHOU',locked_at=NULL,last_error=$2,payload=payload - 'tokenEnc',updated_at=now() WHERE id=$1`, [row.id, message]);
        await event(row.id, 'FALHOU', { attempt: row.attempts, permanent, error: message });
        result.failed += 1;
      } else {
        await pool.query(`UPDATE email_outbox SET status='RETRY',locked_at=NULL,last_error=$2,next_attempt_at=now() + make_interval(secs => $3::int),updated_at=now() WHERE id=$1`, [row.id, message, backoffSeconds(row.attempts)]);
        await event(row.id, 'RETRY', { attempt: row.attempts, error: message });
        result.retried += 1;
      }
    }
  }
  return result;
}

let timer: NodeJS.Timeout | undefined;
export function startEmailWorker(): void {
  if (timer || !env.EMAIL_OUTBOX_WORKER) return;
  timer = setInterval(() => {
    if (!isEmailConfigured()) return;
    processOutbox().catch((e) => log('error', 'email_worker_failed', { error: e instanceof Error ? e.message : String(e) }));
  }, 15_000);
  timer.unref();
}

/** Reenvio controlado: só para FALHOU/BOUNCED, no máximo 3 vezes, mantendo a mesma linha (sem duplicar a fila). */
export async function resendEmail(id: string, userId: string): Promise<'OK' | 'NOT_FOUND' | 'NOT_ALLOWED' | 'LIMIT'> {
  const r = await pool.query('SELECT status,resend_count,payload FROM email_outbox WHERE id=$1', [id]);
  if (!r.rowCount) return 'NOT_FOUND';
  if (!['FALHOU', 'BOUNCED'].includes(r.rows[0].status)) return 'NOT_ALLOWED';
  if (Number(r.rows[0].resend_count) >= 3) return 'LIMIT';
  // o token foi apagado após a tentativa: modelos com link precisam de um novo link, gerado por quem criou o documento
  const needsLink = !!(r.rows[0].payload as { data?: { linkPath?: string } }).data?.linkPath;
  if (needsLink && !(r.rows[0].payload as { tokenEnc?: string }).tokenEnc) return 'NOT_ALLOWED';
  await pool.query(`UPDATE email_outbox SET status='AGENDADO',attempts=0,next_attempt_at=now(),last_error=NULL,resend_count=resend_count+1,updated_at=now() WHERE id=$1`, [id]);
  await event(id, 'REENVIO_SOLICITADO', { by: userId });
  return 'OK';
}

export async function cancelEmail(id: string, userId: string): Promise<boolean> {
  const r = await pool.query(`UPDATE email_outbox SET status='CANCELADO',payload=payload - 'tokenEnc',updated_at=now() WHERE id=$1 AND status IN ('AGENDADO','RETRY','FALHOU','BOUNCED') RETURNING id`, [id]);
  if (r.rowCount) await event(id, 'CANCELADO', { by: userId });
  return Boolean(r.rowCount);
}

/** Evento de entrega vindo do provedor de e-mail (formato genérico; mapeie o provedor real quando for escolhido). */
export async function applyDeliveryEvent(messageId: string, kind: 'delivered' | 'bounced' | 'complained', reason?: string): Promise<boolean> {
  const status = kind === 'delivered' ? 'ENTREGUE' : 'BOUNCED';
  const r = await pool.query(
    `UPDATE email_outbox SET status=$2,delivered_at=CASE WHEN $2='ENTREGUE' THEN now() ELSE delivered_at END,last_error=CASE WHEN $2='BOUNCED' THEN $3 ELSE last_error END,updated_at=now()
     WHERE message_id=$1 AND status IN ('ENVIADO','ENTREGUE','BOUNCED') RETURNING id`, [messageId, status, (reason ?? kind).slice(0, 300)]);
  if (!r.rowCount) return false;
  await event(r.rows[0].id, kind === 'delivered' ? 'ENTREGUE' : kind === 'bounced' ? 'BOUNCED' : 'RECLAMACAO', { reason: reason ?? null });
  return true;
}

export function verifyEmailWebhookSignature(rawBody: string, signature: string | undefined, secret = env.EMAIL_WEBHOOK_SECRET): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = signature.replace(/^sha256=/, '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
