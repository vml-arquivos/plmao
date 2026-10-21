import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Check, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { centsToInput, money, parseMoneyToCents } from '../../shared/format';
import { PageHead } from '../parts';
import { ReportScopeEditor } from './ReportScope';

interface AdminProduct {
  id: string; name: string; slug: string; description: string; tagline: string; longDescription: string; features: string[]; badge: string | null;
  priceCents: number; listPriceCents: number | null; referencePriceCents: number | null; isFree: boolean; active: boolean; commercialStatus: string; featured: boolean;
  showOnHome: boolean; displayOrder: number; reportSections: string[] | null; archivedAt: string | null;
  effectiveStatus: string; sellableNow: boolean; blockers: string[];
}
interface Feature { id: string; key: string; label: string; description: string; displayOrder: number; active: boolean }
interface MatrixRes { features: Feature[]; products: Array<{ id: string; name: string; cells: Record<string, { status: string; note: string | null }> }> }
interface Pack { slug: string; name: string; description: string; tagline: string; badge: string | null; highlights: string[]; credits: number; priceCents: number; displayOrder: number; active: boolean }
interface Section { key: string; label: string; description: string }

const STATUS: Record<string, { l: string; t: 'ok' | 'info' | 'neutral' | 'warn' }> = { ACTIVE: { l: 'À venda', t: 'ok' }, FREE: { l: 'Grátis', t: 'info' }, SOON: { l: 'Em breve', t: 'warn' }, HIDDEN: { l: 'Oculto', t: 'neutral' } };
const slugify = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
/** −5% sobre a referência interna, arredondado para baixo em múltiplos de R$ 0,10. */
export const suggestFromReference = (ref: number): number => Math.floor((ref * 0.95) / 10) * 10;

export default function Catalog() {
  usePageTitle('Produtos do site');
  const [tab, setTab] = useState<'products' | 'matrix' | 'packages'>('products');
  return (
    <>
      <PageHead title="Produtos do site" sub="Tudo o que aparece na página inicial e em Planos: o que cada consulta inclui, valor, desconto, selos e pacotes." />
      <Tabs label="Catálogo" value={tab} onChange={setTab} items={[{ id: 'products', label: 'Consultas' }, { id: 'matrix', label: 'Comparação' }, { id: 'packages', label: 'Pacotes de saldo' }]} />
      {tab === 'products' && <ProductsTab />}
      {tab === 'matrix' && <MatrixTab />}
      {tab === 'packages' && <PackagesTab />}
    </>
  );
}

/* ------------------------------------------------------------------ Consultas */

