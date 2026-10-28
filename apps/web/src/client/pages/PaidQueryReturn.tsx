import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, PlateBadge, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { api } from '../api';
import { useSession } from '../session';

interface OrderState { orderId: string; status: string; entitlementStatus?: string | null; plate: string; searchType?: string; productId: string; amountCents: number; queryId?: string | null }
type Phase = 'waiting' | 'running' | 'failed' | 'cancelled' | 'refunded' | 'unpaid' | 'notfound' | 'timeout';

const DEAD = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']);
const STEPS = ['Pagamento confirmado', 'Consultando a fonte de dados', 'Montando o relatório'];

/**
 * Retorno do checkout de uma consulta avulsa: espera a confirmação do pagamento e executa a consulta sozinha,
 * sem o cliente precisar clicar em nada. Se o Pix ainda não caiu, continua esperando e segue assim que cair.
 */
export default function PaidQueryReturn() {
  usePageTitle('Concluindo sua consulta');
  const { orderId = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useSession();
  const checkout = params.get('checkout');
  const [phase, setPhase] = useState<Phase>('waiting');
  const [order, setOrder] = useState<OrderState | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);

  const open = useCallback((queryId: string) => { void refresh(); nav(`/app/consulta/${queryId}`, { replace: true }); }, [nav, refresh]);

  const run = useCallback(async (o: OrderState) => {
    if (running.current) return;
    running.current = true;
    setPhase('running'); setStep(0); setError('');
    try {
      const r = await api.post<{ id: string }>('/queries', { searchType: o.searchType ?? 'PLATE', searchValue: o.plate, productId: o.productId, paymentOrderId: o.orderId }, { headers: { 'Idempotency-Key': `pnm-pay-${o.orderId}` } });
      open(r.id);
    } catch (e) {
      // Já executada (outra aba, atualização da página): abre a consulta que existe.
      if (e instanceof ApiError && e.code === 'QUERY_PAYMENT_ALREADY_USED') {
        const again = await api.get<OrderState>(`/payments/query/${o.orderId}`).catch(() => null);
        if (again?.queryId) { open(again.queryId); return; }
      }
      if (e instanceof ApiError && e.code === 'QUERY_CANCELLED') { setPhase('cancelled'); return; }
      setError(errorMessage(e)); setPhase('failed');
    } finally { running.current = false; }
  }, [open]);

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) { setPhase('notfound'); return; }
    let alive = true;
    const startedAt = Date.now();
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      setPhase('waiting'); setError('');
      for (let n = 1; alive; n++) {
        // Rede de segurança do aviso do Mercado Pago: pergunta direto ao provedor logo no início e de vez em quando.
        if (n === 1 || n % 3 === 0) await api.post('/payments/sync', {}).catch(() => undefined);
        let o: OrderState | null = null;
        try { o = await api.get<OrderState>(`/payments/query/${orderId}`); }
        catch (e) { if (e instanceof ApiError && e.status === 404) { if (alive) setPhase('notfound'); return; } }
        if (!alive) return;
        if (o) {
          setOrder(o);
          if (o.queryId) { open(o.queryId); return; }
          if (o.entitlementStatus === 'READY') { await run(o); return; }
          if (o.entitlementStatus === 'CONSUMED') { setPhase('timeout'); return; }
          if (DEAD.has(o.status) || o.entitlementStatus === 'REVOKED' || o.entitlementStatus === 'FAILED') { setPhase('unpaid'); return; }
          if (checkout === 'failure' && n >= 2) { setPhase('unpaid'); return; }
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed > 15 * 60_000) { setPhase('timeout'); return; }
        await sleep(elapsed < 60_000 ? 2000 : 5000);
      }
    })();
    return () => { alive = false; };
  }, [orderId, checkout, attempt, open, run]);

  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600);
    return () => clearInterval(t);
  }, [phase]);

  async function cancelRunning() {
    setBusy(true);
    try {
      const r = await api.post<{ cancelled: number }>('/queries/cancel-processing', {});
      if (!r.cancelled) toast.ok('A consulta já terminou ou ainda está iniciando. Aguarde um instante.');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function cancelAndRefund() {
    setBusy(true);
    try {
      await api.post(`/payments/query/${orderId}/cancel`, {});
      setConfirmRefund(false); setPhase('refunded');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  const key = order ? (order.searchType && order.searchType !== 'PLATE' ? <b className="mono" style={{ fontSize: 20 }}>{order.plate}</b> : <PlateBadge plate={order.plate} size="lg" />) : null;

  if (phase === 'waiting' || phase === 'running') {
    const waiting = phase === 'waiting';
    return (
      <div className="card card-pad" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }} role="status" aria-live="polite">
        <div style={{ display: 'grid', placeItems: 'center', gap: 18 }}>
          {key}
          <h2 style={{ fontSize: 22 }}>{waiting ? 'Confirmando seu pagamento…' : 'Consultando…'}</h2>
          <ol className="progress-steps" style={{ textAlign: 'left' }}>
            {waiting
              ? <>
                <li className="cur"><span className="spin" style={{ width: 18, height: 18 }} /> Aguardando a confirmação do pagamento</li>
                <li><Icon name="clock" size={20} /> {STEPS[1]}</li>
                <li><Icon name="clock" size={20} /> {STEPS[2]}</li>
              </>
              : STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'cur' : ''}>{i < step ? <Icon name="check-circle" size={20} /> : i === step ? <span className="spin" style={{ width: 18, height: 18 }} /> : <Icon name="clock" size={20} />} {s}</li>)}
          </ol>
          {!waiting && <Button variant="ghost" size="sm" loading={busy} onClick={() => void cancelRunning()}>Cancelar consulta</Button>}
          <p className="muted" style={{ fontSize: 13.5 }}>{waiting ? (checkout === 'pending' ? 'Pagou o Pix? A consulta começa sozinha assim que o pagamento for confirmado. Pode deixar esta página aberta.' : 'Leva poucos segundos. A consulta começa sozinha.') : 'Não feche esta página. Se algo falhar, o valor volta para você automaticamente.'}</p>
        </div>
      </div>
    );
  }

  const copy: Record<Exclude<Phase, 'waiting' | 'running'>, { tone: 'danger' | 'warn' | 'ok'; title: string; text: string }> = {
    failed: { tone: 'danger', title: 'Não foi possível concluir a consulta.', text: `${error} Seu pagamento continua válido: você pode tentar de novo agora.` },
    cancelled: { tone: 'warn', title: 'Consulta cancelada.', text: 'Seu pagamento continua válido: você pode tentar de novo agora ou cancelar e pedir o estorno.' },
    refunded: { tone: 'ok', title: 'Cancelado. Estorno solicitado.', text: 'O valor volta pela mesma forma de pagamento. O prazo depende do banco ou da operadora do cartão; no Pix costuma ser rápido.' },
    unpaid: { tone: 'warn', title: 'O pagamento não foi aprovado.', text: 'Nada foi cobrado. Inicie a consulta de novo e escolha outro meio de pagamento, se precisar.' },
    notfound: { tone: 'warn', title: 'Não encontramos este pedido.', text: 'Confira se você está na conta usada na compra. Se pagou, a consulta aparece no topo de Nova consulta.' },
    timeout: { tone: 'warn', title: 'Ainda não recebemos a confirmação.', text: 'Se você já pagou, aguarde alguns minutos: a consulta fica pronta no topo de Nova consulta e também aparece no Histórico.' }
  };
  const c = copy[phase];
  return (
    <div className="stack-lg" style={{ maxWidth: 560, margin: '40px auto' }}>
      {key && <div style={{ textAlign: 'center' }}>{key}</div>}
      <Alert tone={c.tone} title={c.title}>{c.text}</Alert>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {(phase === 'failed' || phase === 'cancelled') && order && <Button variant="primary" onClick={() => { running.current = false; setAttempt((a) => a + 1); }}>Tentar de novo</Button>}
        {(phase === 'failed' || phase === 'cancelled') && order && (confirmRefund
          ? <><Button variant="danger" loading={busy} onClick={() => void cancelAndRefund()}>Confirmar cancelamento e estorno</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirmRefund(false)}>Voltar</Button></>
          : <Button variant="ghost" onClick={() => setConfirmRefund(true)}>Cancelar e pedir estorno</Button>)}
        {phase === 'timeout' && <Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>Verificar de novo</Button>}
        <Link className="btn" to="/app/consultar">Nova consulta</Link>
        <Link className="btn" to="/app/historico">Histórico</Link>
      </div>
    </div>
  );
}
