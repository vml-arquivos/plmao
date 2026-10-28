import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, CUSTOMER_TYPE, QUERY_STATUS } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoading, PlateBadge, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, formatPlate, isValidPlate, money, normalizePlate } from '../../shared/format';
import ReportView from '../../shared/ReportView';
import type { ReportV2 } from '../../shared/reportTypes';
import { Card, PageHead, QueryStatusBadge } from '../parts';
import { TypeBadge } from '../people';

interface Row { id: string; plate: string; status: string; priceCents: number; chargeSource: string; provider: string; productName: string; createdAt: string; completedAt: string | null; errorCode: string | null; errorMessage?: string | null; customerType?: string; customer: { name: string; email: string } }

export function QueriesList() {
  usePageTitle('Consultas');
  const { can } = useAdminSession();
  const nav = useNavigate();
  const list = useAsync(() => api.get<Row[]>('/admin/queries'));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [lookup, setLookup] = useState(false);
  const rows = useMemo(() => (list.data ?? []).filter((r) => (!status || r.status === status) && (!type || r.customerType === type) && (!q || `${r.plate} ${r.customer.email} ${r.customer.name}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, status]);
  return (
    <>
      <PageHead title="Consultas" sub="Últimas 300 consultas. Dados pessoais ficam mascarados; a revelação é motivada e auditada." actions={can('VIEW_SENSITIVE_DATA') && <Button variant="primary" icon="search" onClick={() => setLookup(true)}>Consulta interna</Button>} />
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por placa, nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option>{Object.entries(QUERY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de cliente"><option value="">Todos os tipos de cliente</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}</Select>
        <Button variant="ghost" icon="refresh" onClick={list.reload}>Atualizar</Button>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState title="Nenhuma consulta encontrada" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Placa</th><th>Produto</th><th>Cliente</th><th>Status</th><th className="r">Valor</th><th>Origem</th><th>Data</th></tr></thead><tbody>
          {rows.map((r) => (
            <tr key={r.id} className="clickable" onClick={() => nav(`/consultas/${r.id}`)}>
              <td><b className="mono">{formatPlate(r.plate)}</b></td><td>{r.productName}</td>
              <td>{r.customer.name} <TypeBadge type={r.customerType} /><div className="muted" style={{ fontSize: 12.5 }}>{r.customer.email}</div></td>
              <td><QueryStatusBadge status={r.status} />{r.errorCode && <div className="muted" style={{ fontSize: 12 }} title={r.errorMessage ?? undefined}>{r.errorCode}</div>}</td>
              <td className="r num">{money(r.priceCents)}</td><td><Badge>{r.chargeSource}</Badge></td><td>{dateTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {lookup && <LookupModal onClose={() => setLookup(false)} />}
    </>
  );
}

function LookupModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const products = useAsync(() => api.get<Array<{ id: string; name: string; isFree?: boolean; active: boolean }>>('/admin/products'));
  const [plate, setPlate] = useState('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const usable = (products.data ?? []).filter((p) => p.active);
  async function run() {
    setBusy(true); setResult(null);
    try { setResult(await api.post('/admin/lookups', { plate: normalizePlate(plate), productId: productId || usable[0]?.id })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Consulta interna" onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} disabled={!isValidPlate(plate)} onClick={() => void run()}>Consultar</Button></>}>
      <div className="stack">
        <Alert tone="warn" title="Consome o provedor">Esta consulta usa o provedor contratado e fica registrada na auditoria. Não cobra o cliente.</Alert>
        <div className="form-grid"><Field label="Placa"><Input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" /></Field>
          <Field label="Produto"><Select value={productId} onChange={(e) => setProductId(e.target.value)}>{usable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field></div>
        {result != null && <pre className="code-box" style={{ maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(result, null, 2)}</pre>}
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
  usePageTitle(d.data ? `Consulta ${formatPlate(d.data.plate)}` : 'Consulta');
  if (d.loading && !d.data) return <PageLoading />;
  if (d.error || !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  const x = d.data;
  return (
    <>
      <PageHead title={`Consulta ${formatPlate(x.plate)}`} sub={<Link to="/consultas">← Voltar às consultas</Link>} actions={can('REVEAL_PII') && x.hasRaw && <Button icon="eye" onClick={() => setReveal(true)}>Revelar dado protegido</Button>} />
      <div className="adm-split">
        <Card title="Detalhes">
          <div className="row"><PlateBadge plate={x.plate} size="sm" /><QueryStatusBadge status={x.status} /></div>
          <dl className="kv">
            <dt>Produto</dt><dd>{x.productName}</dd><dt>Valor</dt><dd className="num">{money(x.priceCents)} ({x.chargeSource})</dd>
            <dt>Cliente</dt><dd>{x.customer.name}<br /><span className="muted">{x.customer.email}</span></dd><dt>Provedor</dt><dd>{x.provider} · {x.source}</dd>
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