function ProductsTab() {
  const res = useAsync(() => api.get<AdminProduct[]>('/admin/products'));
  const [edit, setEdit] = useState<AdminProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [remove, setRemove] = useState<AdminProduct | null>(null);
  const toast = useToast();
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const archivedCount = res.data.filter((p) => !p.isFree && p.archivedAt).length;
  const products = res.data.filter((p) => !p.isFree && (showArchived ? Boolean(p.archivedAt) : !p.archivedAt && (p.active || p.showOnHome)));
  async function archive(p: AdminProduct, archived: boolean) {
    try { await api.post(`/admin/content/products/${p.id}/archive`, { archived }); toast.ok(archived ? 'Produto arquivado: saiu do site.' : 'Produto restaurado (volta inativo; ative-o em Editar).'); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function toggleHome(p: AdminProduct, value: boolean) {
    try { await api.patch(`/admin/products/${p.id}`, { showOnHome: value }); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div className="stack">
      <div className="toolbar"><span className="muted grow">A ordem abaixo é a ordem do site. “À venda” só aparece ao público quando existe fonte de dados ativa para o produto.</span><Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo produto</Button></div>
      <Tabs label="Produtos" value={showArchived ? 'archived' : 'live'} onChange={(v) => setShowArchived(v === 'archived')} items={[{ id: 'live', label: 'Na vitrine' }, { id: 'archived', label: `Arquivados (${archivedCount})` }]} />
      <div className="table-wrap"><table className="table"><thead><tr><th>Ordem</th><th>Produto</th><th className="r">Preço</th><th>Selo</th><th>Status</th><th>Na página inicial</th><th /></tr></thead><tbody>
        {products.map((p) => (
          <tr key={p.id}>
            <td className="num">{p.displayOrder}</td>
            <td><b>{p.name}</b>{p.featured && <> <Badge tone="violet">Destaque</Badge></>}<div className="muted mono" style={{ fontSize: 11.5 }}>{p.id}</div></td>
            <td className="r num"><b>{money(p.priceCents)}</b>{p.listPriceCents != null && p.listPriceCents > p.priceCents && <div className="muted" style={{ fontSize: 12, textDecoration: 'line-through' }}>{money(p.listPriceCents)}</div>}</td>
            <td>{p.badge ? <Badge tone="info">{p.badge}</Badge> : <span className="muted">—</span>}</td>
            <td><Badge tone={STATUS[p.effectiveStatus]?.t ?? 'neutral'} dot>{STATUS[p.effectiveStatus]?.l ?? p.effectiveStatus}</Badge>{!p.active && <div className="muted" style={{ fontSize: 12 }}>inativo</div>}{p.commercialStatus !== p.effectiveStatus && <div className="muted" style={{ fontSize: 12 }} title={p.blockers.join(' · ')}>Marcado “{STATUS[p.commercialStatus]?.l ?? p.commercialStatus}”, mas o público vê “{STATUS[p.effectiveStatus]?.l ?? p.effectiveStatus}”: {p.blockers.join('; ')}</div>}</td>
            <td><Switch checked={p.showOnHome} onChange={(e) => void toggleHome(p, e.target.checked)} label={p.showOnHome ? 'Visível' : 'Oculto'} /></td>
            <td className="actions"><Button size="sm" onClick={() => setEdit(p)}>Editar</Button> <Button size="sm" variant="ghost" onClick={() => void archive(p, !p.archivedAt)}>{p.archivedAt ? 'Restaurar' : 'Arquivar'}</Button> <Button size="sm" variant="ghost" onClick={() => setRemove(p)}>Apagar</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {!products.length && <EmptyState icon="tag" title={showArchived ? 'Nenhum produto arquivado' : 'Nenhum produto cadastrado'} />}
      {remove && <ConfirmDialog danger title="Apagar produto?" confirmLabel="Apagar" message={<p>Apagar <b>{remove.name}</b> de vez? Só é possível se ele nunca foi consultado nem vendido. Se já tem histórico, use <b>Arquivar</b>, que tira da vitrine e guarda tudo.</p>} onConfirm={async () => {
        try { await api.del(`/admin/content/products/${remove.id}`); toast.ok('Produto apagado.'); res.reload(); } catch (e) { toast.error((e as { code?: string }).code === 'PRODUCT_IN_USE' ? 'Este produto já tem consultas ou vendas. Arquive em vez de apagar.' : errorMessage(e)); throw e; }
      }} onClose={() => setRemove(null)} />}
      {edit && <ProductModal p={edit} onClose={(changed) => { setEdit(null); if (changed) res.reload(); }} />}
      {creating && <CreateModal onClose={(created) => { setCreating(false); if (created) res.reload(); }} />}
    </div>
  );
}

function ProductModal({ p, onClose }: { p: AdminProduct; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const sections = useAsync(() => api.get<Section[]>('/admin/content/sections'), []);
  const [name, setName] = useState(p.name);
  const [tagline, setTagline] = useState(p.tagline);
  const [description, setDescription] = useState(p.description);
  const [longDescription, setLongDescription] = useState(p.longDescription);
  const [features, setFeatures] = useState(p.features.join('\n'));
  const [badge, setBadge] = useState(p.badge ?? '');
  const [price, setPrice] = useState(centsToInput(p.priceCents));
  const [listPrice, setListPrice] = useState(centsToInput(p.listPriceCents));
  const [order, setOrder] = useState(String(p.displayOrder));
  const [featured, setFeatured] = useState(p.featured);
  const [showOnHome, setShowOnHome] = useState(p.showOnHome);
  const [status, setStatus] = useState(p.commercialStatus);
  const [active, setActive] = useState(p.active);
  const [picked, setPicked] = useState<string[]>(p.reportSections ?? []);
  const [busy, setBusy] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const priceCents = parseMoneyToCents(price);
  const listCents = listPrice.trim() ? parseMoneyToCents(listPrice) : null;
  const discount = listCents && priceCents && listCents > priceCents ? Math.round(((listCents - priceCents) / listCents) * 100) : null;
  const suggestion = p.referencePriceCents ? suggestFromReference(p.referencePriceCents) : null;

  async function save() {
    if (priceCents == null) { toast.error('Informe um preço válido.'); return; }
    setBusy(true);
    try {
      if (priceCents !== p.priceCents) await api.patch(`/admin/finance/products/${p.id}/pricing`, { pricingMode: 'MANUAL', priceCents });
      await api.patch(`/admin/products/${p.id}`, {
        name: name.trim(), tagline: tagline.trim(), description: description.trim(), longDescription: longDescription.trim(),
        features: features.split('\n').map((l) => l.trim()).filter(Boolean), badge: badge.trim() || null, listPriceCents: listCents,
        displayOrder: Number(order) || 0, featured, showOnHome, commercialStatus: status, active, reportSections: picked.length ? picked : null
      });
      toast.ok('Produto salvo. O site já mostra a alteração.');
      onClose(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Editar: ${p.name}`} wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <div className="form-grid cols-2">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Selo (opcional)" hint="Ex.: Mais completa, Oferta da semana."><Input value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={30} /></Field>
        </div>
        <Field label="Frase de destaque" hint="Aparece abaixo do nome no cartão."><Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={160} /></Field>
        <Field label="Descrição curta"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} /></Field>
        <Field label="Descrição completa" hint="Texto da página de detalhes e da comparação."><Textarea rows={3} value={longDescription} onChange={(e) => setLongDescription(e.target.value)} maxLength={2000} /></Field>
        <Field label="O que esta consulta inclui" hint="Um item por linha. Aparece como lista no cartão."><Textarea rows={5} value={features} onChange={(e) => setFeatures(e.target.value)} /></Field>
        <div className="form-grid cols-3">
          <Field label="Preço de venda (R$)"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Preço “de” (riscado, opcional)" hint={discount ? `Desconto exibido: ${discount}%` : 'Preencha para mostrar um desconto.'}><Input inputMode="decimal" value={listPrice} onChange={(e) => setListPrice(e.target.value)} placeholder="Ex.: 79,90" /></Field>
          <Field label="Ordem no site" hint="Menor número aparece primeiro."><Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
        </div>
        {suggestion != null && (
          <Alert tone="info" title="Referência de mercado (uso interno)">
            Referência cadastrada: <b>{money(p.referencePriceCents)}</b>. Sugestão 5% abaixo: <b>{money(suggestion)}</b>. A referência nunca aparece para o público.{' '}
            <Button size="sm" onClick={() => setPrice(centsToInput(suggestion))}>Usar {money(suggestion)}</Button>
          </Alert>
        )}
        <div className="form-grid cols-3">
          <Field label="Status comercial"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">À venda</option><option value="SOON">Em breve</option><option value="HIDDEN">Oculto</option></Select></Field>
          <Switch checked={featured} onChange={(e) => setFeatured(e.target.checked)} label="Produto em destaque" />
          <Switch checked={showOnHome} onChange={(e) => setShowOnHome(e.target.checked)} label="Mostrar na página inicial" />
        </div>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Produto ativo (inativo some do site e não pode ser contratado)" />
        <Field label="Seções do relatório entregues" hint="Define o que o cliente vê no relatório desta consulta. Nada marcado = regra padrão do produto. Só aparece o que a fonte retornar.">
          <div className="form-grid cols-2">
            {(sections.data ?? []).map((s) => (
              <Check key={s.key} checked={picked.includes(s.key)} onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, s.key] : cur.filter((k) => k !== s.key)))}>{s.label}<span className="muted" style={{ display: 'block', fontSize: 12 }}>{s.description}</span></Check>
            ))}
          </div>
        </Field>
        <Field label="Campos do relatório" hint="Escolha campo a campo o que esta consulta entrega, com prévia, versões e volta. Quando há uma versão publicada, ela vale no lugar das seções acima.">
          <div><Button onClick={() => setScopeOpen(true)}>Configurar campos</Button></div>
        </Field>
        {scopeOpen && <ReportScopeEditor productId={p.id} onClose={() => setScopeOpen(false)} />}
        <p className="muted" style={{ fontSize: 12.5 }}>Custos, piso de margem e referências de mercado ficam em <b>Preços e margens</b>. O preço aqui respeita a trava de margem mínima.</p>
      </div>
    </Modal>
  );
}

function CreateModal({ onClose }: { onClose: (created: boolean) => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const id = code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const ok = /^[A-Z][A-Z0-9_]{1,39}$/.test(id) && name.trim().length >= 2 && parseMoneyToCents(price) != null;
  async function create() {
    setBusy(true);
    try {
      await api.post('/admin/products', { id, name: name.trim(), slug: slugify(name) || id.toLowerCase(), description: `${name.trim()} — descreva o que esta consulta inclui.`, priceCents: parseMoneyToCents(price) ?? 0, commercialStatus: 'SOON', showOnHome: false });
      toast.ok('Produto criado como “Em breve” e oculto. Complete os dados e publique.');
      onClose(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Novo produto" onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={busy} onClick={() => void create()}>Criar</Button></>}>
      <div className="stack">
        <Field label="Código interno" hint="Letras maiúsculas, números e _. Não muda depois. Ex.: SINISTRO."><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} /></Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Preço de venda (R$)"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Alert tone="info">Para vender, o produto precisa de uma fonte de dados ativa. Até lá, ele aparece como “Em breve”.</Alert>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Matriz de comparação */

const CELL_LABEL: Record<string, string> = { INCLUDED: 'Inclui', NOT_INCLUDED: 'Não inclui', SOON: 'Em breve' };

function MatrixTab() {
  const res = useAsync(() => api.get<MatrixRes>('/admin/content/matrix'));
  const toast = useToast();
  const [editing, setEditing] = useState<Feature | 'new' | null>(null);
  const [removing, setRemoving] = useState<Feature | null>(null);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { features, products } = res.data;
  async function setCell(productId: string, featureId: string, status: string) {
    try { await api.put(`/admin/content/matrix/${productId}`, { cells: { [featureId]: { status } } }); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <div className="stack">
      <Alert tone="info" title="Como a comparação funciona">Cada linha é um recurso que aparece na tabela comparativa e no comparador inteligente da página Planos. Marque só o que a consulta realmente entrega; use “Em breve” para o que ainda depende de fonte de dados.</Alert>
      <div className="toolbar"><span className="grow" /><Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Novo recurso</Button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Recurso</th>{products.map((p) => <th key={p.id}>{p.name}</th>)}<th /></tr></thead><tbody>
        {features.map((f) => (
          <tr key={f.id} style={f.active ? undefined : { opacity: .55 }}>
            <td><b>{f.label}</b><div className="muted" style={{ fontSize: 12 }}>{f.description}</div>{!f.active && <Badge>Oculto</Badge>}</td>
            {products.map((p) => (
              <td key={p.id}><Select aria-label={`${f.label} em ${p.name}`} value={p.cells[f.id]?.status ?? 'NOT_INCLUDED'} onChange={(e) => void setCell(p.id, f.id, e.target.value)}>{Object.entries(CELL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></td>
            ))}
            <td className="actions"><Button size="sm" onClick={() => setEditing(f)}>Editar</Button> <Button size="sm" variant="ghost" onClick={() => setRemoving(f)}>Remover</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {!features.length && <EmptyState icon="list" title="Nenhum recurso cadastrado" />}
      {editing && <FeatureModal feature={editing === 'new' ? null : editing} onClose={(c) => { setEditing(null); if (c) res.reload(); }} />}
      {removing && <ConfirmDialog danger title="Remover recurso?" message={`“${removing.label}” sai da comparação de todos os produtos.`} confirmLabel="Remover" onConfirm={async () => { await api.del(`/admin/content/features/${removing.id}`); res.reload(); }} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function FeatureModal({ feature, onClose }: { feature: Feature | null; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(feature?.label ?? '');
  const [description, setDescription] = useState(feature?.description ?? '');
  const [order, setOrder] = useState(String(feature?.displayOrder ?? 100));
  const [active, setActive] = useState(feature?.active ?? true);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (feature) await api.patch(`/admin/content/features/${feature.id}`, { label: label.trim(), description: description.trim(), displayOrder: Number(order) || 0, active });
      else await api.post('/admin/content/features', { key: slugify(label), label: label.trim(), description: description.trim(), displayOrder: Number(order) || 100, active });
      onClose(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={feature ? 'Editar recurso' : 'Novo recurso'} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={label.trim().length < 2} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <Field label="Nome do recurso"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} /></Field>
        <Field label="Explicação curta"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} /></Field>
        <Field label="Ordem"><Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Visível na comparação" />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Pacotes */

function PackagesTab() {
  const res = useAsync(() => api.get<Pack[]>('/admin/content/packages'));
  const [edit, setEdit] = useState<Pack | 'new' | null>(null);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  return (
    <div className="stack">
      <div className="toolbar"><span className="muted grow">Pacotes são saldo pré-pago: o cliente paga o valor e recebe o saldo em consultas. Quando o saldo é maior que o valor, a diferença é o bônus.</span><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo pacote</Button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Pacote</th><th className="r">Valor pago</th><th className="r">Saldo</th><th className="r">Bônus</th><th>Selo</th><th>Status</th><th /></tr></thead><tbody>
        {res.data.map((p) => (
          <tr key={p.slug}>
            <td><b>{p.name}</b><div className="muted" style={{ fontSize: 12 }}>{p.tagline || p.description}</div></td>
            <td className="r num">{money(p.priceCents)}</td><td className="r num">{money(p.credits * 100)}</td><td className="r num">{p.credits * 100 > p.priceCents ? money(p.credits * 100 - p.priceCents) : '—'}</td>
            <td>{p.badge ? <Badge tone="info">{p.badge}</Badge> : <span className="muted">—</span>}</td>
            <td><Badge tone={p.active ? 'ok' : 'neutral'} dot>{p.active ? 'Ativo' : 'Inativo'}</Badge></td>
            <td className="actions"><Button size="sm" onClick={() => setEdit(p)}>Editar</Button></td>
          </tr>
        ))}
      </tbody></table></div>
      {edit && <PackModal p={edit === 'new' ? null : edit} onClose={(c) => { setEdit(null); if (c) res.reload(); }} />}
    </div>
  );
}

function PackModal({ p, onClose }: { p: Pack | null; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [name, setName] = useState(p?.name ?? '');
  const [tagline, setTagline] = useState(p?.tagline ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [badge, setBadge] = useState(p?.badge ?? '');
  const [price, setPrice] = useState(centsToInput(p?.priceCents));
  const [credits, setCredits] = useState(String(p?.credits ?? ''));
  const [highlights, setHighlights] = useState((p?.highlights ?? []).join('\n'));
  const [order, setOrder] = useState(String(p?.displayOrder ?? 100));
  const [active, setActive] = useState(p?.active ?? true);
  const [busy, setBusy] = useState(false);
  const priceCents = parseMoneyToCents(price);
  const creditsN = Number(credits);
  const valid = name.trim().length >= 2 && description.trim().length >= 2 && priceCents != null && priceCents > 0 && Number.isInteger(creditsN) && creditsN > 0;
  async function save() {
    const body = { name: name.trim(), tagline: tagline.trim(), description: description.trim(), badge: badge.trim() || null, priceCents: priceCents ?? 0, credits: creditsN, highlights: highlights.split('\n').map((l) => l.trim()).filter(Boolean), displayOrder: Number(order) || 0, active };
    setBusy(true);
    try {
      if (p) await api.patch(`/admin/content/packages/${p.slug}`, body);
      else await api.post('/admin/content/packages', { ...body, slug: slugify(name) });
      toast.ok('Pacote salvo.');
      onClose(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={p ? `Editar: ${p.name}` : 'Novo pacote'} wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <div className="form-grid cols-2">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="Selo (opcional)"><Input value={badge} onChange={(e) => setBadge(e.target.value)} maxLength={30} placeholder="Ex.: Melhor custo" /></Field>
        </div>
        <Field label="Frase de destaque"><Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={160} /></Field>
        <Field label="Descrição"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} /></Field>
        <div className="form-grid cols-3">
          <Field label="Valor pago (R$)"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label="Saldo recebido (R$)" hint="Números inteiros, em reais."><Input inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Ordem"><Input inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
        </div>
        <Field label="Destaques extras (um por linha, opcional)"><Textarea rows={3} value={highlights} onChange={(e) => setHighlights(e.target.value)} /></Field>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Pacote ativo" />
      </div>
    </Modal>
  );
}
