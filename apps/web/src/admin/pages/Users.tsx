import { useMemo, useState } from 'react';
import { api, ROLE_LABEL } from '../api';
import { useAdminSession } from '../session';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money, num, parseMoneyToCents } from '../../shared/format';
import { PageHead } from '../parts';

interface U { id: string; name: string; email: string; role: string; active: boolean; createdAt: string; lastLoginAt: string | null; balanceCents: number; queriesCount: number }

export default function Users() {
  usePageTitle('Usuários');
  const { can, user: me } = useAdminSession();
  const toast = useToast();
  const list = useAsync(() => api.get<U[]>('/admin/users'));
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [adjust, setAdjust] = useState<U | null>(null);
  const [edit, setEdit] = useState<U | null>(null);
  const [del, setDel] = useState<U | null>(null);
  const rows = useMemo(() => (list.data ?? []).filter((u) => (!role || u.role === role) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, role]);
  const canAdjust = can('MANAGE_BILLING');
  return (
    <>
      <PageHead title="Usuários" sub="Clientes e equipe. Ajustes de saldo ficam registrados no extrato e na auditoria." />
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Perfil"><option value="">Todos os perfis</option>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState title="Nenhum usuário encontrado" icon="users" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Usuário</th><th>Perfil</th><th className="r">Saldo</th><th className="r">Consultas</th><th>Último acesso</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{u.email}</div></td>
              <td><Badge tone={u.role === 'CLIENTE' ? 'neutral' : 'violet'}>{ROLE_LABEL[u.role] ?? u.role}</Badge></td>
              <td className="r num">{money(u.balanceCents)}</td><td className="r num">{num(u.queriesCount)}</td><td>{dateTime(u.lastLoginAt)}</td>
              <td><Badge tone={u.active ? 'ok' : 'danger'} dot>{u.active ? 'Ativo' : 'Bloqueado'}</Badge></td>
              <td className="actions">
                {canAdjust && u.active && <Button size="sm" variant="ghost" onClick={() => setAdjust(u)}>Saldo</Button>}
                {can('MANAGE_USERS') && u.id !== me?.id && <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Editar</Button>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {adjust && <AdjustModal user={adjust} onClose={() => { setAdjust(null); list.reload(); }} />}
      {edit && <EditModal user={edit} canDelete={can('ADMIN_SYSTEM')} onDelete={() => { setDel(edit); setEdit(null); }} onClose={() => { setEdit(null); list.reload(); }} />}
      {del && <ConfirmDialog title="Excluir usuário" danger confirmLabel="Excluir" message={<p>Excluir <b>{del.name}</b> ({del.email})? A conta será desativada e as sessões encerradas. Esta ação é registrada na auditoria.</p>} onConfirm={async () => { try { await api.del(`/admin/users/${del.id}`); toast.ok('Usuário excluído.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }} onClose={() => setDel(null)} />}
    </>
  );
}

function AdjustModal({ user, onClose }: { user: U; onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseMoneyToCents(amount);
  async function save() {
    if (!cents) return;
    setBusy(true);
    try { await api.post(`/admin/users/${user.id}/wallet-adjustments`, { amountCents: kind === 'credit' ? cents : -cents, description: desc.trim() }); toast.ok('Saldo ajustado.'); onClose(); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={`Ajustar saldo — ${user.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!cents || desc.trim().length < 8} onClick={() => void save()}>Aplicar ajuste</Button></>}>
      <div className="stack">
        <p className="muted">Saldo atual: <b>{money(user.balanceCents)}</b></p>
        <div className="form-grid"><Field label="Tipo"><Select value={kind} onChange={(e) => setKind(e.target.value as 'credit' | 'debit')}><option value="credit">Crédito (adicionar)</option><option value="debit">Débito (remover)</option></Select></Field>
          <Field label="Valor (R$)"><Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
        <Field label="Motivo (mín. 8 caracteres)" hint="Aparece no extrato do cliente."><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} /></Field>
      </div>
    </Modal>
  );
}

function EditModal({ user, canDelete, onDelete, onClose }: { user: U; canDelete: boolean; onDelete: () => void; onClose: () => void }) {
  const toast = useToast();
  const { can } = useAdminSession();
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [busy, setBusy] = useState(false);
  const roles = ['CLIENTE', 'OPERADOR', ...(can('ADMIN_SYSTEM') ? ['ADMIN'] : [])];
  async function save() {
    setBusy(true);
    try { await api.patch(`/admin/users/${user.id}`, { role: role !== user.role ? role : undefined, active: active !== user.active ? active : undefined }); toast.ok('Usuário atualizado.'); onClose(); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  const changed = role !== user.role || active !== user.active;
  return (
    <Modal title={user.name} onClose={onClose} footer={<>{canDelete && <Button variant="danger" onClick={onDelete}>Excluir</Button>}<span className="grow" /><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} disabled={!changed} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <p className="muted">{user.email}</p>
        <Field label="Perfil"><Select value={role} onChange={(e) => setRole(e.target.value)} disabled={user.role === 'SUPER_ADMIN'}>{(roles.includes(user.role) ? roles : [user.role, ...roles]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}</Select></Field>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Conta ativa (desmarque para bloquear o acesso)" />
      </div>
    </Modal>
  );
}
