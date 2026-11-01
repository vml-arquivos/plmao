import { pool } from '../db.js';
import { env, publicAppUrl } from '../config.js';
import { enqueueEmail } from './emailOutbox.js';

/**
 * Alertas da garagem por e-mail. Avisa uma única vez quando um lembrete aberto está perto de vencer
 * (até 7 dias, ou 500 km) e uma única vez quando vence. Só considera o que a própria pessoa registrou.
 * Quem desligou o aviso na garagem não recebe. Cada pessoa recebe um resumo por rodada, não um e-mail por item.
 */
export const SOON_DAYS = 7;
export const SOON_KM = 500;

type Stage = 'SOON' | 'OVERDUE';
interface Candidate { id: string; user_id: string; email: string; name: string; plate: string; model_label: string | null; title: string; due_date: string | null; due_km: number | null; vehicle_km: number | null; alert_soon_at: Date | null; alert_overdue_at: Date | null }

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const brDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

export function stageOf(c: Pick<Candidate, 'due_date' | 'due_km' | 'vehicle_km'>, today: string, soonLimit: string): Stage | null {
  if ((c.due_date && c.due_date < today) || (c.due_km != null && c.vehicle_km != null && c.vehicle_km >= c.due_km)) return 'OVERDUE';
  if ((c.due_date && c.due_date <= soonLimit) || (c.due_km != null && c.vehicle_km != null && c.due_km - c.vehicle_km <= SOON_KM)) return 'SOON';
  return null;
}

/** Roda uma rodada. `now` é injetável para teste. Devolve quantos e-mails foram agendados e quantos itens avisados. */
export async function runGarageAlerts(now = new Date()): Promise<{ emails: number; items: number }> {
  if (!env.GARAGE_ALERTS_ENABLED) return { emails: 0, items: 0 };
  const today = dayStr(now);
  const soonLimit = dayStr(new Date(now.getTime() + SOON_DAYS * 86_400_000));
  const r = await pool.query(
    `SELECT i.id,i.user_id,u.email,u.name,v.plate,v.model_label,i.title,i.due_date::text AS due_date,i.due_km,v.km AS vehicle_km,i.alert_soon_at,i.alert_overdue_at
       FROM garage_items i JOIN users u ON u.id=i.user_id JOIN saved_vehicles v ON v.id=i.vehicle_id
      WHERE i.kind='REMINDER' AND i.done_at IS NULL AND u.active AND u.garage_email_alerts
        AND (i.alert_soon_at IS NULL OR i.alert_overdue_at IS NULL)
        AND (i.due_date <= $1::date OR i.due_km IS NOT NULL)
      ORDER BY i.user_id, i.due_date NULLS LAST LIMIT 2000`, [soonLimit]);
  const byUser = new Map<string, Array<{ c: Candidate; stage: Stage }>>();
  for (const row of r.rows as Candidate[]) {
    const c = { ...row, due_km: row.due_km == null ? null : Number(row.due_km), vehicle_km: row.vehicle_km == null ? null : Number(row.vehicle_km) };
    const stage = stageOf(c, today, soonLimit);
    if (!stage) continue;
    if (stage === 'OVERDUE' ? c.alert_overdue_at : c.alert_soon_at) continue;
    const list = byUser.get(c.user_id) ?? [];
    list.push({ c, stage });
    byUser.set(c.user_id, list);
  }
  let emails = 0; let items = 0;
  for (const [userId, list] of byUser) {
    const first = list[0]!.c;
    const line = ({ c, stage }: { c: Candidate; stage: Stage }) => {
      const car = [c.model_label, c.plate].filter(Boolean).join(' · ');
      const when = c.due_date ? ` (${stage === 'OVERDUE' ? 'venceu em' : 'vence em'} ${brDate(c.due_date)})` : c.due_km != null ? ` (${c.due_km.toLocaleString('pt-BR')} km)` : '';
      return `- ${c.title}${when}: ${car}`;
    };
    const overdue = list.filter((x) => x.stage === 'OVERDUE');
    const soon = list.filter((x) => x.stage === 'SOON');
    const parts: string[] = [];
    if (overdue.length) parts.push(`Vencidos:\n${overdue.map(line).join('\n')}`);
    if (soon.length) parts.push(`Perto de vencer:\n${soon.map(line).join('\n')}`);
    const message = `${parts.join('\n\n')}\n\nVocê pode ver e concluir seus lembretes em ${publicAppUrl()}/app/garagem. Para parar de receber estes avisos, desligue-os na própria garagem. Os lembretes foram registrados por você.`;
    try {
      await enqueueEmail({ idempotencyKey: `garage-alerts:${userId}:${today}:${list.map((x) => `${x.c.id}${x.stage[0]}`).sort().join('')}`.slice(0, 240), template: 'GENERIC_NOTICE', toEmail: first.email, toName: first.name,
        data: { name: first.name, documentTitle: overdue.length ? 'Você tem lembretes vencidos na sua garagem' : 'Lembrete da sua garagem perto de vencer', message }, relatedType: 'GARAGE_ALERT', relatedId: userId });
      // Marca só depois de agendar. Vencido também encerra o aviso de "perto de vencer".
      for (const { c, stage } of list) {
        await pool.query(stage === 'OVERDUE' ? 'UPDATE garage_items SET alert_overdue_at=now(), alert_soon_at=coalesce(alert_soon_at,now()) WHERE id=$1' : 'UPDATE garage_items SET alert_soon_at=now() WHERE id=$1', [c.id]);
      }
      emails += 1; items += list.length;
    } catch { /* um e-mail com problema não trava os outros; tenta de novo na próxima rodada */ }
  }
  return { emails, items };
}

/** Roda ao iniciar e depois a cada 6 horas. */
export function startGarageAlerts(log: (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void): void {
  if (!env.GARAGE_ALERTS_ENABLED || env.NODE_ENV === 'test') return;
  const tick = () => { runGarageAlerts().catch((e) => log('error', 'garage_alerts_failed', { message: e instanceof Error ? e.message : 'unknown' })); };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}
