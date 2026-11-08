import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Check, Field, Input } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { api } from '../api';
import { attribution, funnelSessionId } from '../funnel';
import { useSession } from '../session';

export type LeadTool = 'SIMULADOR' | 'FIPE' | 'CONSULTA' | 'COMPARAR' | 'COMBUSTIVEL' | 'GUIA' | 'SITE';
const DONE_KEY = 'pnm_lead_done';
const doneBefore = (): boolean => { try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch { return false; } };
const maskPhone = (v: string): string => { const d = v.replace(/\D/g, '').slice(0, 11); return d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : d.replace(/^(\d{2})(\d{0,4})(\d{0,4})$/, (_m, a: string, b: string, c: string) => (b ? `(${a}) ${b}${c ? `-${c}` : ''}` : a)); };

/**
 * Convite discreto para deixar o contato depois de usar uma ferramenta do site. Nada é obrigatório:
 * o aceite de receber novidades vem desmarcado e só vale se a pessoa marcar. Quem já está logado não vê.
 */
export default function LeadCapture({ tool, interest, title = 'Quer receber o resultado e dicas para negociar?', text = 'Deixe seu contato e a gente envia o resumo e avisa quando houver novidade sobre consulta de veículos.' }: { tool: LeadTool; interest?: string; title?: string; text?: string }) {
  const { status } = useSession();
  const [f, setF] = useState({ name: '', email: '', phone: '', consent: false, website: '' });
  const [state, setState] = useState<'idle' | 'busy' | 'done'>(() => (doneBefore() ? 'done' : 'idle'));
  const [error, setError] = useState('');
  if (status === 'authed') return null;
  const hasContact = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) || f.phone.replace(/\D/g, '').length >= 10;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hasContact) { setError('Informe um e-mail válido ou um WhatsApp com DDD.'); return; }
    setState('busy'); setError('');
    try {
      await api.post('/leads/capture', {
        tool, ...(interest ? { interest: interest.slice(0, 160) } : {}), consent: f.consent, sessionId: funnelSessionId(), utm: attribution(),
        ...(f.name.trim() ? { name: f.name.trim() } : {}), ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.website ? { website: f.website } : {})
      });
      try { sessionStorage.setItem(DONE_KEY, '1'); } catch { /* ignora */ }
      setState('done');
    } catch (err) { setError(errorMessage(err)); setState('idle'); }
  }
  if (state === 'done') return <aside className="card card-pad lead-cap" aria-live="polite"><b>Pronto, guardamos o seu contato.</b><p className="muted" style={{ margin: '4px 0 0' }}>Se marcou que aceita receber novidades, você pode sair quando quiser pelo link no e-mail.</p></aside>;
  return (
    <aside className="card card-pad lead-cap" aria-label="Receber por e-mail ou WhatsApp">
      <form onSubmit={submit} noValidate className="stack-sm">
        <div><b>{title}</b><p className="muted" style={{ margin: '4px 0 0' }}>{text}</p></div>
        <div className="form-grid cols-3">
          <Field label="Nome (opcional)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" maxLength={120} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => { setF({ ...f, email: e.target.value }); setError(''); }} autoComplete="email" /></Field>
          <Field label="WhatsApp (opcional)"><Input value={f.phone} onChange={(e) => { setF({ ...f, phone: maskPhone(e.target.value) }); setError(''); }} inputMode="tel" autoComplete="tel" placeholder="(61) 99999-9999" /></Field>
        </div>
        <input type="text" name="website" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
        <Check checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })}>Quero receber dicas, novidades e ofertas da Placa na Mão por e-mail e WhatsApp (opcional). Posso cancelar quando quiser.</Check>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button type="submit" variant="primary" loading={state === 'busy'}>Enviar</Button>
          <span className="muted" style={{ fontSize: 12.5 }}>Usamos seus dados só para isso. Veja a <Link to="/privacidade">Política de Privacidade</Link>.</span>
        </div>
      </form>
    </aside>
  );
}
