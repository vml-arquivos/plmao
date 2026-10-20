import { useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, dateOnly, dateTime, money, num, percentToBps } from '../../shared/format';
import { Kpi, PageHead } from '../parts';

interface Partner { id: string; name: string; email: string | null; code: string; partnerType: string; commissionBps: number; commissionBase: string | null; pixKey: string | null; document: string | null; payoutNotes: string | null; active: boolean; createdAt: string; pendingCents: number; availableCents: number; inPayoutCents: number; paidCents: number; clawbackDueCents: number; commissionsCount: number }
interface Commission { id: string; amountCents: number; baseType: string; baseCents: number; rateBps: number; status: string; availableAt: string | null; createdAt: string; paidAt: string | null; reversalReason: string | null; payoutId: string | null; partner: { name: string; code: string }; orderCents: number | null; paymentMethod: string | null; externalReference: string | null }
interface Payout { id: string; partner: { id: string; name: string; code: string }; amountCents: number; status: string; pixKey: string | null; receiptReference: string | null; notes: string | null; items: number; requestedAt: string; approvedAt: string | null; paidAt: string | null }

const TYPES: Record<string, string> = { AFFILIATE: 'Afiliado', INFLUENCER: 'Influenciador', SELLER: 'Vendedor', ORGANIZATION: 'Organização' };
const C_STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = { PENDING: { l: 'Em carência', t: 'warn' }, AVAILABLE: { l: 'Disponível', t: 'ok' }, PAID: { l: 'Paga', t: 'info' }, REVERSED: { l: 'Estornada', t: 'neutral' }, CLAWBACK_DUE: { l: 'A recuperar', t: 'danger' } };
const P_STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = { REQUESTED: { l: 'Solicitado', t: 'warn' }, APPROVED: { l: 'Aprovado', t: 'info' }, PAID: { l: 'Pago', t: 'ok' }, REJECTED: { l: 'Rejeitado', t: 'danger' }, CANCELLED: { l: 'Cancelado', t: 'neutral' } };
const BASES: Record<string, string> = { GROSS: 'Valor bruto', NET: 'Valor líquido', MARGIN: 'Margem' };

export default function Partners() {
  usePageTitle('Parceiros e repasses');
  const [tab, setTab] = useState<'partners' | 'commissions' | 'payouts'>('partners');
  return (
    <>
      <PageHead title="Parceiros e repasses" sub="Comissões nascem de vendas pagas, ficam em carência (proteção contra chargeback) e são repassadas com recibo." />
      <Tabs label="Seções" value={tab} onChange={setTab} items={[{ id: 'partners', label: 'Parceiros' }, { id: 'commissions', label: 'Comissões' }, { id: 'payouts', label: 'Repasses' }]} />
      {tab === 'partners' && <PartnersTab />}
      {tab === 'commissions' && <CommissionsTab />}
      {tab === 'payouts' && <PayoutsTab />}
    </>
  );
}

