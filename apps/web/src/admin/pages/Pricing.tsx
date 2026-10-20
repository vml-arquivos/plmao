import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, centsToInput, dateOnly, dateTime, money, parseMoneyToCents } from '../../shared/format';
import { PageHead } from '../parts';

interface Product {
  id: string; name: string; providerCostCents: number; supplierCostCents: number; priceCents: number; referencePriceCents: number | null; isFree: boolean; active: boolean;
  commercialStatus: string; pricingMode: 'MANUAL' | 'REFERENCE'; floorCents: number | null; marginLocked: boolean; priceVersion: number; priceUpdatedAt: string | null;
  proposal: { ruleCents: number | null; finalCents: number; marginLocked: boolean; belowMarketBps: number | null; reason: string; changed: boolean };
  margins: Array<{ method: string; marginBps: number }>; worstMarginBps: number | null; belowFloor: boolean;
}
interface ProductsRes { settings: { desiredMarginBps: number; minMarginBps: number; referenceDiscountBps: number; priceEndingCents: number; enabledMethods: string[] }; products: Product[] }
interface Proposal { productId: string; productName?: string; currentCents: number; finalCents: number; floorCents: number | null; marginLocked: boolean; changed: boolean; reason: string; referenceCents: number | null }

const STATUS: Record<string, { l: string; t: 'ok' | 'info' | 'neutral' | 'warn' }> = { ACTIVE: { l: 'À venda', t: 'ok' }, FREE: { l: 'Grátis', t: 'info' }, SOON: { l: 'Em breve', t: 'warn' }, HIDDEN: { l: 'Oculto', t: 'neutral' } };

