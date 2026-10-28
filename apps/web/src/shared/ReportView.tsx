import { useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Badge, PlateBadge, Tabs } from './ui';
import { dateTime, money, vehicleStatusLabel } from './format';
import type { ItemState, ReportItem, ReportSection, ReportV2, Verdict } from './reportTypes';
import './report.css';

const VERDICT: Record<Verdict, { tone: string; icon: IconName; label: string }> = {
  CLEAR: { tone: 'ok', icon: 'shield-check', label: 'Sem alertas' },
  ATTENTION: { tone: 'warn', icon: 'alert-triangle', label: 'Atenção' },
  HIGH_RISK: { tone: 'danger', icon: 'shield-alert', label: 'Risco alto' },
  INCONCLUSIVE: { tone: 'info', icon: 'info', label: 'Análise parcial' }
};
const SECTION_ICON: Record<string, IconName> = { IDENTIFICACAO: 'car', CARACTERISTICAS: 'wrench', REGISTRO: 'file-text', DEBITOS: 'dollar', RESTRICOES: 'shield-alert', GRAVAME: 'credit-card', INSPECAO_RECALL: 'check-circle', HISTORICO: 'clock', FIPE: 'dollar', PROPRIETARIO: 'lock', INTERNO: 'settings' };

function StateMark({ state }: { state: ItemState }) {
  if (state === 'CLEAR') return <span className="rv-mark ok" title="Regular"><Icon name="check" size={14} strokeWidth={3} /></span>;
  if (state === 'ALERT') return <span className="rv-mark warn" title="Ponto de atenção"><Icon name="alert-triangle" size={14} strokeWidth={2.6} /></span>;
  return null;
}

function ItemRow({ item }: { item: ReportItem }) {
  const missing = item.state === 'NOT_PROVIDED';
  const text = missing ? 'Não informado pela fonte' : (item.display ?? item.value ?? '—');
  return (
    <div className={`rv-item ${item.state.toLowerCase()} ${item.component ? 'component' : ''}`}>
      <dt>{item.label}{item.component && <small> · detalhe do total de multas</small>}</dt>
      <dd className={missing ? 'missing' : ''}>
        <StateMark state={item.state} />
        <span className={item.masked ? 'mono' : ''}>{text}</span>
        {item.masked && <Icon name="lock" size={13} aria-label="Dado protegido" />}
      </dd>
    </div>
  );
}

