import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { adminAuth } from '../auth.js';
import { pool, tx } from '../db.js';
import { appError, asyncRoute, audit, requestId } from '../lib/http.js';

/**
 * Limpeza de dados de teste. Só o SUPER_ADMIN, com senha e frase de confirmação.
 * Apaga movimento (consultas, pagamentos, clientes, atividade). Nunca mexe em configuração:
 * produtos, preços, SEO, textos, equipe, permissões, integrações e auditoria ficam como estão.
 * Não fala com o Mercado Pago nem com a Credify: só limpa os registros daqui.
 */
export const adminDataResetRouter = Router();
adminDataResetRouter.use(adminAuth);

export const RESET_PHRASE = 'APAGAR DADOS DE TESTE';
const LOCK_KEY = 'data_reset_lock';
const SCOPES = ['consultas', 'pagamentos', 'clientes', 'atividade'] as const;
type Scope = typeof SCOPES[number];
type Db = pg.PoolClient;
const idParam = z.string().uuid();
const fail = (code: string, http = 400) => appError(code, { code, http, expose: true });
/** Erro de vínculo no banco: nada foi apagado (a transação desfaz) e a mensagem diz qual tabela impediu. */
function blocked(e: unknown): never {
  const pg = e as { code?: string; constraint?: string; table?: string };
  if (pg?.code === '23503') throw appError(`Nada foi apagado: ainda há registros ligados (${pg.constraint ?? pg.table ?? 'vínculo'}). Avise o suporte técnico com este nome.`, { code: 'DATA_RESET_BLOCKED', http: 409, expose: true, showMessage: true });
  throw e;
}

function superOnly(role: string | undefined) { if (role !== 'SUPER_ADMIN') throw fail('FORBIDDEN', 403); }

async function isLocked(): Promise<boolean> {
  const r = await pool.query('SELECT value FROM platform_settings WHERE key=$1', [LOCK_KEY]);
  return r.rows[0]?.value?.locked === true;
}
async function assertUnlocked() { if (await isLocked()) throw fail('DATA_RESET_LOCKED', 423); }

async function checkPassword(userId: string, password: string) {
  const r = await pool.query('SELECT password_hash FROM users WHERE id=$1 AND active=true', [userId]);
  if (!r.rowCount || !r.rows[0].password_hash || !(await bcrypt.compare(password, String(r.rows[0].password_hash)))) throw fail('INVALID_CREDENTIALS', 401);
}

const n = async (c: Pick<Db, 'query'>, sql: string, params: unknown[] = []) => Number((await c.query(sql, params)).rows[0]?.n ?? 0);
const del = async (c: Db, sql: string, params: unknown[] = []) => (await c.query(sql, params)).rowCount ?? 0;

/** Apaga consultas (todas ou só as informadas) com tudo que depende delas. O histórico financeiro da carteira fica, só perde o vínculo. */
async function deleteQueries(c: Db, ids: string[] | null): Promise<number> {
  const f = ids ? 'ANY($1::uuid[])' : 'ANY(SELECT id FROM vehicle_queries)';
  const p = ids ? [ids] : [];
  await c.query(`UPDATE wallet_transactions SET query_id=NULL WHERE query_id=${f}`, p);
  await c.query(`DELETE FROM query_payment_entitlements WHERE query_id=${f}`, p);
  await c.query(`DELETE FROM secure_links WHERE resource_type='VEHICLE_QUERY' AND resource_id=${f}`, p);
  await c.query(`UPDATE report_documents SET previous_document_id=NULL WHERE previous_document_id IN (SELECT id FROM report_documents WHERE query_id=${f})`, p);
  await c.query(`DELETE FROM report_documents WHERE query_id=${f}`, p);
  return del(c, `DELETE FROM vehicle_queries WHERE id=${f}`, p);
}

