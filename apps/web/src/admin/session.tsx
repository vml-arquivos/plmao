import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Permission, type TeamUser } from './api';

interface MeResponse { user: TeamUser; permissions: Permission[]; recoveryCodesRemaining?: number }
interface Ctx {
  user: TeamUser | null; permissions: Permission[]; ready: boolean; recoveryCodesRemaining: number;
  can: (p: Permission) => boolean;
  establish: (token: string) => Promise<void>;
  logout: () => Promise<void>;
}
const SessionCtx = createContext<Ctx>({ user: null, permissions: [], ready: false, recoveryCodesRemaining: 0, can: () => false, establish: async () => undefined, logout: async () => undefined });
export const useAdminSession = () => useContext(SessionCtx);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: TeamUser | null; permissions: Permission[]; ready: boolean; rc: number }>({ user: null, permissions: [], ready: false, rc: 0 });

  const load = useCallback(async () => {
    if (!api.token.get()) { setState({ user: null, permissions: [], ready: true, rc: 0 }); return; }
    try {
      const me = await api.get<MeResponse>('/admin/auth/me');
      setState({ user: me.user, permissions: me.permissions, ready: true, rc: me.recoveryCodesRemaining ?? 0 });
    } catch {
      api.token.clear();
      setState({ user: null, permissions: [], ready: true, rc: 0 });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onUnauthorized = () => { api.token.clear(); setState({ user: null, permissions: [], ready: true, rc: 0 }); };
    window.addEventListener('pnm:admin-unauthorized', onUnauthorized);
    return () => window.removeEventListener('pnm:admin-unauthorized', onUnauthorized);
  }, []);

  const value = useMemo<Ctx>(() => ({
    user: state.user, permissions: state.permissions, ready: state.ready, recoveryCodesRemaining: state.rc,
    can: (p) => state.permissions.includes(p),
    establish: async (token: string) => { api.token.set(token); await load(); },
    logout: async () => { try { await api.post('/admin/auth/logout'); } catch { /* sessão já inválida */ } api.token.clear(); setState({ user: null, permissions: [], ready: true, rc: 0 }); }
  }), [state, load]);

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
