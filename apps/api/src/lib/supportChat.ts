import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, tx } from '../db.js';
import { appError } from './http.js';
import { enqueueEmail } from './emailOutbox.js';
import { botReply, redactSensitive } from './supportBot.js';
import { hasPermission } from '../permissions.js';
import { publicAppUrl } from '../config.js';

const err = (code: string, http = 409) => appError(code, { code, http, expose: true });
export const CATEGORIES = ['DUVIDA', 'PAGAMENTO', 'CONSULTA', 'CONTA', 'LGPD', 'OUTRO'] as const;
export const PRIORITIES = ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'] as const;
export const STAFF_STATUSES = ['EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE', 'RESOLVIDA', 'ENCERRADA'] as const;
type Db = Pick<PoolClient, 'query'>;

async function logEvent(db: Db, conversationId: string, event: string, actor: string | null, detail: Record<string, unknown> = {}) {
  await db.query('INSERT INTO support_events(conversation_id,event,actor_user_id,detail) VALUES($1,$2,$3,$4::jsonb)', [conversationId, event, actor, JSON.stringify(detail)]);
}
async function addMessage(db: Db, conversationId: string, sender: 'CLIENTE' | 'ATENDENTE' | 'BOT' | 'SISTEMA', userId: string | null, body: string, internal = false): Promise<string> {
  const r = await db.query('INSERT INTO support_messages(conversation_id,sender_type,sender_user_id,body,internal) VALUES($1,$2,$3,$4,$5) RETURNING id', [conversationId, sender, userId, body, internal]);
  if (!internal) await db.query('UPDATE support_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1', [conversationId]);
  return r.rows[0].id;
}

// ---------------------------------------------------------------- notificações (sem conteúdo da conversa)

async function supportInbox(): Promise<string | null> {
  const r = await pool.query(`SELECT value FROM platform_settings WHERE key='safe_business'`);
  const e = (r.rows[0]?.value as { supportEmail?: unknown } | undefined)?.supportEmail;
  return typeof e === 'string' && e ? e : null;
}
const bucket = (minutes: number) => Math.floor(Date.now() / (minutes * 60_000));

async function notifyStaff(conversationId: string, priority: string) {
  try {
    const to = await supportInbox(); if (!to) return;
    await enqueueEmail({ idempotencyKey: `support-staff:${conversationId}:${bucket(10)}`, template: 'GENERIC_NOTICE', toEmail: to,
      data: { documentTitle: 'Chat de suporte', message: `Há uma conversa aguardando atendimento (prioridade ${priority.toLowerCase()}). Abra o painel, em Suporte, para responder.` }, relatedType: 'SUPPORT_CONVERSATION', relatedId: conversationId });
  } catch { /* notificação nunca derruba o chat */ }
}
async function notifyClient(conversationId: string, email: string, name: string) {
  try {
    await enqueueEmail({ idempotencyKey: `support-client:${conversationId}:${bucket(15)}`, template: 'GENERIC_NOTICE', toEmail: email, toName: name,
      data: { name, documentTitle: 'Nova resposta do suporte', message: `Você tem uma nova resposta na sua conversa de suporte. Entre na sua conta para ler: ${publicAppUrl()}/app/suporte` }, relatedType: 'SUPPORT_CONVERSATION', relatedId: conversationId });
  } catch { /* idem */ }
}

// ---------------------------------------------------------------- cliente

export interface NewConversation { subject: string; category: (typeof CATEGORIES)[number]; message: string; related?: { type: 'QUERY' | 'ORDER' | 'PAYMENT'; id: string } }

