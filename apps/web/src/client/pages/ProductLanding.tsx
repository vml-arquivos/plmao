import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { LinkButton, usePageTitle } from '../../shared/ui';
import { money, isValidPlate, normalizePlate } from '../../shared/format';
import { useSession } from '../session';
import { trackFunnel } from '../funnel';
import { LANDING_BY_SLUG, type LandingContent } from '../content/landingPages';
import { useCatalog, useFreeOffers } from '../components/Catalog';
import { DetailsButton, PdfModelLink } from '../components/ConsultaDetails';
import SeoContent, { SeoH1 } from '../components/SeoContent';

const TRUST: Array<{ icon: 'tag' | 'shield-check' | 'file-text' | 'refresh'; t: string }> = [
  { icon: 'tag', t: 'Sem mensalidade' },
  { icon: 'shield-check', t: 'Pagamento por Pix ou cartão' },
  { icon: 'refresh', t: 'Se a consulta falhar, o valor volta para o seu saldo' },
  { icon: 'file-text', t: 'PDF com código de validação' }
];

const STEPS = [
  { t: 'Digite a placa', s: 'Placa antiga ou Mercosul. Sem Renavam.' },
  { t: 'Crie sua conta grátis', s: 'Leva um minuto. Se já tem conta, é só entrar.' },
  { t: 'Pague e veja o relatório', s: 'Pix ou cartão, ou use o seu saldo. O PDF fica no seu histórico.' }
];

/** Campo da placa da landing: leva direto para a consulta deste produto. */
function ProductPlate({ c, authed, placement, label, disabled }: { c: LandingContent; authed: boolean; placement: string; label: string; disabled?: boolean }) {
  const nav = useNavigate();
  const errId = `lp-err-${useId().replace(/:/g, '')}`;
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const p = normalizePlate(plate);
    if (!isValidPlate(p)) { setError('Informe uma placa válida, por exemplo ABC1D23 ou ABC-1234.'); return; }
    trackFunnel('PLATE_CAPTURED', { placement, landing: c.path, product: c.productId, plateFormat: /^[A-Z]{3}[0-9]{4}$/.test(p) ? 'antiga' : 'mercosul', authenticated: authed });
    const dest = `/app/consultar?placa=${p}&produto=${encodeURIComponent(c.productId)}`;
    nav(authed ? dest : `/criar-conta?next=${encodeURIComponent(dest)}`);
  }
  return (
    <form className="lp-plate" onSubmit={submit} noValidate aria-label={`Consultar placa: ${c.short}`}>
      <label className="lp-plate-input">
        <Icon name="car" size={24} /><span className="sr-only">Placa do veículo</span>
        <input value={plate} onChange={(e) => { setPlate(normalizePlate(e.target.value)); setError(''); }} placeholder="Digite a placa (ex: ABC1D23)" inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} aria-invalid={Boolean(error)} aria-describedby={errId} />
      </label>
      <p id={errId} className="lp-plate-err" role="alert">{error}</p>
      <button type="submit" className="btn btn-primary btn-lg lp-big" disabled={disabled}>{label}<Icon name="arrow-right" size={20} /></button>
    </form>
  );
}

/** Barra fixa no celular: aparece depois do topo e some quando o campo final está na tela. */
function StickyBar({ label, price }: { label: string; price: string | null }) {
  const [heroIn, setHeroIn] = useState(true);
  const [endIn, setEndIn] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const hero = document.getElementById('lp-hero');
    const end = document.getElementById('lp-final');
    const a = new IntersectionObserver(([e]) => setHeroIn(Boolean(e?.isIntersecting)));
    const b = new IntersectionObserver(([e]) => setEndIn(Boolean(e && (e.isIntersecting || e.boundingClientRect.top < 0))));
    if (hero) a.observe(hero); else setHeroIn(false);
    if (end) b.observe(end);
    return () => { a.disconnect(); b.disconnect(); };
  }, []);
  const show = !heroIn && !endIn;
  useEffect(() => {
    const root = document.documentElement;
    if (show) root.setAttribute('data-sticky-cta', ''); else root.removeAttribute('data-sticky-cta');
    return () => root.removeAttribute('data-sticky-cta');
  }, [show]);
  function go() {
    document.getElementById('lp-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('#lp-hero .lp-plate input')?.focus({ preventScroll: true }), 450);
  }
  return (
    <div className={`sticky-cta${show ? ' on' : ''}`} aria-hidden={!show}>
      <button type="button" className="btn btn-primary btn-lg" onClick={go} tabIndex={show ? 0 : -1}><Icon name="search" size={19} /> {label}{price ? <small>{price}</small> : null}</button>
    </div>
  );
}

