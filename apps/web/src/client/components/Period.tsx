import { Input } from '../../shared/ui';

export interface Period { days: string; from: string; to: string }
export const NO_PERIOD: Period = { days: '', from: '', to: '' };

/** Converte o período em parâmetros de URL (vazio = sem filtro). */
export function periodParams(p: Period): Record<string, string> {
  const o: Record<string, string> = {};
  if (p.days && p.days !== 'custom') o.days = p.days; else { if (p.from) o.from = p.from; if (p.to) o.to = p.to; }
  return o;
}
export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

const CHIPS = [['', 'Tudo'], ['30', '30 dias'], ['60', '60 dias'], ['90', '90 dias'], ['custom', 'Datas']] as const;

/** Filtro de período em chips: tudo, 30/60/90 dias ou datas escolhidas. */
export default function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const custom = !value.days && Boolean(value.from || value.to) || value.days === 'custom';
  const active = custom ? 'custom' : value.days;
  return (
    <div className="period">
      <div className="chips" role="group" aria-label="Período">
        {CHIPS.map(([id, label]) => (
          <button key={id} type="button" className="chip-btn" aria-pressed={active === id} onClick={() => onChange(id === 'custom' ? { days: 'custom', from: value.from, to: value.to } : { days: id, from: '', to: '' })}>{label}</button>
        ))}
      </div>
      {custom && (
        <div className="period-dates">
          <Input type="date" aria-label="Data inicial" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ days: 'custom', from: e.target.value, to: value.to })} />
          <span className="muted">até</span>
          <Input type="date" aria-label="Data final" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ days: 'custom', from: value.from, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}
