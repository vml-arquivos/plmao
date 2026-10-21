import express, { Router } from 'express';
import { z } from 'zod';
import { adminAuth, auth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import * as S from '../lib/supportChat.js';
import { requirePermission } from '../permissions.js';

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
supportAdminRouter.get('/support/team', guard, asyncRoute(async (_req, res) => {
  const { pool } = await import('../db.js');
  const r = await pool.query(`SELECT id,name,role FROM users WHERE active=true AND deleted_at IS NULL AND role IN ('OPERADOR','SUPORTE','ADMIN','SUPER_ADMIN') ORDER BY name`);
  res.json({ items: r.rows });
}));
