import { useState } from 'react';
import { Icon } from '../shared/icons';
import { Alert, Badge, InfoTip, Skeleton } from '../shared/ui';
import { CostBar, ScheduleTable, brl, dateBr, monthRef, pct, type CalcResponse, type RateInfo, type SimResult } from './simulator';

export const TIP_CDC = <><b>CDC</b>O banco empresta o valor e o veículo fica no seu nome, com o banco como garantidor (alienação fiduciária) até a última parcela. Você paga só as parcelas; ao quitar, o veículo é seu e não há mais nada a pagar.</>;
export const TIP_LEASING = <><b>Leasing</b>A arrendadora compra o veículo e você o usa pagando parcelas; ele fica no nome dela. Parte do valor fica para o final (valor residual), por isso a parcela é menor. No fim, você paga o residual para ficar com o veículo.</>;
export const TIP_PARCELAS = <><b>Fixas ou decrescentes</b>Fixas: o mesmo valor do primeiro ao último mês (o mais comum). Decrescentes: a primeira é a mais alta e a parcela cai todo mês. Costuma custar menos no total, mas pede mais no começo.</>;
export const firstOf = (r: SimResult) => r.firstInstallmentCents ?? r.installmentCents;
export const lastOf = (r: SimResult) => r.lastInstallmentCents ?? r.installmentCents;

