import type { Request, Response, NextFunction } from 'express';

export type Permission =
  | 'QUERY_VEHICLE'
  | 'VIEW_HISTORY'
  | 'BUY_CREDITS'
  | 'VIEW_SENSITIVE_DATA'
  | 'MANAGE_USERS'
  | 'MANAGE_PRICING'
  | 'MANAGE_PROVIDERS'
  | 'MANAGE_BILLING'
  | 'MANAGE_SUPPORT'
  | 'VIEW_AUDIT'
  | 'ADMIN_SYSTEM';

const rolePermissions: Record<string, readonly Permission[]> = {
  CLIENTE: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS'],
  OPERADOR: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_SUPPORT'],
  ADMIN: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_USERS', 'MANAGE_PRICING', 'MANAGE_PROVIDERS', 'MANAGE_BILLING', 'MANAGE_SUPPORT', 'VIEW_AUDIT'],
  SUPER_ADMIN: ['QUERY_VEHICLE', 'VIEW_HISTORY', 'BUY_CREDITS', 'VIEW_SENSITIVE_DATA', 'MANAGE_USERS', 'MANAGE_PRICING', 'MANAGE_PROVIDERS', 'MANAGE_BILLING', 'MANAGE_SUPPORT', 'VIEW_AUDIT', 'ADMIN_SYSTEM']
};

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