/** O vínculo com consulta/pedido/pagamento só vale se o item for da própria conta. */
async function assertOwnRelated(db: Db, userId: string, rel: NonNullable<NewConversation['related']>) {
  const table = rel.type === 'QUERY' ? 'vehicle_queries' : rel.type === 'ORDER' ? 'payment_orders' : 'payments';
  const r = await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND user_id=$2`, [rel.id, userId]);
  if (!r.rowCount) throw err('SUPPORT_RELATED_NOT_FOUND', 404);
}

async function assertNotFlooding(userId: string) {
  const r = await pool.query(`SELECT count(*)::int AS n FROM support_messages m JOIN support_conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND m.sender_type='CLIENTE' AND m.created_at > now() - interval '1 minute'`, [userId]);
  if (r.rows[0].n >= 20) throw err('SUPPORT_RATE_LIMITED', 429);
}

async function runBot(conversationId: string, text: string, first: boolean, userId: string) {
  const reply = await botReply(text, { first });
  await tx(async (c) => {
    await addMessage(c, conversationId, 'BOT', null, reply.text);
    if (reply.escalate) {
      await c.query(`UPDATE support_conversations SET handler='HUMAN',status='AGUARDANDO_ATENDENTE',priority=$2,updated_at=now() WHERE id=$1 AND status IN ('ABERTA','AGUARDANDO_ATENDENTE')`, [conversationId, reply.priority ?? 'ALTA']);
      await logEvent(c, conversationId, 'ENCAMINHADA_AUTOMATICAMENTE', null, { reason: reply.kind });
    }
    await logEvent(c, conversationId, 'BOT_RESPONDEU', null, { kind: reply.kind, faqId: reply.faqId ?? null });
  });
  if (reply.escalate) await notifyStaff(conversationId, reply.priority ?? 'ALTA');
  void userId;
}

export async function createConversation(userId: string, input: NewConversation): Promise<{ id: string }> {
  await assertNotFlooding(userId);
  const msg = redactSensitive(input.message);
  const id = await tx(async (c) => {
    if (input.related) await assertOwnRelated(c, userId, input.related);
    const open = await c.query(`SELECT count(*)::int AS n FROM support_conversations WHERE user_id=$1 AND status NOT IN ('RESOLVIDA','ENCERRADA')`, [userId]);
    if (open.rows[0].n >= 5) throw err('SUPPORT_TOO_MANY_OPEN', 429);
    const r = await c.query(`INSERT INTO support_conversations(user_id,subject,category,related_type,related_id,priority,client_read_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id`,
      [userId, input.subject, input.category, input.related?.type ?? null, input.related?.id ?? null, input.category === 'LGPD' ? 'ALTA' : 'NORMAL']);
    await addMessage(c, r.rows[0].id, 'CLIENTE', userId, msg.text);
    if (msg.redacted) await addMessage(c, r.rows[0].id, 'SISTEMA', null, 'Um número que parecia de cartão foi ocultado. Nunca envie dados de cartão ou senhas.');
    await logEvent(c, r.rows[0].id, 'CRIADA', userId, { category: input.category, related: input.related?.type ?? null });
    return r.rows[0].id as string;
  });
  await runBot(id, msg.text, true, userId);
  return { id };
}

async function ownConversation(db: Db, userId: string, id: string, lock = false) {
  const r = await db.query(`SELECT * FROM support_conversations WHERE id=$1 AND user_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, userId]);
  if (!r.rowCount) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
  return r.rows[0] as Record<string, any>;
}

export async function clientSend(userId: string, id: string, body: string): Promise<void> {
  await assertNotFlooding(userId);
  const msg = redactSensitive(body);
  const state = await tx(async (c) => {
    const conv = await ownConversation(c, userId, id, true);
    if (conv.status === 'ENCERRADA') throw err('SUPPORT_CONVERSATION_CLOSED');
    await addMessage(c, id, 'CLIENTE', userId, msg.text);
    if (msg.redacted) await addMessage(c, id, 'SISTEMA', null, 'Um número que parecia de cartão foi ocultado. Nunca envie dados de cartão ou senhas.');
    let next = conv.status as string;
    if (conv.handler === 'HUMAN') next = conv.assigned_to && conv.status === 'AGUARDANDO_CLIENTE' ? 'EM_ATENDIMENTO' : conv.status === 'EM_ATENDIMENTO' ? 'EM_ATENDIMENTO' : 'AGUARDANDO_ATENDENTE';
    else if (conv.status === 'RESOLVIDA') next = 'ABERTA';
    await c.query(`UPDATE support_conversations SET status=$2,resolved_at=NULL,client_read_at=now(),updated_at=now() WHERE id=$1`, [id, next]);
    if (conv.status === 'RESOLVIDA') await logEvent(c, id, 'REABERTA_PELO_CLIENTE', userId);
    return { handler: conv.handler as string, priority: conv.priority as string };
  });
  if (state.handler === 'BOT') await runBot(id, msg.text, false, userId); else await notifyStaff(id, state.priority);
}

