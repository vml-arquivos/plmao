import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Textarea, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, money, relativeTime } from '../../shared/format';
import { api } from '../api';
import { centsField, ROLE_LABEL, toCents, useStore, type Role } from './Store';
import { vName, type Vehicle } from './StoreStock';

type Stage = 'NEW' | 'CONTACT' | 'PROPOSAL' | 'VISIT' | 'WON' | 'LOST';
interface Lead { id: string; name: string; phone: string | null; email: string | null; source: string; stage: Stage; notes: string; lostReason: string | null; valueCents: number | null; nextContactAt: string | null; vehicleId: string | null; vehicleLabel: string | null; assignedTo: string | null; assigneeName: string | null; createdAt: string; updatedAt: string; closedAt: string | null }
interface LeadEvent { id: string; type: string; fromStage: Stage | null; toStage: Stage | null; note: string | null; actor: string | null; createdAt: string }
interface LeadDetail { lead: Lead; events: LeadEvent[]; proposals: Array<{ id: string; code: string; vehicleLabel: string; priceCents: number; createdAt: string }> }
interface Member { userId: string; name: string; role: Role; active: boolean }
const STAGES: Array<{ id: Stage; label: string }> = [{ id: 'NEW', label: 'Novo' }, { id: 'CONTACT', label: 'Contato' }, { id: 'PROPOSAL', label: 'Proposta' }, { id: 'VISIT', label: 'Visita' }, { id: 'WON', label: 'Fechado' }, { id: 'LOST', label: 'Perdido' }];
const SOURCE: Record<string, string> = { VITRINE: 'Vitrine', SITE: 'Site', WHATSAPP: 'WhatsApp', INDICACAO: 'Indicação', LOJA: 'Loja', OUTRO: 'Outro' };
const waLink = (phone: string) => `https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}`;

function LeadForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { canManage } = useStore();
  const toast = useToast();
  const stock = useAsync(() => api.get<Vehicle[]>('/dealer/vehicles'), []);
  const team = useAsync(() => (canManage ? api.get<{ members: Member[] }>('/dealer/members') : Promise.resolve({ members: [] as Member[] })), []);
  const [f, setF] = useState({ name: '', phone: '', email: '', vehicleId: '', source: 'LOJA', notes: '', assignedTo: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      await api.post('/dealer/leads', { name: f.name, phone: f.phone || null, email: f.email || null, vehicleId: f.vehicleId || null, source: f.source, notes: f.notes, ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}) });
      toast.ok('Lead criado.'); onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title="Novo lead" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Criar</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="Nome"><Input value={f.name} onChange={set('name')} maxLength={80} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Telefone"><Input inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="(11) 99999-9999" /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        </div>
        <div className="grid-2">
          <Field label="Veículo de interesse"><Select value={f.vehicleId} onChange={set('vehicleId')}><option value="">Nenhum</option>{(stock.data ?? []).map((v) => <option key={v.id} value={v.id}>{vName(v)}</option>)}</Select></Field>
          <Field label="Origem"><Select value={f.source} onChange={set('source')}>{['LOJA', 'WHATSAPP', 'SITE', 'INDICACAO', 'OUTRO'].map((s) => <option key={s} value={s}>{SOURCE[s]}</option>)}</Select></Field>
        </div>
        {canManage && <Field label="Responsável"><Select value={f.assignedTo} onChange={set('assignedTo')}><option value="">Sem responsável</option>{(team.data?.members ?? []).filter((m) => m.active).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select></Field>}
        <Field label="Observações"><Textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={2000} /></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function LeadModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { canManage } = useStore();
  const toast = useToast();
  const d = useAsync(() => api.get<LeadDetail>(`/dealer/leads/${id}`), [id]);
  const team = useAsync(() => (canManage ? api.get<{ members: Member[] }>('/dealer/members') : Promise.resolve({ members: [] as Member[] })), []);
  const [note, setNote] = useState(''); const [lost, setLost] = useState(false); const [reason, setReason] = useState(''); const [del, setDel] = useState(false); const [proposal, setProposal] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.ok(ok); d.reload(); onChanged(); } catch (e) { toast.error(errorMessage(e)); } };
  if (d.loading && !d.data) return <Modal title="Lead" onClose={onClose}><PageLoading /></Modal>;
  if (d.error != null || !d.data) return <Modal title="Lead" onClose={onClose}><ErrorState error={d.error} onRetry={d.reload} /></Modal>;
  const { lead, events, proposals } = d.data;
  const closed = lead.stage === 'WON' || lead.stage === 'LOST';
  const move = (stage: Stage) => run(() => api.post(`/dealer/leads/${id}/stage`, { stage }));
  return (
    <Modal wide title={lead.name} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <Badge tone={lead.stage === 'WON' ? 'ok' : lead.stage === 'LOST' ? 'danger' : 'info'}>{STAGES.find((s) => s.id === lead.stage)?.label}</Badge>
          <Badge>{SOURCE[lead.source] ?? lead.source}</Badge>
          {lead.assigneeName ? <Badge tone="violet">{lead.assigneeName}</Badge> : <Badge tone="warn">Sem responsável</Badge>}
        </div>
        <div className="grid-2">
          <div className="stack-sm">
            {lead.phone && <div className="row"><b>{lead.phone}</b><a className="btn btn-sm" href={waLink(lead.phone)} target="_blank" rel="noopener noreferrer">WhatsApp</a></div>}
            {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
            {lead.vehicleLabel && <span>{lead.vehicleLabel}</span>}
            {lead.lostReason && <span className="muted">Motivo: {lead.lostReason}</span>}
            {lead.notes && <p className="muted" style={{ margin: 0 }}>{lead.notes}</p>}
          </div>
          <div className="stack-sm">
            {!lead.assignedTo && <Button size="sm" onClick={() => void run(() => api.post(`/dealer/leads/${id}/claim`), 'Lead assumido.')}>Assumir lead</Button>}
            {canManage && (
              <Field label="Responsável"><Select value={lead.assignedTo ?? ''} onChange={(e) => void run(() => api.patch(`/dealer/leads/${id}`, { assignedTo: e.target.value || null }))}><option value="">Sem responsável</option>{(team.data?.members ?? []).filter((m) => m.active).map((m) => <option key={m.userId} value={m.userId}>{m.name} ({ROLE_LABEL[m.role]})</option>)}</Select></Field>
            )}
            <Field label="Próximo retorno"><Input type="datetime-local" defaultValue={lead.nextContactAt ? new Date(new Date(lead.nextContactAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onBlur={(e) => { const v = e.target.value; void run(() => api.patch(`/dealer/leads/${id}`, { nextContactAt: v ? new Date(v).toISOString() : null })); }} /></Field>
          </div>
        </div>
        <div className="row">
          {!closed ? <>
            {STAGES.filter((s) => s.id !== 'WON' && s.id !== 'LOST' && s.id !== lead.stage).map((s) => <Button key={s.id} size="sm" onClick={() => void move(s.id)}>{s.label}</Button>)}
            <Button size="sm" variant="primary" onClick={() => void move('WON')}>Fechado</Button>
            <Button size="sm" variant="ghost" onClick={() => setLost(true)}>Perdido</Button>
          </> : canManage && <Button size="sm" onClick={() => void move('NEW')}>Reabrir</Button>}
          <Button size="sm" onClick={() => setProposal(true)}>Nova proposta</Button>
          {canManage && <Button size="sm" variant="ghost" onClick={() => setDel(true)}>Excluir</Button>}
        </div>
        {lost && (
          <div className="card card-pad stack-sm">
            <Field label="Motivo da perda"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
            <div className="row"><Button size="sm" variant="ghost" onClick={() => setLost(false)}>Cancelar</Button><Button size="sm" variant="danger" disabled={reason.trim().length < 3} onClick={() => void run(() => api.post(`/dealer/leads/${id}/stage`, { stage: 'LOST', lostReason: reason }).then(() => setLost(false)))}>Marcar como perdido</Button></div>
          </div>
        )}
        {proposals.length > 0 && (
          <div className="stack-sm"><b>Propostas</b>{proposals.map((p) => <div key={p.id} className="row-between"><span>{p.code} · {p.vehicleLabel} · {money(p.priceCents)}</span><Button size="sm" variant="ghost" icon="download" onClick={() => void api.download(`/dealer/proposals/${p.id}/pdf`, `proposta-${p.code}.pdf`).catch((e) => toast.error(errorMessage(e)))}>PDF</Button></div>)}</div>
        )}
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; void run(() => api.post(`/dealer/leads/${id}/notes`, { note }).then(() => setNote(''))); }}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anotar contato" maxLength={1000} style={{ flex: 1 }} /><Button type="submit" disabled={!note.trim()}>Anotar</Button>
        </form>
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.id}><span className="muted">{relativeTime(e.createdAt)}</span> <b>{e.type === 'STAGE' ? `${STAGES.find((s) => s.id === e.fromStage)?.label ?? ''} → ${STAGES.find((s) => s.id === e.toStage)?.label ?? ''}` : e.type === 'CREATED' ? 'Lead criado' : e.type === 'NOTE' ? 'Anotação' : e.type === 'PROPOSAL' ? 'Proposta' : 'Responsável'}</b>{e.note ? ` · ${e.note}` : ''}{e.actor ? <span className="muted"> · {e.actor}</span> : null}</li>
          ))}
        </ul>
      </div>
      {del && <ConfirmDialog title="Excluir lead" message="O lead e o histórico são apagados de vez." confirmLabel="Excluir" danger onConfirm={async () => { await api.del(`/dealer/leads/${id}`); onChanged(); onClose(); }} onClose={() => setDel(false)} />}
      {proposal && <ProposalForm lead={lead} onClose={() => setProposal(false)} onDone={() => { setProposal(false); d.reload(); onChanged(); }} />}
    </Modal>
  );
}

