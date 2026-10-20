import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { PageHead } from '../parts';

interface Faq { id: string; category: string; question: string; answer: string; displayOrder: number; active: boolean; archived: boolean }

export default function Faqs() {
  usePageTitle('Perguntas frequentes');
  const res = useAsync(() => api.get<Faq[]>('/admin/content/faqs'));
  const toast = useToast();
  const [edit, setEdit] = useState<Faq | 'new' | null>(null);
  const [remove, setRemove] = useState<Faq | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  async function toggle(f: Faq, active: boolean) {
    try { await api.patch(`/admin/content/faqs/${f.id}`, { active }); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const categories = [...new Set(res.data.map((f) => f.category))];
  const archivedCount = res.data.filter((f) => f.archived).length;
  const rows = res.data.filter((f) => showArchived ? f.archived : !f.archived);
  async function archive(f: Faq, archived: boolean) {
    try { await api.post(`/admin/content/faqs/${f.id}/archive`, { archived }); toast.ok(archived ? 'Pergunta arquivada: saiu do site.' : 'Pergunta restaurada.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <>
      <PageHead title="Perguntas frequentes" sub="Aparecem na página inicial, em Planos e em /perguntas-frequentes (com marcação para buscadores)." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nova pergunta</Button>} />
      <Tabs label="Perguntas" value={showArchived ? 'archived' : 'live'} onChange={(v) => setShowArchived(v === 'archived')} items={[{ id: 'live', label: 'Perguntas' }, { id: 'archived', label: `Arquivadas (${archivedCount})` }]} />
      {!rows.length && <EmptyState icon="info" title={showArchived ? 'Nenhuma pergunta arquivada' : 'Nenhuma pergunta cadastrada'} />}
      <div className="table-wrap"><table className="table"><thead><tr><th>Ordem</th><th>Pergunta</th><th>Categoria</th><th>Visível</th><th /></tr></thead><tbody>
        {rows.map((f) => (
          <tr key={f.id} style={f.active ? undefined : { opacity: .6 }}>
            <td className="num">{f.displayOrder}</td>
            <td><b>{f.question}</b><div className="muted" style={{ fontSize: 12.5, maxWidth: 560 }}>{f.answer.slice(0, 140)}{f.answer.length > 140 ? '…' : ''}</div></td>
            <td><Badge>{f.category}</Badge></td>
            <td><Switch checked={f.active} onChange={(e) => void toggle(f, e.target.checked)} label={f.active ? 'Sim' : 'Não'} /></td>
            <td className="actions"><Button size="sm" onClick={() => setEdit(f)}>Editar</Button> <Button size="sm" variant="ghost" onClick={() => void archive(f, !f.archived)}>{f.archived ? 'Restaurar' : 'Arquivar'}</Button> <Button size="sm" variant="ghost" onClick={() => setRemove(f)}>Apagar</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {edit && <FaqModal faq={edit === 'new' ? null : edit} categories={categories} next={Math.max(0, ...res.data.map((f) => f.displayOrder)) + 10} onClose={(c) => { setEdit(null); if (c) res.reload(); }} />}
      {remove && <ConfirmDialog danger title="Apagar pergunta?" message={`“${remove.question}” será apagada de vez. Se quiser só tirar do site, use Arquivar.`} confirmLabel="Apagar" onConfirm={async () => { await api.del(`/admin/content/faqs/${remove.id}`); res.reload(); }} onClose={() => setRemove(null)} />}
    </>
  );
}

function FaqModal({ faq, categories, next, onClose }: { faq: Faq | null; categories: string[]; next: number; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [category, setCategory] = useState(faq?.category ?? categories[0] ?? 'Geral');
  const [question, setQuestion] = useState(faq?.question ?? '');
  const [answer, setAnswer] = useState(faq?.answer ?? '');
  const [order, setOrder] = useState(String(faq?.displayOrder ?? next));
  const [active, setActive] = useState(faq?.active ?? true);
  const [busy, setBusy] = useState(false);
  async function save() {
    const body = { category: category.trim() || 'Geral', question: question.trim(), answer: answer.trim(), displayOrder: Number(order) || 0, active };
    setBusy(true);
    try { if (faq) await api.patch(`/admin/content/faqs/${faq.id}`, body); else await api.post('/admin/content/faqs', body); toast.ok('Pergunta salva.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={faq ? 'Editar pergunta' : 'Nova pergunta'} wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={question.trim().length < 5 || answer.trim().length < 5} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <Field label="Pergunta"><Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={240} /></Field>
        <Field label="Resposta"><Textarea rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={4000} /></Field>
        <div className="form-grid cols-2">
          <Field label="Categoria" hint="Agrupa as perguntas na página de FAQ."><Input list="faq-cats" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} /><datalist id="faq-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Ordem"><Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
        </div>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Visível no site" />
      </div>
    </Modal>
  );
}
