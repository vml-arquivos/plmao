import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, Check, EmptyState, ErrorState, Field, Input, PageLoading, Textarea, useAsync, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, money, num } from '../../shared/format';
import { api } from '../api';

interface PubStore { name: string; slug: string; whatsapp: string | null; city: string | null; state: string | null; about: string; logoUrl: string | null; coverUrl: string | null; accentColor: string | null; instagram: string | null; address: string | null; hours: string | null }
const accentStyle = (s: PubStore) => (s.accentColor && /^#[0-9a-fA-F]{6}$/.test(s.accentColor) ? ({ '--primary': s.accentColor, '--primary-hover': s.accentColor, '--primary-ink': s.accentColor } as React.CSSProperties) : undefined);
interface PubVehicle { id: string; brand: string; model: string; version: string; yearManufacture: number | null; yearModel: number | null; color: string; fuel: string; transmission: string; mileageKm: number | null; priceCents: number; description: string; photos: string[]; reserved: boolean; verified: { code: string; consultedAt: string | null } | null }
const name = (v: PubVehicle) => [v.brand, v.model, v.version].filter(Boolean).join(' ');
const wa = (phone: string, text: string) => `https://wa.me/${phone.length <= 11 ? `55${phone}` : phone}?text=${encodeURIComponent(text)}`;
/** Link da simulação de financiamento já com o valor do veículo (entrada de 30%) e o nome dele. */
const simulateHref = (v: PubVehicle) => {
  const reais = Math.max(1000, Math.round(v.priceCents / 100));
  const entrada = Math.round((reais * 0.3) / 100) * 100;
  const p = new URLSearchParams({ v: String(reais), e: String(entrada), m: '48', c: 'USED', n: name(v).slice(0, 80) });
  return `/simulador/carro?${p.toString()}`;
};
/** Botão do WhatsApp que acompanha a pessoa na rolagem. */
function WaFloat({ phone, text }: { phone: string; text: string }) {
  return <a className="wa-float" href={wa(phone, text)} target="_blank" rel="noopener noreferrer" aria-label="Chamar a loja no WhatsApp"><Icon name="message-circle" size={26} /><span>WhatsApp</span></a>;
}
const safeImg = (u: string | undefined) => (u && (/^https:\/\//i.test(u) || /^\/api\/public\/store-photos\/[0-9a-f-]{36}$/i.test(u)) ? u : null);

function Cover({ v, className }: { v: PubVehicle; className?: string }) {
  const src = safeImg(v.photos[0]);
  return src ? <img className={className} src={src} alt={name(v)} loading="lazy" referrerPolicy="no-referrer" /> : <div className={`${className ?? ''} nophoto`}><Icon name="car" size={36} /></div>;
}

export function StorePage() {
  const { slug = '' } = useParams();
  const [q, setQ] = useState('');
  const d = useAsync(() => api.get<{ store: PubStore; vehicles: PubVehicle[] }>(`/public/stores/${encodeURIComponent(slug)}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`), [slug, q]);
  usePageTitle(d.data?.store.name ?? 'Loja');
  if (d.loading && !d.data) return <PageLoading />;
  if (d.error != null || !d.data) return <section className="section"><div className="container"><EmptyState icon="car" title="Loja não encontrada">O endereço não existe ou a vitrine está desligada.</EmptyState></div></section>;
  const { store, vehicles } = d.data;
  const place = [store.city, store.state].filter(Boolean).join(' - ');
  return (
    <section className="section" style={accentStyle(store)}>
      <div className="container stack-lg">
        {safeImg(store.coverUrl ?? undefined) && <img className="store-cover" src={safeImg(store.coverUrl ?? undefined)!} alt="" referrerPolicy="no-referrer" />}
        <header className="store-hero">
          <div className="row" style={{ flexWrap: 'nowrap', gap: 16, alignItems: 'flex-start' }}>
            {safeImg(store.logoUrl ?? undefined) && <img className="store-logo" src={safeImg(store.logoUrl ?? undefined)!} alt={`Logo ${store.name}`} referrerPolicy="no-referrer" />}
            <div><h1>{store.name}</h1>{place && <p className="muted"><Icon name="map-pin" size={16} /> {[store.address, place].filter(Boolean).join(' · ')}</p>}{store.hours && <p className="muted"><Icon name="clock" size={16} /> {store.hours}</p>}{store.about && <p style={{ maxWidth: '62ch' }}>{store.about}</p>}{store.instagram && <p><a href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noopener noreferrer">@{store.instagram}</a></p>}</div>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {store.whatsapp && <a className="btn btn-primary btn-lg" href={wa(store.whatsapp, `Olá! Vi a vitrine da ${store.name}.`)} target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>}
            <Link className="btn btn-lg" to="/simulador/carro">Simular financiamento</Link>
          </div>
        </header>
        <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar marca ou modelo" style={{ maxWidth: 360 }} />
        {!vehicles.length ? <EmptyState icon="car" title="Nenhum veículo no momento" /> : (
          <div className="vitrine-grid">
            {vehicles.map((v) => (
              <Link key={v.id} to={`/loja/${store.slug}/veiculo/${v.id}`} className="vcard">
                <Cover v={v} className="vcard-img" />
                <div className="vcard-body">
                  <b>{name(v)}</b>
                  <span className="muted">{[v.yearManufacture && v.yearModel ? `${v.yearManufacture}/${v.yearModel}` : v.yearModel, v.mileageKm != null ? `${num(v.mileageKm)} km` : '', v.transmission].filter(Boolean).join(' · ')}</span>
                  <div className="row-between"><span className="vprice">{money(v.priceCents)}</span><span className="row" style={{ gap: 6 }}>{v.reserved && <Badge tone="warn">Reservado</Badge>}{v.verified && <Badge tone="violet"><Icon name="shield-check" size={12} /> Verificado</Badge>}</span></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {store.whatsapp && <WaFloat phone={store.whatsapp} text={`Olá! Vi a vitrine da ${store.name}.`} />}
    </section>
  );
}

function ContactForm({ slug, vehicleId, label, preset }: { slug: string; vehicleId: string; label: string; preset?: { text: string; n: number } }) {
  const [f, setF] = useState({ name: '', phone: '', message: `Tenho interesse no ${label}.`, consent: false, website: '' });
  useEffect(() => { if (preset) setF((s) => ({ ...s, message: preset.text })); }, [preset]);
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post(`/public/stores/${encodeURIComponent(slug)}/leads`, { name: f.name, phone: f.phone, message: f.message, vehicleId, consent: true, website: f.website }); setDone(true); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  if (done) return <Alert tone="ok" icon="check-circle" title="Mensagem enviada">A loja vai entrar em contato.</Alert>;
  return (
    <form id="contato" className="card card-pad stack" onSubmit={(e) => void submit(e)}>
      <h3>Solicitar contato ou informações</h3>
      <Field label="Seu nome"><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} maxLength={80} required /></Field>
      <Field label="Telefone com DDD"><Input inputMode="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} placeholder="(11) 99999-9999" required /></Field>
      <Field label="Mensagem"><Textarea rows={3} value={f.message} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} maxLength={500} /></Field>
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}><label>Site<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF((s) => ({ ...s, website: e.target.value }))} /></label></div>
      <Check checked={f.consent} onChange={(e) => setF((s) => ({ ...s, consent: e.target.checked }))}>Aceito que a loja entre em contato comigo por este telefone. <Link to="/privacidade">Privacidade</Link></Check>
      {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      <Button variant="primary" type="submit" loading={busy} disabled={!f.consent || f.name.trim().length < 2 || digitsLen(f.phone) < 10}>Enviar</Button>
    </form>
  );
}
const digitsLen = (v: string) => v.replace(/\D/g, '').length;

export function StoreVehiclePage() {
  const { slug = '', id = '' } = useParams();
  const d = useAsync(() => api.get<{ store: PubStore; vehicle: PubVehicle }>(`/public/stores/${encodeURIComponent(slug)}/vehicles/${encodeURIComponent(id)}`), [slug, id]);
  const [photo, setPhoto] = useState(0);
  const [preset, setPreset] = useState<{ text: string; n: number } | undefined>();
  usePageTitle(d.data ? `${name(d.data.vehicle)} | ${d.data.store.name}` : 'Veículo');
  if (d.loading && !d.data) return <PageLoading />;
  if (d.error != null || !d.data) return <section className="section"><div className="container"><ErrorState error={d.error ?? new Error('Veículo não encontrado')} /><p><Link to={`/loja/${slug}`}>Voltar à loja</Link></p></div></section>;
  const { store, vehicle: v } = d.data;
  const goForm = (text: string) => { setPreset({ text, n: Date.now() }); setTimeout(() => document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const photos = v.photos.map(safeImg).filter((x): x is string => Boolean(x));
  const specs: Array<[string, string]> = ([['Ano', v.yearManufacture && v.yearModel ? `${v.yearManufacture}/${v.yearModel}` : v.yearModel ? String(v.yearModel) : ''], ['Km', v.mileageKm != null ? `${num(v.mileageKm)} km` : ''], ['Cor', v.color], ['Combustível', v.fuel], ['Câmbio', v.transmission]] as Array<[string, string]>).filter(([, x]) => x);
  return (
    <section className="section" style={accentStyle(store)}>
      <div className="container stack-lg">
        <Link to={`/loja/${store.slug}`} className="muted"><Icon name="arrow-left" size={16} /> {store.name}</Link>
        <div className="vdetail">
          <div className="stack">
            {photos.length ? <img className="vhero" src={photos[photo] ?? photos[0]} alt={name(v)} referrerPolicy="no-referrer" /> : <div className="vhero nophoto"><Icon name="car" size={48} /></div>}
            {photos.length > 1 && <div className="row" style={{ gap: 8 }}>{photos.map((p, i) => <button key={p} type="button" className={`vthumb${i === photo ? ' on' : ''}`} onClick={() => setPhoto(i)} aria-label={`Foto ${i + 1}`}><img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" /></button>)}</div>}
            {v.description && <p style={{ whiteSpace: 'pre-wrap' }}>{v.description}</p>}
          </div>
          <div className="stack">
            <div>
              <h1 style={{ fontSize: 'clamp(24px,3vw,32px)' }}>{name(v)}</h1>
              <div className="vprice" style={{ fontSize: 30 }}>{money(v.priceCents)}</div>
              {v.reserved && <Badge tone="warn">Reservado</Badge>}
            </div>
            {v.verified && (
              <div className="card card-pad row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                <Icon name="shield-check" size={26} />
                <div><b>Consulta verificada</b><div className="muted" style={{ fontSize: 13.5 }}>Consulta feita no Placa na Mão{v.verified.consultedAt ? ` em ${dateOnly(v.verified.consultedAt)}` : ''}. <Link to={`/validar/${v.verified.code}`}>Conferir autenticidade</Link></div></div>
              </div>
            )}
            <dl className="specs">{specs.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
            <div className="vcta">
              {store.whatsapp && <a className="btn btn-primary btn-lg" href={wa(store.whatsapp, `Olá! Tenho interesse no ${name(v)} (${money(v.priceCents)}).`)} target="_blank" rel="noopener noreferrer"><Icon name="message-circle" size={18} /> Chamar no WhatsApp</a>}
              <Link className="btn btn-lg" to={simulateHref(v)}><Icon name="calculator" size={18} /> Simular financiamento</Link>
              <div className="vcta-row">
                <button type="button" className="btn" onClick={() => goForm(`Gostaria de mais informações sobre o ${name(v)}: estado, documentação e condições de pagamento.`)}>Pedir informações</button>
                <button type="button" className="btn" onClick={() => goForm(`Peço que entrem em contato comigo sobre o ${name(v)}.`)}>Solicitar contato</button>
              </div>
            </div>
            <ContactForm slug={store.slug} vehicleId={v.id} label={name(v)} preset={preset} />
          </div>
        </div>
      </div>
      {store.whatsapp && <WaFloat phone={store.whatsapp} text={`Olá! Tenho interesse no ${name(v)} (${money(v.priceCents)}).`} />}
    </section>
  );
}
