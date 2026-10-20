import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, CUSTOMER_TYPE, PAY_METHOD } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, Check, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, money, num, parseMoneyToCents } from '../../shared/format';
import { Kpi, PageHead } from '../parts';
import { CompanySelect, CustomerPicker, SITUATION, TypeBadge, type PickedCustomer } from '../people';

interface Charge {
  id: string; description: string; totalCents: number; status: string; notes: string | null; createdAt: string;
  payer: { userId: string | null; organizationId: string | null; name: string; email: string | null; type: string; companyName: string | null };
  paidCents: number; pendingCents: number; overdueCents: number; installmentsTotal: number; installmentsPaid: number; nextDue: string | null; situation: 'OPEN' | 'OVERDUE' | 'PAID' | 'CANCELLED';
}
interface Installment { id: string; number: number; amountCents: number; dueDate: string; status: string; overdue: boolean; paidAt: string | null; paidAmountCents: number | null; method: string | null; reference: string | null; fiscalDocumentId: string | null }
interface ChargeFull { charge: Charge; installments: Installment[]; fiscalDocuments: Array<{ id: string; kind: string; status: string; amountCents: number; number: string | null }> }
interface ListRes { items: Charge[]; total: number; summary: { receivableCents: number; overdueCents: number; dueWeekCents: number; receivedMonthCents: number; receivedTotalCents: number; overdueCharges: number } }

const isoDate = (offsetDays = 0): string => { const d = new Date(); d.setDate(d.getDate() + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDay = (iso: string): string => iso.split('-').reverse().join('/');

/** Mesma divisão do servidor: parcelas iguais e o resto de centavos na última. */
function planPreview(total: number, count: number, first: string, monthly: boolean): Array<{ amountCents: number; dueDate: string }> {
  if (!total || !/^\d{4}-\d{2}-\d{2}$/.test(first)) return [];
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => {
    const [y, m, d] = first.split('-').map(Number) as [number, number, number];
    const date = monthly ? new Date(Date.UTC(y, m - 1 + i, 1)) : new Date(Date.UTC(y, m - 1, d + i * 7));
    if (monthly) { const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(); date.setUTCDate(Math.min(d, last)); }
    return { amountCents: i === count - 1 ? total - base * (count - 1) : base, dueDate: date.toISOString().slice(0, 10) };
  });
}

export default function Charges() {
  usePageTitle('Cobranças');
  const { can } = useAdminSession();
  const [params, setParams] = useSearchParams();
  const customerId = params.get('cliente') ?? '';
  const [status, setStatus] = useState<'open' | 'overdue' | 'paid' | 'cancelled' | 'all'>('open');
  const [customerType, setCustomerType] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get('abrir'));
  const list = useAsync(() => api.get<ListRes>('/admin/charges', { query: { status, customerType, search: q.trim(), customerId } }), [status, customerType, q, customerId]);
  const s = list.data?.summary;
  const rows = list.data?.items ?? [];
  return (
    <>
      <PageHead title="Cobranças e parcelas" sub="Planos de pagamento por cliente ou empresa: o que já foi pago, o que falta e o que está atrasado."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nova cobrança</Button>} />
      <div className="adm-grid-4">
        <Kpi label="A receber" value={money(s?.receivableCents ?? 0)} sub="Parcelas em aberto" />
        <Kpi label="Em atraso" value={money(s?.overdueCents ?? 0)} tone={(s?.overdueCents ?? 0) > 0 ? 'danger' : undefined} sub={`${num(s?.overdueCharges ?? 0)} cobrança(s)`} />
        <Kpi label="Vencem em 7 dias" value={money(s?.dueWeekCents ?? 0)} tone={(s?.dueWeekCents ?? 0) > 0 ? 'warn' : undefined} />
        <Kpi label="Recebido no mês" value={money(s?.receivedMonthCents ?? 0)} tone="ok" sub={`Total já recebido: ${money(s?.receivedTotalCents ?? 0)}`} />
      </div>
      {customerId && <Alert tone="info">Mostrando só as cobranças de um cliente. <button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams({})}>Ver todas</button></Alert>}
      <Tabs label="Situação" value={status} onChange={setStatus} items={[{ id: 'open', label: 'Em aberto' }, { id: 'overdue', label: 'Atrasadas' }, { id: 'paid', label: 'Pagas' }, { id: 'cancelled', label: 'Canceladas' }, { id: 'all', label: 'Todas' }]} />
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por cliente, empresa ou descrição" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)} aria-label="Tipo de cliente"><option value="">Todos os tipos</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}</Select>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? (
        <EmptyState icon="receipt" title="Nenhuma cobrança neste filtro" action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Criar cobrança</Button>}>Crie uma cobrança para acompanhar parcelas e vencimentos.</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Descrição</th><th>Parcelas</th><th className="r">Total</th><th className="r">Falta pagar</th><th>Próx. vencimento</th><th>Situação</th></tr></thead><tbody>
          {rows.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
              <td><b>{c.payer.name}</b><div><TypeBadge type={c.payer.type} /></div></td>
              <td>{c.description}<div className="muted" style={{ fontSize: 12.5 }}>criada em {dateOnly(c.createdAt)}</div></td>
              <td><div className="progress"><i style={{ width: `${c.totalCents ? Math.min(100, Math.round((c.paidCents / c.totalCents) * 100)) : 0}%` }} /></div><small className="muted">{c.installmentsPaid} de {c.installmentsTotal} pagas</small></td>
              <td className="r num">{money(c.totalCents)}</td>
              <td className="r num">{c.pendingCents > 0 ? money(c.pendingCents) : '—'}</td>
              <td>{c.status === 'OPEN' && c.nextDue ? <span className={c.situation === 'OVERDUE' ? 'tag-danger' : undefined}>{fmtDay(c.nextDue)}</span> : '—'}</td>
              <td><Badge tone={SITUATION[c.situation]?.tone} dot>{SITUATION[c.situation]?.label}</Badge></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {creating && <ChargeModal onClose={(ch, id) => { setCreating(false); if (ch) { list.reload(); if (id) setOpen(id); } }} />}
      {open && <ChargeDetail id={open} canFiscal={can('MANAGE_FISCAL')} onClose={(ch) => { setOpen(null); if (params.get('abrir')) { const n = new URLSearchParams(params); n.delete('abrir'); setParams(n, { replace: true }); } if (ch) list.reload(); }} />}
    </>
  );
}

