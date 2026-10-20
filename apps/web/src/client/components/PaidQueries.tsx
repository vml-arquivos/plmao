import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Alert, Button, PlateBadge, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money } from '../../shared/format';
import { api } from '../api';
import { useSession } from '../session';

interface Order { id: string; status: string; amountCents: number; purchaseType: string; productId: string; plate: string; createdAt: string }
interface OrderState { orderId: string; status: string; entitlementStatus?: string | null; plate: string; productId: string; amountCents: number }

/** Consultas já pagas (Pix/cartão) e ainda não executadas: o cliente conclui com um clique. */
export default function PaidQueries() {
  const nav = useNavigate();
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState('');
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
      const r = await api.post<{ id: string }>('/queries', { plate: o.plate, productId: o.productId, paymentOrderId: o.orderId });
      await refresh();
      nav(`/app/consulta/${r.id}`);
    } catch (e) { toast.error(errorMessage(e)); reload(); } finally { setBusy(''); }
  }
  return (
    <div className="stack-sm">
      {data.map((o) => (
        <Alert key={o.orderId} tone="ok" title="Pagamento confirmado.">
          <span className="row" style={{ marginTop: 6 }}><PlateBadge plate={o.plate} size="sm" /> <span>Consulta de {money(o.amountCents)} pronta para ser executada.</span><Button variant="primary" size="sm" loading={busy === o.orderId} onClick={() => run(o)}>Concluir consulta</Button></span>
        </Alert>
      ))}
    </div>
  );
}
