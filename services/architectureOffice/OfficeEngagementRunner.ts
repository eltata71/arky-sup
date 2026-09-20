/**
 * Executes an engagement's task DAG.
 *
 * Design constraints that shaped this file:
 *
 *  - **No React, no Firestore, no AI SDK.** Everything the runner needs is an
 *    injected port, so the whole scheduler is testable with plain stubs.
 *  - **Persist on every transition.** The office runs in the browser tab; a
 *    reload must resume from the last completed task, not restart the
 *    engagement. `ports.persist` is awaited after each state change.
 *  - **Bounded everything.** Concurrency, review passes and AI calls all have
 *    ceilings. An engagement that cannot converge stops and says so instead of
 *    burning the budget.
 *  - **A failed task never aborts its siblings.** Only a missing dependency
 *    stops downstream work.
 */

import { newPrefixedId } from '../../lib/ids';
import {
  isTerminalTaskStatus,
  selectSchedulableTasks,
  summarizeEngagementProgress,
  type OfficeEngagement,
  type OfficeReviewFinding,
  type OfficeTask,
  type OfficeTaskReview,
} from './OfficeTypes';
import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';
import { canRunEngagement, transitionEngagement } from './officeEngagementTransitions';
import { withAuditEntry } from './OfficeEngagementRepository';
import { createRunCheckpoint } from './officeRunCheckpoint';
import type { PersistenceResult, PersistenceStatus } from '../persistence';

export interface OfficeProduceOutcome {
  status: 'success' | 'failed';
  artifactId?: string;
  versionGroupId?: string;
  /** Number of AI calls the production consumed. Charged to the budget. */
  aiCalls?: number;
  /**
   * The agent trace this production ran under.
   *
   * `executeAgentAction` has returned it since the agent shipped and the Office
   * discarded it, so a deliverable had no way back to the generation that made
   * it — the prompt, the phases, the versions, the rollback. Reported on
   * failure too: a run that produced nothing is exactly when the trace matters.
   */
  traceId?: string;
  message?: string;
}

export interface OfficeConsolidateOutcome {
  status: 'success' | 'failed';
  summary: string;
  aiCalls?: number;
  traceId?: string;
}

/**
 * Everything the runner needs from the outside world. The React layer supplies
 * adapters that route production through the existing `agentExecutor` path and
 * review through the artifact compiler plus a persona critique.
 */
