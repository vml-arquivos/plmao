import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, Skeleton, Tabs, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money } from '../../shared/format';
import { api } from '../api';
import { useSession } from '../session';
import { storedReferral, trackFunnel } from '../funnel';
import PurchaseContract, { ACCEPT_MISSING, MyContracts, NO_ACCEPT, bothAccepted, type LegalAccept } from '../components/PurchaseContract';
import PaidQueries from '../components/PaidQueries';
import PeriodFilter, { NO_PERIOD, periodParams, qs, type Period } from '../components/Period';

interface Pack { slug: string; name: string; description: string; credits: number; basePriceCents: number; priceCents: number; negotiated: boolean }
interface Tx { id: string; kind: string; amountCents: number; balanceAfterCents: number; description: string | null; createdAt: string }
interface Order { id: string; status: string; amountCents: number; purchaseType: string; productId: string | null; plate: string | null; provider: string; checkoutUrl: string | null; createdAt: string; paidAt: string | null }
interface Doc { id: string; kind: string; number: string | null; series: string | null; issuedAt: string | null; amountCents: number; description: string; verificationCode: string | null; pdfUrl: string | null; xmlUrl: string | null }
interface Quote { packageName: string; credits: number; subtotalCents: number; discountCents: number; amountCents: number; couponCode: string | null; paymentProviderConfigured: boolean }

const ORDER_STATUS: Record<string, { tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'; label: string }> = {
  PAID: { tone: 'ok', label: 'Pago' }, CHECKOUT_ACTIVE: { tone: 'info', label: 'Aguardando pagamento' }, CREATED: { tone: 'neutral', label: 'Criado' }, FAILED: { tone: 'danger', label: 'Falhou' }, REFUNDED: { tone: 'warn', label: 'Estornado' }, CHARGEBACK: { tone: 'danger', label: 'Contestado' }, EXPIRED: { tone: 'neutral', label: 'Expirado' }, CANCELLED: { tone: 'neutral', label: 'Cancelado' }
};

