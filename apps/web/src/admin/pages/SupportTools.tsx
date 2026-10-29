import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, Field, Input, PageLoading, Select, Textarea, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Card, Kpi } from '../parts';

// ---------------------------------------------------------------- visão geral

interface Stats { waiting: number; inProgress: number; waitingClient: number; open: number; week: { total: number; bot_only: number }; categories: Array<{ category: string; n: number }>; openProblems: number; topProblems: Array<{ id: string; title: string; severity: string; occurrences: number; users_affected: number; last_seen: string }> }
const CAT: Record<string, string> = { DUVIDA: 'Dúvida', PAGAMENTO: 'Pagamento', CONSULTA: 'Consulta', CONTA: 'Conta', LGPD: 'LGPD', OUTRO: 'Outro' };

export function SupportOverview() {
  const s = useAsync(() => api.get<Stats>('/admin/support/stats'));
  if (s.loading && !s.data) return <PageLoading />;
  if (s.error && !s.data) return <ErrorState error={s.error} onRetry={s.reload} />;
  const d = s.data!;
  const botPct = d.week.total ? Math.round((d.week.bot_only / d.week.total) * 100) : 0;
  return (
    <div className="stack">
      <div className="kpis">
        <Kpi label="Aguardando atendente" value={d.waiting} tone={d.waiting ? 'warn' : undefined} />
        <Kpi label="Em atendimento" value={d.inProgress} />
        <Kpi label="Aguardando cliente" value={d.waitingClient} />
        <Kpi label="Conversas na semana" value={d.week.total} sub={`${botPct}% resolvidas só pela assistente`} />
        <Kpi label="Problemas abertos" value={d.openProblems} tone={d.openProblems ? 'danger' : 'ok'} />
      </div>
      <Card title="Assuntos mais procurados (30 dias)">
        {d.categories.length ? <ul className="plain">{d.categories.map((c) => <li key={c.category}>{CAT[c.category] ?? c.category}: <b>{c.n}</b></li>)}</ul> : <p className="muted">Sem conversas no período.</p>}
      </Card>
      <Card title="Problemas que mais se repetem">
        {d.topProblems.length ? <ul className="plain">{d.topProblems.map((p) => <li key={p.id}><Badge tone={p.severity === 'ALTA' ? 'danger' : 'warn'}>{p.severity === 'ALTA' ? 'Alta' : 'Média'}</Badge> {p.title} · <b>{p.occurrences}x</b>{p.users_affected ? ` · ${p.users_affected} cliente(s)` : ''} · {dateTime(p.last_seen)}</li>)}</ul> : <p className="muted">Nenhum problema aberto.</p>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- problemas relatados

interface Problem { id: string; source: string; severity: 'BAIXA' | 'MEDIA' | 'ALTA'; title: string; route: string | null; status: string; occurrences: number; users_affected: number; conversation_id: string | null; note: string | null; detail: Record<string, unknown>; first_seen: string; last_seen: string }
const SRC: Record<string, string> = { CHAT: 'Chat', NAVEGADOR: 'Erro de tela', CONSULTA: 'Consulta' };
const PSTATUS: Record<string, string> = { ABERTO: 'Aberto', EM_ANALISE: 'Em análise', RESOLVIDO: 'Resolvido', IGNORADO: 'Ignorado' };

export function SupportProblems() {
  const toast = useToast();
  const [status, setStatus] = useState('ABERTO');
  const list = useAsync(() => api.get<{ items: Problem[] }>('/admin/support/problems', { query: { status } }), [status]);
  async function set(p: Problem, body: Record<string, string>) { try { await api.patch(`/admin/support/problems/${p.id}`, body); toast.ok('Atualizado.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }
  const items = list.data?.items ?? [];
  return (
    <>
      <p className="muted">Erros de tela, consultas travadas e problemas contados no chat, agrupados por repetição. Dados pessoais são removidos antes de salvar.</p>
      <div className="toolbar"><Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(PSTATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !items.length ? <EmptyState icon="shield-check" title="Nenhum problema" /> : (
        <div className="stack">{items.map((p) => (
          <Card key={p.id} title={p.title} actions={<><Badge tone={p.severity === 'ALTA' ? 'danger' : p.severity === 'MEDIA' ? 'warn' : 'neutral'}>{p.severity === 'ALTA' ? 'Alta' : p.severity === 'MEDIA' ? 'Média' : 'Baixa'}</Badge><Badge tone="info">{SRC[p.source] ?? p.source}</Badge><Badge tone={p.status === 'RESOLVIDO' ? 'ok' : 'neutral'} dot>{PSTATUS[p.status] ?? p.status}</Badge></>}>
            <p className="muted" style={{ fontSize: 13 }}>{p.occurrences}x · {p.users_affected} cliente(s) · primeira vez {dateTime(p.first_seen)} · última {dateTime(p.last_seen)}{p.route ? ` · ${p.route}` : ''}</p>
            {Object.keys(p.detail ?? {}).length > 0 && <details><summary>Detalhes técnicos</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(p.detail, null, 2)}</pre></details>}
            {p.note && <p><b>Nota:</b> {p.note}</p>}
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {p.status !== 'EM_ANALISE' && p.status !== 'RESOLVIDO' && <Button size="sm" onClick={() => void set(p, { status: 'EM_ANALISE' })}>Em análise</Button>}
              {p.status !== 'RESOLVIDO' && <Button size="sm" variant="primary" onClick={() => void set(p, { status: 'RESOLVIDO' })}>Marcar resolvido</Button>}
              {p.status !== 'IGNORADO' && p.status !== 'RESOLVIDO' && <Button size="sm" variant="ghost" onClick={() => void set(p, { status: 'IGNORADO' })}>Ignorar</Button>}
              {p.status !== 'ABERTO' && <Button size="sm" variant="ghost" onClick={() => void set(p, { status: 'ABERTO' })}>Reabrir</Button>}
            </div>
          </Card>
        ))}</div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- respostas prontas

interface Canned { id: string; title: string; body: string; category: string; active: boolean; use_count: number }
const CCAT = ['GERAL', 'CONSULTA', 'PAGAMENTO', 'CONTA', 'LGPD'];

export function SupportCanned() {
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: Canned[] }>('/admin/support/canned'));
  const [edit, setEdit] = useState<Canned | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', body: '', category: 'GERAL' });
  const [busy, setBusy] = useState(false); const [del, setDel] = useState('');
  const start = (c: Canned | 'new') => { setEdit(c); setForm(c === 'new' ? { title: '', body: '', category: 'GERAL' } : { title: c.title, body: c.body, category: c.category }); };
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { if (edit === 'new') await api.post('/admin/support/canned', form); else if (edit) await api.patch(`/admin/support/canned/${edit.id}`, form); toast.ok('Resposta salva.'); setEdit(null); list.reload(); }
    catch (x) { toast.error(errorMessage(x)); } finally { setBusy(false); }
  }
  async function toggle(c: Canned) { try { await api.patch(`/admin/support/canned/${c.id}`, { active: !c.active }); list.reload(); } catch (x) { toast.error(errorMessage(x)); } }
  async function remove(c: Canned) { if (del !== c.id) { setDel(c.id); return; } try { await api.del(`/admin/support/canned/${c.id}`); setDel(''); toast.ok('Apagada.'); list.reload(); } catch (x) { toast.error(errorMessage(x)); } }
  const items = list.data?.items ?? [];
  return (
    <>
      <p className="muted">Textos prontos que aparecem em "Resposta pronta…" dentro do atendimento. Escolha, ajuste se precisar e envie.</p>
      <div className="toolbar"><Button variant="primary" icon="plus" onClick={() => start('new')}>Nova resposta</Button></div>
      {edit && (
        <form className="stack" onSubmit={(e) => void save(e)} style={{ marginBottom: 16 }}>
          <Field label="Título"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={80} required /></Field>
          <Field label="Tema"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CCAT.map((c) => <option key={c} value={c}>{CAT[c] ?? (c === 'GERAL' ? 'Geral' : c)}</option>)}</Select></Field>
          <Field label="Texto" hint="Não coloque dados de clientes aqui."><Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={1500} required /></Field>
          <div className="row" style={{ gap: 8 }}><Button type="submit" variant="primary" loading={busy}>Salvar</Button><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div>
        </form>
      )}
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !items.length ? <EmptyState icon="mail" title="Nenhuma resposta pronta" /> : (
        <div className="stack">{items.map((c) => (
          <Card key={c.id} title={c.title} actions={<><Badge tone="neutral">{CAT[c.category] ?? (c.category === 'GERAL' ? 'Geral' : c.category)}</Badge><Badge tone={c.active ? 'ok' : 'neutral'} dot>{c.active ? 'Ativa' : 'Desativada'}</Badge></>}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button size="sm" onClick={() => start(c)}>Editar</Button>
              <Button size="sm" variant="ghost" onClick={() => void toggle(c)}>{c.active ? 'Desativar' : 'Ativar'}</Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(c)}>{del === c.id ? 'Confirmar exclusão' : 'Apagar'}</Button>
              <span className="muted" style={{ fontSize: 12 }}>usada {c.use_count}x</span>
            </div>
          </Card>
        ))}</div>
      )}
    </>
  );
}
