import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Alert, Button, PlateBadge, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money } from '../../shared/format';
import { api } from '../api';
import { useSession } from '../session';

interface Order { id: string; status: string; amountCents: number; purchaseType: string; productId: string; plate: string; searchType?: string; createdAt: string }
interface OrderState { orderId: string; status: string; entitlementStatus?: string | null; plate: string; searchType?: string; productId: string; amountCents: number }

/** Consultas já pagas (Pix/cartão) e ainda não executadas: o cliente conclui com um clique. */
export default function PaidQueries() {
  const nav = useNavigate();
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState('');
  const { data, reload } = useAsync(async () => {
    const orders = await api.get<Order[]>('/payments/orders');
    const recent = orders.filter((o) => o.purchaseType === 'QUERY' && o.status === 'PAID' && Date.now() - new Date(o.createdAt).getTime() < 14 * 864e5).slice(0, 6);
    const states = await Promise.all(recent.map((o) => api.get<OrderState>(`/payments/query/${o.id}`).catch(() => null)));
    return states.filter((s): s is OrderState => Boolean(s && s.entitlementStatus === 'READY'));
  }, []);
  if (!data?.length) return null;
  async function run(o: OrderState) {
    setBusy(o.orderId);
    try {
      const r = await api.post<{ id: string }>('/queries', { searchType: o.searchType ?? 'PLATE', searchValue: o.plate, productId: o.productId, paymentOrderId: o.orderId });
      await refresh();
      nav(`/app/consulta/${r.id}`);
    } catch (e) { toast.error(errorMessage(e)); reload(); } finally { setBusy(''); }
  }
  async function cancel(o: OrderState) {
    setBusy(o.orderId);
    try {
      await api.post(`/payments/query/${o.orderId}/cancel`, {});
      toast.ok(o.amountCents === 0 ? 'Consulta cancelada.' : 'Cancelado. O estorno foi pedido e volta pela mesma forma de pagamento.');
      setConfirm(''); reload();
    } catch (e) { toast.error(errorMessage(e)); reload(); } finally { setBusy(''); }
  }
  return (
    <div className="stack-sm">
      {data.map((o) => (
        <Alert key={o.orderId} tone="ok" title="Pagamento confirmado.">
          <span className="row" style={{ marginTop: 6 }}>{(o.searchType ?? 'PLATE') === 'PLATE' ? <PlateBadge plate={o.plate} size="sm" /> : <b className="mono">{o.plate}</b>} <span>{o.amountCents === 0 ? 'Consulta grátis pronta para ser executada.' : `Consulta de ${money(o.amountCents)} pronta para ser executada.`}</span><Button variant="primary" size="sm" loading={busy === o.orderId} onClick={() => run(o)}>Concluir consulta</Button>{confirm === o.orderId
            ? <><Button variant="danger" size="sm" disabled={busy === o.orderId} onClick={() => void cancel(o)}>{o.amountCents === 0 ? 'Confirmar cancelamento' : 'Confirmar cancelamento e estorno'}</Button><Button variant="ghost" size="sm" disabled={busy === o.orderId} onClick={() => setConfirm('')}>Voltar</Button></>
            : <Button variant="ghost" size="sm" disabled={busy === o.orderId} onClick={() => setConfirm(o.orderId)}>Cancelar consulta</Button>}</span>
        </Alert>
      ))}
    </div>
  );
}
