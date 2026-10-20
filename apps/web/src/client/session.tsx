import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Profile { id: string; email: string; name: string; role: string; passwordEnabled: boolean; cpfCnpj: string; phone: string; companyName: string; city: string; state: string; marketingOptIn: boolean }
export interface Me { user: { id: string; email: string; name: string; role: string }; balanceCents: number; permissions: string[]; sandbox: boolean; identities: string[]; profile: Profile }

interface SessionState { status: 'loading' | 'anon' | 'authed'; me: Me | null; login: (token: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; setBalance: (cents: number) => void }
const Ctx = createContext<SessionState | null>(null);
export const useSession = (): SessionState => { const v = useContext(Ctx); if (!v) throw new Error('SessionProvider ausente'); return v; };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>(api.token.get() ? 'loading' : 'anon');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    if (!api.token.get()) { setMe(null); setStatus('anon'); return; }
    try { const data = await api.get<Me>('/me'); setMe(data); setStatus('authed'); }
    catch { api.token.clear(); setMe(null); setStatus('anon'); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const on = () => { api.token.clear(); setMe(null); setStatus('anon'); };
    window.addEventListener('pnm:unauthorized', on);
    return () => window.removeEventListener('pnm:unauthorized', on);
  }, []);

  const login = useCallback(async (token: string) => { api.token.set(token); setStatus('loading'); await refresh(); }, [refresh]);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* sessão já inválida */ }
    api.token.clear(); setMe(null); setStatus('anon');
  }, []);
  const setBalance = useCallback((cents: number) => setMe((m) => (m ? { ...m, balanceCents: cents } : m)), []);

  const value = useMemo(() => ({ status, me, login, logout, refresh, setBalance }), [status, me, login, logout, refresh, setBalance]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
