import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly } from '../../shared/format';
import { Markdown } from '../../shared/markdown';
import { PageHead } from '../parts';

interface Article {
  id: string; slug: string; title: string; excerpt: string; body: string; category: string; tags: string[]; coverImageUrl: string | null; author: string;
  seoTitle: string | null; seoDescription: string | null; status: 'DRAFT' | 'PUBLISHED'; publishedAt: string | null; updatedAt: string; archived: boolean;
}
const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

export default function Articles() {
  usePageTitle('Artigos e blog');
  const res = useAsync(() => api.get<Article[]>('/admin/content/articles'));
  const [edit, setEdit] = useState<Article | 'new' | null>(null);
  const [remove, setRemove] = useState<Article | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const toast = useToast();
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const categories = [...new Set(res.data.map((a) => a.category))];
  const archivedCount = res.data.filter((a) => a.archived).length;
  const rows = res.data.filter((a) => showArchived ? a.archived : !a.archived);
  async function archive(a: Article, archived: boolean) {
    try { await api.post(`/admin/content/articles/${a.id}/archive`, { archived }); toast.ok(archived ? 'Artigo arquivado: saiu do site.' : 'Artigo restaurado como rascunho.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <>
      <PageHead title="Artigos e blog" sub="Conteúdo que traz visitantes pelo Google e ajuda o cliente a escolher a consulta certa." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo artigo</Button>} />
      <Tabs label="Artigos" value={showArchived ? 'archived' : 'live'} onChange={(v) => setShowArchived(v === 'archived')} items={[{ id: 'live', label: 'Artigos' }, { id: 'archived', label: `Arquivados (${archivedCount})` }]} />
      {!rows.length && <EmptyState icon="file-text" title={showArchived ? 'Nenhum artigo arquivado' : 'Nenhum artigo ainda'} />}
      <div className="table-wrap"><table className="table"><thead><tr><th>Título</th><th>Categoria</th><th>Status</th><th>Publicado</th><th /></tr></thead><tbody>
        {rows.map((a) => (
          <tr key={a.id}>
            <td><b>{a.title}</b><div className="muted mono" style={{ fontSize: 11.5 }}>/blog/{a.slug}</div></td>
            <td><Badge>{a.category}</Badge></td>
            <td><Badge tone={a.status === 'PUBLISHED' ? 'ok' : 'warn'} dot>{a.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}</Badge></td>
            <td>{a.publishedAt ? dateOnly(a.publishedAt) : '—'}</td>
            <td className="actions"><Button size="sm" onClick={() => setEdit(a)}>Editar</Button> <Button size="sm" variant="ghost" onClick={() => void archive(a, !a.archived)}>{a.archived ? 'Restaurar' : 'Arquivar'}</Button> <Button size="sm" variant="ghost" onClick={() => setRemove(a)}>Apagar</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {edit && <ArticleModal a={edit === 'new' ? null : edit} categories={categories} onClose={(c) => { setEdit(null); if (c) res.reload(); }} />}
      {remove && <ConfirmDialog danger title="Apagar artigo?" message={`“${remove.title}” será apagado de vez e não dá para desfazer. Se quiser só tirar do site, use Arquivar.`} confirmLabel="Apagar" onConfirm={async () => { await api.del(`/admin/content/articles/${remove.id}`); res.reload(); }} onClose={() => setRemove(null)} />}
    </>
  );
}

function ArticleModal({ a, categories, onClose }: { a: Article | null; categories: string[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'write' | 'preview' | 'seo'>('write');
  const [title, setTitle] = useState(a?.title ?? '');
  const [slug, setSlug] = useState(a?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(a));
  const [category, setCategory] = useState(a?.category ?? categories[0] ?? 'Geral');
  const [excerpt, setExcerpt] = useState(a?.excerpt ?? '');
  const [body, setBody] = useState(a?.body ?? '');
  const [tags, setTags] = useState((a?.tags ?? []).join(', '));
  const [cover, setCover] = useState(a?.coverImageUrl ?? '');
  const [author, setAuthor] = useState(a?.author ?? 'Equipe Placa na Mão');
  const [seoTitle, setSeoTitle] = useState(a?.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(a?.seoDescription ?? '');
  const [status, setStatus] = useState<'DRAFT' | 'PUBLISHED'>(a?.status ?? 'DRAFT');
  const [busy, setBusy] = useState(false);
  async function save() {
    const payload = {
      slug: slug.trim(), title: title.trim(), excerpt: excerpt.trim(), body, category: category.trim() || 'Geral', tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
      coverImageUrl: cover.trim() || null, author: author.trim() || 'Equipe Placa na Mão', seoTitle: seoTitle.trim() || null, seoDescription: seoDescription.trim() || null, status
    };
    setBusy(true);
    try { if (a) await api.patch(`/admin/content/articles/${a.id}`, payload); else await api.post('/admin/content/articles', payload); toast.ok(status === 'PUBLISHED' ? 'Artigo publicado.' : 'Rascunho salvo.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={a ? 'Editar artigo' : 'Novo artigo'} wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={title.trim().length < 5 || slug.trim().length < 3} onClick={() => void save()}>{status === 'PUBLISHED' ? 'Salvar e publicar' : 'Salvar rascunho'}</Button></>}>
      <div className="stack">
        <Tabs label="Edição do artigo" value={tab} onChange={setTab} items={[{ id: 'write', label: 'Texto' }, { id: 'preview', label: 'Pré-visualizar' }, { id: 'seo', label: 'Google e capa' }]} />
        {tab === 'write' && (
          <>
            <Field label="Título"><Input value={title} onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} maxLength={180} /></Field>
            <div className="form-grid cols-2">
              <Field label="Endereço (slug)" hint={`/blog/${slug || '…'}`}><Input value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }} maxLength={120} /></Field>
              <Field label="Categoria"><Input list="art-cats" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} /><datalist id="art-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
            </div>
            <Field label="Resumo" hint="Aparece na lista do blog e nos resultados de busca."><Textarea rows={2} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} maxLength={400} /></Field>
            <Field label="Texto do artigo" hint="Use ## para títulos, - para listas, 1. para passos, **negrito** e [texto](https://…) para links."><Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} maxLength={60000} /></Field>
            <div className="form-grid cols-2">
              <Field label="Etiquetas" hint="Separadas por vírgula."><Input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
              <Field label="Situação"><Select value={status} onChange={(e) => setStatus(e.target.value as 'DRAFT' | 'PUBLISHED')}><option value="DRAFT">Rascunho (não aparece no site)</option><option value="PUBLISHED">Publicado</option></Select></Field>
            </div>
          </>
        )}
        {tab === 'preview' && (body.trim() ? <article style={{ maxWidth: 720 }}><h1 style={{ fontSize: 28, marginBottom: 12 }}>{title || 'Sem título'}</h1><Markdown source={body} /></article> : <EmptyState icon="file-text" title="Escreva o texto para ver a prévia" />)}
        {tab === 'seo' && (
          <>
            <Alert tone="info">Se ficar em branco, usamos o título e o resumo. Títulos até 60 caracteres e descrições até 155 funcionam melhor.</Alert>
            <Field label="Título para o Google (opcional)" hint={`${seoTitle.length}/120`}><Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={120} /></Field>
            <Field label="Descrição para o Google (opcional)" hint={`${seoDescription.length}/300`}><Textarea rows={3} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={300} /></Field>
            <Field label="Imagem de capa (endereço https://… ou /caminho)" hint="Opcional. Use uma imagem sua ou com licença de uso."><Input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…" /></Field>
            <Field label="Autor"><Input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80} /></Field>
          </>
        )}
      </div>
    </Modal>
  );
}