export default function Pricing() {
  usePageTitle('Preços e margens');
  const toast = useToast();
  const res = useAsync(() => api.get<ProductsRes>('/admin/finance/products'));
  const [edit, setEdit] = useState<Product | null>(null);
  const [recalc, setRecalc] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOld, setShowOld] = useState(false);

  async function preview() {
    setBusy(true);
    try { const r = await api.post<{ proposals: Proposal[] }>('/admin/finance/recalculate', { apply: false }); setRecalc(r.proposals); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true);
    try { await api.post('/admin/finance/recalculate', { apply: true }); toast.ok('Preços recalculados.'); setRecalc(null); res.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { settings, products: all } = res.data;
  const products = showOld ? all : all.filter((p) => p.active || p.commercialStatus !== 'SOON');
  const names = new Map(all.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHead title="Preços e margens" sub={<>Margem desejada {bpsToPercent(settings.desiredMarginBps)} · mínima (trava) {bpsToPercent(settings.minMarginBps)} · desconto sobre o mercado {bpsToPercent(settings.referenceDiscountBps)}</>} actions={<Button icon="refresh" loading={busy} onClick={() => void preview()}>Recalcular pela referência</Button>} />
      <Alert tone="info" icon="info" title="Como o preço é protegido">O preço nunca fica abaixo do piso que garante a margem mínima na pior forma de pagamento. Preços de referência de mercado são cadastrados manualmente, são de uso interno e nunca aparecem para o público.</Alert>
      <div className="toolbar"><Switch checked={showOld} onChange={(e) => setShowOld(e.target.checked)} label="Mostrar produtos descontinuados" /></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Produto</th><th className="r">Custo</th><th className="r">Referência</th><th className="r">Piso</th><th className="r">Preço</th><th>Pior margem</th><th>Modo</th><th>Status</th><th /></tr></thead><tbody>
        {products.map((p) => {
          const cost = p.providerCostCents + p.supplierCostCents;
          const m = cost ? p.worstMarginBps : null;
          const pct = m == null ? 0 : Math.max(0, Math.min(100, m / 100));
          const tone = m == null ? '' : m < settings.minMarginBps ? 'low' : m < settings.desiredMarginBps ? 'mid' : '';
          return (
            <tr key={p.id}>
              <td><b>{p.name}</b><div className="muted mono" style={{ fontSize: 11.5 }}>{p.id} · v{p.priceVersion}</div></td>
              <td className="r num">{p.isFree ? '—' : cost ? money(cost) : <Badge tone="danger">Sem custo</Badge>}</td>
              <td className="r num">{p.isFree ? '—' : p.referencePriceCents != null ? money(p.referencePriceCents) : <span className="muted">—</span>}</td>
              <td className="r num">{p.floorCents ? money(p.floorCents) : '—'}</td>
              <td className="r num"><b>{p.isFree ? 'Grátis' : money(p.priceCents)}</b>{p.belowFloor && <div><Badge tone="danger">Abaixo do piso</Badge></div>}{p.marginLocked && <div><Badge tone="warn">Trava de margem</Badge></div>}</td>
              <td>{m == null ? <span className="muted">—</span> : <div><div className={`margin-bar ${tone}`}><i style={{ width: `${pct}%` }} /></div><span className="muted" style={{ fontSize: 12 }}>{bpsToPercent(m)}</span></div>}</td>
              <td><Badge>{p.pricingMode === 'REFERENCE' ? 'Referência' : 'Manual'}</Badge></td>
              <td><Badge tone={STATUS[p.commercialStatus]?.t ?? 'neutral'} dot>{STATUS[p.commercialStatus]?.l ?? p.commercialStatus}</Badge>{!p.active && <div className="muted" style={{ fontSize: 12 }}>inativo</div>}</td>
              <td className="actions">{!p.isFree && <Button size="sm" onClick={() => setEdit(p)}>Editar</Button>}</td>
            </tr>
          );
        })}
      </tbody></table></div>
      {edit && <EditModal p={edit} onClose={() => { setEdit(null); res.reload(); }} />}
      {recalc && (
        <Modal title="Recalcular preços pela referência" wide onClose={() => setRecalc(null)} footer={<><Button variant="ghost" onClick={() => setRecalc(null)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!recalc.some((x) => x.changed || x.marginLocked)} onClick={() => void apply()}>Aplicar alterações</Button></>}>
          {!recalc.length ? <EmptyState title="Nenhum produto em modo “Referência”" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Produto</th><th className="r">Atual</th><th className="r">Novo</th><th className="r">Piso</th><th>Observação</th></tr></thead><tbody>
              {recalc.map((x) => <tr key={x.productId}><td>{names.get(x.productId) ?? x.productId}</td><td className="r num">{money(x.currentCents)}</td><td className="r num"><b>{money(x.finalCents)}</b></td><td className="r num">{x.floorCents ? money(x.floorCents) : '—'}</td><td>{x.marginLocked ? <Badge tone="warn">Trava de margem</Badge> : x.changed ? <Badge tone="info">Alterado</Badge> : <span className="muted">Sem mudança</span>}</td></tr>)}
            </tbody></table></div>
          )}
        </Modal>
      )}
    </>
  );
}

interface Ref { id: string; sourceLabel: string; priceCents: number; observedAt: string; note: string | null }
interface Hist { version: number; oldPriceCents: number | null; newPriceCents: number; referencePriceCents: number | null; floorPriceCents: number | null; providerCostCents: number | null; marginLocked: boolean; reason: string; createdAt: string }

function EditModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const toast = useToast();
  const { can } = useAdminSession();
  const [tab, setTab] = useState<'price' | 'refs' | 'history' | 'status'>('price');
  return (
    <Modal title={p.name} wide onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Concluir</Button>}>
      <div className="stack">
        <Tabs label="Seções do produto" value={tab} onChange={setTab} items={[{ id: 'price', label: 'Custo e preço' }, { id: 'refs', label: 'Referências de mercado' }, { id: 'history', label: 'Histórico' }, { id: 'status', label: 'Vitrine' }]} />
        {tab === 'price' && <PriceTab p={p} canOverride={can('ADMIN_SYSTEM')} toast={toast} />}
        {tab === 'refs' && <RefsTab p={p} toast={toast} />}
        {tab === 'history' && <HistoryTab p={p} />}
        {tab === 'status' && <StatusTab p={p} toast={toast} />}
      </div>
    </Modal>
  );
}
type ToastApi = ReturnType<typeof useToast>;

