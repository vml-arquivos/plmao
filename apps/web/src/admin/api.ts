import { createApi } from '../shared/api';

export const ADMIN_TOKEN_KEY = 'pnm_admin_token';
/** Token do painel fica só na sessão do navegador (some ao fechar a aba). */
export const api = createApi({
  tokenKey: ADMIN_TOKEN_KEY,
  store: 'session',
  onUnauthorized: () => window.dispatchEvent(new CustomEvent('pnm:admin-unauthorized'))
});

export type Permission = 'QUERY_VEHICLE' | 'VIEW_HISTORY' | 'BUY_CREDITS' | 'VIEW_SENSITIVE_DATA' | 'MANAGE_USERS' | 'MANAGE_PRICING' | 'MANAGE_CONTENT' | 'MANAGE_PROVIDERS' | 'MANAGE_BILLING' | 'MANAGE_SUPPORT' | 'VIEW_AUDIT' | 'REVEAL_PII' | 'ADMIN_SYSTEM' | 'VIEW_DASHBOARD' | 'VIEW_QUERIES' | 'VIEW_CUSTOMERS' | 'MANAGE_CUSTOMERS' | 'MANAGE_TEAM' | 'MANAGE_FISCAL' | 'VIEW_CONTRACTS' | 'MANAGE_CONTRACTS' | 'APPROVE_CONTRACTS';
export interface TeamUser { id?: string; name: string; email: string; role?: string }

export const ROLE_LABEL: Record<string, string> = { CLIENTE: 'Cliente', OPERADOR: 'Operador', SUPORTE: 'Suporte', CONTEUDO: 'Conteúdo', FINANCEIRO: 'Financeiro', ADMIN: 'Administrador', SUPER_ADMIN: 'Super admin' };

export type CustomerType = 'PARTICULAR' | 'AUTONOMO' | 'EMPRESA';
export const CUSTOMER_TYPE: Record<CustomerType, { label: string; plural: string; hint: string; tone: 'neutral' | 'info' | 'violet' }> = {
  PARTICULAR: { label: 'Particular', plural: 'Particulares', hint: 'Pessoa física que consulta para uso próprio (compra ou venda de um veículo).', tone: 'neutral' },
  AUTONOMO: { label: 'Autônomo', plural: 'Autônomos', hint: 'Vendedor de carros autônomo, despachante ou profissional que consulta com frequência.', tone: 'info' },
  EMPRESA: { label: 'Empresa', plural: 'Empresas', hint: 'Loja, revenda, agência ou qualquer negócio com CNPJ. Pode ter vários usuários.', tone: 'violet' }
};
export const SEGMENT_SUGGESTIONS = ['Vendedor de carros autônomo', 'Loja de veículos', 'Revenda', 'Agência', 'Despachante', 'Locadora', 'Financeira', 'Seguradora', 'Oficina', 'Leiloeiro', 'Consumidor final'];
export const COMPANY_KIND: Record<string, string> = { EMPRESA: 'Empresa', AGENCIA: 'Agência', REVENDA: 'Revenda', LOJA: 'Loja', DESPACHANTE: 'Despachante', OUTRO: 'Outro' };
export const STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
export const PAY_METHOD: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CARTAO: 'Cartão', TRANSFERENCIA: 'Transferência', DINHEIRO: 'Dinheiro', OUTRO: 'Outro' };

/** Máscaras de digitação (o servidor valida os dígitos verificadores). */
export function maskDocument(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
export const maskZip = (v: string): string => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
export const maskPhone = (v: string): string => { const d = v.replace(/\D/g, '').slice(0, 11); return d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : d.replace(/^(\d{2})(\d{0,4})(\d{0,4})$/, (_m, a: string, b: string, c: string) => (b ? `(${a}) ${b}${c ? `-${c}` : ''}` : a)); };

export const QUERY_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  SUCCESS: { label: 'Concluída', tone: 'ok' }, PROCESSING: { label: 'Processando', tone: 'info' }, FAILED: { label: 'Falhou', tone: 'danger' }, REFUNDED: { label: 'Estornada', tone: 'warn' }, PENDING: { label: 'Pendente', tone: 'neutral' }
};
export const PAYMENT_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  PAID: { label: 'Pago', tone: 'ok' }, PENDING: { label: 'Pendente', tone: 'warn' }, FAILED: { label: 'Falhou', tone: 'danger' }, REFUNDED: { label: 'Reembolsado', tone: 'warn' }, CANCELLED: { label: 'Cancelado', tone: 'neutral' }, CREATED: { label: 'Criado', tone: 'neutral' }, CHECKOUT_ACTIVE: { label: 'Em checkout', tone: 'info' }, EXPIRED: { label: 'Expirado', tone: 'neutral' }
};
