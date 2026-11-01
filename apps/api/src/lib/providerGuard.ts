import { appError } from './http.js';

/**
 * Travas de segurança para consultas que gastam crédito no fornecedor (Credify).
 *  - runExclusive: a mesma consulta (mesma chave) não roda duas vezes ao mesmo tempo, mesmo com clique duplo ou duas abas.
 *  - CallBudget: teto de chamadas pagas por hora e por dia; ao atingir, a fonte nem é chamada.
 * Ambas guardam o estado em memória do processo (a API roda em uma única instância). Reiniciar a API zera os contadores.
 */

const running = new Map<string, { token: symbol; startedAt: number }>();

/**
 * Executa `task` só se não houver outra execução com a mesma `key` em andamento; senão responde QUERY_IN_PROGRESS (409)
 * sem chamar a fonte. A trava é solta ao terminar (com sucesso ou erro). `staleAfterMs` evita trava eterna se algo não terminar.
 */
export async function runExclusive<T>(key: string, task: () => Promise<T>, staleAfterMs = 10 * 60_000, now: () => number = Date.now): Promise<T> {
  const current = running.get(key);
  if (current && now() - current.startedAt < staleAfterMs) throw appError('QUERY_IN_PROGRESS', { code: 'QUERY_IN_PROGRESS', http: 409, expose: true });
  const token = Symbol(key);
  running.set(key, { token, startedAt: now() });
  try {
    return await task();
  } finally {
    // Só solta a própria trava (uma execução antiga, já vencida, não pode soltar a de uma execução nova).
    if (running.get(key)?.token === token) running.delete(key);
  }
}

export function exclusiveRunning(): number { return running.size; }
export function resetExclusiveLocks(): void { running.clear(); }

type Failure = Error & { code: string; detail?: string };

/** Limites de chamadas pagas. 0 = sem limite naquele período. */
export interface BudgetLimits { perHour: number; perDay: number }

export class CallBudget {
  private stamps: number[] = [];
  constructor(private readonly now: () => number = Date.now) {}

  usage(at = this.now()): { lastHour: number; lastDay: number } {
    this.prune(at);
    return { lastHour: this.stamps.filter((t) => t > at - 3_600_000).length, lastDay: this.stamps.length };
  }

  /** Reserva uma chamada paga. Se o teto de hora ou de dia foi atingido, lança PROVIDER_BUDGET_EXCEEDED sem reservar. */
  take(limits: BudgetLimits): void {
    const at = this.now();
    const used = this.usage(at);
    if (limits.perHour > 0 && used.lastHour >= limits.perHour) throw budgetError(`Limite de segurança atingido: ${used.lastHour} consultas na última hora (máximo ${limits.perHour}). Nenhuma consulta nova foi enviada à Credify.`);
    if (limits.perDay > 0 && used.lastDay >= limits.perDay) throw budgetError(`Limite de segurança atingido: ${used.lastDay} consultas nas últimas 24 horas (máximo ${limits.perDay}). Nenhuma consulta nova foi enviada à Credify.`);
    this.stamps.push(at);
  }

  reset(): void { this.stamps = []; }

  private prune(at: number): void {
    const cutoff = at - 86_400_000;
    if (this.stamps.length && this.stamps[0] <= cutoff) this.stamps = this.stamps.filter((t) => t > cutoff);
  }
}

function budgetError(detail: string): Failure {
  return Object.assign(new Error('PROVIDER_BUDGET_EXCEEDED'), { code: 'PROVIDER_BUDGET_EXCEEDED', detail });
}
