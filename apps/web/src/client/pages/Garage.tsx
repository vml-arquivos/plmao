import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, LinkButton, Modal, PageLoading, PlateBadge, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money, parseMoneyToCents } from '../../shared/format';
import { api } from '../api';

type Status = 'DONE' | 'OVERDUE' | 'SOON' | 'OPEN' | null;
interface Report { id: string; productId: string; createdAt: string }
interface Item { id: string; vehicleId: string; kind: 'REMINDER' | 'MAINTENANCE' | 'EXPENSE'; title: string; dueDate: string | null; dueKm: number | null; eventDate: string | null; km: number | null; amountCents: number | null; done: boolean; status: Status }
interface Vehicle { id: string; plate: string; nickname: string; modelLabel: string; modelYear: number | null; km: number | null; kmUpdatedAt: string | null; notes: string; createdAt: string }
interface ListItem extends Vehicle { reminders: { open: number; overdue: number; soon: number }; nextReminder: Item | null; reports: Report[] }

const dayBr = (iso: string | null) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const kmBr = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR')} km`);
const toInt = (v: string): number | null => { const n = Number(v.replace(/\D/g, '')); return v.trim() && Number.isFinite(n) ? n : null; };
const STATUS_BADGE: Record<string, { tone: 'danger' | 'warn' | 'neutral' | 'ok'; text: string }> = { OVERDUE: { tone: 'danger', text: 'Vencido' }, SOON: { tone: 'warn', text: 'Em breve' }, OPEN: { tone: 'neutral', text: 'Em dia' }, DONE: { tone: 'ok', text: 'Feito' } };
const NOTE = 'Lembretes, manutenções e gastos são informados por você. Não vêm de fonte oficial.';

