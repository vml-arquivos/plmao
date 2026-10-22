import { useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, dateTime } from '../../shared/format';
import { PageHead } from '../parts';
import { CustomerPicker, type PickedCustomer } from '../people';

const STATUS: Record<string, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }> = {
  RASCUNHO: { label: 'Rascunho', tone: 'neutral' }, EM_APROVACAO: { label: 'Em aprovação', tone: 'warn' }, APROVADO: { label: 'Aprovado', tone: 'info' },
  AGUARDANDO_ASSINATURA: { label: 'Aguardando assinatura', tone: 'warn' }, ASSINADO: { label: 'Assinado', tone: 'ok' }, RECUSADO: { label: 'Recusado', tone: 'danger' },
  EXPIRADO: { label: 'Expirado', tone: 'danger' }, CANCELADO: { label: 'Cancelado', tone: 'neutral' }
};
const KINDS: Record<string, string> = { PF_AVULSO: 'Pessoa física', PJ_B2B: 'Empresa', PACOTE_PERSONALIZADO: 'Pacote personalizado', PARCEIRO: 'Parceiro', ADITIVO: 'Aditivo' };
const VSTATUS: Record<string, string> = { DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão', APPROVED: 'Aprovado', PUBLISHED: 'Publicado', RETIRED: 'Antigo' };

interface Row { id: string; number: string; kind: string; status: string; party_name: string; created_at: string; signed_at: string | null; applied_at: string | null }
interface Detail extends Row { rendered_body: string; terms: { resolved: { items: Array<{ name: string }> } }; signers: Array<{ name: string; email: string; status: string; signed_at: string | null }>; events: Array<{ event: string; created_at: string; detail: Record<string, unknown> }>; expires_at: string | null; cancel_reason: string | null }

export default function Contracts() {
  usePageTitle('Contratos');
  const [tab, setTab] = useState<'contracts' | 'models'>('contracts');
  return (
    <>
      <PageHead title="Contratos" sub="Modelos revisados, aprovação por outra pessoa e assinatura eletrônica. Assinar um contrato não libera consultas nem cobra: as condições são aplicadas à parte." />
      <Tabs label="Seções" value={tab} onChange={setTab} items={[{ id: 'contracts', label: 'Contratos' }, { id: 'models', label: 'Modelos' }]} />
      {tab === 'contracts' ? <List /> : <Models />}
    </>
  );
}

function List() {
  const { can } = useAdminSession();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => api.get<{ items: Row[]; esign: { available: boolean } }>('/admin/contracts', { query: { status } }), [status]);
  const rows = list.data?.items ?? [];
  return (
    <>
      {list.data && !list.data.esign.available && <Alert tone="warn">A assinatura eletrônica não está ativa neste ambiente (ESIGN_PROVIDER). Dá para criar e aprovar, mas não enviar.</Alert>}
      <div className="toolbar">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <div className="grow" />
        {can('MANAGE_CONTRACTS') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Novo contrato</Button>}
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState icon="file-text" title="Nenhum contrato">Os contratos criados aparecem aqui.</EmptyState> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Número</th><th>Parte</th><th>Tipo</th><th>Situação</th><th>Criado em</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
              <td className="mono">{r.number}</td><td><b>{r.party_name}</b></td><td>{KINDS[r.kind] ?? r.kind}</td>
              <td><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>{r.applied_at && <> <Badge tone="ok">Condições aplicadas</Badge></>}</td><td>{dateOnly(r.created_at)}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {open && <DetailModal id={open} onClose={(changed) => { setOpen(null); if (changed) list.reload(); }} />}
      {creating && <CreateModal onClose={(id) => { setCreating(false); if (id) { list.reload(); setOpen(id); } }} />}
    </>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: (changed?: boolean) => void }) {
  const { can } = useAdminSession();
  const toast = useToast();
  const d = useAsync(() => api.get<Detail>(`/admin/contracts/${id}`), [id]);
  const [busy, setBusy] = useState('');
  const [changed, setChanged] = useState(false);
  const c = d.data;
  async function act(path: string, label: string, body?: unknown) {
    setBusy(path);
    try { await api.post(`/admin/contracts/${id}/${path}`, body); toast.ok(label); setChanged(true); d.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  }
  const ask = (text: string) => window.prompt(text)?.trim() || null;
  return (
    <Modal title={c ? `${c.number} — ${c.party_name}` : 'Contrato'} wide onClose={() => onClose(changed)}
      footer={c && <>
        {can('MANAGE_CONTRACTS') && c.status === 'RASCUNHO' && <Button variant="primary" loading={busy === 'submit'} onClick={() => void act('submit', 'Enviado para aprovação.')}>Enviar para aprovação</Button>}
        {can('APPROVE_CONTRACTS') && c.status === 'EM_APROVACAO' && <><Button variant="ghost" onClick={() => { const r = ask('Motivo da reprovação:'); if (r) void act('reject', 'Contrato devolvido.', { reason: r }); }}>Reprovar</Button><Button variant="primary" loading={busy === 'approve'} onClick={() => void act('approve', 'Contrato aprovado.')}>Aprovar</Button></>}
        {can('MANAGE_CONTRACTS') && c.status === 'APROVADO' && <Button variant="primary" loading={busy === 'send'} onClick={() => void act('send', 'Enviado ao assinante por e-mail.')}>Enviar para assinatura</Button>}
        {can('MANAGE_PRICING') && c.status === 'ASSINADO' && !c.applied_at && <Button variant="primary" loading={busy === 'apply'} onClick={() => void act('apply', 'Condições aplicadas.')}>Aplicar condições</Button>}
        {can('MANAGE_CONTRACTS') && !['ASSINADO', 'CANCELADO', 'EXPIRADO', 'RECUSADO'].includes(c.status) && <Button variant="ghost" onClick={() => { const r = ask('Motivo do cancelamento:'); if (r) void act('cancel', 'Contrato cancelado.', { reason: r }); }}>Cancelar contrato</Button>}
      </>}>
      {d.loading && !c ? <PageLoading /> : d.error ? <ErrorState error={d.error} onRetry={d.reload} /> : c && (
        <div className="stack">
          <div><Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label ?? c.status}</Badge> {c.expires_at && c.status === 'AGUARDANDO_ASSINATURA' && <span className="muted">Link válido até {dateTime(c.expires_at)}</span>}</div>
          {c.status === 'ASSINADO' && !c.applied_at && <Alert tone="info">Assinado. Os preços e a comissão só passam a valer depois de "Aplicar condições". Itens personalizados são configurados à mão.</Alert>}
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 320, overflow: 'auto', border: '1px solid var(--line, #d7ddd9)', borderRadius: 8, padding: 12 }}>{c.rendered_body}</pre>
          <span className="section-title">Assinante</span>
          {c.signers.map((s) => <div key={s.email}>{s.name} · {s.email} · <Badge tone={s.status === 'ASSINADO' ? 'ok' : 'warn'}>{s.status === 'ASSINADO' ? `Assinou em ${dateTime(s.signed_at)}` : 'Pendente'}</Badge></div>)}
          <span className="section-title">Histórico</span>
          <ul className="muted" style={{ paddingLeft: 18 }}>{c.events.map((e, i) => <li key={i}>{dateTime(e.created_at)} — {e.event.replaceAll('_', ' ').toLowerCase()}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

interface Item { type: 'QUERY' | 'CUSTOM'; productId: string; agreedPrice: string; name: string; quantity: string; unitPrice: string; discount: string }
const blankItem = (type: 'QUERY' | 'CUSTOM'): Item => ({ type, productId: '', agreedPrice: '', name: '', quantity: '10', unitPrice: '', discount: '0' });
const cents = (v: string) => Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100);

function CreateModal({ onClose }: { onClose: (id?: string) => void }) {
  const toast = useToast();
  const [code, setCode] = useState('PJ_B2B');
  const [company, setCompany] = useState('');
  const [partner, setPartner] = useState('');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [parent, setParent] = useState('');
  const [signer, setSigner] = useState({ name: '', email: '' });
  const [months, setMonths] = useState('12');
  const [payment, setPayment] = useState('Pix, mediante cobrança.');
  const [items, setItems] = useState<Item[]>([blankItem('QUERY')]);
  const [commission, setCommission] = useState({ pct: '10', base: 'NET' });
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const companies = useAsync(() => api.get<{ items: Array<{ id: string; name: string }> }>('/admin/companies'));
  const partners = useAsync(() => api.get<Array<{ id: string; name: string }>>('/admin/finance/partners'));
  const products = useAsync(() => api.get<Array<{ id: string; name: string }>>('/admin/products'));
  const setItem = (i: number, p: Partial<Item>) => setItems((s) => s.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const isPartner = code === 'PARCEIRO'; const isPf = code === 'PF_AVULSO'; const isAdd = code === 'ADITIVO';
  const body = () => ({
    templateCode: code,
    ...(isPf ? { userId: customer?.id } : isPartner ? { affiliateId: partner } : { organizationId: company }),
    ...(isAdd && parent ? { parentContractId: parent.trim() } : {}),
    signer: { name: signer.name.trim(), email: signer.email.trim() },
    terms: {
      items: isPartner ? [] : items.map((i) => (i.type === 'QUERY' ? { type: 'QUERY', productId: i.productId, agreedPriceCents: cents(i.agreedPrice) } : { type: 'CUSTOM', name: i.name.trim(), quantity: Number(i.quantity), unitPriceCents: cents(i.unitPrice), discountPercent: Number(i.discount.replace(',', '.')) || 0 })),
      validityMonths: Number(months), paymentTerms: payment.trim(), autoRenew: false,
      ...(isPartner ? { commission: { bps: Math.round(Number(commission.pct.replace(',', '.')) * 100), base: commission.base } } : {})
    }
  });
  async function run(kind: 'preview' | 'create') {
    setBusy(true);
    try {
      if (kind === 'preview') { const r = await api.post<{ body: string }>('/admin/contracts/preview', body()); setPreview(r.body); }
      else { const r = await api.post<{ id: string }>('/admin/contracts', body()); toast.ok('Rascunho criado.'); onClose(r.id); }
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const ready = signer.name.trim().length > 2 && signer.email.includes('@') && (isPf ? customer : isPartner ? partner : company);
  return (
    <Modal title="Novo contrato" wide onClose={() => onClose()} footer={<><Button variant="ghost" loading={busy} disabled={!ready} onClick={() => void run('preview')}>Ver texto</Button><Button variant="primary" loading={busy} disabled={!ready} onClick={() => void run('create')}>Criar rascunho</Button></>}>
      <div className="stack">
        <div className="form-grid cols-2">
          <Field label="Modelo"><Select value={code} onChange={(e) => setCode(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          {isPf ? <Field label="Cliente"><CustomerPicker value={customer} onChange={setCustomer} /></Field>
            : isPartner ? <Field label="Parceiro"><Select value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">Escolha…</option>{(partners.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              : <Field label="Empresa"><Select value={company} onChange={(e) => setCompany(e.target.value)}><option value="">Escolha…</option>{(companies.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
          {isAdd && <Field label="ID do contrato original (assinado)"><Input value={parent} onChange={(e) => setParent(e.target.value)} /></Field>}
          <Field label="Quem assina (nome)"><Input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} maxLength={120} /></Field>
          <Field label="E-mail de quem assina"><Input type="email" value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} maxLength={254} /></Field>
          <Field label="Vigência (meses)"><Input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Field label="Forma de pagamento"><Textarea rows={2} value={payment} onChange={(e) => setPayment(e.target.value)} maxLength={500} /></Field>
        {isPartner ? (
          <div className="form-grid cols-2">
            <Field label="Comissão (%)"><Input inputMode="decimal" value={commission.pct} onChange={(e) => setCommission({ ...commission, pct: e.target.value })} /></Field>
            <Field label="Calculada sobre"><Select value={commission.base} onChange={(e) => setCommission({ ...commission, base: e.target.value })}><option value="GROSS">Valor bruto</option><option value="NET">Valor líquido</option><option value="MARGIN">Margem</option></Select></Field>
          </div>
        ) : (
          <div className="stack">
            <span className="section-title">Preços e pacotes</span>
            {items.map((it, i) => (
              <div key={i} className="form-grid cols-2" style={{ borderBottom: '1px solid var(--line, #e5e7eb)', paddingBottom: 10 }}>
                {it.type === 'QUERY' ? (<>
                  <Field label="Consulta do catálogo"><Select value={it.productId} onChange={(e) => setItem(i, { productId: e.target.value })}><option value="">Escolha…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                  <Field label="Preço acordado por consulta (R$)"><Input inputMode="decimal" value={it.agreedPrice} onChange={(e) => setItem(i, { agreedPrice: e.target.value })} /></Field>
                </>) : (<>
                  <Field label="Nome do pacote"><Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} maxLength={120} /></Field>
                  <Field label="Quantidade"><Input inputMode="numeric" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value.replace(/\D/g, '') })} /></Field>
                  <Field label="Preço unitário de tabela (R$)"><Input inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></Field>
                  <Field label="Desconto (%)"><Input inputMode="decimal" value={it.discount} onChange={(e) => setItem(i, { discount: e.target.value })} /></Field>
                </>)}
                {items.length > 1 && <div><Button variant="ghost" onClick={() => setItems((s) => s.filter((_, n) => n !== i))}>Remover item</Button></div>}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => setItems((s) => [...s, blankItem('QUERY')])}>+ Consulta do catálogo</Button><Button variant="ghost" onClick={() => setItems((s) => [...s, blankItem('CUSTOM')])}>+ Pacote personalizado</Button></div>
          </div>
        )}
        {preview && <><span className="section-title">Texto do contrato</span><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 280, overflow: 'auto', border: '1px solid var(--line, #d7ddd9)', borderRadius: 8, padding: 12 }}>{preview}</pre></>}
      </div>
    </Modal>
  );
}

interface Tpl { id: string; code: string; name: string; versions: Array<{ id: string; version: number; status: string; title: string; legalReviewRef: string | null }> }

function Models() {
  const { can } = useAdminSession();
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: Tpl[]; notice: string }>('/admin/contract-models'));
  const [edit, setEdit] = useState<{ id: string; title: string; body: string; draft: boolean } | null>(null);
  async function act(id: string, path: string, label: string, body?: unknown) {
    try { await api.post(`/admin/contract-model-versions/${id}/${path}`, body); toast.ok(label); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function open(id: string, draft: boolean) { const v = await api.get<{ id: string; title: string; body: string }>(`/admin/contract-model-versions/${id}`); setEdit({ ...v, draft }); }
  async function save() {
    if (!edit) return;
    try { await api.patch(`/admin/contract-model-versions/${edit.id}`, { title: edit.title, body: edit.body }); toast.ok('Modelo salvo.'); setEdit(null); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const vars = useAsync(() => api.get<{ items: Array<{ key: string; label: string; example: string; group: string }> }>('/admin/contract-variables'));
  const [preview, setPreview] = useState<{ text: string; unknown: string[] } | null>(null);
  function insertVar(key: string) {
    if (!edit?.draft) return;
    const el = document.getElementById('minuta-texto') as HTMLTextAreaElement | null;
    const token = `{{${key}}}`;
    const a = el?.selectionStart ?? edit.body.length; const b = el?.selectionEnd ?? a;
    setEdit({ ...edit, body: edit.body.slice(0, a) + token + edit.body.slice(b) });
    window.setTimeout(() => { el?.focus(); el?.setSelectionRange(a + token.length, a + token.length); }, 0);
  }
  async function runPreview() {
    if (!edit) return;
    try { const r = await api.post<{ ok: boolean; unknown: string[]; text: string }>('/admin/contract-models/preview', { title: edit.title, body: edit.body }); setPreview({ text: r.text, unknown: r.unknown }); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function upload(t: Tpl, file: File | undefined) {
    if (!file) return;
    if (file.size > 200_000) { toast.error('Arquivo grande demais. Envie um texto de até 200 KB.'); return; }
    try {
      const text = (await file.text()).replace(/\r\n/g, '\n').trim();
      const first = text.split('\n').find((l) => l.trim().length >= 5)?.replace(/^#+\s*/, '').trim().slice(0, 200);
      await api.post(`/admin/contract-models/${t.id}/versions`, { title: first || t.name, body: text });
      toast.ok('Minuta enviada como nova versão em rascunho.'); list.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  async function newVersion(t: Tpl) {
    try { const cur = await api.get<{ title: string; body: string }>(`/admin/contract-model-versions/${t.versions[0]!.id}`); await api.post(`/admin/contract-models/${t.id}/versions`, { title: cur.title, body: cur.body }); toast.ok('Nova versão criada.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  return (
    <div className="stack">
      <Alert tone="warn">{list.data?.notice} Os textos iniciais são minutas e não foram validados por advogado. Publicar exige aprovação de outra pessoa com a referência da revisão jurídica.</Alert>
      {(list.data?.items ?? []).map((t) => (
        <div key={t.id} className="card card-pad stack">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{t.name}</b>{can('MANAGE_CONTRACTS') && <span style={{ display: 'flex', gap: 8 }}><label className="btn btn-ghost" style={{ position: 'relative', cursor: 'pointer' }}>Enviar minuta (.txt ou .md)<input type="file" accept=".txt,.md,text/plain,text/markdown" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} onChange={(e) => { void upload(t, e.target.files?.[0]); e.target.value = ''; }} /></label><Button variant="ghost" onClick={() => void newVersion(t)}>Nova versão</Button></span>}</div>
          {t.versions.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>v{v.version}</span><Badge tone={v.status === 'PUBLISHED' ? 'ok' : v.status === 'RETIRED' ? 'neutral' : 'warn'}>{VSTATUS[v.status] ?? v.status}</Badge>
              {v.legalReviewRef && <span className="muted">Revisão: {v.legalReviewRef}</span>}
              <span style={{ flex: 1 }} />
              <Button variant="ghost" onClick={() => void open(v.id, v.status === 'DRAFT' && can('MANAGE_CONTRACTS'))}>{v.status === 'DRAFT' ? 'Editar' : 'Ver'}</Button>
              {v.status === 'DRAFT' && can('MANAGE_CONTRACTS') && <Button variant="ghost" onClick={() => void act(v.id, 'submit', 'Enviado para revisão.')}>Enviar para revisão</Button>}
              {v.status === 'IN_REVIEW' && can('APPROVE_CONTRACTS') && <Button variant="ghost" onClick={() => { const r = window.prompt('Referência da revisão jurídica (parecer, nome/OAB, data):')?.trim(); if (r) void act(v.id, 'approve', 'Modelo aprovado.', { legalReviewRef: r }); }}>Aprovar</Button>}
              {(v.status === 'APPROVED') && can('APPROVE_CONTRACTS') && <Button variant="primary" onClick={() => void act(v.id, 'publish', 'Modelo publicado.')}>Publicar</Button>}
            </div>
          ))}
        </div>
      ))}
      {edit && (
        <Modal title="Modelo de contrato" wide onClose={() => { setEdit(null); setPreview(null); }} footer={<><Button variant="ghost" onClick={() => { setEdit(null); setPreview(null); }}>Fechar</Button><Button variant="ghost" onClick={() => void runPreview()}>Pré-visualizar com dados de exemplo</Button>{edit.draft && <Button variant="primary" onClick={() => void save()}>Salvar</Button>}</>}>
          <div className="stack">
            <Field label="Título"><Input value={edit.title} readOnly={!edit.draft} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Texto" hint="Variáveis entre chaves duplas, como {{contratante.nome}} e {{condicoes_comerciais}}."><Textarea id="minuta-texto" rows={16} value={edit.body} readOnly={!edit.draft} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            {edit.draft && <details open><summary>Variáveis disponíveis (clique para inserir)</summary>
              {['Partes', 'Valores e cálculos', 'Prazos', 'Comissão', 'Geral'].map((g) => <div key={g} style={{ margin: '8px 0' }}><b style={{ fontSize: 13 }}>{g}</b><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>{(vars.data?.items ?? []).filter((v) => v.group === g).map((v) => <button key={v.key} type="button" className="btn btn-sm" title={`${v.label}. Exemplo: ${v.example}`} onClick={() => insertVar(v.key)}>{`{{${v.key}}}`}</button>)}</div></div>)}
            </details>}
            {preview && (preview.unknown.length ? <Alert tone="danger">Variáveis desconhecidas: {preview.unknown.join(', ')}</Alert> : <div><b>Pré-visualização (dados fictícios)</b><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: 260, overflow: 'auto', border: '1px solid var(--line, #d7ddd9)', borderRadius: 8, padding: 12 }}>{preview.text}</pre></div>)}
          </div>
        </Modal>
      )}
    </div>
  );
}
