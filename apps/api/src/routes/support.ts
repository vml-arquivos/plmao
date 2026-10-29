import express, { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { adminAuth, auth, optionalAuth } from '../auth.js';
import { env } from '../config.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import * as S from '../lib/supportChat.js';
import * as X from '../lib/supportExtras.js';
import { assistantName, assistantReply } from '../lib/supportAssistant.js';
import { requirePermission, rolesBelow } from '../permissions.js';

const bad = () => appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
const uuid = z.string().uuid();
const idOf = (v: unknown) => { const p = uuid.safeParse(v); if (!p.success) throw appError('SUPPORT_CONVERSATION_NOT_FOUND', { code: 'SUPPORT_CONVERSATION_NOT_FOUND', http: 404, expose: true }); return p.data; };
const text = (max: number) => z.string().trim().min(1).max(max);
const rawUpload = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], limit: '2mb' });

function sendFile(res: import('express').Response, f: { fileName: string; mime: string; data: Buffer }) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(f.data);
}

// ------------------------------------------------------------- público (visitantes e erros do navegador)

const limiter = (limit: number, windowMs = 5 * 60_000) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, skip: () => env.NODE_ENV === 'test', message: { error: 'TOO_MANY_ATTEMPTS', message: 'Muitas mensagens. Aguarde um pouco.' } });
export const supportPublicRouter = Router();
supportPublicRouter.get('/assistant/info', (_req, res) => { res.setHeader('Cache-Control', 'public, max-age=300'); res.json({ name: assistantName() }); });
/** Visitante sem conta: só regras, catálogo e perguntas frequentes (sem IA e sem gravar nada). */
supportPublicRouter.post('/assistant', limiter(30), optionalAuth, asyncRoute(async (req, res) => {
  const b = z.object({ message: text(600), route: z.string().max(200).optional() }).strict().safeParse(req.body); if (!b.success) throw bad();
  const r = await assistantReply(b.data.message, { userId: null, first: false, route: b.data.route });
  const contact = env.SUPPORT_EMAIL ? ` ou escreva para ${env.SUPPORT_EMAIL}` : '';
  const handoff = r.escalate || r.kind === 'PROBLEM';
  res.json({ name: assistantName(), kind: r.kind, text: r.escalate ? `Esse assunto precisa de uma pessoa da equipe. Entre na sua conta e abra o chat de novo${contact}, que atendemos você.` : r.text, suggestions: r.suggestions ?? [], needsLogin: handoff });
}));
supportPublicRouter.post('/client-error', limiter(20, 10 * 60_000), optionalAuth, asyncRoute(async (req, res) => {
  const b = z.object({ message: z.string().trim().min(1).max(600), stack: z.string().max(2000).optional(), route: z.string().max(300).default('/'), kind: z.enum(['error', 'promise', 'boundary']).default('error') }).strict().safeParse(req.body); if (!b.success) throw bad();
  await X.recordClientError({ ...b.data, userId: req.user?.id ?? null });
  res.status(204).end();
}));

// ------------------------------------------------------------- cliente (sempre limitado à própria conta)

export const supportClientRouter = Router();
supportClientRouter.use(auth);

supportClientRouter.get('/conversations', asyncRoute(async (req, res) => { res.json({ items: await S.clientList(req.user!.id) }); }));

const newBody = z.object({
  subject: text(120), category: z.enum(S.CATEGORIES), message: text(4000),
  related: z.object({ type: z.enum(['QUERY', 'ORDER', 'PAYMENT']), id: uuid }).strict().optional()
}).strict();
supportClientRouter.post('/conversations', asyncRoute(async (req, res) => {
  const b = newBody.safeParse(req.body); if (!b.success) throw bad();
  const out = await S.createConversation(req.user!.id, b.data);
  res.status(201).json(await S.clientDetail(req.user!.id, out.id));
}));

supportClientRouter.get('/conversations/:id', asyncRoute(async (req, res) => { res.json(await S.clientDetail(req.user!.id, idOf(req.params.id))); }));

supportClientRouter.post('/conversations/:id/messages', asyncRoute(async (req, res) => {
  const b = z.object({ body: text(4000) }).strict().safeParse(req.body); if (!b.success) throw bad();
  await S.clientSend(req.user!.id, idOf(req.params.id), b.data.body);
  res.status(201).json(await S.clientDetail(req.user!.id, idOf(req.params.id)));
}));

