import { useEffect, useState } from 'react';
import { Icon } from '../../shared/icons';
import { PIX_TYPE_LABEL, PixFields, emptyPix, pixProblem, type PixData, type PixType } from '../components/CustomerFields';
import { Alert, Badge, Button, CopyField, EmptyState, ErrorState, Field, Input, PageLoading, Stat, Tabs, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, dateOnly, money } from '../../shared/format';
import { api } from '../api';

interface Affiliate { id: string; name: string; email: string; code: string; commissionBps: number; active: boolean }
interface Stats { monthly?: Array<{ month: string; payments: number; cents: number }>; affiliate: { id: string; code: string } | null; shareUrl?: string; links?: Array<{ key: string; label: string; url: string }>; performance?: { clicks30d: number; paidPayments: number; reversedCommissions: number }; totals: { commissions: number; pendingCents: number; paidCents: number; referredUsers?: number } }

interface Panel {
  pix?: { set: boolean; type: string | null; masked: string | null };
  affiliate: { code: string; commissionBps: number; partnerType: string; active: boolean } | null;
  totals: { revenueCents: number; salesCount: number; clientsCount: number; queriesCount: number; earnedCents: number; pendingCents: number; availableCents: number; inPayoutCents: number; paidCents: number; clawbackDueCents: number; reversedCount: number };
  clients: Array<{ id: string; name: string; email: string; joinedAt: string; queries: number; spentCents: number }>;
  queries: Array<{ id: string; date: string; product: string; plate: string; status: string; customer: string }>;
  sales: Array<{ id: string; date: string; product: string; customer: string; orderCents: number | null; commissionCents: number; rateBps: number; status: string; availableAt: string | null; paidAt: string | null }>;
  payouts: Array<{ id: string; amountCents: number; status: string; requestedAt: string; paidAt: string | null }>;
}
const C_STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = { PENDING: { l: 'Em liberação', t: 'warn' }, AVAILABLE: { l: 'Disponível', t: 'ok' }, PAID: { l: 'Paga', t: 'info' }, REVERSED: { l: 'Estornada', t: 'neutral' }, CANCELLED: { l: 'Cancelada', t: 'neutral' }, CLAWBACK_DUE: { l: 'A devolver', t: 'danger' } };
const P_STATUS: Record<string, { l: string; t: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = { REQUESTED: { l: 'Solicitado', t: 'warn' }, APPROVED: { l: 'Aprovado', t: 'info' }, PAID: { l: 'Pago', t: 'ok' }, REJECTED: { l: 'Rejeitado', t: 'danger' }, CANCELLED: { l: 'Cancelado', t: 'neutral' } };
const Q_STATUS: Record<string, string> = { SUCCESS: 'Concluída', PROCESSING: 'Em andamento', FAILED: 'Não concluída', REFUNDED: 'Estornada' };

function PartnerPanel({ panel }: { panel: Panel }) {
  const [tab, setTab] = useState<'sales' | 'clients' | 'queries' | 'payouts'>('sales');
  const t = panel.totals;
  return (
    <section className="stack">
      <div className="stat-grid">
        <Stat highlight label="Receita gerada" value={money(t.revenueCents)} sub={`${t.salesCount} ${t.salesCount === 1 ? 'venda paga' : 'vendas pagas'} dos seus indicados`} />
        <Stat label="Comissão total" value={money(t.earnedCents)} sub="pendente, disponível e paga" />
        <Stat label="Disponível" value={money(t.availableCents)} sub="pronta para repasse" />
        <Stat label="Em liberação" value={money(t.pendingCents)} sub="aguardando a carência" />
        <Stat label="Já pago" value={money(t.paidCents)} sub="repassado a você" />
        <Stat label="Clientes" value={t.clientsCount} sub={`${t.queriesCount} consultas feitas`} />
      </div>
      <Tabs label="Detalhes" value={tab} onChange={setTab} items={[{ id: 'sales', label: 'Vendas e comissões' }, { id: 'clients', label: 'Clientes' }, { id: 'queries', label: 'Consultas' }, { id: 'payouts', label: 'Repasses' }]} />
      {tab === 'sales' && (panel.sales.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Cliente</th><th>Produto</th><th className="r">Venda</th><th className="r">Comissão</th><th>Situação</th></tr></thead><tbody>
        {panel.sales.map((r) => <tr key={r.id}><td>{dateOnly(r.date)}</td><td>{r.customer || '—'}</td><td>{r.product}</td><td className="r num">{r.orderCents == null ? '—' : money(r.orderCents)}</td><td className="r num"><b>{money(r.commissionCents)}</b><div className="muted" style={{ fontSize: 12 }}>{bpsToPercent(r.rateBps)}</div></td><td><Badge tone={(C_STATUS[r.status] ?? { t: 'neutral' }).t}>{(C_STATUS[r.status] ?? { l: r.status }).l}</Badge>{r.status === 'PENDING' && r.availableAt && <div className="muted" style={{ fontSize: 12 }}>libera em {dateOnly(r.availableAt)}</div>}</td></tr>)}
      </tbody></table></div> : <EmptyState icon="dollar" title="Ainda não há vendas">Quando alguém que você indicou pagar, a venda e a comissão aparecem aqui.</EmptyState>)}
      {tab === 'clients' && (panel.clients.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th>E-mail</th><th>Cadastro</th><th className="r">Consultas</th><th className="r">Já comprou</th></tr></thead><tbody>
        {panel.clients.map((r) => <tr key={r.id}><td>{r.name || '—'}</td><td className="mono">{r.email}</td><td>{dateOnly(r.joinedAt)}</td><td className="r num">{r.queries}</td><td className="r num">{money(r.spentCents)}</td></tr>)}
      </tbody></table></div> : <EmptyState icon="users" title="Nenhum cliente ainda">Quem criar conta pelo seu link ou código aparece aqui.</EmptyState>)}
      {tab === 'queries' && (panel.queries.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Data</th><th>Cliente</th><th>Consulta</th><th>Placa</th><th>Situação</th></tr></thead><tbody>
        {panel.queries.map((r) => <tr key={r.id}><td>{dateOnly(r.date)}</td><td>{r.customer || '—'}</td><td>{r.product}</td><td className="mono">{r.plate}</td><td>{Q_STATUS[r.status] ?? r.status}</td></tr>)}
      </tbody></table></div> : <EmptyState icon="search" title="Nenhuma consulta ainda">As consultas feitas pelos seus clientes aparecem aqui, com a placa parcialmente oculta.</EmptyState>)}
      {tab === 'payouts' && (panel.payouts.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Solicitado em</th><th className="r">Valor</th><th>Situação</th><th>Pago em</th></tr></thead><tbody>
        {panel.payouts.map((r) => <tr key={r.id}><td>{dateOnly(r.requestedAt)}</td><td className="r num"><b>{money(r.amountCents)}</b></td><td><Badge tone={(P_STATUS[r.status] ?? { t: 'neutral' }).t}>{(P_STATUS[r.status] ?? { l: r.status }).l}</Badge></td><td>{r.paidAt ? dateOnly(r.paidAt) : '—'}</td></tr>)}
      </tbody></table></div> : <EmptyState icon="wallet" title="Nenhum repasse ainda">Os repasses feitos pela equipe aparecem aqui, com a data do pagamento.</EmptyState>)}
      <p className="muted" style={{ fontSize: 13 }}>Para proteger a privacidade dos clientes, o painel mostra só o primeiro nome, o e-mail e a placa parcialmente ocultos.</p>
    </section>
  );
}

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

/** Chave PIX em que o parceiro recebe o repasse. Sem ela a equipe não consegue pagar. */
function PixCard({ pix, onSaved }: { pix?: Panel['pix']; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<PixData>(emptyPix);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function save() {
    const problem = pixProblem(v) || (v.key.trim() ? '' : 'Informe a chave PIX.');
    if (problem) return void toast.error(problem);
    setBusy(true);
    try { await api.put('/affiliate/pix', { pixKey: v.key.trim(), pixKeyType: v.type }); toast.ok('Chave PIX salva.'); setOpen(false); setV(emptyPix); onSaved(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <section className="card card-pad stack">
      <div className="row-between"><h2 style={{ fontSize: 18 }}>Chave PIX para receber</h2>{pix?.set && !open && <Button size="sm" onClick={() => setOpen(true)}>Trocar</Button>}</div>
      {pix?.set ? <p className="muted" style={{ margin: 0 }}>Chave cadastrada{pix.type ? ` (${PIX_TYPE_LABEL[pix.type as PixType] ?? pix.type})` : ''}: <b>{pix.masked}</b>. Os repasses e comissões são pagos nela.</p>
        : <Alert tone="warn" title="Cadastre sua chave PIX">Sem ela a equipe não consegue fazer o repasse das suas comissões.</Alert>}
      {(!pix?.set || open) && (
        <div className="stack">
          <PixFields required value={v} onChange={setV} hint="A chave em que você quer receber." />
          <div><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar chave PIX</Button></div>
        </div>
      )}
    </section>
  );
}

export default function Partner() {
  usePageTitle('Indique e ganhe');
  const toast = useToast();
  const me = useAsync(() => api.get<{ affiliate: Affiliate | null }>('/affiliate/me'), []);
  const stats = useAsync(() => api.get<Stats>('/affiliate/stats'), []);
  const panel = useAsync(() => api.get<Panel>('/affiliate/panel'), []);
  const [code, setCode] = useState('');
  const [linkKey, setLinkKey] = useState('home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (me.loading && !me.data) return <PageLoading />;
  if (me.error != null) return <ErrorState error={me.error} onRetry={me.reload} />;
  const aff = me.data?.affiliate;

  async function activate() {
    setBusy(true); setError('');
    try { await api.post('/affiliate/activate', code.trim() ? { code: code.trim() } : {}); toast.ok('Indique e ganhe ativado!'); me.reload(); stats.reload(); panel.reload(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!aff) {
    return (
      <div className="stack-lg">
        <div className="page-head"><div><h1>Indique e ganhe</h1></div></div>
        <section className="card card-pad stack" style={{ maxWidth: 640 }}>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
            {[['link', 'Compartilhe seu link', 'Cada pessoa que se cadastrar pelo seu link fica vinculada a você.'], ['dollar', 'Ganhe comissão', 'Receba um percentual sobre cada pagamento confirmado dos indicados.'], ['wallet', 'Receba o repasse', 'As comissões são liberadas após o prazo de segurança e repassadas pela equipe.']].map(([i, t, s]) => <div key={t} className="stack-sm"><span className="wi" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-soft)', color: 'var(--primary-ink)', display: 'grid', placeItems: 'center' }}><Icon name={i as 'link'} /></span><b>{t}</b><span className="muted" style={{ fontSize: 14 }}>{s}</span></div>)}
          </div>
          <Field label="Código personalizado (opcional)" hint="Letras, números, hífen ou sublinhado. Se deixar em branco, geramos um para você."><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} maxLength={40} placeholder="MEUCODIGO" /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <div><Button variant="primary" size="lg" loading={busy} onClick={activate} icon="sparkles">Quero indicar e ganhar</Button></div>
        </section>
      </div>
    );
  }

  const t = stats.data?.totals;
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Indique e ganhe</h1><p>Comissão de <b>{bpsToPercent(aff.commissionBps)}</b> por pagamento confirmado.</p></div></div>
      {!aff.active && <Alert tone="warn" title="Seu cadastro no Indique e ganhe está inativo.">Fale com o suporte para reativar.</Alert>}
      <div className="stat-grid">
        <Stat label="Visitas (30 dias)" value={stats.data?.performance?.clicks30d ?? 0} sub="pessoas que chegaram pelo seu link" />
        <Stat label="Cadastros" value={t?.referredUsers ?? 0} sub="pessoas que criaram conta pelo seu link" />
      </div>
      {panel.data?.affiliate && <PixCard pix={panel.data.pix} onSaved={panel.reload} />}
      {panel.data?.affiliate && <PartnerPanel panel={panel.data} />}
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
