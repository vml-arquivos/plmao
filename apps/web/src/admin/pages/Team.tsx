import { useState } from 'react';
import { api, ROLE_LABEL } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Switch, Tabs, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { PageHead } from '../parts';

interface Member { id: string; name: string; email: string; role: string; active: boolean; createdAt: string; lastLoginAt: string | null; twoFactorEnabled: boolean; lockedUntil: string | null }
interface RoleInfo { role: string; label: string; description: string; can: string[]; assignable: boolean; rank: number }

const ROLE_TONE: Record<string, 'violet' | 'info' | 'ok' | 'warn' | 'neutral'> = { SUPER_ADMIN: 'violet', ADMIN: 'violet', FINANCEIRO: 'ok', OPERADOR: 'info', SUPORTE: 'info', CONTEUDO: 'warn' };

export default function Team() {
  usePageTitle('Equipe e acessos');
  const { user: me } = useAdminSession();
  const toast = useToast();
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  const team = useAsync(() => api.get<{ items: Member[] }>('/admin/team'));
  const roles = useAsync(() => api.get<{ roles: RoleInfo[] }>('/admin/team/roles'));
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'password' | '2fa' | 'remove'; m: Member } | null>(null);

  return (
    <>
      <PageHead title="Equipe e acessos" sub="Pessoas que trabalham no painel. Cada uma entra com e-mail e senha (a verificação em duas etapas é opcional) e só vê o que o nível de acesso permite."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo membro da equipe</Button>} />
      <Tabs label="Equipe" value={tab} onChange={setTab} items={[{ id: 'members', label: 'Membros' }, { id: 'roles', label: 'Níveis de acesso' }]} />
      {tab === 'roles' ? (
        roles.loading && !roles.data ? <PageLoading /> : roles.error || !roles.data ? <ErrorState error={roles.error} onRetry={roles.reload} /> : (
          <div className="role-grid">
            {roles.data.roles.map((r) => (
              <div key={r.role} className="role-card">
                <h3>{r.label} <Badge tone={ROLE_TONE[r.role]}>{r.role === 'SUPER_ADMIN' ? 'Dono' : 'Nível'}</Badge></h3>
                <p className="muted">{r.description}</p>
                <ul>{r.can.map((x) => <li key={x}>{x}</li>)}</ul>
                {!r.assignable && <small className="muted">Só o Super admin concede este nível.</small>}
              </div>
            ))}
          </div>
        )
      ) : team.loading && !team.data ? <PageLoading /> : team.error || !team.data ? <ErrorState error={team.error} onRetry={team.reload} /> : !team.data.items.length ? <EmptyState icon="users" title="Nenhum membro" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Pessoa</th><th>Nível de acesso</th><th>Verificação em 2 etapas</th><th>Último acesso</th><th>Situação</th><th /></tr></thead><tbody>
          {team.data.items.map((m) => (
            <tr key={m.id} className={m.active ? undefined : 'row-muted'}>
              <td><b>{m.name}</b>{m.id === me?.id && <> <Badge>Você</Badge></>}<div className="muted" style={{ fontSize: 12.5 }}>{m.email}</div></td>
              <td><Badge tone={ROLE_TONE[m.role]}>{ROLE_LABEL[m.role] ?? m.role}</Badge></td>
              <td>{m.twoFactorEnabled ? <Badge tone="ok" dot>Ativada</Badge> : <Badge dot>Não ativada</Badge>}</td>
              <td>{dateTime(m.lastLoginAt)}</td>
              <td><Badge tone={m.active ? 'ok' : 'danger'} dot>{m.active ? 'Ativo' : 'Bloqueado'}</Badge>{m.lockedUntil && new Date(m.lockedUntil) > new Date() && <div className="tag-warn">Travado por tentativas</div>}</td>
              <td className="actions">{m.id !== me?.id && <Button size="sm" onClick={() => setEdit(m)}>Gerenciar</Button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {creating && roles.data && <MemberForm roles={roles.data.roles} onClose={(created) => {
        setCreating(false);
        if (created) { team.reload(); if (created.inviteSent) toast.ok(`Convite enviado para ${created.email}. A pessoa cria a própria senha pelo link.`); else toast.error(`Acesso criado, mas o e-mail para ${created.email} não saiu. Use “Enviar link de nova senha” em Gerenciar.`); }
      }} />}
      {edit && roles.data && <MemberForm member={edit} roles={roles.data.roles} onClose={() => { setEdit(null); team.reload(); }}
        onAction={(kind) => { setConfirm({ kind, m: edit }); setEdit(null); }} />}
      {confirm?.kind === 'password' && <ConfirmDialog title="Enviar link de nova senha?" confirmLabel="Enviar link" message={`${confirm.m.name} recebe um e-mail em ${confirm.m.email} para criar uma nova senha. Ninguém além da própria pessoa vê ou define a senha.`} onConfirm={async () => {
        try { await api.post(`/admin/team/${confirm.m.id}/reset-password`); toast.ok('Link enviado por e-mail.'); } catch (e) { toast.error(errorMessage(e)); throw e; }
      }} onClose={() => setConfirm(null)} />}
      {confirm?.kind === '2fa' && <ConfirmDialog title="Zerar verificação em duas etapas?" confirmLabel="Zerar" danger message={`${confirm.m.name} terá a verificação desativada e pode ativar de novo em “Minha conta”. As sessões abertas são encerradas.`} onConfirm={async () => {
        try { await api.post(`/admin/team/${confirm.m.id}/reset-2fa`); toast.ok('Verificação zerada.'); team.reload(); } catch (e) { toast.error(errorMessage(e)); throw e; }
      }} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'remove' && <ConfirmDialog title="Remover da equipe?" confirmLabel="Remover" danger message={`${confirm.m.name} perde o acesso ao painel imediatamente. O que essa pessoa fez continua registrado na auditoria.`} onConfirm={async () => {
        try { await api.del(`/admin/team/${confirm.m.id}`); toast.ok('Membro removido.'); team.reload(); } catch (e) { toast.error(e instanceof Error && (e as { code?: string }).code === 'LAST_SUPER_ADMIN' ? 'Este é o último Super admin; não pode ser removido.' : errorMessage(e)); throw e; }
      }} onClose={() => setConfirm(null)} />}
    </>
  );
}

function MemberForm({ member, roles, onClose, onAction }: {
  member?: Member; roles: RoleInfo[]; onClose: (created?: { email: string; inviteSent: boolean }) => void; onAction?: (k: 'password' | '2fa' | 'remove') => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(member?.name ?? '');
  // Nome é dado pessoal: ao gerenciar outra pessoa só aparece, quem edita é ela mesma em “Minha conta”.
  const [email, setEmail] = useState(member?.email ?? '');
  const [role, setRole] = useState(member?.role ?? 'OPERADOR');
  const [active, setActive] = useState(member?.active ?? true);
  const [busy, setBusy] = useState(false);
  const selected = roles.find((r) => r.role === role);
  const options = roles.filter((r) => r.assignable || r.role === member?.role);
  async function save() {
    setBusy(true);
    try {
      if (member) {
        await api.patch(`/admin/team/${member.id}`, { role, active });
        toast.ok('Membro atualizado.'); onClose();
      } else {
        const r = await api.post<{ member: Member; inviteSent: boolean }>('/admin/team', { name: name.trim(), email: email.trim().toLowerCase(), role });
        onClose({ email: r.member.email, inviteSent: r.inviteSent });
      }
    } catch (e) { toast.error(e instanceof Error && (e as { code?: string }).code === 'LAST_SUPER_ADMIN' ? 'Este é o último Super admin ativo; não pode ser rebaixado ou bloqueado.' : errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={member ? `Gerenciar — ${member.name}` : 'Novo membro da equipe'} onClose={() => onClose()}
      footer={<>{member && onAction && <Button variant="danger" onClick={() => onAction('remove')}>Remover</Button>}<span className="grow" /><Button variant="ghost" onClick={() => onClose()}>Cancelar</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email)} onClick={() => void save()}>{member ? 'Salvar' : 'Criar acesso'}</Button></>}>
      <div className="stack">
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={Boolean(member)} /></Field>
        <Field label="E-mail de acesso"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={Boolean(member)} maxLength={254} /></Field>
        <Field label="Nível de acesso">
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>{options.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select>
        </Field>
        {selected && <Alert tone="info" title={selected.label}>{selected.description}<ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{selected.can.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
        {member && <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Acesso liberado (desmarque para bloquear)" />}
        {member && onAction && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button size="sm" variant="ghost" icon="key" onClick={() => onAction('password')}>Enviar link de nova senha</Button>
            <Button size="sm" variant="ghost" icon="smartphone" onClick={() => onAction('2fa')}>Zerar verificação em 2 etapas</Button>
          </div>
        )}
        {!member && <p className="muted" style={{ fontSize: 13 }}>A pessoa recebe um convite por e-mail e cria a própria senha. A verificação em duas etapas é opcional.</p>}
      </div>
    </Modal>
  );
}