supportClientRouter.post('/conversations/:id/human', asyncRoute(async (req, res) => { await S.requestHuman(req.user!.id, idOf(req.params.id)); res.json(await S.clientDetail(req.user!.id, idOf(req.params.id))); }));
supportClientRouter.post('/conversations/:id/resolve', asyncRoute(async (req, res) => { await S.clientResolve(req.user!.id, idOf(req.params.id)); res.json({ ok: true }); }));

supportClientRouter.post('/conversations/:id/attachments', rawUpload, asyncRoute(async (req, res) => {
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || !data.length) throw appError('SUPPORT_ATTACHMENT_TYPE', { code: 'SUPPORT_ATTACHMENT_TYPE', http: 415, expose: true });
  const out = await S.addAttachment({ conversationId: idOf(req.params.id), userId: req.user!.id, staff: false, fileName: String(req.query.name ?? 'arquivo'), declaredMime: String(req.headers['content-type'] ?? '').split(';')[0]!, data });
  res.status(201).json(out);
}));
supportClientRouter.get('/attachments/:id', asyncRoute(async (req, res) => {
  const f = await S.getAttachment(idOf(req.params.id), { userId: req.user!.id, staff: false });
  if (!f) throw appError('SUPPORT_ATTACHMENT_NOT_FOUND', { code: 'SUPPORT_ATTACHMENT_NOT_FOUND', http: 404, expose: true });
  sendFile(res, f);
}));

// ------------------------------------------------------------- equipe

export const supportAdminRouter = Router();
supportAdminRouter.use(adminAuth);
const guard = requirePermission('MANAGE_SUPPORT');

supportAdminRouter.get('/support/conversations', guard, asyncRoute(async (req, res) => {
  const q = z.object({ status: z.string().max(30).optional(), priority: z.enum(S.PRIORITIES).optional(), assigned: z.enum(['me', 'unassigned']).optional() }).safeParse(req.query); if (!q.success) throw bad();
  res.json({ items: await S.staffList({ ...q.data, userId: req.user!.id }) });
}));
supportAdminRouter.get('/support/conversations/:id', guard, asyncRoute(async (req, res) => { res.json(await S.staffDetail(idOf(req.params.id), req.user!.id)); }));

