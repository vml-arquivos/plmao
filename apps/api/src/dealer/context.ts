import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { appError } from '../lib/http.js';

export type DealerRole = 'OWNER' | 'MANAGER' | 'SELLER';
export const ROLE_RANK: Record<DealerRole, number> = { SELLER: 1, MANAGER: 2, OWNER: 3 };

export interface DealerStore {
  id: string; name: string; slug: string; ownerUserId: string; whatsapp: string | null; email: string | null; city: string | null; state: string | null;
  about: string; publicEnabled: boolean; active: boolean; vehicleLimit: number; memberLimit: number; tradeInDiscountBps: number; staleDays: number;
}
export interface DealerCtx { userId: string; role: DealerRole; store: DealerStore }

declare module 'express-serve-static-core' {
  interface Request { dealer?: DealerCtx }
}

export const bad = (message: string, code = 'INVALID_INPUT', http = 400) => appError(message, { code, http, expose: true });
export const notFound = (message = 'Não encontrado.', code = 'DEALER_NOT_FOUND') => appError(message, { code, http: 404, expose: true });
export const forbidden = (message = 'Você não tem permissão para isso.', code = 'DEALER_FORBIDDEN') => appError(message, { code, http: 403, expose: true });
export const conflict = (message: string, code: string) => appError(message, { code, http: 409, expose: true });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identificador inválido vira 404 (nunca 500 nem vazamento de existência). */
export function uuidParam(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw notFound();
  return v;
}

export function storeFromRow(r: Record<string, unknown>): DealerStore {
  return {
    id: String(r.id), name: String(r.name), slug: String(r.slug), ownerUserId: String(r.owner_user_id), whatsapp: (r.whatsapp as string | null) ?? null, email: (r.email as string | null) ?? null,
    city: (r.city as string | null) ?? null, state: (r.state as string | null) ?? null, about: String(r.about ?? ''), publicEnabled: Boolean(r.public_enabled), active: Boolean(r.active),
    vehicleLimit: Number(r.vehicle_limit), memberLimit: Number(r.member_limit), tradeInDiscountBps: Number(r.trade_in_discount_bps), staleDays: Number(r.stale_days)
  };
}

export async function loadMembership(userId: string): Promise<DealerCtx | null> {
  const r = await pool.query(`SELECT d.*, m.role FROM dealership_members m JOIN dealerships d ON d.id=m.dealership_id WHERE m.user_id=$1 AND m.active LIMIT 1`, [userId]);
  if (!r.rowCount) return null;
  return { userId, role: r.rows[0].role as DealerRole, store: storeFromRow(r.rows[0] as Record<string, unknown>) };
}

/**
 * Exige login do cliente e participação ativa em uma loja. Loja suspensa pelo painel bloqueia tudo.
 * A loja e o papel vêm do banco a cada chamada: remover alguém da equipe vale na hora.
 */
export function dealerAccess(minRole: DealerRole = 'SELLER'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    (async () => {
      if (!req.user) throw appError('Faça login.', { code: 'INVALID_TOKEN', http: 401, expose: true });
      const ctx = await loadMembership(req.user.id);
      if (!ctx) throw notFound('Você ainda não tem uma loja.', 'DEALER_NOT_ACTIVATED');
      if (!ctx.store.active) throw forbidden('Esta loja está suspensa. Fale com o suporte.', 'DEALER_SUSPENDED');
      if (ROLE_RANK[ctx.role] < ROLE_RANK[minRole]) throw forbidden();
      req.dealer = ctx;
      next();
    })().catch(next);
  };
}

export const can = {
  manage: (c: DealerCtx) => ROLE_RANK[c.role] >= ROLE_RANK.MANAGER,
  seeCost: (c: DealerCtx) => ROLE_RANK[c.role] >= ROLE_RANK.MANAGER
};

// ---------- validadores compartilhados ----------
export const dayZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'INVALID_DATE');
export const plateZ = z.string().trim().transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).refine((v) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), 'INVALID_PLATE');
export const centsZ = z.number().int().min(0).max(2_000_000_000);
export const phoneZ = z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((v) => /^[0-9]{10,13}$/.test(v), 'INVALID_PHONE');
export const emailZ = z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

export function slugify(input: string): string {
  const s = input.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return s.length >= 3 ? s : `loja-${s || 'nova'}`.slice(0, 40);
}

export const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
export const dayOut = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** Código do banco de "violação de restrição única". */
export const isUnique = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