/* ========================================================================== */
/*  Resultado                                                                  */
/* ========================================================================== */
export function ResultCard({ r, rate, month, best, title, expanded }: { r: SimResult; rate?: RateInfo; month: string; best?: boolean; title: string; expanded?: boolean }) {
  const [openState, setOpen] = useState(false);
  const open = expanded || openState;
  const interest = Math.max(0, r.totalPaidCents - r.vehicleValueCents - r.iofCents - r.feesTotalCents);
  return (
    <article className={`sim-result card ${best ? 'best' : ''}`} aria-label={title}>
      <header className="between">
        <h3>{title}<InfoTip label={`O que é ${r.modality === 'CDC' ? 'CDC' : 'leasing'}`}>{r.modality === 'CDC' ? TIP_CDC : TIP_LEASING}</InfoTip></h3>
        {best && <Badge tone="ok" dot>Menor custo total</Badge>}
      </header>
      <div className="sim-hero-num">
        <span className="lbl">{r.amortization === 'SAC' ? 'Primeira parcela' : 'Parcela mensal estimada'}</span>
        <strong>{brl(firstOf(r))}</strong>
        <small>{r.amortization === 'SAC' ? `cai todo mês até ${brl(lastOf(r))} na última · ${r.months} parcelas` : `${r.months} parcelas fixas`}{r.residualCents ? ` + residual de ${brl(r.residualCents)} no final (opcional)` : ''}</small>
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
      {!expanded && <button type="button" className="link-btn sim-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Ocultar' : 'Ver'} as {r.months} parcelas <Icon name="chevron-down" size={16} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>}
      {open && <ScheduleTable r={r} />}
      {open && r.residualCents > 0 && <p className="muted" style={{ fontSize: 13 }}>No leasing, o saldo final de {brl(r.residualCents)} é o valor residual: você só paga se quiser ficar com o veículo (vencimento: {dateBr(r.schedule.at(-1)!.dueDate)}).</p>}
    </article>
  );
}

export function Versus({ cdc, leasing, onAmortization, onCopied }: { cdc: SimResult; leasing: SimResult; onAmortization: (a: 'PRICE' | 'SAC') => void; onCopied: () => void }) {
  const win = cdc.totalPaidCents <= leasing.totalPaidCents ? 'CDC' : 'Leasing';
  const sac = cdc.amortization === 'SAC';
  type Row = { label: string; c: number; l: number; fmt: (n: number) => string; best?: boolean; plain?: boolean };
  const money = (n: number) => (n > 0 ? brl(n) : '—');
  const rows: Row[] = [
    { label: 'Taxa de juros', c: cdc.monthlyRatePct, l: leasing.monthlyRatePct, fmt: (n) => `${pct(n)} a.m.`, plain: true },
    { label: 'Primeira parcela', c: firstOf(cdc), l: firstOf(leasing), fmt: brl, best: true },
    { label: 'Última parcela', c: lastOf(cdc), l: lastOf(leasing), fmt: brl, best: true },
    { label: 'Residual no final (opcional)', c: cdc.residualCents, l: leasing.residualCents, fmt: money, plain: true },
    { label: 'Total pago', c: cdc.totalPaidCents, l: leasing.totalPaidCents, fmt: brl, best: true },
    { label: 'Custo do crédito', c: cdc.totalCostCents, l: leasing.totalCostCents, fmt: brl, best: true },
    { label: 'CET ao ano', c: cdc.cetAnnualPct, l: leasing.cetAnnualPct, fmt: (n) => pct(n), best: true }
  ];
  const cls = (r: Row, who: 'c' | 'l') => (r.best && (who === 'c' ? r.c < r.l : r.l < r.c) ? 'win' : '');
  const diffFirst = firstOf(cdc) - firstOf(leasing);
  const resPct = Math.round(leasing.residualCents / leasing.vehicleValueCents * 100);
  const why: string[] = [];
  if (leasing.residualCents > 0 && diffFirst > 0) why.push(`A primeira parcela do leasing é ${brl(diffFirst)} menor porque ${resPct}% do valor do veículo (${brl(leasing.residualCents)}) fica para o final. Se quiser ficar com o veículo, você paga esse valor de uma vez no fim.`);
  else if (leasing.residualCents > 0) why.push(`Neste cenário a parcela do leasing não ficou menor${leasing.monthlyRatePct > cdc.monthlyRatePct ? `: a taxa dele (${pct(leasing.monthlyRatePct)} a.m.) é maior que a do CDC (${pct(cdc.monthlyRatePct)} a.m.) e pesa mais que o residual de ${brl(leasing.residualCents)}` : ''}.`);
  else why.push('Sem valor residual, a diferença entre as parcelas vem só da taxa e das tarifas.');
  why.push(sac
    ? `Parcelas decrescentes: todo mês você amortiza o mesmo valor do principal e os juros caem junto com o saldo. No CDC a parcela vai de ${brl(firstOf(cdc))} a ${brl(lastOf(cdc))}; no leasing, de ${brl(firstOf(leasing))} a ${brl(lastOf(leasing))}.`
    : 'Parcelas fixas: o valor é o mesmo do primeiro ao último mês, no CDC e no leasing.');
  return (
    <section className="card card-pad stack sim-vs" aria-label="CDC e leasing lado a lado">
      <div className="sim-vs-verdict">
        <span className="lbl">Mais vantajoso no total</span>
        <strong>{win}</strong>
        <span>{brl(Math.abs(cdc.totalPaidCents - leasing.totalPaidCents))} a menos</span>
      </div>
      <table>
        <thead><tr>
          <th scope="col"><span className="sr-only">Item</span></th>
          <th scope="col">CDC<InfoTip label="O que é CDC">{TIP_CDC}</InfoTip></th>
          <th scope="col">Leasing<InfoTip label="O que é leasing">{TIP_LEASING}</InfoTip></th>
          <th scope="col" className="diff">Diferença</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = r.l - r.c;
            const hide = r.label.startsWith('Residual') || (r.label.startsWith('Residual') && r.c === 0);
            const gap = hide ? null : Math.abs(d) < 0.005 ? 'igual' : (
              <>{r.label.startsWith('Taxa') ? pct(Math.abs(d)) : r.fmt(Math.abs(d))}<small>{d < 0 ? 'menor no leasing' : 'menor no CDC'}</small></>
            );
            return (
              <tr key={r.label}>
                <th scope="row">{r.label}{gap && <span className="diff-m">{gap}</span>}</th>
                <td className={cls(r, 'c')}>{r.fmt(r.c)}</td>
                <td className={cls(r, 'l')}>{r.fmt(r.l)}</td>
                <td className="diff">{gap}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sim-why">
        <h4>Por que a parcela é diferente?</h4>
        {why.map((t) => <p key={t}>{t}</p>)}
        <div className="row" style={{ gap: 16 }}>
          <button type="button" className="link-btn" onClick={() => onAmortization(sac ? 'PRICE' : 'SAC')}>{sac ? 'Voltar para parcelas fixas' : 'Ver com parcelas decrescentes'}</button>
          <button type="button" className="link-btn" onClick={() => { void navigator.clipboard.writeText(window.location.href).then(() => onCopied(), () => undefined); }}>Copiar link desta simulação</button>
        </div>
      </div>
      {leasing.residualCents > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>No leasing, o total inclui o valor residual de {brl(leasing.residualCents)} para ficar com o veículo.</p>}
    </section>
  );
}

export function Results({ data, loading, error, onAmortization, onCopied, expanded }: { data: CalcResponse | null; loading: boolean; error: string | null; onAmortization: (a: 'PRICE' | 'SAC') => void; onCopied: () => void; expanded?: boolean }) {
  if (error && !data) return <Alert tone="warn" icon="alert-triangle" title="Confira os dados">{error}</Alert>;
  if (!data) return <div className="stack"><Skeleton h={120} r={16} /><Skeleton h={260} r={16} /></div>;
  const { cdc, leasing } = data.results;
  const both = Boolean(cdc && leasing);
  const cheaper = both ? (cdc!.totalPaidCents <= leasing!.totalPaidCents ? 'cdc' : 'leasing') : null;
  return (
    <div className={`stack ${loading ? 'sim-busy' : ''}`} aria-busy={loading}>
      {rateAge(data.referenceMonth) > 3 && <Alert tone="warn" icon="info" title="Taxas desatualizadas">As taxas médias usadas são de {monthRef(data.referenceMonth)}. Confirme a taxa com o banco antes de decidir, ou informe a taxa da sua proposta.</Alert>}
      {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      {data.errors.leasing && <Alert tone="warn" icon="info" title="Leasing não disponível neste cenário">{data.errors.leasing}</Alert>}
      {data.errors.cdc && <Alert tone="warn" icon="info" title="CDC não disponível neste cenário">{data.errors.cdc}</Alert>}
      {both && <Versus cdc={cdc!} leasing={leasing!} onAmortization={onAmortization} onCopied={onCopied} />}
      <div className={both ? 'sim-two' : undefined}>
        {cdc && <ResultCard r={cdc} rate={data.rates.cdc} month={data.referenceMonth} title="Financiamento CDC" best={cheaper === 'cdc'} expanded={expanded} />}
        {leasing && <ResultCard r={leasing} rate={data.rates.leasing} month={data.referenceMonth} title="Leasing" best={cheaper === 'leasing'} expanded={expanded} />}
      </div>
    </div>
  );
}


export const rateAge = (ym: string): number => { const [y, m] = ym.split('-').map(Number); if (!y || !m) return 0; const n = new Date(); return (n.getFullYear() - y) * 12 + (n.getMonth() + 1 - m); };
