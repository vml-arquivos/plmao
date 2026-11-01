import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Button, ErrorState, Field, Input, PageLoading, useAsync, usePageTitle } from '../../shared/ui';
import { money, num } from '../../shared/format';
import { toCsv, downloadText } from '../../shared/csv';
import { BarChart, Card, Kpi, PageHead } from '../parts';

interface Results {
  from: string; to: string;
  totals: { total: number; success: number; failed: number; internal: number; delivered: number; customer: number; customers: number; revenueCents: number; averageTicketCents: number };
  byProduct: Array<{ id: string; name: string; customer: number; internal: number; failed: number; revenueCents: number }>;
  byDay: Array<{ date: string; customer: number; internal: number; failed: number; revenueCents: number }>;
  byPayment: Array<{ source: string; count: number; revenueCents: number }>;
  topCustomers: Array<{ id: string; name: string; email: string; queries: number; revenueCents: number }>;
  watch: { active: number; paused: number; checks: number; changes: number };
}
const SOURCE: Record<string, string> = { WALLET_MONEY: 'Saldo da conta', DIRECT_PAYMENT: 'Pagamento direto (Pix/cartão)', LEGACY_CREDIT: 'Créditos antigos' };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const dayBr = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };

export default function ResultsPage() {
  usePageTitle('Resultados');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(iso(new Date()));
  const [applied, setApplied] = useState({ from: daysAgo(29), to: iso(new Date()) });
  const r = useAsync(() => api.get<Results>(`/admin/results?from=${applied.from}&to=${applied.to}`), [applied.from, applied.to]);
  const preset = (n: number) => { const next = { from: daysAgo(n - 1), to: iso(new Date()) }; setFrom(next.from); setTo(next.to); setApplied(next); };

  function exportCsv() {
    if (!r.data) return;
    const d = r.data;
    downloadText(`resultados-${d.from}-a-${d.to}.csv`, toCsv(['Produto', 'Consultas de clientes', 'Consultas internas', 'Falhas e estornos', 'Receita (R$)'],
      d.byProduct.map((p) => [p.name, p.customer, p.internal, p.failed, (p.revenueCents / 100).toFixed(2).replace('.', ',')])));
  }
  const d = r.data;
  return (
    <>
      <PageHead title="Resultados" sub="Consultas, receita e estornos por período. Consulta interna da equipe não gera receita." actions={<Button icon="download" disabled={!d} onClick={exportCsv}>Exportar por produto</Button>} />
      <div className="toolbar">
        <Field label="De"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button variant="primary" onClick={() => setApplied({ from, to })}>Aplicar</Button>
        <Button variant="ghost" onClick={() => preset(7)}>7 dias</Button>
        <Button variant="ghost" onClick={() => preset(30)}>30 dias</Button>
        <Button variant="ghost" onClick={() => preset(90)}>90 dias</Button>
      </div>
      {r.loading && !d ? <PageLoading /> : r.error || !d ? <ErrorState error={r.error} onRetry={r.reload} /> : (
        <>
          <div className="adm-grid-4">
            <Kpi label="Receita" value={money(d.totals.revenueCents)} sub={`${num(d.totals.customer)} consultas de clientes`} tone="ok" />
            <Kpi label="Ticket médio" value={money(d.totals.averageTicketCents)} sub={`${num(d.totals.customers)} cliente(s) diferentes`} />
            <Kpi label="Falhas e estornos" value={num(d.totals.failed)} sub={`${d.totals.total ? Math.round((d.totals.failed / d.totals.total) * 100) : 0}% de todas as tentativas`} tone={d.totals.failed > 0 ? 'warn' : undefined} />
            <Kpi label="Consultas internas" value={num(d.totals.internal)} sub={`${num(d.totals.delivered)} entregues a clientes`} />
            <Kpi label="Monitoramentos ativos" value={num(d.watch.active)} sub={`${num(d.watch.paused)} pausados`} />
            <Kpi label="Verificações no período" value={num(d.watch.checks)} sub={`${num(d.watch.changes)} com mudança`} />
          </div>
          <div className="adm-split">
            <Card title="Consultas por dia"><BarChart labels={d.byDay.map((x) => dayBr(x.date).slice(0, 5))} series={[{ name: 'Clientes', values: d.byDay.map((x) => x.customer), cls: 'bar' }, { name: 'Internas', values: d.byDay.map((x) => x.internal), cls: 'bar2' }]} /></Card>
            <Card title="Receita por dia"><BarChart labels={d.byDay.map((x) => dayBr(x.date).slice(0, 5))} series={[{ name: 'Receita', values: d.byDay.map((x) => x.revenueCents), cls: 'bar' }]} format={(v) => money(v)} /></Card>
          </div>
          <Card title="Por produto" pad={false}>
            {!d.byProduct.length ? <p className="muted" style={{ padding: 16 }}>Nenhuma consulta no período.</p> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>Produto</th><th className="r">Clientes</th><th className="r">Internas</th><th className="r">Falhas / estornos</th><th className="r">Receita</th></tr></thead><tbody>
                {d.byProduct.map((p) => <tr key={p.id}><td>{p.name}</td><td className="r num">{num(p.customer)}</td><td className="r num">{num(p.internal)}</td><td className="r num">{num(p.failed)}</td><td className="r num">{money(p.revenueCents)}</td></tr>)}
              </tbody></table></div>
            )}
          </Card>
          <div className="adm-split">
            <Card title="Forma de pagamento" pad={false}>
              {!d.byPayment.length ? <p className="muted" style={{ padding: 16 }}>Sem consultas pagas no período.</p> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Origem</th><th className="r">Consultas</th><th className="r">Receita</th></tr></thead><tbody>
                  {d.byPayment.map((p) => <tr key={p.source}><td>{SOURCE[p.source] ?? p.source}</td><td className="r num">{num(p.count)}</td><td className="r num">{money(p.revenueCents)}</td></tr>)}
                </tbody></table></div>
              )}
            </Card>
            <Card title="Clientes que mais consultaram" pad={false}>
              {!d.topCustomers.length ? <p className="muted" style={{ padding: 16 }}>Sem consultas de clientes no período.</p> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Cliente</th><th className="r">Consultas</th><th className="r">Receita</th></tr></thead><tbody>
                  {d.topCustomers.map((c) => <tr key={c.id}><td><Link to={`/clientes/${c.id}`}>{c.name}</Link><div className="muted" style={{ fontSize: 12.5 }}>{c.email}</div></td><td className="r num">{num(c.queries)}</td><td className="r num">{money(c.revenueCents)}</td></tr>)}
                </tbody></table></div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
