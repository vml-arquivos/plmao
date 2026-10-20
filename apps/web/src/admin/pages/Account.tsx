import { useState } from 'react';
import { api, ROLE_LABEL } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, Field, Input, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';

export default function Account() {
  usePageTitle('Minha conta');
  const { user, recoveryCodesRemaining } = useAdminSession();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (next.length < 12 || next !== again) return;
    setBusy(true);
    try { await api.post('/admin/auth/change-password', { currentPassword: current, newPassword: next }); setCurrent(''); setNext(''); setAgain(''); toast.ok('Senha atualizada. As outras sessões foram encerradas.'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title="Minha conta" sub="Dados de acesso da equipe e segurança." />
      <div className="adm-grid-2">
        <Card title="Perfil">
          <dl className="kv"><dt>Nome</dt><dd>{user?.name}</dd><dt>E-mail</dt><dd>{user?.email}</dd><dt>Perfil</dt><dd>{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</dd>
            <dt>Verificação em 2 etapas</dt><dd><Badge tone="ok" dot>Ativa</Badge></dd><dt>Códigos de recuperação</dt><dd>{recoveryCodesRemaining} disponível(is)</dd></dl>
          {recoveryCodesRemaining <= 2 && <Alert tone="warn">Poucos códigos de recuperação restantes. Peça a um super admin para reiniciar o 2FA (comando admin:reset-2fa) e gerar novos códigos.</Alert>}
        </Card>
        <Card title="Alterar senha">
          <form className="stack" onSubmit={save}>
            <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
            <Field label="Nova senha" hint="Mínimo de 12 caracteres."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={12} required /></Field>
            <Field label="Repita a nova senha" error={mismatch ? 'As senhas não conferem.' : undefined}><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
            <p className="muted" style={{ fontSize: 13 }}>As outras sessões serão encerradas após a alteração.</p>
            <div><Button type="submit" variant="primary" loading={busy} disabled={next.length < 12 || next !== again || !current}>Atualizar senha</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