supportAdminRouter.post('/support/conversations/:id/messages', guard, asyncRoute(async (req, res) => {
  const b = z.object({ body: text(4000), internal: z.boolean().default(false) }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id);
  await S.staffReply(id, { id: req.user!.id }, b.data.body, b.data.internal);
  await audit(req.user!.id, b.data.internal ? 'SUPPORT_INTERNAL_NOTE' : 'SUPPORT_REPLY', 'SUPPORT_CONVERSATION', id, { requestId: requestId(req) });
  res.status(201).json({ ok: true });
}));
supportAdminRouter.post('/support/conversations/:id/assign', guard, asyncRoute(async (req, res) => {
  const b = z.object({ userId: uuid.nullable(), note: text(300).optional() }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id);
  await S.staffAssign(id, req.user!.id, b.data.userId, b.data.note);
  await audit(req.user!.id, 'SUPPORT_ASSIGNED', 'SUPPORT_CONVERSATION', id, { to: b.data.userId, requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.post('/support/conversations/:id/status', guard, asyncRoute(async (req, res) => {
  const b = z.object({ status: z.enum(S.STAFF_STATUSES) }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id);
  await S.staffSetStatus(id, req.user!.id, b.data.status);
  await audit(req.user!.id, 'SUPPORT_STATUS_CHANGED', 'SUPPORT_CONVERSATION', id, { status: b.data.status, requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.post('/support/conversations/:id/priority', guard, asyncRoute(async (req, res) => {
  const b = z.object({ priority: z.enum(S.PRIORITIES) }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id);
  await S.staffSetPriority(id, req.user!.id, b.data.priority);
  await audit(req.user!.id, 'SUPPORT_PRIORITY_CHANGED', 'SUPPORT_CONVERSATION', id, { priority: b.data.priority, requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.post('/support/conversations/:id/attachments', guard, rawUpload, asyncRoute(async (req, res) => {
  const data = req.body as Buffer;
  if (!Buffer.isBuffer(data) || !data.length) throw appError('SUPPORT_ATTACHMENT_TYPE', { code: 'SUPPORT_ATTACHMENT_TYPE', http: 415, expose: true });
  res.status(201).json(await S.addAttachment({ conversationId: idOf(req.params.id), userId: req.user!.id, staff: true, fileName: String(req.query.name ?? 'arquivo'), declaredMime: String(req.headers['content-type'] ?? '').split(';')[0]!, data }));
}));
supportAdminRouter.get('/support/attachments/:id', guard, asyncRoute(async (req, res) => {
  const f = await S.getAttachment(idOf(req.params.id), { userId: req.user!.id, staff: true });
  if (!f) throw appError('SUPPORT_ATTACHMENT_NOT_FOUND', { code: 'SUPPORT_ATTACHMENT_NOT_FOUND', http: 404, expose: true });
  await audit(req.user!.id, 'SUPPORT_ATTACHMENT_DOWNLOADED', 'SUPPORT_ATTACHMENT', idOf(req.params.id), { requestId: requestId(req) });
  sendFile(res, f);
}));
supportAdminRouter.get('/support/stats', guard, asyncRoute(async (_req, res) => { res.json(await X.supportStats()); }));
supportAdminRouter.get('/support/canned', guard, asyncRoute(async (_req, res) => { res.json({ items: await X.cannedList(false) }); }));
const cannedBody = z.object({ title: text(80), body: text(1500), category: z.enum(X.CANNED_CATEGORIES) }).strict();
supportAdminRouter.post('/support/canned', guard, asyncRoute(async (req, res) => {
  const b = cannedBody.safeParse(req.body); if (!b.success) throw bad();
  const id = await X.cannedCreate(req.user!.id, b.data);
  await audit(req.user!.id, 'SUPPORT_CANNED_CREATED', 'SUPPORT_CANNED', id, { requestId: requestId(req) });
  res.status(201).json({ id });
}));
supportAdminRouter.patch('/support/canned/:id', guard, asyncRoute(async (req, res) => {
  const b = cannedBody.partial().extend({ active: z.boolean().optional() }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id); await X.cannedUpdate(id, b.data);
  await audit(req.user!.id, 'SUPPORT_CANNED_UPDATED', 'SUPPORT_CANNED', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.delete('/support/canned/:id', guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id); await X.cannedDelete(id);
  await audit(req.user!.id, 'SUPPORT_CANNED_DELETED', 'SUPPORT_CANNED', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.post('/support/canned/:id/use', guard, asyncRoute(async (req, res) => { await X.cannedUsed(idOf(req.params.id)); res.json({ ok: true }); }));
supportAdminRouter.get('/support/problems', guard, asyncRoute(async (req, res) => {
  const q = z.object({ status: z.enum(X.PROBLEM_STATUSES).optional() }).safeParse(req.query); if (!q.success) throw bad();
  res.json({ items: await X.problemList(q.data.status) });
}));
supportAdminRouter.patch('/support/problems/:id', guard, asyncRoute(async (req, res) => {
  const b = z.object({ status: z.enum(X.PROBLEM_STATUSES).optional(), note: z.string().trim().max(500).optional(), severity: z.enum(['BAIXA', 'MEDIA', 'ALTA']).optional() }).strict().safeParse(req.body); if (!b.success) throw bad();
  const id = idOf(req.params.id); await X.problemUpdate(id, b.data);
  await audit(req.user!.id, 'SUPPORT_PROBLEM_UPDATED', 'SUPPORT_PROBLEM', id, { status: b.data.status ?? null, requestId: requestId(req) });
  res.json({ ok: true });
}));
supportAdminRouter.get('/support/team', guard, asyncRoute(async (req, res) => {
  const { pool } = await import('../db.js');
  // Quem atende vê a si mesmo e quem está abaixo; níveis acima não aparecem.
  const r = await pool.query(`SELECT id,name,role FROM users WHERE active=true AND deleted_at IS NULL AND role IN ('OPERADOR','SUPORTE','ADMIN','SUPER_ADMIN') AND (role = ANY($1::text[]) OR id=$2) ORDER BY name`, [rolesBelow(req.user!.role), req.user!.id]);
  res.json({ items: r.rows });
}));
