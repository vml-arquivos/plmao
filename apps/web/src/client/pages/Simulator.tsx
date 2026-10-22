import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Button, Field, InfoTip, LinkButton, Select, Skeleton, Switch, Textarea, useToast, usePageTitle } from '../../shared/ui';
import { api } from '../api';
import { FipePicker } from '../fipePicker';
import { errorMessage } from '../../shared/api';
import { useSession } from '../session';
import {
  KindTabs, KINDS, MoneyInput, brl, defaultState, kindBySlug, kindByKey, monthRef, paramsFromState, pct, reais,
  stateFromParams, toBody, useCalculation, useSimConfig, type Kind, type Modality, type SimConfig, type SimState
} from '../simulator';

const PRAZOS = [12, 24, 36, 48, 60, 72, 84];
const ENTRADAS = [0, 10, 20, 30, 40, 50];

import { Results, TIP_CDC, TIP_LEASING, TIP_PARCELAS } from '../simResults';
import { SimHistory, SimProposalModal } from '../simProposal';
/* ========================================================================== */
/*  /simulador                                                                 */
/* ========================================================================== */

export default function Simulator() {
  const { tipo } = useParams();
  const kindInfo = kindBySlug(tipo);
  const kind: Kind = kindInfo?.key ?? 'CAR';
  usePageTitle(kindInfo ? `Simulador de financiamento de ${kindInfo.short.toLowerCase()}` : 'Simulador de financiamento de veículos');
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { status } = useSession();
  const toast = useToast();
  const cfg = useSimConfig();
  const [state, setState] = useState<SimState>(() => stateFromParams(kind, params));
  const [showAdv, setShowAdv] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const [mineTick, setMineTick] = useState(0);
  const [proposal, setProposal] = useState(false);

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
            <FipePicker vehicleType={state.kind === 'MOTORCYCLE' ? 'motorcycles' : state.kind === 'TRUCK' ? 'trucks' : 'cars'} label={state.label} onLabel={(l) => set('label', l)} onUseValue={(cents) => set('value', Math.round(cents / 100))} />

            <div className="field">
              <span className="lbl">Modalidade</span>
              <div className="seg" role="radiogroup" aria-label="Modalidade">
                {([['CDC', 'CDC'], ['LEASING', 'Leasing'], ['BOTH', 'Comparar os dois']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={state.modality === k} onClick={() => setState((s) => ({ ...s, modality: k, months: setMonthsFor(k, s.months) }))}>{l}</button>
                ))}
              </div>
              <span className="hint">O que é cada um: CDC<InfoTip label="O que é CDC">{TIP_CDC}</InfoTip> Leasing<InfoTip label="O que é leasing">{TIP_LEASING}</InfoTip></span>
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

            <div className="field">
              <span className="lbl">Tipo de parcela<InfoTip label="Parcelas fixas ou decrescentes">{TIP_PARCELAS}</InfoTip></span>
              <div className="seg" role="radiogroup" aria-label="Tipo de parcela">
                {([['PRICE', 'Fixas'], ['SAC', 'Decrescentes']] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={state.amortization === k} onClick={() => set('amortization', k)}>{l}</button>)}
              </div>
            </div>

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
            <Results data={calc.data} loading={calc.loading} error={calc.error} onAmortization={(a) => set('amortization', a)} onCopied={() => toast.ok('Link copiado.')} />

            <div className="card card-pad sim-actions">
              <div><b>Veja a proposta completa</b><p className="muted">Resumo, CET, composição do custo e todas as parcelas. Dá para salvar no histórico, baixar em PDF ou imprimir.</p></div>
              <div className="row">
                <Button variant="primary" icon="eye" disabled={!calc.data} onClick={() => setProposal(true)}>Ver proposta completa</Button>
                {status === 'authed' && <Button icon="download" loading={busyPdf} disabled={!calc.data} onClick={() => void downloadPdf()}>Baixar PDF</Button>}
              </div>
            </div>

            {status === 'authed' && <SimHistory reload={mineTick} limit={4} compact />}
            {proposal && calc.data && <SimProposalModal data={calc.data} label={state.label} notes={state.notes} body={toBody(state)} onSaved={() => setMineTick((n) => n + 1)} onClose={() => setProposal(false)} />}
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
    { q: "Qual a diferença entre CDC e leasing?", a: "No CDC o banco empresta o valor e o veículo fica no seu nome, com alienação fiduciária (o banco mantém a garantia) até a última parcela. Ao quitar, ele é seu. No leasing a arrendadora compra o veículo e o disponibiliza para você; ele fica no nome dela e, no fim do contrato, você paga o valor residual para ficar com ele." },
    { q: "Por que a parcela do leasing costuma ser menor?", a: "Porque parte do valor do veículo (o valor residual) fica para o final em vez de entrar nas parcelas. Você paga menos por mês, mas, se quiser ficar com o veículo, paga esse valor de uma vez. Compare sempre o total pago e o CET, não só a parcela." },
    { q: "A parcela é sempre a mesma do começo ao fim?", a: "Na maioria dos contratos de veículo, sim (parcelas fixas, tabela Price). Em alguns, as parcelas são decrescentes (SAC): a primeira é a mais alta e a última a mais baixa, porque todo mês você amortiza o mesmo valor e os juros caem junto com o saldo. O total de juros costuma ser menor, mas o começo pesa mais no orçamento. No simulador, escolha em “Tipo de parcela”." },
    { q: "Qual é o mais vantajoso: CDC ou leasing?", a: "Depende do que pesa mais para você. No custo, compare o total pago e o CET (no leasing, inclua o residual se for ficar com o veículo). No orçamento mensal, a parcela menor do leasing ajuda, mas deixa um valor grande para o final. Na segurança e na continuidade do pagamento, veja as respostas sobre atraso e sobre vender o veículo." },
    { q: "O que acontece se eu atrasar as parcelas?", a: "Em qualquer financiamento, o atraso gera multa, juros de mora e correção, e o nome pode ser negativado. No CDC, o veículo é a garantia: se a dívida não for regularizada depois da notificação, o banco pode pedir a busca e apreensão e vender o veículo para abater a dívida. Se sobrar valor, ele volta para você; se faltar, a diferença continua sendo cobrada. No leasing, o veículo é da arrendadora, que pode rescindir o contrato e pedir a reintegração de posse. O que já foi pago e o que ainda é devido seguem o contrato." },
    { q: "E se eu não conseguir continuar pagando?", a: "Procure o banco antes de atrasar. Renegociar o prazo ou vender o veículo para quitar costuma custar menos do que a retomada. Nos dois tipos, você pode antecipar parcelas ou quitar antes, com redução proporcional dos juros (Código de Defesa do Consumidor, art. 52, § 2º)." },
    { q: "Posso vender ou trocar o veículo antes de terminar de pagar?", a: "No CDC, só quitando a dívida ou com a autorização do banco, porque há alienação fiduciária. No leasing, o veículo é da arrendadora até você exercer a compra no final. Nos dois casos, combine com a instituição antes de anunciar." },
    { q: 'De onde vêm as taxas?', a: `Usamos a taxa média mensal de juros de aquisição de veículos divulgada pelo Banco Central do Brasil${cfg ? ` (referência ${monthRef(cfg.referenceMonth)})` : ''}. É uma média de mercado: a sua taxa pode ser menor ou maior conforme perfil, entrada, prazo e instituição. Se você já tem uma proposta, informe a taxa dela.` },
    { q: 'Como o IOF é calculado?', a: iof ? `Para pessoa física, ${String(iof.pfDailyPct).replace('.', ',')}% ao dia sobre cada parcela do principal (limitado a ${iof.capDays} dias) mais ${String(iof.additionalPct).replace('.', ',')}% sobre o valor. Para empresas, ${String(iof.pjDailyPct).replace('.', ',')}% ao dia. O IOF é financiado junto com o veículo, por isso entra no valor das parcelas.` : 'Calculamos o IOF de crédito por parcela, com limite de 365 dias, e financiamos junto com o veículo.' },
    { q: 'O que é o CET?', a: 'Custo Efetivo Total: a taxa que reúne juros, IOF, tarifas e seguros. É o número certo para comparar propostas. Peça sempre o CET no contrato.' },
    { q: 'Quais tarifas entram?', a: 'Cadastro, avaliação do bem (usados) e registro do contrato/gravame, com valores de referência que você pode ajustar. Os valores reais variam por banco e estado: confirme na proposta.' },
  ], [cfg, iof]);
  return (
    <section className="card card-pad stack" aria-labelledby="how-h">
      <h3 id="how-h">Perguntas e respostas</h3>
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
