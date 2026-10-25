import { useState, type FormEvent } from 'react';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Textarea, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money, num } from '../../shared/format';
import { api } from '../api';
import { centsField, toCents, useStore } from './Store';

export interface Vehicle {
  id: string; plate: string | null; brand: string; model: string; version: string; yearManufacture: number | null; yearModel: number | null; color: string; fuel: string; transmission: string; mileageKm: number | null;
  priceCents: number; costCents: number | null; marginCents: number | null; fipeCents: number | null; aboveFipePct: number | null; status: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'ARCHIVED';
  publicListed: boolean; sealEnabled: boolean; description: string; photos: string[]; ipvaDueOn: string | null; licensingDueOn: string | null; enteredOn: string | null; daysInStock: number | null;
  soldAt: string | null; soldPriceCents: number | null; verification: { code: string; consultedAt: string | null } | null;
}
export const vName = (v: Pick<Vehicle, 'brand' | 'model' | 'version' | 'yearModel'>) => [v.brand, v.model, v.version, v.yearModel].filter(Boolean).join(' ');
const STATUS: Record<string, { tone: 'ok' | 'warn' | 'neutral' | 'info'; text: string }> = { AVAILABLE: { tone: 'ok', text: 'Disponível' }, RESERVED: { tone: 'warn', text: 'Reservado' }, SOLD: { tone: 'info', text: 'Vendido' }, ARCHIVED: { tone: 'neutral', text: 'Arquivado' } };
const toInt = (v: string): number | null => { const n = Number(v.replace(/\D/g, '')); return v.trim() && Number.isFinite(n) ? n : null; };

