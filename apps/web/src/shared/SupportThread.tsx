import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Button, Textarea } from './ui';
import { dateTime } from './format';
import { errorMessage } from './api';
import type { Api } from './api';

export interface ThreadMessage { id: string; sender_type: 'CLIENTE' | 'BOT' | 'ATENDENTE' | 'SISTEMA'; body: string; created_at: string; internal?: boolean; sender_name?: string | null }
export interface ThreadAttachment { id: string; message_id: string | null; file_name: string; mime: string; size_bytes: number }

export const STATUS_LABEL: Record<string, { l: string; t: 'ok' | 'warn' | 'info' | 'neutral' }> = {
  ABERTA: { l: 'Aberta', t: 'info' }, AGUARDANDO_ATENDENTE: { l: 'Aguardando atendente', t: 'warn' }, EM_ATENDIMENTO: { l: 'Em atendimento', t: 'info' },
  AGUARDANDO_CLIENTE: { l: 'Aguardando você', t: 'warn' }, RESOLVIDA: { l: 'Resolvida', t: 'ok' }, ENCERRADA: { l: 'Encerrada', t: 'neutral' }
};
export const CATEGORY_LABEL: Record<string, string> = { DUVIDA: 'Dúvida', CONSULTA: 'Consulta', PAGAMENTO: 'Pagamento', CONTA: 'Conta', OUTRO: 'Outro' };
export const PRIORITY_LABEL: Record<string, string> = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };
const WHO: Record<string, string> = { CLIENTE: 'Você', BOT: 'Assistente automático', ATENDENTE: 'Equipe', SISTEMA: 'Aviso' };

export function StatusBadge({ status }: { status: string }) { const s = STATUS_LABEL[status] ?? { l: status, t: 'neutral' as const }; return <Badge tone={s.t} dot>{s.l}</Badge>; }

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Thread({ api, messages, attachments, attachmentPath, staff }: { api: Api; messages: ThreadMessage[]; attachments: ThreadAttachment[]; attachmentPath: (id: string) => string; staff?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  const [err, setErr] = useState('');
  const get = async (a: ThreadAttachment) => { try { setErr(''); await api.download(attachmentPath(a.id), a.file_name); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <div className="chat-thread" role="log" aria-live="polite" aria-label="Mensagens da conversa">
      {messages.map((m) => (
        <div key={m.id} className={`chat-msg from-${m.sender_type.toLowerCase()}${m.internal ? ' internal' : ''}`}>
          <div className="chat-meta"><b>{staff && m.sender_type === 'ATENDENTE' && m.sender_name ? m.sender_name : staff && m.sender_type === 'CLIENTE' ? 'Cliente' : WHO[m.sender_type]}</b>{m.internal && <span className="chat-tag">Nota interna</span>}<time dateTime={m.created_at}>{dateTime(m.created_at)}</time></div>
          <p>{m.body}</p>
          {attachments.filter((a) => a.message_id === m.id).map((a) => <button key={a.id} type="button" className="chat-file" onClick={() => void get(a)}>{a.file_name} · {kb(a.size_bytes)}</button>)}
        </div>
      ))}
      {attachments.filter((a) => !a.message_id).map((a) => <button key={a.id} type="button" className="chat-file" onClick={() => void get(a)}>{a.file_name} · {kb(a.size_bytes)}</button>)}
      {err && <p role="alert" className="chat-err">{err}</p>}
      <div ref={end} />
    </div>
  );
}

export function Composer({ onSend, onFile, disabled, note, placeholder }: { onSend: (body: string, internal: boolean) => Promise<void>; onFile?: (f: File) => Promise<void>; disabled?: boolean; note?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    try { await onSend(text.trim(), internal); setText(''); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); }
  };
  const pick = async (f?: File) => { if (!f || !onFile) return; setBusy(true); setErr(''); try { await onFile(f); } catch (x) { setErr(errorMessage(x)); } finally { setBusy(false); } };
  return (
    <form className="chat-composer" onSubmit={(e) => void submit(e)}>
      <label className="sr-only" htmlFor="chat-text">Mensagem</label>
      <Textarea id="chat-text" rows={3} maxLength={2000} value={text} disabled={disabled || busy} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? 'Escreva sua mensagem'} />
      {err && <p role="alert" className="chat-err">{err}</p>}
      <div className="chat-actions">
        {onFile && <label className="btn btn-ghost btn-sm chat-attach">Anexar<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={disabled || busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
        {note && <label className="chat-note"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nota interna (o cliente não vê)</label>}
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={disabled || !text.trim()}>{internal ? 'Salvar nota' : 'Enviar'}</Button>
      </div>
      {onFile && <p className="chat-hint">Imagem (PNG, JPG, WebP) ou PDF, até 2 MB. Não envie senhas nem dados de cartão.</p>}
    </form>
  );
}