export async function requestHuman(userId: string, id: string): Promise<void> {
  const priority = await tx(async (c) => {
    const conv = await ownConversation(c, userId, id, true);
    if (conv.status === 'ENCERRADA') throw err('SUPPORT_CONVERSATION_CLOSED');
    if (conv.handler === 'HUMAN') return conv.priority as string;
    await c.query(`UPDATE support_conversations SET handler='HUMAN',status='AGUARDANDO_ATENDENTE',resolved_at=NULL,updated_at=now() WHERE id=$1`, [id]);
    await addMessage(c, id, 'SISTEMA', null, 'Conversa encaminhada para a equipe. Você receberá a resposta aqui.');
    await logEvent(c, id, 'PEDIU_ATENDENTE', userId);
    return conv.priority as string;
  });
  await notifyStaff(id, priority);
}

export async function clientResolve(userId: string, id: string): Promise<void> {
  await tx(async (c) => {
    const conv = await ownConversation(c, userId, id, true);
    if (['RESOLVIDA', 'ENCERRADA'].includes(conv.status)) throw err('SUPPORT_CONVERSATION_CLOSED');
    await c.query(`UPDATE support_conversations SET status='RESOLVIDA',resolved_at=now(),updated_at=now() WHERE id=$1`, [id]);
    await addMessage(c, id, 'SISTEMA', null, 'Conversa marcada como resolvida. Se precisar, é só escrever de novo.');
    await logEvent(c, id, 'RESOLVIDA_PELO_CLIENTE', userId);
  });
}

export async function clientList(userId: string) {
  const r = await pool.query(`SELECT id,subject,category,status,handler,last_message_at,(client_read_at IS NULL OR last_message_at > client_read_at) AS unread FROM support_conversations WHERE user_id=$1 ORDER BY last_message_at DESC LIMIT 50`, [userId]);
  return r.rows;
}

export async function clientDetail(userId: string, id: string) {
  const conv = await ownConversation(pool, userId, id);
  await pool.query('UPDATE support_conversations SET client_read_at=now() WHERE id=$1', [id]);
  const [msgs, atts] = await Promise.all([
    pool.query(`SELECT id,sender_type,body,created_at FROM support_messages WHERE conversation_id=$1 AND internal=false ORDER BY created_at, id`, [id]),
    pool.query(`SELECT id,message_id,file_name,mime,size_bytes FROM support_attachments a WHERE conversation_id=$1 AND (message_id IS NULL OR EXISTS (SELECT 1 FROM support_messages m WHERE m.id=a.message_id AND m.internal=false))`, [id])
  ]);
  return { id: conv.id, subject: conv.subject, category: conv.category, status: conv.status, handler: conv.handler, relatedType: conv.related_type, relatedId: conv.related_id, createdAt: conv.created_at, messages: msgs.rows, attachments: atts.rows };
}

// ---------------------------------------------------------------- anexos

const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' }
];
export const sniffMime = (b: Buffer) => MAGIC.find((m) => m.test(b))?.mime ?? null;
export const safeFileName = (n: string) => (n.replace(/[\\/]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '').trim().slice(-100) || 'arquivo');

