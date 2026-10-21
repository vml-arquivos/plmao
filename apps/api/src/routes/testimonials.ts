import { Router } from 'express';
import { z } from 'zod';
import { adminAuth, auth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import * as T from '../lib/testimonials.js';
import { requirePermission } from '../permissions.js';

const bad = () => appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
const idOf = (v: unknown) => { const p = z.string().uuid().safeParse(v); if (!p.success) throw appError('TESTIMONIAL_NOT_FOUND', { code: 'TESTIMONIAL_NOT_FOUND', http: 404, expose: true }); return p.data; };
const name = z.string().trim().min(2).max(80);
const body = z.string().trim().min(10).max(500);
const rating = z.number().int().min(1).max(5).nullish();

// ------------------------------------------------------------- público e cliente (/testimonials)
export const testimonialsRouter = Router();

testimonialsRouter.get('/', asyncRoute(async (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ items: await T.publicList() });
}));

testimonialsRouter.get('/mine', auth, asyncRoute(async (req, res) => { res.json(await T.clientGet(req.user!.id)); }));
testimonialsRouter.put('/mine', auth, asyncRoute(async (req, res) => {
  const b = z.object({ displayName: name, body, rating, consent: z.literal(true) }).safeParse(req.body);
  if (!b.success) throw bad();
  const r = await T.clientSave(req.user!.id, b.data, req.ip ?? '');
  await audit(req.user!.id, 'TESTIMONIAL_SUBMITTED', 'TESTIMONIAL', r.id, { requestId: requestId(req) });
  res.json({ ...r, status: 'PENDENTE' });
}));
testimonialsRouter.delete('/mine', auth, asyncRoute(async (req, res) => {
  await T.clientWithdraw(req.user!.id);
  await audit(req.user!.id, 'TESTIMONIAL_WITHDRAWN', 'TESTIMONIAL', null, { requestId: requestId(req) });
  res.json({ ok: true });
}));

// ------------------------------------------------------------- equipe (/admin/testimonials)
export const testimonialsAdminRouter = Router();
const guard = requirePermission('MANAGE_CONTENT');

testimonialsAdminRouter.get('/testimonials', adminAuth, guard, asyncRoute(async (req, res) => {
  const s = z.enum(['PENDENTE', 'APROVADO', 'PUBLICADO', 'OCULTO', 'REMOVIDO']).safeParse(req.query.status);
  res.json({ items: await T.adminList(s.success ? s.data : undefined) });
}));
testimonialsAdminRouter.get('/testimonials/:id', adminAuth, guard, asyncRoute(async (req, res) => { res.json(await T.adminDetail(idOf(req.params.id))); }));
testimonialsAdminRouter.post('/testimonials', adminAuth, guard, asyncRoute(async (req, res) => {
  const b = z.object({ displayName: name, body, rating, proofRef: z.string().trim().min(10).max(300), consentConfirmed: z.literal(true) }).safeParse(req.body);
  if (!b.success) throw bad();
  const r = await T.adminCreateManual(req.user!.id, b.data);
  await audit(req.user!.id, 'TESTIMONIAL_MANUAL_CREATED', 'TESTIMONIAL', r.id, { requestId: requestId(req) });
  res.status(201).json(r);
}));
const reason = z.object({ reason: z.string().trim().min(3).max(300) });
for (const [path, action, fn] of [
  ['approve', 'TESTIMONIAL_APPROVED', (id: string, a: string) => T.adminApprove(id, a)],
  ['publish', 'TESTIMONIAL_PUBLISHED', (id: string, a: string) => T.adminPublish(id, a)],
  ['unhide', 'TESTIMONIAL_UNHIDDEN', (id: string, a: string) => T.adminUnhide(id, a)]
] as const) {
  testimonialsAdminRouter.post(`/testimonials/:id/${path}`, adminAuth, guard, asyncRoute(async (req, res) => {
    const id = idOf(req.params.id);
    await fn(id, req.user!.id);
    await audit(req.user!.id, action, 'TESTIMONIAL', id, { requestId: requestId(req) });
    res.json({ ok: true });
  }));
}
testimonialsAdminRouter.post('/testimonials/:id/hide', adminAuth, guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id); const b = reason.safeParse(req.body); if (!b.success) throw bad();
  await T.adminHide(id, req.user!.id, b.data.reason);
  await audit(req.user!.id, 'TESTIMONIAL_HIDDEN', 'TESTIMONIAL', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
testimonialsAdminRouter.post('/testimonials/:id/remove', adminAuth, guard, asyncRoute(async (req, res) => {
  const id = idOf(req.params.id); const b = reason.safeParse(req.body); if (!b.success) throw bad();
  await T.adminRemove(id, req.user!.id, b.data.reason);
  await audit(req.user!.id, 'TESTIMONIAL_REMOVED', 'TESTIMONIAL', id, { requestId: requestId(req) });
  res.json({ ok: true });
}));
