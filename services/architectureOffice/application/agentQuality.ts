/**
 * Cómo trabaja cada agente, no sólo cómo es (plan de agentes 20.1).
 *
 * Se deriva de los encargos que el usuario ya tiene —tareas, intentos,
 * mediciones de 15.2— y no se almacena: una cifra guardada aparte sería una
 * segunda fuente que se queda vieja. Las reglas de honestidad son las del resto
 * del producto:
 *
 * - **Sin medir no es cero.** Un agente sin tareas en la ventana, o sin
 *   mediciones de latencia o coste, devuelve `null` en esa cifra.
 * - **El coste sólo se suma si todas las llamadas tienen estimación** (la misma
 *   regla que `summarizeAgentUsage`): una suma parcial parece un total.
 * - **Lo que no se registra se dice.** Los handoffs rechazados viven en el
 *   resultado de la coordinación, no en el encargo; hasta que se persistan, esa
 *   cifra es `null` y la pantalla lo explica en vez de pintar un 0.
 */

import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import type { OfficeEngagement, OfficeTask } from '../domain/OfficeTypes';

export type QualityWindowDays = 7 | 30;

export interface AgentQualityRow {
  agentId: OfficeAgentId;
  /** Tareas del agente que cayeron en la ventana. */
  tasks: number;
  /** Tareas de producción terminadas a la primera, sobre las terminadas. `null` si ninguna terminó. */
  firstPassApprovalRate: number | null;
  /** Re-ejecuciones por `changes-requested`: intentos por encima del primero. */
  retries: number;
  /** Suma estimada en USD; `null` si no hay llamadas o alguna no tiene estimación. */
  estimatedCostUsd: number | null;
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
  /** Operaciones con handoffs rechazados: aún no se registran por encargo. */
  operationsWithRejectedHandoffs: null;
}

export interface AgentQualityReport {
  windowDays: QualityWindowDays;
  since: string;
  rows: AgentQualityRow[];
}

const DAY_MS = 86_400_000;

/** El instante que sitúa una tarea en el tiempo: lo último que le pasó. */
const taskInstant = (task: OfficeTask): number | null => {
  const iso = task.completedAt ?? task.startedAt ?? task.createdAt;
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
};

/** Percentil por rango más cercano sobre valores ya ordenados. */
const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
};

export const buildAgentQualityReport = (
  engagements: readonly OfficeEngagement[],
  windowDays: QualityWindowDays,
  now: number,
): AgentQualityReport => {
  const since = now - windowDays * DAY_MS;
  const byAgent = new Map<OfficeAgentId, OfficeTask[]>();
  for (const engagement of engagements) {
    for (const task of engagement.tasks ?? []) {
      const instant = taskInstant(task);
      // Sin fecha no se puede situar en una ventana: se deja fuera en vez de
      // contarla en todas.
      if (instant === null || instant < since || instant > now) continue;
      const list = byAgent.get(task.assigneeId) ?? [];
      list.push(task);
      byAgent.set(task.assigneeId, list);
    }
  }

  const rows: AgentQualityRow[] = [...byAgent.entries()].map(([agentId, tasks]) => {
    const produced = tasks.filter((task) => task.kind === 'produce-artifact' && task.status === 'completed');
    const measurements = tasks.flatMap((task) => task.measurements ?? []);
    const latencies = measurements
      .map((item) => item.latencyMs)
      // Una llamada sin latencia medida llega como 0 (`unknownInvocation`).
      .filter((value) => value > 0)
      .sort((left, right) => left - right);
    return {
      agentId,
      tasks: tasks.length,
      firstPassApprovalRate: produced.length === 0
        ? null
        : produced.filter((task) => task.attempts <= 1).length / produced.length,
      retries: tasks.reduce((sum, task) => sum + Math.max(0, task.attempts - 1), 0),
      estimatedCostUsd: measurements.length > 0 && measurements.every((item) => item.estimatedCostUsd !== null)
        ? measurements.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0)
        : null,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP90Ms: percentile(latencies, 0.9),
      operationsWithRejectedHandoffs: null,
    };
  });
  rows.sort((left, right) => right.tasks - left.tasks || left.agentId.localeCompare(right.agentId));
  return { windowDays, since: new Date(since).toISOString(), rows };
};
