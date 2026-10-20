import type { ReactNode } from 'react';
import { Icon, type IconName } from '../shared/icons';
import { Badge } from '../shared/ui';
import { PAYMENT_STATUS, QUERY_STATUS } from './api';

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {actions && <div className="row no-print">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'danger' }) {
  return <div className={`kpi ${tone ?? ''}`}><span className="k">{label}</span><span className="v num">{value}</span>{sub && <span className="s">{sub}</span>}</div>;
}

export function Card({ title, actions, children, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="adm-card">
      {title && <header><h3>{title}</h3>{actions && <div className="row">{actions}</div>}</header>}
      {pad ? <div className="body">{children}</div> : children}
    </section>
  );
}

export const QueryStatusBadge = ({ status }: { status: string }) => { const s = QUERY_STATUS[status] ?? { label: status, tone: 'neutral' as const }; return <Badge tone={s.tone} dot>{s.label}</Badge>; };
export const PaymentStatusBadge = ({ status }: { status: string }) => { const s = PAYMENT_STATUS[status] ?? { label: status, tone: 'neutral' as const }; return <Badge tone={s.tone} dot>{s.label}</Badge>; };

export function Ico({ name, size = 16 }: { name: IconName; size?: number }) { return <Icon name={name} size={size} />; }

/** Gráfico de barras simples (SVG) para séries diárias; até 2 séries lado a lado. */
export function BarChart({ labels, series, format }: { labels: string[]; series: Array<{ name: string; values: number[]; cls: 'bar' | 'bar2' }>; format?: (n: number) => string }) {
  const W = 720, H = 190, padL = 8, padB = 22, padT = 10;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length || 1;
  const slot = (W - padL * 2) / n;
  const bw = Math.max(2, Math.min(18, (slot - 4) / series.length));
  const y = (v: number) => H - padB - ((H - padB - padT) * v) / max;
  const f = format ?? ((v: number) => String(v));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gráfico diário">
      {[0, .5, 1].map((t) => <line key={t} className="grid" x1={padL} x2={W - padL} y1={y(max * t)} y2={y(max * t)} />)}
      {labels.map((l, i) => series.map((s, k) => {
        const v = s.values[i] ?? 0; const x = padL + i * slot + (slot - bw * series.length) / 2 + k * bw;
        return <rect key={`${i}-${k}`} className={s.cls} x={x} y={y(v)} width={bw - 1} height={Math.max(0, H - padB - y(v))} rx={2}><title>{`${l} · ${s.name}: ${f(v)}`}</title></rect>;
      }))}
      {labels.map((l, i) => (i % Math.ceil(n / 6) === 0 ? <text key={l} x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle">{l.slice(5).split('-').reverse().join('/')}</text> : null))}
    </svg>
  );
}

export const asNumber = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
