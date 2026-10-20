import type { Request, Response, NextFunction } from 'express';

export type Permission =
  | 'QUERY_VEHICLE'
  | 'VIEW_HISTORY'
  | 'BUY_CREDITS'
  | 'VIEW_SENSITIVE_DATA'
  | 'MANAGE_USERS'
  | 'MANAGE_PRICING'
  | 'MANAGE_CONTENT'
  | 'MANAGE_PROVIDERS'
  | 'MANAGE_BILLING'
  | 'MANAGE_SUPPORT'
  | 'VIEW_AUDIT'
  | 'REVEAL_PII'
  | 'ADMIN_SYSTEM'
  | 'VIEW_DASHBOARD'
  | 'VIEW_QUERIES'
  | 'VIEW_CUSTOMERS'
  | 'MANAGE_CUSTOMERS'
  | 'MANAGE_TEAM'
  | 'MANAGE_FISCAL';

const CLIENT_BASE: readonly Permission[] = ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS'];
const ADMIN_BASE: readonly Permission[] = [...CLIENT_BASE, 'VIEW_SENSITIVE_DATA', 'MANAGE_USERS', 'MANAGE_PRICING', 'MANAGE_CONTENT', 'MANAGE_PROVIDERS', 'MANAGE_BILLING', 'MANAGE_SUPPORT', 'VIEW_AUDIT', 'REVEAL_PII', 'VIEW_DASHBOARD', 'VIEW_QUERIES', 'VIEW_CUSTOMERS', 'MANAGE_CUSTOMERS', 'MANAGE_TEAM', 'MANAGE_FISCAL'];

/** Fonte única dos níveis de acesso. O papel é lido do banco a cada requisição; a lista de permissões vive aqui, no código. */
const rolePermissions: Record<string, readonly Permission[]> = {
  CLIENTE: CLIENT_BASE,
  OPERADOR: [...CLIENT_BASE, 'VIEW_SENSITIVE_DATA', 'MANAGE_SUPPORT', 'VIEW_QUERIES', 'VIEW_CUSTOMERS'],
  SUPORTE: ['VIEW_HISTORY', 'MANAGE_SUPPORT', 'VIEW_QUERIES', 'VIEW_CUSTOMERS'],
  CONTEUDO: ['MANAGE_CONTENT'],
  FINANCEIRO: ['VIEW_DASHBOARD', 'VIEW_QUERIES', 'VIEW_CUSTOMERS', 'MANAGE_BILLING', 'MANAGE_FISCAL'],
  ADMIN: ADMIN_BASE,
  SUPER_ADMIN: [...ADMIN_BASE, 'ADMIN_SYSTEM']
};

/** Papéis da equipe em ordem de poder (maior = mais acesso). */
export const TEAM_ROLE_RANK: Record<string, number> = { CONTEUDO: 1, SUPORTE: 1, OPERADOR: 2, FINANCEIRO: 2, ADMIN: 3, SUPER_ADMIN: 4 };

export const TEAM_ROLE_INFO: Array<{ role: string; label: string; description: string; can: string[] }> = [
  { role: 'SUPER_ADMIN', label: 'Super admin', description: 'Dono do sistema. Acesso total, inclusive ajustes de sistema, administradores e exclusões.', can: ['Tudo do painel', 'Criar e remover administradores', 'Configurações do sistema'] },
  { role: 'ADMIN', label: 'Administrador', description: 'Gerencia o dia a dia: clientes, equipe, preços, financeiro, notas fiscais e site.', can: ['Clientes, empresas e equipe', 'Preços, cobranças e notas fiscais', 'Site, FAQ e artigos', 'Auditoria'] },
  { role: 'FINANCEIRO', label: 'Financeiro', description: 'Cuida de cobranças, pagamentos e notas fiscais. Não altera preços nem o site.', can: ['Cobranças e parcelas', 'Pagamentos e financeiro', 'Notas fiscais', 'Ver clientes e consultas'] },
  { role: 'OPERADOR', label: 'Operador', description: 'Atende e consulta placas para clientes. Não vê valores nem altera configurações.', can: ['Consultar placas', 'Atender suporte', 'Ver clientes e consultas'] },
  { role: 'SUPORTE', label: 'Suporte', description: 'Responde mensagens e acompanha clientes e consultas, só leitura.', can: ['Responder mensagens', 'Ver clientes e consultas'] },
  { role: 'CONTEUDO', label: 'Conteúdo', description: 'Edita o que aparece no site: produtos da vitrine, perguntas frequentes e artigos.', can: ['Produtos do site', 'Perguntas frequentes', 'Artigos e blog'] }
];

export function hasPermission(role: string, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Sua conta não tem permissão para realizar esta ação.' });
      return;
    }
    next();
  };
}

export function permissionsFor(role: string): readonly Permission[] {
  return rolePermissions[role] ?? [];
}
