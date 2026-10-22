import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, ROLE_LABEL } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, CopyField, Field, Input, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';

/** Só a própria pessoa altera o nome; nem quem está acima na equipe edita dados pessoais de outro. */
function ProfileName({ name, onSaved }: { name: string; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setValue(name); }, [name]);
  const changed = value.trim() !== name && value.trim().length >= 2;
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!changed) return;
    setBusy(true);
    try { await api.patch('/admin/auth/profile', { name: value.trim() }); toast.ok('Nome atualizado.'); onSaved(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <form className="row" style={{ alignItems: 'flex-end', marginBottom: 12 }} onSubmit={submit}>
      <div className="grow"><Field label="Nome"><Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoComplete="name" /></Field></div>
      <Button type="submit" size="sm" loading={busy} disabled={!changed}>Salvar</Button>
    </form>
  );
}

export default function Account() {
  usePageTitle('Minha conta');
  const { user, recoveryCodesRemaining, totpEnabled, totpRequired, reload } = useAdminSession();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (next.length < 8 || next !== again) return;
    setBusy(true);
    try { await api.post('/admin/auth/change-password', { currentPassword: current, newPassword: next }); setCurrent(''); setNext(''); setAgain(''); toast.ok('Senha atualizada. As outras sessões foram encerradas.'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title="Minha conta" sub="Dados de acesso da equipe e segurança." />
      <div className="adm-grid-2">
        <Card title="Perfil">
          <ProfileName name={user?.name ?? ''} onSaved={() => void reload()} />
          <dl className="kv"><dt>E-mail</dt><dd>{user?.email}</dd><dt>Perfil</dt><dd>{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</dd>
            <dt>Verificação em 2 etapas</dt><dd>{totpEnabled ? <Badge tone="ok" dot>Ativa</Badge> : <Badge tone="neutral" dot>Desativada</Badge>}</dd>{totpEnabled && <><dt>Códigos de recuperação</dt><dd>{recoveryCodesRemaining} disponível(is)</dd></>}</dl>
          {totpEnabled && recoveryCodesRemaining <= 2 && <Alert tone="warn">Poucos códigos de recuperação restantes. Desative e ative de novo a verificação para gerar novos códigos.</Alert>}
        </Card>
        <TwoFactorCard enabled={totpEnabled} required={totpRequired} onChanged={() => void reload()} />
        {totpEnabled && <TrustedDevices />}
        <Card title="Alterar senha">
          <form className="stack" onSubmit={save}>
            <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
            <Field label="Nova senha" hint="Mínimo de 8 caracteres."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required /></Field>
            <Field label="Repita a nova senha" error={mismatch ? 'As senhas não conferem.' : undefined}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
            <p className="muted" style={{ fontSize: 13 }}>As outras sessões serão encerradas após a alteração.</p>
            <div><Button type="submit" variant="primary" loading={busy} disabled={next.length < 8 || next !== again || !current}>Atualizar senha</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}

function TwoFactorCard({ enabled, required, onChanged }: { enabled: boolean; required: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) { setBusy(true); try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }
  const start = () => void run(async () => {
    const r = await api.post<{ setup: { secret: string; otpauthUrl: string } }>('/admin/auth/totp/setup', {});
    setSetup({ secret: r.setup.secret, qr: await QRCode.toDataURL(r.setup.otpauthUrl, { margin: 1, width: 200 }) }); setCode('');
  });
  const enable = (ev: React.FormEvent) => { ev.preventDefault(); void run(async () => {
    const r = await api.post<{ recoveryCodes: string[] }>('/admin/auth/totp/enable', { code: code.trim() });
    setSetup(null); setCode(''); setCodes(r.recoveryCodes); onChanged();
  }); };
  const disable = (ev: React.FormEvent) => { ev.preventDefault(); void run(async () => {
    await api.post('/admin/auth/totp/disable', { password: pass, code: code.trim() });
    setPass(''); setCode(''); onChanged(); toast.ok('Verificação em duas etapas desativada.');
  }); };
  return (
    <Card title="Verificação em duas etapas">
      {codes ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Guarde estes códigos. Cada um vale uma vez e não aparece de novo.</p>
          <div className="rc-grid">{codes.map((c) => <code key={c}>{c}</code>)}</div>
          <div className="row"><Button icon="copy" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copiar</Button><Button variant="primary" onClick={() => setCodes(null)}>Pronto</Button></div>
        </div>
      ) : setup ? (
        <form className="stack" onSubmit={enable}>
          <div className="qr-box"><img src={setup.qr} alt="QR code para o aplicativo autenticador" /></div>
          <CopyField label="Chave" value={setup.secret} />
          <Field label="Código de 6 dígitos"><Input inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus /></Field>
          <div className="row"><Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6}>Ativar</Button><Button variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button></div>
        </form>
      ) : enabled ? (
        required ? <p className="muted" style={{ margin: 0 }}>Obrigatória neste ambiente.</p> : (
          <form className="stack" onSubmit={disable}>
            <Field label="Senha"><Input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} required /></Field>
            <Field label="Código do aplicativo ou de recuperação"><Input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={16} /></Field>
            <div><Button type="submit" variant="danger" loading={busy} disabled={!pass || code.trim().length < 6}>Desativar</Button></div>
          </form>
        )
      ) : (
        <div className="stack"><p className="muted" style={{ margin: 0 }}>Proteja o acesso com o código de um aplicativo autenticador.</p><div><Button variant="primary" loading={busy} onClick={start}>Ativar</Button></div></div>
      )}
    </Card>
  );
}

interface Device { id: string; label: string | null; createdAt: string; lastUsedAt: string | null; expiresAt: string }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

/** Computadores que não pedem o código de novo. */
function TrustedDevices() {
  const toast = useToast();
  const [items, setItems] = useState<Device[] | null>(null);
  const load = () => { api.get<{ items: Device[] }>('/admin/auth/devices').then((r) => setItems(r.items), () => setItems([])); };
  useEffect(load, []);
  const remove = async (id?: string) => {
    try {
      await api.del(id ? `/admin/auth/devices/${id}` : '/admin/auth/devices');
      if (!id) { try { localStorage.removeItem('pnm_admin_device'); } catch { /* sem armazenamento */ } }
      load(); toast.ok(id ? 'Computador removido.' : 'Todos os computadores foram removidos.');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Card title="Computadores confiáveis">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Nestes computadores o código não é pedido de novo. Marque "Confiar neste computador" ao entrar.</p>
        {items && items.length > 0 ? (
          <ul className="dev-list">
            {items.map((d) => (
              <li key={d.id}>
                <div><b>{(d.label ?? 'Computador').slice(0, 70)}</b><small>Último uso: {when(d.lastUsedAt ?? d.createdAt)}</small></div>
                <Button size="sm" variant="ghost" onClick={() => void remove(d.id)}>Remover</Button>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>{items ? 'Nenhum computador marcado.' : 'Carregando…'}</p>}
        {items && items.length > 1 && <div><Button size="sm" onClick={() => void remove()}>Remover todos</Button></div>}
      </div>
    </Card>
  );
}
