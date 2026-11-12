import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { clearInvite, clearLeadLink, funnelSessionId, storedInvite, storedLeadLink } from './funnel';

export interface Profile { id: string; email: string; name: string; role: string; passwordEnabled: boolean; cpfCnpj: string; phone: string; companyName: string; city: string; state: string; zip: string; street: string; streetNumber: string; complement: string; district: string; customerType: string; responsibilityAccepted: boolean; profileComplete: boolean; profileMissing: string[]; profileRequired: boolean; marketingOptIn: boolean; accessMissing?: string[]; pixKey?: string; pixKeyType?: string; pixKeyMasked?: string; pixKeyMissing?: boolean }
export interface StoreAccess { name: string; role: 'OWNER' | 'MANAGER' | 'SELLER'; active: boolean }
export type UsageProfile = 'CLIENTE' | 'LOJISTA' | 'AFILIADO';
export const PROFILE_LABEL: Record<UsageProfile, string> = { CLIENTE: 'Cliente', LOJISTA: 'Lojista', AFILIADO: 'Afiliado' };
export interface Me { features?: Record<string, boolean>; profiles?: UsageProfile[]; activeProfile?: UsageProfile; storeAccess?: StoreAccess | null; user: { id: string; email: string; name: string; role: string }; balanceCents: number; permissions: string[]; sandbox: boolean; identities: string[]; profile: Profile }

interface SessionState { status: 'loading' | 'anon' | 'authed'; me: Me | null; login: (token: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; setBalance: (cents: number) => void; switchProfile: (profile: UsageProfile) => Promise<void> }
const Ctx = createContext<SessionState | null>(null);
export const useSession = (): SessionState => { const v = useContext(Ctx); if (!v) throw new Error('SessionProvider ausente'); return v; };

/** Perfil em uso, já conferido com o que a conta realmente tem. */
export function useActiveProfile(): UsageProfile {
  const { me } = useSession();
  const active = me?.activeProfile ?? 'CLIENTE';
  return (me?.profiles ?? ['CLIENTE']).includes(active) ? active : 'CLIENTE';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>(api.token.get() ? 'loading' : 'anon');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    if (!api.token.get()) { setMe(null); setStatus('anon'); return; }
    try {
      const data = await api.get<Me>('/me'); setMe(data); setStatus('authed');
      // Convite guardado no navegador (ex.: quem entrou pelo Google): liga a conta nova a quem convidou, uma vez só.
      const inv = storedInvite();
      if (inv) { clearInvite(); void api.post('/me/invite/claim', { code: inv.code, via: inv.via }).catch(() => undefined); }
      // Link de consulta enviado pela equipe: o servidor liga a conta ao link só se a conta for nova.
      const ll = storedLeadLink();
      if (ll) { clearLeadLink(); void api.post('/me/lead-link/claim', { code: ll, sessionId: funnelSessionId() }).catch(() => undefined); }
    }
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

  const switchProfile = useCallback(async (profile: UsageProfile) => { await api.put('/me/profile', { profile }); await refresh(); }, [refresh]);

  const value = useMemo(() => ({ status, me, login, logout, refresh, setBalance, switchProfile }), [status, me, login, logout, refresh, setBalance, switchProfile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