function Checkout({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<'' | 'quote' | 'pay'>('');
  const [error, setError] = useState('');
  const [accept, setAccept] = useState<LegalAccept>(NO_ACCEPT);
  const ref = storedReferral();
  useEffect(() => {
    api.post<Quote>('/payments/quote', { packageSlug: pack.slug, ...(ref ? { affiliateCode: ref } : {}) }).then((q) => { setQuote(q); trackFunnel('CHECKOUT_QUOTE_VIEWED', { amountCents: q.amountCents, paymentConfigured: q.paymentProviderConfigured }); }, (e) => setError(errorMessage(e)));
  }, [pack.slug, ref]);
  async function apply() {
    setBusy('quote'); setError('');
    try { setQuote(await api.post<Quote>('/payments/quote', { packageSlug: pack.slug, couponCode: coupon.trim(), ...(ref ? { affiliateCode: ref } : {}) })); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function pay() {
    if (!bothAccepted(accept)) { setError(ACCEPT_MISSING); return; }
    setBusy('pay'); setError('');
    trackFunnel('CHECKOUT_STARTED', { amountCents: quote?.amountCents ?? pack.priceCents, hasCoupon: Boolean(quote?.couponCode), hasAffiliate: Boolean(ref) });
    try {
      const r = await api.post<{ checkoutUrl: string }>('/payments/checkout', { packageSlug: pack.slug, acceptContract: true, acceptPrivacy: true, ...(quote?.couponCode ? { couponCode: quote.couponCode } : {}), ...(ref ? { affiliateCode: ref } : {}) });
      window.location.assign(r.checkoutUrl);
    } catch (e) { setError(errorMessage(e)); setBusy(''); }
  }
  return (
    <Modal title={`Comprar ${pack.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" icon="credit-card" loading={busy === 'pay'} disabled={!quote || !bothAccepted(accept) || quote.paymentProviderConfigured === false} onClick={pay}>Pagar {money(quote?.amountCents ?? pack.priceCents)}</Button></>}>
      <div className="stack">
        <div className="sum-line"><span className="muted">Saldo recebido</span><b className="num">{money(pack.credits * 100)}</b></div>
        <div className="sum-line"><span className="muted">Valor do pacote</span><b className="num">{money(quote?.subtotalCents ?? pack.priceCents)}</b></div>
        {quote && quote.discountCents > 0 && <div className="sum-line"><span className="muted">Cupom {quote.couponCode}</span><b className="num" style={{ color: 'var(--ok-ink)' }}>− {money(quote.discountCents)}</b></div>}
        <div className="sum-line total"><span>Total a pagar</span><span className="num">{money(quote?.amountCents ?? pack.priceCents)}</span></div>
        <div className="row" style={{ alignItems: 'end', flexWrap: 'nowrap' }}><Field label="Cupom (opcional)" className="grow"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="CUPOM10" /></Field><Button loading={busy === 'quote'} onClick={apply} disabled={coupon.trim().length < 3}>Aplicar</Button></div>
        {quote && quote.paymentProviderConfigured === false && <Alert tone="warn" title="Pagamento indisponível.">O checkout ainda não está ativo neste ambiente.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <PurchaseContract body={{ packageSlug: pack.slug, ...(quote?.couponCode ? { couponCode: quote.couponCode } : {}), ...(ref ? { affiliateCode: ref } : {}) }} value={accept} onChange={setAccept} disabled={!quote} />
        <p className="muted" style={{ fontSize: 13 }}><Icon name="lock" size={13} /> Pix ou cartão no checkout seguro.</p>
      </div>
    </Modal>
  );
}

export default function Wallet() {
  usePageTitle('Carteira');
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { me, refresh } = useSession();
  const [tab, setTab] = useState<'tx' | 'orders' | 'docs' | 'contracts'>('tx');
  const [period, setPeriod] = useState<Period>(NO_PERIOD);
  const pq = qs(periodParams(period));
  const [pack, setPack] = useState<Pack | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const packs = useAsync(() => api.get<Pack[]>('/credit-packages'), []);
  const txs = useAsync(() => api.get<Tx[]>(`/wallet/transactions${pq}`), [pq]);
  const orders = useAsync(() => api.get<Order[]>(`/payments/orders${pq}`), [pq]);
  const contracts = useAsync(() => api.get<{ items: Parameters<typeof MyContracts>[0]['rows'] }>('/purchase-contracts').then((r) => r.items), []);
  const docs = useAsync(() => api.get<Doc[]>(`/account/fiscal-documents${pq}`), [pq]);
  const checkout = params.get('checkout');
  const wanted = params.get('pacote');

  useEffect(() => { if (wanted && packs.data) { const p = packs.data.find((x) => x.slug === wanted); if (p) setPack(p); } }, [wanted, packs.data]);
  // Após voltar do checkout: atualiza saldo algumas vezes (o webhook pode demorar poucos segundos).
  useEffect(() => {
    if (checkout !== 'success' && checkout !== 'pending') return;
    let n = 0; let alive = true;
    const tick = async () => {
      n++;
      try { await api.post('/payments/sync', {}); } catch { /* o webhook ainda pode confirmar */ }
      if (!alive) return;
      void refresh(); txs.reload(); orders.reload();
    };
    void tick();
    const t = setInterval(() => { if (n >= 6) { clearInterval(t); return; } void tick(); }, 5000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout]);

  function closeCheckout() { setPack(null); if (wanted) { params.delete('pacote'); setParams(params, { replace: true }); } }
  async function sandbox() {
    setSandboxBusy(true);
    try { await api.post('/payments/sandbox', { amountCents: 5000 }); await refresh(); txs.reload(); toast.ok('Saldo de teste adicionado.'); } catch (e) { toast.error(errorMessage(e)); } finally { setSandboxBusy(false); }
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Carteira</h1></div>
      {checkout === 'success' && <Alert tone="ok" title="Pagamento recebido.">O saldo entra em poucos segundos.</Alert>}
      {checkout === 'pending' && <Alert tone="info" title="Aguardando pagamento.">Pix ou boleto podem levar alguns minutos. O saldo entra sozinho.</Alert>}
      {checkout === 'failure' && <Alert tone="danger" title="Pagamento não aprovado.">Nada foi cobrado. Tente outro meio de pagamento.</Alert>}
      {checkout === 'cancelled' && <Alert tone="warn" title="Pagamento cancelado.">Nada foi cobrado.</Alert>}
      {checkout === 'expired' && <Alert tone="warn" title="O checkout expirou.">Inicie uma nova compra.</Alert>}
      <PaidQueries />
      <section className="wallet-hero"><div><span className="k">Saldo disponível</span><span className="v num">{money(me?.balanceCents)}</span></div><div className="row"><Button variant="primary" icon="plus" onClick={() => document.getElementById('pacotes')?.scrollIntoView({ behavior: 'smooth' })}>Adicionar saldo</Button><Button onClick={() => nav('/app/consultar')} icon="search">Nova consulta</Button>{me?.sandbox && <Button variant="ghost" loading={sandboxBusy} onClick={sandbox}>Saldo de teste</Button>}</div></section>
      <section className="stack" id="pacotes">
        <h2>Adicionar saldo</h2>
        {packs.loading && <div className="pkg-grid"><Skeleton h={190} r={18} /><Skeleton h={190} r={18} /><Skeleton h={190} r={18} /></div>}
        {packs.error != null && <ErrorState error={packs.error} onRetry={packs.reload} />}
        {packs.data && !packs.data.length && <div className="card"><EmptyState icon="wallet" title="Pacotes indisponíveis">Você ainda pode pagar cada consulta com Pix ou cartão.</EmptyState></div>}
        {packs.data && <div className="pkg-grid">{packs.data.map((p) => { const bonus = Math.max(p.credits * 100 - p.priceCents, 0); return (
          <div className="plan" key={p.slug}>
            <h4>{p.name}</h4>
            <div className="price">{money(p.priceCents)}</div>
            <p className="desc">{p.description}</p>
            <ul><li><Icon name="check" size={16} /> {money(p.credits * 100)} em saldo</li>{bonus > 0 && <li><Icon name="check" size={16} /> Bônus de {money(bonus)}</li>}{p.negotiated && <li><Badge tone="ok">Preço negociado</Badge></li>}</ul>
            <Button variant="primary" block onClick={() => setPack(p)}>Comprar</Button>
          </div>); })}</div>}
      </section>
      <section className="stack">
        <div className="row-between"><Tabs label="Movimentações" value={tab} onChange={setTab} items={[{ id: 'tx', label: 'Extrato' }, { id: 'orders', label: 'Pagamentos' }, { id: 'docs', label: 'Notas fiscais' }, { id: 'contracts', label: 'Contratos' }]} />{tab === 'tx' && <Button size="sm" icon="download" disabled={!txs.data?.length} onClick={() => api.download(`/wallet/transactions.csv${pq}`, 'extrato.csv').catch((e) => toast.error(errorMessage(e)))}>CSV</Button>}</div>
        <PeriodFilter value={period} onChange={setPeriod} />
        {tab === 'tx' && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Descrição</th><th className="r">Valor</th><th className="r">Saldo</th></tr></thead><tbody>
            {txs.data?.map((t) => <tr key={t.id}><td>{dateTime(t.createdAt)}</td><td>{t.description ?? t.kind}</td><td className={`r num ${t.amountCents >= 0 ? 'tx-in' : 'tx-out'}`}>{t.amountCents >= 0 ? '+' : '−'} {money(Math.abs(t.amountCents))}</td><td className="r num">{money(t.balanceAfterCents)}</td></tr>)}
            {txs.data && !txs.data.length && <tr className="empty"><td colSpan={4}>Nenhuma movimentação.</td></tr>}
            {txs.loading && !txs.data && <tr className="empty"><td colSpan={4}>Carregando…</td></tr>}
          </tbody></table></div>
        )}
        {tab === 'contracts' && <MyContracts rows={contracts.data ?? undefined} loading={contracts.loading} />}
        {tab === 'orders' && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Tipo</th><th>Situação</th><th className="r">Valor</th><th /></tr></thead><tbody>
            {orders.data?.map((o) => { const st = ORDER_STATUS[o.status] ?? { tone: 'neutral' as const, label: o.status }; return <tr key={o.id}><td>{dateTime(o.createdAt)}</td><td>{o.purchaseType === 'QUERY' ? `Consulta ${o.plate ?? ''}` : 'Pacote de saldo'}</td><td><Badge tone={st.tone} dot>{st.label}</Badge></td><td className="r num">{money(o.amountCents)}</td><td className="actions">{o.status === 'CHECKOUT_ACTIVE' && o.checkoutUrl && <a className="btn btn-sm" href={o.checkoutUrl}>Pagar</a>}</td></tr>; })}
            {orders.data && !orders.data.length && <tr className="empty"><td colSpan={5}>Nenhum pagamento.</td></tr>}
          </tbody></table></div>
        )}
        {tab === 'docs' && (
          <div className="table-wrap"><table className="table"><thead><tr><th>Emissão</th><th>Nota</th><th>Descrição</th><th className="r">Valor</th><th /></tr></thead><tbody>
            {docs.data?.map((d) => <tr key={d.id}><td>{d.issuedAt ? dateTime(d.issuedAt) : '—'}</td><td>{d.kind === 'NFSE' ? 'NFS-e' : 'NF-e'} {d.number ?? ''}</td><td>{d.description}</td><td className="r num">{money(d.amountCents)}</td><td className="actions">{d.pdfUrl && <a className="btn btn-sm" href={d.pdfUrl} target="_blank" rel="noopener noreferrer">PDF</a>} {d.xmlUrl && <a className="btn btn-sm" href={d.xmlUrl} target="_blank" rel="noopener noreferrer">XML</a>}</td></tr>)}
            {docs.data && !docs.data.length && <tr className="empty"><td colSpan={5}>Nenhuma nota.</td></tr>}
            {docs.loading && !docs.data && <tr className="empty"><td colSpan={5}>Carregando…</td></tr>}
          </tbody></table></div>
        )}
      </section>
      {pack && <Checkout pack={pack} onClose={closeCheckout} />}
    </div>
  );
}
