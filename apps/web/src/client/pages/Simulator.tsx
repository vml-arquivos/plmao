import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, Field, LinkButton, Select, Skeleton, Switch, Textarea, useToast, usePageTitle } from '../../shared/ui';
import { api } from '../api';
import { VehiclePicker } from '../vehiclePicker';
import { FipePicker } from '../fipePicker';
import { errorMessage } from '../../shared/api';
import { useSession } from '../session';
import {
  CostBar, KindTabs, KINDS, MoneyInput, ScheduleTable, brl, dateBr, defaultState, kindBySlug, kindByKey, monthRef, paramsFromState, pct, reais,
  stateFromParams, toBody, useCalculation, useSimConfig, type BankOffer, type CalcResponse, type Kind, type Modality, type RateInfo, type SimConfig, type SimResult, type SimState
} from '../simulator';

const PRAZOS = [12, 24, 36, 48, 60, 72, 84];
const ENTRADAS = [0, 10, 20, 30, 40, 50];

/* ========================================================================== */
/*  Resultado                                                                  */
/* ========================================================================== */
function ResultCard({ r, rate, month, best, title }: { r: SimResult; rate?: RateInfo; month: string; best?: boolean; title: string }) {
  const [open, setOpen] = useState(false);
  const interest = Math.max(0, r.totalPaidCents - r.vehicleValueCents - r.iofCents - r.feesTotalCents);
  return (
    <article className={`sim-result card ${best ? 'best' : ''}`} aria-label={title}>
      <header className="between">
        <h3>{title}</h3>
        {best && <Badge tone="ok" dot>Menor custo total</Badge>}
      </header>
      <div className="sim-hero-num">
        <span className="lbl">Parcela mensal estimada</span>
        <strong>{brl(r.installmentCents)}</strong>
        <small>{r.months} parcelas fixas{r.residualCents ? ` + residual de ${brl(r.residualCents)} no final (opcional)` : ''}</small>
      </div>
      <div className="sim-stats">
        <div><span>Total pago ao final</span><b>{brl(r.totalPaidCents)}</b></div>
        <div><span>CET</span><b>{pct(r.cetAnnualPct)} a.a.</b><small>{pct(r.cetMonthlyPct)} ao mês</small></div>
        <div><span>Custo do crédito</span><b className="neg">{brl(r.totalCostCents)}</b><small>{pct(r.costOverVehiclePct, 1)} do veículo</small></div>
      </div>
      <dl className="sim-kv">
        <div><dt>Valor do veículo</dt><dd>{brl(r.vehicleValueCents)}</dd></div>
        <div><dt>Entrada ({pct(r.downPaymentPct, 1)})</dt><dd>{brl(r.downPaymentCents)}</dd></div>
        <div><dt>Valor liberado</dt><dd>{brl(r.loanNetCents)}</dd></div>
        <div><dt>Taxa de juros</dt><dd>{pct(r.monthlyRatePct)} a.m. <small>({pct(r.annualRatePct)} a.a.)</small></dd></div>
        <div className="sep"><dt>Juros</dt><dd>{brl(interest)}</dd></div>
        <div><dt>IOF <small>(financiado)</small></dt><dd>{brl(r.iofCents)}</dd></div>
        {r.fees.map((f) => <div key={f.key}><dt>{f.label} <small>({f.financed ? 'financiada' : 'à vista'})</small></dt><dd>{brl(f.cents)}</dd></div>)}
        <div className="total"><dt>Valor total financiado</dt><dd>{brl(r.principalCents)}</dd></div>
      </dl>
      <p className="sim-rate-src muted">
        {rate?.custom ? 'Taxa informada por você.' : `Taxa média de mercado (Banco Central, ${monthRef(month)}).`}
        {r.firstInstallmentDays > 30 ? ` Primeira parcela em ${r.firstInstallmentDays} dias (carência).` : ''}
      </p>
      {rate?.note && <Alert tone="info" icon="info">{rate.note}</Alert>}
      <CostBar r={r} />
      <button type="button" className="link-btn sim-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Ocultar' : 'Ver'} as {r.months} parcelas <Icon name="chevron-down" size={16} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && <ScheduleTable r={r} />}
      {open && r.residualCents > 0 && <p className="muted" style={{ fontSize: 13 }}>No leasing, o saldo final de {brl(r.residualCents)} é o valor residual: você só paga se quiser ficar com o veículo (vencimento: {dateBr(r.schedule.at(-1)!.dueDate)}).</p>}
    </article>
  );
}

