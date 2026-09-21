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
  type OfficeTask,
} from './OfficeTypes';
import {
  type OfficeConsolidateOutcome,
  type OfficeProduceOutcome,
  type OfficeRunOptions,
  type OfficeRunResult,
  type OfficeRunnerPorts,
} from './officeRunnerContracts';
export type {
  OfficeConsolidateOutcome,
  OfficeProduceOutcome,
  OfficeRunOptions,
  OfficeRunResult,
  OfficeRunnerPorts,
} from './officeRunnerContracts';
import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';
import { canRunEngagement, transitionEngagement } from './officeEngagementTransitions';
import { withAuditEntry } from './OfficeEngagementRepository';
import { createRunCheckpoint } from './officeRunCheckpoint';
import { resumeInterruptedTasks } from './officeRunResumption';
import { chargeRunnerBudget, isRunnerBudgetExhausted, replaceRunnerTask, runnerBlockingFindings, runnerNowIso, withTaskTrace } from './officeRunnerState';


const DEFAULT_MAX_CONCURRENCY = 3;

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
  const { engagement: resumed } = resumeInterruptedTasks(initial, runId);
  let engagement = resumed;
  // Arrancar es un cambio de estado con su motivo: `transitionEngagement`
  // impide que se separen, que es como el `in-progress` inicial acabó sin
  // rastro y el `run-started` dos líneas más abajo.
  engagement = transitionEngagement(
    { ...engagement, currentRunId: runId },
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
    if (isRunnerBudgetExhausted(engagement)) {
      engagement = transitionEngagement(
        engagement,
        'blocked',
        'budget-exhausted',
        `Presupuesto agotado: ${engagement.budget.consumedAiCalls}/${engagement.budget.maxAiCalls} llamadas de IA.`,
      );
      await save();
      // Un checkpoint terminal que falla no puede comunicarse como una parada
      // ordenada: el estado que dice «presupuesto agotado» quizá no llegó.
      if (checkpoint.failure) return stoppedByPersistence();
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
      engagement = replaceRunnerTask(engagement, {
        ...task,
        status: 'in-progress',
        runId,
        // La identidad del intento de tarea nace una vez y sobrevive a la
        // reanudación: es lo que permite al puerto de producción reconocer un
        // efecto ya ejecutado en vez de repetirlo. Una corrección legítima
        // (`changes-requested`) abre otra identidad más abajo.
        executionId: task.executionId ?? newPrefixedId('office-task-exec'),
        startedAt: task.startedAt ?? runnerNowIso(),
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
    // El checkpoint que marca la tarea en curso es el último antes del efecto
    // externo. Si no se guardó, ejecutar los puertos gastaría llamadas de IA
    // cuyo resultado nadie puede atribuir a un estado durable — y una
    // reanudación repetiría el efecto. Se detiene antes de tocarlos.
    if (checkpoint.failure) return stoppedByPersistence();

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
        engagement = replaceRunnerTask(engagement, {
          ...task,
          status: 'failed',
          error: outcome.error,
          completedAt: runnerNowIso(),
        });
        engagement = withAuditEntry(engagement, 'task-failed', `"${task.title}" falló: ${outcome.error}`, { taskId: task.id });
        continue;
      }

      if ('produce' in outcome && outcome.produce) {
        engagement = chargeRunnerBudget(engagement, outcome.produce.aiCalls ?? 1);
        const traced = withTaskTrace(task, outcome.produce.traceId);
        if (outcome.produce.status === 'failed') {
          engagement = replaceRunnerTask(engagement, {
            ...traced,
            status: 'failed',
            error: outcome.produce.message ?? 'La producción del artefacto no se completó.',
            completedAt: runnerNowIso(),
          });
          engagement = withAuditEntry(
            engagement,
            'task-failed',
            `"${task.title}" no produjo un artefacto utilizable.`,
            { taskId: task.id },
          );
          continue;
        }
        engagement = replaceRunnerTask(engagement, {
          ...traced,
          status: 'completed',
          producedArtifactId: outcome.produce.artifactId,
          producedVersionGroupId: outcome.produce.versionGroupId,
          error: undefined,
          carriedFindings: undefined,
          completedAt: runnerNowIso(),
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
        engagement = chargeRunnerBudget(engagement, 1);
        const review = outcome.review;
        const producer = engagement.tasks.find((candidate) => candidate.id === task.reviewsTaskId);

        engagement = replaceRunnerTask(engagement, {
          ...withTaskTrace(task, review.traceId),
          status: 'completed',
          review,
          completedAt: runnerNowIso(),
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
          engagement = replaceRunnerTask(engagement, {
            ...producer,
            status: 'changes-requested',
            carriedFindings: runnerBlockingFindings(review.findings),
            // Corrección legítima ≠ reanudación: este reintento produce contenido
            // nuevo a partir de los hallazgos, así que abre otra identidad. La
            // reanudación tras un fallo conserva la suya — ésa es la diferencia
            // entre repetir trabajo y repetir un efecto.
            executionId: undefined,
            completedAt: undefined,
          });
          // The review task must run again after the re-production.
          engagement = replaceRunnerTask(engagement, {
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
          engagement = replaceRunnerTask(engagement, {
            ...producer,
            status: 'failed',
            error: `Revisión no superada tras ${producer.attempts} intento(s): ${review.summary}`,
            completedAt: runnerNowIso(),
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
        engagement = chargeRunnerBudget(engagement, outcome.consolidate.aiCalls ?? 1);
        engagement = replaceRunnerTask(engagement, {
          ...withTaskTrace(task, outcome.consolidate.traceId),
          status: outcome.consolidate.status === 'success' ? 'completed' : 'failed',
          error: outcome.consolidate.status === 'success' ? undefined : outcome.consolidate.summary,
          objective: task.objective,
          completedAt: runnerNowIso(),
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
        isTerminalTaskStatus(task.status) ? task : { ...task, status: 'cancelled', completedAt: runnerNowIso() }
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
    if (checkpoint.failure) return stoppedByPersistence();
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
    if (checkpoint.failure) return stoppedByPersistence();
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
  // El último checkpoint es el que deja constancia de que el encargo llegó al
  // comité. Si falla, no hubo «ejecución terminada»: el resultado es una avería
  // de persistencia, no un éxito que la pantalla celebraría.
  if (checkpoint.failure) return stoppedByPersistence();

  return {
    engagement,
    status: progress.failed > 0 ? 'partial' : 'completed',
    message: progress.failed > 0
      ? `El encargo terminó con ${progress.failed} entregable(s) fallidos; el comité debe decidir.`
      : 'El encargo está listo para el comité de arquitectura.',
  };
};
