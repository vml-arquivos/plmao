import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ErrorState, Field, Input, PageLoading, Select, Switch, Tabs, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, centsToInput, dateTime, money, parseMoneyToCents, percentToBps } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { Card, Kpi, PageHead } from '../parts';

/* ---------- Tipos ---------- */
interface Settings {
  taxRegime: string; taxRates: { cash: number; boleto: number; debit: number; creditCash: number; creditInstallment: number };
  pix: { feeBps: number; fixedFeeCents: number };
  boleto: { months: number; monthlyInterestBps: number; fixedFeeCents: number; defaultRiskBps: number };
  card: { debitFeeBps: number; creditCashFeeBps: number; creditInstallmentFeeBps: number; installments: number; anticipationBps: number; monthlyInterestBps: number; customerPaysInterest: boolean };
  enabledMethods: string[]; operationalCostCents: number; desiredMarginBps: number; minMarginBps: number; marginBase: string; referenceDiscountBps: number; priceEndingCents: number;
  commissionBase: string; commissionDefaultBps: number; commissionHoldDays: number; payoutMinCents: number;
  receiverName: string | null; receiverDocument: string | null; receiverPixKey: string | null; receiverBankNotes: string | null; receiptFooter: string | null;
  fiscalWarning: string; fiscalAcknowledged: boolean; fiscalAcknowledgedAt: string | null; updatedAt: string | null;
}
interface SettingsRes { settings: Settings; suggestedTaxRatesBps: Record<string, Settings['taxRates']> }
interface Overview { days: number; orders: number; grossCents: number; refundedCents: number; refunds: number; chargebacks: number; gatewayFeesCents: number; estimatedTaxCents: number; providerCostCents: number; queries: number; commissionsCents: number; netProfitCents: number; netMarginBps: number | null; fiscalWarning: string }
interface Checklist { ready: boolean; items: Array<{ key: string; ok: boolean; severity: 'BLOCKER' | 'WARNING'; title: string; detail: string }>; fiscalWarning: string }

const METHODS: Array<[string, string]> = [['PIX', 'Pix'], ['BOLETO', 'Boleto'], ['DEBITO', 'Cartão de débito'], ['CREDITO_A_VISTA', 'Crédito à vista'], ['CREDITO_PARCELADO', 'Crédito parcelado']];
const REGIMES: Array<[string, string]> = [['SIMPLES_NACIONAL', 'Simples Nacional'], ['LUCRO_PRESUMIDO', 'Lucro Presumido'], ['LUCRO_REAL', 'Lucro Real'], ['MANUAL', 'Manual']];

type Kind = 'bps' | 'cents' | 'int' | 'text';
interface Spec { key: string; label: string; kind: Kind; hint?: string; value: (s: Settings) => string | number | null; owner?: boolean }
const sp = (key: string, label: string, kind: Kind, value: Spec['value'], hint?: string, owner?: boolean): Spec => ({ key, label, kind, value, hint, owner });

