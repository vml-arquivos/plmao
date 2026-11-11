import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CUSTOMER_TYPE } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ConfirmDialog, CopyField, EmptyState, ErrorState, Field, Input, Modal, PageLoading, PlateBadge, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, formatPlate, isValidPlate, money, normalizePlate } from '../../shared/format';
import ReportView from '../../shared/ReportView';
import type { ReportV2 } from '../../shared/reportTypes';
import { Card, PageHead, QueryStatusBadge } from '../parts';
import { TypeBadge } from '../people';

interface Row { id: string; plate: string; status: string; priceCents: number; chargeSource: string; source?: string; sentToCustomer?: boolean; provider: string; productName: string; createdAt: string; completedAt: string | null; errorCode: string | null; errorMessage?: string | null; customerType?: string; customer: { name: string; email: string } }

const GROUPS: Record<'ok' | 'refunded' | 'issues' | 'all', { label: string; match: (status: string) => boolean }> = {
  ok: { label: 'Concluídas', match: (st) => st === 'SUCCESS' },
  refunded: { label: 'Estornadas', match: (st) => st === 'REFUNDED' },
  issues: { label: 'Falhas e pendentes', match: (st) => st !== 'SUCCESS' && st !== 'REFUNDED' },
  all: { label: 'Todas', match: () => true }
};

