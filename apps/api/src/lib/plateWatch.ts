import { pool } from '../db.js';
import { env, publicAppUrl } from '../config.js';
import { enqueueEmail } from './emailOutbox.js';
import { scopeForProduct } from './reportScope.js';
import { tierForProductCode, viewReport } from '../report/normalizeV2.js';
import type { AdviceCheck, CheckStatus } from '../report/advice.js';
import type { NormalizedVehicle } from '../types.js';
import { siteOpenFor } from '../siteAccess.js';

/**
 * Monitoramento de placa. O cliente escolhe a placa, o tipo de consulta e o intervalo (7, 15 ou 30 dias).
 * Em cada rodada o sistema faz uma consulta normal, cobrada do saldo dele (com o mesmo estorno em caso de falha),
 * compara com a consulta anterior e avisa por e-mail se alguma verificação piorou.
 * Sem saldo, o monitoramento pausa e avisa. Três falhas seguidas também pausam.
 */
export const WATCH_INTERVALS = [7, 15, 30] as const;
export const WATCH_MAX_PER_USER = 20;
const MAX_FAILURES = 3;
const BATCH = 10;

const RANK: Record<CheckStatus, number> = { NOT_CHECKED: 0, OK: 0, ATTENTION: 1, ALERT: 2 };
const WORD: Record<CheckStatus, string> = { NOT_CHECKED: 'não consultado', OK: 'sem ocorrência', ATTENTION: 'atenção', ALERT: 'alerta' };

export interface WatchChange { key: string; label: string; from: CheckStatus | null; to: CheckStatus }

/** Verificações do relatório do cliente (as mesmas do "Antes de pagar"), para comparar duas consultas. */
export function checksOf(normalized: NormalizedVehicle | null | undefined, productId: string, at: Date): AdviceCheck[] {
  const v2 = normalized?.v2;
  if (!v2) return [];
  const scope = scopeForProduct(productId, at);
  const view = viewReport(v2, { audience: 'client', tier: tierForProductCode(productId), sections: scope.sections, template: scope.template });
  return view.advice?.checks ?? [];
}

/** Só conta o que piorou: ocorrência nova ou mais grave. Melhora e "não consultado" não geram aviso. */
export function worsened(before: AdviceCheck[], after: AdviceCheck[]): WatchChange[] {
  const prev = new Map(before.map((c) => [c.key, c.status]));
  const out: WatchChange[] = [];
  for (const c of after) {
    const old = prev.get(c.key) ?? null;
    if (RANK[c.status] > RANK[old ?? 'OK']) out.push({ key: c.key, label: c.label, from: old, to: c.status });
  }
  return out;
}

