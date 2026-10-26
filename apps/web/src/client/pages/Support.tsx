import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Button, EmptyState, ErrorState, Field, Input, PageLoading, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import SupportChannels from '../components/SupportChannels';
import { CATEGORY_LABEL, Composer, StatusBadge, Thread } from '../../shared/SupportThread';
import type { ThreadAttachment, ThreadMessage } from '../../shared/SupportThread';

interface Item { id: string; subject: string; category: string; status: string; handler: string; last_message_at: string; unread: boolean }
interface Detail { id: string; subject: string; category: string; status: string; handler: 'BOT' | 'HUMAN'; messages: ThreadMessage[]; attachments: ThreadAttachment[] }
const RELATED = new Set(['QUERY', 'PAYMENT']);

function NewConversation({ onCreated, related }: { onCreated: (id: string) => void; related: { type: string; id: string } | null }) {
  const toast = useToast();
  const [subject, setSubject] = useState(''); const [category, setCategory] = useState('DUVIDA'); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post<{ id: string }>('/support/conversations', { subject, category, message, ...(related ? { related } : {}) }); onCreated(r.id); } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <h2 style={{ fontSize: 18 }}>Nova conversa</h2>
      {related && <Alert tone="info">Esta conversa ficará ligada ao item selecionado da sua conta.</Alert>}
      <Field label="Assunto"><Input value={subject} onChange={(e) => setSubject(e.target.value)} minLength={3} maxLength={120} required /></Field>
      <Field label="Tema"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Sua mensagem" hint="Não informe senhas nem número de cartão."><Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} minLength={2} maxLength={2000} required /></Field>
      <div><Button type="submit" variant="primary" loading={busy}>Enviar</Button></div>
    </form>
  );
}

function Conversation({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => { try { setD(await api.get<Detail>(`/support/conversations/${id}`)); setError(null); } catch (e) { setError(e); } }, [id]);
  useEffect(() => { setD(null); void load(); const t = window.setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => window.clearInterval(t); }, [load]);
  if (error && !d) return <ErrorState error={error} onRetry={() => void load()} />;
  if (!d) return <PageLoading />;
  const closed = d.status === 'ENCERRADA';
  const act = async (path: string, ok: string) => { try { await api.post(`/support/conversations/${id}/${path}`); toast.ok(ok); await load(); onChanged(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div><h2 style={{ fontSize: 18 }}>{d.subject}</h2><span className="muted" style={{ fontSize: 13 }}>{CATEGORY_LABEL[d.category] ?? d.category}</span></div>
        <StatusBadge status={d.status} />
      </div>
      <Thread api={api} messages={d.messages} attachments={d.attachments} attachmentPath={(a) => `/support/attachments/${a}`} />
      {closed ? <Alert tone="info">Esta conversa foi encerrada. Abra uma nova para continuar.</Alert> : (
        <>
          <div className="row" style={{ gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
            {d.handler === 'BOT' && <Button onClick={() => void act('human', 'Pedido enviado à equipe.')}>Falar com uma pessoa</Button>}
            {d.status !== 'RESOLVIDA' && <Button variant="ghost" onClick={() => void act('resolve', 'Conversa resolvida.')}>Marcar como resolvida</Button>}
          </div>
          <Composer
            onSend={async (body) => { await api.post(`/support/conversations/${id}/messages`, { body }); await load(); onChanged(); }}
            onFile={async (f) => { await api.upload(`/support/conversations/${id}/attachments`, f, { name: f.name }); await load(); }}
          />
        </>
      )}
    </div>
  );
}

export default function Support() {
  usePageTitle('Suporte');
  const [params, setParams] = useSearchParams();
  const list = useAsync(() => api.get<{ items: Item[] }>('/support/conversations'));
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const type = params.get('tipo')?.toUpperCase() ?? ''; const rid = params.get('id') ?? '';
  const related = RELATED.has(type) && rid ? { type, id: rid } : null;
  const items = list.data?.items ?? [];
  useEffect(() => { if (related) setOpen('new'); }, [related?.type, related?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open && !related && items.length) setOpen(items[0].id); }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = window.setInterval(() => { if (!document.hidden) list.reload(); }, 20000); return () => window.clearInterval(t); }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div><h1 style={{ fontSize: 24 }}>Suporte</h1><SupportChannels inline /></div>
        <Button variant="primary" onClick={() => { setOpen('new'); }}>Nova conversa</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : (
        <div className="chat-layout">
          <ul className="chat-list" aria-label="Suas conversas">
            {!items.length && <li><EmptyState icon="mail" title="Nenhuma conversa" /></li>}
            {items.map((i) => (
              <li key={i.id}><button type="button" className="chat-item" aria-current={open === i.id} onClick={() => setOpen(i.id)}>
                <b>{i.unread && <span className="unread" aria-label="Nova mensagem" />}{i.subject}</b>
                <small>{CATEGORY_LABEL[i.category] ?? i.category} · {dateTime(i.last_message_at)}</small>
                <StatusBadge status={i.status} />
              </button></li>
            ))}
          </ul>
          <section aria-label="Conversa">
            {open === 'new' || (!open && !items.length) ? <NewConversation related={related} onCreated={(id) => { setParams({}, { replace: true }); setOpen(id); list.reload(); }} /> : open ? <Conversation id={open} onChanged={list.reload} /> : null}
          </section>
        </div>
      )}
    </div>
  );
}