export function StoreLeads() {
  const { canManage } = useStore();
  const toast = useToast();
  const [mine, setMine] = useState(false);
  const list = useAsync(() => api.get<Lead[]>(`/dealer/leads${mine ? '?assigned=me' : ''}`), [mine]);
  const [open, setOpen] = useState<string | null>(null); const [adding, setAdding] = useState(false); const [trade, setTrade] = useState(false);
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  return (
    <div className="stack">
      <div className="row-between">
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Só os meus</label>
        <div className="row">
          {canManage && <Button icon="download" onClick={() => void api.download('/dealer/leads.csv', 'leads.csv').catch((e) => toast.error(errorMessage(e)))}>CSV</Button>}
          <Button onClick={() => setTrade(true)}>Avaliar troca</Button>
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Novo lead</Button>
        </div>
      </div>
      {!rows.length ? <EmptyState icon="users" title="Nenhum lead ainda" action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Novo lead</Button>}>Contatos da vitrine e os que você cadastrar aparecem aqui.</EmptyState> : (
        <div className="kanban">
          {STAGES.map((s) => {
            const col = rows.filter((l) => l.stage === s.id);
            return (
              <section key={s.id} className={`kcol st-${s.id}`} aria-label={s.label}>
                <header><b>{s.label}</b><span>{col.length}</span></header>
                {col.map((l) => (
                  <button key={l.id} type="button" className="kcard" onClick={() => setOpen(l.id)}>
                    <b>{l.name}</b>
                    <span className="muted">{l.vehicleLabel ?? SOURCE[l.source]}</span>
                    <span className="kmeta">{l.assigneeName ?? 'Sem responsável'}{l.nextContactAt && new Date(l.nextContactAt) <= new Date() && l.stage !== 'WON' && l.stage !== 'LOST' ? ' · retorno atrasado' : ''}</span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {adding && <LeadForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      {open && <LeadModal id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {trade && <TradeInModal onClose={() => setTrade(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- avaliação de troca

interface TradeResult { suggestedCents: number; minCents: number; maxCents: number; breakdown: { lines: Array<{ label: string; bps: number; cents: number }>; expectedKm: number | null } }
export function TradeInModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ vehicleLabel: '', plate: '', yearModel: '', mileageKm: '', condition: 'BOM', fipe: '' });
  const [res, setRes] = useState<TradeResult | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const fipe = toCents(f.fipe); if (fipe == null) throw new Error('Informe o valor da FIPE.');
      setRes(await api.post<TradeResult>('/dealer/trade-in', { vehicleLabel: f.vehicleLabel, plate: f.plate || null, yearModel: f.yearModel ? Number(f.yearModel) : null, mileageKm: Number(f.mileageKm || 0), condition: f.condition, fipeCents: fipe }));
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal title="Avaliar troca" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Calcular</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="Veículo"><Input value={f.vehicleLabel} onChange={set('vehicleLabel')} placeholder="VW Gol 1.0 2015" maxLength={120} autoFocus /></Field>
        <div className="grid-2">
          <Field label="Placa (opcional)"><Input value={f.plate} onChange={(e) => setF((s) => ({ ...s, plate: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) }))} /></Field>
          <Field label="Ano modelo"><Input inputMode="numeric" value={f.yearModel} onChange={(e) => setF((s) => ({ ...s, yearModel: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></Field>
          <Field label="Km"><Input inputMode="numeric" value={f.mileageKm} onChange={(e) => setF((s) => ({ ...s, mileageKm: e.target.value.replace(/\D/g, '').slice(0, 7) }))} /></Field>
          <Field label="Condição"><Select value={f.condition} onChange={set('condition')}><option value="EXCELENTE">Excelente</option><option value="BOM">Bom</option><option value="REGULAR">Regular</option></Select></Field>
        </div>
        <Field label="FIPE (R$)"><Input inputMode="decimal" value={f.fipe} onChange={set('fipe')} /></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        {res && (
          <div className="card card-pad stack-sm">
            <div className="muted">Oferta sugerida</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{money(res.suggestedCents)}</div>
            <div className="muted">Faixa {money(res.minCents)} a {money(res.maxCents)}</div>
            <ul className="timeline">{res.breakdown.lines.map((l) => <li key={l.label}>{l.label}: {money(l.cents)}</li>)}</ul>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Estimativa interna da loja. Não é laudo nem avaliação oficial.</p>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- propostas

interface Proposal { id: string; code: string; customerName: string; vehicleLabel: string; priceCents: number; downPaymentCents: number; tradeInCents: number; months: number | null; installmentCents: number | null; validUntil: string; sellerName: string | null; createdAt: string }

function ProposalForm({ lead, onClose, onDone }: { lead?: Lead; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const stock = useAsync(() => api.get<Vehicle[]>('/dealer/vehicles'), []);
  const [f, setF] = useState({ vehicleId: lead?.vehicleId ?? '', customerName: lead?.name ?? '', vehicleLabel: '', price: '', down: '', trade: '', months: '48', rate: '', finance: true, notes: '' });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const vehicle = (stock.data ?? []).find((v) => v.id === f.vehicleId);
  const pick = (id: string) => { const v = (stock.data ?? []).find((x) => x.id === id); setF((s) => ({ ...s, vehicleId: id, price: v ? centsField(v.priceCents) : s.price })); };
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try {
      const price = toCents(f.price) ?? vehicle?.priceCents ?? null;
      await api.post('/dealer/proposals', {
        vehicleId: f.vehicleId || null, leadId: lead?.id ?? null, customerName: f.customerName || undefined, vehicleLabel: f.vehicleLabel || undefined, priceCents: price ?? undefined,
        downPaymentCents: toCents(f.down) ?? 0, tradeInCents: toCents(f.trade) ?? 0, notes: f.notes,
        financing: f.finance ? { months: Number(f.months), ratePct: f.rate ? Number(f.rate.replace(',', '.')) : null } : null
      });
      toast.ok('Proposta criada.'); onDone();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal wide title="Nova proposta" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Criar proposta</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="grid-2">
          <Field label="Cliente"><Input value={f.customerName} onChange={set('customerName')} maxLength={80} /></Field>
          <Field label="Veículo do estoque"><Select value={f.vehicleId} onChange={(e) => pick(e.target.value)}><option value="">Outro veículo</option>{(stock.data ?? []).map((v) => <option key={v.id} value={v.id}>{vName(v)}</option>)}</Select></Field>
        </div>
        {!f.vehicleId && <Field label="Descrição do veículo"><Input value={f.vehicleLabel} onChange={set('vehicleLabel')} maxLength={120} /></Field>}
        <div className="grid-3">
          <Field label="Preço (R$)"><Input inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
          <Field label="Entrada (R$)"><Input inputMode="decimal" value={f.down} onChange={set('down')} /></Field>
          <Field label="Troca (R$)"><Input inputMode="decimal" value={f.trade} onChange={set('trade')} /></Field>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={f.finance} onChange={(e) => setF((s) => ({ ...s, finance: e.target.checked }))} /> Simular financiamento do saldo</label>
        {f.finance && (
          <div className="grid-2">
            <Field label="Parcelas"><Select value={f.months} onChange={set('months')}>{[12, 24, 36, 48, 60].map((m) => <option key={m} value={m}>{m}x</option>)}</Select></Field>
            <Field label="Juros ao mês (%)" hint="Em branco usa a taxa de mercado."><Input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="1,89" /></Field>
          </div>
        )}
        <Field label="Observações"><Textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={500} /></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function StoreProposals() {
  const toast = useToast();
  const list = useAsync(() => api.get<Proposal[]>('/dealer/proposals'), []);
  const [adding, setAdding] = useState(false); const [trade, setTrade] = useState(false);
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button onClick={() => setTrade(true)}>Avaliar troca</Button>
        <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Nova proposta</Button>
      </div>
      {!rows.length ? <EmptyState icon="file-text" title="Nenhuma proposta" action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Nova proposta</Button>}>Gere um PDF com preço, entrada, troca e parcelas para enviar ao cliente.</EmptyState> : (
        <div className="table-wrap"><table className="table cards">
          <thead><tr><th>Proposta</th><th className="r">Preço</th><th className="r">Parcela</th><th>Validade</th><th /></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td><b>{p.customerName}</b><div className="muted" style={{ fontSize: 13 }}>{p.vehicleLabel} · {p.code}</div></td>
              <td className="r">{money(p.priceCents)}</td>
              <td className="r">{p.installmentCents != null ? `${p.months}x ${money(p.installmentCents)}` : 'À vista'}</td>
              <td>{dateOnly(p.validUntil)}</td>
              <td className="actions"><Button size="sm" icon="download" onClick={() => void api.download(`/dealer/proposals/${p.id}/pdf`, `proposta-${p.code}.pdf`).catch((e) => toast.error(errorMessage(e)))}>PDF</Button></td>
            </tr>))}</tbody>
        </table></div>
      )}
      {adding && <ProposalForm onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      {trade && <TradeInModal onClose={() => setTrade(false)} />}
      <p className="muted" style={{ fontSize: 13 }}>Parcelas simuladas com a taxa informada ou a média de mercado. A aprovação do crédito depende da financeira. <Link to="/simulador">Abrir simulador</Link></p>
    </div>
  );
}