export interface OfficeRunnerPorts {
  produceArtifact(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeProduceOutcome>;
  reviewArtifact(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeTaskReview>;
  consolidate(task: OfficeTask, engagement: OfficeEngagement): Promise<OfficeConsolidateOutcome>;
  /**
   * Llamado tras cada transición de estado. **Devuelve cómo fue.**
   *
   * Estaba tipado `Promise<void>`, y ése era el defecto más caro de los dos que
   * tenía este punto. El `catch` vacío de `save()` tragaba las excepciones; el
   * tipo hacía lo otro, que es peor: un fallo **sin** excepción —que es la
   * forma normal, un `{ status: 'conflict', success: false }`— era
   * indistinguible del éxito. El runner seguía gastando llamadas de IA contra
   * un estado que nadie había guardado, y el encargo que «se reanuda en vez de
   * reiniciarse» se reanudaba desde el último punto que sí llegó.
   *
   * No lanza: un puerto que lanza obliga a envolver cada llamada. Devuelve el
   * mismo envoltorio que el resto de la persistencia.
   */
  persist(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  /** Optional progress hook for the UI. Must not throw. */
  onProgress?(engagement: OfficeEngagement): void;
}

export interface OfficeRunOptions {
  /** Global ceiling on parallel tasks. Per-persona limits apply on top. */
  maxConcurrency?: number;
  /**
   * Capacity per agent, as this organisation configured it.
   *
   * The runner used to read `OFFICE_AGENT_PERSONAS[id].maxConcurrentTasks` —
   * the value the product ships with — while the agent's card let a user set
   * their own, validated it, persisted it and resolved it. The card promised a
   * limit the engine never read: raising Elena to 3 changed a number on a
   * screen and nothing else.
   *
   * Injected rather than looked up so the runner keeps its one useful property:
   * no React, no Firestore, no AI SDK, everything through a port. A missing
   * entry falls back to the persona's shipped value, so a caller that has no
   * profiles loaded behaves exactly as before.
   */
  agentConcurrency?: ReadonlyMap<string, number>;
  /** Correlation id for this attempt. Minted when the caller supplies none. */
  runId?: string;
  /**
   * Si esta sesión ya está ejecutando este encargo.
   *
   * Lo aporta quien llama porque es un hecho suyo, no del agregado: dos
   * pestañas son dos sesiones y ninguna ve el `AbortController` de la otra. La
   * exclusión entre sesiones la da la revisión optimista del encargo, que es
   * donde tiene que estar.
   */
  isRunning?: boolean;
  signal?: AbortSignal;
}

export interface OfficeRunResult {
  engagement: OfficeEngagement;
  status: 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget-exhausted'
    | 'not-persisted' | 'refused';
  message: string;
  /**
   * El fallo de persistencia que detuvo la ejecución, si la detuvo uno.
   *
   * Se distingue de `blocked` a propósito: un encargo bloqueado es un hecho de
   * negocio —una puerta de calidad, una tarea agotada— y se mira en la pantalla
   * del encargo. Esto es una avería, y lo que hay que hacer es recargar o
   * reintentar, no revisar el trabajo.
   */
  persistence?: PersistenceStatus;
}

const DEFAULT_MAX_CONCURRENCY = 3;

const nowIso = (): string => new Date().toISOString();

/** Append a correlation id to a task without losing the ones before it. */
const withTrace = (task: OfficeTask, traceId?: string): OfficeTask =>
  traceId ? { ...task, traceIds: [...(task.traceIds ?? []), traceId] } : task;

const replaceTask = (engagement: OfficeEngagement, task: OfficeTask): OfficeEngagement => ({
  ...engagement,
  tasks: engagement.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
  updatedAt: nowIso(),
});

const chargeBudget = (engagement: OfficeEngagement, calls: number): OfficeEngagement => ({
  ...engagement,
  budget: {
    ...engagement.budget,
    consumedAiCalls: engagement.budget.consumedAiCalls + Math.max(0, calls),
  },
});

const budgetExhausted = (engagement: OfficeEngagement): boolean =>
  engagement.budget.consumedAiCalls >= engagement.budget.maxAiCalls;

const blockingFindings = (findings: readonly OfficeReviewFinding[]): OfficeReviewFinding[] =>
  findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high');

/**
 * Ejecuta el encargo hasta un punto de parada.
 *
 * Se puede volver a llamar sobre el mismo encargo: las tareas ya terminales se
 * saltan, que es exactamente lo que hace posible reanudar tras una recarga.
 *
 * **La regla de gobierno se aplica aquí, no en quien llama.** «Nadie ejecuta un
 * charter que no se ha aprobado» es la regla que da sentido a una Oficina de
 * Arquitectura: ejecutar antes convierte la aprobación en un trámite posterior
 * a los hechos. `canRunEngagement` existía y era pura desde hace tiempo — pero
 * la llamaba `context/OfficeContext.tsx` y nadie más, así que la regla valía
 * mientras todo el mundo entrara por la pantalla. Cualquier otro llamante
 * —otro caso de uso, una prueba, un trabajo en segundo plano— arrancaba el
 * runner sin pasar por ella.
 *
 * Una invariante que se aplica en el llamante no es una invariante: es una
 * convención de un llamante, y el llamante es lo que más se copia.
 *
 * La exclusión de concurrencia sigue viniendo de fuera (`options.isRunning`)
 * porque «ya se está ejecutando» es un hecho de la sesión que ejecuta —un
 * `AbortController` vivo—, no del agregado. El dominio decide la regla; quien
 * corre sabe si su propio runner está ocupado.
 */
export const runEngagement = async (
  initial: OfficeEngagement,
  ports: OfficeRunnerPorts,
  options: OfficeRunOptions = {},
): Promise<OfficeRunResult> => {
  const verdict = canRunEngagement(initial, options.isRunning ?? false);
  if (verdict.outcome === 'refused') {
    return { engagement: initial, status: 'refused', message: verdict.refusal.message };
  }

  const maxConcurrency = Math.max(1, Math.min(6, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY));
  // One id per execution attempt. An engagement resumes rather than restarts,
  // so without it the second attempt appends to the same undifferentiated
  // sequence as the first and the audit trail cannot say which is which.
  const runId = options.runId ?? newPrefixedId('run');
  // Arrancar es un cambio de estado con su motivo: `transitionEngagement`
  // impide que se separen, que es como el `in-progress` inicial acabó sin
  // rastro y el `run-started` dos líneas más abajo.
  let engagement: OfficeEngagement = transitionEngagement(
    { ...initial, currentRunId: runId },
    'in-progress',
    'run-started',
    'La Oficina inició la ejecución del encargo.',
  );

  /**
   * Un punto de recuperación que no se guardó no detiene el trabajo **ya
   * hecho** —eso sería tirar minutos de generación— pero sí el que queda:
   * seguir programando tareas contra un estado que nadie tiene es gastar
   * llamadas de IA cuyo resultado se va a perder, y dejar un encargo que al
   * recargar se reanuda desde mucho antes de donde el usuario lo vio.
   */
  const checkpoint = createRunCheckpoint(ports.persist, ports.onProgress);
  const save = async (): Promise<void> => { engagement = await checkpoint.save(engagement); };
  const stoppedByPersistence = (): OfficeRunResult => ({
    engagement,
    status: 'not-persisted',
    message: checkpoint.message,
    persistence: checkpoint.failure ?? 'failed',
  });

  await save();
  if (checkpoint.failure) return stoppedByPersistence();

  const cancelled = (): boolean => options.signal?.aborted === true;

  while (!cancelled()) {
    // Se comprueba al principio de cada vuelta, no dentro de `save`: lo que ya
    // se generó se conserva y se informa, y lo que no ha empezado no empieza.
    if (checkpoint.failure) return stoppedByPersistence();
    if (budgetExhausted(engagement)) {
      engagement = transitionEngagement(
        engagement,
        'blocked',
        'budget-exhausted',
        `Presupuesto agotado: ${engagement.budget.consumedAiCalls}/${engagement.budget.maxAiCalls} llamadas de IA.`,
      );
      await save();
      return {
        engagement,
        status: 'budget-exhausted',
        message: 'El encargo se detuvo al agotar el presupuesto de llamadas de IA.',
      };
    }

    const schedulable = selectSchedulableTasks(engagement.tasks);
    if (schedulable.length === 0) break;

    // Respect each persona's declared capacity so one specialist is not
    // scheduled five times in parallel.
    const perPersonaInFlight = new Map<string, number>();
    const batch: OfficeTask[] = [];
    for (const task of schedulable) {
      if (batch.length >= maxConcurrency) break;
      const limit = options.agentConcurrency?.get(task.assigneeId)
        ?? OFFICE_AGENT_PERSONAS[task.assigneeId]?.maxConcurrentTasks
        ?? 1;
      const inFlight = perPersonaInFlight.get(task.assigneeId) ?? 0;
      if (inFlight >= limit) continue;
      perPersonaInFlight.set(task.assigneeId, inFlight + 1);
      batch.push(task);
    }

    if (batch.length === 0) {
      // Every schedulable task belongs to a persona already at capacity in this
      // pass; take the first one alone rather than spinning.
      batch.push(schedulable[0]);
    }

    // Mark the batch in-progress before running so a reload mid-batch shows
    // the truth rather than "pending".
    for (const task of batch) {
      engagement = replaceTask(engagement, {
        ...task,
        status: 'in-progress',
        runId,
        startedAt: task.startedAt ?? nowIso(),
        attempts: task.kind === 'produce-artifact' ? task.attempts + 1 : task.attempts,
      });
      engagement = withAuditEntry(
        engagement,
        'task-started',
        `${OFFICE_AGENT_PERSONAS[task.assigneeId].alias} inició "${task.title}".`,
        { taskId: task.id },
      );
    }
    await save();

    const outcomes = await Promise.all(batch.map(async (task) => {
      const current = engagement.tasks.find((candidate) => candidate.id === task.id) ?? task;
      try {
        if (current.kind === 'produce-artifact') {
          return { task: current, produce: await ports.produceArtifact(current, engagement) };
        }
        if (current.kind === 'review-artifact') {
          return { task: current, review: await ports.reviewArtifact(current, engagement) };
        }
        return { task: current, consolidate: await ports.consolidate(current, engagement) };
      } catch (error) {
        return {
          task: current,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));

    for (const outcome of outcomes) {
      const task = engagement.tasks.find((candidate) => candidate.id === outcome.task.id) ?? outcome.task;

      if ('error' in outcome && outcome.error) {
        engagement = replaceTask(engagement, {
          ...task,
          status: 'failed',
          error: outcome.error,
          completedAt: nowIso(),
        });
        engagement = withAuditEntry(engagement, 'task-failed', `"${task.title}" falló: ${outcome.error}`, { taskId: task.id });
        continue;
      }

      if ('produce' in outcome && outcome.produce) {
        engagement = chargeBudget(engagement, outcome.produce.aiCalls ?? 1);
        const traced = withTrace(task, outcome.produce.traceId);
        if (outcome.produce.status === 'failed') {
          engagement = replaceTask(engagement, {
            ...traced,
            status: 'failed',
            error: outcome.produce.message ?? 'La producción del artefacto no se completó.',
            completedAt: nowIso(),
          });
          engagement = withAuditEntry(
            engagement,
            'task-failed',
            `"${task.title}" no produjo un artefacto utilizable.`,
            { taskId: task.id },
          );
          continue;
        }
        engagement = replaceTask(engagement, {
          ...traced,
          status: 'completed',
          producedArtifactId: outcome.produce.artifactId,
          producedVersionGroupId: outcome.produce.versionGroupId,
          error: undefined,
          carriedFindings: undefined,
          completedAt: nowIso(),
        });
        engagement = withAuditEntry(
          engagement,
          'task-completed',
          `${OFFICE_AGENT_PERSONAS[task.assigneeId].alias} entregó "${task.title}".`,
          { taskId: task.id },
        );
        continue;
      }

      if ('review' in outcome && outcome.review) {
        engagement = chargeBudget(engagement, 1);
        const review = outcome.review;
        const producer = engagement.tasks.find((candidate) => candidate.id === task.reviewsTaskId);

        engagement = replaceTask(engagement, {
          ...withTrace(task, review.traceId),
          status: 'completed',
          review,
          completedAt: nowIso(),
        });

        if (review.verdict === 'approved' || !producer) {
          engagement = withAuditEntry(
            engagement,
            'task-completed',
            `${OFFICE_AGENT_PERSONAS[task.assigneeId].alias} aprobó "${producer?.title ?? task.title}".`,
            { taskId: task.id },
          );
          continue;
        }

        // Bounded reflection: the producer re-runs with the findings attached,
        // but only while it has attempts left. Otherwise the deliverable fails
        // with the reviewer's reasons rather than looping forever.
        const canRetry = review.verdict === 'changes-requested' && producer.attempts < producer.maxAttempts;
        if (canRetry) {
          engagement = replaceTask(engagement, {
            ...producer,
            status: 'changes-requested',
            carriedFindings: blockingFindings(review.findings),
            completedAt: undefined,
          });
          // The review task must run again after the re-production.
          engagement = replaceTask(engagement, {
            ...engagement.tasks.find((candidate) => candidate.id === task.id)!,
            status: 'pending',
            completedAt: undefined,
          });
          engagement = withAuditEntry(
            engagement,
            'task-changes-requested',
            `${OFFICE_AGENT_PERSONAS[task.assigneeId].alias} pidió cambios en "${producer.title}": ${review.summary}`,
            { taskId: producer.id },
          );
        } else {
          engagement = replaceTask(engagement, {
            ...producer,
            status: 'failed',
            error: `Revisión no superada tras ${producer.attempts} intento(s): ${review.summary}`,
            completedAt: nowIso(),
          });
          engagement = withAuditEntry(
            engagement,
            'task-failed',
            `"${producer.title}" no superó la revisión de ${OFFICE_AGENT_PERSONAS[task.assigneeId].alias}.`,
            { taskId: producer.id },
          );
        }
        continue;
      }

      if ('consolidate' in outcome && outcome.consolidate) {
        engagement = chargeBudget(engagement, outcome.consolidate.aiCalls ?? 1);
        engagement = replaceTask(engagement, {
          ...withTrace(task, outcome.consolidate.traceId),
          status: outcome.consolidate.status === 'success' ? 'completed' : 'failed',
          error: outcome.consolidate.status === 'success' ? undefined : outcome.consolidate.summary,
          objective: task.objective,
          completedAt: nowIso(),
        });
        engagement = withAuditEntry(
          engagement,
          outcome.consolidate.status === 'success' ? 'task-completed' : 'task-failed',
          outcome.consolidate.summary,
          { taskId: task.id },
        );
      }
    }

    await save();
  }

  if (cancelled()) {
    // Las tareas se cierran primero; el encargo cambia de estado después, con
    // su motivo, en una sola operación.
    const withCancelledTasks: OfficeEngagement = {
      ...engagement,
      tasks: engagement.tasks.map((task) => (
        isTerminalTaskStatus(task.status) ? task : { ...task, status: 'cancelled', completedAt: nowIso() }
      )),
    };
    engagement = transitionEngagement(
      withCancelledTasks,
      'blocked',
      'run-paused',
      'La ejecución fue cancelada por el usuario.',
      { before: engagement.status },
    );
    await save();
    return { engagement, status: 'cancelled', message: 'Ejecución cancelada.' };
  }

  const progress = summarizeEngagementProgress(engagement.tasks);
  const stuck = engagement.tasks.filter((task) => !isTerminalTaskStatus(task.status));

  if (stuck.length > 0) {
    engagement = transitionEngagement(
      engagement,
      'blocked',
      'engagement-blocked',
      `${stuck.length} tarea(s) no pueden avanzar porque una dependencia falló.`,
    );
    await save();
    return {
      engagement,
      status: 'blocked',
      message: `El encargo quedó bloqueado: ${stuck.length} tarea(s) dependen de un entregable que no se completó.`,
    };
  }

  engagement = transitionEngagement(
    engagement,
    'awaiting-arb',
    'submitted-to-arb',
    `Ejecución terminada: ${progress.completed}/${progress.total} tareas completadas.`,
  );
  await save();

  return {
    engagement,
    status: progress.failed > 0 ? 'partial' : 'completed',
    message: progress.failed > 0
      ? `El encargo terminó con ${progress.failed} entregable(s) fallidos; el comité debe decidir.`
      : 'El encargo está listo para el comité de arquitectura.',
  };
};
