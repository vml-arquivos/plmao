import { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, PageLoading, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';
import { Icon } from '../../shared/icons';

interface Sec { h: string; p: string }
interface Faq { q: string; a: string }
interface Check { ok: boolean; label: string }
interface Item { override: { title: string | null; description: string | null } | null; path: string; default: { title: string; description: string }; title: string; description: string; keyword: string | null; sections: Sec[]; faq: Faq[]; noindex: boolean; hasSeed: boolean; checks: Check[]; score: number; total: number }

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SITE = 'placanamao.com.br';
function liveChecks(v: { title: string; description: string; keyword: string; sections: Sec[]; faq: Faq[]; noindex: boolean }): Check[] {
  const kw = norm(v.keyword).trim();
  const body = norm(`${v.sections.map((s) => `${s.h} ${s.p}`).join(' ')} ${v.faq.map((f) => `${f.q} ${f.a}`).join(' ')}`);
  const out: Check[] = [
    { ok: v.title.length >= 30 && v.title.length <= 65, label: `Título com ${v.title.length} caracteres (ideal: 30 a 65)` },
    { ok: v.description.length >= 70 && v.description.length <= 165, label: `Descrição com ${v.description.length} caracteres (ideal: 70 a 165)` },
    { ok: !!kw, label: 'Palavra-chave principal definida' }
  ];
  if (kw) { out.push({ ok: norm(v.title).includes(kw), label: 'Palavra-chave no título' }, { ok: norm(v.description).includes(kw), label: 'Palavra-chave na descrição' }); if (v.sections.length || v.faq.length) out.push({ ok: body.includes(kw), label: 'Palavra-chave no texto da página' }); }
  out.push({ ok: v.faq.length >= 3, label: `${v.faq.length} pergunta(s) frequente(s) (ideal: 3 ou mais)` }, { ok: !v.noindex, label: 'Página liberada para o Google (indexável)' });
  return out;
}

function Editor({ item, onSaved, onClose }: { item: Item; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(item.override?.title ?? ''); const [description, setDescription] = useState(item.override?.description ?? '');
  const [keyword, setKeyword] = useState(item.keyword ?? ''); const [noindex, setNoindex] = useState(item.noindex);
  const [sections, setSections] = useState<Sec[]>(item.sections); const [faq, setFaq] = useState<Faq[]>(item.faq);
  const [busy, setBusy] = useState(false);
  const checks = useMemo(() => liveChecks({ title: title || item.default.title, description: description || item.default.description, keyword, sections, faq, noindex }), [title, description, keyword, sections, faq, noindex, item.default]);
  const ok = checks.filter((c) => c.ok).length;
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/content/seo/pages', { path: item.path, title: title.trim() || null, description: description.trim() || null, keyword: keyword.trim() || null, sections: sections.filter((s) => s.h.trim() && s.p.trim()), faq: faq.filter((f) => f.q.trim() && f.a.trim()), noindex }); toast.ok('SEO salvo. Já vale no site (até 1 minuto).'); onSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const reset = async () => { setBusy(true); try { await api.post('/admin/content/seo/pages/reset', { path: item.path }); toast.ok('Texto padrão restaurado.'); onSaved(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const shown = `${SITE}${item.path === '/' ? '' : item.path}`.replace(/\//g, ' › ').replace(' › ', '/').replace(/ › $/, '');
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 20 }}>{item.path === '/' ? 'Página inicial' : item.path}</h2>
        <Button variant="ghost" onClick={onClose}>Voltar à lista</Button>
      </div>
      <Card title="Como vai aparecer no Google">
        <div className="seo-preview">
          <span className="seo-url">{shown}</span>
          <span className="seo-title">{title || item.default.title}</span>
          <span className="seo-desc">{description || item.default.description}</span>
        </div>
      </Card>
      <Card title={`Lista de verificação: ${ok} de ${checks.length}`}>
        <ul className="plain">{checks.map((c) => <li key={c.label} style={{ color: c.ok ? 'inherit' : 'var(--danger)' }}><Icon name={c.ok ? 'check-circle' : 'alert-triangle'} size={15} /> {c.label}</li>)}</ul>
      </Card>
      <Card title="Dados da página">
        <div className="stack">
          <Field label="Título" hint={`${title.length} caracteres. Deixe vazio para usar o padrão.`}><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={item.default.title} /></Field>
          <Field label="Descrição" hint={`${description.length} caracteres. É o texto que aparece abaixo do título no Google.`}><Textarea rows={3} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder={item.default.description} /></Field>
          <Field label="Palavra-chave principal" hint="O que as pessoas digitam para achar esta página. Use no título, na descrição e no texto."><Input value={keyword} maxLength={80} onChange={(e) => setKeyword(e.target.value)} /></Field>
          <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!noindex} onChange={(e) => setNoindex(!e.target.checked)} /> Liberar esta página para o Google (indexar e entrar no sitemap)</label>
        </div>
      </Card>
      <Card title="Textos da página (aparecem na tela e no HTML para o Google)" actions={<Button size="sm" onClick={() => setSections([...sections, { h: '', p: '' }])}>Adicionar texto</Button>}>
        {!sections.length && <p className="muted">Sem textos. Esta página usa o conteúdo que já tem na tela.</p>}
        <div className="stack">{sections.map((s, i) => (
          <div key={i} className="stack" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <Field label="Título do texto"><Input value={s.h} maxLength={140} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, h: e.target.value } : x)))} /></Field>
            <Field label="Texto"><Textarea rows={4} value={s.p} maxLength={2500} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, p: e.target.value } : x)))} /></Field>
            <div><Button size="sm" variant="ghost" onClick={() => setSections(sections.filter((_, j) => j !== i))}>Remover</Button></div>
          </div>
        ))}</div>
      </Card>
      <Card title="Perguntas frequentes (viram resultado enriquecido no Google)" actions={<Button size="sm" onClick={() => setFaq([...faq, { q: '', a: '' }])}>Adicionar pergunta</Button>}>
        <div className="stack">{faq.map((f, i) => (
          <div key={i} className="stack" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <Field label="Pergunta"><Input value={f.q} maxLength={220} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} /></Field>
            <Field label="Resposta"><Textarea rows={3} value={f.a} maxLength={1500} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} /></Field>
            <div><Button size="sm" variant="ghost" onClick={() => setFaq(faq.filter((_, j) => j !== i))}>Remover</Button></div>
          </div>
        ))}</div>
      </Card>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void reset()}>{item.hasSeed ? 'Restaurar texto padrão' : 'Limpar edição'}</Button>
        <a className="btn btn-ghost" href={item.path} target="_blank" rel="noreferrer">Abrir página</a>
      </div>
    </div>
  );
}

