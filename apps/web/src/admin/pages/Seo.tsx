import { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';
import { Icon } from '../../shared/icons';

interface Sec { h: string; p: string }
interface Faq { q: string; a: string }
interface Check { ok: boolean; label: string }
interface PubCheck { ok: boolean; label: string; detail?: string }
interface Pub { path: string; at: string; scope: string; status: 'OK' | 'DIVERGENCIA' | 'ERRO'; checks: PubCheck[]; error?: string }
const PUB_TONE = { OK: 'ok', DIVERGENCIA: 'warn', ERRO: 'danger' } as const;
const PUB_LABEL = { OK: 'Confere', DIVERGENCIA: 'Diverge', ERRO: 'Erro' } as const;
const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
interface PageImage { url: string; mime: string; sizeBytes: number; width: number | null; height: number | null }
interface Item { kind?: 'bank' | 'hub' | 'custom' | null; defaultKeyword?: string | null; publication?: Pub | null; image: PageImage | null; h1: string; needsFaq: boolean; override: { h1: string | null; title: string | null; description: string | null } | null; path: string; default: { title: string; description: string }; title: string; description: string; keyword: string | null; sections: Sec[]; faq: Faq[]; noindex: boolean; hasSeed: boolean; checks: Check[]; score: number; total: number }

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const SITE = 'placanamao.com.br';
function liveChecks(v: { h1Max?: number; h1: string; needsFaq: boolean; title: string; description: string; keyword: string; sections: Sec[]; faq: Faq[]; noindex: boolean }): Check[] {
  const kw = norm(v.keyword).trim();
  const body = norm(`${v.sections.map((s) => `${s.h} ${s.p}`).join(' ')} ${v.faq.map((f) => `${f.q} ${f.a}`).join(' ')}`);
  const out: Check[] = [
    { ok: v.h1.length > 0 && v.h1.length <= (v.h1Max ?? 30), label: v.h1 ? `H1 com ${v.h1.length} caracteres (ideal: até ${v.h1Max ?? 30})` : `H1 não definido (ideal: até ${v.h1Max ?? 30} caracteres)` },
    { ok: v.title.length >= 30 && v.title.length <= 65, label: `Título com ${v.title.length} caracteres (ideal: 30 a 65)` },
    { ok: v.description.length >= 70 && v.description.length <= 165, label: `Descrição com ${v.description.length} caracteres (ideal: 70 a 165)` },
    { ok: !!kw, label: 'Palavra-chave principal definida' }
  ];
  if (kw) { out.push({ ok: norm(v.h1).includes(kw), label: 'Palavra-chave no H1' }, { ok: norm(v.title).includes(kw), label: 'Palavra-chave no título' }, { ok: norm(v.description).includes(kw), label: 'Palavra-chave na descrição' }); if (v.sections.length || v.faq.length) out.push({ ok: body.includes(kw), label: 'Palavra-chave no texto da página' }); }
  if (v.needsFaq) out.push({ ok: v.faq.length >= 3, label: `${v.faq.length} pergunta(s) frequente(s) (ideal: 3 ou mais)` });
  out.push({ ok: !v.noindex, label: 'Indexação permitida no site (sem bloqueio). Isso não indica se o Google já indexou' });
  return out;
}

const KIND_LABEL = { bank: 'Página do banco (automática)', hub: 'Índice de bancos (automática)', custom: 'Criada no painel' } as const;

const GUIDE: Array<[string, string, string, string]> = [
  ['Imagem da página', '1200×1200 (consultas) ou 1200×630', 'Miniatura que aparece no Google, WhatsApp e redes. Use a arte da própria consulta, com o nome bem legível e sem texto colado nas bordas. PNG, JPG ou WebP, de preferência até 300 KB.', 'Consulta Gravame, 1200×1200'],
  ['H1', 'até 30 caracteres', 'O título que a pessoa vê no topo da página. Só um por página. Comece pela palavra-chave e não repita o nome da empresa.', 'Tabela FIPE grátis'],
  ['Título do Google', '30 a 65 caracteres', 'Palavra-chave no começo, um benefício e o nome da marca no final, separado por barra vertical. Não repita o mesmo título em outra página.', 'Tabela FIPE grátis: preço de carro e moto | Placa na Mão'],
  ['Descrição', '70 a 165 caracteres', 'Uma ou duas frases que dizem o que a pessoa encontra e por que clicar. Use a palavra-chave uma vez e termine com um convite ou um diferencial real.', 'Consulte a Tabela FIPE grátis: valor médio de carros, motos e caminhões por marca, modelo e ano. Sem cadastro.'],
  ['Palavra-chave', '2 a 4 palavras', 'O que as pessoas digitam para achar a página. Uma por página, sem repetir em outra. Precisa aparecer no H1, no título, na descrição e no texto.', 'tabela fipe'],
  ['Textos da página', '2 a 4 blocos, 60 a 120 palavras cada', 'Explique o assunto em linguagem simples, de baixo para cima: o que é, como usar, o que muda o resultado. Nada de promessa que o produto não cumpre.', 'O que é a Tabela FIPE'],
  ['Perguntas frequentes', '3 a 8 perguntas', 'Perguntas que as pessoas realmente fazem, com resposta direta de 1 a 3 frases. Ajudam quem lê e o Google a entender a página; desde maio de 2026 o Google não mostra mais o resultado enriquecido de perguntas.', 'A consulta da Tabela FIPE é grátis?'],
  ['Indexar', 'ligado', 'Deixe ligado nas páginas que devem aparecer no Google. Desligue só em página de teste ou que não deve ser encontrada.', 'Liberada']
];

function Editor({ item, onSaved, onClose }: { item: Item; onSaved: () => void; onClose: () => void }) {
  const toast = useToast();
  const [h1, setH1] = useState(item.h1 ?? ''); const [title, setTitle] = useState(item.override?.title ?? ''); const [description, setDescription] = useState(item.override?.description ?? '');
  const [keyword, setKeyword] = useState(item.keyword || item.defaultKeyword || ''); const [noindex, setNoindex] = useState(item.noindex);
  const [sections, setSections] = useState<Sec[]>(item.sections); const [faq, setFaq] = useState<Faq[]>(item.faq);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<PageImage | null>(item.image);
  const [imgBusy, setImgBusy] = useState(false);
  const sendImage = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast.error('Use uma imagem PNG, JPG ou WebP.'); return; }
    if (file.size > 3 * 1024 * 1024) { toast.error('A imagem passa de 3 MB. Reduza o arquivo e tente de novo.'); return; }
    setImgBusy(true);
    try { const r = await api.upload<{ image: PageImage }>('/admin/content/seo/pages/image', file, { path: item.path }); setImage(r.image); toast.ok('Imagem salva.'); onSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setImgBusy(false); }
  };
  const removeImage = async () => {
    setImgBusy(true);
    try { await api.del(`/admin/content/seo/pages/image`, { query: { path: item.path } }); setImage(null); toast.ok('Imagem removida. A página volta a usar a imagem padrão da marca.'); onSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setImgBusy(false); }
  };
  const checks = useMemo(() => liveChecks({ h1Max: item.kind ? 50 : undefined, h1: h1.trim(), needsFaq: item.needsFaq, title: title || item.default.title, description: description || item.default.description, keyword, sections, faq, noindex }), [h1, title, description, keyword, sections, faq, noindex, item.default, item.needsFaq]);
  const ok = checks.filter((c) => c.ok).length;
  const [pub, setPub] = useState<Pub | null>(item.publication ?? null); const [verifying, setVerifying] = useState(false);
  const verify = async () => {
    setVerifying(true);
    try { const r = await api.post<{ results: Pub[] }>('/admin/content/seo/pages/verify', { path: item.path }); setPub(r.results[0] ?? null); }
    catch (e) { toast.error(errorMessage(e)); } finally { setVerifying(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/content/seo/pages', { path: item.path, h1: h1.trim() || null, title: title.trim() || null, description: description.trim() || null, keyword: keyword.trim() || null, sections: sections.filter((s) => s.h.trim() && s.p.trim()), faq: faq.filter((f) => f.q.trim() && f.a.trim()), noindex }); toast.ok('SEO salvo. Já vale no site (até 1 minuto).'); onSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const [askDelete, setAskDelete] = useState(false);
  const reset = async () => { setBusy(true); try { await api.post('/admin/content/seo/pages/reset', { path: item.path }); toast.ok('Texto padrão restaurado.'); onSaved(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const shown = `${SITE}${item.path === '/' ? '' : item.path}`.replace(/\//g, ' › ').replace(' › ', '/').replace(/ › $/, '');
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 20 }}>{item.path === '/' ? 'Página inicial' : item.path} {item.kind && <Badge tone="neutral">{KIND_LABEL[item.kind]}</Badge>}</h2>
        <Button variant="ghost" onClick={onClose}>Voltar à lista</Button>
      </div>
      <Card title="Como vai aparecer no Google">
        <div className="seo-preview">
          <span className="seo-url">{shown}</span>
          <span className="seo-title">{title || item.default.title}</span>
          <span className="seo-desc">{description || item.default.description}</span>
        </div>
      </Card>
      <Card title={`Preenchimento editorial: ${ok} de ${checks.length}`}>
        <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>Mede se os campos estão bem preenchidos. Não garante que a página foi publicada nem que o Google a indexou, e não é promessa de posição.</p>
        <ul className="plain">{checks.map((c) => <li key={c.label} style={{ color: c.ok ? 'inherit' : 'var(--danger)' }}><Icon name={c.ok ? 'check-circle' : 'alert-triangle'} size={15} /> {c.label}</li>)}</ul>
      </Card>
      <Card title="Publicação no site">
        <div className="stack">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Confere se o que está salvo aqui é o que o site entrega nesta página (título, descrição, canonical, indexação, H1, blocos e perguntas). Salve antes de verificar.</p>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="sm" loading={verifying} onClick={verify}>Verificar publicação</Button>
            {pub ? <><Badge tone={PUB_TONE[pub.status]} dot>{PUB_LABEL[pub.status]}</Badge><span className="muted" style={{ fontSize: 13 }}>verificado em {dt(pub.at)}</span></> : <Badge tone="neutral">Ainda não verificada</Badge>}
          </div>
          {pub && <>
            {pub.error && <Alert tone="danger">{pub.error}</Alert>}
            <ul className="plain">{pub.checks.map((c) => <li key={c.label} style={{ color: c.ok ? 'inherit' : 'var(--danger)' }}><Icon name={c.ok ? 'check-circle' : 'alert-triangle'} size={15} /> {c.label}{c.detail && <div className="muted" style={{ fontSize: 12, marginLeft: 21 }}>{c.detail}</div>}</li>)}</ul>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>Escopo: {pub.scope}. A verificação fica só na memória do servidor e some ao reiniciar.</p>
          </>}
        </div>
      </Card>
      <Card title="Indexação no Google">
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{noindex ? 'Esta página está bloqueada para o Google pelo painel.' : 'O site permite a indexação desta página.'} O sistema não consulta o Google, então não sabe se a página já foi indexada. Confira em <b>Search Console → Inspeção de URL</b>, depois de publicar.</p>
      </Card>
      <Card title="Como preencher cada campo">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Campo</th><th>Tamanho ideal</th><th>O que colocar</th><th>Exemplo</th></tr></thead>
          <tbody>{GUIDE.map((g) => <tr key={g[0]}><td><b>{g[0]}</b></td><td>{g[1]}</td><td>{g[2]}</td><td className="muted">{g[3]}</td></tr>)}</tbody>
        </table></div>
      </Card>
      <Card title="Imagem da página (miniatura)">
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Aparece como foto da página no Google (imagens e produtos), no WhatsApp, Facebook, Instagram e X. Ideal: quadrada ou 1200×630, PNG, JPG ou WebP, até 3 MB. A imagem fica guardada no sistema e vale na hora; o Google atualiza depois de reindexar. Sem imagem, a página usa a imagem padrão da marca.</p>
          {image ? (
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <img src={image.url} alt={`Imagem de ${item.path}`} style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} />
              <div className="muted" style={{ fontSize: 13 }}>{image.width && image.height ? `${image.width}×${image.height} px · ` : ''}{Math.max(1, Math.round(image.sizeBytes / 1024))} KB · {image.mime.replace('image/', '').toUpperCase()}</div>
            </div>
          ) : <Badge tone="warn">Sem imagem própria</Badge>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="btn" style={{ cursor: imgBusy ? 'wait' : 'pointer' }}>{imgBusy ? 'Enviando…' : image ? 'Trocar imagem' : 'Enviar imagem'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={imgBusy} onChange={(e) => { void sendImage(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {image && <Button variant="ghost" disabled={imgBusy} onClick={() => void removeImage()}>Remover imagem</Button>}
          </div>
        </div>
      </Card>
      <Card title="Dados da página">
        <div className="stack">
          <Field label="H1 (título que aparece no topo da página)" hint={`${h1.length} de ${item.kind ? 50 : 30} caracteres. Um só por página, curto, com a palavra-chave. Ex.: Tabela FIPE grátis`} error={h1.length > (item.kind ? 50 : 30) ? `Acima de ${item.kind ? 50 : 30} caracteres: o ideal é encurtar.` : undefined}><Input value={h1} maxLength={70} onChange={(e) => setH1(e.target.value)} placeholder="Ex.: Consulta de placa" /></Field>
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
      <Card title="Perguntas frequentes (respostas curtas às dúvidas reais)" actions={<Button size="sm" onClick={() => setFaq([...faq, { q: '', a: '' }])}>Adicionar pergunta</Button>}>
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
        {item.kind === 'custom' ? <Button variant="danger" disabled={busy} onClick={() => setAskDelete(true)}>Excluir página</Button> : <Button variant="ghost" disabled={busy} onClick={() => void reset()}>{item.hasSeed ? 'Restaurar texto padrão' : 'Limpar edição'}</Button>}
        <a className="btn btn-ghost" href={item.path} target="_blank" rel="noreferrer">Abrir página</a>
      </div>
      {askDelete && <ConfirmDialog danger title="Excluir esta página?" confirmLabel="Excluir" message={`${item.path} sai do site e do sitemap, com o texto e a imagem. Não dá para desfazer.`} onConfirm={async () => { try { await api.del('/admin/content/seo/pages/custom', { query: { path: item.path } }); toast.ok('Página excluída.'); onSaved(); onClose(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setAskDelete(false)} />}
    </div>
  );
}

function NewPage({ onClose, onCreated }: { onClose: () => void; onCreated: (path: string) => void }) {
  const toast = useToast();
  const [slug, setSlug] = useState(''); const [h1, setH1] = useState(''); const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = slug.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const create = async () => {
    setBusy(true);
    try { const r = await api.post<{ path: string }>('/admin/content/seo/pages/custom', { slug: clean, h1: h1.trim(), title: title.trim(), description: description.trim(), keyword: keyword.trim() || null }); toast.ok('Página criada. Já está no site e no sitemap.'); onCreated(r.path); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nova página de financiamento" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={clean.length < 3 || h1.trim().length < 3 || title.trim().length < 10 || description.trim().length < 20} onClick={() => void create()}>Criar página</Button></>}>
      <div className="stack">
        <Field label="Endereço" hint={`placanamao.com.br/financiamento/${clean || 'nome-da-pagina'}`}><Input value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value)} placeholder="financiamento-de-carro-usado-itau" /></Field>
        <Field label="H1 (título no topo da página)"><Input value={h1} maxLength={70} onChange={(e) => setH1(e.target.value)} placeholder="Financiamento de carro usado Itaú" /></Field>
        <Field label="Título do Google" hint={`${title.length} caracteres (ideal: 30 a 65)`}><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Financiamento de carro usado Itaú: taxa e simulação | Placa na Mão" /></Field>
        <Field label="Descrição" hint={`${description.length} caracteres (ideal: 70 a 165)`}><Textarea rows={3} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Palavra-chave principal"><Input value={keyword} maxLength={80} onChange={(e) => setKeyword(e.target.value)} placeholder="financiamento de carro usado itaú" /></Field>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Depois de criar, abra a página para escrever os textos e as perguntas. As páginas dos bancos já nascem sozinhas.</p>
      </div>
    </Modal>
  );
}

export default function Seo() {
  usePageTitle('SEO');
  const list = useAsync(() => api.get<{ items: Item[] }>('/admin/content/seo/pages'));
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const items = list.data?.items ?? [];
  const current = items.find((i) => i.path === open) ?? null;
  const weak = items.filter((i) => i.score < i.total).length;
  const toast = useToast(); const [verifyingAll, setVerifyingAll] = useState(false);
  const verifyAll = async () => { setVerifyingAll(true); try { await api.post('/admin/content/seo/pages/verify', {}); list.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setVerifyingAll(false); } };
  const verified = items.filter((i) => i.publication).length;
  return (
    <>
      <PageHead title="SEO" sub="H1, título, descrição, palavra-chave, textos e perguntas de cada página, como no WordPress, sem plugin. Tudo já vem preenchido; edite quando quiser. Cada banco com taxa ganha sozinho a página “Financiamento de carro {banco}”." actions={<Button icon="plus" onClick={() => setCreating(true)}>Nova página de financiamento</Button>} />
      {creating && <NewPage onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); list.reload(); setOpen(p); }} />}
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : current ? (
        <Editor key={current.path + (current.score + current.title + current.h1)} item={current} onSaved={() => { list.reload(); }} onClose={() => setOpen(null)} />
      ) : !items.length ? <EmptyState icon="search" title="Nenhuma página" /> : (
        <>
          <Alert tone="info">{weak ? `${weak} página(s) com campos a melhorar.` : 'Todos os campos estão preenchidos.'} A coluna Publicação mostra se o site entrega o que está salvo. Indexação “Permitida” só diz que não há bloqueio; a situação no Google está no Search Console. Depois de publicar, envie o sitemap no Search Console: <b>/sitemap.xml</b>. Artigos do blog têm o SEO próprio em "Artigos e blog".</Alert>
          <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><Button size="sm" loading={verifyingAll} onClick={verifyAll}>Verificar publicação das {items.length} páginas</Button><span className="muted" style={{ fontSize: 13 }}>{verified ? `${verified} verificada(s) desde que o servidor iniciou` : 'Nenhuma verificada ainda'}</span></div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead><tr><th>Página</th><th>H1</th><th>Título no Google</th><th>Imagem</th><th>Preenchimento</th><th>Publicação</th><th>Indexação</th><th /></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.path}>
                  <td><b>{i.path === '/' ? 'Início' : i.path}</b>{i.kind && <> <Badge tone="neutral">{i.kind === 'bank' ? 'Banco' : i.kind === 'hub' ? 'Índice' : 'Criada'}</Badge></>}{i.keyword && <div className="muted" style={{ fontSize: 12 }}>{i.keyword}</div>}</td>
                  <td style={{ maxWidth: 200 }}>{i.h1 || <span className="muted">sem H1</span>}</td>
                  <td style={{ maxWidth: 380 }}>{i.title}</td>
                  <td>{i.image ? <img src={i.image.url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} /> : <span className="muted">sem</span>}</td>
                  <td><Badge tone={i.score === i.total ? 'ok' : i.score >= i.total - 2 ? 'warn' : 'danger'}>{i.score}/{i.total}</Badge></td>
                  <td>{i.publication ? <Badge tone={PUB_TONE[i.publication.status]}>{PUB_LABEL[i.publication.status]}</Badge> : <span className="muted">não verificada</span>}</td>
                  <td>{i.noindex ? <Badge tone="danger">Bloqueada</Badge> : <Badge tone="neutral">Permitida</Badge>}</td>
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