export async function addAttachment(opts: { conversationId: string; userId: string; staff: boolean; fileName: string; declaredMime: string; data: Buffer }): Promise<{ id: string }> {
  if (opts.data.length < 1 || opts.data.length > 2 * 1024 * 1024) throw err('SUPPORT_ATTACHMENT_SIZE', 413);
  const real = sniffMime(opts.data);
  if (!real || real !== opts.declaredMime) throw err('SUPPORT_ATTACHMENT_TYPE', 415);
  return tx(async (c) => {
    const conv = opts.staff ? (await c.query('SELECT * FROM support_conversations WHERE id=$1 FOR UPDATE', [opts.conversationId])).rows[0] : await ownConversation(c, opts.userId, opts.conversationId, true);
    if (!conv) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
    if (conv.status === 'ENCERRADA') throw err('SUPPORT_CONVERSATION_CLOSED');
    const n = await c.query('SELECT count(*)::int AS n FROM support_attachments WHERE conversation_id=$1', [opts.conversationId]);
    if (n.rows[0].n >= 10) throw err('SUPPORT_ATTACHMENT_LIMIT', 429);
    const name = safeFileName(opts.fileName);
    const mid = await addMessage(c, opts.conversationId, opts.staff ? 'ATENDENTE' : 'CLIENTE', opts.userId, `Anexo enviado: ${name}`);
    const a = await c.query(`INSERT INTO support_attachments(conversation_id,message_id,uploaded_by,file_name,mime,size_bytes,sha256,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [opts.conversationId, mid, opts.userId, name, real, opts.data.length, createHash('sha256').update(opts.data).digest('hex'), opts.data]);
    await logEvent(c, opts.conversationId, 'ANEXO_ENVIADO', opts.userId, { attachmentId: a.rows[0].id, mime: real, size: opts.data.length });
    if (!opts.staff) await c.query(`UPDATE support_conversations SET status=CASE WHEN handler='HUMAN' AND status IN ('AGUARDANDO_CLIENTE','RESOLVIDA','ABERTA') THEN 'AGUARDANDO_ATENDENTE' ELSE status END,updated_at=now() WHERE id=$1`, [opts.conversationId]);
    return { id: a.rows[0].id as string };
  });
}

export async function getAttachment(id: string, who: { userId: string; staff: boolean }) {
  const r = await pool.query(`SELECT a.file_name,a.mime,a.data,c.user_id,m.internal FROM support_attachments a JOIN support_conversations c ON c.id=a.conversation_id LEFT JOIN support_messages m ON m.id=a.message_id WHERE a.id=$1`, [id]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  if (!who.staff && (row.user_id !== who.userId || row.internal)) return null; // isolamento: outro cliente recebe 404, igual a inexistente
  return { fileName: row.file_name as string, mime: row.mime as string, data: row.data as Buffer };
}

// ---------------------------------------------------------------- atendimento (equipe)

export async function staffList(q: { status?: string; assigned?: 'me' | 'unassigned'; priority?: string; userId: string }) {
  const r = await pool.query(`SELECT c.id,c.subject,c.category,c.status,c.priority,c.handler,c.assigned_to,au.name AS assigned_name,c.last_message_at,c.related_type,u.name AS client_name,
      (c.staff_read_at IS NULL OR c.last_message_at > c.staff_read_at) AS unread
    FROM support_conversations c JOIN users u ON u.id=c.user_id LEFT JOIN users au ON au.id=c.assigned_to
    WHERE ($1::text IS NULL OR c.status=$1) AND ($2::text IS NULL OR c.priority=$2)
      AND ($3::text IS NULL OR ($3='me' AND c.assigned_to=$4) OR ($3='unassigned' AND c.assigned_to IS NULL))
    ORDER BY CASE c.priority WHEN 'URGENTE' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, c.last_message_at DESC LIMIT 100`,
  [q.status ?? null, q.priority ?? null, q.assigned ?? null, q.userId]);
  return r.rows;
}

export async function staffDetail(id: string, staffId: string) {
  const c = await pool.query(`SELECT c.*,u.name AS client_name,u.email AS client_email,au.name AS assigned_name FROM support_conversations c JOIN users u ON u.id=c.user_id LEFT JOIN users au ON au.id=c.assigned_to WHERE c.id=$1`, [id]);
  if (!c.rowCount) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
  await pool.query('UPDATE support_conversations SET staff_read_at=now() WHERE id=$1', [id]);
  const [msgs, atts, events] = await Promise.all([
    pool.query(`SELECT m.id,m.sender_type,m.body,m.internal,m.created_at,u.name AS sender_name FROM support_messages m LEFT JOIN users u ON u.id=m.sender_user_id AND m.sender_type='ATENDENTE' WHERE m.conversation_id=$1 ORDER BY m.created_at,m.id`, [id]),
    pool.query(`SELECT id,message_id,file_name,mime,size_bytes FROM support_attachments WHERE conversation_id=$1`, [id]),
    pool.query(`SELECT event,actor_user_id,detail,created_at FROM support_events WHERE conversation_id=$1 ORDER BY id`, [id])
  ]);
  await pool.query(`INSERT INTO support_events(conversation_id,event,actor_user_id) VALUES($1,'LIDA_PELA_EQUIPE',$2)`, [id, staffId]);
  const r = c.rows[0];
  return { id: r.id, subject: r.subject, category: r.category, status: r.status, priority: r.priority, handler: r.handler, assignedTo: r.assigned_to, assignedName: r.assigned_name, relatedType: r.related_type, relatedId: r.related_id,
    client: { name: r.client_name, email: r.client_email }, createdAt: r.created_at, messages: msgs.rows, attachments: atts.rows, events: events.rows };
}

export async function staffReply(id: string, staff: { id: string }, body: string, internal: boolean): Promise<void> {
  const notify = await tx(async (c) => {
    const conv = (await c.query('SELECT c.*,u.email,u.name FROM support_conversations c JOIN users u ON u.id=c.user_id WHERE c.id=$1 FOR UPDATE OF c', [id])).rows[0];
    if (!conv) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
    if (conv.status === 'ENCERRADA' && !internal) throw err('SUPPORT_CONVERSATION_CLOSED');
    await addMessage(c, id, 'ATENDENTE', staff.id, body, internal);
    if (internal) { await logEvent(c, id, 'NOTA_INTERNA', staff.id); return null; }
    await c.query(`UPDATE support_conversations SET handler='HUMAN',status='AGUARDANDO_CLIENTE',assigned_to=COALESCE(assigned_to,$2),resolved_at=NULL,updated_at=now() WHERE id=$1`, [id, staff.id]);
    await logEvent(c, id, 'RESPOSTA_DA_EQUIPE', staff.id);
    return { email: conv.email as string, name: conv.name as string };
  });
  if (notify) await notifyClient(id, notify.email, notify.name);
}

export async function staffAssign(id: string, actor: string, assigneeId: string | null, note?: string): Promise<void> {
  await tx(async (c) => {
    const conv = (await c.query('SELECT assigned_to FROM support_conversations WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!conv) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
    if (assigneeId) {
      const u = await c.query(`SELECT role FROM users WHERE id=$1 AND active=true AND deleted_at IS NULL`, [assigneeId]);
      if (!u.rowCount || !hasPermission(u.rows[0].role, 'MANAGE_SUPPORT')) throw err('SUPPORT_ASSIGNEE_INVALID', 422);
    }
    await c.query(`UPDATE support_conversations SET assigned_to=$2,handler='HUMAN',status=CASE WHEN status IN ('ABERTA','AGUARDANDO_ATENDENTE') AND $2::uuid IS NOT NULL THEN 'EM_ATENDIMENTO' ELSE status END,updated_at=now() WHERE id=$1`, [id, assigneeId]);
    await logEvent(c, id, conv.assigned_to && assigneeId && conv.assigned_to !== assigneeId ? 'TRANSFERIDA' : assigneeId ? 'ATRIBUIDA' : 'ATRIBUICAO_REMOVIDA', actor, { from: conv.assigned_to, to: assigneeId });
    if (note) await addMessage(c, id, 'ATENDENTE', actor, `Nota de transferência: ${note}`, true);
  });
}

export async function staffSetStatus(id: string, actor: string, status: (typeof STAFF_STATUSES)[number]): Promise<void> {
  await tx(async (c) => {
    const r = await c.query(`UPDATE support_conversations SET status=$2,resolved_at=CASE WHEN $2 IN ('RESOLVIDA','ENCERRADA') THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND status<>'ENCERRADA' RETURNING id`, [id, status]);
    if (!r.rowCount) { const ex = await c.query('SELECT 1 FROM support_conversations WHERE id=$1', [id]); throw err(ex.rowCount ? 'SUPPORT_CONVERSATION_CLOSED' : 'SUPPORT_CONVERSATION_NOT_FOUND', ex.rowCount ? 409 : 404); }
    await logEvent(c, id, 'STATUS_ALTERADO', actor, { status });
  });
}

export async function staffSetPriority(id: string, actor: string, priority: (typeof PRIORITIES)[number]): Promise<void> {
  await tx(async (c) => {
    const r = await c.query('UPDATE support_conversations SET priority=$2,updated_at=now() WHERE id=$1 RETURNING id', [id, priority]);
    if (!r.rowCount) throw err('SUPPORT_CONVERSATION_NOT_FOUND', 404);
    await logEvent(c, id, 'PRIORIDADE_ALTERADA', actor, { priority });
  });
}