const TAX: Spec[] = [
  sp('taxCashBps', 'Pix / à vista (%)', 'bps', (s) => s.taxRates.cash), sp('taxBoletoBps', 'Boleto (%)', 'bps', (s) => s.taxRates.boleto), sp('taxDebitBps', 'Débito (%)', 'bps', (s) => s.taxRates.debit),
  sp('taxCreditCashBps', 'Crédito à vista (%)', 'bps', (s) => s.taxRates.creditCash), sp('taxCreditInstallmentBps', 'Crédito parcelado (%)', 'bps', (s) => s.taxRates.creditInstallment)
];
const FEES: Spec[] = [
  sp('pixFeeBps', 'Taxa Pix (%)', 'bps', (s) => s.pix.feeBps), sp('pixFixedFeeCents', 'Tarifa fixa Pix (R$)', 'cents', (s) => s.pix.fixedFeeCents),
  sp('boletoFixedFeeCents', 'Tarifa do boleto (R$)', 'cents', (s) => s.boleto.fixedFeeCents), sp('boletoDefaultRiskBps', 'Risco de inadimplência do boleto (%)', 'bps', (s) => s.boleto.defaultRiskBps),
  sp('boletoMonths', 'Prazo médio do boleto (meses)', 'int', (s) => s.boleto.months), sp('boletoMonthlyInterestBps', 'Custo mensal do boleto (%)', 'bps', (s) => s.boleto.monthlyInterestBps),
  sp('debitFeeBps', 'Taxa débito (%)', 'bps', (s) => s.card.debitFeeBps), sp('creditCashFeeBps', 'Taxa crédito à vista (%)', 'bps', (s) => s.card.creditCashFeeBps),
  sp('creditInstallmentFeeBps', 'Taxa crédito parcelado (%)', 'bps', (s) => s.card.creditInstallmentFeeBps), sp('anticipationBps', 'Antecipação de recebíveis (%)', 'bps', (s) => s.card.anticipationBps),
  sp('installmentsMax', 'Máximo de parcelas', 'int', (s) => s.card.installments), sp('cardMonthlyInterestBps', 'Juros mensais do cartão (%)', 'bps', (s) => s.card.monthlyInterestBps)
];
const MARGIN: Spec[] = [
  sp('operationalCostCents', 'Custo operacional por consulta (R$)', 'cents', (s) => s.operationalCostCents, 'Infraestrutura, suporte e outros custos unitários.'),
  sp('desiredMarginBps', 'Margem desejada (%)', 'bps', (s) => s.desiredMarginBps), sp('minMarginBps', 'Margem mínima — trava (%)', 'bps', (s) => s.minMarginBps, 'Abaixo disso o preço é bloqueado (piso).'),
  sp('referenceDiscountBps', 'Desconto sobre o preço de mercado (%)', 'bps', (s) => s.referenceDiscountBps, 'Aplicado ao preço de referência (uso interno).'), sp('priceEndingCents', 'Final do preço (centavos)', 'int', (s) => s.priceEndingCents, 'Ex.: 90 → R$ 9,90')
];
const COMMISSION: Spec[] = [
  sp('commissionDefaultBps', 'Comissão padrão (%)', 'bps', (s) => s.commissionDefaultBps), sp('commissionHoldDays', 'Carência até liberar (dias)', 'int', (s) => s.commissionHoldDays, 'Proteção contra chargeback.'),
  sp('payoutMinCents', 'Repasse mínimo (R$)', 'cents', (s) => s.payoutMinCents)
];
const RECEIVER: Spec[] = [
  sp('receiverName', 'Razão social / nome', 'text', (s) => s.receiverName, undefined, true), sp('receiverDocument', 'CNPJ / CPF', 'text', (s) => s.receiverDocument, undefined, true),
  sp('receiverPixKey', 'Chave Pix de recebimento', 'text', (s) => s.receiverPixKey, undefined, true), sp('receiverBankNotes', 'Dados bancários / observações', 'text', (s) => s.receiverBankNotes, undefined, true),
  sp('receiptFooter', 'Rodapé dos recibos', 'text', (s) => s.receiptFooter)
];
const ALL = [...TAX, ...FEES, ...MARGIN, ...COMMISSION, ...RECEIVER];

const toInput = (kind: Kind, v: string | number | null): string => (v == null ? '' : kind === 'bps' ? String(Number(v) / 100).replace('.', ',') : kind === 'cents' ? centsToInput(Number(v)) : String(v));
function fromInput(kind: Kind, v: string): number | string | null | undefined {
  if (kind === 'text') return v.trim() === '' ? null : v.trim();
  if (v.trim() === '') return undefined;
  if (kind === 'bps') { const n = percentToBps(v); return Number.isFinite(n) ? n : undefined; }
  if (kind === 'cents') return parseMoneyToCents(v) ?? undefined;
  const n = Number(v); return Number.isInteger(n) ? n : undefined;
}

export default function Finance() {
  usePageTitle('Financeiro');
  const [tab, setTab] = useState<'overview' | 'settings' | 'simulator'>('overview');
  return (
    <>
      <PageHead title="Financeiro" sub="Resultado, configuração de pagamento/impostos/comissões e simulador de margem." />
      <Tabs label="Seções" value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Visão geral' }, { id: 'settings', label: 'Configurações' }, { id: 'simulator', label: 'Simulador' }]} />
      {tab === 'overview' && <OverviewTab onGoSettings={() => setTab('settings')} />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'simulator' && <SimulatorTab />}
    </>
  );
}

