import { useMemo, useState } from 'react';
import { api, CUSTOMER_TYPE, PAYMENT_STATUS } from '../api';
import { Badge, Button, EmptyState, ErrorState, Input, PageLoading, Select, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { useAdminSession } from '../session';
import { dateTime, formatPlate, money } from '../../shared/format';
import { Kpi, PageHead, PaymentStatusBadge } from '../parts';
import { FISCAL_STATUS, TypeBadge } from '../people';

interface P { id: string; orderId: string | null; status: string; amountCents: number; purchaseType: string | null; productId: string | null; plate: string | null; provider: string; externalId: string | null; createdAt: string; paidAt: string | null; customer: { name: string; email: string }; customerType: string; fiscalStatus: string | null }

export default function Payments() {
  usePageTitle('Pagamentos');
  const toast = useToast();
  const { can } = useAdminSession();
  async function op(p: P, kind: 'reconcile' | 'refund') {
    if (!p.orderId) return;
    try {
      if (kind === 'refund') {
        const reason = window.prompt('Motivo do estorno total (mín. 10 caracteres). O Mercado Pago devolve o valor ao cliente:')?.trim();
        if (!reason) return;
        await api.post(`/admin/payment-orders/${p.orderId}/refund`, { reason, confirm: true });
        toast.ok('Estorno solicitado. O pedido será revertido quando o Mercado Pago confirmar.');
      } else { const r = await api.post<{ orderStatus: string }>(`/admin/payment-orders/${p.orderId}/reconcile`); toast.ok(`Conciliado. Situação do pedido: ${r.orderStatus}.`); }
      list.reload();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  const list = useAsync(() => api.get<P[]>('/admin/payments'));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((p) => (!status || p.status === status) && (!type || p.customerType === type) && (!q || `${p.customer.name} ${p.customer.email} ${p.externalId ?? ''} ${p.plate ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list.data, q, status]);
  const paid = rows.filter((p) => p.status === 'PAID');
  return (
    <>
      <PageHead title="Pagamentos" sub="Últimos 300 pagamentos. Confirmações chegam por webhook assinado e são idempotentes." />
      <div className="adm-grid-4"><Kpi label="Pagos (filtro atual)" value={String(paid.length)} tone="ok" /><Kpi label="Valor pago" value={money(paid.reduce((a, p) => a + p.amountCents, 0))} /><Kpi label="Pendentes" value={String(rows.filter((p) => p.status === 'PENDING').length)} /></div>
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por cliente, placa ou referência" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de cliente"><option value="">Todos os tipos de cliente</option>{Object.entries(CUSTOMER_TYPE).map(([k, v]) => <option key={k} value={k}>{v.plural}</option>)}</Select>
      </div>
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !rows.length ? <EmptyState icon="credit-card" title="Nenhum pagamento encontrado" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>Compra</th><th>Status</th><th className="r">Valor</th><th>Provedor</th><th>Criado</th><th>Pago</th><th>Nota fiscal</th><th></th></tr></thead><tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.customer.name} <TypeBadge type={p.customerType} /><div className="muted" style={{ fontSize: 12.5 }}>{p.customer.email}</div></td>
              <td>{p.purchaseType === 'QUERY' ? <>Consulta {p.plate && <b className="mono">{formatPlate(p.plate)}</b>}</> : <Badge>Saldo</Badge>}</td>
              <td><PaymentStatusBadge status={p.status} /></td><td className="r num">{money(p.amountCents)}</td>
              <td>{p.provider}{p.externalId && <div className="muted mono" style={{ fontSize: 11.5 }}>{p.externalId.slice(0, 18)}</div>}</td><td>{dateTime(p.createdAt)}</td><td>{dateTime(p.paidAt)}</td><td>{p.status !== 'PAID' ? '—' : p.fiscalStatus ? <Badge tone={FISCAL_STATUS[p.fiscalStatus]?.tone}>{FISCAL_STATUS[p.fiscalStatus]?.label}</Badge> : <Badge tone="warn">Sem nota</Badge>}</td>
              <td>{p.provider === 'mercadopago' && p.orderId && can('MANAGE_BILLING') && (p.status === 'PAID' ? <Button variant="ghost" onClick={() => void op(p, 'refund')}>Estornar</Button> : p.status === 'PENDING' ? <Button variant="ghost" onClick={() => void op(p, 'reconcile')}>Conciliar</Button> : null)}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </>
  );
}
