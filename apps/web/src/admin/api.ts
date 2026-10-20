import { createApi } from '../shared/api';

export const ADMIN_TOKEN_KEY = 'pnm_admin_token';
/** Token do painel fica só na sessão do navegador (some ao fechar a aba). */
export const api = createApi({
  tokenKey: ADMIN_TOKEN_KEY,
  store: 'session',
  onUnauthorized: () => window.dispatchEvent(new CustomEvent('pnm:admin-unauthorized'))
});

export type Permission = 'QUERY_VEHICLE' | 'VIEW_HISTORY' | 'BUY_CREDITS' | 'VIEW_SENSITIVE_DATA' | 'MANAGE_USERS' | 'MANAGE_PRICING' | 'MANAGE_PROVIDERS' | 'MANAGE_BILLING' | 'MANAGE_SUPPORT' | 'VIEW_AUDIT' | 'REVEAL_PII' | 'ADMIN_SYSTEM';
export interface TeamUser { id?: string; name: string; email: string; role?: string }

export const ROLE_LABEL: Record<string, string> = { CLIENTE: 'Cliente', OPERADOR: 'Operador', ADMIN: 'Administrador', SUPER_ADMIN: 'Super admin' };

export const QUERY_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  SUCCESS: { label: 'Concluída', tone: 'ok' }, PROCESSING: { label: 'Processando', tone: 'info' }, FAILED: { label: 'Falhou', tone: 'danger' }, REFUNDED: { label: 'Estornada', tone: 'warn' }, PENDING: { label: 'Pendente', tone: 'neutral' }
};
export const PAYMENT_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  PAID: { label: 'Pago', tone: 'ok' }, PENDING: { label: 'Pendente', tone: 'warn' }, FAILED: { label: 'Falhou', tone: 'danger' }, REFUNDED: { label: 'Reembolsado', tone: 'warn' }, CANCELLED: { label: 'Cancelado', tone: 'neutral' }, CREATED: { label: 'Criado', tone: 'neutral' }, CHECKOUT_ACTIVE: { label: 'Em checkout', tone: 'info' }, EXPIRED: { label: 'Expirado', tone: 'neutral' }
};