function PartnersTab() {
  const { can } = useAdminSession();
  const toast = useToast();
  const list = useAsync(() => api.get<Partner[]>('/admin/finance/partners'));
  const [edit, setEdit] = useState<Partner | 'new' | null>(null);
  const [pay, setPay] = useState<Partner | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <div className="adm-grid-4">
        <Kpi label="Em carência" value={money(rows.reduce((a, p) => a + p.pendingCents, 0))} />
        <Kpi label="Disponível para repasse" value={money(rows.reduce((a, p) => a + p.availableCents, 0))} tone="ok" />
        <Kpi label="Em repasse" value={money(rows.reduce((a, p) => a + p.inPayoutCents, 0))} />
        <Kpi label="Já pago" value={money(rows.reduce((a, p) => a + p.paidCents, 0))} />
      </div>
      <div className="toolbar"><span className="grow" /><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo parceiro</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState icon="users" title="Nenhum parceiro cadastrado" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Parceiro</th><th>Código</th><th className="r">Comissão</th><th className="r">Carência</th><th className="r">Disponível</th><th className="r">Pago</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map((p) => (
            <tr key={p.id}><td><b>{p.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{TYPES[p.partnerType] ?? p.partnerType}{p.email ? ` · ${p.email}` : ''}</div></td>
              <td><b className="mono">{p.code}</b></td><td className="r num">{bpsToPercent(p.commissionBps)}</td><td className="r num">{money(p.pendingCents)}</td>
              <td className="r num"><b>{money(p.availableCents)}</b>{p.clawbackDueCents > 0 && <div><Badge tone="danger">−{money(p.clawbackDueCents)} a recuperar</Badge></div>}</td><td className="r num">{money(p.paidCents)}</td>
              <td><Badge tone={p.active ? 'ok' : 'neutral'} dot>{p.active ? 'Ativo' : 'Inativo'}</Badge></td>
              <td className="actions">{p.availableCents > 0 && <Button size="sm" variant="primary" onClick={() => setPay(p)}>Gerar repasse</Button>}<Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Editar</Button></td></tr>
          ))}
        </tbody></table></div>
      )}
      {edit && <PartnerModal partner={edit === 'new' ? null : edit} canSecrets={can('ADMIN_SYSTEM')} onClose={() => { setEdit(null); list.reload(); }} />}
      {pay && <ConfirmDialog title="Gerar repasse" confirmLabel="Gerar repasse" message={<><p>Gerar repasse de <b>{money(pay.availableCents)}</b> para <b>{pay.name}</b>?</p><p className="muted" style={{ fontSize: 13 }}>Estornos/chargebacks pendentes são descontados. O pagamento só é registrado depois, ao marcar como pago.</p></>} onConfirm={async () => { try { await api.post('/admin/finance/payouts', { partnerId: pay.id }); toast.ok('Repasse criado. Acompanhe na aba Repasses.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setPay(null)} />}
    </>
  );
}

function PartnerModal({ partner, canSecrets, onClose }: { partner: Partner | null; canSecrets: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(partner?.name ?? '');
  const [email, setEmail] = useState(partner?.email ?? '');
  const [code, setCode] = useState(partner?.code ?? '');
  const [type, setType] = useState(partner?.partnerType ?? 'AFFILIATE');
  const [rate, setRate] = useState(partner ? String(partner.commissionBps / 100).replace('.', ',') : '10');
  const [base, setBase] = useState(partner?.commissionBase ?? '');
  const [pix, setPix] = useState('');
  const [doc, setDoc] = useState('');
  const [notes, setNotes] = useState(partner?.payoutNotes ?? '');
  const [active, setActive] = useState(partner?.active ?? true);
  const [busy, setBusy] = useState(false);
  async function save() {
    const body: Record<string, unknown> = { name: name.trim(), email: email.trim(), code: code.trim(), partnerType: type, commissionBps: percentToBps(rate), commissionBase: base || null, payoutNotes: notes.trim() || null, active };
    if (canSecrets && pix.trim()) body.pixKey = pix.trim();
    if (canSecrets && doc.trim()) body.document = doc.trim();
    setBusy(true);
    try { if (partner) await api.patch(`/admin/finance/partners/${partner.id}`, body); else await api.post('/admin/finance/partners', body); toast.ok('Parceiro salvo.'); onClose(); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={partner ? `Editar ${partner.name}` : 'Novo parceiro'} wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 2 || code.trim().length < 3} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Código do link" hint="Usado em ?ref=CODIGO"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></Field>
          <Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Comissão (%)"><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Base de cálculo" hint="Vazio = padrão do financeiro"><Select value={base} onChange={(e) => setBase(e.target.value)}><option value="">Padrão</option>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        </div>
        {canSecrets ? <div className="form-grid">
          <Field label="Chave Pix" hint={partner?.pixKey ? `Atual: ${partner.pixKey}` : undefined}><Input value={pix} onChange={(e) => setPix(e.target.value)} placeholder={partner?.pixKey ? 'Deixe vazio para manter' : ''} /></Field>
          <Field label="CPF/CNPJ" hint={partner?.document ? `Atual: ${partner.document}` : undefined}><Input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder={partner?.document ? 'Deixe vazio para manter' : ''} /></Field>
        </div> : <Alert tone="info">Chave Pix e documento só podem ser editados por super admins.</Alert>}
        <Field label="Observações de repasse"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={280} /></Field>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Parceiro ativo" />
      </div>
    </Modal>
  );
}

function CommissionsTab() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = useAsync(() => api.get<Commission[]>('/admin/finance/commissions', { query: { status } }), [status]);
  return (
    <>
      <div className="toolbar"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todas</option>{Object.entries(C_STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</Select><span className="grow" /><Button icon="download" onClick={() => void api.download('/admin/finance/commissions/export.csv', 'comissoes.csv').catch((e) => toast.error(errorMessage(e)))}>Exportar CSV</Button></div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? <EmptyState icon="percent" title="Nenhuma comissão" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Parceiro</th><th>Pedido</th><th className="r">Base</th><th className="r">Taxa</th><th className="r">Comissão</th><th>Status</th><th>Libera em</th></tr></thead><tbody>
          {list.data.map((c) => (
            <tr key={c.id}><td><b>{c.partner.name}</b><div className="muted mono" style={{ fontSize: 11.5 }}>{c.partner.code}</div></td>
              <td>{c.externalReference ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{c.orderCents != null ? money(c.orderCents) : ''} {c.paymentMethod ?? ''}</div></td>
              <td className="r num">{money(c.baseCents)}<div className="muted" style={{ fontSize: 11.5 }}>{BASES[c.baseType] ?? c.baseType}</div></td><td className="r num">{bpsToPercent(c.rateBps)}</td><td className="r num"><b>{money(c.amountCents)}</b></td>
              <td><Badge tone={C_STATUS[c.status]?.t ?? 'neutral'} dot>{C_STATUS[c.status]?.l ?? c.status}</Badge>{c.reversalReason && <div className="muted" style={{ fontSize: 12 }}>{c.reversalReason}</div>}</td><td>{c.status === 'PENDING' ? dateOnly(c.availableAt) : '—'}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </>
  );
}

function PayoutsTab() {
  const { can } = useAdminSession();
  const toast = useToast();
  const list = useAsync(() => api.get<Payout[]>('/admin/finance/payouts'));
  const [paying, setPaying] = useState<Payout | null>(null);
  const [confirm, setConfirm] = useState<{ p: Payout; action: 'APPROVE' | 'REJECT' | 'CANCEL' } | null>(null);
  async function act(p: Payout, action: string, extra: Record<string, unknown> = {}) { await api.patch(`/admin/finance/payouts/${p.id}`, { action, ...extra }); toast.ok('Repasse atualizado.'); list.reload(); }
  async function receipt(p: Payout) {
    try {
      const res = await fetch(`/api/admin/finance/payouts/${p.id}/receipt`, { headers: { Authorization: `Bearer ${api.token.get() ?? ''}` }, cache: 'no-store' });
      if (!res.ok) throw new Error('Não foi possível abrir o recibo.');
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? <EmptyState icon="wallet" title="Nenhum repasse ainda" >Gere um repasse na aba Parceiros quando houver saldo disponível.</EmptyState> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Parceiro</th><th className="r">Valor</th><th className="r">Itens</th><th>Chave Pix</th><th>Status</th><th>Datas</th><th /></tr></thead><tbody>
          {list.data.map((p) => (
            <tr key={p.id}><td><b>{p.partner.name}</b><div className="muted mono" style={{ fontSize: 11.5 }}>{p.partner.code}</div></td><td className="r num"><b>{money(p.amountCents)}</b></td><td className="r num">{num(p.items)}</td><td className="mono" style={{ fontSize: 12.5 }}>{p.pixKey ?? '—'}</td>
              <td><Badge tone={P_STATUS[p.status]?.t ?? 'neutral'} dot>{P_STATUS[p.status]?.l ?? p.status}</Badge>{p.receiptReference && <div className="muted" style={{ fontSize: 12 }}>Comprovante: {p.receiptReference}</div>}</td>
              <td style={{ fontSize: 12.5 }}>Solicitado {dateTime(p.requestedAt)}{p.paidAt && <><br />Pago {dateTime(p.paidAt)}</>}</td>
              <td className="actions">
                <Button size="sm" variant="ghost" icon="receipt" onClick={() => void receipt(p)}>Recibo</Button>
                {p.status === 'REQUESTED' && <><Button size="sm" variant="primary" onClick={() => setConfirm({ p, action: 'APPROVE' })}>Aprovar</Button><Button size="sm" variant="ghost" onClick={() => setConfirm({ p, action: 'REJECT' })}>Rejeitar</Button></>}
                {p.status === 'APPROVED' && <>{can('ADMIN_SYSTEM') ? <Button size="sm" variant="primary" onClick={() => setPaying(p)}>Marcar como pago</Button> : <span className="muted" style={{ fontSize: 12 }}>Pagamento: super admin</span>}<Button size="sm" variant="ghost" onClick={() => setConfirm({ p, action: 'CANCEL' })}>Cancelar</Button></>}
              </td></tr>
          ))}
        </tbody></table></div>
      )}
      {confirm && <ConfirmDialog title={{ APPROVE: 'Aprovar repasse', REJECT: 'Rejeitar repasse', CANCEL: 'Cancelar repasse' }[confirm.action]} danger={confirm.action !== 'APPROVE'} confirmLabel="Confirmar" message={<p>{{ APPROVE: 'Aprovar', REJECT: 'Rejeitar', CANCEL: 'Cancelar' }[confirm.action]} o repasse de <b>{money(confirm.p.amountCents)}</b> para <b>{confirm.p.partner.name}</b>?{confirm.action !== 'APPROVE' && ' As comissões voltam a ficar disponíveis.'}</p>} onConfirm={async () => { try { await act(confirm.p, confirm.action); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setConfirm(null)} />}
      {paying && <PaidModal p={paying} onClose={() => setPaying(null)} onDone={async (ref) => { await act(paying, 'MARK_PAID', { receiptReference: ref || undefined }); setPaying(null); }} />}
    </>
  );
}

function PaidModal({ p, onClose, onDone }: { p: Payout; onClose: () => void; onDone: (ref: string) => Promise<void> }) {
  const toast = useToast();
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Registrar pagamento do repasse" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await onDone(ref.trim()); } catch (e) { toast.error(errorMessage(e)); setBusy(false); } }}>Confirmar pagamento</Button></>}>
      <div className="stack"><Alert tone="warn">Confirme apenas depois de ter feito o Pix de <b>{money(p.amountCents)}</b> para <b>{p.partner.name}</b>. Esta ação não envia dinheiro: apenas registra.</Alert>
        <Field label="Identificador do comprovante (opcional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} /></Field></div>
    </Modal>
  );
}
