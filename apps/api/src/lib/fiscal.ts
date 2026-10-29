import { env } from '../config.js';
import { pool, tx } from '../db.js';
import { appError, log } from './http.js';
import { enqueueEmail } from './emailOutbox.js';
import { backoffSeconds } from './emailOutbox.js';
import { createSecureLink } from './secureLinks.js';

/**
 * Emissão fiscal por fila. O sistema NÃO fala com nenhuma prefeitura/SEFAZ por conta própria: a emissão automática
 * depende de um adaptador (FiscalProvider) para o provedor que a contabilidade escolher. Hoje existem:
 *  - disabled/manual: sem emissão automática (a nota é emitida fora e registrada no painel, como já era);
 *  - mock: só para desenvolvimento e testes (proibido em produção).
 * A entrega ao cliente (e-mail com link seguro) só acontece com a nota EMITIDA, automática ou registrada à mão.
 */
export interface FiscalEmitInput {
  idempotencyKey: string; kind: 'NFSE' | 'NFE'; amountCents: number; description: string;
  customer: Record<string, unknown>; issuer: Record<string, unknown>;
}
export type FiscalEmitResult =
  | { status: 'ISSUED'; number: string; series?: string | null; verificationCode?: string | null; accessKey?: string | null; pdfUrl?: string | null; xmlUrl?: string | null }
  | { status: 'PENDING'; providerRef: string }
  | { status: 'REJECTED'; reason: string };
export interface FiscalProvider {
  readonly name: string;
  isConfigured(): boolean;
  emit(input: FiscalEmitInput): Promise<FiscalEmitResult>;
  /** Para provedores assíncronos: consulta o andamento de uma emissão aceita (PENDING). */
  poll?(providerRef: string, input: FiscalEmitInput): Promise<FiscalEmitResult>;
}
export class FiscalProviderError extends Error { constructor(message: string, public transient = true) { super(message); } }

let mockCounter = 0;
export const mockFiscalProvider: FiscalProvider = {
  name: 'mock', isConfigured: () => env.NODE_ENV !== 'production',
  async emit(input) { mockCounter += 1; return { status: 'ISSUED', number: `MOCK-${Date.now()}-${mockCounter}`, series: '1', verificationCode: `V${input.idempotencyKey.slice(-6)}` }; }
};

export function configuredFiscalProvider(): FiscalProvider | null {
  return env.FISCAL_PROVIDER === 'mock' ? mockFiscalProvider : null;
}

const err = (code: string, http = 409) => appError(code, { code, http, expose: true });

async function event(jobId: string, name: string, detail: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO fiscal_events(job_id,event,detail) VALUES($1,$2,$3::jsonb)', [jobId, name, JSON.stringify(detail)]);
}

