import { useEffect, useState } from 'react';
import { Icon } from '../../shared/icons';
import { Alert, Button, CopyField, ErrorState, Field, Input, PageLoading, Stat, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, money } from '../../shared/format';
import { api } from '../api';

interface Affiliate { id: string; name: string; email: string; code: string; commissionBps: number; active: boolean }
interface Stats { monthly?: Array<{ month: string; payments: number; cents: number }>; affiliate: { id: string; code: string } | null; shareUrl?: string; links?: Array<{ key: string; label: string; url: string }>; performance?: { clicks30d: number; paidPayments: number; reversedCommissions: number }; totals: { commissions: number; pendingCents: number; paidCents: number; referredUsers?: number } }

function LinkQr({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let alive = true; import('qrcode').then((m) => m.default.toDataURL(url, { margin: 2, width: 360, errorCorrectionLevel: 'M' })).then((d) => { if (alive) setSrc(d); }, () => { if (alive) setSrc(''); }); return () => { alive = false; }; }, [url]);
  if (!src) return null;
  return (
    <div className="stack" style={{ alignItems: 'start' }}>
      <img src={src} alt="QR code do link selecionado" width={180} height={180} style={{ borderRadius: 12, border: '1px solid var(--border)' }} />
      <a className="btn" style={{ alignSelf: 'start' }} href={src} download={`${name}.png`}><Icon name="download" size={16} /> Baixar QR code</a>
    </div>
  );
}

export default function Partner() {
  usePageTitle('Parceiro');
  const toast = useToast();
  const me = useAsync(() => api.get<{ affiliate: Affiliate | null }>('/affiliate/me'), []);
  const stats = useAsync(() => api.get<Stats>('/affiliate/stats'), []);
  const [code, setCode] = useState('');
  const [linkKey, setLinkKey] = useState('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (me.loading && !me.data) return <PageLoading />;
  if (me.error != null) return <ErrorState error={me.error} onRetry={me.reload} />;
  const aff = me.data?.affiliate;

  async function activate() {
    setBusy(true); setError('');
    try { await api.post('/affiliate/activate', code.trim() ? { code: code.trim() } : {}); toast.ok('Programa de parceiros ativado!'); me.reload(); stats.reload(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!aff) {
    return (
      <div className="stack-lg">
        <div className="page-head"><div><h1>Parceiros</h1></div></div>
        <section className="card card-pad stack" style={{ maxWidth: 640 }}>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            {[['link', 'Compartilhe seu link', 'Cada pessoa que se cadastrar pelo seu link fica vinculada a você.'], ['dollar', 'Ganhe comissão', 'Receba um percentual sobre cada pagamento confirmado dos indicados.'], ['wallet', 'Receba o repasse', 'As comissões são liberadas após o prazo de segurança e repassadas pela equipe.']].map(([i, t, s]) => <div key={t} className="stack-sm"><span className="wi" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary-ink)', display: 'grid', placeItems: 'center' }}><Icon name={i as 'link'} /></span><b>{t}</b><span className="muted" style={{ fontSize: 14 }}>{s}</span></div>)}
          </div>
          <Field label="Código personalizado (opcional)" hint="Letras, números, hífen ou sublinhado. Se deixar em branco, geramos um para você."><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={40} placeholder="MEUCODIGO" /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div><Button variant="primary" size="lg" loading={busy} onClick={activate} icon="sparkles">Quero ser parceiro</Button></div>
        </section>
      </div>
    );
  }

  const t = stats.data?.totals;
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Parceiros</h1><p>Comissão de <b>{bpsToPercent(aff.commissionBps)}</b> por pagamento confirmado.</p></div></div>
      {!aff.active && <Alert tone="warn" title="Seu cadastro de parceiro está inativo.">Fale com o suporte para reativar.</Alert>}
      <div className="stat-grid">
        <Stat label="Visitas (30 dias)" value={stats.data?.performance?.clicks30d ?? 0} sub="pessoas que chegaram pelo seu link" />
        <Stat label="Indicados" value={t?.referredUsers ?? 0} sub="cadastros pelo seu link" />
        <Stat label="Pagamentos" value={stats.data?.performance?.paidPayments ?? 0} sub={(stats.data?.performance?.reversedCommissions ?? 0) > 0 ? `${stats.data?.performance?.reversedCommissions} estornado(s) ou cancelado(s)` : 'confirmados'} />
        <Stat label="A receber" value={money(t?.pendingCents ?? 0)} sub="em liberação ou liberadas" />
        <Stat highlight label="Já pago" value={money(t?.paidCents ?? 0)} sub="repassado a você" />
      </div>
      <section className="card card-pad stack">
        <h2 style={{ fontSize: 18 }}>Seu código</h2>
        {!stats.data?.links?.length && <CopyField value={stats.data?.shareUrl ?? `${window.location.origin}/?ref=${aff.code}`} label="Link de indicação" />}
        <p className="muted" style={{ fontSize: 14 }}>Código <b className="mono">{aff.code}</b></p>
      </section>
      {stats.data?.monthly && stats.data.monthly.length > 0 && (
        <section className="card card-pad stack">
          <h2 style={{ fontSize: 18 }}>Por mês</h2>
          <div className="table-wrap"><table className="table"><thead><tr><th>Mês</th><th className="r">Pagamentos</th><th className="r">Comissão</th></tr></thead><tbody>
            {stats.data.monthly.map((m) => <tr key={m.month}><td>{m.month.slice(5)}/{m.month.slice(0, 4)}</td><td className="r num">{m.payments}</td><td className="r num">{money(m.cents)}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
      {stats.data?.links && stats.data.links.length > 0 && (() => {
        const cur = stats.data.links.find((l) => l.key === linkKey) ?? stats.data.links[0]!;
        return (
          <section className="card card-pad stack">
            <h2 style={{ fontSize: 18 }}>Links por destino e QR code</h2>
                        <Field label="Destino">
              <select className="input" value={cur.key} onChange={(e) => setLinkKey(e.target.value)} aria-label="Destino do link">
                {stats.data.links.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </Field>
            <CopyField value={cur.url} label={`Link: ${cur.label}`} />
            <LinkQr url={cur.url} name={`placa-na-mao-${cur.key}`} />
          </section>
        );
      })()}
      <Alert tone="info" title="Como funciona o repasse.">As comissões ficam em análise por alguns dias após o pagamento (proteção contra estorno). Depois disso, a equipe agrupa e repassa os valores. Em caso de estorno do pagamento, a comissão correspondente é revertida.</Alert>
    </div>
  );
}
