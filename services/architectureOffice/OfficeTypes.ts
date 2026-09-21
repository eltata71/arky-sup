/**
 * Domain model of the Architecture Office.
 *
 * The unit of office work is the **engagement** (`OfficeEngagement`): a brief
 * from the business, a charter that the office proposes and a human approves,
 * and a DAG of tasks that specialist personas execute and review among
 * themselves until quality gates and the Architecture Review Board sign off.
 *
 * Everything here is plain data — no React, no Firestore, no AI SDK. The
 * planner, the runner and the repository all operate on these shapes.
 */

import type { ArtifactType } from '../../types';
import type { OfficeAgentId } from './officeAgentPersonas';
import type { OfficeQualityAssessment } from './officeQualityGates';

/** Bumped when a stored engagement needs migrating. Mirrors `PUBLICATION_SCHEMA_VERSION`. */
export const OFFICE_ENGAGEMENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Engagement lifecycle
// ---------------------------------------------------------------------------

export type OfficeEngagementStatus =
  | 'intake'            // brief captured, charter not yet proposed
  | 'planning'          // the planner is composing the charter
  | 'awaiting-charter'  // charter proposed, waiting for human approval
  | 'in-progress'       // the runner is executing the task DAG
  | 'awaiting-arb'      // work complete, waiting for the review board
  | 'delivered'         // ARB approved
  | 'blocked'           // a gate or a task blocks progress; needs a human
  | 'cancelled';

export type OfficeEngagementKind =
  | 'new-solution'
  | 'modernization'
  | 'integration'
  | 'assessment'
  | 'compliance-review';

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type OfficeTaskKind =
  | 'produce-artifact'
  | 'review-artifact'
  | 'consolidate'
  | 'report';

export type OfficeTaskStatus =
  | 'pending'            // dependencies not satisfied yet
  | 'ready'              // schedulable now
  | 'in-progress'
  | 'awaiting-review'    // produced, waiting on its reviewer task
  | 'changes-requested'  // reviewer asked for changes; production re-runs
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/** Statuses from which no further work will be scheduled. */
export const OFFICE_TERMINAL_TASK_STATUSES: readonly OfficeTaskStatus[] = Object.freeze([
  'completed',
  'failed',
  'skipped',
  'cancelled',
]);

export type OfficeFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface OfficeReviewFinding {
  severity: OfficeFindingSeverity;
  message: string;
  /** Verbatim excerpt or validator code backing the finding. Never invented. */
  evidence?: string;
}

export type OfficeReviewVerdict = 'approved' | 'changes-requested' | 'rejected';

export interface OfficeTaskReview {
  reviewerId: OfficeAgentId;
  /** Correlation id of the invocation that produced this verdict. */
  traceId?: string;
  verdict: OfficeReviewVerdict;
  findings: OfficeReviewFinding[];
  /** Deterministic score from the artifact compiler, when one was available. */
  deterministicScore?: number;
  /** Validator ids that reported a blocking issue (`officeArtifactValidators`). */
  blockingValidatorIds?: string[];
  summary: string;
  decidedAt: string;
}

