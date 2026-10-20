import { useState } from 'react';
import { api, CUSTOMER_TYPE, maskDocument, maskZip, STATES } from '../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, money, num, parseMoneyToCents } from '../../shared/format';
import { Kpi, PageHead } from '../parts';
import { CompanySelect, CustomerPicker, FISCAL_STATUS, TypeBadge, type PickedCustomer } from '../people';

interface Doc {
  id: string; kind: 'NFSE' | 'NFE'; status: 'PENDING' | 'ISSUED' | 'CANCELLED'; amountCents: number; description: string; number: string | null; series: string | null; accessKey: string | null;
  verificationCode: string | null; issuedAt: string | null; pdfUrl: string | null; xmlUrl: string | null; cancelReason: string | null; notes: string | null; createdAt: string; chargeId: string | null; paymentId: string | null;
  customer: { name: string; document: string | null; documentKind: string | null; email: string | null; type: string; city: string | null; state: string | null }; missing: string[];
}
interface Summary { pending: number; pendingCents: number; issuedMonth: number; issuedMonthCents: number; cancelledMonth: number; paymentsWithoutDocument: number; paymentsWithoutDocumentCents: number; settingsReady: boolean; settingsMissing: string[]; environment: string }

export default function Fiscal() {
  usePageTitle('Notas fiscais');
  const toast = useToast();
  const [tab, setTab] = useState<'PENDING' | 'ISSUED' | 'CANCELLED' | 'settings'>('PENDING');
  const [customerType, setCustomerType] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [issue, setIssue] = useState<Doc | null>(null);
  const [cancel, setCancel] = useState<Doc | null>(null);
  const [remove, setRemove] = useState<Doc | null>(null);
  const summary = useAsync(() => api.get<Summary>('/admin/fiscal/summary'));
  const status = tab === 'settings' ? 'PENDING' : tab;
  const list = useAsync(() => (tab === 'settings' ? Promise.resolve({ items: [] as Doc[], total: 0 }) : api.get<{ items: Doc[]; total: number }>('/admin/fiscal/documents', { query: { status, customerType, search: q.trim(), from, to } })), [tab, customerType, q, from, to]);
  const reloadAll = () => { list.reload(); summary.reload(); };
  const s = summary.data;

  async function sync() {
    try { const r = await api.post<{ created: number }>('/admin/fiscal/sync'); toast.ok(r.created ? `${r.created} nota(s) criada(s) em “A emitir”.` : 'Nenhum pagamento novo sem nota.'); reloadAll(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function refresh(d: Doc) {
    try { await api.post(`/admin/fiscal/documents/${d.id}/refresh-customer`); toast.ok('Dados do cliente atualizados na nota.'); reloadAll(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function exportCsv() {
    try {
      const params = new URLSearchParams(Object.entries({ status: tab === 'settings' ? 'all' : tab, customerType, search: q.trim(), from, to }).filter(([, v]) => v) as Array<[string, string]>);
      await api.download(`/admin/fiscal/documents/export.csv?${params.toString()}`, 'notas-fiscais.csv');
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <PageHead title="Notas fiscais" sub="Controle do que precisa de nota, dos dados do cliente e das notas emitidas e canceladas, com planilha para o contador."
        actions={<><Button variant="ghost" icon="download" onClick={() => void exportCsv()}>Exportar planilha</Button><Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nova nota</Button></>} />
      {s && !s.settingsReady && <Alert tone="warn" title="Complete os dados do emissor">Faltam informações da sua empresa para emitir notas. <button type="button" className="btn btn-sm" onClick={() => setTab('settings')}>Configurar agora</button></Alert>}
      <Alert tone="info" title="Como funciona a emissão">As notas são emitidas no seu emissor (prefeitura, portal nacional ou o sistema do seu contador) e registradas aqui com número, chave e arquivo. A emissão automática exige certificado digital e um emissor contratado; ela ainda não está ligada.</Alert>
      <div className="adm-grid-4">
        <Kpi label="A emitir" value={num(s?.pending ?? 0)} tone={(s?.pending ?? 0) > 0 ? 'warn' : undefined} sub={money(s?.pendingCents ?? 0)} />
        <Kpi label="Emitidas no mês" value={num(s?.issuedMonth ?? 0)} tone="ok" sub={money(s?.issuedMonthCents ?? 0)} />
        <Kpi label="Pagamentos sem nota" value={num(s?.paymentsWithoutDocument ?? 0)} tone={(s?.paymentsWithoutDocument ?? 0) > 0 ? 'warn' : undefined} sub={money(s?.paymentsWithoutDocumentCents ?? 0)} />
        <Kpi label="Canceladas no mês" value={num(s?.cancelledMonth ?? 0)} sub={s?.environment === 'PRODUCAO' ? 'Ambiente de produção' : 'Ambiente de testes'} />
      </div>
      {(s?.paymentsWithoutDocument ?? 0) > 0 && (
        <Alert tone="warn" title={`${s!.paymentsWithoutDocument} pagamento(s) confirmado(s) ainda sem nota`}>Gere as pendências para não esquecer nenhuma venda. <button type="button" className="btn btn-sm btn-primary" onClick={() => void sync()}>Gerar notas a emitir</button></Alert>
      )}
      <Tabs label="Notas" value={tab} onChange={setTab} items={[{ id: 'PENDING', label: `A emitir${s?.pending ? ` (${s.pending})` : ''}` }, { id: 'ISSUED', label: 'Emitidas' }, { id: 'CANCELLED', label: 'Canceladas' }, { id: 'settings', label: 'Dados do emissor' }]} />
      {tab === 'settings' ? <Settings onSaved={summary.reload} /> : (
        <>
          <div className="toolbar">
            <div className="grow"><Input icon="search" placeholder="Buscar por cliente, CPF/CNPJ, número ou descrição" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
            <Select value={customerType} onChange={(e) => setCustomerType(e.target.value)} aria-label="Tipo de cliente"><option value="">Todos os tipos</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}</Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" style={{ width: 'auto' }} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" style={{ width: 'auto' }} />
          </div>
          {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.items.length ? (
            <EmptyState icon="receipt" title={tab === 'PENDING' ? 'Nenhuma nota a emitir' : tab === 'ISSUED' ? 'Nenhuma nota emitida neste filtro' : 'Nenhuma nota cancelada'}>
              {tab === 'PENDING' ? 'Quando uma cobrança for paga ou um pagamento for confirmado, a nota aparece aqui.' : undefined}
            </EmptyState>
          ) : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Descrição</th><th>Tipo</th><th className="r">Valor</th><th>{tab === 'ISSUED' ? 'Emissão' : 'Criada em'}</th><th>Situação</th><th /></tr></thead><tbody>
              {list.data.items.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.customer.name}</b> <TypeBadge type={d.customer.type} /><div className="muted mono" style={{ fontSize: 12.5 }}>{d.customer.document ?? 'sem CPF/CNPJ'}</div>
                    {d.missing.length > 0 && <div className="tag-warn">Falta: {d.missing.join(', ')}</div>}</td>
                  <td>{d.description}{d.cancelReason && <div className="muted" style={{ fontSize: 12.5 }}>Motivo: {d.cancelReason}</div>}</td>
                  <td>{d.kind === 'NFSE' ? 'NFS-e (serviço)' : 'NF-e (produto)'}</td>
                  <td className="r num">{money(d.amountCents)}</td>
                  <td>{dateOnly(d.issuedAt ?? d.createdAt)}</td>
                  <td><Badge tone={FISCAL_STATUS[d.status]?.tone} dot>{FISCAL_STATUS[d.status]?.label}</Badge>{d.number && <div className="muted" style={{ fontSize: 12.5 }}>nº {d.number}{d.series ? ` · série ${d.series}` : ''}</div>}</td>
                  <td className="actions">
                    {d.status === 'PENDING' && <>
                      {d.missing.length > 0 && <Button size="sm" variant="ghost" onClick={() => void refresh(d)}>Atualizar dados</Button>} <Button size="sm" variant="primary" onClick={() => setIssue(d)}>Registrar emissão</Button> <Button size="sm" variant="ghost" onClick={() => setRemove(d)}>Apagar</Button>
                    </>}
                    {d.status === 'ISSUED' && <>{d.pdfUrl && <a className="btn btn-sm btn-ghost" href={d.pdfUrl} target="_blank" rel="noreferrer noopener">PDF</a>} {d.xmlUrl && <a className="btn btn-sm btn-ghost" href={d.xmlUrl} target="_blank" rel="noreferrer noopener">XML</a>} <Button size="sm" variant="ghost" onClick={() => setCancel(d)}>Cancelar</Button></>}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </>
      )}
      {creating && <NewDoc onClose={(c) => { setCreating(false); if (c) reloadAll(); }} />}
      {issue && <IssueModal doc={issue} onClose={(c) => { setIssue(null); if (c) reloadAll(); }} />}
      {cancel && <CancelModal doc={cancel} onClose={(c) => { setCancel(null); if (c) reloadAll(); }} />}
      {remove && <ConfirmDialog danger title="Apagar nota a emitir?" confirmLabel="Apagar" message={`A pendência de ${money(remove.amountCents)} para ${remove.customer.name} será removida. Notas já emitidas não podem ser apagadas, só canceladas.`} onConfirm={async () => { try { await api.del(`/admin/fiscal/documents/${remove.id}`); toast.ok('Pendência apagada.'); reloadAll(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} onClose={() => setRemove(null)} />}
    </>
  );
}

function NewDoc({ onClose }: { onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'customer' | 'company'>('customer');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [company, setCompany] = useState('');
  const [docKind, setDocKind] = useState<'NFSE' | 'NFE'>('NFSE');
  const [description, setDescription] = useState('Serviço de consulta veicular');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseMoneyToCents(amount);
  const ok = (kind === 'customer' ? Boolean(customer) : Boolean(company)) && description.trim().length >= 3 && Boolean(cents);
  async function save() {
    setBusy(true);
    try { await api.post('/admin/fiscal/documents', { ...(kind === 'customer' ? { customerId: customer!.id } : { organizationId: company }), kind: docKind, description: description.trim(), amountCents: cents }); toast.ok('Nota criada em “A emitir”.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title="Nova nota a emitir" onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>Criar</Button></>}>
      <div className="stack">
        <Tabs label="Para quem" value={kind} onChange={setKind} items={[{ id: 'customer', label: 'Um cliente' }, { id: 'company', label: 'Uma empresa' }]} />
        {kind === 'customer' ? <Field label="Cliente"><CustomerPicker value={customer} onChange={setCustomer} /></Field> : <Field label="Empresa"><CompanySelect value={company} onChange={setCompany} allowNone={false} /></Field>}
        <div className="form-grid cols-2">
          <Field label="Tipo de nota"><Select value={docKind} onChange={(e) => setDocKind(e.target.value as 'NFSE' | 'NFE')}><option value="NFSE">NFS-e (nota de serviço)</option><option value="NFE">NF-e (nota de produto)</option></Select></Field>
          <Field label="Valor (R$)"><Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        </div>
        <Field label="Descrição do serviço"><Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

function IssueModal({ doc, onClose }: { doc: Doc; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [series, setSeries] = useState('1');
  const [accessKey, setAccessKey] = useState('');
  const [code, setCode] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [pdf, setPdf] = useState('');
  const [xml, setXml] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post(`/admin/fiscal/documents/${doc.id}/issue`, { number: number.trim(), series: series.trim() || null, accessKey: accessKey.trim() || null, verificationCode: code.trim() || null, issuedAt: date, pdfUrl: pdf.trim() || null, xmlUrl: xml.trim() || null });
      toast.ok('Nota registrada como emitida.'); onClose(true);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title="Registrar nota emitida" wide onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!number.trim()} onClick={() => void save()}>Registrar</Button></>}>
      <div className="stack">
        <Alert tone="info">Emita a nota no seu emissor para <b>{doc.customer.name}</b> ({doc.customer.document ?? 'sem CPF/CNPJ'}), valor <b>{money(doc.amountCents)}</b>, e informe aqui o resultado.</Alert>
        <div className="form-grid cols-2">
          <Field label="Número da nota"><Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={30} /></Field>
          <Field label="Série"><Input value={series} onChange={(e) => setSeries(e.target.value)} maxLength={5} /></Field>
          <Field label="Data de emissão"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Código de verificação"><Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={60} /></Field>
        </div>
        <Field label="Chave de acesso (NF-e)" hint="Opcional para nota de serviço."><Input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} maxLength={60} /></Field>
        <div className="form-grid cols-2">
          <Field label="Link do PDF" hint="Endereço https do arquivo."><Input value={pdf} onChange={(e) => setPdf(e.target.value)} placeholder="https://…" /></Field>
          <Field label="Link do XML"><Input value={xml} onChange={(e) => setXml(e.target.value)} placeholder="https://…" /></Field>
        </div>
      </div>
    </Modal>
  );
}

function CancelModal({ doc, onClose }: { doc: Doc; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.post(`/admin/fiscal/documents/${doc.id}/cancel`, { reason: reason.trim() }); toast.ok('Nota marcada como cancelada.'); onClose(true); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={`Cancelar nota nº ${doc.number ?? ''}`} onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Voltar</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={() => void save()}>Marcar como cancelada</Button></>}>
      <div className="stack">
        <Alert tone="warn" title="Atenção">Isto só atualiza o controle aqui. O cancelamento oficial precisa ser feito também no emissor (prefeitura/SEFAZ), dentro do prazo legal.</Alert>
        <Field label="Motivo do cancelamento"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

interface SettingsData { [k: string]: unknown; ready: boolean; missing: string[] }
function Settings({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const res = useAsync(() => api.get<SettingsData>('/admin/fiscal/settings'));
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const d = res.data;
  const v = f ?? Object.fromEntries(Object.entries(d).filter(([k]) => !['ready', 'missing', 'emissionMode'].includes(k)).map(([k, x]) => [k, x == null ? '' : k === 'issRateBps' ? String(Number(x) / 100).replace('.', ',') : String(x)]));
  const set = (k: string, x: string) => setF({ ...v, [k]: x });
  const nz = (k: string): string | null => (v[k]?.trim() ? v[k]!.trim() : null);
  async function save() {
    setBusy(true);
    try {
      await api.put('/admin/fiscal/settings', {
        legalName: nz('legalName'), tradeName: nz('tradeName'), cnpj: nz('cnpj'), stateRegistration: nz('stateRegistration'), municipalRegistration: nz('municipalRegistration'), taxRegime: v.taxRegime || 'SIMPLES', cnae: nz('cnae'),
        serviceCode: nz('serviceCode'), serviceDescription: nz('serviceDescription'), issRateBps: v.issRateBps?.trim() ? Math.round(Number(v.issRateBps.replace(',', '.')) * 100) : null, city: nz('city'), state: nz('state'), cityIbgeCode: nz('cityIbgeCode'),
        zip: nz('zip'), street: nz('street'), streetNumber: nz('streetNumber'), district: nz('district'), email: nz('email'), phone: nz('phone'), environment: v.environment || 'HOMOLOGACAO', series: v.series?.trim() || '1',
        accountantEmail: nz('accountantEmail'), notes: nz('notes')
      });
      toast.ok('Dados do emissor salvos.'); setF(null); res.reload(); onSaved();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack">
      {d.ready ? <Alert tone="ok" title="Dados do emissor completos">Tudo certo para registrar notas.</Alert> : <Alert tone="warn" title="Dados incompletos">Preencha razão social, CNPJ, inscrição municipal, código do serviço, cidade, UF e regime tributário.</Alert>}
      <div className="adm-card"><div className="body stack">
        <span className="section-title">Sua empresa</span>
        <div className="form-grid cols-2">
          <Field label="Razão social"><Input value={v.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} maxLength={160} /></Field>
          <Field label="Nome fantasia"><Input value={v.tradeName ?? ''} onChange={(e) => set('tradeName', e.target.value)} maxLength={160} /></Field>
          <Field label="CNPJ"><Input inputMode="numeric" value={v.cnpj ?? ''} onChange={(e) => set('cnpj', maskDocument(e.target.value))} placeholder="00.000.000/0000-00" /></Field>
          <Field label="Regime tributário"><Select value={v.taxRegime ?? 'SIMPLES'} onChange={(e) => set('taxRegime', e.target.value)}><option value="MEI">MEI</option><option value="SIMPLES">Simples Nacional</option><option value="PRESUMIDO">Lucro presumido</option><option value="REAL">Lucro real</option></Select></Field>
          <Field label="Inscrição municipal"><Input value={v.municipalRegistration ?? ''} onChange={(e) => set('municipalRegistration', e.target.value)} maxLength={30} /></Field>
          <Field label="Inscrição estadual"><Input value={v.stateRegistration ?? ''} onChange={(e) => set('stateRegistration', e.target.value)} maxLength={30} /></Field>
        </div>
        <span className="section-title">Serviço prestado</span>
        <div className="form-grid cols-2">
          <Field label="Código do serviço (LC 116)" hint="Ex.: 1.07 — suporte técnico em informática. Confirme com seu contador."><Input value={v.serviceCode ?? ''} onChange={(e) => set('serviceCode', e.target.value)} maxLength={20} /></Field>
          <Field label="CNAE"><Input value={v.cnae ?? ''} onChange={(e) => set('cnae', e.target.value)} maxLength={20} /></Field>
          <Field label="Alíquota de ISS (%)"><Input inputMode="decimal" value={v.issRateBps ?? ''} onChange={(e) => set('issRateBps', e.target.value)} placeholder="2,00" /></Field>
          <Field label="Série padrão"><Input value={v.series ?? '1'} onChange={(e) => set('series', e.target.value)} maxLength={5} /></Field>
        </div>
        <Field label="Descrição padrão do serviço"><Textarea rows={2} value={v.serviceDescription ?? ''} onChange={(e) => set('serviceDescription', e.target.value)} maxLength={400} /></Field>
        <span className="section-title">Endereço e contato</span>
        <div className="form-grid cols-2">
          <Field label="CEP"><Input inputMode="numeric" value={v.zip ?? ''} onChange={(e) => set('zip', maskZip(e.target.value))} /></Field>
          <Field label="Rua"><Input value={v.street ?? ''} onChange={(e) => set('street', e.target.value)} maxLength={160} /></Field>
          <Field label="Número"><Input value={v.streetNumber ?? ''} onChange={(e) => set('streetNumber', e.target.value)} maxLength={20} /></Field>
          <Field label="Bairro"><Input value={v.district ?? ''} onChange={(e) => set('district', e.target.value)} maxLength={80} /></Field>
          <Field label="Cidade"><Input value={v.city ?? ''} onChange={(e) => set('city', e.target.value)} maxLength={80} /></Field>
          <Field label="UF"><Select value={v.state ?? ''} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Código IBGE do município" hint="7 dígitos."><Input inputMode="numeric" value={v.cityIbgeCode ?? ''} onChange={(e) => set('cityIbgeCode', e.target.value.replace(/\D/g, '').slice(0, 7))} /></Field>
          <Field label="E-mail da empresa"><Input type="email" value={v.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Telefone"><Input value={v.phone ?? ''} onChange={(e) => set('phone', e.target.value)} maxLength={30} /></Field>
          <Field label="E-mail do contador"><Input type="email" value={v.accountantEmail ?? ''} onChange={(e) => set('accountantEmail', e.target.value)} /></Field>
        </div>
        <span className="section-title">Ambiente</span>
        <div className="form-grid cols-2">
          <Field label="Ambiente de emissão" hint="Use “Testes” até o contador liberar a produção."><Select value={v.environment ?? 'HOMOLOGACAO'} onChange={(e) => set('environment', e.target.value)}><option value="HOMOLOGACAO">Testes (homologação)</option><option value="PRODUCAO">Produção</option></Select></Field>
        </div>
        <Field label="Observações"><Textarea rows={2} value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} maxLength={1000} /></Field>
        <div className="row"><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar dados do emissor</Button></div>
      </div></div>
    </div>
  );
}