function PriceTab({ p, canOverride, toast }: { p: Product; canOverride: boolean; toast: ToastApi }) {
  const [provider, setProvider] = useState(centsToInput(p.providerCostCents));
  const [supplier, setSupplier] = useState(centsToInput(p.supplierCostCents));
  const [mode, setMode] = useState(p.pricingMode);
  const [price, setPrice] = useState(centsToInput(p.priceCents));
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const priceCents = parseMoneyToCents(price);
  const belowFloor = p.floorCents != null && priceCents != null && priceCents > 0 && priceCents < p.floorCents;
  async function save() {
    const body: Record<string, unknown> = { pricingMode: mode };
    const pc = parseMoneyToCents(provider); if (pc != null) body.providerCostCents = pc;
    const sc = parseMoneyToCents(supplier); if (sc != null) body.supplierCostCents = sc;
    if (mode === 'MANUAL' && priceCents != null && priceCents !== p.priceCents) body.priceCents = priceCents;
    if (belowFloor && override.trim().length >= 10) body.overrideMarginLock = { reason: override.trim() };
    setBusy(true);
    try { const r = await api.patch<{ priceCents: number; marginLocked: boolean; reason: string }>(`/admin/finance/products/${p.id}/pricing`, body); toast.ok(`Salvo. Preço: ${money(r.priceCents)}${r.marginLocked ? ' (trava de margem aplicada)' : ''}`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      <div className="form-grid">
        <Field label="Custo do provedor por consulta (R$)" hint="Informe o valor que você paga ao provedor."><Input inputMode="decimal" value={provider} onChange={(e) => setProvider(e.target.value)} /></Field>
        <Field label="Outros custos de fornecedor (R$)"><Input inputMode="decimal" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Modo de preço"><Select value={mode} onChange={(e) => setMode(e.target.value as 'MANUAL' | 'REFERENCE')}><option value="REFERENCE">Referência (automático, abaixo do mercado)</option><option value="MANUAL">Manual</option></Select></Field>
        {mode === 'MANUAL' && <Field label="Preço de venda (R$)" error={belowFloor ? `Abaixo do piso de ${money(p.floorCents)}` : undefined}><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>}
      </div>
      {mode === 'REFERENCE' && <Alert tone="info">Proposta atual: <b>{money(p.proposal.finalCents)}</b>{p.proposal.ruleCents ? ` (regra: ${money(p.proposal.ruleCents)})` : ''}. Piso: {p.floorCents ? money(p.floorCents) : 'defina o custo para calcular'}.</Alert>}
      {belowFloor && (canOverride
        ? <Field label="Autorizar preço abaixo do piso (super admin)" hint="Motivo obrigatório (mín. 10 caracteres). Fica na auditoria."><Textarea rows={2} value={override} onChange={(e) => setOverride(e.target.value)} /></Field>
        : <Alert tone="danger">Preço abaixo do piso exige um super admin.</Alert>)}
      <div><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button></div>
      {p.margins.length > 0 && <div className="sim-grid">{p.margins.map((m) => <div key={m.method} className="kpi"><span className="k">{m.method}</span><span className="v num" style={{ fontSize: 20 }}>{bpsToPercent(m.marginBps)}</span></div>)}</div>}
    </div>
  );
}

function RefsTab({ p, toast }: { p: Product; toast: ToastApi }) {
  const refs = useAsync(() => api.get<{ references: Ref[] }>(`/admin/finance/products/${p.id}/references`), [p.id]);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    const cents = parseMoneyToCents(value);
    if (!cents || label.trim().length < 2) return;
    setBusy(true);
    try { await api.post(`/admin/finance/products/${p.id}/references`, { sourceLabel: label.trim(), priceCents: cents, observedAt: date || undefined, note: note.trim() || undefined }); setLabel(''); setValue(''); setNote(''); toast.ok('Referência adicionada. A mediana dos últimos 90 dias foi atualizada.'); refs.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function del(id: string) { try { await api.del(`/admin/finance/products/${p.id}/references/${id}`); refs.reload(); } catch (e) { toast.error(errorMessage(e)); } }
  return (
    <div className="stack">
      <Alert tone="info">Registre manualmente preços observados no mercado (ex.: concorrente, tabela). A mediana dos últimos 90 dias vira o preço de referência. Estes dados são internos.</Alert>
      <div className="form-grid">
        <Field label="Fonte / rótulo"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Mercado A (consulta completa)" maxLength={80} /></Field>
        <Field label="Preço observado (R$)"><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Data da observação"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Observação"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} /></Field>
      </div>
      <div><Button variant="primary" icon="plus" loading={busy} disabled={!parseMoneyToCents(value) || label.trim().length < 2} onClick={() => void add()}>Adicionar referência</Button></div>
      {refs.data?.references.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Fonte</th><th className="r">Preço</th><th>Data</th><th /></tr></thead><tbody>{refs.data.references.map((r) => <tr key={r.id}><td>{r.sourceLabel}{r.note && <div className="muted" style={{ fontSize: 12 }}>{r.note}</div>}</td><td className="r num">{money(r.priceCents)}</td><td>{dateOnly(r.observedAt)}</td><td className="actions"><Button size="sm" variant="ghost" onClick={() => void del(r.id)}>Remover</Button></td></tr>)}</tbody></table></div> : <p className="muted">Nenhuma referência cadastrada. Referência atual: {p.referencePriceCents != null ? money(p.referencePriceCents) : '—'}.</p>}
    </div>
  );
}

function HistoryTab({ p }: { p: Product }) {
  const h = useAsync(() => api.get<{ history: Hist[] }>(`/admin/finance/products/${p.id}/history`), [p.id]);
  if (h.loading && !h.data) return <PageLoading />;
  if (!h.data?.history.length) return <p className="muted">Sem alterações de preço registradas.</p>;
  return <div className="table-wrap"><table className="table"><thead><tr><th>Versão</th><th className="r">De</th><th className="r">Para</th><th className="r">Referência</th><th className="r">Piso</th><th>Motivo</th><th>Quando</th></tr></thead><tbody>
    {h.data.history.map((x) => <tr key={x.version + x.createdAt}><td>v{x.version}</td><td className="r num">{x.oldPriceCents != null ? money(x.oldPriceCents) : '—'}</td><td className="r num"><b>{money(x.newPriceCents)}</b></td><td className="r num">{x.referencePriceCents != null ? money(x.referencePriceCents) : '—'}</td><td className="r num">{x.floorPriceCents != null ? money(x.floorPriceCents) : '—'}</td><td>{x.reason}{x.marginLocked && <> <Badge tone="warn">trava</Badge></>}</td><td>{dateTime(x.createdAt)}</td></tr>)}
  </tbody></table></div>;
}

function StatusTab({ p, toast }: { p: Product; toast: ToastApi }) {
  const [status, setStatus] = useState(p.commercialStatus);
  const [active, setActive] = useState(p.active);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStatus(p.commercialStatus); setActive(p.active); }, [p]);
  async function save() {
    setBusy(true);
    try { await api.patch(`/admin/products/${p.id}`, { commercialStatus: status, active }); toast.ok('Vitrine atualizada.'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const noCost = p.providerCostCents + p.supplierCostCents === 0;
  return (
    <div className="stack">
      {noCost && status === 'ACTIVE' && <Alert tone="warn" title="Produto sem custo informado">Sem o custo do provedor a trava de margem não protege este preço. Informe o custo antes de vender.</Alert>}
      <Field label="Status comercial" hint="“À venda” só aparece ao público quando há fonte de dados ativa para o produto."><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">À venda</option><option value="SOON">Em breve</option><option value="HIDDEN">Oculto</option></Select></Field>
      <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Produto ativo" />
      <div><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar vitrine</Button></div>
    </div>
  );
}
