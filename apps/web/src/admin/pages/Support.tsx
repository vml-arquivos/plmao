import { useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Badge, Button, EmptyState, ErrorState, PageLoading, Select, Tabs, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Card, PageHead } from '../parts';
import SupportChat from './SupportChat';

interface M { id: string; name: string; email: string; subject: string; message: string; category: string; status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED'; createdAt: string; closedAt: string | null }
const STATUS = { OPEN: { l: 'Aberto', t: 'warn' }, IN_PROGRESS: { l: 'Em atendimento', t: 'info' }, CLOSED: { l: 'Encerrado', t: 'ok' } } as const;
const CATEGORY: Record<string, string> = { SUPPORT: 'Suporte', PRIVACY: 'Privacidade', LGPD: 'LGPD', COMMERCIAL: 'Comercial' };

function ContactMessages() {
  const { can } = useAdminSession();
  const toast = useToast();
  const list = useAsync(() => api.get<M[]>('/admin/contact-messages'));
  const [status, setStatus] = useState('OPEN');
  const rows = (list.data ?? []).filter((m) => !status || m.status === status);
  async function set(m: M, s: M['status']) { try { await api.patch(`/admin/contact-messages/${m.id}`, { status: s }); toast.ok('Chamado atualizado.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }
  return (
    <>
      <p className="muted">Mensagens enviadas pelo formulário de contato. Solicitações de LGPD têm prazo legal: priorize.</p>
      <div className="toolbar"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos</option><option value="OPEN">Abertos</option><option value="IN_PROGRESS">Em atendimento</option><option value="CLOSED">Encerrados</option></Select><Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState icon="mail" title="Nenhuma mensagem" /> : (
        <div className="stack">{rows.map((m) => (
          <Card key={m.id} title={<span>{m.subject}</span>} actions={<><Badge tone={m.category === 'LGPD' || m.category === 'PRIVACY' ? 'danger' : 'neutral'}>{CATEGORY[m.category] ?? m.category}</Badge><Badge tone={STATUS[m.status].t} dot>{STATUS[m.status].l}</Badge></>}>
            <p className="muted" style={{ fontSize: 13 }}>{m.name} · <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>{m.email}</a> · {dateTime(m.createdAt)}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.message}</p>
            {can('MANAGE_USERS') && <div className="row">{m.status !== 'IN_PROGRESS' && m.status !== 'CLOSED' && <Button size="sm" onClick={() => void set(m, 'IN_PROGRESS')}>Iniciar atendimento</Button>}{m.status !== 'CLOSED' ? <Button size="sm" variant="primary" onClick={() => void set(m, 'CLOSED')}>Encerrar</Button> : <Button size="sm" variant="ghost" onClick={() => void set(m, 'OPEN')}>Reabrir</Button>}</div>}
          </Card>
        ))}</div>
      )}
    </>
  );
}

export default function Support() {
  usePageTitle('Suporte');
  const [tab, setTab] = useState<'chat' | 'form'>('chat');
  return (
    <>
      <PageHead title="Suporte" sub="Conversas dos clientes e mensagens do formulário de contato." />
      <Tabs label="Tipo de atendimento" value={tab} onChange={setTab} items={[{ id: 'chat', label: 'Chat' }, { id: 'form', label: 'Formulário de contato' }]} />
      {tab === 'chat' ? <SupportChat /> : <ContactMessages />}
    </>
  );
}