function VehicleForm({ vehicle, onClose, onDone }: { vehicle?: Vehicle; onClose: () => void; onDone: () => void }) {
  const { canSeeCost } = useStore();
  const toast = useToast();
  const [f, setF] = useState({
    plate: vehicle?.plate ?? '', brand: vehicle?.brand ?? '', model: vehicle?.model ?? '', version: vehicle?.version ?? '', yearManufacture: String(vehicle?.yearManufacture ?? ''), yearModel: String(vehicle?.yearModel ?? ''),
    color: vehicle?.color ?? '', fuel: vehicle?.fuel ?? '', transmission: vehicle?.transmission ?? '', mileageKm: String(vehicle?.mileageKm ?? ''), price: centsField(vehicle?.priceCents), cost: centsField(vehicle?.costCents), fipe: centsField(vehicle?.fipeCents),
    ipvaDueOn: vehicle?.ipvaDueOn ?? '', licensingDueOn: vehicle?.licensingDueOn ?? '', description: vehicle?.description ?? '', photos: (vehicle?.photos ?? []).join('\n')
  });
  const [pub, setPub] = useState(vehicle?.publicListed ?? false); const [seal, setSeal] = useState(vehicle?.sealEnabled ?? false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const price = toCents(f.price);
      if (price == null) throw new Error('Informe o preço.');
      const body = {
        plate: f.plate.trim() ? f.plate : null, brand: f.brand, model: f.model, version: f.version, yearManufacture: toInt(f.yearManufacture), yearModel: toInt(f.yearModel), color: f.color, fuel: f.fuel, transmission: f.transmission,
        mileageKm: toInt(f.mileageKm), priceCents: price, fipeCents: toCents(f.fipe), ipvaDueOn: f.ipvaDueOn || null, licensingDueOn: f.licensingDueOn || null, description: f.description,
        photos: f.photos.split('\n').map((x) => x.trim()).filter(Boolean), publicListed: pub, sealEnabled: seal, ...(canSeeCost ? { costCents: toCents(f.cost) } : {})
      };
      if (vehicle) await api.patch(`/dealer/vehicles/${vehicle.id}`, body); else await api.post('/dealer/vehicles', body);
      toast.ok('Salvo.'); onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal wide title={vehicle ? 'Editar veículo' : 'Novo veículo'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Salvar</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="grid-3">
          <Field label="Placa"><Input value={f.plate} onChange={(e) => setF((s) => ({ ...s, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) }))} placeholder="ABC1D23" autoComplete="off" /></Field>
          <Field label="Marca"><Input value={f.brand} onChange={set('brand')} maxLength={40} /></Field>
          <Field label="Modelo"><Input value={f.model} onChange={set('model')} maxLength={60} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Versão"><Input value={f.version} onChange={set('version')} maxLength={80} /></Field>
          <Field label="Ano fab."><Input inputMode="numeric" value={f.yearManufacture} onChange={(e) => setF((s) => ({ ...s, yearManufacture: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></Field>
          <Field label="Ano modelo"><Input inputMode="numeric" value={f.yearModel} onChange={(e) => setF((s) => ({ ...s, yearModel: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Cor"><Input value={f.color} onChange={set('color')} maxLength={30} /></Field>
          <Field label="Combustível"><Input value={f.fuel} onChange={set('fuel')} maxLength={30} /></Field>
          <Field label="Câmbio"><Input value={f.transmission} onChange={set('transmission')} maxLength={30} /></Field>
        </div>
        <div className="grid-3">
          <Field label="Km"><Input inputMode="numeric" value={f.mileageKm} onChange={(e) => setF((s) => ({ ...s, mileageKm: e.target.value.replace(/\D/g, '').slice(0, 7) }))} /></Field>
          <Field label="Preço (R$)"><Input inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
          <Field label="FIPE (R$)"><Input inputMode="decimal" value={f.fipe} onChange={set('fipe')} /></Field>
        </div>
        {canSeeCost && <Field label="Custo (R$)" hint="Só dono e gerente veem."><Input inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>}
        <div className="grid-2">
          <Field label="IPVA vence em"><Input type="date" value={f.ipvaDueOn} onChange={set('ipvaDueOn')} /></Field>
          <Field label="Licenciamento vence em"><Input type="date" value={f.licensingDueOn} onChange={set('licensingDueOn')} /></Field>
        </div>
        <Field label="Descrição"><Textarea rows={3} value={f.description} onChange={set('description')} maxLength={2000} /></Field>
        <Field label="Fotos" hint="Um link https por linha, até 8."><Textarea rows={3} value={f.photos} onChange={set('photos')} placeholder="https://..." /></Field>
        <Switch label="Mostrar na vitrine" checked={pub} onChange={(e) => setPub(e.target.checked)} />
        <Switch label="Selo de consulta verificada" checked={seal} onChange={(e) => setSeal(e.target.checked)} />
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>O selo aparece quando a equipe já fez uma consulta concluída desta placa. A placa inteira nunca é exibida na vitrine.</p>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function SellModal({ vehicle, onClose, onDone }: { vehicle: Vehicle; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [price, setPrice] = useState(centsField(vehicle.priceCents)); const [leadId, setLeadId] = useState('');
  const leads = useAsync(() => api.get<Array<{ id: string; name: string; stage: string }>>('/dealer/leads'), []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit() {
    setBusy(true); setError('');
    try {
      const c = toCents(price); if (c == null) throw new Error('Informe o valor da venda.');
      await api.post(`/dealer/vehicles/${vehicle.id}/sell`, { soldPriceCents: c, leadId: leadId || null }); toast.ok('Venda registrada.'); onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const open = (leads.data ?? []).filter((l) => l.stage !== 'WON' && l.stage !== 'LOST');
  return (
    <Modal title={`Vender ${vName(vehicle)}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Registrar venda</Button></>}>
      <div className="stack">
        <Field label="Valor da venda (R$)"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus /></Field>
        <Field label="Comprador (lead)" hint="O lead vai para Fechado."><Select value={leadId} onChange={(e) => setLeadId(e.target.value)}><option value="">Sem lead</option>{open.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function StoreStock() {
  const { store, canSeeCost, canManage } = useStore();
  const toast = useToast();
  const [view, setView] = useState<'OPEN' | 'SOLD' | 'ARCHIVED'>('OPEN'); const [q, setQ] = useState('');
  const list = useAsync(() => api.get<Vehicle[]>(`/dealer/vehicles?status=${view}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`), [view, q]);
  const [del, setDel] = useState<Vehicle | null>(null); const [edit, setEdit] = useState<Vehicle | 'new' | null>(null); const [sell, setSell] = useState<Vehicle | null>(null);
  const setStatus = async (v: Vehicle, status: string) => { try { await api.post(`/dealer/vehicles/${v.id}/status`, { status }); list.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <nav className="tabs" aria-label="Situação">{(['OPEN', 'SOLD', 'ARCHIVED'] as const).map((s) => <button key={s} type="button" className="tab" aria-selected={view === s} onClick={() => setView(s)}>{s === 'OPEN' ? 'Em estoque' : s === 'SOLD' ? 'Vendidos' : 'Arquivados'}</button>)}</nav>
          <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" style={{ maxWidth: 200 }} />
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo veículo</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : !rows.length ? (
        <EmptyState icon="car" title={view === 'OPEN' ? 'Nenhum veículo em estoque' : 'Nada por aqui'} action={view === 'OPEN' ? <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo veículo</Button> : undefined}>{view === 'OPEN' ? `Limite da loja: ${store.vehicleLimit} veículos.` : undefined}</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table cards">
          <thead><tr><th>Veículo</th><th className="r">Preço</th>{canSeeCost && <th className="r">Margem</th>}<th>Situação</th><th /></tr></thead>
          <tbody>{rows.map((v) => (
            <tr key={v.id}>
              <td>
                <b>{vName(v)}</b>
                <div className="muted" style={{ fontSize: 13 }}>{[v.plate, v.mileageKm != null ? `${num(v.mileageKm)} km` : '', v.daysInStock != null && v.status !== 'SOLD' ? `${v.daysInStock} dias` : ''].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="r">{money(v.status === 'SOLD' ? v.soldPriceCents : v.priceCents)}{v.aboveFipePct != null && v.status !== 'SOLD' && <div className="muted" style={{ fontSize: 12 }}>{v.aboveFipePct > 0 ? '+' : ''}{String(v.aboveFipePct).replace('.', ',')}% FIPE</div>}</td>
              {canSeeCost && <td className="r" data-l="Margem">{v.marginCents == null ? '—' : money(v.marginCents)}</td>}
              <td><Badge tone={STATUS[v.status].tone}>{STATUS[v.status].text}</Badge>{v.verification && <> <Badge tone="violet"><Icon name="shield-check" size={12} /> Verificado</Badge></>}{v.publicListed && <> <Badge>Vitrine</Badge></>}</td>
              <td className="actions">
                {(v.status === 'AVAILABLE' || v.status === 'RESERVED') && <>
                  <Button size="sm" variant="ghost" onClick={() => void setStatus(v, v.status === 'AVAILABLE' ? 'RESERVED' : 'AVAILABLE')}>{v.status === 'AVAILABLE' ? 'Reservar' : 'Liberar'}</Button>
                  <Button size="sm" onClick={() => setSell(v)}>Vender</Button>
                </>}
                {v.status === 'ARCHIVED' && <Button size="sm" onClick={() => void setStatus(v, 'AVAILABLE')}>Reativar</Button>}
                {v.status !== 'SOLD' && <Button size="sm" variant="ghost" onClick={() => setEdit(v)}>Editar</Button>}
                {v.status === 'AVAILABLE' && <Button size="sm" variant="ghost" onClick={() => void setStatus(v, 'ARCHIVED')}>Arquivar</Button>}
                {canManage && v.status !== 'SOLD' && <Button size="sm" variant="ghost" onClick={() => setDel(v)}>Excluir</Button>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {edit && <VehicleForm vehicle={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); list.reload(); }} />}
      {del && <ConfirmDialog title="Excluir veículo" message={<>Excluir <b>{vName(del)}</b>? As propostas já feitas continuam com o texto. Para só tirar do estoque, use Arquivar.</>} confirmLabel="Excluir" danger onConfirm={async () => { try { await api.del(`/dealer/vehicles/${del.id}`); toast.ok('Excluído.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }} onClose={() => setDel(null)} />}
      {sell && <SellModal vehicle={sell} onClose={() => setSell(null)} onDone={() => { setSell(null); list.reload(); }} />}
    </div>
  );
}
