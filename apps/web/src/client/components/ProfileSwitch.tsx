import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { PROFILE_LABEL, useSession, type UsageProfile } from '../session';

/** Troca o perfil de uso (cliente, lojista, afiliado). Só aparece quando a conta tem mais de um. */
export default function ProfileSwitch({ label = false }: { label?: boolean }) {
  const { me, switchProfile } = useSession();
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const profiles = me?.profiles ?? ['CLIENTE'];
  if (!me || profiles.length < 2) return null;
  const active = me.activeProfile ?? 'CLIENTE';
  async function change(next: UsageProfile) {
    if (next === active) return;
    setBusy(true);
    try { await switchProfile(next); nav('/app', { replace: true }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      {label ? <span style={{ fontSize: 13, fontWeight: 600 }}>Perfil de uso</span> : <span className="sr-only">Perfil de uso</span>}
      <Select value={active} disabled={busy} onChange={(e) => void change(e.target.value as UsageProfile)} aria-label="Perfil de uso">
        {profiles.map((p) => <option key={p} value={p}>{PROFILE_LABEL[p]}</option>)}
      </Select>
    </label>
  );
}