function Section({ section, defaultOpen }: { section: ReportSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = section.status === 'ALERT' ? 'warn' : section.status === 'CLEAR' ? 'ok' : section.status === 'NOT_PROVIDED' ? 'neutral' : 'violet';
  const statusText = section.status === 'ALERT' ? 'Atenção' : section.status === 'CLEAR' ? 'Regular' : section.status === 'NOT_PROVIDED' ? 'Não informado' : `${section.providedCount} informado${section.providedCount === 1 ? '' : 's'}`;
  return (
    <section className={`rv-section ${open ? 'open' : ''}`}>
      <button type="button" className="rv-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`rv-sec-ico ${tone}`}><Icon name={SECTION_ICON[section.key] ?? 'file-text'} size={20} /></span>
        <span className="rv-sec-title"><b>{section.label}</b><small>{section.description}</small></span>
        <Badge tone={tone === 'neutral' ? 'neutral' : (tone as 'ok' | 'warn' | 'violet')}>{statusText}</Badge>
        <Icon name="chevron-down" className="rv-chev" size={18} />
      </button>
      <div className="rv-section-body" hidden={!open}>
        <dl className="rv-grid">{section.items.map((i) => <ItemRow key={i.key} item={i} />)}</dl>
      </div>
    </section>
  );
}

function Tile({ icon, label, value, tone, sub }: { icon: IconName; label: string; value: ReactNode; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; sub?: string }) {
  return <div className={`rv-tile ${tone}`}><span className="rv-tile-ico"><Icon name={icon} size={20} /></span><div><span className="k">{label}</span><b className="v">{value}</b>{sub && <small>{sub}</small>}</div></div>;
}

export interface ReportViewProps {
  report: ReportV2;
  consultedAt?: string | Date;
  productName?: string;
  verificationCode?: string;
  actions?: ReactNode;
  /** conteúdo exibido quando há pontos de atenção fora do plano (convite à consulta completa) */
  upsell?: ReactNode;
  audience?: 'client' | 'team';
}

export default function ReportView({ report, consultedAt, productName, verificationCode, actions, upsell, audience = 'client' }: ReportViewProps) {
  const [tab, setTab] = useState<'summary' | 'details'>('summary');
  const v = VERDICT[report.verdict.level];
  const h = report.headline;
  const title = [h.brand, h.model].filter(Boolean).join(' ') || h.fullModel || 'Veículo consultado';
  const sub = [h.manufactureYear && h.modelYear ? `${h.manufactureYear}/${h.modelYear}` : h.manufactureYear ?? h.modelYear, h.color, h.fuel].filter(Boolean).join(' · ');
  const place = [h.city, h.state].filter(Boolean).join(' / ');

  const bySection = useMemo(() => new Map(report.sections.map((s) => [s.key, s])), [report.sections]);
  const restrictions = bySection.get('RESTRICOES');
  const gravame = bySection.get('GRAVAME');
  const fineItem = report.debts.items.find((i) => i.key === 'VALORTOTALDEBITOMULTA');
  const finesProvided = report.sections.find((s) => s.key === 'DEBITOS')?.items.find((i) => i.key === 'EXISTEDEBITOMULTA')?.state !== 'NOT_PROVIDED';

  const debtTile = report.debtsHidden
    ? <Tile icon="dollar" label="Débitos" value="Fora do plano" tone="muted" sub="Disponível na consulta completa" />
    : !report.coverage.debtsProvided && !report.debts.hasDebt
      ? <Tile icon="dollar" label="Débitos pendentes" value="Não informado" tone="muted" sub="A fonte não retornou débitos" />
      : <Tile icon="dollar" label="Débitos pendentes" value={report.debts.hasDebt ? money(report.debts.totalCents) : 'R$ 0,00'} tone={report.debts.hasDebt ? 'warn' : 'ok'} sub={report.debts.hasDebt ? 'Regularize antes de transferir' : 'Nada a regularizar'} />;
  const fineTile = report.debtsHidden
    ? <Tile icon="receipt" label="Multas" value="Fora do plano" tone="muted" />
    : !finesProvided && !fineItem
      ? <Tile icon="receipt" label="Multas" value="Não informado" tone="muted" />
      : <Tile icon="receipt" label="Multas" value={fineItem ? money(fineItem.amountCents) : 'R$ 0,00'} tone={fineItem ? 'warn' : 'ok'} />;
  const sectionTile = (s: ReportSection | undefined, icon: IconName, label: string) => !s
    ? <Tile icon={icon} label={label} value="Fora do plano" tone="muted" sub="Disponível na consulta completa" />
    : s.status === 'ALERT' ? <Tile icon={icon} label={label} value="Ocorrência" tone="danger" sub="Veja os detalhes" />
      : s.status === 'CLEAR' ? <Tile icon={icon} label={label} value="Nada consta" tone="ok" />
        : <Tile icon={icon} label={label} value="Não informado" tone="muted" sub="A fonte não retornou este dado" />;

  const facts = [...(bySection.get('IDENTIFICACAO')?.items ?? []), ...(bySection.get('CARACTERISTICAS')?.items ?? []), ...(bySection.get('REGISTRO')?.items ?? [])].filter((i) => i.state !== 'NOT_PROVIDED' && i.state !== 'ALERT' && !['PLACA', 'MARCA', 'MODELO', 'MARCAMODELOCOMPLETO'].includes(i.key)).slice(0, 12);
  const alertItems = report.sections.flatMap((s) => s.items.filter((i) => i.state === 'ALERT' && !i.component && i.kind !== 'money'));
  const visibleSections = report.sections.filter((s) => audience === 'team' || s.key !== 'INTERNO');

  return (
    <article className="rv" aria-label={`Relatório do veículo ${report.plate}`}>
      <header className="rv-head card">
        <PlateBadge plate={report.plate} size="lg" />
        <div className="rv-title">
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
          {place && <p className="rv-place"><Icon name="map-pin" size={15} /> {place}</p>}
          <div className="rv-meta">
            {h.status && <Badge tone={/ALERT|BAIXA|ROUBO|FURTO/i.test(h.status) ? 'danger' : 'ok'} dot>{vehicleStatusLabel(h.status)}</Badge>}
            {productName && <Badge tone="violet">{productName}</Badge>}
            {consultedAt && <span className="muted">Consultado em {dateTime(consultedAt)}</span>}
          </div>
        </div>
        {actions && <div className="rv-actions no-print">{actions}</div>}
      </header>

      <div className={`rv-verdict ${v.tone}`} role="status">
        <span className="rv-verdict-ico"><Icon name={v.icon} size={28} /></span>
        <div className="grow">
          <span className="rv-verdict-tag">{v.label}</span>
          <h3>{report.verdict.title}</h3>
          <p>{report.verdict.reason}</p>
        </div>
      </div>

      {!!report.lockedAlertCount && upsell && <div className="rv-upsell no-print">{upsell}</div>}

      <div className="rv-tiles">
        <Tile icon="car" label="Situação do veículo" value={h.status ? vehicleStatusLabel(h.status) : 'Não informada'} tone={h.status ? (/ALERT|BAIXA|ROUBO|FURTO/i.test(h.status) ? 'danger' : 'ok') : 'muted'} />
        {debtTile}
        {fineTile}
        {sectionTile(restrictions, 'shield-alert', 'Restrições')}
        {gravame && sectionTile(gravame, 'credit-card', 'Financiamento / gravame')}
      </div>

      <div className="rv-tabs no-print"><Tabs label="Visões do relatório" value={tab} onChange={setTab} items={[{ id: 'summary', label: 'Resumo' }, { id: 'details', label: 'Detalhes completos' }]} /></div>

      {(
        <div className={`rv-panel ${tab === 'summary' ? '' : 'rv-hide-screen'}`}>
          {alertItems.length > 0 && (
            <section className="card rv-card">
              <h3><Icon name="alert-triangle" size={20} /> Pontos de atenção</h3>
              <ul className="rv-alerts">{alertItems.map((i) => <li key={i.key} className={i.high ? 'high' : ''}><b>{i.label}</b><span>{i.display ?? i.value}</span></li>)}</ul>
            </section>
          )}
          {report.debts.items.length > 0 && !report.debtsHidden && (
            <section className="card rv-card">
              <h3><Icon name="dollar" size={20} /> Débitos</h3>
              <table className="rv-debts"><tbody>
                {report.debts.items.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num r">{money(d.amountCents)}</td></tr>)}
                <tr className="total"><td>Total em aberto</td><td className="num r">{money(report.debts.totalCents)}</td></tr>
              </tbody></table>
              {report.debts.fineBreakdown.length > 0 && <div className="rv-fines"><b>Multas por órgão</b><ul>{report.debts.fineBreakdown.map((f) => <li key={f.key}><span>{f.label}</span><span className="num">{money(f.amountCents)}</span></li>)}</ul><small>{report.debts.note}</small></div>}
            </section>
          )}
          <section className="card rv-card">
            <h3><Icon name="car" size={20} /> Ficha do veículo</h3>
            <dl className="rv-grid">{facts.map((i) => <ItemRow key={i.key} item={i} />)}</dl>
          </section>
        </div>
      )}

      <div className={`rv-panel rv-sections ${tab === 'details' ? '' : 'rv-hide-screen'}`}>
        {visibleSections.map((s) => <Section key={s.key} section={s} defaultOpen={s.status === 'ALERT'} />)}
      </div>

      <footer className="rv-foot">
        <p><Icon name="info" size={16} /> {report.coverage.provided} de {report.coverage.total} campos foram informados pela fonte contratada. Campos <b>não informados</b> não significam “nada consta”: apenas não vieram nesta consulta.</p>
        {!!report.scope?.notIncluded.length && <p>Não incluído neste produto: {report.scope.notIncluded.map((n) => n.label).join(', ')}. Isso não significa ausência de ocorrências.</p>}
        <p>Este relatório apoia sua decisão, mas não substitui vistoria, certidões ou consulta aos órgãos competentes. Dados pessoais são exibidos de forma protegida (LGPD).</p>
        {verificationCode && <p>Código de verificação: <b className="mono">{verificationCode}</b></p>}
      </footer>
    </article>
  );
}