/** Mesma simulação com a taxa de cada banco (média do Banco Central ou informada pela equipe), do menor para o maior CET. */
function BankCompare({ offers, modality, title }: { offers: BankOffer[]; modality: 'CDC' | 'LEASING'; title: string }) {
  const list = offers.filter((o) => o.modality === modality);
  if (!list.length) return null;
  const best = list[0]!;
  const period = list.find((o) => o.period)?.period;
  return (
    <div className="card card-pad stack sim-banks">
      <div className="between"><h3>{title}</h3><span className="muted" style={{ fontSize: 13 }}>Do menor para o maior CET</span></div>
      <div className="sim-banks-wrap">
        <table className="sim-banks-table">
          <thead><tr><th>Banco</th><th>Taxa a.m.</th><th>Parcela</th><th>Total pago</th><th>CET a.a.</th></tr></thead>
          <tbody>
            {list.map((o, i) => (
              <tr key={`${o.id}-${o.modality}`} className={i === 0 && list.length > 1 ? 'best' : undefined}>
                <td>
                  <b>{o.name}</b>{i === 0 && list.length > 1 && <span className="sim-best-tag">Menor CET</span>}
                  <small>{o.rateSource === 'bcb' ? `Média no Banco Central${o.institution ? ` (${o.institution})` : ''}` : 'Condição informada pela equipe'}{o.ownFees ? ' · tarifas do banco' : ''}</small>
                </td>
                <td>{pct(o.ratePct)}</td>
                <td><b>{brl(o.installmentCents)}</b></td>
                <td>{brl(o.totalPaidCents)}{i > 0 && <small>+{brl(o.totalPaidCents - best.totalPaidCents)}</small>}</td>
                <td>{pct(o.cetAnnualPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted sim-rate-src">
        São taxas médias{period ? ` (Banco Central, período iniciado em ${dateBr(period)})` : ''}, não ofertas: a taxa que você recebe depende da análise de crédito, da entrada, do prazo e do veículo. Peça a proposta e compare sempre pelo CET.
      </p>
    </div>
  );
}

function Results({ data, loading, error, state }: { data: CalcResponse | null; loading: boolean; error: string | null; state: SimState }) {
  if (error && !data) return <Alert tone="warn" icon="alert-triangle" title="Confira os dados">{error}</Alert>;
  if (!data) return <div className="stack"><Skeleton h={120} r={16} /><Skeleton h={260} r={16} /></div>;
  const { cdc, leasing } = data.results;
  const both = Boolean(cdc && leasing);
  const cheaper = both ? (cdc!.totalPaidCents <= leasing!.totalPaidCents ? 'cdc' : 'leasing') : null;
  return (
    <div className={`stack ${loading ? 'sim-busy' : ''}`} aria-busy={loading}>
      {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      {data.errors.leasing && <Alert tone="warn" icon="info" title="Leasing não disponível neste cenário">{data.errors.leasing}</Alert>}
      {data.errors.cdc && <Alert tone="warn" icon="info" title="CDC não disponível neste cenário">{data.errors.cdc}</Alert>}
      {both && (
        <div className="sim-compare card card-pad">
          <div className="between"><h3>CDC x Leasing</h3><span className="muted" style={{ fontSize: 13 }}>{state.person === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'}</span></div>
          <p>
            Neste cenário o <b>{cheaper === 'cdc' ? 'CDC' : 'Leasing'}</b> sai <b>{brl(Math.abs(cdc!.totalPaidCents - leasing!.totalPaidCents))}</b> mais barato no total
            {' '}(no leasing, contando o valor residual de {brl(leasing!.residualCents)} para ficar com o veículo). A parcela do leasing é {brl(Math.abs(cdc!.installmentCents - leasing!.installmentCents))} {leasing!.installmentCents < cdc!.installmentCents ? 'menor' : 'maior'}.
          </p>
        </div>
      )}
      <div className={both ? 'sim-two' : undefined}>
        {cdc && <ResultCard r={cdc} rate={data.rates.cdc} month={data.referenceMonth} title="Financiamento CDC" best={cheaper === 'cdc'} />}
        {leasing && <ResultCard r={leasing} rate={data.rates.leasing} month={data.referenceMonth} title="Leasing" best={cheaper === 'leasing'} />}
      </div>
      {data.banks && data.banks.length > 0 && (
        <>
          {cdc && <BankCompare offers={data.banks} modality="CDC" title={both ? 'Compare os bancos: CDC' : 'Compare os bancos'} />}
          {leasing && <BankCompare offers={data.banks} modality="LEASING" title={both ? 'Compare os bancos: leasing' : 'Compare os bancos: leasing'} />}
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Minhas simulações                                                         */
/* ========================================================================== */
interface Mine { code: string; modality: string; vehicleKind: Kind; label: string | null; vehicleValueCents: number; months: number; installmentCents: number; createdAt: string }
function MySimulations({ reload }: { reload: number }) {
  const [items, setItems] = useState<Mine[]>([]);
  const toast = useToast();
  useEffect(() => { api.get<{ items: Mine[] }>('/simulator/mine').then((r) => setItems(r.items), () => undefined); }, [reload]);
  if (!items.length) return null;
  return (
    <section className="card card-pad stack" aria-labelledby="mine-h">
      <h3 id="mine-h">Suas últimas simulações</h3>
      <ul className="sim-mine">
        {items.slice(0, 6).map((m) => (
          <li key={m.code}>
            <div><b>{m.label || `${kindByKey(m.vehicleKind).label} · ${brl(m.vehicleValueCents)}`}</b><small>{m.modality === 'BOTH' ? 'CDC e leasing' : m.modality === 'LEASING' ? 'Leasing' : 'CDC'} · {m.months}x de {brl(m.installmentCents)} · {new Date(m.createdAt).toLocaleDateString('pt-BR')}</small></div>
            <Button size="sm" icon="download" onClick={() => { api.download(`/simulator/mine/${m.code}/pdf`, `simulacao-financiamento-${m.code}.pdf`).catch((e) => toast.error(errorMessage(e))); }}>PDF</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ========================================================================== */
/*  /simulador                                                                 */
/* ========================================================================== */
export default function Simulator() {
  const { tipo } = useParams();
  const kindInfo = kindBySlug(tipo);
  const kind: Kind = kindInfo?.key ?? 'CAR';
  usePageTitle(kindInfo ? `Simulador de financiamento de ${kindInfo.short.toLowerCase()}` : 'Simulador de financiamento de veículos');
  const nav = useNavigate();
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const { status } = useSession();
  const toast = useToast();
  const cfg = useSimConfig();
  const [state, setState] = useState<SimState>(() => stateFromParams(kind, params));
  const [showAdv, setShowAdv] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [mineTick, setMineTick] = useState(0);

  // trocou o tipo de veículo pela URL (/simulador/moto): reinicia com os valores típicos daquele tipo
  useEffect(() => { setState((s) => (s.kind === kind ? s : { ...defaultState(kind), modality: s.modality, label: s.label })); }, [kind]);
  // mantém a simulação na URL (compartilhável e sobrevive ao login)
  useEffect(() => { const t = setTimeout(() => setParams(paramsFromState(state), { replace: true }), 400); return () => clearTimeout(t); }, [state, setParams]);

  const calc = useCalculation(state);
  const set = useCallback(<K extends keyof SimState>(k: K, v: SimState[K]) => setState((s) => ({ ...s, [k]: v })), []);
  const setMonthsFor = (modality: Modality, months: number) => {
    if (modality === 'CDC') return months;
    return Math.min(60, Math.max(24, months));
  };

  const downPct = state.value > 0 ? Math.round((state.down / state.value) * 1000) / 10 : 0;
  const lim = cfg?.limits;
  const next = `${loc.pathname}${loc.search}`;
  const prazos = PRAZOS.filter((p) => (state.modality === 'CDC' ? true : p >= 24 && p <= 60));
  const marketCdc = cfg?.rates.cdc[state.person];
  const marketLease = cfg?.rates.leasing[state.person];

  const downloadPdf = async () => {
    setBusyPdf(true);
    try {
      await api.download('/simulator/pdf', 'simulacao-financiamento.pdf', { method: 'POST', body: toBody(state) });
      toast.ok('PDF gerado. A simulação ficou salva na sua conta.');
      setMineTick((n) => n + 1);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusyPdf(false); }
  };

  const feeHint = (v: number | undefined) => (v ? `padrão: R$ ${reais(v / 100)}` : undefined);

  return (
    <>
      <section className="page-hero sim-hero">
        <div className="container">
          <span className="eyebrow">Simulador de financiamento</span>
          <h1>{kindInfo ? `Simule o financiamento ${kindInfo.key === 'MOTORCYCLE' ? 'da sua moto' : kindInfo.key === 'TRUCK' ? 'do seu caminhão' : kindInfo.key === 'UTILITY' ? 'do seu utilitário' : 'do seu carro'}.` : 'Simule o financiamento do seu veículo.'}</h1>
          <p className="lead">CDC ou leasing, com a taxa média de mercado do Banco Central, IOF e tarifas. Veja a parcela, o CET e o custo total antes de ir ao banco, e baixe o PDF.</p>
          <div className="trust-row" style={{ marginTop: 18 }}>
            <span><Icon name="shield-check" size={16} />Taxas do Banco Central</span>
            <span><Icon name="receipt" size={16} />IOF e tarifas incluídos</span>
            <span><Icon name="file-text" size={16} />PDF para levar ao banco</span>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 8 }}>
        <div className="container sim-layout">
          <form className="card card-pad sim-form" onSubmit={(e) => e.preventDefault()} aria-label="Dados da simulação">
            <KindTabs value={state.kind} onChange={(k) => { nav(`/simulador/${kindByKey(k).slug}${state.label ? `?${new URLSearchParams({ n: state.label }).toString()}` : ''}`, { replace: false }); }} />
            <VehiclePicker value={state.label} onChange={(v) => set('label', v)} />
            <FipePicker vehicleType={state.kind === 'MOTORCYCLE' ? 'motorcycles' : state.kind === 'TRUCK' ? 'trucks' : 'cars'} valueCents={state.value * 100} onUseValue={(cents) => set('value', Math.round(cents / 100))} onLabel={(l) => set('label', l)} />

            <div className="field">
              <span className="lbl">Modalidade</span>
              <div className="seg" role="radiogroup" aria-label="Modalidade">
                {([['CDC', 'CDC'], ['LEASING', 'Leasing'], ['BOTH', 'Comparar os dois']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={state.modality === k} onClick={() => setState((s) => ({ ...s, modality: k, months: setMonthsFor(k, s.months) }))}>{l}</button>
                ))}
              </div>
              <span className="hint">{state.modality === 'CDC' ? 'CDC: o veículo fica alienado ao banco até quitar.' : state.modality === 'LEASING' ? 'Leasing: parcelas menores e valor residual no final, se quiser ficar com o veículo.' : 'Vamos calcular os dois cenários lado a lado.'}</span>
            </div>

            <div className="grid-2">
              <Field label="Quem vai financiar?">
                <div className="seg" role="radiogroup" aria-label="Perfil">
                  {([['PF', 'Pessoa física'], ['PJ', 'Empresa (CNPJ)']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={state.person === k} onClick={() => set('person', k)}>{l}</button>)}
                </div>
              </Field>
              <Field label="O veículo é">
                <div className="seg" role="radiogroup" aria-label="Condição">
                  {([['NEW', 'Novo'], ['USED', 'Usado']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={state.condition === k} onClick={() => set('condition', k)}>{l}</button>)}
                </div>
              </Field>
            </div>

            <Field label="Valor do veículo" hint={lim ? `Entre R$ ${reais(lim.vehicleMinCents / 100)} e R$ ${reais(lim.vehicleMaxCents / 100)}` : undefined}>
              <MoneyInput id="sim-value" value={state.value} onChange={(v) => set('value', v ?? 0)} ariaLabel="Valor do veículo em reais" />
            </Field>

            <Field label={`Entrada ${state.value ? `(${String(downPct).replace('.', ',')}%)` : ''}`}>
              <MoneyInput id="sim-down" value={state.down} onChange={(v) => set('down', v ?? 0)} ariaLabel="Valor da entrada em reais" invalid={state.down > state.value * 0.95} />
              <div className="chips-sel" role="group" aria-label="Entrada em porcentagem">
                {ENTRADAS.map((p) => <button key={p} type="button" aria-pressed={Math.abs(downPct - p) < 0.05} onClick={() => set('down', Math.round(state.value * p / 100))}>{p === 0 ? 'Sem entrada' : `${p}%`}</button>)}
              </div>
              {state.value > 0 && state.down / state.value < 0.2 && <span className="hint">Entrada abaixo de 20% costuma ter taxa maior ou ser recusada pelos bancos.</span>}
            </Field>

            <Field label="Prazo">
              <div className="chips-sel" role="group" aria-label="Prazo em meses">
                {prazos.map((p) => <button key={p} type="button" aria-pressed={state.months === p} onClick={() => set('months', p)}>{p}x</button>)}
              </div>
              {state.modality !== 'CDC' && <span className="hint">Leasing: prazo de 24 a 60 meses.</span>}
            </Field>

            {state.modality !== 'CDC' && (
              <Field label={`Valor residual (VRG): ${state.residual}% do veículo`} hint="Pago no final somente se você quiser ficar com o veículo. Quanto maior, menor a parcela.">
                <input type="range" min={0} max={lim?.maxResidualPct ?? 60} step={5} value={state.residual} onChange={(e) => set('residual', Number(e.target.value))} aria-label="Valor residual em porcentagem" className="range" />
              </Field>
            )}

            <div className="sim-rate-box">
              <div className="between">
                <span className="lbl"><Icon name="percent" size={16} /> Taxa de juros</span>
                <Switch checked={state.customRate !== ''} onChange={(e) => set('customRate', e.target.checked ? String(((state.modality === 'LEASING' ? marketLease : marketCdc)?.pct ?? 2).toFixed(2)).replace('.', ',') : '')} label="Tenho a taxa do banco" />
              </div>
              {state.customRate === '' ? (
                <p className="muted" style={{ fontSize: 13.5 }}>
                  {cfg ? <>Usamos a <b>média de mercado do Banco Central</b> ({monthRef(cfg.referenceMonth)}):{' '}
                    {state.modality !== 'LEASING' && marketCdc && <><b>{pct(marketCdc.pct)} a.m.</b> no CDC</>}
                    {state.modality === 'BOTH' && ' e '}
                    {state.modality !== 'CDC' && marketLease && <><b>{pct(marketLease.pct)} a.m.</b> no leasing</>}.
                    {' '}Sua taxa real depende da análise de crédito.</> : 'Carregando a taxa média de mercado…'}
                </p>
              ) : (
                <Field label="Taxa mensal da proposta (% ao mês)">
                  <input className="input" inputMode="decimal" value={state.customRate} onChange={(e) => set('customRate', e.target.value.replace(/[^\d,.]/g, '').slice(0, 6))} aria-label="Taxa mensal em porcentagem" />
                </Field>
              )}
            </div>

            <button type="button" className="link-btn" aria-expanded={showAdv} onClick={() => setShowAdv((v) => !v)}>
              <Icon name="settings" size={16} /> {showAdv ? 'Ocultar' : 'Ajustar'} tarifas, carência e dados do PDF
            </button>
            {showAdv && (
              <div className="sim-adv stack">
                <Switch checked={state.financeFees} onChange={(e) => set('financeFees', e.target.checked)} label="Financiar as tarifas junto com o veículo" />
                <div className="grid-2">
                  <Field label="Tarifa de cadastro" hint={feeHint(cfg?.fees.cadastroCents)}><MoneyInput value={state.fees.cadastro} onChange={(v) => set('fees', { ...state.fees, cadastro: v })} placeholder={cfg ? reais(cfg.fees.cadastroCents / 100) : ''} ariaLabel="Tarifa de cadastro" /></Field>
                  <Field label="Avaliação do bem (usados)" hint={feeHint(cfg?.fees.avaliacaoCents)}><MoneyInput value={state.fees.avaliacao} onChange={(v) => set('fees', { ...state.fees, avaliacao: v })} placeholder={cfg && state.condition === 'USED' ? reais(cfg.fees.avaliacaoCents / 100) : '0'} ariaLabel="Avaliação do bem" /></Field>
                  <Field label="Registro do contrato / gravame" hint={state.modality === 'LEASING' ? 'No leasing não há gravame.' : feeHint(cfg?.fees.registroCents)}><MoneyInput value={state.fees.registro} onChange={(v) => set('fees', { ...state.fees, registro: v })} placeholder={cfg && state.modality !== 'LEASING' ? reais(cfg.fees.registroCents / 100) : '0'} ariaLabel="Registro do contrato" /></Field>
                  <Field label="Seguro ou serviço opcional" hint="Só informe se você for contratar."><MoneyInput value={state.fees.insurance} onChange={(v) => set('fees', { ...state.fees, insurance: v })} placeholder="0" ariaLabel="Seguro opcional" /></Field>
                </div>
                <Field label="Primeira parcela vence em" hint="Mais de 30 dias é carência: os juros do período extra são somados ao saldo.">
                  <Select value={state.grace} onChange={(e) => set('grace', Number(e.target.value))} aria-label="Dias até a primeira parcela">
                    {[30, 45, 60, 90, 120].map((g) => <option key={g} value={g}>{g} dias{g === 30 ? ' (padrão)' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Observações (aparece no PDF)"><Textarea rows={2} maxLength={400} value={state.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex.: vou comparar com a proposta do banco X" /></Field>
              </div>
            )}
          </form>

          <div className="stack-lg sim-side">
            <Results data={calc.data} loading={calc.loading} error={calc.error} state={state} />

            <div className="card card-pad sim-actions">
              {status === 'authed' ? (
                <>
                  <div><b>Baixe a simulação em PDF</b><p className="muted">Resumo, CET, composição do custo e todas as parcelas. Fica salva na sua conta.</p></div>
                  <Button variant="primary" icon="download" loading={busyPdf} disabled={!calc.data} onClick={() => void downloadPdf()}>Baixar PDF</Button>
                </>
              ) : (
                <>
                  <div><b>Quer o PDF desta simulação?</b><p className="muted">Crie sua conta grátis em menos de um minuto: o PDF sai com CET, composição do custo e todas as parcelas, e a simulação fica salva.</p></div>
                  <div className="row"><LinkButton to={`/criar-conta?next=${encodeURIComponent(next)}`} variant="primary" icon="download">Criar conta e baixar PDF</LinkButton><LinkButton to={`/entrar?next=${encodeURIComponent(next)}`}>Entrar</LinkButton></div>
                </>
              )}
            </div>

            {status === 'authed' && <MySimulations reload={mineTick} />}
            <div className="card card-pad between sim-cta-plate">
              <div><b>Vai financiar um veículo usado?</b><p className="muted">Antes de fechar, consulte a placa: débitos, multas, restrições, gravame e leilão.</p></div>
              <LinkButton to="/consultar" iconRight="arrow-right">Consultar a placa</LinkButton>
            </div>
            <HowItWorks cfg={cfg} />
          </div>
        </div>
      </section>
    </>
  );
}

function HowItWorks({ cfg }: { cfg: SimConfig | null }) {
  const iof = cfg?.iof;
  const items = useMemo(() => [
    { q: 'De onde vêm as taxas?', a: `Usamos a taxa média mensal de juros de aquisição de veículos divulgada pelo Banco Central do Brasil${cfg ? ` (referência ${monthRef(cfg.referenceMonth)})` : ''}. É uma média de mercado: a sua taxa pode ser menor ou maior conforme perfil, entrada, prazo e instituição. Se você já tem uma proposta, informe a taxa dela.` },
    { q: 'Como o IOF é calculado?', a: iof ? `Para pessoa física, ${String(iof.pfDailyPct).replace('.', ',')}% ao dia sobre cada parcela do principal (limitado a ${iof.capDays} dias) mais ${String(iof.additionalPct).replace('.', ',')}% sobre o valor. Para empresas, ${String(iof.pjDailyPct).replace('.', ',')}% ao dia. O IOF é financiado junto com o veículo, por isso entra no valor das parcelas.` : 'Calculamos o IOF de crédito por parcela, com limite de 365 dias, e financiamos junto com o veículo.' },
    { q: 'O que é o CET?', a: 'Custo Efetivo Total: a taxa que reúne juros, IOF, tarifas e seguros. É o número certo para comparar propostas. Peça sempre o CET no contrato.' },
    { q: 'Quais tarifas entram?', a: 'Cadastro, avaliação do bem (usados) e registro do contrato/gravame, com valores de referência que você pode ajustar. Os valores reais variam por banco e estado: confirme na proposta.' },
    { q: 'CDC ou leasing?', a: 'No CDC o veículo é seu e fica alienado ao banco até quitar. No leasing o veículo fica em nome da arrendadora e, no fim, você paga o valor residual se quiser ficar com ele. Para pessoa física o leasing de veículos é pouco ofertado hoje.' }
  ], [cfg, iof]);
  return (
    <section className="card card-pad stack" aria-labelledby="how-h">
      <h3 id="how-h">Como calculamos</h3>
      {items.map((i) => <details key={i.q} className="faq-item"><summary>{i.q}</summary><p className="muted">{i.a}</p></details>)}
      <p className="muted" style={{ fontSize: 13 }}>Simulação informativa. Não é proposta nem oferta de crédito. A Placa na Mão não é instituição financeira. <Link to="/consultar">Consulte a placa</Link> do veículo antes de fechar negócio.</p>
    </section>
  );
}

/* ========================================================================== */
/*  Simulador compacto (página inicial)                                        */
/* ========================================================================== */
export function SimulatorWidget() {
  const [state, setState] = useState<SimState>(() => defaultState('CAR'));
  const { data, loading } = useCalculation(state);
  const cfg = useSimConfig();
  const r = data?.results.cdc;
  const downPct = state.value > 0 ? Math.round((state.down / state.value) * 100) : 0;
  const q = new URLSearchParams(paramsFromState(state)).toString();
  const info = kindByKey(state.kind);
  return (
    <div className="card sim-widget" aria-label="Simulador de financiamento">
      <KindTabs value={state.kind} compact onChange={(k) => setState(defaultState(k))} />
      <div className="grid-2">
        <Field label="Valor do veículo"><MoneyInput value={state.value} onChange={(v) => setState((s) => ({ ...s, value: v ?? 0, down: Math.round((v ?? 0) * downPct / 100) }))} ariaLabel="Valor do veículo em reais" /></Field>
        <Field label={`Entrada (${downPct}%)`}><MoneyInput value={state.down} onChange={(v) => setState((s) => ({ ...s, down: v ?? 0 }))} ariaLabel="Entrada em reais" /></Field>
      </div>
      <div className="chips-sel" role="group" aria-label="Prazo em meses">
        {[24, 36, 48, 60, 72].map((p) => <button key={p} type="button" aria-pressed={state.months === p} onClick={() => setState((s) => ({ ...s, months: p }))}>{p}x</button>)}
      </div>
      <div className="sim-widget-out" aria-live="polite">
        {r ? (
          <>
            <div><span className="lbl">Parcela estimada</span><strong className={loading ? 'sim-busy' : ''}>{brl(r.installmentCents)}</strong><small>{r.months}x · taxa {pct(r.monthlyRatePct)} a.m.</small></div>
            <div><span className="lbl">CET</span><b>{pct(r.cetAnnualPct, 1)} a.a.</b><small>total pago {brl(r.totalPaidCents)}</small></div>
          </>
        ) : <Skeleton h={64} r={12} />}
      </div>
      <LinkButton to={`/simulador/${info.slug}?${q}`} variant="primary" block iconRight="arrow-right">Ver simulação completa e PDF</LinkButton>
      <p className="muted" style={{ fontSize: 12.5 }}>CDC para pessoa física com a taxa média do Banco Central{cfg ? ` (${monthRef(cfg.referenceMonth)})` : ''}, IOF e tarifas. Estimativa, não é oferta de crédito.</p>
    </div>
  );
}

export { KINDS };
