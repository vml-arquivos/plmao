import { useMemo, useState } from 'react';
import { api, PAYMENT_STATUS } from '../api';
import { Badge, EmptyState, ErrorState, Input, PageLoading, Select, useAsync, usePageTitle } from '../../shared/ui';
import { dateTime, formatPlate, money } from '../../shared/format';
import { Kpi, PageHead, PaymentStatusBadge } from '../parts';

interface P { id: string; status: string; amountCents: number; purchaseType: string | null; productId: string | null; plate: string | null; provider: string; externalId: string | null; createdAt: string; paidAt: string | null; customer: { name: string; email: string } }

export default function Payments() {
  usePageTitle('Pagamentos');
  const list = useAsync(() => api.get<P[]>('/admin/payments'));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((p) => (!status || p.status === status) && (!q || `${p.customer.name} ${p.customer.email} ${p.externalId ?? ''} ${p.plate ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, status]);
  const paid = rows.filter((p) => p.status === 'PAID');
  return (
    <>
      <PageHead title="Pagamentos" sub="Últimos 200 pagamentos. Confirmações chegam por webhook assinado e são idempotentes." />
      <div className="adm-grid-4"><Kpi label="Pagos (filtro atual)" value={String(paid.length)} tone="ok" /><Kpi label="Valor pago" value={money(paid.reduce((a, p) => a + p.amountCents, 0))} /><Kpi label="Pendentes" value={String(rows.filter((p) => p.status === 'PENDING').length)} /></div>
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por cliente, placa ou referência" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState icon="credit-card" title="Nenhum pagamento encontrado" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Tipo</th><th>Status</th><th className="r">Valor</th><th>Provedor</th><th>Criado</th><th>Pago</th></tr></thead><tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.customer.name}<div className="muted" style={{ fontSize: 12.5 }}>{p.customer.email}</div></td>
              <td>{p.purchaseType === 'QUERY' ? <>Consulta {p.plate && <b className="mono">{formatPlate(p.plate)}</b>}</> : <Badge>Saldo</Badge>}</td>
              <td><PaymentStatusBadge status={p.status} /></td><td className="r num">{money(p.amountCents)}</td>
              <td>{p.provider}{p.externalId && <div className="muted mono" style={{ fontSize: 11.5 }}>{p.externalId.slice(0, 18)}</div>}</td><td>{dateTime(p.createdAt)}</td><td>{dateTime(p.paidAt)}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </>
  );
}
