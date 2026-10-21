import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, ErrorState, PageLoading, useAsync, usePageTitle } from '../../shared/ui';
import { money, num } from '../../shared/format';
import { BarChart, Card, Kpi, PageHead, asNumber } from '../parts';

interface Overview { [k: string]: unknown; daily: Array<{ date: string; queries: number; successful_queries: number; sales: number; revenue_cents: number; users: number }> }
interface Funnel { visitors: number; plate_searches: number; signups: number; checkouts_started: number; payments_paid: number; reports_delivered: number; reports_opened: number; failed_or_refunded: number; refunded_orders: number; disputes: number; repeat_buyers: number; buyers: number }
interface Checklist { ready: boolean; items: Array<{ key: string; ok: boolean; severity: 'BLOCKER' | 'WARNING'; title: string }> }

export default function Dashboard() {
  usePageTitle('Painel');
  const { can } = useAdminSession();
  const ov = useAsync(() => api.get<Overview>('/admin/overview'));
  const fun = useAsync(() => api.get<Funnel>('/admin/funnel'));
  const chk = useAsync(() => (can('MANAGE_BILLING') ? api.get<Checklist>('/admin/finance/setup-checklist') : Promise.resolve(null)), [can('MANAGE_BILLING')]);
  if (ov.loading && !ov.data) return <PageLoading />;
  if (ov.error || !ov.data) return <ErrorState error={ov.error} onRetry={ov.reload} />;
  const d = ov.data; const n = (k: string) => asNumber(d[k]);
  const days = d.daily.map((x) => x.date);
  const blockers = chk.data?.items.filter((i) => !i.ok && i.severity === 'BLOCKER') ?? [];
  const conv = n('fipe_started') > 0 ? Math.round((n('fipe_completed') / n('fipe_started')) * 100) : 0;
  return (
    <>
      <PageHead title="Painel" sub="Visão geral da operação nos últimos 30 dias." />
      {chk.data && !chk.data.ready && (
        <Alert tone="warn" icon="alert-triangle" title="Faltam itens para vender com a margem protegida">
          {blockers.length} pendência(s) bloqueante(s): {blockers.slice(0, 3).map((b) => b.title).join('; ')}{blockers.length > 3 ? '…' : ''}. <Link to="/financeiro">Abrir checklist financeiro</Link>
        </Alert>
      )}
      <div className="adm-grid-4">
        <Kpi label="Consultas hoje" value={num(n('queries_today'))} sub={`${num(n('successful_queries'))} concluídas no total`} />
        <Kpi label="Receita confirmada" value={money(n('confirmed_revenue_cents'))} sub={`${num(n('confirmed_sales'))} vendas · ticket ${money(n('average_ticket_cents'))}`} tone="ok" />
        <Kpi label="Usuários ativos" value={num(n('active_users'))} sub={`+${num(n('new_users_30d'))} nos últimos 30 dias`} />
        <Kpi label="Saldo pré-pago em carteiras" value={money(n('prepaid_balance_cents'))} sub="Obrigação com clientes" />
        <Kpi label="Falhas / estornos" value={`${num(n('failed_queries'))} / ${num(n('refunds'))}`} sub="Consultas com falha e estornadas" tone={n('failed_queries') > 0 ? 'warn' : undefined} />
        <Kpi label="Checkouts em aberto" value={money(n('open_checkout_cents'))} sub="Aguardando pagamento" />
        <Kpi label="Reembolsado" value={money(n('refunded_revenue_cents'))} />
        <Kpi label="Visitantes (30 dias)" value={num(n('funnel_visitors_30d'))} sub={`Cadastro: ${n('visitor_registration_rate_pct')}% dos visitantes`} />
      </div>
      <div className="adm-split">
        <Card title="Consultas por dia" actions={<span className="legend"><span><i style={{ background: 'var(--primary)' }} />Total</span><span><i style={{ background: 'var(--accent)' }} />Concluídas</span></span>}>
          <BarChart labels={days} series={[{ name: 'Total', values: d.daily.map((x) => x.queries), cls: 'bar' }, { name: 'Concluídas', values: d.daily.map((x) => x.successful_queries), cls: 'bar2' }]} />
        </Card>
        <Card title="Receita por dia">
          <BarChart labels={days} series={[{ name: 'Receita', values: d.daily.map((x) => x.revenue_cents), cls: 'bar' }]} format={(v) => money(v)} />
        </Card>
      </div>
      <Card title="Aquisição (30 dias)">
        <div className="adm-grid-4">
          <Kpi label="Visitantes" value={num(n('funnel_visitors_30d'))} />
          <Kpi label="Vindos de páginas de busca" value={num(n('seo_visitors_30d'))} />
          <Kpi label="Clicaram em um CTA" value={num(n('cta_visitors_30d'))} />
          <Kpi label="Checkouts iniciados" value={num(n('checkout_starts_30d'))} sub={`Cadastro: ${n('visitor_registration_rate_pct')}% dos visitantes`} />
        </div>
      </Card>
      {fun.data && (() => {
        const f = fun.data;
        const steps: Array<[string, number]> = [['Visitantes', f.visitors], ['Buscaram uma placa', f.plate_searches], ['Cadastros', f.signups], ['Checkouts iniciados', f.checkouts_started], ['Pagamentos confirmados', f.payments_paid], ['Relatórios entregues', f.reports_delivered], ['Relatórios abertos', f.reports_opened]];
        const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}% da etapa anterior` : undefined);
        return (
          <Card title="Funil completo (30 dias)">
            <div className="adm-grid-4">
              {steps.map(([label, v], i) => <Kpi key={label} label={label} value={num(v)} sub={i > 0 ? pctOf(v, steps[i - 1]![1]) : undefined} />)}
              <Kpi label="Falhas ou estornos de consulta" value={num(f.failed_or_refunded)} tone={f.failed_or_refunded > 0 ? 'warn' : undefined} sub={`${num(f.refunded_orders)} pedido(s) reembolsado(s)`} />
              <Kpi label="Dados contestados" value={num(f.disputes)} sub="pelos clientes, no relatório" />
              <Kpi label="Clientes que compraram de novo" value={`${num(f.repeat_buyers)} de ${num(f.buyers)}`} sub={f.buyers > 0 ? `${Math.round((f.repeat_buyers / f.buyers) * 100)}% dos compradores` : undefined} />
            </div>
            <p className="muted" style={{ fontSize: 13 }}>As etapas contam eventos do período, não a mesma pessoa de uma etapa à outra.</p>
          </Card>
        );
      })()}
      <Card title="Funil da consulta FIPE grátis">
        <div className="adm-grid-4">
          <Kpi label="Iniciadas" value={num(n('fipe_started'))} />
          <Kpi label="Concluídas" value={num(n('fipe_completed'))} sub={`${conv}% das iniciadas`} />
          <Kpi label="Salvas na conta" value={num(n('fipe_saved'))} sub={`${n('fipe_save_rate_pct')}% das concluídas`} />
          <Kpi label="PDF baixado" value={num(n('fipe_pdf_downloads'))} />
        </div>
        {n('fipe_provider_failures_24h') > 0 && <Alert tone="warn" title="Falhas na fonte FIPE">{num(n('fipe_provider_failures_24h'))} falha(s) nas últimas 24 horas.</Alert>}
      </Card>
    </>
  );
}
