import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, EmptyState, Field, Input, Skeleton, useAsync, usePageTitle } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { formatPlate, isValidPlate, money, normalizePlate } from '../../shared/format';
import { api, type Catalog } from '../api';
import { useSession } from '../session';
import { storedReferral, trackFunnel } from '../funnel';
import PaidQueries from '../components/PaidQueries';

interface QProduct { id: string; name: string; description: string; priceCents: number; basePriceCents: number; negotiated: boolean; features: string[] | null; isFree: boolean; featured: boolean; commercialStatus: string }
interface Quote { amountCents: number; subtotalCents: number; discountCents: number; couponCode: string | null; paymentProviderConfigured: boolean }

const STEPS = ['Validando a placa', 'Consultando a fonte de dados', 'Montando o relatório'];

export default function NewQuery() {
  usePageTitle('Nova consulta');
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { me, setBalance, refresh } = useSession();
  const [plate, setPlate] = useState(normalizePlate(params.get('placa') ?? ''));
  const [productId, setProductId] = useState(params.get('produto') ?? '');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'wallet' | 'pay' | 'quote'>('');
  const [step, setStep] = useState(0);
  const idem = useRef<string>('');
  const { data, error: loadErr, loading, reload } = useAsync(async () => {
    const [products, catalog] = await Promise.all([api.get<QProduct[]>('/query-products'), api.get<Catalog>('/catalog').catch(() => null)]);
    const status = new Map((catalog?.products ?? []).map((p) => [p.id, p.commercialStatus]));
    return products.filter((p) => !p.isFree).map((p) => ({ ...p, commercialStatus: status.get(p.id) ?? p.commercialStatus }));
  }, []);

  const products = data ?? [];
  const available = products.filter((p) => p.commercialStatus === 'ACTIVE');
  useEffect(() => { if (!productId && available.length) setProductId((available.find((p) => p.featured) ?? available[0]).id); }, [available, productId]);
  const product = products.find((p) => p.id === productId);
  const price = product?.priceCents ?? 0;
  const balance = me?.balanceCents ?? 0;
  const enough = balance >= price;
  const valid = isValidPlate(plate);
  const due = quote ? quote.amountCents : price;
  useEffect(() => { setQuote(null); }, [productId, plate]);
  useEffect(() => { if (busy !== 'wallet') return; const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600); return () => clearInterval(t); }, [busy]);

  const can = useMemo(() => valid && Boolean(product) && product?.commercialStatus === 'ACTIVE', [valid, product]);

  async function applyCoupon() {
    if (!product || coupon.trim().length < 3) return;
    setBusy('quote'); setError('');
    try { const q = await api.post<Quote>('/payments/query/quote', { productId: product.id, plate, couponCode: coupon.trim() }); setQuote(q); }
    catch (e) { setQuote(null); setError(errorMessage(e)); } finally { setBusy(''); }
  }

  async function runWallet() {
    if (!can || !product) return;
    setBusy('wallet'); setStep(0); setError('');
    idem.current ||= crypto.randomUUID();
    trackFunnel('CTA_CLICKED', { placement: 'new_query_wallet', productId: product.id });
    try {
      const r = await api.post<{ id: string }>('/queries', { plate, productId: product.id }, { headers: { 'Idempotency-Key': idem.current } });
      idem.current = '';
      const balanceNow = await api.get<{ balanceCents: number }>('/me').then((m) => m.balanceCents).catch(() => undefined);
      if (balanceNow !== undefined) setBalance(balanceNow); else void refresh();
      nav(`/app/consulta/${r.id}`);
    } catch (e) {
      idem.current = '';
      const refunded = e instanceof ApiError && e.data.refunded === true;
      setError(errorMessage(e) + (refunded ? ' O valor debitado foi estornado ao seu saldo.' : ''));
      void refresh();
    } finally { setBusy(''); }
  }

  async function payDirect() {
    if (!can || !product) return;
    setBusy('pay'); setError('');
    trackFunnel('CHECKOUT_STARTED', { productId: product.id, amountCents: due, hasCoupon: Boolean(quote?.couponCode) });
    try {
      const ref = storedReferral();
      const r = await api.post<{ checkoutUrl: string }>('/payments/query/checkout', { productId: product.id, plate, ...(coupon.trim() && quote?.couponCode ? { couponCode: coupon.trim() } : {}), ...(ref ? { affiliateCode: ref } : {}) });
      window.location.assign(r.checkoutUrl);
    } catch (e) { setError(errorMessage(e)); setBusy(''); }
  }

  if (busy === 'wallet') {
    return (
      <div className="card card-pad" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }} role="status" aria-live="polite">
        <div style={{ display: 'grid', placeItems: 'center', gap: 18 }}>
          <span className="plate lg"><b>{formatPlate(plate).replace('-', '')}</b></span>
          <h2 style={{ fontSize: 22 }}>Consultando a placa…</h2>
          <ol className="progress-steps" style={{ textAlign: 'left' }}>
            {STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'cur' : ''}>{i < step ? <Icon name="check-circle" size={20} /> : i === step ? <span className="spin" style={{ width: 18, height: 18 }} /> : <Icon name="clock" size={20} />} {s}</li>)}
          </ol>
          <p className="muted" style={{ fontSize: 13.5 }}>Não feche esta página. Se algo falhar, o valor é estornado automaticamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Nova consulta</h1></div></div>
      <PaidQueries />
      <div className="nq-grid">
        <div className="stack-lg">
          <section className="stack">
            <h2 style={{ fontSize: 18 }}>1. Placa do veículo</h2>
            <div className="plate-input-wrap">
              <div className="plate-input"><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" aria-label="Placa do veículo" maxLength={8} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus={!plate} /></div>
              <span className="muted" style={{ fontSize: 13.5 }}>{plate && !valid ? <span style={{ color: 'var(--danger)' }}>Placa incompleta ou inválida.</span> : 'Placas Mercosul (ABC1D23) e antigas (ABC-1234).'}</span>
            </div>
          </section>
          <section className="stack">
            <h2 style={{ fontSize: 18 }}>2. Tipo de consulta</h2>
            {loading && <div className="prod-list"><Skeleton h={84} r={16} /><Skeleton h={84} r={16} /></div>}
            {loadErr != null && <Alert tone="danger" title="Não foi possível carregar as consultas.">{errorMessage(loadErr)} <button className="btn btn-sm" onClick={reload}>Tentar de novo</button></Alert>}
            {data && !products.length && <div className="card"><EmptyState icon="tag" title="Nenhuma consulta disponível">Volte em instantes ou fale com o suporte.</EmptyState></div>}
            <div className="prod-list" role="radiogroup" aria-label="Tipo de consulta">
              {products.map((p) => {
                const off = p.commercialStatus !== 'ACTIVE';
                return (
                  <label key={p.id} className={`prod ${productId === p.id ? 'sel' : ''} ${off ? 'off' : ''}`}>
                    <input type="radio" name="product" checked={productId === p.id} disabled={off} onChange={() => setProductId(p.id)} />
                    <span><b>{p.name}{p.featured && <Badge tone="violet">Mais completa</Badge>}{off && <Badge>Em breve</Badge>}{p.negotiated && <Badge tone="ok">Preço negociado</Badge>}</b><p>{p.description}</p>{!!p.features?.length && <p style={{ marginTop: 4 }}>{p.features.slice(0, 4).join(' · ')}</p>}</span>
                    <span className="pr num">{money(p.priceCents)}</span>
                  </label>
                );
              })}
            </div>
          </section>
        </div>
        <aside className="card card-pad summary-card" aria-label="Resumo da consulta">
          <h2 style={{ fontSize: 18 }}>Resumo</h2>
          <div className="sum-line"><span className="muted">Placa</span><b className="mono">{plate ? formatPlate(plate) : '—'}</b></div>
          <div className="sum-line"><span className="muted">Consulta</span><b>{product?.name ?? '—'}</b></div>
          <div className="sum-line"><span className="muted">Valor</span><b className="num">{money(price)}</b></div>
          {quote && quote.discountCents > 0 && <div className="sum-line"><span className="muted">Cupom {quote.couponCode}</span><b className="num" style={{ color: 'var(--ok-ink)' }}>− {money(quote.discountCents)}</b></div>}
          <div className="sum-line total"><span>Total</span><span className="num">{money(due)}</span></div>
          <div className="sum-line"><span className="muted">Seu saldo</span><b className="num" style={{ color: enough ? 'var(--ok-ink)' : 'var(--warn-ink)' }}>{money(balance)}</b></div>
          {error && <Alert tone="danger">{error}</Alert>}
          {enough ? (
            <>
              <Button variant="primary" size="lg" block disabled={!can} onClick={runWallet} icon="search">Consultar agora · {money(price)}</Button>
              <Button variant="ghost" block disabled={!can} loading={busy === 'pay'} onClick={payDirect}>Prefiro pagar com Pix ou cartão</Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" block disabled={!can} loading={busy === 'pay'} onClick={payDirect} icon="credit-card">Pagar {money(due)} com Pix ou cartão</Button>
              <Link className="btn btn-block" to="/app/carteira">Adicionar saldo à carteira</Link>
              <p className="muted" style={{ fontSize: 13 }}>Seu saldo não cobre esta consulta. Pague direto ou recarregue a carteira.</p>
            </>
          )}
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 500, fontSize: 14 }}>Tenho um cupom</summary>
            <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}><Field label="Código do cupom" className="grow"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="CUPOM10" /></Field><Button size="sm" loading={busy === 'quote'} onClick={applyCoupon} style={{ alignSelf: 'end' }}>Aplicar</Button></div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>O cupom vale para pagamento direto (Pix/cartão).</p>
          </details>
          <p className="muted" style={{ fontSize: 12.5 }}><Icon name="lock" size={13} /> Pagamento seguro. Se a consulta falhar por problema técnico, o valor é estornado.</p>
        </aside>
      </div>
    </div>
  );
}