/** Apaga pagamentos (todos ou só os informados) com recibos, estornos, eventos de webhook, comissões e documentos fiscais ainda não emitidos. */
async function deleteOrders(c: Db, ids: string[] | null): Promise<number> {
  const f = ids ? 'ANY($1::uuid[])' : 'ANY(SELECT id FROM payment_orders)';
  const p = ids ? [ids] : [];
  await c.query(`UPDATE vehicle_queries SET payment_order_id=NULL WHERE payment_order_id=${f}`, p);
  await c.query(`DELETE FROM query_payment_entitlements WHERE order_id=${f}`, p);
  await c.query(`DELETE FROM affiliate_commissions WHERE order_id=${f}`, p);
  await c.query(`DELETE FROM payment_refunds WHERE order_id=${f}`, p);
  await c.query(`DELETE FROM payment_webhook_events WHERE order_id=${f}`, p);
  const docs = `SELECT id FROM fiscal_documents WHERE status <> 'ISSUED' AND payment_id IN (SELECT id FROM payments WHERE order_id=${f})`;
  await c.query(`DELETE FROM fiscal_jobs WHERE document_id IN (${docs})`, p);
  await c.query(`DELETE FROM fiscal_documents WHERE id IN (${docs})`, p);
  await c.query(`DELETE FROM purchase_contracts WHERE order_id=${f}`, p);
  await c.query(`DELETE FROM payments WHERE order_id=${f}`, p);
  return del(c, `DELETE FROM payment_orders WHERE id=${f}`, p);
}

async function counts() {
  const c = pool;
  const [queries, orders, payments, refunds, clients, leads, convs, sims, outbox, watches, walletBal] = await Promise.all([
    n(c, 'SELECT count(*)::int AS n FROM vehicle_queries'),
    n(c, 'SELECT count(*)::int AS n FROM payment_orders'),
    n(c, 'SELECT count(*)::int AS n FROM payments'),
    n(c, 'SELECT count(*)::int AS n FROM payment_refunds'),
    n(c, `SELECT count(*)::int AS n FROM users WHERE role='CLIENTE'`),
    n(c, 'SELECT count(*)::int AS n FROM site_leads'),
    n(c, 'SELECT count(*)::int AS n FROM support_conversations'),
    n(c, 'SELECT count(*)::int AS n FROM financing_simulations'),
    n(c, 'SELECT count(*)::int AS n FROM email_outbox'),
    n(c, 'SELECT count(*)::int AS n FROM plate_watches'),
    n(c, 'SELECT coalesce(sum(balance_cents),0)::bigint AS n FROM wallets')
  ]);
  return { queries, orders, payments, refunds, clients, leads, conversations: convs, simulations: sims, emails: outbox, plateWatches: watches, walletBalanceCents: walletBal };
}

adminDataResetRouter.get('/data-reset', asyncRoute(async (req, res) => {
  superOnly(req.user?.role);
  res.json({ phrase: RESET_PHRASE, locked: await isLocked(), counts: await counts() });
}));

const lockBody = z.object({ locked: z.boolean(), password: z.string().min(1).max(128) }).strict();
adminDataResetRouter.post('/data-reset/lock', asyncRoute(async (req, res) => {
  superOnly(req.user?.role);
  const b = lockBody.safeParse(req.body);
  if (!b.success) throw fail('INVALID_INPUT');
  await checkPassword(req.user!.id, b.data.password);
  await pool.query(`INSERT INTO platform_settings(key,value,updated_by) VALUES($1,$2::jsonb,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`, [LOCK_KEY, JSON.stringify({ locked: b.data.locked }), req.user!.id]);
  await audit(req.user!.id, b.data.locked ? 'DATA_RESET_LOCKED' : 'DATA_RESET_UNLOCKED', 'PLATFORM_SETTING', LOCK_KEY, { requestId: requestId(req) });
  res.json({ locked: b.data.locked });
}));

const runBody = z.object({
  scopes: z.array(z.enum(SCOPES)).min(1).max(4),
  password: z.string().min(1).max(128),
  confirm: z.string().max(64)
}).strict();