export type RunQuery = (input: { userId: string; plate: string; searchType: 'PLATE'; productId: string; idempotencyKey: string | null; reqId: string; source: 'WEB' }) => Promise<{ status: number; body: Record<string, unknown> }>;
type Log = (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void;

interface WatchRow { id: string; user_id: string; plate: string; product_id: string; interval_days: number; failures: number; baseline_query_id: string | null; pending_query_id: string | null; email: string; name: string; product_name: string }

const WATCH_SQL = `SELECT w.id,w.user_id,w.plate,w.product_id,w.interval_days,w.failures,w.baseline_query_id,w.pending_query_id,u.email,u.name,p.name AS product_name
  FROM plate_watches w JOIN users u ON u.id=w.user_id JOIN query_products p ON p.id=w.product_id`;

async function event(watchId: string, kind: string, queryId: string | null, summary: Record<string, unknown>) {
  await pool.query('INSERT INTO plate_watch_events(watch_id,kind,query_id,summary) VALUES($1,$2,$3,$4::jsonb)', [watchId, kind, queryId, JSON.stringify(summary)]);
}

async function notify(w: WatchRow, key: string, title: string, message: string) {
  try {
    await enqueueEmail({ idempotencyKey: key.slice(0, 240), template: 'GENERIC_NOTICE', toEmail: w.email, toName: w.name, data: { name: w.name, documentTitle: title, message }, relatedType: 'PLATE_WATCH', relatedId: w.id });
  } catch { /* e-mail com problema não trava o monitoramento; o histórico fica na tela */ }
}

async function loadQuery(queryId: string | null) {
  if (!queryId) return null;
  const r = await pool.query(`SELECT q.id,q.product_id,q.status,q.completed_at,q.created_at,r.normalized FROM vehicle_queries q LEFT JOIN vehicle_query_results r ON r.query_id=q.id WHERE q.id=$1`, [queryId]);
  return r.rowCount ? (r.rows[0] as { id: string; product_id: string; status: string; completed_at: Date | null; created_at: Date; normalized: NormalizedVehicle | null }) : null;
}

/** Fecha uma rodada com consulta concluída: compara com a anterior, registra e avisa se piorou. */
async function settle(w: WatchRow, queryId: string): Promise<'BASELINE' | 'NO_CHANGE' | 'CHANGED'> {
  const fresh = await loadQuery(queryId);
  const old = await loadQuery(w.baseline_query_id);
  const now = checksOf(fresh?.normalized, w.product_id, new Date(fresh?.completed_at ?? fresh?.created_at ?? Date.now()));
  let kind: 'BASELINE' | 'NO_CHANGE' | 'CHANGED' = 'BASELINE';
  let changes: WatchChange[] = [];
  if (old?.normalized) {
    const before = checksOf(old.normalized, w.product_id, new Date(old.completed_at ?? old.created_at));
    changes = worsened(before, now);
    kind = changes.length ? 'CHANGED' : 'NO_CHANGE';
  }
  await event(w.id, kind, queryId, { changes, checked: now.length });
  await pool.query(`UPDATE plate_watches SET baseline_query_id=$2,pending_query_id=NULL,last_checked_at=now(),next_check_at=now() + make_interval(days => interval_days),failures=0,runs=runs+1,updated_at=now() WHERE id=$1`, [w.id, queryId]);
  if (kind === 'CHANGED') {
    const lines = changes.map((c) => `- ${c.label}: ${c.from ? `${WORD[c.from]} → ` : ''}${WORD[c.to]}`).join('\n');
    await notify(w, `plate-watch-change:${w.id}:${queryId}`, `Mudança no veículo ${w.plate}`, `A verificação automática do veículo ${w.plate} (${w.product_name}) encontrou algo novo:\n\n${lines}\n\nO relatório completo já está no seu histórico: ${publicAppUrl()}/app/consulta/${queryId}\nOs monitoramentos ficam em ${publicAppUrl()}/app/monitoramento.`);
  }
  return kind;
}

async function pause(w: WatchRow, reason: 'SALDO' | 'FALHAS', queryId: string | null) {
  await pool.query(`UPDATE plate_watches SET status='PAUSED',pause_reason=$2,pending_query_id=NULL,updated_at=now() WHERE id=$1`, [w.id, reason]);
  await event(w.id, 'PAUSED', queryId, { reason });
  const why = reason === 'SALDO' ? 'Seu saldo não cobre a próxima verificação. Adicione saldo e retome o monitoramento.' : 'A verificação falhou três vezes seguidas. Retome quando quiser; nenhuma falha foi cobrada.';
  await notify(w, `plate-watch-paused:${w.id}:${reason}:${new Date().toISOString().slice(0, 10)}`, `Monitoramento pausado: ${w.plate}`, `O monitoramento do veículo ${w.plate} (${w.product_name}) foi pausado. ${why}\n\n${publicAppUrl()}/app/monitoramento`);
}

async function fail(w: WatchRow, code: string, queryId: string | null) {
  const failures = w.failures + 1;
  await pool.query(`UPDATE plate_watches SET failures=$2,pending_query_id=NULL,next_check_at=now() + interval '1 day',updated_at=now() WHERE id=$1`, [w.id, failures]);
  await event(w.id, 'FAILED', queryId, { code });
  if (failures >= MAX_FAILURES) await pause({ ...w, failures }, 'FALHAS', queryId);
}

/** Uma passada: fecha as rodadas que ficaram em andamento e inicia as que venceram. */
export async function runDueWatches(runQuery: RunQuery, log: Log = () => undefined, limit = BATCH): Promise<{ started: number; settled: number; paused: number }> {
  let started = 0; let settled = 0; let paused = 0;
  const pending = await pool.query(`${WATCH_SQL} WHERE w.status='ACTIVE' AND w.pending_query_id IS NOT NULL ORDER BY w.updated_at LIMIT $1`, [limit]);
  for (const w of pending.rows as WatchRow[]) {
    try {
      const q = await loadQuery(w.pending_query_id);
      if (!q) { await fail(w, 'QUERY_GONE', null); continue; }
      if (q.status === 'SUCCESS') { await settle(w, q.id); settled += 1; } else if (q.status !== 'PROCESSING') await fail(w, 'QUERY_NOT_COMPLETED', q.id);
    } catch (e) { log('warn', 'plate_watch_settle_failed', { watchId: w.id, error: e instanceof Error ? e.message : 'unknown' }); }
  }
  const due = await pool.query(`${WATCH_SQL} WHERE w.status='ACTIVE' AND w.pending_query_id IS NULL AND w.next_check_at <= now() ORDER BY w.next_check_at LIMIT $1`, [limit]);
  for (const w of due.rows as WatchRow[]) {
    if (!siteOpenFor(w.email)) continue;
    try {
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const out = await runQuery({ userId: w.user_id, plate: w.plate, searchType: 'PLATE', productId: w.product_id, idempotencyKey: `watch-${w.id}-${day}`, reqId: `watch-${w.id}`, source: 'WEB' });
      started += 1;
      const id = typeof out.body.id === 'string' ? out.body.id : null;
      if ((out.status === 200 || out.status === 201) && id) { await settle(w, id); settled += 1; }
      else if (out.status === 202 && id) await pool.query('UPDATE plate_watches SET pending_query_id=$2,updated_at=now() WHERE id=$1', [w.id, id]);
      else if (out.status === 402 || out.body.error === 'INSUFFICIENT_BALANCE') { await pause(w, 'SALDO', null); paused += 1; }
      else if (out.body.error === 'QUERY_IN_PROGRESS') await pool.query(`UPDATE plate_watches SET next_check_at=now() + interval '1 hour',updated_at=now() WHERE id=$1`, [w.id]);
      else await fail(w, String(out.body.error ?? out.status), null);
    } catch (e) {
      log('warn', 'plate_watch_run_failed', { watchId: w.id, error: e instanceof Error ? e.message : 'unknown' });
      try { await fail(w, 'RUN_ERROR', null); } catch { /* tenta de novo na próxima passada */ }
    }
  }
  return { started, settled, paused };
}

/** Roda 2 minutos depois de iniciar e depois a cada 30 minutos. Desligado em teste e com PLATE_WATCH_ENABLED=false. */
export function startPlateWatch(runQuery: RunQuery, log: Log): void {
  if (!env.PLATE_WATCH_ENABLED || env.NODE_ENV === 'test') return;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { const r = await runDueWatches(runQuery, log); if (r.started || r.settled) log('info', 'plate_watch_round', r); } catch (e) { log('warn', 'plate_watch_round_failed', { error: e instanceof Error ? e.message : 'unknown' }); } finally { busy = false; }
  };
  setTimeout(() => void tick(), 120_000).unref();
  setInterval(() => void tick(), 30 * 60_000).unref();
}
