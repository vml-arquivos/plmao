import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Check, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Card, PageHead } from '../parts';

interface Row { id: string; source: 'CLIENTE' | 'MANUAL'; status: string; display_name: string; body: string; rating: number | null; consent_at: string | null; consent_version: string | null; proof_ref: string | null; published_at: string | null; reason: string | null; created_at: string; created_by_name: string | null; approved_by_name: string | null }
const STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'info' | 'neutral' | 'danger' }> = { PENDENTE: { l: 'Pendente', t: 'warn' }, APROVADO: { l: 'Aprovado', t: 'info' }, PUBLICADO: { l: 'Publicado', t: 'ok' }, OCULTO: { l: 'Oculto', t: 'neutral' }, REMOVIDO: { l: 'Removido', t: 'danger' } };

export default function Testimonials() {
  usePageTitle('Depoimentos');
  const toast = useToast();
  const [status, setStatus] = useState('PENDENTE');
  const list = useAsync(() => api.get<{ items: Row[] }>('/admin/testimonials', { query: { status } }), [status]);
  const [ask, setAsk] = useState<{ row: Row; kind: 'hide' | 'remove' } | null>(null);
  const [why, setWhy] = useState('');
  const [manual, setManual] = useState(false);
  const [m, setM] = useState({ displayName: '', body: '', rating: '', proofRef: '', consentConfirmed: false });
  const act = async (id: string, path: string, body?: unknown, ok = 'Feito.') => { try { await api.post(`/admin/testimonials/${id}/${path}`, body); toast.ok(ok); list.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  async function createManual() {
    try { await api.post('/admin/testimonials', { displayName: m.displayName, body: m.body, rating: m.rating ? Number(m.rating) : null, proofRef: m.proofRef, consentConfirmed: true }); toast.ok('Cadastrado. Outra pessoa precisa aprovar.'); setManual(false); setM({ displayName: '', body: '', rating: '', proofRef: '', consentConfirmed: false }); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHead title="Depoimentos" sub="Nada vai ao ar sem autorização registrada e aprovação da equipe. O texto não pode ser editado aqui." actions={<Button onClick={() => setManual(true)}>Cadastrar manualmente</Button>} />
      <div className="toolbar"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select><Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !items.length ? <EmptyState icon="info" title="Nenhum depoimento" /> : (
        <div className="stack">{items.map((r) => (
          <Card key={r.id} title={<span>{r.display_name || 'Removido'}</span>} actions={<><Badge tone="neutral">{r.source === 'CLIENTE' ? 'Cliente' : 'Manual'}</Badge><Badge tone={STATUS[r.status]?.t ?? 'neutral'} dot>{STATUS[r.status]?.l ?? r.status}</Badge></>}>
            {r.body && <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}{r.rating ? ` (${r.rating}/5)` : ''}</p>}
            <p className="muted" style={{ fontSize: 13 }}>Enviado em {dateTime(r.created_at)}{r.consent_at ? ` · consentimento em ${dateTime(r.consent_at)} (v${r.consent_version})` : ''}{r.proof_ref ? ` · comprovante: ${r.proof_ref}` : ''}{r.created_by_name && r.source === 'MANUAL' ? ` · cadastrado por ${r.created_by_name}` : ''}{r.approved_by_name ? ` · aprovado por ${r.approved_by_name}` : ''}{r.reason ? ` · motivo: ${r.reason}` : ''}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {r.status === 'PENDENTE' && <Button size="sm" variant="primary" onClick={() => void act(r.id, 'approve', undefined, 'Aprovado.')}>Aprovar</Button>}
              {r.status === 'APROVADO' && <Button size="sm" variant="primary" onClick={() => void act(r.id, 'publish', undefined, 'Publicado no site.')}>Publicar</Button>}
              {r.status === 'OCULTO' && <Button size="sm" onClick={() => void act(r.id, 'unhide', undefined, 'Reativado como aprovado.')}>Reativar</Button>}
              {(r.status === 'PUBLICADO' || r.status === 'APROVADO') && <Button size="sm" onClick={() => { setWhy(''); setAsk({ row: r, kind: 'hide' }); }}>Ocultar</Button>}
              {r.status !== 'REMOVIDO' && <Button size="sm" variant="danger" onClick={() => { setWhy(''); setAsk({ row: r, kind: 'remove' }); }}>Remover</Button>}
            </div>
          </Card>
        ))}</div>
      )}
      {ask && (
        <Modal title={ask.kind === 'hide' ? 'Ocultar depoimento' : 'Remover depoimento'} onClose={() => setAsk(null)} footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Cancelar</Button><Button variant={ask.kind === 'remove' ? 'danger' : 'primary'} disabled={why.trim().length < 3} onClick={() => { void act(ask.row.id, ask.kind, { reason: why }, ask.kind === 'hide' ? 'Ocultado.' : 'Removido.'); setAsk(null); }}>Confirmar</Button></>}>
          {ask.kind === 'remove' && <Alert tone="warn">A remoção apaga o texto e o nome. Não dá para desfazer.</Alert>}
          <Field label="Motivo"><Input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} /></Field>
        </Modal>
      )}
      {manual && (
        <Modal title="Cadastrar depoimento autorizado" onClose={() => setManual(false)} footer={<><Button variant="ghost" onClick={() => setManual(false)}>Cancelar</Button><Button variant="primary" disabled={!m.consentConfirmed || m.proofRef.trim().length < 10 || m.body.trim().length < 10 || m.displayName.trim().length < 2} onClick={() => void createManual()}>Cadastrar</Button></>}>
          <Alert tone="warn">Use apenas quando o autor autorizou por escrito fora da plataforma. Outra pessoa da equipe precisa aprovar antes da publicação.</Alert>
          <Field label="Nome autorizado"><Input value={m.displayName} onChange={(e) => setM({ ...m, displayName: e.target.value })} maxLength={80} /></Field>
          <Field label="Texto autorizado (10 a 500 caracteres)"><Textarea rows={4} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} maxLength={500} /></Field>
          <Field label="Nota (opcional)"><Select value={m.rating} onChange={(e) => setM({ ...m, rating: e.target.value })}><option value="">Sem nota</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} de 5</option>)}</Select></Field>
          <Field label="Referência do comprovante" hint="Onde está a autorização (e-mail, data, protocolo)."><Input value={m.proofRef} onChange={(e) => setM({ ...m, proofRef: e.target.value })} maxLength={300} /></Field>
          <Check checked={m.consentConfirmed} onChange={(e) => setM({ ...m, consentConfirmed: e.target.checked })}>Confirmo que existe autorização por escrito do autor para publicar este nome e texto.</Check>
        </Modal>
      )}
    </>
  );
}
