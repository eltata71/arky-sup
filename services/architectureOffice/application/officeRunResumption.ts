import { withAuditEntry } from '../domain/officeEngagementRecord';
import type { OfficeEngagement } from '../domain/OfficeTypes';

/** Restores tasks whose durable checkpoint says an earlier browser run stopped mid-effect. */
export const resumeInterruptedTasks = (
  initial: OfficeEngagement,
  nextRunId: string,
): { engagement: OfficeEngagement; resumedTaskIds: string[] } => {
  const resumedTaskIds = initial.tasks
    .filter((task) => task.status === 'in-progress' && task.runId !== nextRunId)
    .map((task) => task.id);
  let engagement: OfficeEngagement = {
    ...initial,
    tasks: initial.tasks.map((task) => (
      task.runId !== nextRunId && task.status === 'in-progress'
        ? {
          ...task,
          status: 'ready',
          attempts: task.kind === 'produce-artifact' ? Math.max(0, task.attempts - 1) : task.attempts,
        }
        : task
    )),
  };
  if (resumedTaskIds.length > 0) {
    engagement = withAuditEntry(
      engagement,
      'run-resumed',
      `La ejecución se reanudó desde un intento anterior: ${resumedTaskIds.length} tarea(s) quedaron en curso.`,
    );
  }
  return { engagement, resumedTaskIds };
};