/* ---------- Visão geral ---------- */
function OverviewTab({ onGoSettings }: { onGoSettings: () => void }) {
  const [days, setDays] = useState(30);
  const ov = useAsync(() => api.get<Overview>('/admin/finance/overview', { query: { days } }), [days]);
  const chk = useAsync(() => api.get<Checklist>('/admin/finance/setup-checklist'));
  const toast = useToast();
  const { can } = useAdminSession();
  async function ack() { try { await api.post('/admin/finance/settings/fiscal-ack'); toast.ok('Ciência registrada.'); chk.reload(); } catch (e) { toast.error(errorMessage(e)); } }
  const d = ov.data;
  return (
    <>
      {chk.data && (
        <Card title="Checklist de implantação" actions={<Badge tone={chk.data.ready ? 'ok' : 'warn'} dot>{chk.data.ready ? 'Pronto para vender' : 'Pendências'}</Badge>}>
          <div className="checklist">
            {chk.data.items.map((i) => (
              <div key={i.key} className={`check-item ${i.ok ? 'ok' : i.severity === 'BLOCKER' ? 'block' : 'warn'}`}>
                <span className="ico"><Icon name={i.ok ? 'check' : 'alert-triangle'} size={15} /></span>
                <div className="grow"><b>{i.title}</b>{!i.ok && <p>{i.detail}</p>}</div>
                {!i.ok && i.key === 'fiscal' && can('ADMIN_SYSTEM') && <Button size="sm" onClick={() => void ack()}>Registrar ciência</Button>}
                {!i.ok && (i.key === 'receiver' || i.key === 'receipt') && <Button size="sm" variant="ghost" onClick={onGoSettings}>Configurar</Button>}
                {!i.ok && (i.key.startsWith('cost:') || i.key.startsWith('ref:')) && <Link className="btn btn-ghost btn-sm" to="/precos">Abrir preços</Link>}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="toolbar"><Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Período">{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Últimos {n} dias</option>)}</Select></div>
      {ov.loading && !d ? <PageLoading /> : ov.error || !d ? <ErrorState error={ov.error} onRetry={ov.reload} /> : (
        <>
          <div className="adm-grid-4">
            <Kpi label="Receita bruta" value={money(d.grossCents)} sub={`${d.orders} pedido(s) pagos`} tone="ok" />
            <Kpi label="Lucro líquido estimado" value={money(d.netProfitCents)} sub={d.netMarginBps == null ? 'Sem vendas no período' : `Margem líquida ${bpsToPercent(d.netMarginBps)}`} tone={d.netProfitCents < 0 ? 'danger' : 'ok'} />
            <Kpi label="Custo do provedor" value={money(d.providerCostCents)} sub={`${d.queries} consulta(s) concluídas`} />
            <Kpi label="Taxas do gateway" value={money(d.gatewayFeesCents)} />
            <Kpi label="Impostos (estimativa)" value={money(d.estimatedTaxCents)} sub="Alíquota configurada — validar com o contador" />
            <Kpi label="Comissões" value={money(d.commissionsCents)} />
            <Kpi label="Reembolsos" value={money(d.refundedCents)} sub={`${d.refunds} estorno(s), ${d.chargebacks} chargeback(s)`} tone={d.refunds ? 'warn' : undefined} />
          </div>
          <Alert tone="warn" icon="alert-triangle" title="Aviso fiscal">{d.fiscalWarning} Os impostos acima são estimativas.</Alert>
        </>
      )}
    </>
  );
}

/* ---------- Configurações ---------- */
function SettingsTab() {
  const { can } = useAdminSession();
  const toast = useToast();
  const res = useAsync(() => api.get<SettingsRes>('/admin/finance/settings'));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [regime, setRegime] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [base, setBase] = useState('');
  const [cbase, setCbase] = useState('');
  const [custInterest, setCustInterest] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = can('ADMIN_SYSTEM');
  const s = res.data?.settings;

  useEffect(() => {
    if (!s) return;
    setVals(Object.fromEntries(ALL.map((f) => [f.key, toInput(f.kind, f.value(s))])));
    setRegime(s.taxRegime); setMethods(s.enabledMethods); setBase(s.marginBase); setCbase(s.commissionBase); setCustInterest(s.card.customerPaysInterest);
  }, [s]);

  const diff = useMemo(() => {
    if (!s) return {};
    const out: Record<string, unknown> = {};
    for (const f of ALL) {
      if (f.owner && !isOwner) continue;
      const next = fromInput(f.kind, vals[f.key] ?? '');
      const prev = f.kind === 'text' ? (f.value(s) ?? null) : f.value(s);
      if (next !== undefined && next !== prev) out[f.key] = next;
    }
    if (regime !== s.taxRegime) out.taxRegime = regime;
    if (base !== s.marginBase) out.marginBase = base;
    if (cbase !== s.commissionBase) out.commissionBase = cbase;
    if (custInterest !== s.card.customerPaysInterest) out.customerPaysInterest = custInterest;
    if (methods.join() !== s.enabledMethods.join()) out.enabledMethods = METHODS.map(([k]) => k).filter((k) => methods.includes(k));
    return out;
  }, [vals, regime, base, cbase, custInterest, methods, s, isOwner]);
  const changed = Object.keys(diff).length;

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    try { await api.put('/admin/finance/settings', { ...diff, ...extra }); toast.ok('Configurações salvas.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function ack() { try { await api.post('/admin/finance/settings/fiscal-ack'); toast.ok('Ciência registrada.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); } }

  if (res.loading && !s) return <PageLoading />;
  if (res.error || !s) return <ErrorState error={res.error} onRetry={res.reload} />;
  const render = (list: Spec[]) => list.filter((f) => !f.owner || isOwner || true).map((f) => (
    <Field key={f.key} label={f.label} hint={f.hint}>
      <Input value={vals[f.key] ?? ''} disabled={f.owner && !isOwner} inputMode={f.kind === 'text' ? 'text' : 'decimal'} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
    </Field>
  ));
  return (
    <>
      <Alert tone={s.fiscalAcknowledged ? 'info' : 'warn'} icon="alert-triangle" title="Alíquotas são estimativas">
        {s.fiscalWarning}
        {s.fiscalAcknowledged ? <> Ciência registrada em {dateTime(s.fiscalAcknowledgedAt)}.</> : isOwner ? <> <Button size="sm" onClick={() => void ack()}>Registrar ciência do contador</Button></> : <> Peça a um super admin para registrar a ciência.</>}
      </Alert>
      <Card title="Impostos" actions={<Select value={regime} onChange={(e) => setRegime(e.target.value)} aria-label="Regime tributário">{REGIMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}>
        <div className="form-grid">{render(TAX)}</div>
        <div className="row"><Button size="sm" onClick={() => void save({ taxRegime: regime, applySuggestedTaxes: true })} loading={busy}>Aplicar alíquotas sugeridas do regime</Button><span className="muted" style={{ fontSize: 13 }}>Sobrescreve as alíquotas acima com a sugestão do regime selecionado.</span></div>
      </Card>
      <Card title="Taxas de recebimento"><div className="form-grid">{render(FEES)}</div><Switch checked={custInterest} onChange={(e) => setCustInterest(e.target.checked)} label="Cliente paga os juros do parcelamento" /></Card>
      <Card title="Formas de pagamento habilitadas">
        <div className="chips">{METHODS.map(([k, l]) => <label key={k} className="chip"><input type="checkbox" checked={methods.includes(k)} onChange={(e) => setMethods((m) => (e.target.checked ? [...m, k] : m.filter((x) => x !== k)))} /> {l}</label>)}</div>
        {!methods.length && <Alert tone="danger">Habilite pelo menos uma forma de pagamento.</Alert>}
      </Card>
      <Card title="Margem e preços"><div className="form-grid">{render(MARGIN)}
        <Field label="A margem incide sobre"><Select value={base} onChange={(e) => setBase(e.target.value)}><option value="COST_PRICE">Preço de custo</option><option value="TOTAL_COST">Custo total</option></Select></Field></div></Card>
      <Card title="Comissões e repasses"><div className="form-grid">{render(COMMISSION)}
        <Field label="Base de cálculo da comissão"><Select value={cbase} onChange={(e) => setCbase(e.target.value)}><option value="GROSS">Valor bruto</option><option value="NET">Valor líquido (após taxas)</option><option value="MARGIN">Margem</option></Select></Field></div></Card>
      <Card title="Dados de recebimento e recibos">
        {!isOwner && <Alert tone="info">Documento e chave Pix são mascarados; apenas super admins editam estes campos.</Alert>}
        <div className="form-grid">{render(RECEIVER)}</div>
      </Card>
      <div className="form-actions no-print" style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '12px 0' }}>
        <Button variant="primary" size="lg" loading={busy} disabled={!changed || !methods.length} onClick={() => void save()}>{changed ? `Salvar ${changed} alteração(ões)` : 'Nada para salvar'}</Button>
        {changed > 0 && <Button variant="ghost" onClick={res.reload}>Descartar</Button>}
      </div>
    </>
  );
}

/* ---------- Simulador ---------- */
interface SimRes { result: { results: Array<{ method: string; methodLabel: string; suggestedPriceCents: number; psychologicalPriceCents: number; installments: number; installmentValueCents: number; netProfitCents: number; realMarginBps: number; diagnostic: string; totalTaxCents: number; totalFeesCents: number; minPriceNoLossCents: number }>; safePriceCents: number; hasUnhealthyProduct: boolean; unhealthyAlert?: string }; floorCents: number; floorMethod: string; atPrice: Array<{ method: string; marginBps: number }> | null }
const DIAG_TONE: Record<string, 'ok' | 'info' | 'warn' | 'danger'> = { EXCELENTE: 'ok', SAUDAVEL: 'ok', ATENCAO: 'warn', RISCO: 'danger', PREJUIZO: 'danger' };

function SimulatorTab() {
  const toast = useToast();
  const [cost, setCost] = useState('');
  const [other, setOther] = useState('');
  const [price, setPrice] = useState('');
  const [margin, setMargin] = useState('');
  const [out, setOut] = useState<SimRes | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    const c = parseMoneyToCents(cost);
    if (c == null) { toast.error('Informe o custo do provedor.'); return; }
    const body: Record<string, unknown> = { productName: 'Simulação', providerCostCents: c };
    const o = parseMoneyToCents(other); if (o != null) body.otherCostsCents = o;
    const p = parseMoneyToCents(price); if (p) body.priceCents = p;
    if (margin.trim()) body.desiredMarginBps = percentToBps(margin);
    setBusy(true);
    try { setOut(await api.post<SimRes>('/admin/finance/simulate', body)); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <Card title="Simular preço e margem">
        <div className="form-grid">
          <Field label="Custo do provedor por consulta (R$)"><Input inputMode="decimal" placeholder="0,00" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="Outros custos (R$)" hint="Vazio = custo operacional padrão"><Input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} /></Field>
          <Field label="Margem desejada (%)" hint="Vazio = padrão configurado"><Input inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></Field>
          <Field label="Testar um preço (R$)" hint="Mostra a margem real por forma de pagamento"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        </div>
        <div><Button variant="primary" loading={busy} onClick={() => void run()}>Simular</Button></div>
      </Card>
      {out && (
        <div className="sim-out">
          <div className="adm-grid-4"><Kpi label="Preço seguro (todas as formas)" value={money(out.result.safePriceCents)} sub="Mantém a margem desejada" tone="ok" /><Kpi label="Piso (margem mínima)" value={money(out.floorCents)} sub={`Pior forma: ${out.floorMethod}`} /></div>
          {out.result.hasUnhealthyProduct && <Alert tone="danger" title="Atenção">{out.result.unhealthyAlert}</Alert>}
          <div className="table-wrap"><table className="table"><thead><tr><th>Forma</th><th className="r">Preço sugerido</th><th className="r">Psicológico</th><th className="r">Impostos</th><th className="r">Taxas</th><th className="r">Lucro</th><th className="r">Margem</th><th>Saúde</th></tr></thead><tbody>
            {out.result.results.map((r) => <tr key={r.method}><td><b>{r.methodLabel}</b>{r.installments > 1 && <div className="muted" style={{ fontSize: 12 }}>{r.installments}x de {money(r.installmentValueCents)}</div>}</td><td className="r num">{money(r.suggestedPriceCents)}</td><td className="r num">{money(r.psychologicalPriceCents)}</td><td className="r num">{money(r.totalTaxCents)}</td><td className="r num">{money(r.totalFeesCents)}</td><td className="r num">{money(r.netProfitCents)}</td><td className="r num">{bpsToPercent(r.realMarginBps)}</td><td><Badge tone={DIAG_TONE[r.diagnostic] ?? 'neutral'}>{r.diagnostic}</Badge></td></tr>)}
          </tbody></table></div>
          {out.atPrice && <Card title={`Margem real a ${money(parseMoneyToCents(price) ?? 0)}`}><div className="sim-grid">{out.atPrice.map((m) => <Kpi key={m.method} label={m.method} value={bpsToPercent(m.marginBps)} tone={m.marginBps < 0 ? 'danger' : undefined} />)}</div></Card>}
        </div>
      )}
    </>
  );
}
