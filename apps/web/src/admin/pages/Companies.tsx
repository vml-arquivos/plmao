import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, COMPANY_KIND, maskDocument, maskPhone, maskZip, SEGMENT_SUGGESTIONS, STATES } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, Check, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, money, num } from '../../shared/format';
import { Card, Kpi, PageHead } from '../parts';
import { CustomerPicker, TypeBadge, type Company, type PickedCustomer } from '../people';
import { ChargeModal } from './Charges';

export default function Companies() {
  usePageTitle('Empresas');
  const { can } = useAdminSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const list = useAsync(() => api.get<{ items: Company[] }>('/admin/companies', { query: { search: dq, kind, status } }), [dq, kind, status]);
  const rows = list.data?.items ?? [];
  return (
    <>
      <PageHead title="Empresas" sub="Agências, lojas, revendas e despachantes que agrupam vários usuários. Dá para ver consultas, pagamentos e cobranças da empresa toda."
        actions={can('MANAGE_CUSTOMERS') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nova empresa</Button>} />
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por nome, razão social, e-mail ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo de empresa"><option value="">Todos os tipos</option>{Object.entries(COMPANY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="active">Ativas</option><option value="archived">Arquivadas</option><option value="all">Todas</option></Select>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? (
        <EmptyState icon="building" title="Nenhuma empresa cadastrada" action={can('MANAGE_CUSTOMERS') ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Cadastrar empresa</Button> : undefined}>Cadastre uma empresa e vincule os clientes que trabalham nela.</EmptyState>
      ) : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Empresa</th><th>Tipo</th><th>CNPJ</th><th>Cidade</th><th className="r">Usuários</th><th className="r">Consultas</th><th className="r">Total pago</th><th className="r">A receber</th></tr></thead><tbody>
          {rows.map((c) => (
            <tr key={c.id} className={`clickable ${c.archived ? 'row-muted' : ''}`} onClick={() => nav(`/empresas/${c.id}`)}>
              <td><b>{c.name}</b>{c.archived && <> <Badge>Arquivada</Badge></>}{c.legalName && <div className="muted" style={{ fontSize: 12.5 }}>{c.legalName}</div>}</td>
              <td>{COMPANY_KIND[c.kind] ?? c.kind}{c.segment && <div className="muted" style={{ fontSize: 12.5 }}>{c.segment}</div>}</td>
              <td className="mono" style={{ fontSize: 13 }}>{c.document ?? '—'}</td>
              <td>{c.city ? `${c.city}${c.state ? `/${c.state}` : ''}` : '—'}</td>
              <td className="r num">{num(c.membersCount)}</td><td className="r num">{num(c.queriesCount)}</td><td className="r num">{money(c.paidCents)}</td>
              <td className="r num">{c.overdueCents > 0 ? <span className="tag-danger">{money(c.overdueCents)} em atraso</span> : c.openCents > 0 ? money(c.openCents) : '—'}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {creating && <CompanyForm onClose={(id) => { setCreating(false); if (id) nav(`/empresas/${id}`); else list.reload(); }} />}
    </>
  );
}

const blank = (c: Company | null) => ({
  name: c?.name ?? '', kind: c?.kind ?? 'EMPRESA', segment: c?.segment ?? '', document: c?.document ?? '', legalName: c?.legalName ?? '', contactName: c?.contactName ?? '', email: c?.email ?? '', phone: c?.phone ?? '',
  stateRegistration: c?.stateRegistration ?? '', municipalRegistration: c?.municipalRegistration ?? '', zip: c?.zip ?? '', street: c?.street ?? '', streetNumber: c?.streetNumber ?? '', complement: c?.complement ?? '',
  district: c?.district ?? '', city: c?.city ?? '', state: c?.state ?? '', notes: c?.notes ?? ''
});
const nz = (s: string): string | null => (s.trim() ? s.trim() : null);

function CompanyForm({ company, onClose }: { company?: Company; onClose: (createdId?: string, changed?: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState(blank(company ?? null));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const [lookup, setLookup] = useState<{ cnpj: string; source: string; fetchedAt: string; situation: string | null; prefilled: Partial<typeof f> } | null>(null);
  const [searching, setSearching] = useState(false);
  async function searchCnpj() {
    setSearching(true);
    try {
      const r = await api.get<{ data: { cnpj: string; legalName: string | null; tradeName: string | null; situation: string | null; address: { zip: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null } }; source: string; fetchedAt: string }>(`/admin/cnpj/${f.document.replace(/\D/g, '')}`);
      const a = r.data.address;
      const prefilled: Partial<typeof f> = { legalName: r.data.legalName ?? '', zip: a.zip ?? '', street: a.street ?? '', streetNumber: a.number ?? '', complement: a.complement ?? '', district: a.district ?? '', city: a.city ?? '', state: a.state ?? '', ...(f.name.trim() ? {} : { name: r.data.tradeName ?? r.data.legalName ?? '' }) };
      setF((p) => ({ ...p, ...prefilled }));
      setLookup({ cnpj: r.data.cnpj, source: r.source, fetchedAt: r.fetchedAt, situation: r.data.situation, prefilled });
    } catch (e) { toast.error(errorMessage(e)); } finally { setSearching(false); }
  }
  async function save() {
    const body = { name: f.name.trim(), kind: f.kind, segment: nz(f.segment), document: nz(f.document), legalName: nz(f.legalName), contactName: nz(f.contactName), email: nz(f.email), phone: nz(f.phone),
      stateRegistration: nz(f.stateRegistration), municipalRegistration: nz(f.municipalRegistration), zip: nz(f.zip), street: nz(f.street), streetNumber: nz(f.streetNumber), complement: nz(f.complement), district: nz(f.district), city: nz(f.city), state: nz(f.state), notes: nz(f.notes) };
    setBusy(true);
    try {
      const confirm = async () => {
        if (!lookup) return;
        const edited = (Object.keys(lookup.prefilled) as Array<keyof typeof f>).some((k) => f[k] !== lookup.prefilled[k]);
        await api.post(`/admin/cnpj/${lookup.cnpj}/confirm`, { edited, source: lookup.source, fetchedAt: lookup.fetchedAt }).catch(() => undefined);
      };
      if (company) { await api.patch(`/admin/companies/${company.id}`, body); await confirm(); toast.ok('Empresa atualizada.'); onClose(undefined, true); return; }
      const r = await api.post<{ company: Company }>('/admin/companies', body);
      await confirm();
      toast.ok('Empresa cadastrada.'); onClose(r.company.id, true);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={company ? `Editar — ${company.name}` : 'Nova empresa'} wide onClose={() => onClose()} footer={<><Button variant="ghost" onClick={() => onClose()}>Cancelar</Button><Button variant="primary" loading={busy} disabled={f.name.trim().length < 2} onClick={() => void save()}>{company ? 'Salvar alterações' : 'Cadastrar empresa'}</Button></>}>
      <div className="stack">
        <span className="section-title">Identificação</span>
        <div className="form-grid cols-2">
          <Field label="Nome (como aparece no painel)"><Input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={160} /></Field>
          <Field label="Tipo"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(COMPANY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="CNPJ">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input inputMode="numeric" value={f.document} onChange={(e) => set('document', maskDocument(e.target.value))} placeholder="00.000.000/0000-00" />
              <Button variant="ghost" loading={searching} disabled={f.document.replace(/\D/g, '').length !== 14} onClick={() => void searchCnpj()}>Buscar CNPJ</Button>
            </div>
            {lookup && <small className="muted" role="status">Preenchido com dados públicos ({lookup.source}, {new Date(lookup.fetchedAt).toLocaleDateString('pt-BR')}){lookup.situation ? ` · situação: ${lookup.situation}` : ''}. Revise antes de salvar.</small>}
          </Field>
          <Field label="Razão social"><Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={160} /></Field>
          <Field label="Segmento"><Input list="seg-co" value={f.segment} onChange={(e) => set('segment', e.target.value)} maxLength={60} /><datalist id="seg-co">{SEGMENT_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist></Field>
          <Field label="Pessoa de contato"><Input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={120} /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} maxLength={254} /></Field>
          <Field label="Telefone"><Input value={f.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} /></Field>
        </div>
        <details className="fiscal-box" open={Boolean(company?.street)}>
          <summary><b>Dados para nota fiscal</b> <span className="muted">(inscrições e endereço)</span></summary>
          <div className="form-grid cols-2" style={{ marginTop: 12 }}>
            <Field label="Inscrição estadual"><Input value={f.stateRegistration} onChange={(e) => set('stateRegistration', e.target.value)} maxLength={30} /></Field>
            <Field label="Inscrição municipal"><Input value={f.municipalRegistration} onChange={(e) => set('municipalRegistration', e.target.value)} maxLength={30} /></Field>
            <Field label="CEP"><Input inputMode="numeric" value={f.zip} onChange={(e) => set('zip', maskZip(e.target.value))} /></Field>
            <Field label="Rua / avenida"><Input value={f.street} onChange={(e) => set('street', e.target.value)} maxLength={160} /></Field>
            <Field label="Número"><Input value={f.streetNumber} onChange={(e) => set('streetNumber', e.target.value)} maxLength={20} /></Field>
            <Field label="Complemento"><Input value={f.complement} onChange={(e) => set('complement', e.target.value)} maxLength={80} /></Field>
            <Field label="Bairro"><Input value={f.district} onChange={(e) => set('district', e.target.value)} maxLength={80} /></Field>
            <Field label="Cidade"><Input value={f.city} onChange={(e) => set('city', e.target.value)} maxLength={80} /></Field>
            <Field label="UF"><Select value={f.state} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          </div>
        </details>
        <Field label="Observações internas"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

interface Detail { company: Company; members: Array<{ id: string; name: string; email: string; active: boolean; memberRole: string; type: string; queriesCount: number }> }

export function CompanyDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAdminSession();
  const res = useAsync(() => api.get<Detail>(`/admin/companies/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const [charge, setCharge] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [removeMember, setRemoveMember] = useState<Detail['members'][number] | null>(null);
  usePageTitle(res.data?.company.name ?? 'Empresa');
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { company: c, members } = res.data;
  const manage = can('MANAGE_CUSTOMERS');
  return (
    <>
      <p style={{ marginBottom: 8 }}><Link to="/empresas">← Voltar para empresas</Link></p>
      <PageHead title={c.name} sub={<>{COMPANY_KIND[c.kind] ?? c.kind}{c.segment && ` · ${c.segment}`} · cadastrada em {dateOnly(c.createdAt)}{c.document && <> · <span className="mono">{c.document}</span></>}</>}
        actions={manage && <>{can('MANAGE_BILLING') && <Button variant="primary" icon="receipt" onClick={() => setCharge(true)}>Nova cobrança</Button>}<Button icon="settings" onClick={() => setEdit(true)}>Editar</Button><Button variant="ghost" icon="plus" onClick={() => setAdd(true)}>Adicionar usuário</Button></>} />
      {c.archived && <Alert tone="warn" title="Empresa arquivada">Ela não aparece nas listas. Restaure para voltar a usar.</Alert>}
      <div className="adm-grid-4">
        <Kpi label="Usuários" value={num(c.membersCount)} />
        <Kpi label="Consultas" value={num(c.queriesCount)} />
        <Kpi label="Total pago" value={money(c.paidCents)} tone="ok" />
        <Kpi label="A receber" value={money(c.openCents)} sub={c.overdueCents > 0 ? `${money(c.overdueCents)} em atraso` : 'Nada em atraso'} tone={c.overdueCents > 0 ? 'danger' : undefined} />
      </div>
      <div className="adm-grid-2">
        <Card title="Dados da empresa">
          <dl className="kv">
            <dt>Razão social</dt><dd>{c.legalName ?? '—'}</dd><dt>Contato</dt><dd>{c.contactName ?? '—'}</dd><dt>E-mail</dt><dd>{c.email ?? '—'}</dd><dt>Telefone</dt><dd>{c.phone ?? '—'}</dd>
            <dt>Insc. estadual</dt><dd>{c.stateRegistration ?? '—'}</dd><dt>Insc. municipal</dt><dd>{c.municipalRegistration ?? '—'}</dd>
            <dt>Endereço</dt><dd>{[c.street, c.streetNumber, c.complement, c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ''}`, c.zip ? maskZip(c.zip) : null].filter(Boolean).join(', ') || '—'}</dd>
            {c.notes && <><dt>Observações</dt><dd style={{ fontWeight: 400 }}>{c.notes}</dd></>}
          </dl>
        </Card>
        <Card title="Cobranças da empresa" actions={can('MANAGE_BILLING') && <Link className="btn btn-sm btn-ghost" to="/cobrancas">Abrir cobranças</Link>}>
          <p className="muted">Use “Nova cobrança” para cobrar a empresa toda. Parcelas, atrasos e notas ficam na tela de Cobranças e em Notas fiscais.</p>
        </Card>
      </div>
      <Card title={`Usuários da empresa (${members.length})`} pad={false}>
        {!members.length ? <div className="body muted">Nenhum usuário vinculado ainda. Use “Adicionar usuário”.</div> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Usuário</th><th>Tipo</th><th>Papel na empresa</th><th className="r">Consultas</th><th>Situação</th><th /></tr></thead><tbody>
            {members.map((m) => (
              <tr key={m.id}><td><Link to={`/clientes/${m.id}`}><b>{m.name}</b></Link><div className="muted" style={{ fontSize: 12.5 }}>{m.email}</div></td><td><TypeBadge type={m.type} /></td>
                <td>{m.memberRole === 'OWNER' ? 'Responsável' : 'Membro'}</td><td className="r num">{num(m.queriesCount)}</td><td><Badge tone={m.active ? 'ok' : 'danger'} dot>{m.active ? 'Ativo' : 'Bloqueado'}</Badge></td>
                <td className="actions">{manage && <Button size="sm" variant="ghost" onClick={() => setRemoveMember(m)}>Remover da empresa</Button>}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {manage && (
        <Card title="Cadastro">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="ghost" icon="list" onClick={() => setConfirm('archive')}>{c.archived ? 'Restaurar empresa' : 'Arquivar empresa'}</Button>
            <Button variant="danger" icon="trash" onClick={() => setConfirm('delete')}>Excluir empresa</Button>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>Só é possível excluir uma empresa sem usuários, cobranças ou notas. Nos outros casos, arquive.</p>
        </Card>
      )}
      {edit && <CompanyForm company={c} onClose={(_id, ch) => { setEdit(false); if (ch) res.reload(); }} />}
      {add && <AddMember companyId={c.id} onClose={(ch) => { setAdd(false); if (ch) res.reload(); }} />}
      {charge && <ChargeModal presetCompany={{ id: c.id, name: c.name }} onClose={(ch) => { setCharge(false); if (ch) res.reload(); }} />}
      {removeMember && <ConfirmDialog title="Remover da empresa?" confirmLabel="Remover" message={`${removeMember.name} deixa de fazer parte de ${c.name}. A conta do cliente continua existindo.`} onConfirm={async () => { try { await api.del(`/admin/companies/${c.id}/members/${removeMember.id}`); toast.ok('Usuário removido da empresa.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setRemoveMember(null)} />}
      {confirm === 'archive' && <ConfirmDialog title={c.archived ? 'Restaurar empresa?' : 'Arquivar empresa?'} confirmLabel={c.archived ? 'Restaurar' : 'Arquivar'} message={c.archived ? 'A empresa volta às listas.' : 'A empresa sai das listas, mas o histórico fica guardado.'} onConfirm={async () => { await api.post(`/admin/companies/${c.id}/archive`, { archived: !c.archived }); toast.ok(c.archived ? 'Empresa restaurada.' : 'Empresa arquivada.'); res.reload(); }} onClose={() => setConfirm(null)} />}
      {confirm === 'delete' && <ConfirmDialog danger title="Excluir empresa?" confirmLabel="Excluir" message={`Excluir ${c.name} definitivamente?`} onConfirm={async () => { try { await api.del(`/admin/companies/${c.id}`); toast.ok('Empresa excluída.'); nav('/empresas'); } catch (e) { toast.error(e instanceof Error && 'code' in e && (e as { code?: string }).code === 'COMPANY_IN_USE' ? 'Esta empresa tem usuários, cobranças ou notas. Arquive em vez de excluir.' : errorMessage(e)); throw e; } }} onClose={() => setConfirm(null)} />}
    </>
  );
}

function AddMember({ companyId, onClose }: { companyId: string; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [who, setWho] = useState<PickedCustomer | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.post(`/admin/companies/${companyId}/members`, { userId: who!.id, role: owner ? 'OWNER' : 'MEMBER' }); toast.ok('Usuário vinculado.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title="Adicionar usuário à empresa" onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!who} onClick={() => void save()}>Vincular</Button></>}>
      <div className="stack">
        <Field label="Cliente" hint="O cliente precisa já estar cadastrado. Ele sai de qualquer outra empresa em que estivesse."><CustomerPicker value={who} onChange={setWho} /></Field>
        <Check checked={owner} onChange={(e) => setOwner(e.target.checked)}>É o responsável pela empresa</Check>
      </div>
    </Modal>
  );
}
