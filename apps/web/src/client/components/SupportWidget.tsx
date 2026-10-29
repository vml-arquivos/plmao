import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { Icon } from '../../shared/icons';
import { errorMessage } from '../../shared/api';

interface Msg { id: string; sender_type: 'CLIENTE' | 'BOT' | 'ATENDENTE' | 'SISTEMA'; body: string }
interface Detail { id: string; status: string; handler: 'BOT' | 'HUMAN'; messages: Msg[] }
interface Item { id: string; status: string; unread: boolean }
const CHIPS = ['Quanto custa?', 'O que vem na consulta completa?', 'Minha consulta não chegou', 'Como funciona a FIPE?'];
const HIDE = /^\/(app\/suporte|contrato|documento-fiscal|validar)/;
const lastOpen = (items: Item[]) => items.find((i) => !['RESOLVIDA', 'ENCERRADA'].includes(i.status)) ?? null;

/** Chat de suporte no canto da tela (site e app). Visitante fala com a assistente; quem está logado tem conversa salva e pode chamar a equipe. */
export default function SupportWidget() {
  const { pathname } = useLocation();
  const logged = useSession().status === 'authed';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Renata');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [handler, setHandler] = useState<'BOT' | 'HUMAN'>('BOT');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [unread, setUnread] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void api.get<{ name: string }>('/support/assistant/info').then((r) => setName(r.name)).catch(() => undefined); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, busy, open]);
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => { const k = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);

  const load = useCallback(async (id: string) => {
    const d = await api.get<Detail>(`/support/conversations/${id}`);
    setMsgs(d.messages); setHandler(d.handler); setStatus(d.status);
    if (['RESOLVIDA', 'ENCERRADA'].includes(d.status)) setConvId(null);
  }, []);

  // Quem está logado retoma a conversa aberta; sem conversa, começa uma nova na primeira mensagem.
  useEffect(() => {
    if (!logged) { setConvId(null); setMsgs([]); setNeedsLogin(false); return; }
    let live = true;
    const pull = async () => {
      try {
        const { items } = await api.get<{ items: Item[] }>('/support/conversations');
        const c = lastOpen(items); if (!live) return;
        setUnread(!open && !!c?.unread);
        if (c && open) { setConvId(c.id); await load(c.id); }
      } catch { /* sem rede: tenta de novo no próximo ciclo */ }
    };
    void pull();
    const t = window.setInterval(() => { if (!document.hidden) void pull(); }, open ? 6000 : 60000);
    return () => { live = false; window.clearInterval(t); };
  }, [logged, open, load]);

  async function send(raw: string) {
    const body = raw.trim(); if (!body || busy) return;
    setBusy(true); setErr(''); setText('');
    const mine: Msg = { id: `l${Date.now()}`, sender_type: 'CLIENTE', body };
    setMsgs((m) => [...m, mine]);
    try {
      if (logged) {
        const d = convId
          ? (await api.post(`/support/conversations/${convId}/messages`, { body }), await api.get<Detail>(`/support/conversations/${convId}`))
          : await api.post<Detail>('/support/conversations', { subject: body.slice(0, 80) || 'Chat', category: 'DUVIDA', message: body });
        setConvId(d.id); setMsgs(d.messages); setHandler(d.handler); setStatus(d.status);
      } else {
        const r = await api.post<{ text: string; needsLogin: boolean }>('/support/assistant', { message: body, route: pathname });
        setMsgs((m) => [...m, { id: `b${Date.now()}`, sender_type: 'BOT', body: r.text }]); setNeedsLogin(r.needsLogin);
      }
    } catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function human() {
    if (!convId) { await send('Quero falar com uma pessoa'); return; }
    try { await api.post(`/support/conversations/${convId}/human`); await load(convId); } catch (e) { setErr(errorMessage(e)); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void send(text); };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } };

  if (HIDE.test(pathname)) return null;
  const who = (t: Msg['sender_type']) => (t === 'BOT' ? name : t === 'ATENDENTE' ? 'Equipe' : t === 'SISTEMA' ? 'Aviso' : 'Você');
  const closed = status === 'ENCERRADA';
  return (
    <div className={`sw${pathname.startsWith('/app') ? ' in-app' : ''}`}>
      {open && (
        <section className="sw-panel" role="dialog" aria-label={`Chat com ${name}`}>
          <header className="sw-head">
            <span className="sw-avatar" aria-hidden="true">{name.slice(0, 1)}</span>
            <div><b>{handler === 'HUMAN' ? 'Equipe Placa na Mão' : name}</b><small>{handler === 'HUMAN' ? (status === 'EM_ATENDIMENTO' ? 'Em atendimento' : 'Aguardando atendente') : 'Assistente virtual da Placa na Mão'}</small></div>
            <button type="button" className="sw-x" aria-label="Fechar chat" onClick={() => setOpen(false)}><Icon name="x" size={18} /></button>
          </header>
          <div className="sw-body" role="log" aria-live="polite">
            {msgs.length === 0 && <div className="sw-msg from-bot"><span>{name}</span><p>Oi! Sou {name}, assistente virtual da Placa na Mão. Posso explicar as consultas e os preços, ver o status da sua consulta ou chamar a equipe. Como posso ajudar?</p></div>}
            {msgs.map((m) => <div key={m.id} className={`sw-msg from-${m.sender_type.toLowerCase()}`}><span>{who(m.sender_type)}</span><p>{m.body}</p></div>)}
            {busy && <div className="sw-msg from-bot"><span>{name}</span><p className="sw-typing" aria-label="Digitando"><i /><i /><i /></p></div>}
            {err && <p role="alert" className="sw-err">{err}</p>}
            {needsLogin && <p className="sw-login"><Link to="/entrar" onClick={() => setOpen(false)}>Entrar</Link> ou <Link to="/criar-conta" onClick={() => setOpen(false)}>criar conta</Link> para falar com a equipe.</p>}
            <div ref={end} />
          </div>
          {msgs.length < 2 && <div className="sw-chips">{CHIPS.map((c) => <button key={c} type="button" onClick={() => void send(c)}>{c}</button>)}</div>}
          {closed ? <p className="sw-closed">Conversa encerrada.</p> : (
            <form className="sw-form" onSubmit={submit}>
              {logged && handler === 'BOT' && <button type="button" className="sw-human" onClick={() => void human()}>Falar com uma pessoa</button>}
              <div className="sw-row">
                <label className="sr-only" htmlFor="sw-text">Mensagem</label>
                <textarea id="sw-text" ref={input} rows={1} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} placeholder="Escreva sua dúvida" />
                <button type="submit" className="sw-send" aria-label="Enviar" disabled={busy || !text.trim()}><Icon name="send" size={18} /></button>
              </div>
              <p className="sw-hint">Não envie senhas nem dados de cartão.</p>
            </form>
          )}
        </section>
      )}
      <button type="button" className="sw-bubble" aria-label={open ? 'Fechar chat de suporte' : `Abrir chat de suporte com ${name}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'x' : 'message-circle'} size={26} />{unread && !open && <i className="sw-dot" aria-label="Nova mensagem" />}
      </button>
    </div>
  );
}