export function ChargeModal({ presetCustomer, presetCompany, onClose }: { presetCustomer?: PickedCustomer; presetCompany?: { id: string; name: string }; onClose: (changed: boolean, id?: string) => void }) {
  const toast = useToast();
  const [payerKind, setPayerKind] = useState<'customer' | 'company'>(presetCompany ? 'company' : 'customer');
  const [customer, setCustomer] = useState<PickedCustomer | null>(presetCustomer ?? null);
  const [companyId, setCompanyId] = useState(presetCompany?.id ?? '');
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState(1);
  const [first, setFirst] = useState(isoDate(7));
  const [monthly, setMonthly] = useState(true);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const totalCents = parseMoneyToCents(total) ?? 0;
  const preview = planPreview(totalCents, count, first, monthly);
  const payerOk = payerKind === 'customer' ? Boolean(customer) : Boolean(companyId);
  const valid = payerOk && description.trim().length >= 3 && totalCents >= 100 && preview.length === count && preview.every((p) => p.amountCents > 0);
  async function save() {
    setBusy(true);
    try {
      const r = await api.post<ChargeFull>('/admin/charges', {
        ...(payerKind === 'customer' ? { customerId: customer!.id } : { organizationId: companyId }),
        description: description.trim(), totalCents, notes: notes.trim() || null, plan: { count, firstDueDate: first, frequency: monthly ? 'MONTHLY' : 'WEEKLY' }
      });
      toast.ok('Cobrança criada.'); onClose(true, r.charge.id);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title="Nova cobrança" wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>Criar cobrança</Button></>}>
      <div className="stack">
        {!presetCustomer && !presetCompany && <Tabs label="Quem vai pagar" value={payerKind} onChange={setPayerKind} items={[{ id: 'customer', label: 'Um cliente' }, { id: 'company', label: 'Uma empresa' }]} />}
        {payerKind === 'customer'
          ? <Field label="Cliente">{presetCustomer ? <div className="picked"><div><b>{presetCustomer.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{presetCustomer.email}</div></div><TypeBadge type={presetCustomer.type} /></div> : <CustomerPicker value={customer} onChange={setCustomer} />}</Field>
          : <Field label="Empresa">{presetCompany ? <div className="picked"><div><b>{presetCompany.name}</b></div></div> : <CompanySelect value={companyId} onChange={setCompanyId} allowNone={false} />}</Field>}
        <Field label="O que está sendo cobrado"><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Ex.: Pacote mensal de consultas — março" /></Field>
        <div className="form-grid cols-2">
          <Field label="Valor total (R$)"><Input inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
          <Field label="Em quantas parcelas"><Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24, 36].map((n) => <option key={n} value={n}>{n === 1 ? 'À vista (1 parcela)' : `${n} parcelas`}</option>)}</Select></Field>
          <Field label="Primeiro vencimento"><Input type="date" value={first} min={isoDate(-365)} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Intervalo"><Select value={monthly ? 'm' : 'w'} onChange={(e) => setMonthly(e.target.value === 'm')} disabled={count === 1}><option value="m">Todo mês</option><option value="w">Toda semana</option></Select></Field>
        </div>
        {preview.length > 0 && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Parcela</th><th>Vencimento</th><th className="r">Valor</th></tr></thead><tbody>
            {preview.map((p, i) => <tr key={i}><td>{i + 1}/{preview.length}</td><td>{fmtDay(p.dueDate)}</td><td className="r num">{money(p.amountCents)}</td></tr>)}
          </tbody></table></div>
        )}
        <Field label="Observações" hint="Só a equipe vê."><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

