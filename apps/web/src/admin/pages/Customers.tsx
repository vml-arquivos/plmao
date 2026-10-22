import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CUSTOMER_TYPE, maskDocument, maskPhone, maskZip, SEGMENT_SUGGESTIONS, STATES, type CustomerType } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, dateTime, formatPlate, money, num, parseMoneyToCents } from '../../shared/format';
import { Card, Kpi, PageHead, PaymentStatusBadge, QueryStatusBadge } from '../parts';
import { CompanySelect, FISCAL_STATUS, SITUATION, TypeBadge, TypeCards, type Customer } from '../people';
import { ChargeModal } from './Charges';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const PAGE = 50;

interface ListRes { items: Customer[]; total: number; byType: Record<CustomerType, number> }

export default function Customers() {
  usePageTitle('Clientes');
  const { can } = useAdminSession();
  const nav = useNavigate();
  const [type, setType] = useState<'' | CustomerType>('');
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState('');
  const [status, setStatus] = useState('active');
  const [billing, setBilling] = useState('');
  const [org, setOrg] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const query = { search: dq, type, segment, status, billing, organizationId: org, limit: PAGE, offset };
  const list = useAsync(() => api.get<ListRes>('/admin/customers', { query }), [dq, type, segment, status, billing, org, offset]);
  const segments = useAsync(() => api.get<{ items: Array<{ segment: string; count: number }> }>('/admin/customers/segments'));
  useEffect(() => { setOffset(0); }, [dq, type, segment, status, billing, org]);
  const by = list.data?.byType ?? { PARTICULAR: 0, AUTONOMO: 0, EMPRESA: 0 };
  const total = by.PARTICULAR + by.AUTONOMO + by.EMPRESA;
  const rows = list.data?.items ?? [];

  async function exportCsv() {
    try {
      const params = new URLSearchParams(Object.entries({ search: dq, type, segment, status, billing, organizationId: org }).filter(([, v]) => v) as Array<[string, string]>);
      await api.download(`/admin/customers/export.csv?${params.toString()}`, 'clientes.csv');
    } catch (e) { window.alert(errorMessage(e)); }
  }

  return (
    <>
      <PageHead title="Clientes" sub="Quem compra e consulta. Separe particulares, autônomos (vendedores, despachantes) e empresas, e acompanhe consultas, pagamentos e dados para nota fiscal."
        actions={<>{can('MANAGE_CUSTOMERS') && <Button variant="ghost" icon="download" onClick={() => void exportCsv()}>Exportar planilha</Button>}{can('MANAGE_CUSTOMERS') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo cliente</Button>}</>} />
      <Tabs label="Tipo de cliente" value={type} onChange={setType} items={[
        { id: '', label: `Todos (${num(total)})` },
        { id: 'PARTICULAR', label: `${CUSTOMER_TYPE.PARTICULAR.plural} (${num(by.PARTICULAR)})` },
        { id: 'AUTONOMO', label: `${CUSTOMER_TYPE.AUTONOMO.plural} (${num(by.AUTONOMO)})` },
        { id: 'EMPRESA', label: `${CUSTOMER_TYPE.EMPRESA.plural} (${num(by.EMPRESA)})` }
      ]} />
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por nome, e-mail, CPF/CNPJ ou telefone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Segmento"><option value="">Todos os segmentos</option>{segments.data?.items.map((s) => <option key={s.segment} value={s.segment}>{s.segment} ({s.count})</option>)}</Select>
        <Select value={billing} onChange={(e) => setBilling(e.target.value)} aria-label="Situação financeira"><option value="">Qualquer situação financeira</option><option value="overdue">Com pagamento em atraso</option><option value="open">Com valor a receber</option><option value="clear">Sem pendências</option></Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação do cadastro"><option value="active">Ativos</option><option value="inactive">Bloqueados</option><option value="archived">Arquivados</option><option value="all">Todos</option></Select>
        <div style={{ minWidth: 180 }}><CompanySelect value={org} onChange={setOrg} noneLabel="Todas as empresas" /></div>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? (
        <EmptyState icon="users" title="Nenhum cliente encontrado" action={can('MANAGE_CUSTOMERS') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Cadastrar cliente</Button> : undefined}>Ajuste os filtros ou cadastre um novo cliente.</EmptyState>
      ) : (
        <>
          <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Tipo</th><th>CPF/CNPJ</th><th className="r">Consultas</th><th className="r">Total pago</th><th className="r">A receber</th><th className="r">Saldo</th><th>Situação</th></tr></thead><tbody>
            {rows.map((c) => (
              <tr key={c.id} className={`clickable ${c.active ? '' : 'row-muted'}`} onClick={() => nav(`/clientes/${c.id}`)}>
                <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{c.email}</div>{c.organization && <div className="muted" style={{ fontSize: 12.5 }}>{c.organization.name}</div>}</td>
                <td><TypeBadge type={c.type} />{c.segment && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{c.segment}</div>}</td>
                <td className="mono" style={{ fontSize: 13 }}>{c.cpfCnpj ?? <span className="tag-warn">não informado</span>}</td>
                <td className="r num">{num(c.queriesCount)}</td>
                <td className="r num">{money(c.paidCents)}</td>
                <td className="r num">{c.overdueCents > 0 ? <span className="tag-danger">{money(c.overdueCents)} em atraso</span> : c.openCents > 0 ? money(c.openCents) : '—'}</td>
                <td className="r num">{money(c.balanceCents)}</td>
                <td>{c.archived ? <Badge>Arquivado</Badge> : <Badge tone={c.active ? 'ok' : 'danger'} dot>{c.active ? 'Ativo' : 'Bloqueado'}</Badge>}{!c.fiscalReady && c.active && <div className="tag-warn">Falta dado fiscal</div>}</td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{num(list.data?.total)} cliente(s) neste filtro</span>
            <div className="row"><Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</Button><Button size="sm" variant="ghost" disabled={offset + PAGE >= (list.data?.total ?? 0)} onClick={() => setOffset(offset + PAGE)}>Próxima</Button></div>
          </div>
        </>
      )}
      {creating && <CustomerForm onClose={(c) => { setCreating(false); if (c) { list.reload(); segments.reload(); } }} />}
    </>
  );
}

const blank = (c: Customer | null) => ({
  type: (c?.type ?? 'PARTICULAR') as CustomerType, name: c?.name ?? '', email: c?.email ?? '', segment: c?.segment ?? '', cpfCnpj: c?.cpfCnpj ?? '', phone: c?.phone ?? '', companyName: c?.companyName ?? '', legalName: c?.legalName ?? '',
  stateRegistration: c?.stateRegistration ?? '', municipalRegistration: c?.municipalRegistration ?? '', billingEmail: c?.billingEmail ?? '', zip: c?.zip ?? '', street: c?.street ?? '', streetNumber: c?.streetNumber ?? '',
  complement: c?.complement ?? '', district: c?.district ?? '', city: c?.city ?? '', state: c?.state ?? '', notes: c?.notes ?? '', organizationId: c?.organization?.id ?? '', portalAccess: true
});
const nz = (s: string): string | null => (s.trim() ? s.trim() : null);

export function CustomerForm({ customer, onClose }: { customer?: Customer; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank(customer ?? null));
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; invited: boolean; sent: boolean } | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const docLabel = f.type === 'EMPRESA' ? 'CNPJ' : f.type === 'PARTICULAR' ? 'CPF' : 'CPF ou CNPJ';
  const valid = f.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(f.email.trim());

  async function save() {
    const body = {
      type: f.type, name: f.name.trim(), email: f.email.trim().toLowerCase(), segment: nz(f.segment), cpfCnpj: nz(f.cpfCnpj), phone: nz(f.phone), companyName: nz(f.companyName), legalName: nz(f.legalName),
      stateRegistration: nz(f.stateRegistration), municipalRegistration: nz(f.municipalRegistration), billingEmail: nz(f.billingEmail), zip: nz(f.zip), street: nz(f.street), streetNumber: nz(f.streetNumber),
      complement: nz(f.complement), district: nz(f.district), city: nz(f.city), state: nz(f.state), notes: nz(f.notes), organizationId: f.organizationId || null
    };
    setBusy(true);
    try {
      if (customer) { await api.patch(`/admin/customers/${customer.id}`, body); toast.ok('Cadastro atualizado.'); onClose(true); return; }
      const r = await api.post<{ customer: Customer; inviteSent: boolean }>('/admin/customers', { ...body, portalAccess: f.portalAccess });
      setCreated({ name: r.customer.name, email: r.customer.email, invited: f.portalAccess, sent: r.inviteSent });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  if (created) {
    return (
      <Modal title="Cliente cadastrado" onClose={() => onClose(true)} footer={<Button variant="primary" onClick={() => onClose(true)}>Concluir</Button>}>
        <div className="stack">
          <p><b>{created.name}</b> foi cadastrado como {CUSTOMER_TYPE[f.type].label.toLowerCase()}.</p>
          {created.invited ? (
            created.sent
              ? <Alert tone="info">Enviamos um e-mail para {created.email} com o link para o cliente criar a própria senha. Ninguém além dele vê a senha.</Alert>
              : <Alert tone="warn">O e-mail para {created.email} não saiu. Quando o envio estiver funcionando, use “Enviar link de nova senha” na ficha do cliente.</Alert>
          ) : <Alert tone="info">Cadastro sem acesso ao site. Útil para controle, cobrança e nota fiscal.</Alert>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={customer ? `Editar — ${customer.name}` : 'Novo cliente'} wide onClose={() => onClose(false)}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()}>{customer ? 'Salvar alterações' : 'Cadastrar cliente'}</Button></>}>
      <div className="stack">
        <div className="stack-sm"><span className="section-title">1. Tipo de cliente</span><TypeCards value={f.type} onChange={(t) => set('type', t)} /></div>
        <span className="section-title">2. Identificação</span>
        <div className="form-grid cols-2">
          <Field label={f.type === 'EMPRESA' ? 'Nome do responsável' : 'Nome completo'}><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} autoComplete="off" /></Field>
          <Field label="E-mail" hint="Também é o login do cliente no site."><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} autoComplete="off" /></Field>
          <Field label={docLabel} hint="Necessário para emitir nota fiscal."><Input inputMode="numeric" value={f.cpfCnpj} onChange={(e) => set('cpfCnpj', maskDocument(e.target.value))} placeholder={f.type === 'EMPRESA' ? '00.000.000/0000-00' : '000.000.000-00'} /></Field>
          <Field label="Telefone / WhatsApp"><Input inputMode="tel" value={f.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} placeholder="(00) 00000-0000" /></Field>
          {f.type !== 'PARTICULAR' && (
            <Field label="Segmento" hint="Como esse cliente trabalha. Serve de filtro nas listas."><Input list="seg-list" value={f.segment} onChange={(e) => set('segment', e.target.value)} maxLength={60} /><datalist id="seg-list">{SEGMENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist></Field>
          )}
          <Field label="Empresa vinculada" hint="Para agências e lojas com vários usuários."><CompanySelect value={f.organizationId} onChange={(v) => set('organizationId', v)} /></Field>
        </div>
        <details className="fiscal-box" open={f.type === 'EMPRESA' || Boolean(customer?.street)}>
          <summary><b>3. Dados para nota fiscal</b> <span className="muted">(endereço e inscrições)</span></summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {f.type === 'EMPRESA' && (
              <div className="form-grid cols-2">
                <Field label="Razão social"><Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={160} /></Field>
                <Field label="Nome fantasia"><Input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} maxLength={160} /></Field>
                <Field label="Inscrição estadual"><Input value={f.stateRegistration} onChange={(e) => set('stateRegistration', e.target.value)} maxLength={30} /></Field>
                <Field label="Inscrição municipal"><Input value={f.municipalRegistration} onChange={(e) => set('municipalRegistration', e.target.value)} maxLength={30} /></Field>
              </div>
            )}
            <div className="form-grid cols-2">
              <Field label="E-mail para envio da nota" hint="Se vazio, usa o e-mail de acesso."><Input type="email" value={f.billingEmail} onChange={(e) => set('billingEmail', e.target.value)} maxLength={254} /></Field>
              <Field label="CEP"><Input inputMode="numeric" value={f.zip} onChange={(e) => set('zip', maskZip(e.target.value))} placeholder="00000-000" /></Field>
              <Field label="Rua / avenida"><Input value={f.street} onChange={(e) => set('street', e.target.value)} maxLength={160} /></Field>
              <Field label="Número"><Input value={f.streetNumber} onChange={(e) => set('streetNumber', e.target.value)} maxLength={20} /></Field>
              <Field label="Complemento"><Input value={f.complement} onChange={(e) => set('complement', e.target.value)} maxLength={80} /></Field>
              <Field label="Bairro"><Input value={f.district} onChange={(e) => set('district', e.target.value)} maxLength={80} /></Field>
              <Field label="Cidade"><Input value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={80} /></Field>
              <Field label="UF"><Select value={f.state} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            </div>
          </div>
        </details>
        <Field label="Observações internas" hint="Só a equipe vê."><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} /></Field>
        {!customer && <Switch checked={f.portalAccess} onChange={(e) => set('portalAccess', e.target.checked)} label="Criar acesso ao site (o cliente recebe um link por e-mail para criar a senha)" />}
      </div>
    </Modal>
  );
}

