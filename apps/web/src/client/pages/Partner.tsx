import { useState } from 'react';
import { Icon } from '../../shared/icons';
import { Alert, Button, CopyField, ErrorState, Field, Input, PageLoading, Stat, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, money } from '../../shared/format';
import { api } from '../api';

interface Affiliate { id: string; name: string; email: string; code: string; commissionBps: number; active: boolean }
interface Stats { affiliate: { id: string; code: string } | null; shareUrl?: string; totals: { commissions: number; pendingCents: number; paidCents: number; referredUsers?: number } }

export default function Partner() {
  usePageTitle('Parceiro');
  const toast = useToast();
  const me = useAsync(() => api.get<{ affiliate: Affiliate | null }>('/affiliate/me'), []);
  const stats = useAsync(() => api.get<Stats>('/affiliate/stats'), []);
  const [code, setCode] = useState('');
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
        <div className="page-head"><div><h1>Programa de parceiros</h1><p>Indique a Placa na Mão e receba comissão sobre as consultas pagas dos seus indicados.</p></div></div>
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
      <div className="page-head"><div><h1>Programa de parceiros</h1><p>Sua comissão atual é de <b>{bpsToPercent(aff.commissionBps)}</b> sobre cada pagamento confirmado dos seus indicados.</p></div></div>
      {!aff.active && <Alert tone="warn" title="Seu cadastro de parceiro está inativo.">Fale com o suporte para reativar.</Alert>}
      <div className="stat-grid">
        <Stat label="Indicados" value={t?.referredUsers ?? 0} sub="cadastros pelo seu link" />
        <Stat label="Comissões" value={t?.commissions ?? 0} sub="geradas" />
        <Stat label="A receber" value={money(t?.pendingCents ?? 0)} sub="em liberação ou liberadas" />
        <Stat highlight label="Já pago" value={money(t?.paidCents ?? 0)} sub="repassado a você" />
      </div>
      <section className="card card-pad stack">
        <h2 style={{ fontSize: 18 }}>Seu link de indicação</h2>
        <CopyField value={stats.data?.shareUrl ?? `${window.location.origin}/?ref=${aff.code}`} label="Link de indicação" />
        <p className="muted" style={{ fontSize: 14 }}>Seu código: <b className="mono">{aff.code}</b>. Compartilhe o link em redes sociais, grupos e com sua equipe.</p>
      </section>
      <Alert tone="info" title="Como funciona o repasse.">As comissões ficam em análise por alguns dias após o pagamento (proteção contra estorno). Depois disso, a equipe agrupa e repassa os valores. Em caso de estorno do pagamento, a comissão correspondente é revertida.</Alert>
    </div>
  );
}
