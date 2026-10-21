import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Card, PageHead } from '../parts';

/* ---------- tipos ---------- */
interface SpecField { key: string; group: string; label: string; kind: 'number' | 'text' | 'bool'; unit?: string }
interface Meta { models: number; published: number; pendingOpinions: number; tips: number; bodyTypes: string[]; specFields: SpecField[]; tipCategories: Array<{ key: string; label: string }> }
interface ModelRow { id: string; slug: string; brand: string; name: string; vehicleType: string; bodyType: string | null; yearFrom: number | null; yearTo: number | null; status: 'DRAFT' | 'PUBLISHED'; archived: boolean; updatedAt: string; versions: number; opinions: number; pendingOpinions: number; hasText: boolean }
interface Model { id: string; slug: string; brand: string; name: string; vehicleType: string; bodyType: string | null; yearFrom: number | null; yearTo: number | null; summary: string; review: string; pros: string[]; cons: string[]; buyerTips: string; imageUrl: string | null; status: 'DRAFT' | 'PUBLISHED'; archived: boolean;
  imageCredit: string | null; imageLicense: string | null; imageSourceUrl: string | null; featured: boolean; featuredOrder: number | null; catalogBrands: string[]; catalogNames: string[]; catalogExclude: string[] }
interface Version { id: string; name: string; yearModel: number | null; fuel: string | null; fipeCode: string | null; specs: Record<string, string | number | boolean>; displayOrder: number; active: boolean }
interface Opinion { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; rating: number; ratings: Record<string, number>; title: string; liked: string; disliked: string; comment: string; ownerSince: number | null; km: number | null; rejectReason: string | null; createdAt: string; model: { id: string; slug: string; label: string }; versionName: string | null; author: { id: string; name: string; email: string } }
interface Tip { id: string; category: string; title: string; body: string; modelId: string | null; modelLabel: string | null; status: 'DRAFT' | 'PUBLISHED'; displayOrder: number; archived: boolean; updatedAt: string }
interface ImportReport { dryRun: boolean; rows: number; modelsNew: number; modelsExisting: number; versionsNew: number; versionsUpdated: number; errors: Array<{ line: number; message: string }> }

const TYPE_LABEL: Record<string, string> = { CAR: 'Carro', MOTORCYCLE: 'Moto', TRUCK: 'Caminhão' };
const RATING_LABEL: Record<string, string> = { comfort: 'Conforto', performance: 'Desempenho', economy: 'Consumo', reliability: 'Confiabilidade', maintenance: 'Manutenção', finish: 'Acabamento' };
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const specGroups = (fields: SpecField[]) => [...new Set(fields.map((f) => f.group))];
const errText = (e: unknown) => {
  const details = e instanceof ApiError && Array.isArray(e.data?.details) ? (e.data.details as string[]).join('; ') : '';
  return details ? `${errorMessage(e)} ${details}` : errorMessage(e);
};

/* ========================================================================== */
export default function VehicleGuide() {
  usePageTitle('Guia de veículos');
  const [params, setParams] = useSearchParams();
  const tab = (['models', 'opinions', 'tips', 'consumption', 'fleet', 'import'].includes(params.get('aba') ?? '') ? params.get('aba') : 'models') as 'models' | 'opinions' | 'tips' | 'consumption' | 'fleet' | 'import';
  const meta = useAsync(() => api.get<Meta>('/admin/vehicles/meta'));
  if (meta.loading && !meta.data) return <PageLoading />;
  if (meta.error || !meta.data) return <ErrorState error={meta.error} onRetry={meta.reload} />;
  const m = meta.data;
  return (
    <>
      <PageHead title="Guia de veículos" sub="Fichas técnicas, review, dicas e opiniões de donos que aparecem no site em /veiculos e alimentam o comparador." />
      <Tabs label="Guia" value={tab} onChange={(v) => setParams(v === 'models' ? {} : { aba: v })} items={[
        { id: 'models', label: `Modelos (${m.models})` },
        { id: 'opinions', label: m.pendingOpinions ? `Opiniões (${m.pendingOpinions} para revisar)` : 'Opiniões' },
        { id: 'tips', label: `Dicas e cuidados (${m.tips})` },
        { id: 'consumption', label: 'Consumo oficial' },
        { id: 'fleet', label: 'Frota e interesse' },
        { id: 'import', label: 'Importar planilha' }
      ]} />
      {tab === 'models' && <ModelsTab meta={m} onChanged={meta.reload} />}
      {tab === 'opinions' && <OpinionsTab onChanged={meta.reload} />}
      {tab === 'tips' && <TipsTab meta={m} onChanged={meta.reload} />}
      {tab === 'consumption' && <ConsumptionTab />}
      {tab === 'fleet' && <FleetTab />}
      {tab === 'import' && <ImportTab onDone={meta.reload} />}
    </>
  );
}