/** Enfileira a emissão de um documento PENDENTE cujo pagamento está confirmado. Idempotente por documento. */
export async function enqueueFiscalEmission(documentId: string, actor: string | null, provider: FiscalProvider | null = configuredFiscalProvider()): Promise<{ id: string; duplicate: boolean }> {
  if (!provider || !provider.isConfigured()) throw err('FISCAL_PROVIDER_NOT_CONFIGURED', 503);
  const d = await pool.query(`SELECT d.id,d.status,d.payment_id,d.installment_id,d.customer_snapshot,
      (SELECT p.status FROM payments p WHERE p.id=d.payment_id) AS payment_status,
      (SELECT i.status FROM charge_installments i WHERE i.id=d.installment_id) AS installment_status
    FROM fiscal_documents d WHERE d.id=$1`, [documentId]);
  if (!d.rowCount) throw err('FISCAL_DOCUMENT_NOT_FOUND', 404);
  const row = d.rows[0];
  if (row.status !== 'PENDING') throw err('FISCAL_DOCUMENT_NOT_PENDING');
  const paid = row.payment_id ? row.payment_status === 'PAID' : row.installment_id ? row.installment_status === 'PAID' : false;
  if (!paid) throw err('FISCAL_PAYMENT_NOT_CONFIRMED');
  const snap = row.customer_snapshot as { document?: string | null; street?: string | null; city?: string | null; state?: string | null; zip?: string | null };
  if (!snap.document || !snap.street || !snap.city || !snap.state || !snap.zip) throw err('FISCAL_CUSTOMER_INCOMPLETE', 422);
  const key = `fiscal-emit:${documentId}`;
  const ins = await pool.query(`INSERT INTO fiscal_jobs(document_id,idempotency_key,provider,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [documentId, key, provider.name, actor]);
  if (ins.rowCount) { await event(ins.rows[0].id, 'ENFILEIRADO'); return { id: ins.rows[0].id, duplicate: false }; }
  const existing = await pool.query('SELECT id FROM fiscal_jobs WHERE idempotency_key=$1', [key]);
  return { id: existing.rows[0].id, duplicate: true };
}

async function buildInput(documentId: string, jobKey: string): Promise<{ input: FiscalEmitInput; status: string; paid: boolean }> {
  const d = await pool.query(`SELECT d.kind,d.status,d.amount_cents,d.description,d.customer_snapshot,
      coalesce((SELECT p.status='PAID' FROM payments p WHERE p.id=d.payment_id),(SELECT i.status='PAID' FROM charge_installments i WHERE i.id=d.installment_id),false) AS paid
    FROM fiscal_documents d WHERE d.id=$1`, [documentId]);
  const s = (await pool.query('SELECT legal_name,cnpj,municipal_registration,service_code,service_description,iss_rate_bps,tax_regime,city_ibge_code,environment FROM fiscal_settings WHERE id=1')).rows[0] ?? {};
  const r = d.rows[0];
  return { status: r.status, paid: Boolean(r.paid), input: { idempotencyKey: jobKey, kind: r.kind, amountCents: Number(r.amount_cents), description: r.description, customer: r.customer_snapshot, issuer: s } };
}

export interface FiscalRunResult { claimed: number; issued: number; pending: number; retried: number; rejected: number; failed: number; cancelled: number }

export async function processFiscalJobs(opts: { provider?: FiscalProvider | null; limit?: number } = {}): Promise<FiscalRunResult> {
  const provider = opts.provider === undefined ? configuredFiscalProvider() : opts.provider;
  const out: FiscalRunResult = { claimed: 0, issued: 0, pending: 0, retried: 0, rejected: 0, failed: 0, cancelled: 0 };
  if (!provider || !provider.isConfigured()) return out;
  await pool.query(`UPDATE fiscal_jobs SET status='RETRY',locked_at=NULL,updated_at=now() WHERE status='ENVIANDO' AND locked_at < now() - interval '10 minutes'`);
  const claimed = await pool.query(
    `UPDATE fiscal_jobs SET status='ENVIANDO',locked_at=now(),attempts=attempts+1,updated_at=now()
     WHERE id IN (SELECT id FROM fiscal_jobs WHERE provider=$2 AND status IN ('PENDENTE','RETRY','AGUARDANDO_PROVEDOR') AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id,document_id,idempotency_key,attempts,max_attempts,provider_ref`, [opts.limit ?? 10, provider.name]);
  for (const job of claimed.rows) {
    out.claimed += 1;
    try {
      const { input, status, paid } = await buildInput(job.document_id, job.idempotency_key);
      if (status !== 'PENDING' || !paid) {
        await pool.query(`UPDATE fiscal_jobs SET status='CANCELADO',locked_at=NULL,last_error=$2,updated_at=now() WHERE id=$1`, [job.id, status !== 'PENDING' ? 'Documento não está mais pendente.' : 'Pagamento deixou de estar confirmado.']);
        await event(job.id, 'CANCELADO', { documentStatus: status, paid }); out.cancelled += 1; continue;
      }
      const result = job.provider_ref && provider.poll ? await provider.poll(job.provider_ref, input) : await provider.emit(input);
      if (result.status === 'ISSUED') {
        await tx(async (client) => {
          const dup = await client.query(`SELECT 1 FROM fiscal_documents WHERE kind=$1 AND number=$2 AND coalesce(series,'')=coalesce($3,'') AND status='ISSUED'`, [input.kind, result.number, result.series ?? '']);
          if (dup.rowCount) throw new FiscalProviderError('FISCAL_NUMBER_IN_USE', false);
          await client.query(`UPDATE fiscal_documents SET status='ISSUED',number=$2,series=$3,access_key=$4,verification_code=$5,pdf_url=$6,xml_url=$7,issued_at=now(),updated_at=now() WHERE id=$1 AND status='PENDING'`,
            [job.document_id, result.number, result.series ?? null, result.accessKey ?? null, result.verificationCode ?? null, result.pdfUrl ?? null, result.xmlUrl ?? null]);
          await client.query(`UPDATE fiscal_jobs SET status='EMITIDO',locked_at=NULL,last_error=NULL,updated_at=now() WHERE id=$1`, [job.id]);
        });
        await event(job.id, 'EMITIDO', { number: result.number });
        out.issued += 1;
        await deliverFiscalDocument(job.document_id, null).catch((e) => log('warn', 'fiscal_delivery_failed', { documentId: job.document_id, reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })); // falha de e-mail não desfaz a nota
      } else if (result.status === 'PENDING') {
        await pool.query(`UPDATE fiscal_jobs SET status='AGUARDANDO_PROVEDOR',locked_at=NULL,provider_ref=$2,next_attempt_at=now() + interval '2 minutes',updated_at=now() WHERE id=$1`, [job.id, result.providerRef]);
        await event(job.id, 'AGUARDANDO_PROVEDOR', {}); out.pending += 1;
      } else {
        await pool.query(`UPDATE fiscal_jobs SET status='REJEITADO',locked_at=NULL,last_error=$2,updated_at=now() WHERE id=$1`, [job.id, result.reason.slice(0, 300)]);
        await event(job.id, 'REJEITADO', { reason: result.reason.slice(0, 300) }); out.rejected += 1;
      }
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const transient = e instanceof FiscalProviderError ? e.transient : true;
      if (!transient || job.attempts >= job.max_attempts) {
        await pool.query(`UPDATE fiscal_jobs SET status='FALHOU',locked_at=NULL,last_error=$2,updated_at=now() WHERE id=$1`, [job.id, message]);
        await event(job.id, 'FALHOU', { attempt: job.attempts, error: message }); out.failed += 1;
      } else {
        await pool.query(`UPDATE fiscal_jobs SET status='RETRY',locked_at=NULL,last_error=$2,next_attempt_at=now() + make_interval(secs => $3::int),updated_at=now() WHERE id=$1`, [job.id, message, backoffSeconds(job.attempts)]);
        await event(job.id, 'RETRY', { attempt: job.attempts, error: message }); out.retried += 1;
      }
    }
  }
  return out;
}

let timer: NodeJS.Timeout | undefined;
export function startFiscalWorker(): void {
  if (timer || !configuredFiscalProvider()) return;
  timer = setInterval(() => { processFiscalJobs().catch((e) => log('warn', 'fiscal_worker_failed', { reason: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })); }, 30_000);
  timer.unref();
}

/** Reabre um job que falhou (não reabre rejeitados: a rejeição pede correção dos dados do documento). */
export async function retryFiscalJob(jobId: string): Promise<boolean> {
  const r = await pool.query(`UPDATE fiscal_jobs SET status='RETRY',attempts=0,next_attempt_at=now(),last_error=NULL,updated_at=now() WHERE id=$1 AND status='FALHOU' RETURNING id`, [jobId]);
  if (r.rowCount) await event(jobId, 'REABERTO');
  return Boolean(r.rowCount);
}

/** Envia ao cliente o e-mail com link seguro do documento. Só para nota EMITIDA, no máximo 3 envios. */
export async function deliverFiscalDocument(documentId: string, actor: string | null): Promise<{ emailId: string }> {
  const d = await pool.query('SELECT status,number,customer_snapshot FROM fiscal_documents WHERE id=$1', [documentId]);
  if (!d.rowCount) throw err('FISCAL_DOCUMENT_NOT_FOUND', 404);
  if (d.rows[0].status !== 'ISSUED') throw err('FISCAL_DOCUMENT_NOT_ISSUED');
  const email = (d.rows[0].customer_snapshot as { email?: string | null; name?: string }).email;
  if (!email) throw err('FISCAL_CUSTOMER_EMAIL_MISSING', 422);
  const sent = await pool.query(`SELECT count(*)::int AS n FROM email_outbox WHERE related_type='FISCAL_DOCUMENT' AND related_id=$1 `, [documentId]);
  const n = Number(sent.rows[0].n);
  if (n >= 3) throw err('FISCAL_DELIVERY_LIMIT');
  const link = await createSecureLink({ purpose: 'FISCAL_DOCUMENT', resourceType: 'fiscal_document', resourceId: documentId, recipientEmail: email, maxUses: 20, createdBy: actor });
  const mail = await enqueueEmail({ idempotencyKey: `fiscal-ready:${documentId}:${n + 1}`, template: 'FISCAL_DOCUMENT_READY', toEmail: email, toName: (d.rows[0].customer_snapshot as { name?: string }).name ?? null,
    data: { name: (d.rows[0].customer_snapshot as { name?: string }).name, documentNumber: d.rows[0].number ?? undefined, linkPath: '/documento-fiscal/{token}', token: link.token, expiresAt: link.expiresAt.toISOString() },
    relatedType: 'FISCAL_DOCUMENT', relatedId: documentId, createdBy: actor });
  return { emailId: mail.id };
}