export function ProductLandingPage({ slug }: { slug: string }) {
  const c = LANDING_BY_SLUG.get(slug)!;
  const { status, me } = useSession();
  const authed = status === 'authed';
  const { data } = useCatalog();
  const offers = useFreeOffers();
  usePageTitle(c.h1);
  useEffect(() => { trackFunnel('SEO_PAGE_VIEW', { landing: c.path, product: c.productId }); }, [c.path, c.productId]);

  const product = data?.products.find((p) => p.id === c.productId);
  const soon = Boolean(product && product.commercialStatus !== 'ACTIVE');
  const price = product && product.priceCents > 0 ? money(product.priceCents) : null;
  const was = product?.listPriceCents && product.priceCents && product.listPriceCents > product.priceCents ? money(product.listPriceCents) : null;
  const firstFree = c.productId === 'CADASTRAL' && offers.cadastral && (!authed || me?.freeCadastralAvailable === true);
  const label = soon ? 'Em breve' : firstFree ? 'Fazer a primeira consulta grátis' : price ? `${c.cta} por ${price}` : c.cta;
  const others = c.next.map((s) => LANDING_BY_SLUG.get(s)!).filter(Boolean);
  const priceOf = (id: string) => { const p = data?.products.find((x) => x.id === id); return p && p.priceCents > 0 ? money(p.priceCents) : null; };

  return (
    <>
      <section className="lp-hero" id="lp-hero" aria-labelledby="lp-h1">
        <div className="container lp-hero-grid">
          <div className="lp-copy">
            <span className="eyebrow">{c.kicker}</span>
            <SeoH1 path={c.path} fallback={c.h1} id="lp-h1" />
            <p className="lp-lead">{c.lead}</p>
            <ul className="lp-points">{c.points.map((t) => <li key={t}><Icon name="check-circle" size={20} />{t}</li>)}</ul>
            <ProductPlate c={c} authed={authed} placement="landing_hero" label={label} disabled={soon} />
            {firstFree && <p className="lp-free"><Icon name="sparkles" size={16} />A primeira consulta cadastral de cada conta é grátis.</p>}
            <ul className="lp-trust">{TRUST.map((t) => <li key={t.t}><Icon name={t.icon} size={16} />{t.t}</li>)}</ul>
          </div>
          <aside className="lp-card" aria-label="Preço e relatório">
            {product?.badge && <span className="pbadge" style={{ position: 'static', alignSelf: 'flex-start' }}>{product.badge}</span>}
            <h2>{product?.name ?? c.short}</h2>
            {price ? (
              <div className="lp-price">
                {was && <span className="was">de {was}</span>}
                <span className="now num">{firstFree ? 'Grátis' : price}<small>{firstFree ? 'na primeira consulta' : 'por consulta'}</small></span>
                {firstFree && <span className="lp-then">Depois, {price} por consulta.</span>}
              </div>
            ) : <div className="lp-price"><span className="now muted">Preço antes de pagar</span></div>}
            <ul className="lp-card-list">{c.gets.slice(0, 4).map((t) => <li key={t}><Icon name="check" size={16} />{t}</li>)}</ul>
            <div className="lp-card-actions">
              <PdfModelLink id={c.productId} className="btn btn-block">Ver modelo do PDF</PdfModelLink>
              <DetailsButton initial={c.productId} className="linkbtn center" icon={false}>Comparar com as outras consultas</DetailsButton>
            </div>
          </aside>
        </div>
      </section>

      <section className="section" aria-labelledby="lp-pains">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2 id="lp-pains">{c.painsTitle}.</h2></div>
          <div className="why-grid lp-pains">
            {c.pains.map((p) => <div className="why-card" key={p.t}><span className="wi"><Icon name="alert-triangle" size={22} /></span><h3>{p.t}</h3><p>{p.s}</p></div>)}
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="lp-gets">
        <div className="container lp-split">
          <div>
            <h2 id="lp-gets">O que você recebe.</h2>
            <ul className="checklist">{c.gets.map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} /></span>{t}</li>)}</ul>
            <div className="row" style={{ marginTop: 22 }}>
              <DetailsButton initial={c.productId} className="btn" icon={false}>Ver tudo que está incluso</DetailsButton>
              <PdfModelLink id={c.productId} className="linkbtn">Ver modelo do PDF</PdfModelLink>
            </div>
          </div>
          <div className="lp-not">
            <h3>O que esta consulta não mostra</h3>
            <ul>{c.notGet.map((t) => <li key={t}><Icon name="x" size={16} />{t}</li>)}</ul>
            <p className="muted">O relatório mostra o que as fontes retornam. “Não informado” não quer dizer “nada consta”. Ele não substitui a vistoria.</p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="lp-steps">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2 id="lp-steps">Como fazer.</h2></div>
          <ol className="lp-steps">{STEPS.map((s, i) => <li key={s.t}><span className="n">{i + 1}</span><b>{s.t}</b><span>{s.s}</span></li>)}</ol>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-lg" disabled={soon} onClick={() => { trackFunnel('CTA_CLICKED', { placement: 'landing_steps', landing: c.path, product: c.productId }); document.getElementById('lp-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.setTimeout(() => document.querySelector<HTMLInputElement>('#lp-hero .lp-plate input')?.focus({ preventScroll: true }), 450); }}>{label}<Icon name="arrow-right" size={20} /></button>
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="lp-for">
        <div className="container lp-split">
          <div>
            <h2 id="lp-for">Para quem é.</h2>
            <ul className="checklist">{c.forWho.map((t) => <li key={t}><span className="ck"><Icon name="check" size={14} /></span>{t}</li>)}</ul>
          </div>
          <div className="lp-free-fipe card card-pad">
            <span className="eyebrow">Grátis</span>
            <h3>Quer só o valor do veículo?</h3>
            <p className="muted">Consulte a Tabela FIPE pela placa, de graça. Já vêm alguns dados do veículo. Para ver e baixar, crie sua conta grátis.</p>
            <LinkButton to={authed ? '/app/fipe' : '/fipe'} variant="primary" iconRight="arrow-right" onClick={() => trackFunnel('CTA_CLICKED', { placement: 'landing_free_fipe', landing: c.path })}>Consultar FIPE grátis</LinkButton>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="lp-next">
        <div className="container stack-lg">
          <div className="section-head center" style={{ marginBottom: 0 }}><h2 id="lp-next">{c.nextLead}</h2></div>
          <div className="lp-next">
            {others.map((o) => (
              <Link key={o.slug} to={o.path} className="lp-next-card" onClick={() => trackFunnel('CTA_CLICKED', { placement: 'landing_next', landing: c.path, target: o.path })}>
                <span className="eyebrow">{o.kicker}</span>
                <b>{o.h1}</b>
                <span className="muted">{o.points[0]}</span>
                <span className="lp-next-go">{priceOf(o.productId) ? `${priceOf(o.productId)} · ` : ''}Ver esta consulta <Icon name="arrow-right" size={16} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <SeoContent path={c.path} faqTitle={`Perguntas sobre a consulta ${c.short.toLowerCase()}`} />

      <section className="section" id="lp-final" aria-labelledby="lp-final-t">
        <div className="container">
          <div className="lp-final">
            <div>
              <h2 id="lp-final-t">Consulte a placa antes de fechar negócio.</h2>
              <p>{firstFree ? 'A primeira consulta cadastral é grátis ao criar a conta.' : price ? `${c.short} por ${price}. Sem mensalidade.` : 'Sem mensalidade. O preço aparece antes de pagar.'}</p>
            </div>
            <ProductPlate c={c} authed={authed} placement="landing_final" label={label} disabled={soon} />
          </div>
        </div>
      </section>
      <StickyBar label={firstFree ? 'Consulta grátis' : `Consultar ${c.short.toLowerCase()}`} price={firstFree ? null : price} />
    </>
  );
}

export default ProductLandingPage;