function ChargeDetail({ id, canFiscal, onClose }: { id: string; canFiscal: boolean; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const res = useAsync(() => api.get<ChargeFull>(`/admin/charges/${id}`), [id]);
  const [changed, setChanged] = useState(false);
  const [pay, setPay] = useState<Installment | null>(null);
  const [due, setDue] = useState<Installment | null>(null);
  const [reopen, setReopen] = useState<Installment | null>(null);
  const [cancel, setCancel] = useState(false);
  const [remove, setRemove] = useState(false);
  const done = () => { setChanged(true); res.reload(); };
  const close = () => onClose(changed);
  if (res.loading && !res.data) return <Modal title="Cobrança" onClose={close}><PageLoading /></Modal>;
  if (res.error || !res.data) return <Modal title="Cobrança" onClose={close}><ErrorState error={res.error} onRetry={res.reload} /></Modal>;
  const { charge: c, installments } = res.data;
  const hasPaid = installments.some((i) => i.status === 'PAID');
  async function makeDoc(i: Installment) {
    try { await api.post(`/admin/charges/${id}/installments/${i.id}/fiscal-document`); toast.ok('Nota fiscal criada em “A emitir”.'); done(); } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <Modal title={c.description} wide onClose={close} footer={c.status !== 'CANCELLED' || !hasPaid ? <>
      {!hasPaid && <Button variant="danger" icon="trash" onClick={() => setRemove(true)}>Excluir</Button>}
      {c.status === 'OPEN' && <Button variant="ghost" onClick={() => setCancel(true)}>Cancelar cobrança</Button>}
      <span className="grow" /><Button variant="primary" onClick={close}>Fechar</Button></> : <Button variant="primary" onClick={close}>Fechar</Button>}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          <div><b>{c.payer.name}</b> <TypeBadge type={c.payer.type} />{c.payer.companyName && c.payer.companyName !== c.payer.name && <div className="muted" style={{ fontSize: 12.5 }}>{c.payer.companyName}</div>}</div>
          <span className="grow" />
          <Badge tone={SITUATION[c.situation]?.tone} dot>{SITUATION[c.situation]?.label}</Badge>
        </div>
        <div className="adm-grid-4 tight">
          <Kpi label="Total" value={money(c.totalCents)} />
          <Kpi label="Já pago" value={money(c.paidCents)} tone="ok" />
          <Kpi label="Falta pagar" value={money(c.pendingCents)} />
          <Kpi label="Em atraso" value={money(c.overdueCents)} tone={c.overdueCents > 0 ? 'danger' : undefined} />
        </div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Parcela</th><th>Vencimento</th><th className="r">Valor</th><th>Situação</th><th>Pagamento</th>{canFiscal && <th>Nota</th>}<th /></tr></thead><tbody>
          {installments.map((i) => (
            <tr key={i.id} className={i.status === 'CANCELLED' ? 'row-muted' : undefined}>
              <td>{i.number}/{installments.length}</td>
              <td>{i.status === 'PENDING' && i.overdue ? <span className="tag-danger">{fmtDay(i.dueDate)} · atrasada</span> : fmtDay(i.dueDate)}</td>
              <td className="r num">{money(i.amountCents)}</td>
              <td>{i.status === 'PAID' ? <Badge tone="ok" dot>Paga</Badge> : i.status === 'CANCELLED' ? <Badge>Cancelada</Badge> : <Badge tone={i.overdue ? 'danger' : 'warn'} dot>{i.overdue ? 'Atrasada' : 'A vencer'}</Badge>}</td>
              <td>{i.status === 'PAID' ? <>{dateOnly(i.paidAt)} · {PAY_METHOD[i.method ?? ''] ?? i.method}{i.paidAmountCents != null && i.paidAmountCents !== i.amountCents && <div className="muted" style={{ fontSize: 12.5 }}>recebido {money(i.paidAmountCents)}</div>}{i.reference && <div className="muted" style={{ fontSize: 12.5 }}>{i.reference}</div>}</> : '—'}</td>
              {canFiscal && <td>{i.fiscalDocumentId ? <Badge tone="info">Nota criada</Badge> : i.status === 'PAID' ? <Button size="sm" variant="ghost" onClick={() => void makeDoc(i)}>Gerar nota</Button> : '—'}</td>}
              <td className="actions wrap">
                {i.status === 'PENDING' && <><Button size="sm" variant="primary" onClick={() => setPay(i)}>Dar baixa</Button> <Button size="sm" variant="ghost" onClick={() => setDue(i)}>Mudar data</Button></>}
                {i.status === 'PAID' && <Button size="sm" variant="ghost" onClick={() => setReopen(i)}>Desfazer</Button>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
        {c.notes && <p className="muted">Obs.: {c.notes}</p>}
      </div>
      {pay && <PayModal installment={pay} chargeId={id} canFiscal={canFiscal} onClose={(ch) => { setPay(null); if (ch) done(); }} />}
      {due && <DueModal installment={due} chargeId={id} onClose={(ch) => { setDue(null); if (ch) done(); }} />}
      {reopen && <ConfirmDialog title="Desfazer pagamento?" confirmLabel="Desfazer" message={`A parcela ${reopen.number} volta para “em aberto”. Uma nota fiscal ainda não emitida desta parcela será cancelada.`} onConfirm={async () => { try { await api.post(`/admin/charges/${id}/installments/${reopen.id}/reopen`); toast.ok('Pagamento desfeito.'); done(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setReopen(null)} />}
      {cancel && <ConfirmDialog danger title="Cancelar cobrança?" confirmLabel="Cancelar cobrança" message="As parcelas ainda não pagas serão canceladas. O que já foi recebido continua registrado." onConfirm={async () => { try { await api.post(`/admin/charges/${id}/cancel`); toast.ok('Cobrança cancelada.'); done(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setCancel(false)} />}
      {remove && <ConfirmDialog danger title="Excluir cobrança?" confirmLabel="Excluir" message="A cobrança e suas parcelas serão apagadas. Só é possível enquanto nada foi pago." onConfirm={async () => { try { await api.del(`/admin/charges/${id}`); toast.ok('Cobrança excluída.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setRemove(false)} />}
    </Modal>
  );
}

function PayModal({ installment, chargeId, canFiscal, onClose }: { installment: Installment; chargeId: string; canFiscal: boolean; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [method, setMethod] = useState('PIX');
  const [date, setDate] = useState(isoDate());
  const [amount, setAmount] = useState((installment.amountCents / 100).toFixed(2).replace('.', ','));
  const [reference, setReference] = useState('');
  const [fiscal, setFiscal] = useState(canFiscal);
  const [busy, setBusy] = useState(false);
  const cents = parseMoneyToCents(amount);
  async function save() {
    if (!cents) return;
    setBusy(true);
    try {
      await api.post(`/admin/charges/${chargeId}/installments/${installment.id}/pay`, { method, paidAt: date, paidAmountCents: cents, reference: reference.trim() || null, createFiscalDocument: fiscal && canFiscal });
      toast.ok('Pagamento registrado.'); onClose(true);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={`Dar baixa — parcela ${installment.number}`} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!cents} onClick={() => void save()}>Registrar pagamento</Button></>}>
      <div className="stack">
        <p className="muted">Vencimento {fmtDay(installment.dueDate)} · valor da parcela <b>{money(installment.amountCents)}</b></p>
        <div className="form-grid cols-2">
          <Field label="Forma de pagamento"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Data em que recebeu"><Input type="date" value={date} max={isoDate()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor recebido (R$)" hint="Mude se houve desconto ou juros."><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Comprovante / observação"><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
        </div>
        {canFiscal && <Check checked={fiscal} onChange={(e) => setFiscal(e.target.checked)}>Já deixar a nota fiscal pendente em “A emitir”</Check>}
      </div>
    </Modal>
  );
}

function DueModal({ installment, chargeId, onClose }: { installment: Installment; chargeId: string; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(installment.dueDate);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.patch(`/admin/charges/${chargeId}/installments/${installment.id}`, { dueDate: date }); toast.ok('Vencimento alterado.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={`Novo vencimento — parcela ${installment.number}`} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!date || date === installment.dueDate} onClick={() => void save()}>Salvar</Button></>}>
      <Field label="Nova data de vencimento"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </Modal>
  );
}