adminDataResetRouter.post('/data-reset/run', asyncRoute(async (req, res) => {
  superOnly(req.user?.role);
  const b = runBody.safeParse(req.body);
  if (!b.success) throw fail('INVALID_INPUT');
  if (b.data.confirm.trim() !== RESET_PHRASE) throw fail('CONFIRMATION_PHRASE_MISMATCH');
  const scopes = new Set<Scope>(b.data.scopes);
  if (scopes.has('clientes') && !(scopes.has('consultas') && scopes.has('pagamentos'))) throw fail('CLIENTS_REQUIRE_QUERIES_AND_PAYMENTS');
  await assertUnlocked();
  await checkPassword(req.user!.id, b.data.password);
  const me = req.user!.id;
  const removed: Record<string, number> = {};
  await tx(async (c) => {
    await c.query(`SET LOCAL lock_timeout = '10s'`);
    if (scopes.has('consultas')) removed.consultas = await deleteQueries(c, null);
    if (scopes.has('pagamentos')) {
      removed.pagamentos = await deleteOrders(c, null);
      await c.query('DELETE FROM affiliate_commissions');
      await c.query('DELETE FROM payments');
      await c.query('DELETE FROM payouts');
      await c.query('DELETE FROM wallet_money_conversions');
      removed.movimentosDeCarteira = await del(c, 'DELETE FROM wallet_transactions');
      await c.query('UPDATE wallets SET balance=0,balance_cents=0,updated_at=now()');
      await c.query('UPDATE coupons SET redeemed_count=0');
      await c.query('DELETE FROM coupon_redemptions');
      await c.query(`DELETE FROM fiscal_jobs WHERE document_id IN (SELECT id FROM fiscal_documents WHERE status <> 'ISSUED')`);
      await c.query(`DELETE FROM fiscal_documents WHERE status <> 'ISSUED'`);
      await c.query('DELETE FROM charges');
    }
    if (scopes.has('atividade')) {
      removed.atividade = 0;
      for (const t of ['funnel_events', 'site_leads', 'contact_messages', 'support_conversations', 'financing_simulations', 'plate_watches', 'email_outbox', 'pii_reveals']) removed.atividade += await del(c, `DELETE FROM ${t}`);
    }
    if (scopes.has('clientes')) {
      const ids = `SELECT id FROM users WHERE role='CLIENTE' AND id<>$1`;
      await c.query(`DELETE FROM pii_reveals WHERE user_id IN (${ids})`, [me]);
      await c.query(`DELETE FROM purchase_contracts WHERE user_id IN (${ids})`, [me]);
      await c.query(`DELETE FROM dealerships WHERE owner_user_id IN (${ids})`, [me]);
      await c.query(`UPDATE audit_logs SET user_id=NULL WHERE user_id IN (${ids})`, [me]);
      removed.clientes = await del(c, `DELETE FROM users WHERE role='CLIENTE' AND id<>$1`, [me]);
    }
    await audit(me, 'DATA_RESET_EXECUTED', 'SYSTEM', null, { scopes: [...scopes], removed, requestId: requestId(req) });
  }).catch(blocked);
  res.json({ removed, counts: await counts() });
}));

const oneBody = z.object({ confirm: z.literal(true) }).strict();

/** Apaga um pagamento de teste (com os recibos, estornos e eventos dele). Não mexe no saldo da carteira. */
adminDataResetRouter.post('/data-reset/payment-orders/:id/delete', asyncRoute(async (req, res) => {
  superOnly(req.user?.role);
  const id = idParam.safeParse(req.params.id);
  if (!id.success || !oneBody.safeParse(req.body).success) throw fail('INVALID_INPUT');
  await assertUnlocked();
  const removed = await tx((c) => deleteOrders(c, [id.data])).catch(blocked);
  if (!removed) throw fail('PAYMENT_ORDER_NOT_FOUND', 404);
  await audit(req.user!.id, 'PAYMENT_ORDER_DELETED', 'PAYMENT_ORDER', id.data, { requestId: requestId(req) });
  res.status(204).end();
}));

/** Apaga uma consulta de teste (com o resultado e os arquivos dela). */
adminDataResetRouter.post('/data-reset/queries/:id/delete', asyncRoute(async (req, res) => {
  superOnly(req.user?.role);
  const id = idParam.safeParse(req.params.id);
  if (!id.success || !oneBody.safeParse(req.body).success) throw fail('INVALID_INPUT');
  await assertUnlocked();
  const removed = await tx((c) => deleteQueries(c, [id.data])).catch(blocked);
  if (!removed) throw fail('QUERY_NOT_FOUND', 404);
  await audit(req.user!.id, 'QUERY_DELETED', 'VEHICLE_QUERY', id.data, { requestId: requestId(req) });
  res.status(204).end();
}));
