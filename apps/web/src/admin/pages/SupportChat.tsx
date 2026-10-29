import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, EmptyState, ErrorState, PageLoading, Select, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { CATEGORY_LABEL, Composer, PRIORITY_LABEL, StatusBadge, Thread } from '../../shared/SupportThread';
import type { ThreadAttachment, ThreadMessage } from '../../shared/SupportThread';

interface Item { id: string; subject: string; category: string; status: string; priority: string; handler: string; assigned_to: string | null; assigned_name: string | null; last_message_at: string; client_name: string; unread: boolean }
interface Detail { id: string; subject: string; category: string; status: string; priority: string; handler: string; assignedTo: string | null; assignedName: string | null; relatedType: string | null; client: { name: string; email: string }; messages: ThreadMessage[]; attachments: ThreadAttachment[]; events: Array<{ event: string; created_at: string }> }
const EVENT: Record<string, string> = { PEDIU_ATENDENTE: 'Cliente pediu atendimento', RESPOSTA_DA_EQUIPE: 'Resposta enviada', NOTA_INTERNA: 'Nota interna', ATRIBUIDA: 'Atribuída', TRANSFERIDA: 'Transferida', ATRIBUICAO_REMOVIDA: 'Atribuição removida', STATUS_ALTERADO: 'Status alterado', PRIORIDADE_ALTERADA: 'Prioridade alterada', RESOLVIDA_PELO_CLIENTE: 'Resolvida pelo cliente', LIDA_PELA_EQUIPE: 'Aberta pela equipe' };
const PRIORITY_TONE = { BAIXA: 'neutral', NORMAL: 'neutral', ALTA: 'warn', URGENTE: 'danger' } as const;

function Case({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [error, setError] = useState<unknown>(null);
  const team = useAsync(() => api.get<{ items: Array<{ id: string; name: string }> }>('/admin/support/team'));
  const canned = useAsync(() => api.get<{ items: Array<{ id: string; title: string; body: string; active: boolean }> }>('/admin/support/canned'));
  const load = useCallback(async () => { try { setD(await api.get<Detail>(`/admin/support/conversations/${id}`)); setError(null); } catch (e) { setError(e); } }, [id]);
  useEffect(() => { setD(null); void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => window.clearInterval(t); }, [load]);
  if (error && !d) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!d) return <PageLoading />;
  const act = async (path: string, body: unknown, ok: string) => { try { await api.post(`/admin/support/conversations/${id}/${path}`, body); toast.ok(ok); await load(); onChanged(); } catch (e) { toast.error(errorMessage(e)); } };
  const closed = d.status === 'ENCERRADA';
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div><h3 style={{ fontSize: 17 }}>{d.subject}</h3><span className="muted" style={{ fontSize: 13 }}>{d.client.name} · {d.client.email} · {CATEGORY_LABEL[d.category] ?? d.category}{d.relatedType ? ` · vinculada a ${d.relatedType === 'QUERY' ? 'consulta' : 'pagamento'}` : ''}</span></div>
        <div className="row" style={{ gap: 6 }}><Badge tone={PRIORITY_TONE[d.priority as keyof typeof PRIORITY_TONE] ?? 'neutral'}>{PRIORITY_LABEL[d.priority] ?? d.priority}</Badge><StatusBadge status={d.status} /></div>
      </div>
      <div className="toolbar" style={{ margin: '10px 0' }}>
        <Select aria-label="Responsável" value={d.assignedTo ?? ''} onChange={(e) => void act('assign', { userId: e.target.value || null }, e.target.value ? 'Atribuída.' : 'Atribuição removida.')}>
          <option value="">Sem responsável</option>{(team.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select aria-label="Prioridade" value={d.priority} onChange={(e) => void act('priority', { priority: e.target.value }, 'Prioridade atualizada.')}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select aria-label="Alterar status" value="" disabled={closed} onChange={(e) => e.target.value && void act('status', { status: e.target.value }, 'Status atualizado.')}>
          <option value="">Alterar status…</option><option value="EM_ATENDIMENTO">Em atendimento</option><option value="AGUARDANDO_CLIENTE">Aguardando cliente</option><option value="RESOLVIDA">Resolvida</option><option value="ENCERRADA">Encerrada</option>
        </Select>
      </div>
      <Thread api={api} messages={d.messages} attachments={d.attachments} attachmentPath={(a) => `/admin/support/attachments/${a}`} staff />
      {closed && <Alert tone="info">Conversa encerrada: só é possível registrar notas internas.</Alert>}
      <Composer note quick={(canned.data?.items ?? []).filter((c) => c.active)} onQuick={(cid) => void api.post(`/admin/support/canned/${cid}/use`).catch(() => undefined)} placeholder="Resposta ao cliente (ou marque nota interna)" onSend={async (body, internal) => { await api.post(`/admin/support/conversations/${id}/messages`, { body, internal }); await load(); onChanged(); }} />
      <details style={{ marginTop: 12 }}><summary>Histórico de ações</summary><ul className="muted" style={{ fontSize: 13, paddingLeft: 18 }}>{d.events.map((e, i) => <li key={i}>{dateTime(e.created_at)} · {EVENT[e.event] ?? e.event}</li>)}</ul></details>
    </div>
  );
}

export default function SupportChat() {
  const [status, setStatus] = useState('AGUARDANDO_ATENDENTE'); const [assigned, setAssigned] = useState(''); const [priority, setPriority] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useAsync(() => api.get<{ items: Item[] }>('/admin/support/conversations', { query: { status, assigned, priority } }), [status, assigned, priority]);
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) list.reload(); }, 15000); return () => window.clearInterval(t); });
  const items = list.data?.items ?? [];
  return (
    <>
      <div className="toolbar">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos os status</option><option value="AGUARDANDO_ATENDENTE">Aguardando atendente</option><option value="EM_ATENDIMENTO">Em atendimento</option><option value="AGUARDANDO_CLIENTE">Aguardando cliente</option><option value="ABERTA">Com o assistente</option><option value="RESOLVIDA">Resolvidas</option><option value="ENCERRADA">Encerradas</option></Select>
        <Select aria-label="Responsável" value={assigned} onChange={(e) => setAssigned(e.target.value)}><option value="">Todos</option><option value="me">Minhas</option><option value="unassigned">Sem responsável</option></Select>
        <Select aria-label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Qualquer prioridade</option>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : (
        <div className="chat-layout">
          <ul className="chat-list" aria-label="Conversas">
            {!items.length && <li><EmptyState icon="mail" title="Nenhuma conversa" /></li>}
            {items.map((i) => (
              <li key={i.id}><button type="button" className="chat-item" aria-current={open === i.id} onClick={() => setOpen(i.id)}>
                <b>{i.unread && <span className="unread" aria-label="Não lida" />}{i.subject}</b>
                <small>{i.client_name} · {dateTime(i.last_message_at)}{i.assigned_name ? ` · ${i.assigned_name}` : ''}</small>
                <span className="row" style={{ gap: 6 }}><StatusBadge status={i.status} /><Badge tone={PRIORITY_TONE[i.priority as keyof typeof PRIORITY_TONE] ?? 'neutral'}>{PRIORITY_LABEL[i.priority] ?? i.priority}</Badge></span>
              </button></li>
            ))}
          </ul>
          <section aria-label="Atendimento">{open ? <Case id={open} onChanged={list.reload} /> : <EmptyState icon="mail" title="Selecione uma conversa" />}</section>
        </div>
      )}
    </>
  );
}
