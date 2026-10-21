import { Router } from 'express';
import { z } from 'zod';
import { adminAuth, auth } from '../auth.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';
import { CnpjError, cnpjLookupEnabled, lookupCnpj } from '../lib/cnpj.js';
import { requirePermission } from '../permissions.js';

const HTTP: Record<CnpjError['code'], number> = { CNPJ_INVALID: 400, CNPJ_NOT_FOUND: 404, CNPJ_LOOKUP_DISABLED: 503, CNPJ_RATE_LIMITED: 429, CNPJ_UNAVAILABLE: 502 };
const wrap = (e: unknown): never => {
  if (e instanceof CnpjError) throw appError(e.code, { code: e.code, http: HTTP[e.code], expose: true });
  throw e;
};
const confirmBody = z.object({ edited: z.boolean(), fetchedAt: z.string().max(40), source: z.string().max(40) }).strict();

function build(router: Router, guards: Array<import('express').RequestHandler>, actorAudit: (req: import('express').Request) => string) {
  router.get('/cnpj/status', ...guards, (_req, res) => { res.json({ enabled: cnpjLookupEnabled() }); });
  router.get('/cnpj/:cnpj', ...guards, asyncRoute(async (req, res) => {
    try {
      const r = await lookupCnpj(String(req.params.cnpj), { requester: req.user!.id });
      await audit(req.user!.id, 'CNPJ_LOOKUP', 'CNPJ', r.data.cnpj, { cached: r.cached, scope: actorAudit(req), requestId: requestId(req) });
      res.json({ ...r, note: 'Dados públicos pré-preenchidos. Revise antes de salvar.' });
    } catch (e) { wrap(e); }
  }));
  // registra que a pessoa revisou e usou o pré-preenchimento (o que ela alterou fica no histórico do próprio cadastro)
  router.post('/cnpj/:cnpj/confirm', ...guards, asyncRoute(async (req, res) => {
    const body = confirmBody.safeParse(req.body);
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');
    if (!body.success || cnpj.length !== 14) throw appError('INVALID_INPUT', { code: 'INVALID_INPUT', http: 400, expose: true });
    await audit(req.user!.id, 'CNPJ_PREFILL_CONFIRMED', 'CNPJ', cnpj, { ...body.data, scope: actorAudit(req), requestId: requestId(req) });
    res.json({ ok: true });
  }));
}

export const adminCnpjRouter = Router();
adminCnpjRouter.use(adminAuth);
build(adminCnpjRouter, [requirePermission('MANAGE_CUSTOMERS')], () => 'ADMIN');

export const accountCnpjRouter = Router();
build(accountCnpjRouter, [auth], () => 'ACCOUNT');
