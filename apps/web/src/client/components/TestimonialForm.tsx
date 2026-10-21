import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Alert, Button, Check, Field, Input, Select, Textarea, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';

interface Mine { eligible: boolean; consentText: string; testimonial: { status: string; displayName: string; body: string; rating: number | null } | null }
const STATUS: Record<string, string> = { PENDENTE: 'Em análise. Ainda não aparece no site.', APROVADO: 'Aprovado. Será publicado em breve.', PUBLICADO: 'Publicado no site.', OCULTO: 'Temporariamente fora do ar.' };

export default function TestimonialForm() {
  const toast = useToast();
  const mine = useAsync(() => api.get<Mine>('/testimonials/mine'));
  const [form, setForm] = useState<{ displayName: string; body: string; rating: string; consent: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = mine.data;
  if (!d || !d.eligible) return null;
  const t = d.testimonial;
  const f = form ?? { displayName: t?.displayName ?? '', body: t?.body ?? '', rating: t?.rating ? String(t.rating) : '', consent: false };
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.put('/testimonials/mine', { displayName: f.displayName, body: f.body, rating: f.rating ? Number(f.rating) : null, consent: true }); toast.ok('Depoimento enviado para análise.'); setForm(null); mine.reload(); } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  async function withdraw() {
    setBusy(true);
    try { await api.del('/testimonials/mine'); toast.ok('Depoimento removido.'); setForm(null); mine.reload(); } catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  return (
    <form className="card card-pad stack" onSubmit={(e) => void save(e)}>
      <h2 style={{ fontSize: 18 }}>Seu depoimento</h2>
      <p className="muted" style={{ fontSize: 14 }}>Opcional. Só é publicado depois da sua autorização e da aprovação da equipe.</p>
      {t && <Alert tone={t.status === 'PUBLICADO' ? 'ok' : 'info'}>{STATUS[t.status] ?? t.status} Se você editar, ele sai do ar e volta para análise.</Alert>}
      <Field label="Nome que aparecerá" hint="Pode ser só o primeiro nome ou um apelido."><Input value={f.displayName} onChange={(e) => set({ displayName: e.target.value })} minLength={2} maxLength={80} required /></Field>
      <Field label="Depoimento" hint="De 10 a 500 caracteres. Sem links, e-mails ou telefones."><Textarea rows={4} value={f.body} onChange={(e) => set({ body: e.target.value })} minLength={10} maxLength={500} required /></Field>
      <Field label="Nota (opcional)"><Select value={f.rating} onChange={(e) => set({ rating: e.target.value })}><option value="">Sem nota</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} de 5</option>)}</Select></Field>
      <Check checked={f.consent} onChange={(e) => set({ consent: e.target.checked })}>{d.consentText}</Check>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button type="submit" variant="primary" loading={busy} disabled={!f.consent}>{t ? 'Atualizar e reenviar' : 'Enviar depoimento'}</Button>
        {t && <Button type="button" variant="ghost" disabled={busy} onClick={() => void withdraw()}>Retirar meu depoimento</Button>}
      </div>
    </form>
  );
}