export default function Seo() {
  usePageTitle('SEO');
  const list = useAsync(() => api.get<{ items: Item[] }>('/admin/content/seo/pages'));
  const [open, setOpen] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  const current = items.find((i) => i.path === open) ?? null;
  const weak = items.filter((i) => i.score < i.total).length;
  return (
    <>
      <PageHead title="SEO" sub="Título, descrição, palavra-chave, textos e perguntas de cada página, como no WordPress, sem plugin. Tudo já vem preenchido; edite quando quiser." />
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : current ? (
        <Editor key={current.path + (current.score + current.title)} item={current} onSaved={() => { list.reload(); }} onClose={() => setOpen(null)} />
      ) : !items.length ? <EmptyState icon="search" title="Nenhuma página" /> : (
        <>
          <Alert tone="info">{weak ? `${weak} página(s) com pontos a melhorar na lista de verificação.` : 'Todas as páginas passam na lista de verificação.'} Depois de publicar, envie o sitemap no Search Console: <b>/sitemap.xml</b>. Artigos do blog têm o SEO próprio em "Artigos e blog".</Alert>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>Página</th><th>Título no Google</th><th>Nota</th><th>Google</th><th /></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.path}>
                  <td><b>{i.path === '/' ? 'Início' : i.path}</b>{i.keyword && <div className="muted" style={{ fontSize: 12 }}>{i.keyword}</div>}</td>
                  <td style={{ maxWidth: 380 }}>{i.title}</td>
                  <td><Badge tone={i.score === i.total ? 'ok' : i.score >= i.total - 2 ? 'warn' : 'danger'}>{i.score}/{i.total}</Badge></td>
                  <td>{i.noindex ? <Badge tone="danger">Fora</Badge> : <Badge tone="ok">Indexável</Badge>}</td>
                  <td><Button size="sm" onClick={() => setOpen(i.path)}>Editar</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