/* ---------- Modelos ---------- */
function ModelsTab({ meta, onChanged }: { meta: Meta; onChanged: () => void }) {
  const toast = useToast();
  const [view, setView] = useState<'all' | 'draft' | 'published' | 'archived'>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const list = useAsync(() => api.get<{ items: ModelRow[] }>('/admin/vehicles', { query: { view, search: debounced } }), [view, debounced]);
  const [creating, setCreating] = useState(false);
  const [remove, setRemove] = useState<ModelRow | null>(null);
  async function act(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast.ok(ok); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); } }
  return (
    <>
      <div className="filters">
        <Tabs label="Situação" value={view} onChange={setView} items={[{ id: 'all', label: 'Ativos' }, { id: 'published', label: 'Publicados' }, { id: 'draft', label: 'Rascunhos' }, { id: 'archived', label: 'Arquivados' }]} />
        <Input icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar marca ou modelo" aria-label="Buscar" style={{ maxWidth: 280 }} />
        <span className="grow" />
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo modelo</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error || !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data.items.length ? (
        <EmptyState icon="car" title={debounced || view !== 'all' ? 'Nada com esse filtro' : 'Nenhum modelo cadastrado'}>{debounced || view !== 'all' ? 'Tente outro filtro.' : 'Cadastre o primeiro modelo ou importe uma planilha na aba “Importar planilha”. Modelos novos ficam como rascunho até você publicar.'}</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Veículo</th><th>Versões</th><th>Opiniões</th><th>Situação</th><th>Atualizado</th><th /></tr></thead><tbody>
          {list.data.items.map((m) => (
            <tr key={m.id} className={m.archived ? 'row-muted' : undefined}>
              <td><Link to={`/guia/${m.id}`}><b>{m.brand} {m.name}</b></Link><div className="muted" style={{ fontSize: 12.5 }}>{[TYPE_LABEL[m.vehicleType], m.bodyType].filter(Boolean).join(' · ')} · /veiculos/{m.slug}</div></td>
              <td className="num">{m.versions}{m.versions === 0 && <div className="tag-warn">sem ficha</div>}</td>
              <td className="num">{m.opinions}{m.pendingOpinions > 0 && <> <Badge tone="warn">{m.pendingOpinions} p/ revisar</Badge></>}</td>
              <td>{m.archived ? <Badge>Arquivado</Badge> : m.status === 'PUBLISHED' ? <Badge tone="ok" dot>Publicado</Badge> : <Badge tone="warn" dot>Rascunho</Badge>}{!m.hasText && !m.archived && <div className="tag-warn">falta resumo/review</div>}</td>
              <td>{dateTime(m.updatedAt)}</td>
              <td className="actions wrap">
                <Link className="btn btn-sm" to={`/guia/${m.id}`}>Editar</Link>{' '}
                {!m.archived && <Button size="sm" variant="ghost" onClick={() => void act(() => api.patch(`/admin/vehicles/${m.id}`, { status: m.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' }), m.status === 'PUBLISHED' ? 'Voltou para rascunho: saiu do site.' : 'Publicado no site.')}>{m.status === 'PUBLISHED' ? 'Despublicar' : 'Publicar'}</Button>}{' '}
                <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/admin/vehicles/${m.id}/archive`, { archived: !m.archived }), m.archived ? 'Restaurado como rascunho.' : 'Arquivado: saiu do site.')}>{m.archived ? 'Restaurar' : 'Arquivar'}</Button>{' '}
                <Button size="sm" variant="ghost" onClick={() => setRemove(m)}>Apagar</Button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {creating && <NewModel meta={meta} onClose={() => setCreating(false)} />}
      {remove && <ConfirmDialog danger title="Apagar este modelo?" confirmLabel="Apagar" message={`“${remove.brand} ${remove.name}” e todas as versões e dicas ligadas a ele serão apagadas. Modelos com opiniões de donos não podem ser apagados: arquive.`}
        onConfirm={async () => { try { await api.del(`/admin/vehicles/${remove.id}`); toast.ok('Modelo apagado.'); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); throw e; } }} onClose={() => setRemove(null)} />}
    </>
  );
}

function NewModel({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [brand, setBrand] = useState(''); const [name, setName] = useState(''); const [type, setType] = useState('CAR'); const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try { const r = await api.post<{ model: Model }>('/admin/vehicles', { brand: brand.trim(), name: name.trim(), vehicleType: type, bodyType: body || null }); nav(`/guia/${r.model.id}`); } catch (e) { toast.error(errText(e)); setBusy(false); }
  }
  return (
    <Modal title="Novo modelo" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={brand.trim().length < 2 || !name.trim()} onClick={() => void create()}>Criar e preencher ficha</Button></>}>
      <div className="stack">
        <p className="muted">Crie o modelo e, na próxima tela, preencha resumo, review e as versões com a ficha técnica. Ele nasce como rascunho: só aparece no site quando você publicar.</p>
        <div className="form-grid cols-2">
          <Field label="Marca"><Input value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={60} placeholder="Ex.: Chevrolet" /></Field>
          <Field label="Modelo"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Tracker" /></Field>
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="CAR">Carro</option><option value="MOTORCYCLE">Moto</option><option value="TRUCK">Caminhão</option></Select></Field>
          <Field label="Carroceria / categoria"><Select value={body} onChange={(e) => setBody(e.target.value)}><option value="">Não informar</option>{meta.bodyTypes.map((b) => <option key={b}>{b}</option>)}</Select></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ========================================================================== */
/*  Edição de um modelo                                                        */
/* ========================================================================== */
export function VehicleEdit() {
  const { id = '' } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const meta = useAsync(() => api.get<Meta>('/admin/vehicles/meta'));
  const res = useAsync(() => api.get<{ model: Model; versions: Version[]; opinions: { approved: number; pending: number } }>(`/admin/vehicles/${id}`), [id]);
  usePageTitle(res.data ? `${res.data.model.brand} ${res.data.model.name}` : 'Guia de veículos');
  const [versionEdit, setVersionEdit] = useState<Version | 'new' | null>(null);
  const [removeVersion, setRemoveVersion] = useState<Version | null>(null);
  if ((res.loading && !res.data) || (meta.loading && !meta.data)) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (meta.error || !meta.data) return <ErrorState error={meta.error} onRetry={meta.reload} />;
  const { model, versions, opinions } = res.data;
  const fields = meta.data.specFields;
  const filled = (v: Version) => Object.keys(v.specs).length;
  const checks = [
    { ok: model.summary.trim().length >= 20, label: 'Resumo escrito' },
    { ok: model.review.trim().length >= 100, label: 'Review escrito' },
    { ok: versions.some((v) => v.active), label: 'Pelo menos 1 versão ativa' },
    { ok: versions.some((v) => filled(v) >= 5), label: 'Ficha técnica com 5+ campos' }
  ];
  async function setStatus(status: 'DRAFT' | 'PUBLISHED') {
    try { await api.patch(`/admin/vehicles/${id}`, { status }); toast.ok(status === 'PUBLISHED' ? 'Publicado no site.' : 'Voltou para rascunho: saiu do site.'); res.reload(); } catch (e) { toast.error(errText(e)); }
  }
  return (
    <>
      <Link to="/guia" className="muted" style={{ fontSize: 14 }}>← Voltar ao guia</Link>
      <PageHead title={`${model.brand} ${model.name}`} sub={<>Endereço no site: <code>/veiculos/{model.slug}</code> · {TYPE_LABEL[model.vehicleType]}{model.bodyType ? ` · ${model.bodyType}` : ''}</>}
        actions={<>
          {model.archived ? <Badge>Arquivado</Badge> : <Switch checked={model.status === 'PUBLISHED'} onChange={(e) => void setStatus(e.target.checked ? 'PUBLISHED' : 'DRAFT')} label={model.status === 'PUBLISHED' ? 'Publicado no site' : 'Rascunho (não aparece no site)'} />}
          {opinions.pending > 0 && <Link className="btn btn-sm" to="/guia?aba=opinions">{opinions.pending} opinião(ões) para revisar</Link>}
        </>} />
      {model.status !== 'PUBLISHED' && !model.archived && (
        <Alert tone="info" title="Antes de publicar">
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{checks.map((c) => <li key={c.label}>{c.ok ? '✔' : '○'} {c.label}</li>)}</ul>
        </Alert>
      )}
      <ModelForm key={model.id + model.status} model={model} meta={meta.data} onSaved={res.reload} onSlugChanged={() => res.reload()} />
      <Card title="Versões e ficha técnica" actions={<Button variant="primary" size="sm" icon="plus" onClick={() => setVersionEdit('new')}>Nova versão</Button>}>
        {!versions.length ? <EmptyState icon="car" title="Nenhuma versão ainda">Cada versão (ex.: “Premier 1.4 Turbo 2018”) tem a própria ficha técnica e entra no comparador.</EmptyState> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Versão</th><th>Ano</th><th>Combustível</th><th>Ficha</th><th>Situação</th><th /></tr></thead><tbody>
            {versions.map((v) => (
              <tr key={v.id} className={v.active ? undefined : 'row-muted'}>
                <td><b>{v.name}</b>{v.fipeCode && <div className="muted" style={{ fontSize: 12.5 }}>FIPE {v.fipeCode}</div>}</td>
                <td className="num">{v.yearModel ?? '—'}</td>
                <td>{v.fuel ?? '—'}</td>
                <td>{filled(v)} de {fields.length} campos{filled(v) < 5 && <div className="tag-warn">ficha curta</div>}</td>
                <td>{v.active ? <Badge tone="ok" dot>Ativa</Badge> : <Badge>Oculta</Badge>}</td>
                <td className="actions wrap">
                  <Button size="sm" onClick={() => setVersionEdit(v)}>Editar ficha</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={async () => { try { await api.post(`/admin/vehicles/versions/${v.id}/duplicate`); toast.ok('Versão duplicada.'); res.reload(); } catch (e) { toast.error(errText(e)); } }}>Duplicar</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => setRemoveVersion(v)}>Apagar</Button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <Card title="Zona de cuidado">
        <div className="row">
          <Button variant="ghost" onClick={async () => { try { await api.post(`/admin/vehicles/${id}/archive`, { archived: !model.archived }); toast.ok(model.archived ? 'Restaurado como rascunho.' : 'Arquivado: saiu do site.'); res.reload(); } catch (e) { toast.error(errText(e)); } }}>{model.archived ? 'Restaurar modelo' : 'Arquivar modelo'}</Button>
          <Button variant="danger" onClick={async () => { if (!window.confirm('Apagar este modelo e suas versões? Isso não pode ser desfeito.')) return; try { await api.del(`/admin/vehicles/${id}`); toast.ok('Modelo apagado.'); nav('/guia'); } catch (e) { toast.error(errText(e)); } }}>Apagar modelo</Button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Arquivar tira do site sem perder nada. Apagar só é possível quando não há opiniões de donos.</p>
      </Card>
      {versionEdit && <VersionModal modelId={id} version={versionEdit === 'new' ? null : versionEdit} fields={fields} onClose={(changed) => { setVersionEdit(null); if (changed) res.reload(); }} />}
      {removeVersion && <ConfirmDialog danger title="Apagar versão?" confirmLabel="Apagar" message={`“${removeVersion.name}” sai do guia e do comparador. Se só quer esconder, edite a versão e desmarque “Ativa”.`}
        onConfirm={async () => { try { await api.del(`/admin/vehicles/versions/${removeVersion.id}`); toast.ok('Versão apagada.'); res.reload(); } catch (e) { toast.error(errText(e)); throw e; } }} onClose={() => setRemoveVersion(null)} />}
    </>
  );
}

function ModelForm({ model, meta, onSaved, onSlugChanged }: { model: Model; meta: Meta; onSaved: () => void; onSlugChanged: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    brand: model.brand, name: model.name, vehicleType: model.vehicleType, bodyType: model.bodyType ?? '', yearFrom: model.yearFrom ? String(model.yearFrom) : '', yearTo: model.yearTo ? String(model.yearTo) : '',
    summary: model.summary, imageUrl: model.imageUrl ?? '', imageCredit: model.imageCredit ?? '', imageLicense: model.imageLicense ?? '', imageSourceUrl: model.imageSourceUrl ?? '',
    featured: model.featured, featuredOrder: model.featuredOrder ? String(model.featuredOrder) : '',
    catalogBrands: model.catalogBrands.join(', '), catalogNames: model.catalogNames.join(', '), catalogExclude: model.catalogExclude.join(', '), pros: model.pros.join('\n'), cons: model.cons.join('\n'), review: model.review, buyerTips: model.buyerTips, slug: model.slug
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/vehicles/${model.id}`, {
        brand: f.brand.trim(), name: f.name.trim(), vehicleType: f.vehicleType, bodyType: f.bodyType || null, yearFrom: f.yearFrom ? Number(f.yearFrom) : null, yearTo: f.yearTo ? Number(f.yearTo) : null,
        summary: f.summary.trim(), imageUrl: f.imageUrl.trim() || null, imageCredit: f.imageCredit.trim() || null, imageLicense: f.imageLicense.trim() || null, imageSourceUrl: f.imageSourceUrl.trim() || null,
        featured: f.featured, featuredOrder: f.featured && f.featuredOrder ? Number(f.featuredOrder) : null, catalogBrands: list(f.catalogBrands), catalogNames: list(f.catalogNames), catalogExclude: list(f.catalogExclude), pros: lines(f.pros), cons: lines(f.cons), review: f.review, buyerTips: f.buyerTips, ...(f.slug !== model.slug ? { slug: f.slug.trim() } : {})
      });
      toast.ok('Modelo salvo.'); onSaved(); if (f.slug !== model.slug) onSlugChanged();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }
  return (
    <Card title="Dados do modelo" actions={<Button variant="primary" loading={busy} onClick={() => void save()}>Salvar modelo</Button>}>
      <div className="stack">
        <div className="form-grid cols-2">
          <Field label="Marca"><Input value={f.brand} onChange={(e) => set('brand', e.target.value)} maxLength={60} /></Field>
          <Field label="Modelo"><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} /></Field>
          <Field label="Tipo"><Select value={f.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}><option value="CAR">Carro</option><option value="MOTORCYCLE">Moto</option><option value="TRUCK">Caminhão</option></Select></Field>
          <Field label="Carroceria / categoria"><Select value={f.bodyType} onChange={(e) => set('bodyType', e.target.value)}><option value="">Não informar</option>{meta.bodyTypes.map((b) => <option key={b}>{b}</option>)}</Select></Field>
          <Field label="Produzido desde (ano)"><Input inputMode="numeric" value={f.yearFrom} onChange={(e) => set('yearFrom', e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
          <Field label="Até (ano)" hint="Deixe vazio se ainda é produzido."><Input inputMode="numeric" value={f.yearTo} onChange={(e) => set('yearTo', e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
        </div>
        <Field label="Resumo (aparece no card e nos buscadores)" hint={`${f.summary.length}/400`}><Textarea rows={2} value={f.summary} onChange={(e) => set('summary', e.target.value)} maxLength={400} /></Field>
        <div className="form-grid cols-2">
          <Field label="Pontos fortes" hint="Um por linha (até 10)."><Textarea rows={5} value={f.pros} onChange={(e) => set('pros', e.target.value)} /></Field>
          <Field label="Pontos de atenção" hint="Um por linha (até 10)."><Textarea rows={5} value={f.cons} onChange={(e) => set('cons', e.target.value)} /></Field>
        </div>
        <Field label="Review (só quem tem conta lê completo)" hint="Aceita **negrito**, listas com “-”, títulos com “##” e links. Escreva com texto próprio: não copie de outros sites."><Textarea rows={12} value={f.review} onChange={(e) => set('review', e.target.value)} maxLength={20000} /></Field>
        <Field label="O que olhar antes de comprar" hint="Pontos de inspeção, problemas conhecidos, itens de revisão."><Textarea rows={6} value={f.buyerTips} onChange={(e) => set('buyerTips', e.target.value)} maxLength={8000} /></Field>
        <Field label="Foto de capa (endereço https)" hint="Use só imagens que você tem direito de usar (própria, licenciada ou de licença livre). Sem foto, o site mostra um painel com o nome do modelo."><Input value={f.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" maxLength={500} /></Field>
        {f.imageUrl.trim() && (
          <div className="form-grid cols-2">
            <Field label="Crédito da foto" hint="Obrigatório em licenças como CC BY. Aparece no card e na ficha."><Input value={f.imageCredit} onChange={(e) => set('imageCredit', e.target.value)} maxLength={200} placeholder="Ex.: Nome do autor / Wikimedia Commons" /></Field>
            <Field label="Licença"><Input value={f.imageLicense} onChange={(e) => set('imageLicense', e.target.value)} maxLength={120} placeholder="Ex.: CC BY-SA 4.0" /></Field>
            <Field label="Página de origem da foto (https)"><Input value={f.imageSourceUrl} onChange={(e) => set('imageSourceUrl', e.target.value)} maxLength={500} placeholder="https://…" /></Field>
          </div>
        )}
        <div className="form-grid cols-2">
          <Field label="Destaque na home do guia" hint="Sem destaque marcado, a home mostra os modelos com mais veículos na frota (Senatran). No máximo 6 aparecem."><Switch checked={f.featured} onChange={(e) => set('featured', e.target.checked)} label="Destacar este modelo" /></Field>
          {f.featured && <Field label="Posição" hint="1 aparece primeiro."><Input inputMode="numeric" value={f.featuredOrder} onChange={(e) => set('featuredOrder', e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>}
        </div>
        <details><summary className="link-btn">Avançado: ligação com a frota do Senatran</summary>
          <p className="muted" style={{ fontSize: 13 }}>O Senatran escreve “CHEV/ONIX 10MT LT2”, “VW/POLO TRACK MA” etc. A ligação procura nomes que começam com a marca e o modelo. Só preencha se o nome estiver diferente do usual. Separe por vírgula.</p>
          <div className="form-grid cols-2">
            <Field label="Marcas extras (como o Senatran escreve)"><Input value={f.catalogBrands} onChange={(e) => set('catalogBrands', e.target.value)} placeholder="Ex.: chev, gm" /></Field>
            <Field label="Nomes do modelo (se diferente)"><Input value={f.catalogNames} onChange={(e) => set('catalogNames', e.target.value)} placeholder="Ex.: t cross, tcross" /></Field>
            <Field label="Palavras que NÃO pertencem a este modelo"><Input value={f.catalogExclude} onChange={(e) => set('catalogExclude', e.target.value)} placeholder="Ex.: plus" /></Field>
          </div>
        </details>
        <details><summary className="link-btn">Avançado: endereço (slug)</summary>
          <Field label="Endereço da página" hint="Mudar quebra links já compartilhados. Use só letras minúsculas, números e hífen."><Input value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={90} /></Field>
        </details>
      </div>
    </Card>
  );
}

function VersionModal({ modelId, version, fields, onClose }: { modelId: string; version: Version | null; fields: SpecField[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => {
    const v = version?.specs[f.key];
    return [f.key, v === undefined ? '' : f.kind === 'bool' ? (v ? 'sim' : 'não') : String(v).replace('.', ',')];
  })), [fields, version]);
  const [specs, setSpecs] = useState<Record<string, string>>(initial);
  const [name, setName] = useState(version?.name ?? '');
  const [year, setYear] = useState(version?.yearModel ? String(version.yearModel) : '');
  const [fuel, setFuel] = useState(version?.fuel ?? '');
  const [fipe, setFipe] = useState(version?.fipeCode ?? '');
  const [active, setActive] = useState(version?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const top = useRef<HTMLDivElement>(null);
  async function save() {
    setBusy(true); setErr('');
    const body = { name: name.trim(), yearModel: year ? Number(year) : null, fuel: fuel.trim() || null, fipeCode: fipe.trim() || null, active, specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim() !== '')) };
    try {
      if (version) await api.patch(`/admin/vehicles/versions/${version.id}`, body); else await api.post(`/admin/vehicles/${modelId}/versions`, body);
      toast.ok('Versão salva.'); onClose(true);
    } catch (e) { setErr(errText(e)); setBusy(false); top.current?.scrollIntoView?.({ block: 'nearest' }); }
  }
  return (
    <Modal wide title={version ? `Ficha técnica — ${version.name}` : 'Nova versão'} onClose={() => onClose(false)}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>Salvar versão</Button></>}>
      <div className="stack" ref={top}>
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="form-grid cols-2">
          <Field label="Nome da versão" hint="Ex.: Premier 1.4 Turbo 16V Flex Aut."><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Ano-modelo"><Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
          <Field label="Combustível"><Input value={fuel} onChange={(e) => setFuel(e.target.value)} maxLength={40} placeholder="Flex, Gasolina, Diesel, Elétrico…" /></Field>
          <Field label="Código FIPE (opcional)"><Input value={fipe} onChange={(e) => setFipe(e.target.value)} maxLength={20} placeholder="000000-0" /></Field>
        </div>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Ativa (aparece no guia e no comparador)" />
        <Alert tone="info">Preencha só o que você tem de fonte confiável (manual do fabricante, ficha oficial, teste publicado). Campo vazio simplesmente não aparece. Números aceitam vírgula (ex.: 10,8).</Alert>
        {specGroups(fields).map((g) => (
          <div key={g} className="stack-sm">
            <h4 className="section-title">{g}</h4>
            <div className="form-grid cols-3">
              {fields.filter((f) => f.group === g).map((f) => (
                <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                  {f.kind === 'bool'
                    ? <Select value={specs[f.key]} onChange={(e) => setSpecs((p) => ({ ...p, [f.key]: e.target.value }))}><option value="">Não informado</option><option value="sim">Sim</option><option value="não">Não</option></Select>
                    : <Input inputMode={f.kind === 'number' ? 'decimal' : undefined} value={specs[f.key]} onChange={(e) => setSpecs((p) => ({ ...p, [f.key]: e.target.value }))} maxLength={160} />}
                </Field>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Opiniões ---------- */
function OpinionsTab({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING');
  const list = useAsync(() => api.get<{ items: Opinion[] }>('/admin/vehicles/opinions', { query: { status } }), [status]);
  const [reject, setReject] = useState<Opinion | null>(null);
  const [remove, setRemove] = useState<Opinion | null>(null);
  const [reason, setReason] = useState('');
  async function approve(o: Opinion) { try { await api.post(`/admin/vehicles/opinions/${o.id}/approve`); toast.ok('Opinião publicada.'); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); } }
  return (
    <>
      <Tabs label="Situação" value={status} onChange={setStatus} items={[{ id: 'PENDING', label: 'Para revisar' }, { id: 'APPROVED', label: 'Publicadas' }, { id: 'REJECTED', label: 'Recusadas' }, { id: '', label: 'Todas' }]} />
      <p className="muted" style={{ fontSize: 13.5 }}>Publique só opiniões de uso real do veículo. Recuse spam, ofensas, propaganda e dados pessoais. O público vê só o primeiro nome e a inicial do sobrenome; o e-mail abaixo é só para a equipe.</p>
      {list.loading && !list.data ? <PageLoading /> : list.error || !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data.items.length ? <EmptyState icon="check-circle" title={status === 'PENDING' ? 'Nada para revisar' : 'Nenhuma opinião aqui'} /> : (
        <div className="stack">
          {list.data.items.map((o) => (
            <Card key={o.id}>
              <div className="between">
                <div><b>{o.model.label}</b>{o.versionName && <span className="muted"> · {o.versionName}</span>} <Badge tone={o.status === 'APPROVED' ? 'ok' : o.status === 'REJECTED' ? 'danger' : 'warn'} dot>{o.status === 'APPROVED' ? 'Publicada' : o.status === 'REJECTED' ? 'Recusada' : 'Para revisar'}</Badge></div>
                <span className="muted" style={{ fontSize: 12.5 }}>{dateTime(o.createdAt)}</span>
              </div>
              <div style={{ color: '#F5A524', letterSpacing: 2, fontSize: 18 }} aria-label={`Nota ${o.rating} de 5`}>{stars(o.rating)}</div>
              {o.title && <b>{o.title}</b>}
              {o.liked && <p><b>Gostou:</b> {o.liked}</p>}
              {o.disliked && <p><b>Não gostou:</b> {o.disliked}</p>}
              {o.comment && <p>{o.comment}</p>}
              <div className="muted" style={{ fontSize: 12.5 }}>
                {Object.entries(o.ratings).map(([k, v]) => `${RATING_LABEL[k] ?? k}: ${v}/5`).join(' · ')}{Object.keys(o.ratings).length ? ' · ' : ''}
                {o.ownerSince ? `dono desde ${o.ownerSince} · ` : ''}{o.km != null ? `${o.km.toLocaleString('pt-BR')} km · ` : ''}por {o.author.name} ({o.author.email})
              </div>
              {o.status === 'REJECTED' && o.rejectReason && <div className="tag-warn">Motivo da recusa: {o.rejectReason}</div>}
              <div className="row">
                {o.status !== 'APPROVED' && <Button variant="primary" size="sm" onClick={() => void approve(o)}>Publicar</Button>}
                {o.status !== 'REJECTED' && <Button size="sm" onClick={() => { setReject(o); setReason(''); }}>Recusar</Button>}
                <Button size="sm" variant="ghost" onClick={() => setRemove(o)}>Apagar</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {reject && (
        <Modal title="Recusar opinião" onClose={() => setReject(null)} footer={<><Button variant="ghost" onClick={() => setReject(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { try { await api.post(`/admin/vehicles/opinions/${reject.id}/reject`, { reason: reason.trim() }); toast.ok('Opinião recusada.'); setReject(null); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); } }}>Recusar</Button></>}>
          <Field label="Motivo (o autor vê e pode editar e reenviar)" hint="Ex.: contém propaganda; fora do tema; linguagem ofensiva."><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        </Modal>
      )}
      {remove && <ConfirmDialog danger title="Apagar opinião?" confirmLabel="Apagar" message="A opinião some de vez e o autor pode enviar outra. Para apenas tirar do ar mantendo o registro, use Recusar."
        onConfirm={async () => { try { await api.del(`/admin/vehicles/opinions/${remove.id}`); toast.ok('Opinião apagada.'); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); throw e; } }} onClose={() => setRemove(null)} />}
    </>
  );
}

/* ---------- Dicas ---------- */
function TipsTab({ meta, onChanged }: { meta: Meta; onChanged: () => void }) {
  const toast = useToast();
  const [archived, setArchived] = useState(false);
  const list = useAsync(() => api.get<{ items: Tip[] }>('/admin/vehicles/tips', { query: { archived } }), [archived]);
  const models = useAsync(() => api.get<{ items: ModelRow[] }>('/admin/vehicles', { query: { view: 'all' } }));
  const [edit, setEdit] = useState<Tip | 'new' | null>(null);
  const [remove, setRemove] = useState<Tip | null>(null);
  const catLabel = (k: string) => meta.tipCategories.find((c) => c.key === k)?.label ?? k;
  async function act(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast.ok(ok); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); } }
  return (
    <>
      <div className="filters">
        <Tabs label="Dicas" value={archived ? 'archived' : 'live'} onChange={(v) => setArchived(v === 'archived')} items={[{ id: 'live', label: 'Dicas' }, { id: 'archived', label: 'Arquivadas' }]} />
        <span className="grow" />
        <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nova dica</Button>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>Dicas gerais aparecem em /veiculos. Dicas ligadas a um modelo aparecem só na ficha dele (para quem tem conta).</p>
      {list.loading && !list.data ? <PageLoading /> : list.error || !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data.items.length ? <EmptyState icon="info" title={archived ? 'Nenhuma dica arquivada' : 'Nenhuma dica cadastrada'}>{archived ? '' : 'Escreva dicas de cuidados, manutenção, compra e economia com texto próprio.'}</EmptyState> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Dica</th><th>Categoria</th><th>Vale para</th><th>Situação</th><th /></tr></thead><tbody>
          {list.data.items.map((t) => (
            <tr key={t.id}>
              <td><b>{t.title}</b><div className="muted" style={{ fontSize: 12.5, maxWidth: 520 }}>{t.body.slice(0, 120)}{t.body.length > 120 ? '…' : ''}</div></td>
              <td><Badge>{catLabel(t.category)}</Badge></td>
              <td>{t.modelLabel ?? 'Todos (geral)'}</td>
              <td>{t.archived ? <Badge>Arquivada</Badge> : t.status === 'PUBLISHED' ? <Badge tone="ok" dot>Publicada</Badge> : <Badge tone="warn" dot>Rascunho</Badge>}</td>
              <td className="actions wrap">
                <Button size="sm" onClick={() => setEdit(t)}>Editar</Button>{' '}
                <Button size="sm" variant="ghost" onClick={() => void act(() => api.post(`/admin/vehicles/tips/${t.id}/archive`, { archived: !t.archived }), t.archived ? 'Dica restaurada como rascunho.' : 'Dica arquivada.')}>{t.archived ? 'Restaurar' : 'Arquivar'}</Button>{' '}
                <Button size="sm" variant="ghost" onClick={() => setRemove(t)}>Apagar</Button>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {edit && <TipModal tip={edit === 'new' ? null : edit} meta={meta} models={models.data?.items ?? []} onClose={(c) => { setEdit(null); if (c) { list.reload(); onChanged(); } }} />}
      {remove && <ConfirmDialog danger title="Apagar dica?" confirmLabel="Apagar" message={`“${remove.title}” será apagada de vez. Para só tirar do site, use Arquivar.`}
        onConfirm={async () => { try { await api.del(`/admin/vehicles/tips/${remove.id}`); toast.ok('Dica apagada.'); list.reload(); onChanged(); } catch (e) { toast.error(errText(e)); throw e; } }} onClose={() => setRemove(null)} />}
    </>
  );
}

function TipModal({ tip, meta, models, onClose }: { tip: Tip | null; meta: Meta; models: ModelRow[]; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [category, setCategory] = useState(tip?.category ?? 'CUIDADOS');
  const [title, setTitle] = useState(tip?.title ?? '');
  const [body, setBody] = useState(tip?.body ?? '');
  const [modelId, setModelId] = useState(tip?.modelId ?? '');
  const [published, setPublished] = useState(tip ? tip.status === 'PUBLISHED' : true);
  const [order, setOrder] = useState(String(tip?.displayOrder ?? 0));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const payload = { category, title: title.trim(), body, modelId: modelId || null, status: published ? 'PUBLISHED' : 'DRAFT', displayOrder: Number(order) || 0 };
    try { if (tip) await api.patch(`/admin/vehicles/tips/${tip.id}`, payload); else await api.post('/admin/vehicles/tips', payload); toast.ok('Dica salva.'); onClose(true); } catch (e) { toast.error(errText(e)); setBusy(false); }
  }
  return (
    <Modal wide title={tip ? 'Editar dica' : 'Nova dica'} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={title.trim().length < 3} onClick={() => void save()}>Salvar dica</Button></>}>
      <div className="stack">
        <Field label="Título"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} /></Field>
        <Field label="Texto" hint="Aceita **negrito**, listas com “-” e links. Escreva com texto próprio."><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} /></Field>
        <div className="form-grid cols-2">
          <Field label="Categoria"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{meta.tipCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
          <Field label="Vale para"><Select value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">Todos os veículos (dica geral)</option>{models.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.name}</option>)}</Select></Field>
          <Field label="Ordem" hint="Menor aparece primeiro."><Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Switch checked={published} onChange={(e) => setPublished(e.target.checked)} label="Publicada no site" />
      </div>
    </Modal>
  );
}

/* ---------- Importação ---------- */
function ImportTab({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportReport | null>(null);
  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<ImportReport>('/admin/vehicles/import', { csv, dryRun });
      if (dryRun) { setReport(r); setDone(null); } else { setDone(r); setReport(null); setCsv(''); setFileName(''); toast.ok('Importação concluída.'); onDone(); }
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name); setReport(null); setDone(null);
    setCsv(await file.text());
  }
  return (
    <div className="stack">
      <Card title="Como funciona">
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>Baixe a planilha modelo e preencha uma linha por <b>versão</b> (colunas <code>marca</code>, <code>modelo</code> e <code>versao</code> são obrigatórias; as demais são opcionais).</li>
          <li>Envie o arquivo (.csv) e clique em <b>Conferir</b>: nada é gravado ainda, você vê o que será criado e os erros por linha.</li>
          <li>Clique em <b>Importar</b>. Modelos novos entram como <b>rascunho</b>; você escreve o review e publica. Reenviar a mesma planilha atualiza as versões, sem duplicar.</li>
        </ol>
        <div className="row" style={{ marginTop: 12 }}><Button icon="download" onClick={() => void api.download('/admin/vehicles/import/template.csv', 'modelo-importacao-guia-veiculos.csv').catch((e) => toast.error(errText(e)))}>Baixar planilha modelo</Button></div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Importe só dados de fonte que você pode usar (fabricante, bases licenciadas, medições próprias). Aceita separador “;” ou “,”, até 2.000 linhas por vez.</p>
      </Card>
      <Card title="Enviar planilha">
        <div className="stack">
          <label className="btn" style={{ width: 'fit-content', cursor: 'pointer' }}>
            Escolher arquivo .csv
            <input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {fileName && <span className="muted">{fileName} · {csv.split(/\r?\n/).filter(Boolean).length - 1} linha(s) de dados</span>}
          <div className="row"><Button variant="primary" loading={busy && !report} disabled={!csv} onClick={() => void run(true)}>Conferir</Button>
            {report && <Button variant="primary" loading={busy} disabled={report.versionsNew + report.versionsUpdated === 0} onClick={() => void run(false)}>Importar {report.versionsNew + report.versionsUpdated} versão(ões)</Button>}</div>
        </div>
      </Card>
      {report && (
        <Alert tone={report.errors.length ? 'warn' : 'ok'} title="Prévia (nada foi gravado)">
          {report.modelsNew} modelo(s) novo(s) · {report.modelsExisting} já existente(s) · {report.versionsNew} versão(ões) nova(s) · {report.versionsUpdated} a atualizar.
          {report.errors.length > 0 && <><div style={{ marginTop: 6 }}><b>{report.errors.length} linha(s) com problema serão ignoradas:</b></div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{report.errors.slice(0, 30).map((e) => <li key={e.line}>Linha {e.line}: {e.message}</li>)}</ul></>}
        </Alert>
      )}
      {done && <Alert tone="ok" title="Importação concluída">{done.modelsNew} modelo(s) criado(s) como rascunho, {done.versionsNew} versão(ões) criada(s), {done.versionsUpdated} atualizada(s){done.errors.length ? `, ${done.errors.length} linha(s) ignorada(s)` : ''}. Veja na aba Modelos → Rascunhos.</Alert>}
    </div>
  );
}

/* ---------- Consumo oficial (observações por fonte) ---------- */
interface ConsumptionRow { id: string; brand: string; model: string; versionLabel: string; modelYear: number | null; segment: string | null; propulsion: string | null; fuel: string; cityKml: number | null; roadKml: number | null; cycle: string; sourceKind: string; sourceName: string; sourceUrl: string; collectedAt: string; status: 'CONFERIDO' | 'A_CONFERIR'; note: string; modelSlug: string | null }
interface ConsumptionList { counts: { conferido: number; aConferir: number }; items: ConsumptionRow[] }
interface ConsumptionReport { dryRun: boolean; rows: number; created: number; updated: number; keptConfirmed: number; errors: Array<{ line: number; message: string }> }
const kmlStr = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

function ConsumptionTab() {
  const toast = useToast();
  const [status, setStatus] = useState<'' | 'CONFERIDO' | 'A_CONFERIR'>('A_CONFERIR');
  const [search, setSearch] = useState('');
  const list = useAsync(() => api.get<ConsumptionList>('/admin/vehicles/consumption', { query: { status, search } }), [status, search]);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ConsumptionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<ConsumptionRow | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<ConsumptionReport>('/admin/vehicles/consumption/import', { csv, dryRun });
      if (dryRun) setReport(r); else { setReport(null); setCsv(''); setFileName(''); toast.ok(`${r.created} registro(s) novo(s) e ${r.updated} atualizado(s). Falta conferir antes de aparecer no site.`); list.reload(); }
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name); setReport(null); setCsv(await file.text());
  }
  async function setOk(row: ConsumptionRow, next: 'CONFERIDO' | 'A_CONFERIR') {
    try { await api.patch(`/admin/vehicles/consumption/${row.id}`, { status: next }); toast.ok(next === 'CONFERIDO' ? 'Marcado como conferido: já aparece no site.' : 'Voltou para “a conferir”: saiu do site.'); list.reload(); } catch (e) { toast.error(errText(e)); }
  }

  return (
    <div className="stack">
      <Card title="Como funciona">
        <p style={{ margin: 0 }}>Cada número de consumo fica guardado <b>com a fonte, o ciclo e a data</b>. O que você importa aqui entra como <b>“a conferir”</b> e <b>não aparece no site</b> até alguém comparar com a tabela oficial (por exemplo, o PDF do Inmetro) e marcar como <b>conferido</b>. Conflitos entre fontes ficam lado a lado, sem média.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <Button icon="download" onClick={() => void api.download('/admin/vehicles/consumption/template.csv', 'modelo-importacao-consumo-oficial.csv').catch((e) => toast.error(errText(e)))}>Baixar planilha modelo</Button>
          <label className="btn" style={{ cursor: 'pointer' }}>Escolher arquivo .csv<input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
          {fileName && <span className="muted">{fileName}</span>}
          <Button variant="primary" loading={busy && !report} disabled={!csv} onClick={() => void run(true)}>Conferir planilha</Button>
          {report && <Button variant="primary" loading={busy} disabled={report.created + report.updated === 0} onClick={() => void run(false)}>Importar {report.created + report.updated} linha(s)</Button>}
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Colunas: marca, modelo, ano_modelo, versao_pbev, segmento_pbev, propulsao, combustivel_comparado, consumo_urbano_km_l, consumo_rodoviario_km_l, unidade_consumo, fonte_consumo (URL https), ciclo_pbev e observacoes. Use NA para o que a fonte não informa.</p>
      </Card>
      {report && (
        <Alert tone={report.errors.length ? 'warn' : 'ok'} title="Prévia (nada foi gravado)">
          {report.created} nova(s) · {report.updated} a atualizar · {report.keptConfirmed} já conferida(s), mantida(s) como estão.
          {report.errors.length > 0 && <><div style={{ marginTop: 6 }}><b>{report.errors.length} linha(s) com problema serão ignoradas:</b></div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{report.errors.slice(0, 30).map((e) => <li key={e.line}>Linha {e.line}: {e.message}</li>)}</ul></>}
        </Alert>
      )}
      <Card title={list.data ? `Registros (${list.data.counts.conferido} conferidos, ${list.data.counts.aConferir} a conferir)` : 'Registros'}>
        <div className="row" style={{ marginBottom: 12 }}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Situação" style={{ maxWidth: 220 }}><option value="A_CONFERIR">A conferir</option><option value="CONFERIDO">Conferidos</option><option value="">Todos</option></Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar marca, modelo ou versão" aria-label="Buscar" style={{ maxWidth: 320 }} />
        </div>
        {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.items.length ? <EmptyState icon="car" title="Nada por aqui">Importe uma planilha ou troque o filtro.</EmptyState> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Veículo (rótulo da fonte)</th><th>Comb.</th><th className="r">Cidade</th><th className="r">Estrada</th><th>Fonte</th><th>Situação</th><th /></tr></thead><tbody>
            {list.data.items.map((o) => (
              <tr key={o.id}>
                <td><b>{o.brand} {o.model}</b><div className="muted small">{o.versionLabel}{o.modelYear ? ` · ${o.modelYear}` : ''}{!o.modelSlug && ' · sem modelo no guia'}</div>{o.note && <div className="muted small">{o.note}</div>}</td>
                <td>{o.fuel}</td>
                <td className="r">{kmlStr(o.cityKml)}</td>
                <td className="r">{kmlStr(o.roadKml)}</td>
                <td><a href={o.sourceUrl} target="_blank" rel="noopener noreferrer">{o.sourceName}</a><div className="muted small">{o.cycle} · {o.collectedAt.split('-').reverse().join('/')}</div></td>
                <td><Badge tone={o.status === 'CONFERIDO' ? 'ok' : 'warn'} dot>{o.status === 'CONFERIDO' ? 'Conferido' : 'A conferir'}</Badge></td>
                <td className="actions">
                  {o.status === 'A_CONFERIR' ? <Button size="sm" variant="primary" disabled={!o.modelSlug} title={o.modelSlug ? '' : 'Cadastre o modelo no guia antes'} onClick={() => void setOk(o, 'CONFERIDO')}>Marcar conferido</Button> : <Button size="sm" variant="ghost" onClick={() => void setOk(o, 'A_CONFERIR')}>Tirar do site</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setRemove(o)}>Apagar</Button>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {remove && <ConfirmDialog title="Apagar registro de consumo" message={<p>Apagar <b>{remove.brand} {remove.model} {remove.versionLabel}</b> ({remove.fuel})?</p>} confirmLabel="Apagar" danger
        onConfirm={async () => { try { await api.del(`/admin/vehicles/consumption/${remove.id}`); toast.ok('Registro apagado.'); list.reload(); } catch (e) { toast.error(errText(e)); throw e; } }} onClose={() => setRemove(null)} />}
    </div>
  );
}

/* ---------- Frota (Senatran) e interesse ---------- */
interface CatalogSummary { snapshots: Array<{ snapshot: string; names: number; fleet: number; sourceName: string; license: string; loadedAt: string }>; names: number; fleet: number; matchedNames: number; matchedFleet: number; models: Array<{ id: string; brand: string; name: string; slug: string; names: number; fleet: number }> }
interface CatalogImportReport { dryRun: boolean; snapshot: string; names: number; fleet: number; newNames: number; existingNames: number; errors: Array<{ line: number; message: string }>; previous: { snapshot: string; names: number; fleet: number } | null; matched: { matched: number; models: number } | null }
interface InterestReport { days: number; totals: Record<string, { events: number; sessions: number }>; picks: Array<{ id: number; name: string; fleet: number; type: string; count: number }>; models: Array<{ brand: string; name: string; slug: string; views: number }>; noResult: Array<{ term: string; count: number }> }
const nfAdmin = new Intl.NumberFormat('pt-BR');

function FleetTab() {
  const toast = useToast();
  const summary = useAsync(() => api.get<CatalogSummary>('/admin/vehicles/catalog/summary'));
  const [days, setDays] = useState(30);
  const interest = useAsync(() => api.get<InterestReport>('/admin/vehicles/interest', { query: { days } }), [days]);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [snapshot, setSnapshot] = useState('');
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.post<CatalogImportReport>('/admin/vehicles/catalog/import', { csv, snapshot, dryRun });
      if (dryRun) setReport(r); else { setReport(null); setCsv(''); setFileName(''); toast.ok(`Snapshot ${r.snapshot} importado: ${nfAdmin.format(r.newNames)} nome(s) novo(s).`); summary.reload(); }
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setFileName(file.name); setReport(null); setCsv(await file.text());
    const m = file.name.match(/(20\d{2})[-_ ]?(0[1-9]|1[0-2])/);
    if (m && !snapshot) setSnapshot(`${m[1]}-${m[2]}`);
  }
  const t = (k: string) => interest.data?.totals[k];
  return (
    <div className="stack">
      <Card title="Catálogo de frota (Senatran)">
        {summary.loading && !summary.data ? <PageLoading /> : summary.error || !summary.data ? <ErrorState error={summary.error} onRetry={summary.reload} /> : (
          <div className="stack">
            <p style={{ margin: 0 }}><b>{nfAdmin.format(summary.data.names)}</b> nomes de veículos, somando <b>{nfAdmin.format(summary.data.fleet)}</b> veículos na frota. <b>{nfAdmin.format(summary.data.matchedNames)}</b> nomes ({nfAdmin.format(summary.data.matchedFleet)} veículos) estão ligados a modelos do guia.</p>
            {summary.data.snapshots.map((s) => <p key={s.snapshot} className="muted small" style={{ margin: 0 }}>Snapshot {s.snapshot}: {nfAdmin.format(s.names)} nomes, carga em {dateTime(s.loadedAt)}. {s.sourceName}. Licença: {s.license}.</p>)}
            <details><summary className="link-btn">Ligação por modelo do guia</summary>
              <div className="table-wrap"><table className="table"><thead><tr><th>Modelo</th><th className="r">Nomes ligados</th><th className="r">Frota</th></tr></thead><tbody>
                {summary.data.models.map((m) => <tr key={m.id}><td><Link to={`/guia/${m.id}`}>{m.brand} {m.name}</Link></td><td className="r">{m.names}</td><td className="r">{nfAdmin.format(m.fleet)}</td></tr>)}
              </tbody></table></div>
            </details>
          </div>
        )}
      </Card>

      <Card title="Importar um snapshot novo">
        <p style={{ margin: 0 }}>Envie o CSV público do Senatran (separado por “;”, com as colunas <code>marca_modelo_original</code>, <code>ano_fabricacao_original</code> e <code>quantidade_veiculos_frota_…</code>). Nomes novos entram; nomes que já existem têm a frota atualizada; nomes que sumiram do arquivo ficam como estavam. Nada é “limpo” ou reescrito.</p>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <label className="btn" style={{ cursor: 'pointer' }}>Escolher arquivo .csv<input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => void pick(e.target.files?.[0])} /></label>
          {fileName && <span className="muted">{fileName}</span>}
          <Input value={snapshot} onChange={(e) => setSnapshot(e.target.value.replace(/[^\d-]/g, '').slice(0, 7))} placeholder="Mês: 2026-09" aria-label="Mês do arquivo (AAAA-MM)" style={{ maxWidth: 150 }} />
          <Button variant="primary" loading={busy && !report} disabled={!csv || !/^\d{4}-\d{2}$/.test(snapshot)} onClick={() => void run(true)}>Conferir arquivo</Button>
          {report && <Button variant="primary" loading={busy} disabled={report.errors.length > 0} onClick={() => void run(false)}>Importar {nfAdmin.format(report.names)} nomes</Button>}
        </div>
        {report && (
          <Alert tone={report.errors.length ? 'warn' : 'ok'} title="Prévia (nada foi gravado)">
            {nfAdmin.format(report.names)} nomes · {nfAdmin.format(report.fleet)} veículos · {nfAdmin.format(report.newNames)} novos · {nfAdmin.format(report.existingNames)} já existentes.
            {report.previous && <> Snapshot anterior ({report.previous.snapshot}): {nfAdmin.format(report.previous.names)} nomes, {nfAdmin.format(report.previous.fleet)} veículos.</>}
            {report.errors.length > 0 && <><div style={{ marginTop: 6 }}><b>{report.errors.length} linha(s) com problema. Corrija o arquivo antes de importar:</b></div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{report.errors.slice(0, 30).map((e) => <li key={e.line}>Linha {e.line}: {e.message}</li>)}</ul></>}
          </Alert>
        )}
      </Card>

      <Card title="O que as pessoas procuram" actions={<Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período" style={{ maxWidth: 170 }}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></Select>}>
        {interest.loading && !interest.data ? <PageLoading /> : interest.error || !interest.data ? <ErrorState error={interest.error} onRetry={interest.reload} /> : (
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>Sem conta e sem dado pessoal: guardamos só qual veículo foi escolhido e uma identificação anônima da visita. Escolhas repetidas na mesma visita contam uma vez.</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 18 }}>
              <span><b>{t('SIMULATOR_PICK')?.events ?? 0}</b> escolhas no simulador</span>
              <span><b>{t('SEARCH_PICK')?.events ?? 0}</b> escolhas na busca</span>
              <span><b>{t('MODEL_VIEW')?.events ?? 0}</b> fichas abertas</span>
              <span><b>{t('SEARCH_NO_RESULT')?.events ?? 0}</b> buscas sem resultado</span>
            </div>
            <div className="form-grid cols-2" style={{ alignItems: 'start' }}>
              <div>
                <h4>Veículos mais escolhidos</h4>
                {!interest.data.picks.length ? <p className="muted small">Ainda sem dados neste período.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Nome (Senatran)</th><th>Onde</th><th className="r">Vezes</th></tr></thead><tbody>
                  {interest.data.picks.slice(0, 20).map((p) => <tr key={`${p.id}-${p.type}`}><td>{p.name}<div className="muted small">{nfAdmin.format(p.fleet)} na frota</div></td><td>{p.type === 'SIMULATOR_PICK' ? 'Simulador' : 'Busca'}</td><td className="r">{p.count}</td></tr>)}
                </tbody></table></div>}
              </div>
              <div>
                <h4>Fichas mais abertas</h4>
                {!interest.data.models.length ? <p className="muted small">Ainda sem dados neste período.</p> : <div className="table-wrap"><table className="table"><thead><tr><th>Modelo</th><th className="r">Visitas</th></tr></thead><tbody>
                  {interest.data.models.slice(0, 15).map((m) => <tr key={m.slug}><td>{m.brand} {m.name}</td><td className="r">{m.views}</td></tr>)}
                </tbody></table></div>}
                <h4 style={{ marginTop: 16 }}>Buscas sem resultado</h4>
                {!interest.data.noResult.length ? <p className="muted small">Nenhuma neste período.</p> : <ul style={{ margin: 0, paddingLeft: 18 }}>{interest.data.noResult.slice(0, 15).map((n) => <li key={n.term}>{n.term} <span className="muted">({n.count})</span></li>)}</ul>}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
