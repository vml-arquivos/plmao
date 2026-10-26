import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, EmptyState, Field, Input, Skeleton, useAsync, usePageTitle } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { formatPlate, money } from '../../shared/format';
import { SEARCH_HINT, SEARCH_LABELS, SEARCH_PLACEHOLDER, SEARCH_SHORT, SEARCH_TYPES, cleanSearchInput, formatDocument, isValidSearch, type SearchType } from '../../shared/searchKey';
import { api, type Catalog } from '../api';
import { useSession } from '../session';
import { storedReferral, trackFunnel } from '../funnel';
import PaidQueries from '../components/PaidQueries';
import PurchaseContract from '../components/PurchaseContract';

interface QProduct { id: string; name: string; description: string; priceCents: number; basePriceCents: number; negotiated: boolean; features: string[] | null; isFree: boolean; featured: boolean; commercialStatus: string }
interface Quote { amountCents: number; subtotalCents: number; discountCents: number; couponCode: string | null; paymentProviderConfigured: boolean; free?: boolean }

const STEPS = ['Validando a placa', 'Consultando a fonte de dados', 'Montando o relatório'];

export default function NewQuery() {
  usePageTitle('Nova consulta');
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { me, setBalance, refresh } = useSession();
  const startType = (SEARCH_TYPES as string[]).includes(params.get('tipo') ?? '') ? params.get('tipo') as SearchType : 'PLATE';
  const [kind, setKind] = useState<SearchType>(startType);
  const [plate, setPlate] = useState(cleanSearchInput(startType, params.get('valor') ?? params.get('placa') ?? ''));
  const types = useAsync(async () => api.get<{ types: Array<{ id: SearchType; available: boolean }> }>('/search-types').then((r) => r.types).catch(() => null), []);
  const available = (id: SearchType) => id === 'PLATE' || !types.data || Boolean(types.data.find((t) => t.id === id)?.available);
  const [productId, setProductId] = useState(params.get('produto') ?? '');
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'wallet' | 'pay' | 'quote'>('');
  const [step, setStep] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [wantDirect, setWantDirect] = useState(false);
  const idem = useRef<string>('');
  const { data, error: loadErr, loading, reload } = useAsync(async () => {
    const [products, catalog] = await Promise.all([api.get<QProduct[]>('/query-products'), api.get<Catalog>('/catalog').catch(() => null)]);
    const status = new Map((catalog?.products ?? []).map((p) => [p.id, p.commercialStatus]));
    return products.filter((p) => !p.isFree).map((p) => ({ ...p, commercialStatus: status.get(p.id) ?? p.commercialStatus }));
  }, []);

  const products = data ?? [];
  const sellable = products.filter((p) => p.commercialStatus === 'ACTIVE');
  useEffect(() => { if (!productId && sellable.length) setProductId((sellable.find((p) => p.featured) ?? sellable[0]).id); }, [sellable, productId]);
  const product = products.find((p) => p.id === productId);
  const price = product?.priceCents ?? 0;
  const balance = me?.balanceCents ?? 0;
  const enough = balance >= price;
  const valid = isValidSearch(kind, plate);
  const searchBody = { searchType: kind, searchValue: plate };
  const shownKey = kind === 'PLATE' ? formatPlate(plate) : kind === 'OWNER_DOC' ? formatDocument(plate) : plate;
  const due = quote ? quote.amountCents : price;
  useEffect(() => { setQuote(null); }, [productId, plate, kind]);
  useEffect(() => { if (busy !== 'wallet') return; const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600); return () => clearInterval(t); }, [busy]);

  const can = useMemo(() => valid && available(kind) && Boolean(product) && product?.commercialStatus === 'ACTIVE', [valid, product, kind, types.data]);

  async function applyCoupon() {
    if (!product || coupon.trim().length < 3) return;
    setBusy('quote'); setError('');
    try { const q = await api.post<Quote>('/payments/query/quote', { productId: product.id, ...searchBody, couponCode: coupon.trim() }); setQuote(q); }
    catch (e) { setQuote(null); setError(errorMessage(e)); } finally { setBusy(''); }
  }

  async function runWallet() {
    if (!can || !product) return;
    setBusy('wallet'); setStep(0); setError('');
    idem.current ||= crypto.randomUUID();
    trackFunnel('CTA_CLICKED', { placement: 'new_query_wallet', productId: product.id });
    try {
      const r = await api.post<{ id: string }>('/queries', { ...searchBody, productId: product.id }, { headers: { 'Idempotency-Key': idem.current } });
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
    if (!accepted) { setError('Marque a caixa “Li e aceito o contrato” para continuar.'); return; }
    setBusy('pay'); setError('');
    trackFunnel('CHECKOUT_STARTED', { productId: product.id, amountCents: due, hasCoupon: Boolean(quote?.couponCode) });
    try {
      const ref = storedReferral();
      const r = await api.post<{ checkoutUrl: string | null; free?: boolean; orderId: string }>('/payments/query/checkout', { productId: product.id, ...searchBody, acceptContract: true, ...(coupon.trim() && quote?.couponCode ? { couponCode: coupon.trim() } : {}), ...(ref ? { affiliateCode: ref } : {}) });
      if (r.free) {
        // Cupom de 100%: sem pagamento. Executa a consulta liberada pelo pedido.
        try {
          const q = await api.post<{ id: string }>('/queries', { ...searchBody, productId: product.id, paymentOrderId: r.orderId });
          void refresh();
          nav(`/app/consulta/${q.id}`);
        } catch (e) { setError(errorMessage(e) + ' A consulta grátis continua liberada no topo desta página.'); setBusy(''); }
        return;
      }
      if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
    } catch (e) { setError(errorMessage(e)); setBusy(''); }
  }

  if (busy === 'wallet') {
    return (
      <div className="card card-pad" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }} role="status" aria-live="polite">
        <div style={{ display: 'grid', placeItems: 'center', gap: 18 }}>
          {kind === 'PLATE' ? <span className="plate lg"><b>{formatPlate(plate).replace('-', '')}</b></span> : <b className="mono" style={{ fontSize: 20 }}>{shownKey}</b>}
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
            <h2 style={{ fontSize: 18 }}>1. O que você quer consultar</h2>
            <div className="tabs" role="tablist" aria-label="Tipo de busca" style={{ flexWrap: 'wrap' }}>
              {SEARCH_TYPES.map((id) => (
                <button key={id} role="tab" type="button" className="tab" aria-selected={kind === id} disabled={!available(id)} title={available(id) ? undefined : 'Em breve nesta fonte de dados'}
                  onClick={() => { setKind(id); setPlate(''); setError(''); }}>{SEARCH_SHORT[id]}{!available(id) && <small style={{ marginLeft: 6, opacity: 0.7 }}>em breve</small>}</button>
              ))}
            </div>
            {kind === 'PLATE' ? (
              <div className="plate-input-wrap">
                <div className="plate-input"><input value={plate} onChange={(e) => setPlate(cleanSearchInput('PLATE', e.target.value))} placeholder="ABC1D23" aria-label="Placa do veículo" maxLength={8} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus={!plate} /></div>
                <span className="muted" style={{ fontSize: 13.5 }}>{plate && !valid ? <span style={{ color: 'var(--danger)' }}>Placa incompleta ou inválida.</span> : SEARCH_HINT.PLATE}</span>
              </div>
            ) : (
              <div className="stack-sm">
                <Field label={SEARCH_LABELS[kind]}><Input value={kind === 'OWNER_DOC' ? formatDocument(plate) : plate} onChange={(e) => setPlate(cleanSearchInput(kind, e.target.value))} placeholder={SEARCH_PLACEHOLDER[kind]} aria-label={SEARCH_LABELS[kind]} inputMode={kind === 'CHASSIS' ? 'text' : 'numeric'} autoComplete="off" spellCheck={false} autoFocus /></Field>
                <span className="muted" style={{ fontSize: 13.5 }}>{plate.length >= 8 && !valid ? <span style={{ color: 'var(--danger)' }}>{SEARCH_LABELS[kind]} incompleto ou inválido.</span> : SEARCH_HINT[kind]}</span>
              </div>
            )}
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
          <div className="sum-line"><span className="muted">{SEARCH_SHORT[kind]}</span><b className="mono">{plate ? shownKey : '—'}</b></div>
          <div className="sum-line"><span className="muted">Consulta</span><b>{product?.name ?? '—'}</b></div>
          <div className="sum-line"><span className="muted">Valor</span><b className="num">{money(price)}</b></div>
          {quote && quote.discountCents > 0 && <div className="sum-line"><span className="muted">Cupom {quote.couponCode}</span><b className="num" style={{ color: 'var(--ok-ink)' }}>− {money(quote.discountCents)}</b></div>}
          <div className="sum-line total"><span>Total</span><span className="num">{money(due)}</span></div>
          <div className="sum-line"><span className="muted">Seu saldo</span><b className="num" style={{ color: enough ? 'var(--ok-ink)' : 'var(--warn-ink)' }}>{money(balance)}</b></div>
          {error && <Alert tone="danger">{error}</Alert>}
{(quote?.free || !enough || wantDirect) && (
                      <PurchaseContract body={{ productId: product?.id, ...searchBody, ...(coupon.trim() && quote?.couponCode ? { couponCode: coupon.trim() } : {}), ...(storedReferral() ? { affiliateCode: storedReferral() } : {}) }} accepted={accepted} onChange={setAccepted} disabled={!can || !product} />
          )}
          {quote?.free ? (
            <Button variant="primary" size="lg" block disabled={!can || !accepted} loading={busy === 'pay'} onClick={payDirect} icon="search">Consultar grátis</Button>
          ) : enough ? (
            <>
              <Button variant="primary" size="lg" block disabled={!can} onClick={runWallet} icon="search">Consultar agora · {money(price)}</Button>
              <Button variant="ghost" block disabled={!can || (wantDirect && !accepted)} loading={busy === 'pay'} onClick={() => { if (!wantDirect) { setWantDirect(true); return; } void payDirect(); }}>{wantDirect ? `Pagar ${money(due)} com Pix ou cartão` : 'Prefiro pagar com Pix ou cartão'}</Button>
            </>
          ) : (
            <>
              <Button variant="primary" size="lg" block disabled={!can || !accepted} loading={busy === 'pay'} onClick={payDirect} icon="credit-card">Pagar {money(due)} com Pix ou cartão</Button>
              <Link className="btn btn-block" to="/app/carteira">Adicionar saldo à carteira</Link>
              <p className="muted" style={{ fontSize: 13 }}>Seu saldo não cobre esta consulta. Pague direto ou recarregue a carteira.</p>
            </>
          )}
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: 500, fontSize: 14 }}>Tenho um cupom</summary>
            <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}><Field label="Código do cupom" className="grow"><Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="CUPOM10" /></Field><Button size="sm" loading={busy === 'quote'} onClick={applyCoupon} style={{ alignSelf: 'end' }}>Aplicar</Button></div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>O cupom vale para pagamento direto. Cupom de 100% libera a consulta grátis.</p>
          </details>
          <p className="muted" style={{ fontSize: 12.5 }}><Icon name="lock" size={13} /> Pagamento seguro. Se a consulta falhar por problema técnico, o valor é estornado.</p>
        </aside>
      </div>
    </div>
  );
}
