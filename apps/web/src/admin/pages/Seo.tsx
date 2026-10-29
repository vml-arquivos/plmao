import { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, PageLoading, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';
import { Icon } from '../../shared/icons';

interface Sec { h: string; p: string }
interface Faq { q: string; a: string }
interface Check { ok: boolean; label: string }
interface Item { h1: string; needsFaq: boolean; override: { h1: string | null; title: string | null; description: string | null } | null; path: string; default: { title: string; description: string }; title: string; description: string; keyword: string | null; sections: Sec[]; faq: Faq[]; noindex: boolean; hasSeed: boolean; checks: Check[]; score: number; total: number }

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SITE = 'placanamao.com.br';
function liveChecks(v: { h1: string; needsFaq: boolean; title: string; description: string; keyword: string; sections: Sec[]; faq: Faq[]; noindex: boolean }): Check[] {
  const kw = norm(v.keyword).trim();
  const body = norm(`${v.sections.map((s) => `${s.h} ${s.p}`).join(' ')} ${v.faq.map((f) => `${f.q} ${f.a}`).join(' ')}`);
  const out: Check[] = [
    { ok: v.h1.length > 0 && v.h1.length <= 30, label: v.h1 ? `H1 com ${v.h1.length} caracteres (ideal: até 30)` : 'H1 não definido (ideal: até 30 caracteres)' },
    { ok: v.title.length >= 30 && v.title.length <= 65, label: `Título com ${v.title.length} caracteres (ideal: 30 a 65)` },
    { ok: v.description.length >= 70 && v.description.length <= 165, label: `Descrição com ${v.description.length} caracteres (ideal: 70 a 165)` },
    { ok: !!kw, label: 'Palavra-chave principal definida' }
  ];
  if (kw) { out.push({ ok: norm(v.h1).includes(kw), label: 'Palavra-chave no H1' }, { ok: norm(v.title).includes(kw), label: 'Palavra-chave no título' }, { ok: norm(v.description).includes(kw), label: 'Palavra-chave na descrição' }); if (v.sections.length || v.faq.length) out.push({ ok: body.includes(kw), label: 'Palavra-chave no texto da página' }); }
  if (v.needsFaq) out.push({ ok: v.faq.length >= 3, label: `${v.faq.length} pergunta(s) frequente(s) (ideal: 3 ou mais)` });
  out.push({ ok: !v.noindex, label: 'Página liberada para o Google (indexável)' });
  return out;
}

const GUIDE: Array<[string, string, string, string]> = [
  ['H1', 'até 30 caracteres', 'O título que a pessoa vê no topo da página. Só um por página. Comece pela palavra-chave e não repita o nome da empresa.', 'Tabela FIPE grátis'],
  ['Título do Google', '30 a 65 caracteres', 'Palavra-chave no começo, um benefício e o nome da marca no final, separado por barra vertical. Não repita o mesmo título em outra página.', 'Tabela FIPE grátis: preço de carro e moto | Placa na Mão'],
  ['Descrição', '70 a 165 caracteres', 'Uma ou duas frases que dizem o que a pessoa encontra e por que clicar. Use a palavra-chave uma vez e termine com um convite ou um diferencial real.', 'Consulte a Tabela FIPE grátis: valor médio de carros, motos e caminhões por marca, modelo e ano. Sem cadastro.'],
  ['Palavra-chave', '2 a 4 palavras', 'O que as pessoas digitam para achar a página. Uma por página, sem repetir em outra. Precisa aparecer no H1, no título, na descrição e no texto.', 'tabela fipe'],
  ['Textos da página', '2 a 4 blocos, 60 a 120 palavras cada', 'Explique o assunto em linguagem simples, de baixo para cima: o que é, como usar, o que muda o resultado. Nada de promessa que o produto não cumpre.', 'O que é a Tabela FIPE'],
  ['Perguntas frequentes', '3 a 8 perguntas', 'Perguntas que as pessoas realmente fazem, com resposta direta de 1 a 3 frases. Viram resultado enriquecido no Google.', 'A consulta da Tabela FIPE é grátis?'],
  ['Indexar', 'ligado', 'Deixe ligado nas páginas que devem aparecer no Google. Desligue só em página de teste ou que não deve ser encontrada.', 'Liberada']
];

function Editor({ item, onSaved, onClose }: { item: Item; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const [h1, setH1] = useState(item.h1 ?? ''); const [title, setTitle] = useState(item.override?.title ?? ''); const [description, setDescription] = useState(item.override?.description ?? '');
  const [keyword, setKeyword] = useState(item.keyword ?? ''); const [noindex, setNoindex] = useState(item.noindex);
  const [sections, setSections] = useState<Sec[]>(item.sections); const [faq, setFaq] = useState<Faq[]>(item.faq);
  const [busy, setBusy] = useState(false);
  const checks = useMemo(() => liveChecks({ h1: h1.trim(), needsFaq: item.needsFaq, title: title || item.default.title, description: description || item.default.description, keyword, sections, faq, noindex }), [h1, title, description, keyword, sections, faq, noindex, item.default, item.needsFaq]);
  const ok = checks.filter((c) => c.ok).length;
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/content/seo/pages', { path: item.path, h1: h1.trim() || null, title: title.trim() || null, description: description.trim() || null, keyword: keyword.trim() || null, sections: sections.filter((s) => s.h.trim() && s.p.trim()), faq: faq.filter((f) => f.q.trim() && f.a.trim()), noindex }); toast.ok('SEO salvo. Já vale no site (até 1 minuto).'); onSaved(); }
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
      <Card title="Como preencher cada campo">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Campo</th><th>Tamanho ideal</th><th>O que colocar</th><th>Exemplo</th></tr></thead>
          <tbody>{GUIDE.map((g) => <tr key={g[0]}><td><b>{g[0]}</b></td><td>{g[1]}</td><td>{g[2]}</td><td className="muted">{g[3]}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Dados da página">
        <div className="stack">
          <Field label="H1 (título que aparece no topo da página)" hint={`${h1.length} de 30 caracteres. Um só por página, curto, com a palavra-chave. Ex.: Tabela FIPE grátis`} error={h1.length > 30 ? 'Acima de 30 caracteres: o ideal é encurtar.' : undefined}><Input value={h1} maxLength={70} onChange={(e) => setH1(e.target.value)} placeholder="Ex.: Consulta de placa" /></Field>
          <Field label="Título do Google (title)" hint={`${title.length} caracteres. Deixe vazio para usar o padrão.`}><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={item.default.title} /></Field>
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
      <PageHead title="SEO" sub="H1, título, descrição, palavra-chave, textos e perguntas de cada página, como no WordPress, sem plugin. Tudo já vem preenchido; edite quando quiser." />
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : current ? (
        <Editor key={current.path + (current.score + current.title + current.h1)} item={current} onSaved={() => { list.reload(); }} onClose={() => setOpen(null)} />
      ) : !items.length ? <EmptyState icon="search" title="Nenhuma página" /> : (
        <>
          <Alert tone="info">{weak ? `${weak} página(s) com pontos a melhorar na lista de verificação.` : 'Todas as páginas passam na lista de verificação.'} Depois de publicar, envie o sitemap no Search Console: <b>/sitemap.xml</b>. Artigos do blog têm o SEO próprio em "Artigos e blog".</Alert>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>Página</th><th>H1</th><th>Título no Google</th><th>Nota</th><th>Google</th><th /></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.path}>
                  <td><b>{i.path === '/' ? 'Início' : i.path}</b>{i.keyword && <div className="muted" style={{ fontSize: 12 }}>{i.keyword}</div>}</td>
                  <td style={{ maxWidth: 200 }}>{i.h1 || <span className="muted">sem H1</span>}</td>
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