export interface OfficeTask {
  id: string;
  engagementId: string;
  /**
   * When the planner created this task.
   *
   * Optional because engagements stored before the field exists must keep
   * loading — the same lazy-migration rule the portfolio graph applies to
   * legacy links. The planner always sets it now.
   */
  createdAt?: string;
  /**
   * The execution attempt that last scheduled this task.
   *
   * An engagement is resumable by design: a reload continues from the last
   * completed task rather than restarting. That made the audit trail unable to
   * say which attempt an entry belonged to — two runs of the same engagement
   * produced one undifferentiated sequence, and "did this fail before or after
   * the retry?" had no answer in the data.
   */
  runId?: string;
  /**
   * Identidad estable del intento de **esta tarea**, no del encargo.
   *
   * El `runId` cambia con cada intento de encargo; este no. Nace una sola vez
   * —cuando la tarea pasa a `in-progress`— y sobrevive a la reanudación, de
   * modo que el puerto de producción pueda derivar de él la identidad del
   * artefacto: si el efecto externo ocurrió pero el checkpoint posterior se
   * perdió, reintentar con la misma `executionId` encuentra el artefacto que ya
   * existe en vez de generar un segundo. Una corrección legítima
   * (`changes-requested`) sí abre otro intento y otra identidad.
   */
  executionId?: string;
  /**
   * Correlation ids for the model invocations this task caused, oldest first.
   *
   * For `produce-artifact` these are the agent's own trace ids, so a task joins
   * to `projects/{id}/agent_actions/{traceId}` and the whole generation —
   * prompt, phases, versions, rollback — is reachable from the deliverable.
   * `executeAgentAction` had been returning that id since it shipped and the
   * Office threw it away.
   *
   * For `review-artifact` and `consolidate` the id is minted by the Office
   * adapter instead: that path reaches the model through the legacy chat façade,
   * which returns no trace id of its own. It still orders and counts the
   * invocations of a run; it just does not join to an agent action. Saying so
   * here is the point — an id that looks like the others and joins to nothing
   * would be worse than none.
   */
  traceIds?: string[];
  kind: OfficeTaskKind;
  title: string;
  objective: string;
  /** The persona accountable for the task. Real assignment, not routing. */
  assigneeId: OfficeAgentId;
  /**
   * The persona that reviews the output. Separation of duties: the planner
   * guarantees `reviewerId !== assigneeId` for every reviewed task.
   */
  reviewerId?: OfficeAgentId;
  /** Ids of tasks that must reach a terminal success before this one runs. */
  dependsOn: string[];
  /** Name of the `ARTIFACT_TEMPLATES` entry to produce. */
  artifactTemplateName?: string;
  targetArtifactType?: ArtifactType;
  /** Version group of the artifact this task produced or reviewed. */
  producedVersionGroupId?: string;
  producedArtifactId?: string;
  /** Task whose output this one reviews (`review-artifact` only). */
  reviewsTaskId?: string;
  acceptanceCriteria: string[];
  status: OfficeTaskStatus;
  attempts: number;
  /** Upper bound on production re-runs driven by `changes-requested`. */
  maxAttempts: number;
  /** ISO deadline used for aging and escalation in the office console. */
  dueAt?: string;
  review?: OfficeTaskReview;
  /** Findings carried into the next production attempt. */
  carriedFindings?: OfficeReviewFinding[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Charter
// ---------------------------------------------------------------------------

export interface OfficeCharterDeliverable {
  templateName: string;
  artifactType: ArtifactType;
  assigneeId: OfficeAgentId;
  reviewerId: OfficeAgentId;
  rationale: string;
  /** Template names this deliverable depends on. Resolved to task ids later. */
  dependsOnTemplateNames: string[];
}

export interface OfficeCharter {
  kind: OfficeEngagementKind;
  objectives: string[];
  scope: string[];
  outOfScope: string[];
  constraints: string[];
  /** Regulatory frames the engagement must satisfy (Solvencia II, HIPAA…). */
  regulatoryDrivers: string[];
  deliverables: OfficeCharterDeliverable[];
  /** Persona ids taking part, derived from the deliverables. */
  participantIds: OfficeAgentId[];
  coordinatorId: OfficeAgentId;
  consolidatorId: OfficeAgentId;
  /** `'deterministic'` when the AI refinement was unavailable or rejected. */
  provenance: 'deterministic' | 'ai-refined';
  proposedAt: string;
  approvedAt?: string;
  approvedBy?: OfficeActor;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export interface OfficeActor {
  id: string;
  name: string;
  /** `'system'` for office-generated entries; a user role otherwise. */
  role: string;
}

export const SYSTEM_OFFICE_ACTOR: OfficeActor = Object.freeze({
  id: 'office-system',
  name: 'Oficina de Arquitectura',
  role: 'system',
});

export type OfficeArbVerdict = 'approved' | 'changes-requested' | 'rejected';

export interface OfficeArbDecision {
  id: string;
  engagementId: string;
  verdict: OfficeArbVerdict;
  /** Mandatory for `changes-requested` and `rejected`. */
  rationale: string;
  actor: OfficeActor;
  /** Gate verdict at the moment of the decision — the evidence it rests on. */
  gateStatusAtDecision: OfficeQualityAssessment['overallStatus'];
  previousStatus: OfficeEngagementStatus;
  decidedAt: string;
}

export type OfficeAuditAction =
  | 'engagement-created'
  | 'charter-proposed'
  | 'charter-approved'
  | 'run-started'
  | 'run-paused'
  | 'run-resumed'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'task-changes-requested'
  | 'task-cancelled'
  | 'gates-evaluated'
  | 'submitted-to-arb'
  | 'arb-decided'
  | 'engagement-blocked'
  | 'engagement-delivered'
  | 'engagement-cancelled'
  | 'budget-exhausted';

export interface OfficeAuditEntry {
  id: string;
  engagementId: string;
  /**
   * The execution attempt this entry belongs to.
   *
   * Stamped from the engagement rather than passed by each caller: the runner
   * writes eight kinds of audit entry and a `runId` that has to be remembered
   * at each site is one that will be forgotten at one of them.
   */
  runId?: string;
  action: OfficeAuditAction;
  actor: OfficeActor;
  timestamp: string;
  details: string;
  taskId?: string;
  before?: string;
  after?: string;
}

/** Same four-step scale the business initiative uses, so the levels compare. */
export type OfficeEngagementPriority = 'critical' | 'high' | 'medium' | 'low';

export interface OfficeBudget {
  /** Hard ceiling on AI calls for the whole engagement. */
  maxAiCalls: number;
  consumedAiCalls: number;
}

export const DEFAULT_OFFICE_BUDGET: OfficeBudget = Object.freeze({
  maxAiCalls: 40,
  consumedAiCalls: 0,
});

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export interface OfficeEngagement {
  id: string;
  projectId: string;
  schemaVersion: number;
  title: string;
  /** The original request, verbatim. Never rewritten. */
  brief: string;
  /**
   * Ids of the business initiatives this deliverable serves — the canonical
   * link. Usually the same set as its project's, but a deliverable may narrow
   * to a subset when a project answers several initiatives at once.
   */
  initiativeIds: string[];
  /** Derived code mirror of `initiativeIds`. See `Project.linkedBusinessProjects`. */
  businessProjectIds: string[];
  status: OfficeEngagementStatus;
  /**
   * How urgent the deliverable is relative to its siblings. Set by a human at
   * intake; the runner never changes it, because scheduling pressure is a
   * business call, not something the DAG can infer.
   */
  priority: OfficeEngagementPriority;
  /** When the business needs it. Drives the aging shown on the board. */
  dueAt?: string;
  charter: OfficeCharter;
  tasks: OfficeTask[];
  gateAssessment?: OfficeQualityAssessment;
  arbDecisions: OfficeArbDecision[];
  budget: OfficeBudget;
  /**
   * The execution attempt currently in flight, or the last one that ran.
   *
   * Every audit entry and every scheduled task is stamped with it, which is
   * what makes a resumed engagement legible: without it a second attempt
   * appends to the same undifferentiated sequence as the first.
   */
  currentRunId?: string;
  auditTrail: OfficeAuditEntry[];
  createdBy: OfficeActor;
  createdAt: string;
  updatedAt: string;
  /**
   * El testigo de concurrencia de la fila que guarda este encargo, **no** un
   * campo de dominio: nada en el motor, el runner o las transiciones lo lee.
   *
   * Vive aquí por una razón concreta y es la única que lo justifica: **tiene
   * que viajar con el snapshot**. Antes lo guardaba un `Map<string, number>`
   * dentro del cierre del repositorio —un singleton de módulo— y cualquier
   * `list()` posterior lo refrescaba para todos los encargos. Una pantalla que
   * retenía un snapshot anterior y guardaba lo hacía con la revisión **más
   * nueva**, así que la guarda optimista del servidor, que existe justo para
   * detener eso, la dejaba pasar: la actualización perdida no se detectaba, se
   * confirmaba.
   *
   * Un campo funciona donde un `WeakMap` no, y la diferencia importa: cada
   * derivación del agregado es un `{ ...engagement, … }`, así que el campo
   * viaja solo por todas ellas, y un snapshot derivado de una lectura vieja
   * conserva la revisión vieja. Que es exactamente la semántica que se quiere.
   *
   * Opcional porque un encargo recién construido por la fábrica todavía no
   * tiene fila. Ausente significa 0, y 0 significa «espero que no exista»: el
   * fallo es cerrado, un conflicto, nunca una escritura que pisa.
   *
   * No se persiste dentro del documento — el repositorio lo quita antes de
   * enviarlo, porque es una columna y una copia dentro del JSON sería una
   * segunda verdad que además nace obsoleta.
   */
  revision?: number;
}

// ---------------------------------------------------------------------------
// Derived views (pure helpers used by the runner and the UI)
// ---------------------------------------------------------------------------

export interface OfficeEngagementProgress {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  blocked: number;
  /** 0..1 — completed over total, 1 when there is nothing to do. */
  ratio: number;
}

export const isTerminalTaskStatus = (status: OfficeTaskStatus): boolean =>
  OFFICE_TERMINAL_TASK_STATUSES.includes(status);

export const summarizeEngagementProgress = (tasks: readonly OfficeTask[]): OfficeEngagementProgress => {
  const total = tasks.length;
  let completed = 0;
  let failed = 0;
  let inFlight = 0;
  let blocked = 0;
  for (const task of tasks) {
    if (task.status === 'completed' || task.status === 'skipped') completed += 1;
    else if (task.status === 'failed' || task.status === 'cancelled') failed += 1;
    else if (task.status === 'in-progress' || task.status === 'awaiting-review') inFlight += 1;
    else if (task.status === 'changes-requested') blocked += 1;
  }
  return {
    total,
    completed,
    failed,
    inFlight,
    blocked,
    ratio: total === 0 ? 1 : completed / total,
  };
};

/** Tasks whose dependencies have all reached a successful terminal state. */
export const selectSchedulableTasks = (tasks: readonly OfficeTask[]): OfficeTask[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => {
    if (task.status !== 'pending' && task.status !== 'ready' && task.status !== 'changes-requested') return false;
    return task.dependsOn.every((dependencyId) => {
      const dependency = byId.get(dependencyId);
      if (!dependency) return false;
      return dependency.status === 'completed' || dependency.status === 'skipped';
    });
  });
};

/**
 * Detects a cycle in the task DAG. Returns the ids taking part in the first
 * cycle found, or an empty array when the graph is acyclic.
 */
export const findTaskCycle = (tasks: readonly OfficeTask[]): string[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] => {
    const current = state.get(id);
    if (current === 'done') return [];
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      return stack.slice(start >= 0 ? start : 0).concat(id);
    }
    const task = byId.get(id);
    if (!task) return [];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependencyId of task.dependsOn) {
      const cycle = visit(dependencyId);
      if (cycle.length > 0) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return [];
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle.length > 0) return cycle;
  }
  return [];
};