function AddVehicle({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [plate, setPlate] = useState(''); const [nickname, setNickname] = useState(''); const [model, setModel] = useState(''); const [year, setYear] = useState(''); const [km, setKm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const v = await api.post<Vehicle>('/garage/vehicles', { plate, nickname, modelLabel: model, modelYear: toInt(year), km: toInt(km) });
      toast.ok('Veículo guardado.'); onDone(v.id);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Adicionar veículo" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={(e) => void submit(e as unknown as FormEvent)}>Guardar</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="Placa"><Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC1D23" autoComplete="off" /></Field>
        <Field label="Apelido (opcional)"><Input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} placeholder="Ex.: Carro da família" /></Field>
        <Field label="Modelo (opcional)"><Input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} placeholder="Ex.: Onix 1.0" /></Field>
        <div className="grid-2">
          <Field label="Ano (opcional)"><Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2020" /></Field>
          <Field label="Quilometragem (opcional)"><Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="45000" /></Field>
        </div>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function Garage() {
  usePageTitle('Minha garagem');
  const nav = useNavigate();
  const list = useAsync(() => api.get<{ limit: number; vehicles: ListItem[] }>('/garage'), []);
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const vehicles = list.data?.vehicles ?? [];
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Minha garagem</h1><p>Seus veículos, relatórios, lembretes e gastos em um só lugar.</p></div>
        <div className="row">
          {vehicles.length > 0 && <Button icon="download" onClick={() => void api.download('/garage/export', 'minha-garagem.json').catch((e) => toast.error(errorMessage(e)))}>Exportar</Button>}
          <Button variant="primary" icon="plus" disabled={vehicles.length >= (list.data?.limit ?? 10)} onClick={() => setAdding(true)}>Adicionar veículo</Button>
        </div>
      </div>
      {!vehicles.length ? (
        <EmptyState icon="car" title="Sua garagem está vazia" action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Adicionar veículo</Button>}>Guarde um veículo para acompanhar relatórios, lembretes de IPVA e revisão, e gastos.</EmptyState>
      ) : (
        <div className="stack">
          {vehicles.map((v) => (
            <Link key={v.id} to={`/app/garagem/${v.id}`} className="card card-pad row-between garage-card">
              <div className="row" style={{ gap: 14 }}>
                <PlateBadge plate={v.plate} />
                <div>
                  <b>{v.nickname || v.modelLabel || 'Veículo'}</b>
                  <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{[v.nickname ? v.modelLabel : '', v.modelYear, v.km != null ? kmBr(v.km) : ''].filter(Boolean).join(' · ') || 'Sem detalhes'}</p>
                  {v.nextReminder && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Próximo: {v.nextReminder.title}{v.nextReminder.dueDate ? ` · ${dayBr(v.nextReminder.dueDate)}` : ''}</p>}
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {v.reminders.overdue > 0 && <Badge tone="danger">{v.reminders.overdue} vencido{v.reminders.overdue > 1 ? 's' : ''}</Badge>}
                {v.reminders.soon > 0 && <Badge tone="warn">{v.reminders.soon} em breve</Badge>}
                {v.reports.length > 0 && <Badge>{v.reports.length} relatório{v.reports.length > 1 ? 's' : ''}</Badge>}
                <Icon name="chevron-right" />
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>{NOTE}</p>
      {adding && <AddVehicle onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); nav(`/app/garagem/${id}`); }} />}
    </div>
  );
}

function ItemModal({ vehicleId, kind, onClose, onDone }: { vehicleId: string; kind: Item['kind']; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(''); const [date, setDate] = useState(''); const [km, setKm] = useState(''); const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const reminder = kind === 'REMINDER';
  const label = reminder ? 'Novo lembrete' : 'Registrar manutenção ou gasto';
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const body = reminder
        ? { kind, title, dueDate: date || null, dueKm: toInt(km) }
        : { kind, title, eventDate: date || null, km: toInt(km), amountCents: amount ? parseMoneyToCents(amount) : null };
      await api.post(`/garage/vehicles/${vehicleId}/items`, body);
      toast.ok('Salvo.'); onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title={label} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Salvar</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label={reminder ? 'O que lembrar' : 'O que foi feito'}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={reminder ? 'Ex.: IPVA, revisão, troca de óleo' : 'Ex.: Troca de óleo, pneus, seguro'} /></Field>
        <div className="grid-2">
          <Field label={reminder ? 'Data (opcional)' : 'Data'}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={reminder ? 'Ou a quilometragem' : 'Quilometragem (opcional)'}><Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="50000" /></Field>
        </div>
        {!reminder && <Field label="Valor gasto (opcional)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="350,00" /></Field>}
        {reminder && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Informe a data, a quilometragem ou as duas.</p>}
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function GarageVehicle() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  usePageTitle('Veículo na garagem');
  const q = useAsync(() => api.get<{ vehicle: Vehicle; items: Item[]; reports: Report[] }>(`/garage/vehicles/${id}`), [id]);
  const [add, setAdd] = useState<Item['kind'] | null>(null);
  const [kmEdit, setKmEdit] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  if (q.loading && !q.data) return <PageLoading />;
  if (q.error != null || !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  const { vehicle: v, items, reports } = q.data;
  const reminders = items.filter((i) => i.kind === 'REMINDER');
  const log = items.filter((i) => i.kind !== 'REMINDER');
  const spent = log.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.ok(ok); q.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <div className="stack-lg">
      <Link to="/app/garagem" className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="arrow-left" size={16} /> Garagem</Link>
      <section className="card card-pad row-between">
        <div className="row" style={{ gap: 14 }}>
          <PlateBadge plate={v.plate} size="lg" />
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>{v.nickname || v.modelLabel || 'Veículo'}</h1>
            <p className="muted" style={{ margin: 0 }}>{[v.nickname ? v.modelLabel : '', v.modelYear].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        <div className="row">
          <LinkButton to={`/app/consultar?placa=${v.plate}`} icon="search">Consultar placa</LinkButton>
          <LinkButton to={`/simulador?${new URLSearchParams({ n: [v.modelLabel, v.modelYear].filter(Boolean).join(' ') }).toString()}`} icon="calculator" variant="ghost">Simular financiamento</LinkButton>
        </div>
      </section>

      <section className="card card-pad stack">
        <div className="row-between"><h2 style={{ fontSize: 18, margin: 0 }}>Quilometragem</h2>
          {kmEdit === null && <Button size="sm" onClick={() => setKmEdit(v.km == null ? '' : String(v.km))}>Atualizar</Button>}
        </div>
        {kmEdit === null ? <p style={{ margin: 0 }}><b className="num">{kmBr(v.km)}</b>{v.kmUpdatedAt ? <span className="muted"> · atualizada em {dayBr(v.kmUpdatedAt)}</span> : null}</p> : (
          <div className="row">
            <Input inputMode="numeric" value={kmEdit} onChange={(e) => setKmEdit(e.target.value.replace(/\D/g, '').slice(0, 7))} aria-label="Quilometragem atual" style={{ maxWidth: 200 }} />
            <Button variant="primary" onClick={() => void act(async () => { await api.patch(`/garage/vehicles/${v.id}`, { km: toInt(kmEdit) }); setKmEdit(null); }, 'Quilometragem atualizada.')}>Salvar</Button>
            <Button variant="ghost" onClick={() => setKmEdit(null)}>Cancelar</Button>
          </div>
        )}
      </section>

      <section className="card card-pad stack">
        <div className="row-between"><h2 style={{ fontSize: 18, margin: 0 }}>Lembretes</h2><Button size="sm" icon="plus" onClick={() => setAdd('REMINDER')}>Novo lembrete</Button></div>
        {!reminders.length ? <p className="muted" style={{ margin: 0 }}>Nenhum lembrete. Crie um para IPVA, licenciamento, revisão ou seguro.</p> : (
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {reminders.map((r) => {
              const b = STATUS_BADGE[r.status ?? 'OPEN']!;
              return (
                <li key={r.id} className="row-between" style={{ gap: 10 }}>
                  <div>
                    <b style={{ textDecoration: r.done ? 'line-through' : undefined }}>{r.title}</b>{' '}<Badge tone={b.tone}>{b.text}</Badge>
                    <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{[r.dueDate ? dayBr(r.dueDate) : '', r.dueKm != null ? `aos ${kmBr(r.dueKm)}` : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" onClick={() => void act(() => api.patch(`/garage/items/${r.id}`, { done: !r.done }))}>{r.done ? 'Reabrir' : 'Marcar feito'}</Button>
                    <Button size="sm" variant="ghost" icon="trash" aria-label={`Apagar ${r.title}`} onClick={() => void act(() => api.del(`/garage/items/${r.id}`))} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card card-pad stack">
        <div className="row-between"><h2 style={{ fontSize: 18, margin: 0 }}>Manutenções e gastos</h2><Button size="sm" icon="plus" onClick={() => setAdd('MAINTENANCE')}>Registrar</Button></div>
        {!log.length ? <p className="muted" style={{ margin: 0 }}>Nada registrado ainda.</p> : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Total registrado: <b className="num">{money(spent)}</b></p>
            <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {log.map((r) => (
                <li key={r.id} className="row-between" style={{ gap: 10 }}>
                  <div>
                    <b>{r.title}</b>
                    <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{[dayBr(r.eventDate), r.km != null ? kmBr(r.km) : '', r.amountCents != null ? money(r.amountCents) : ''].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon="trash" aria-label={`Apagar ${r.title}`} onClick={() => void act(() => api.del(`/garage/items/${r.id}`))} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card card-pad stack">
        <h2 style={{ fontSize: 18, margin: 0 }}>Relatórios desta placa</h2>
        {!reports.length ? <p className="muted" style={{ margin: 0 }}>Você ainda não fez consulta desta placa.</p> : (
          <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {reports.map((r) => <li key={r.id} className="row-between"><span>{r.productId === 'FIPE_FREE' ? 'Valor FIPE' : 'Consulta'} · {dayBr(r.createdAt)}</span><Link to={`/app/consulta/${r.id}`}>Abrir</Link></li>)}
          </ul>
        )}
      </section>

      <p className="muted" style={{ fontSize: 13 }}>{NOTE}</p>
      <div className="row">
        <Button icon="download" onClick={() => void api.download('/garage/export', 'minha-garagem.json').catch((e) => toast.error(errorMessage(e)))}>Exportar meus dados</Button>
        <Button variant="danger" icon="trash" onClick={() => setDel(true)}>Remover da garagem</Button>
      </div>
      {add && <ItemModal vehicleId={v.id} kind={add} onClose={() => setAdd(null)} onDone={() => { setAdd(null); q.reload(); }} />}
      {del && <ConfirmDialog danger title="Remover da garagem" message="Os lembretes e gastos deste veículo também serão apagados. Os relatórios continuam no seu histórico." confirmLabel="Remover" onClose={() => setDel(false)} onConfirm={async () => { await api.del(`/garage/vehicles/${v.id}`); toast.ok('Removido.'); nav('/app/garagem', { replace: true }); }} />}
    </div>
  );
}
