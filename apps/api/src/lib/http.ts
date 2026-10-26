import type { Request, RequestHandler } from 'express';
import { env } from '../config.js';
import { pool } from '../db.js';
import { sanitizeAuditMetadata } from '../privacy.js';

/** `showMessage`: a mensagem já foi escrita para o cliente e vai como está (sem passar pelo dicionário de códigos). */
export type AppError = Error & { code?: string; http?: number; expose?: boolean; showMessage?: boolean };

export function appError(message: string, options: Pick<AppError, 'code' | 'http' | 'expose' | 'showMessage'> = {}): AppError {
  const error = new Error(message) as AppError;
  Object.assign(error, options);
  return error;
}

export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requestId(req: Request): string {
  return String(req.res?.locals.requestId ?? 'unknown');
}

export function log(level: 'info' | 'warn' | 'error', event: string, metadata: Record<string, unknown>): void {
  const permitted = Object.fromEntries(Object.entries(metadata).filter(([key]) => !/password|token|authorization|document|chassis|renavam|secret|key/i.test(key)));
  const payload = { timestamp: new Date().toISOString(), level, event, ...permitted };
  if (level === 'error') console.error(JSON.stringify(payload));
  else if (level === 'warn') console.warn(JSON.stringify(payload));
  else console.info(JSON.stringify(payload));
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  if (!env.AUDIT_LOG_ENABLED) return;
  await pool.query('INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)', [userId, action, entity, entityId, JSON.stringify(sanitizeAuditMetadata(metadata) ?? {})]);
}
