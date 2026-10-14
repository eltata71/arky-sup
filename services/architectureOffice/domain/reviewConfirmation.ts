/**
 * Una aprobación sin crítica del especialista la confirma una persona
 * (plan de agentes, 17.1 · A16 · D-A5).
 *
 * Si el modelo del revisor no respondía, devolvía JSON roto o una respuesta
 * vacía, el veredicto salía `approved` en cuanto la evidencia determinista no
 * bloqueaba, con el resumen «el entregable cumple su contrato»: una revisión
 * que nadie hizo, presentada como hecha. Ahora esa aprobación se marca
 * `evidence-only`, la tarea queda en `awaiting-review` y el encargo no pasa de
 * ahí hasta que alguien la confirme aquí, con su nombre en la auditoría.
 */
import { withAuditEntry } from './officeEngagementRecord';
import type { OfficeTransitionResult } from './OfficeArbService';
import type { OfficeActor, OfficeEngagement, OfficeTask } from './OfficeTypes';

/** ¿Es una revisión aprobada sólo con evidencia que todavía nadie confirmó? */
export const awaitsReviewConfirmation = (task: OfficeTask): boolean =>
  task.kind === 'review-artifact'
  && task.status === 'awaiting-review'
  && task.review?.verdict === 'approved'
  && task.review.basis === 'evidence-only'
  && task.review.humanConfirmation === undefined;

export const confirmEvidenceOnlyReview = (
  engagement: OfficeEngagement,
  taskId: string,
  actor: OfficeActor,
  now: () => string = () => new Date().toISOString(),
): OfficeTransitionResult => {
  const task = engagement.tasks.find((candidate) => candidate.id === taskId);
  if (!task || !task.review) {
    return { ok: false, engagement, reason: 'Esa revisión no existe en el encargo.' };
  }
  if (!awaitsReviewConfirmation(task)) {
    return { ok: false, engagement, reason: 'Esa revisión no espera confirmación.' };
  }
  const at = now();
  const confirmed: OfficeTask = {
    ...task,
    status: 'completed',
    completedAt: at,
    review: { ...task.review, humanConfirmation: { by: actor, at } },
  };
  return {
    ok: true,
    engagement: withAuditEntry(
      { ...engagement, tasks: engagement.tasks.map((candidate) => (candidate.id === taskId ? confirmed : candidate)), updatedAt: at },
      'review-confirmed',
      `${actor.name} confirmó la aprobación de "${task.title}" sin la crítica del especialista, sobre la evidencia determinista.`,
      { actor, taskId },
    ),
  };
};
