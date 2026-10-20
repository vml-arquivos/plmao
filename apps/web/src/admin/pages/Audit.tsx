import { useMemo, useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, num } from '../../shared/format';
import { PageHead } from '../parts';

interface A { id: string; action: string; entity: string | null; entityId: string | null; createdAt: string; actor: { name: string; email: string } | null }
const sensitive = /PII_REVEAL|WALLET_ADJUSTMENT|MARK_PAID|PRICE|SETTINGS|DELETE|FISCAL|TOTP|PASSWORD/;

export default function Audit() {
  usePageTitle('Auditoria');
  const { can } = useAdminSession();
  const list = useAsync(() => api.get<A[]>('/admin/audit'));
  const [q, setQ] = useState('');
  const [retention, setRetention] = useState(false);
  const rows = useMemo(() => (list.data ?? []).filter((a) => !q || `${a.action} ${a.entity ?? ''} ${a.actor?.email ?? ''} ${a.entityId ?? ''}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  return (
    <>
      <PageHead title="Auditoria" sub="Últimos 200 eventos. Registros nunca guardam dados pessoais revelados." actions={can('ADMIN_SYSTEM') && <Button icon="trash" onClick={() => setRetention(true)}>Retenção</Button>} />
      <div className="toolbar"><div className="grow"><Input icon="search" placeholder="Filtrar por ação, entidade ou usuário" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar" /></div><Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Quando</th><th>Ação</th><th>Entidade</th><th>Responsável</th></tr></thead><tbody>
          {rows.map((a) => <tr key={a.id}><td>{dateTime(a.createdAt)}</td><td><Badge tone={sensitive.test(a.action) ? 'warn' : 'neutral'}>{a.action}</Badge></td><td>{a.entity ?? '—'}{a.entityId && <div className="muted mono" style={{ fontSize: 11.5 }}>{a.entityId.slice(0, 24)}</div>}</td><td>{a.actor ? <>{a.actor.name}<div className="muted" style={{ fontSize: 12 }}>{a.actor.email}</div></> : <span className="muted">Sistema</span>}</td></tr>)}
          {!rows.length && <tr><td colSpan={4} className="muted">Nenhum evento encontrado.</td></tr>}
        </tbody></table></div>
      )}
      {retention && <RetentionModal onClose={() => { setRetention(false); list.reload(); }} />}
    </>
  );
}

function RetentionModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState('365');
  const [res, setRes] = useState<{ dryRun: boolean; candidateCount?: number; deletedCount?: number; cutoffAt: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(execute: boolean) {
    setBusy(true);
    try { const r = await api.post<NonNullable<typeof res>>('/admin/audit/retention', { olderThanDays: Number(days), execute }); setRes(r); if (execute) toast.ok(`${num(r.deletedCount ?? 0)} registros removidos.`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Retenção da auditoria" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button loading={busy} onClick={() => void run(false)}>Simular</Button><Button variant="danger" disabled={!confirm || !res?.dryRun || !res.candidateCount} loading={busy} onClick={() => void run(true)}>Excluir</Button></>}>
      <div className="stack">
        <Alert tone="warn">Remove definitivamente eventos mais antigos que o prazo. Mínimo de 180 dias. A execução fica registrada.</Alert>
        <Field label="Remover registros com mais de (dias)"><Select value={days} onChange={(e) => { setDays(e.target.value); setRes(null); setConfirm(false); }}>{['180', '365', '730', '1095', '1825'].map((d) => <option key={d} value={d}>{d} dias</option>)}</Select></Field>
        {res && <p>{res.dryRun ? <>Simulação: <b>{num(res.candidateCount ?? 0)}</b> registro(s) anteriores a {dateTime(res.cutoffAt)}.</> : <>Removidos: <b>{num(res.deletedCount ?? 0)}</b>.</>}</p>}
        {res?.dryRun && !!res.candidateCount && <Switch checked={confirm} onChange={(e) => setConfirm(e.target.checked)} label="Entendo que a exclusão é irreversível" />}
      </div>
    </Modal>
  );
}