export function AdjustModal({ customer, onClose }: { customer: Pick<Customer, 'id' | 'name' | 'balanceCents'>; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseMoneyToCents(amount);
  async function save() {
    if (!cents) return;
    setBusy(true);
    try { await api.post(`/admin/users/${customer.id}/wallet-adjustments`, { amountCents: kind === 'credit' ? cents : -cents, description: desc.trim() }); toast.ok('Saldo ajustado.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={`Ajustar saldo — ${customer.name}`} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!cents || desc.trim().length < 8} onClick={() => void save()}>Aplicar ajuste</Button></>}>
      <div className="stack">
        <p className="muted">Saldo atual: <b>{money(customer.balanceCents)}</b></p>
        <div className="form-grid"><Field label="Tipo"><Select value={kind} onChange={(e) => setKind(e.target.value as 'credit' | 'debit')}><option value="credit">Crédito (adicionar)</option><option value="debit">Débito (remover)</option></Select></Field>
          <Field label="Valor (R$)"><Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field></div>
        <Field label="Motivo (mín. 8 caracteres)" hint="Aparece no extrato do cliente."><Input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={280} /></Field>
      </div>
    </Modal>
  );
}

interface Detail {
  customer: Customer;
  queries: Array<{ id: string; plate: string; status: string; priceCents: number; createdAt: string; productName: string }>;
  payments: Array<{ id: string; status: string; amountCents: number; provider: string; createdAt: string; paidAt: string | null }>;
  charges: Array<{ id: string; description: string; totalCents: number; status: string; createdAt: string; paidCents: number; nextDue: string | null }>;
  fiscalDocuments: Array<{ id: string; kind: string; status: string; amountCents: number; number: string | null; issuedAt: string | null; createdAt: string }>;
}

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAdminSession();
  const res = useAsync(() => api.get<Detail>(`/admin/customers/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [charge, setCharge] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'archive' | 'block' | 'password' | null>(null);
  usePageTitle(res.data?.customer.name ?? 'Cliente');
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { customer: c, queries, payments, charges, fiscalDocuments } = res.data;
  const manage = can('MANAGE_CUSTOMERS');
  const missing = [!c.cpfCnpj && 'CPF/CNPJ', !c.street && 'endereço', !c.zip && 'CEP', !c.city && 'cidade', !c.state && 'UF'].filter(Boolean) as string[];

  return (
    <>
      <p style={{ marginBottom: 8 }}><Link to="/clientes">← Voltar para clientes</Link></p>
      <PageHead title={c.name} sub={<>{c.email} · cliente desde {dateOnly(c.createdAt)} · <TypeBadge type={c.type} />{c.segment && <> · {c.segment}</>}{c.organization && <> · <Link to={`/empresas/${c.organization.id}`}>{c.organization.name}</Link></>}</>}
        actions={manage && <>
          {can('MANAGE_BILLING') && <Button variant="primary" icon="receipt" onClick={() => setCharge(true)}>Nova cobrança</Button>}
          <Button icon="settings" onClick={() => setEdit(true)}>Editar cadastro</Button>
          {can('MANAGE_BILLING') && c.active && <Button variant="ghost" icon="wallet" onClick={() => setAdjust(true)}>Ajustar saldo</Button>}
        </>} />
      {c.archived && <Alert tone="warn" title="Cadastro arquivado">Este cliente não aparece nas listas e não consegue entrar. Restaure para voltar a usar.</Alert>}
      {!c.active && !c.archived && <Alert tone="danger" title="Acesso bloqueado">Este cliente não consegue entrar no site.</Alert>}
      <div className="adm-grid-4">
        <Kpi label="Consultas feitas" value={num(c.queriesCount)} sub={c.lastQueryAt ? `Última em ${dateOnly(c.lastQueryAt)}` : 'Nenhuma ainda'} />
        <Kpi label="Total pago" value={money(c.paidCents)} tone="ok" />
        <Kpi label="A receber" value={money(c.openCents)} sub={c.overdueCents > 0 ? `${money(c.overdueCents)} em atraso` : 'Nada em atraso'} tone={c.overdueCents > 0 ? 'danger' : undefined} />
        <Kpi label="Saldo no site" value={money(c.balanceCents)} />
      </div>
      <div className="adm-grid-2">
        <Card title="Dados do cadastro">
          <dl className="kv">
            <dt>Tipo</dt><dd><TypeBadge type={c.type} /></dd>
            <dt>{c.documentKind ?? 'CPF/CNPJ'}</dt><dd className="mono">{c.cpfCnpj ?? '—'}</dd>
            <dt>Telefone</dt><dd>{c.phone ?? '—'}</dd>
            {c.legalName && <><dt>Razão social</dt><dd>{c.legalName}</dd></>}
            {c.companyName && <><dt>Nome fantasia</dt><dd>{c.companyName}</dd></>}
            <dt>Acesso ao site</dt><dd>{c.portalAccess ? `Sim · último acesso ${dateTime(c.lastLoginAt)}` : 'Sem acesso (só cadastro)'}</dd>
            {c.notes && <><dt>Observações</dt><dd style={{ fontWeight: 400 }}>{c.notes}</dd></>}
          </dl>
        </Card>
        <Card title="Dados para nota fiscal">
          {missing.length ? <Alert tone="warn" title="Faltam dados para emitir nota">Complete: {missing.join(', ')}.</Alert> : <Alert tone="ok" title="Cadastro fiscal completo">Já dá para emitir nota para este cliente.</Alert>}
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Endereço</dt><dd>{[c.street, c.streetNumber, c.complement].filter(Boolean).join(', ') || '—'}</dd>
            <dt>Bairro / cidade</dt><dd>{[c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ''}`].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>CEP</dt><dd>{c.zip ? maskZip(c.zip) : '—'}</dd>
            <dt>E-mail da nota</dt><dd>{c.billingEmail ?? c.email}</dd>
            {c.stateRegistration && <><dt>Insc. estadual</dt><dd>{c.stateRegistration}</dd></>}
            {c.municipalRegistration && <><dt>Insc. municipal</dt><dd>{c.municipalRegistration}</dd></>}
          </dl>
        </Card>
      </div>
      <Card title="Cobranças e parcelas" actions={can('MANAGE_BILLING') && <Link className="btn btn-sm btn-ghost" to={`/cobrancas?cliente=${c.id}`}>Ver todas</Link>} pad={false}>
        {!charges.length ? <div className="body muted">Nenhuma cobrança. Use “Nova cobrança” para criar um plano de pagamento.</div> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Descrição</th><th className="r">Total</th><th>Pago</th><th>Próx. vencimento</th><th /></tr></thead><tbody>
            {charges.map((x) => (
              <tr key={x.id}><td><b>{x.description}</b><div className="muted" style={{ fontSize: 12.5 }}>{dateOnly(x.createdAt)}</div></td><td className="r num">{money(x.totalCents)}</td>
                <td><div className="progress"><i style={{ width: `${Math.min(100, Math.round((x.paidCents / x.totalCents) * 100))}%` }} /></div><small className="muted">{money(x.paidCents)}</small></td>
                <td>{x.status === 'OPEN' ? dateOnly(x.nextDue) : <Badge tone={SITUATION[x.status]?.tone}>{SITUATION[x.status]?.label}</Badge>}</td>
                <td className="actions">{can('MANAGE_BILLING') && <Link className="btn btn-sm" to={`/cobrancas?abrir=${x.id}`}>Abrir</Link>}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <div className="adm-grid-2">
        <Card title="Últimas consultas" pad={false}>
          {!queries.length ? <div className="body muted">Ainda não consultou nenhuma placa.</div> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><tbody>{queries.map((q) => (
              <tr key={q.id} className="clickable" onClick={() => nav(`/consultas/${q.id}`)}><td><b className="mono">{formatPlate(q.plate)}</b><div className="muted" style={{ fontSize: 12.5 }}>{q.productName}</div></td><td><QueryStatusBadge status={q.status} /></td><td className="r num">{money(q.priceCents)}</td><td>{dateOnly(q.createdAt)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Card>
        <Card title="Pagamentos recebidos" pad={false}>
          {!payments.length ? <div className="body muted">Nenhum pagamento pelo site.</div> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><tbody>{payments.map((p) => (
              <tr key={p.id}><td><PaymentStatusBadge status={p.status} /></td><td className="r num">{money(p.amountCents)}</td><td>{p.provider}</td><td>{dateOnly(p.paidAt ?? p.createdAt)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Card>
      </div>
      {can('MANAGE_FISCAL') && (
        <Card title="Notas fiscais" actions={<Link className="btn btn-sm btn-ghost" to="/notas-fiscais">Abrir notas</Link>} pad={false}>
          {!fiscalDocuments.length ? <div className="body muted">Nenhuma nota para este cliente.</div> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><tbody>{fiscalDocuments.map((d) => (
              <tr key={d.id}><td>{d.kind === 'NFSE' ? 'NFS-e' : 'NF-e'} {d.number && <b>nº {d.number}</b>}</td><td><Badge tone={FISCAL_STATUS[d.status]?.tone}>{FISCAL_STATUS[d.status]?.label}</Badge></td><td className="r num">{money(d.amountCents)}</td><td>{dateOnly(d.issuedAt ?? d.createdAt)}</td></tr>
            ))}</tbody></table></div>
          )}
        </Card>
      )}
      {manage && (
        <Card title="Acesso e cadastro">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="ghost" icon="key" onClick={() => setConfirm('password')}>Enviar link de nova senha</Button>
            {!c.archived && <Button variant="ghost" icon="lock" onClick={() => setConfirm('block')}>{c.active ? 'Bloquear acesso' : 'Desbloquear acesso'}</Button>}
            <Button variant="ghost" icon="list" onClick={() => setConfirm('archive')}>{c.archived ? 'Restaurar cadastro' : 'Arquivar cadastro'}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>Excluir</Button>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Arquivar esconde o cliente das listas sem perder o histórico. Excluir remove o acesso e o cadastro das listas; consultas e pagamentos continuam guardados para a contabilidade.</p>
        </Card>
      )}
      {edit && <CustomerForm customer={c} onClose={(ch) => { setEdit(false); if (ch) res.reload(); }} />}
      {adjust && <AdjustModal customer={c} onClose={(ch) => { setAdjust(false); if (ch) res.reload(); }} />}
      {charge && <ChargeModal presetCustomer={{ id: c.id, name: c.name, email: c.email, type: c.type }} onClose={(ch) => { setCharge(false); if (ch) res.reload(); }} />}
      {confirm === 'password' && <ConfirmDialog title="Enviar link de nova senha?" confirmLabel="Enviar link" message={`${c.name} recebe um e-mail em ${c.email} para criar uma nova senha. Ninguém além do cliente vê ou define a senha.`} onConfirm={async () => { await api.post(`/admin/customers/${c.id}/reset-password`); toast.ok('Link enviado por e-mail.'); }} onClose={() => setConfirm(null)} />}
      {confirm === 'block' && <ConfirmDialog title={c.active ? 'Bloquear acesso?' : 'Desbloquear acesso?'} confirmLabel={c.active ? 'Bloquear' : 'Desbloquear'} danger={c.active} message={c.active ? `${c.name} não conseguirá entrar no site até ser desbloqueado.` : `${c.name} volta a poder entrar no site.`} onConfirm={async () => { await api.post(`/admin/customers/${c.id}/block`, { active: !c.active }); toast.ok(c.active ? 'Acesso bloqueado.' : 'Acesso liberado.'); res.reload(); }} onClose={() => setConfirm(null)} />}
      {confirm === 'archive' && <ConfirmDialog title={c.archived ? 'Restaurar cadastro?' : 'Arquivar cadastro?'} confirmLabel={c.archived ? 'Restaurar' : 'Arquivar'} message={c.archived ? 'O cliente volta às listas e recupera o acesso.' : 'O cliente sai das listas e perde o acesso, mas todo o histórico fica guardado.'} onConfirm={async () => { await api.post(`/admin/customers/${c.id}/archive`, { archived: !c.archived }); toast.ok(c.archived ? 'Cadastro restaurado.' : 'Cadastro arquivado.'); res.reload(); }} onClose={() => setConfirm(null)} />}
      {confirm === 'delete' && <ConfirmDialog danger title="Excluir cliente?" confirmLabel="Excluir" message={<p>Excluir <b>{c.name}</b>? Se houver saldo no site ou parcelas em aberto, o sistema avisa antes. Prefira <b>arquivar</b> se quiser guardar o cadastro.</p>} onConfirm={async () => {
        try { await api.del(`/admin/customers/${c.id}${c.balanceCents > 0 ? '?force=true' : ''}`); toast.ok('Cliente excluído.'); nav('/clientes'); } catch (e) { toast.error(errorMessage(e)); throw e; }
      }} onClose={() => setConfirm(null)} />}
    </>
  );
}