export function QueriesList() {
  usePageTitle('Consultas');
  const { can, user } = useAdminSession();
  const nav = useNavigate();
  const list = useAsync(() => api.get<Row[]>('/admin/queries'));
  const [wipe, setWipe] = useState<Row | null>(null);
  const isSuper = user?.role === 'SUPER_ADMIN';
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<'ok' | 'refunded' | 'issues' | 'all'>('ok');
  const [type, setType] = useState('');
  const [origin, setOrigin] = useState('');
  const [lookup, setLookup] = useState(false);
  const [lien, setLien] = useState(false);
  const [clean, setClean] = useState(false);
  const [deliver, setDeliver] = useState<{ id: string; plate: string; mode: 'send' | 'link' } | null>(null);
  const toast = useToast();
  async function openPdf(id: string) {
    const tab = window.open('about:blank', '_blank');
    try { const href = await api.blobUrl(`/admin/queries/${id}/report/pdf`); if (tab) tab.location.href = href; else window.location.assign(href); } catch (e) { tab?.close(); toast.error(errorMessage(e)); }
  }
  const rows = useMemo(() => (list.data ?? []).filter((r) => GROUPS[group].match(r.status) && (!type || r.customerType === type) && (!origin || (origin === 'ADMIN' ? r.source === 'ADMIN' : r.source !== 'ADMIN')) && (!q || `${r.plate} ${r.customer.email} ${r.customer.name}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, group, type, origin]);
  const counts = useMemo(() => { const o = { ok: 0, refunded: 0, issues: 0, all: 0 }; for (const r of list.data ?? []) { o.all += 1; if (r.status === 'SUCCESS') o.ok += 1; else if (r.status === 'REFUNDED') o.refunded += 1; else o.issues += 1; } return o; }, [list.data]);
  return (
    <>
      <PageHead title="Consultas" sub="Histórico das consultas concluídas. Estornadas, falhas e pendentes ficam em abas próprias, sem se misturar. Para mandar uma consulta à venda a um cliente, use Produtos do site → Enviar consulta." actions={<>{can('MANAGE_BILLING') && <Button icon="trash" onClick={() => setClean(true)}>Limpar falhas e sem pagamento</Button>}{can('VIEW_SENSITIVE_DATA') && <><Button icon="refresh" onClick={() => setLien(true)}>Atualizar gravames</Button><Button variant="primary" icon="search" onClick={() => setLookup(true)}>Consulta interna</Button></>}</>} />
      <div className="seg" role="group" aria-label="Situação das consultas" style={{ marginBottom: 8 }}>{(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map((k) => <Button key={k} variant={group === k ? 'primary' : 'ghost'} onClick={() => setGroup(k)}>{GROUPS[k].label} ({counts[k]})</Button>)}</div>
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por placa, nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de cliente"><option value="">Todos os tipos de cliente</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}</Select>
        <Select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origem"><option value="">Todas as origens</option><option value="ADMIN">Consultas internas</option><option value="WEB">Feitas pelos clientes</option></Select>
        <Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState title={group === 'ok' ? 'Nenhuma consulta concluída neste filtro' : 'Nenhuma consulta encontrada'} /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Placa</th><th>Produto</th><th>Cliente</th><th>Status</th><th className="r">Valor</th><th>Origem</th><th>Data</th><th className="r"><span className="sr-only">Ações</span></th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => nav(`/consultas/${r.id}`)}>
              <td><b className="mono">{formatPlate(r.plate)}</b></td><td>{r.productName}</td>
              <td>{r.customer.name} <TypeBadge type={r.customerType} /><div className="muted" style={{ fontSize: 12.5 }}>{r.customer.email}</div></td>
              <td><QueryStatusBadge status={r.status} />{r.errorCode && <div className="muted" style={{ fontSize: 12 }} title={r.errorMessage ?? undefined}>{r.errorCode}</div>}</td>
              <td className="r num">{r.source === 'ADMIN' ? '—' : money(r.priceCents)}</td><td>{r.source === 'ADMIN' ? <Badge tone="info">{r.sentToCustomer ? 'Enviada ao cliente' : 'Interna'}</Badge> : <Badge>{r.chargeSource}</Badge>}</td><td>{dateTime(r.createdAt)}</td>
              <td className="r" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>{isSuper && <Button size="sm" variant="ghost" icon="trash" onClick={() => setWipe(r)} aria-label={`Apagar consulta ${formatPlate(r.plate)}`}>Apagar</Button>}{r.status === 'SUCCESS' && <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}><Button size="sm" variant="ghost" icon="file-text" onClick={() => void openPdf(r.id)}>PDF</Button>{can('VIEW_SENSITIVE_DATA') && <><Button size="sm" variant="ghost" icon="link" onClick={() => setDeliver({ id: r.id, plate: r.plate, mode: 'link' })}>Link</Button><Button size="sm" variant="ghost" icon="send" onClick={() => setDeliver({ id: r.id, plate: r.plate, mode: 'send' })}>Enviar</Button></>}</span>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {wipe && <ConfirmDialog danger title="Apagar consulta de teste" confirmLabel="Apagar para sempre" message={<><p>Apagar a consulta da placa <b>{formatPlate(wipe.plate)}</b> e o resultado dela?</p><p className="muted">Não dá para desfazer. Não devolve valor ao cliente nem mexe no Mercado Pago.</p></>} onClose={() => setWipe(null)} onConfirm={async () => { try { await api.post(`/admin/data-reset/queries/${wipe.id}/delete`, { confirm: true }); toast.ok('Consulta apagada.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }} />}
      {lookup && <LookupModal onClose={() => { setLookup(false); list.reload(); }} />}
      {lien && <LienRefreshModal onClose={() => { setLien(false); list.reload(); }} />}
      {clean && <CleanupModal onClose={() => { setClean(false); list.reload(); }} />}
      {deliver && <DeliverModal queryId={deliver.id} plate={deliver.plate} mode={deliver.mode} onClose={() => setDeliver(null)} />}
    </>
  );
}

interface CleanupItem { kind: string; label: string; deletable: number; kept: number; keptReason: string }
interface CleanupInfo { items: CleanupItem[]; rules: { stuckHours: number; openCheckoutHours: number } }

/** Apaga o que não gerou receita nem entrega: consultas com falha ou travadas e pedidos sem pagamento. Mostra a contagem antes e pede confirmação. */
function CleanupModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const info = useAsync(() => api.post<CleanupInfo>('/admin/queries/cleanup', { confirm: false }));
  const [pick, setPick] = useState<Record<string, boolean>>({ FAILED: true, STUCK: true, UNPAID_ORDERS: true });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, number> | null>(null);
  const items = info.data?.items ?? [];
  const kinds = items.filter((i) => pick[i.kind] && i.deletable > 0).map((i) => i.kind);
  const total = items.filter((i) => pick[i.kind]).reduce((n, i) => n + i.deletable, 0);
  async function go() {
    setBusy(true);
    try { const r = await api.post<{ deleted: Record<string, number> }>('/admin/queries/cleanup', { confirm: true, kinds }); setDone(r.deleted); info.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Limpar falhas e consultas sem pagamento" onClose={onClose} footer={done ? <Button variant="primary" onClick={onClose}>Fechar</Button> : <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" icon="trash" loading={busy} disabled={!kinds.length} onClick={() => void go()}>{kinds.length ? `Apagar ${total}` : 'Nada para apagar'}</Button></>}>
      <div className="stack">
        {info.loading && !info.data ? <PageLoading /> : info.error ? <ErrorState error={info.error} onRetry={info.reload} /> : done ? (
          <Alert tone="info" title="Concluído">{Object.entries(done).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k === 'UNPAID_ORDERS' ? 'pedido(s) sem pagamento' : k === 'STUCK' ? 'consulta(s) travada(s)' : 'consulta(s) com falha'}`).join(' · ') || 'Nada precisou ser apagado.'}</Alert>
        ) : (
          <>
            <p className="muted">Só entra aqui o que não gerou receita nem entrega. Consulta feita com sucesso, pedido pago ou estornado e qualquer coisa com lançamento financeiro nunca são apagados. A ação não pode ser desfeita e fica na auditoria.</p>
            {items.map((i) => (
              <label key={i.kind} style={{ display: 'flex', flexWrap: 'nowrap', gap: 10, alignItems: 'flex-start' }}>
                <input type="checkbox" style={{ marginTop: 4, flex: '0 0 auto' }} checked={Boolean(pick[i.kind])} disabled={i.deletable === 0} onChange={(e) => setPick({ ...pick, [i.kind]: e.target.checked })} />
                <span style={{ flex: 1 }}><b>{i.label}</b>: {i.deletable} para apagar{i.kept ? <span className="muted"> · {i.kept} mantida(s): {i.keptReason}</span> : null}
                  {i.kind === 'STUCK' && <span className="muted"> (em processamento há mais de {info.data?.rules.stuckHours} horas)</span>}
                  {i.kind === 'UNPAID_ORDERS' && <span className="muted"> (checkout aberto só entra depois de {info.data?.rules.openCheckoutHours} horas)</span>}</span>
              </label>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Completa consultas antigas com o gravame detalhado (banco, CNPJ, contrato, datas e histórico), a partir do dado já guardado. */
function LienRefreshModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const info = useAsync(() => api.post<{ pending: number }>('/admin/queries/refresh-gravame', { confirm: false }));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ updated: number; failed: number; stopped: string | null; remaining: number } | null>(null);
  async function go() {
    setBusy(true);
    try { setDone(await api.post('/admin/queries/refresh-gravame', { confirm: true, max: 25 })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const d = info.data;
  return (
    <Modal title="Atualizar gravames das consultas" onClose={onClose} footer={done ? <Button variant="primary" onClick={onClose}>Fechar</Button> : <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!d || d.pending === 0} onClick={() => void go()}>Atualizar até 25</Button></>}>
      <div className="stack">
        {info.loading && !d ? <PageLoading /> : info.error ? <ErrorState error={info.error} onRetry={info.reload} /> : done ? (
          <Alert tone={done.failed ? 'warn' : 'info'} title="Concluído">{done.updated} consulta(s) atualizada(s){done.failed ? `, ${done.failed} com falha (nada foi alterado nelas)` : ''}{done.stopped ? `. Parou por limite da Credify (${done.stopped})` : ''}. Restam {done.remaining}.</Alert>
        ) : d && d.pending === 0 ? <Alert tone="info">Todas as consultas com gravame já estão completas.</Alert> : d ? (
          <>
            <p>{d.pending} consulta(s) com gravame ainda não têm banco, CNPJ, contrato e datas completos. A atualização busca o gravame na Credify e refaz o relatório, sem cobrar o cliente.</p>
            <Alert tone="warn" title="Consome o provedor">Cada consulta atualizada faz uma chamada paga à Credify. Cada clique atualiza no máximo 25.</Alert>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

interface LookupOutput { queryId: string | null; verificationCode: string | null; saved: boolean; plate: string; productName: string; consultedAt: string; report: ReportV2 | null; pdfBase64: string | null; pdfName: string | null; result: unknown }

function pdfBlobUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

function LookupModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const products = useAsync(() => api.get<Array<{ id: string; name: string; isFree?: boolean; active: boolean }>>('/admin/products'));
  const [plate, setPlate] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupOutput | null>(null);
  const [deliver, setDeliver] = useState<'send' | 'link' | null>(null);
  const usable = (products.data ?? []).filter((p) => p.active);
  async function run() {
    setBusy(true); setResult(null);
    try { setResult(await api.post<LookupOutput>('/admin/lookups', { plate: normalizePlate(plate), productId: productId || usable[0]?.id })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  function viewPdf() {
    if (!result?.pdfBase64) return;
    const href = pdfBlobUrl(result.pdfBase64);
    const tab = window.open(href, '_blank');
    if (!tab) window.location.assign(href);
    setTimeout(() => URL.revokeObjectURL(href), 10 * 60_000);
  }
  function downloadPdf() {
    if (!result?.pdfBase64) return;
    const href = pdfBlobUrl(result.pdfBase64);
    const a = document.createElement('a');
    a.href = href; a.download = result.pdfName ?? 'placa-na-mao.pdf'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
  return (
    <Modal title="Consulta interna" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} disabled={!isValidPlate(plate)} onClick={() => void run()}>Consultar</Button></>}>
      <div className="stack">
        <Alert tone="warn" title="Consome o provedor">Esta consulta usa o provedor contratado e fica registrada na auditoria. Não cobra o cliente.</Alert>
        <div className="form-grid"><Field label="Placa"><Input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" /></Field>
          <Field label="Produto"><Select value={productId} onChange={(e) => setProductId(e.target.value)}>{usable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field></div>
        {result && (
          <>
            {result.pdfBase64 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" icon="file-text" onClick={viewPdf}>Visualizar PDF</Button>
                <Button icon="download" onClick={downloadPdf}>Baixar PDF</Button>
                {result.queryId && <Button icon="send" onClick={() => setDeliver('send')}>Enviar ao cliente</Button>}
                {result.queryId && <Button icon="link" onClick={() => setDeliver('link')}>Gerar link</Button>}
              </div>
            )}
            {result.saved && result.queryId
              ? <Alert tone="info" title="Consulta salva">Ela já está na lista de consultas (origem "Interna"), com o código de validação <b className="mono">{result.verificationCode}</b>. <Link to={`/consultas/${result.queryId}`} onClick={onClose}>Abrir a consulta salva</Link></Alert>
              : <Alert tone="warn" title="Não foi possível salvar">O resultado está na tela e no PDF, mas não ficou salvo na lista. Baixe o PDF agora e avise o suporte técnico.</Alert>}
            {result.report
              ? <ReportView report={result.report} consultedAt={result.consultedAt} productName={result.productName} audience="client" />
              : <Alert tone="info">Esta consulta não gerou relatório estruturado; os dados técnicos estão abaixo.</Alert>}
            <details>
              <summary className="muted" style={{ cursor: 'pointer' }}>Dados técnicos (JSON)</summary>
              <pre className="code-box" style={{ maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(result.result, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
      {deliver && result?.queryId && <DeliverModal queryId={result.queryId} plate={result.plate} mode={deliver} onClose={() => setDeliver(null)} />}
    </Modal>
  );
}

/** Entrega de uma consulta pronta: coloca na conta do cliente (com aviso por e-mail) ou gera um link de visualização. Não consulta o provedor e não cobra. */
export function DeliverModal({ queryId, plate, mode, onClose }: { queryId: string; plate: string; mode: 'send' | 'link'; onClose: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<'send' | 'link'>(mode);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ name: string; email: string } | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const shares = useAsync(() => api.get<Array<{ id: string; createdAt: string; expiresAt: string; views: number; maxViews: number }>>(`/admin/queries/${queryId}/shares`), [queryId, link]);
  async function send() {
    setBusy(true);
    try { const r = await api.post<{ customer: { name: string; email: string } }>(`/admin/queries/${queryId}/send`, { email: email.trim(), ...(note.trim() ? { note: note.trim() } : {}) }); setSent(r.customer); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function makeLink() {
    setBusy(true);
    try { setLink(await api.post<{ url: string; expiresAt: string }>(`/admin/queries/${queryId}/share`, { days: Number(days) })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await api.del(`/admin/queries/${queryId}/shares/${id}`); toast.ok('Link revogado.'); shares.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const wa = link ? `https://wa.me/?text=${encodeURIComponent(`Relatório do veículo ${formatPlate(plate)}: ${link.url}`)}` : '';
  return (
    <Modal title={`Entregar consulta ${formatPlate(plate)}`} onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      <div className="stack">
        <div className="row" style={{ gap: 8 }}>
          <Button variant={tab === 'send' ? 'primary' : 'ghost'} onClick={() => setTab('send')}>Enviar ao cliente</Button>
          <Button variant={tab === 'link' ? 'primary' : 'ghost'} onClick={() => setTab('link')}>Gerar link</Button>
        </div>
        {tab === 'send' ? (
          sent ? <Alert tone="info" title="Enviado">A consulta já está no histórico de {sent.name} ({sent.email}) e um aviso foi enviado por e-mail. Sem cobrança.</Alert> : (
            <>
              <p className="muted">A consulta passa a aparecer no histórico do cliente, com o relatório e o PDF, sem cobrar nada e sem consultar o provedor de novo.</p>
              <Field label="E-mail do cliente (conta já criada)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@exemplo.com" /></Field>
              <Field label="Mensagem para o cliente (opcional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} /></Field>
              <div><Button variant="primary" icon="send" loading={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onClick={() => void send()}>Enviar</Button></div>
            </>
          )
        ) : (
          <>
            <p className="muted">Qualquer pessoa com o link vê o relatório, sem criar conta. O link expira e pode ser revogado.</p>
            <div className="row" style={{ gap: 8, alignItems: 'end' }}>
              <Field label="Validade"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="15">15 dias</option></Select></Field>
              <Button variant="primary" icon="link" loading={busy} onClick={() => void makeLink()}>Gerar link</Button>
            </div>
            {link && <><CopyField value={link.url} label="Link do relatório" /><a className="btn" href={wa} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a><p className="muted" style={{ fontSize: 13 }}>Vale até {dateTime(link.expiresAt)}. Guarde agora: o link completo não é mostrado de novo.</p></>}
            {shares.data?.length ? <div className="stack-sm"><b>Links ativos</b>{shares.data.map((x) => <div key={x.id} className="row" style={{ justifyContent: 'space-between' }}><span className="muted">até {dateTime(x.expiresAt)} · {x.views}/{x.maxViews} acessos</span><Button variant="ghost" onClick={() => void revoke(x.id)}>Revogar</Button></div>)}</div> : null}
          </>
        )}
      </div>
    </Modal>
  );
}

interface Detail { id: string; plate: string; status: string; priceCents: number; chargeSource: string; provider: string; source: string; productName: string; createdAt: string; completedAt: string | null; errorCode: string | null; errorMessage?: string | null; customer: { name: string; email: string }; hasRaw: boolean; revealableFields: string[]; report: ReportV2 | null }
interface Reveal { id: string; field: string; reason: string; createdAt: string; by: { name: string; email: string } }

const FIELD_LABEL: Record<string, string> = { PRONOME: 'Nome do proprietário', PRONOMEANTERIOR: 'Proprietário anterior', CPF_CNPJ_PROPRIETARIO: 'CPF/CNPJ do proprietário', CPFCNPJFATURADO: 'CPF/CNPJ faturado', CPFCNPJCOMPRADOR: 'CPF/CNPJ do comprador', CHASSI: 'Chassi', RENAVAM: 'RENAVAM', MOTOR: 'Motor' };

export function QueryDetailPage() {
  const { id } = useParams();
  const { can } = useAdminSession();
  const d = useAsync(() => api.get<Detail>(`/admin/queries/${id}`), [id]);
  const reveals = useAsync(() => api.get<Reveal[]>(`/admin/queries/${id}/reveals`), [id]);
  const [reveal, setReveal] = useState(false);
  const [deliver, setDeliver] = useState<'send' | 'link' | null>(null);
  const toast = useToast();
  async function openPdf(qid: string) {
    const tab = window.open('about:blank', '_blank');
    try { const href = await api.blobUrl(`/admin/queries/${qid}/report/pdf`); if (tab) tab.location.href = href; else window.location.assign(href); } catch (e) { tab?.close(); toast.error(errorMessage(e)); }
  }
  async function refreshLien(qid: string) {
    try {
      const r = await api.post<{ result: string }>(`/admin/queries/${qid}/refresh-gravame`, {});
      if (r.result === 'UPDATED') { toast.ok('Gravame atualizado.'); d.reload(); } else if (r.result === 'ALREADY') toast.ok('Esta consulta já tem o gravame completo.'); else toast.error('Esta consulta não tem o dado bruto guardado para atualizar.');
    } catch (e) { toast.error(errorMessage(e)); }
  }
  async function savePdf(qid: string) {
    try { await api.download(`/admin/queries/${qid}/report/pdf`, `placa-na-mao-${qid.slice(0, 8)}.pdf`); } catch (e) { toast.error(errorMessage(e)); }
  }
  usePageTitle(d.data ? `Consulta ${formatPlate(d.data.plate)}` : 'Consulta');
  if (d.loading && !d.data) return <PageLoading />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  return (
    <>
      <PageHead title={`Consulta ${formatPlate(x.plate)}`} sub={<Link to="/consultas">← Voltar às consultas</Link>} actions={<>{x.report && <Button icon="file-text" onClick={() => void openPdf(x.id)}>Visualizar PDF</Button>}{x.report && <Button icon="download" onClick={() => void savePdf(x.id)}>Baixar PDF</Button>}{x.report && x.hasRaw && can('VIEW_SENSITIVE_DATA') && <Button icon="refresh" onClick={() => void refreshLien(x.id)}>Atualizar gravame</Button>}{x.report && can('VIEW_SENSITIVE_DATA') && <Button icon="send" onClick={() => setDeliver('send')}>Enviar ao cliente</Button>}{x.report && can('VIEW_SENSITIVE_DATA') && <Button icon="link" onClick={() => setDeliver('link')}>Gerar link</Button>}{can('REVEAL_PII') && x.hasRaw && <Button icon="eye" onClick={() => setReveal(true)}>Revelar dado protegido</Button>}</>} />
      <div className="adm-split">
        <Card title="Detalhes">
          <div className="row"><PlateBadge plate={x.plate} size="sm" /><QueryStatusBadge status={x.status} /></div>
          <dl className="kv">
            <dt>Produto</dt><dd>{x.productName}</dd><dt>Valor</dt><dd className="num">{money(x.priceCents)} ({x.chargeSource})</dd>
            <dt>Cliente</dt><dd>{x.customer.name}<br /><span className="muted">{x.customer.email}</span></dd><dt>Provedor</dt><dd>{x.provider} · {x.source === 'ADMIN' ? 'Consulta interna (painel)' : x.source}</dd>
            <dt>Criada</dt><dd>{dateTime(x.createdAt)}</dd><dt>Concluída</dt><dd>{dateTime(x.completedAt)}</dd>
            {x.errorCode && <><dt>Erro</dt><dd>{x.errorCode}</dd></>}
            {x.errorMessage && x.errorCode && <><dt>Motivo</dt><dd style={{ overflowWrap: 'anywhere' }}>{x.errorMessage}</dd></>}
          </dl>
        </Card>
        <Card title="Revelações de dados protegidos" >
          {reveals.data?.length ? <div className="stack-sm">{reveals.data.map((r) => <div key={r.id}><b>{FIELD_LABEL[r.field] ?? r.field}</b> <span className="muted">por {r.by.name} · {dateTime(r.createdAt)}</span><p className="muted" style={{ fontSize: 13 }}>{r.reason}</p></div>)}</div> : <p className="muted">Nenhuma revelação registrada.</p>}
        </Card>
      </div>
      {x.report ? <ReportView report={x.report} consultedAt={x.createdAt} productName={x.productName} audience="team" /> : <Alert tone="info">Esta consulta não possui relatório (status {x.status}).</Alert>}
      {deliver && <DeliverModal queryId={x.id} plate={x.plate} mode={deliver} onClose={() => setDeliver(null)} />}
      {reveal && <RevealModal id={x.id} fields={x.revealableFields} onClose={() => { setReveal(false); reveals.reload(); }} />}
    </>
  );
}

function RevealModal({ id, fields, onClose }: { id: string; fields: string[]; onClose: () => void }) {
  const toast = useToast();
  const [field, setField] = useState(fields[0] ?? '');
  const [reason, setReason] = useState('');
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await api.post<{ value: string | null }>(`/admin/queries/${id}/reveal`, { field, reason: reason.trim() }); setValue(r.value); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Revelar dado protegido (LGPD)" onClose={onClose} footer={value === undefined ? <><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 10} onClick={() => void go()}>Revelar e registrar</Button></> : <Button variant="primary" onClick={onClose}>Fechar</Button>}>
      <div className="stack">
        {value === undefined ? <>
          <Alert tone="warn" title="Ação auditada">O acesso fica registrado com seu usuário, o motivo e o horário. O valor revelado não é salvo.</Alert>
          <Field label="Campo"><Select value={field} onChange={(e) => setField(e.target.value)}>{fields.map((f) => <option key={f} value={f}>{FIELD_LABEL[f] ?? f}</option>)}</Select></Field>
          <Field label="Motivo (mín. 10 caracteres)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={280} /></Field>
        </> : <><p className="muted">{FIELD_LABEL[field] ?? field}</p><div className="code-box mono" style={{ fontSize: 18 }}>{value ?? 'Não informado pelo provedor'}</div><p className="muted" style={{ fontSize: 13 }}>Este valor não será exibido novamente após fechar.</p></>}
      </div>
    </Modal>
  );
}
