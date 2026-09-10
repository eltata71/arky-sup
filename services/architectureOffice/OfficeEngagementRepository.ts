/**
 * Persistence boundary for Architecture Office engagements.
 *
 * The runner writes on **every** task transition so a reload resumes from the
 * last completed task instead of losing a multi-minute operation. That makes
 * this the hot path, so the contract is:
 *
 *  - never throws — callers get a `PersistenceResult`-shaped outcome;
 *  - normalizes on read, so a hand-edited or legacy document cannot crash the
 *    runner (the same defensive posture as `services/runtimeValidation.ts`);
 *  - degrades to the local mirror this repository keeps when Firestore is
 *    unavailable, exactly like artifacts and agent actions do.
 */

import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
  ARB_DECISIONS_COLLECTION,
  ENGAGEMENTS_COLLECTION,
  MirroredList,
  PROJECTS_COLLECTION,
  executeRemoteWrite,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { newPrefixedId } from '../../lib/ids';
import { normalizeBusinessProjectIds } from './officeShared';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './officeAgentPersonas';
import {
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  DEFAULT_OFFICE_BUDGET,
  SYSTEM_OFFICE_ACTOR,
  type OfficeActor,
  type OfficeArbDecision,
  type OfficeAuditAction,
  type OfficeAuditEntry,
  type OfficeCharter,
  type OfficeEngagement,
  type OfficeEngagementPriority,
  type OfficeEngagementStatus,
  type OfficeTask,
  type OfficeTaskStatus,
} from './OfficeTypes';

export const newEngagementId = (): string => newPrefixedId('eng');
export const newOfficeTaskId = (): string => newPrefixedId('task');
export const newOfficeAuditId = (): string => newPrefixedId('audit');
export const newArbDecisionId = (): string => newPrefixedId('arb');

const ENGAGEMENT_STATUSES: readonly OfficeEngagementStatus[] = [
  'intake', 'planning', 'awaiting-charter', 'in-progress',
  'awaiting-arb', 'delivered', 'blocked', 'cancelled',
];

const ENGAGEMENT_PRIORITIES: readonly OfficeEngagementPriority[] = [
  'critical', 'high', 'medium', 'low',
];

const TASK_STATUSES: readonly OfficeTaskStatus[] = [
  'pending', 'ready', 'in-progress', 'awaiting-review',
  'changes-requested', 'completed', 'failed', 'skipped', 'cancelled',
];

const isAgentId = (value: unknown): value is OfficeAgentId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(OFFICE_AGENT_PERSONAS, value);

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const asIsoDate = (value: unknown, fallback: string): string =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback;

const asPositiveInt = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;

const normalizeActor = (value: unknown): OfficeActor => {
  if (!value || typeof value !== 'object') return SYSTEM_OFFICE_ACTOR;
  const raw = value as Partial<OfficeActor>;
  return {
    id: asString(raw.id, SYSTEM_OFFICE_ACTOR.id),
    name: asString(raw.name, SYSTEM_OFFICE_ACTOR.name),
    role: asString(raw.role, SYSTEM_OFFICE_ACTOR.role),
  };
};

const normalizeTask = (value: unknown, engagementId: string): OfficeTask | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  if (!id) return null;
  if (!isAgentId(raw.assigneeId)) return null;

  const status = TASK_STATUSES.includes(raw.status as OfficeTaskStatus)
    ? (raw.status as OfficeTaskStatus)
    : 'pending';

  return {
    id,
    engagementId,
    // The correlation fields survive a reload. This normaliser rebuilds a task
    // field by field, so anything not named here is dropped on every read —
    // which would have made the run correlation work in memory and vanish on
    // the reload it exists to survive.
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    runId: typeof raw.runId === 'string' ? raw.runId : undefined,
    traceIds: Array.isArray(raw.traceIds) ? asStringArray(raw.traceIds) : undefined,
    kind: raw.kind === 'review-artifact' || raw.kind === 'consolidate' || raw.kind === 'report'
      ? raw.kind
      : 'produce-artifact',
    title: asString(raw.title, id),
    objective: asString(raw.objective),
    assigneeId: raw.assigneeId,
    reviewerId: isAgentId(raw.reviewerId) ? raw.reviewerId : undefined,
    dependsOn: asStringArray(raw.dependsOn),
    artifactTemplateName: typeof raw.artifactTemplateName === 'string' ? raw.artifactTemplateName : undefined,
    targetArtifactType: typeof raw.targetArtifactType === 'string'
      ? raw.targetArtifactType as OfficeTask['targetArtifactType']
      : undefined,
    producedVersionGroupId: typeof raw.producedVersionGroupId === 'string' ? raw.producedVersionGroupId : undefined,
    producedArtifactId: typeof raw.producedArtifactId === 'string' ? raw.producedArtifactId : undefined,
    reviewsTaskId: typeof raw.reviewsTaskId === 'string' ? raw.reviewsTaskId : undefined,
    acceptanceCriteria: asStringArray(raw.acceptanceCriteria),
    status,
    attempts: asPositiveInt(raw.attempts, 0),
    maxAttempts: Math.max(1, asPositiveInt(raw.maxAttempts, 2)),
    dueAt: typeof raw.dueAt === 'string' ? raw.dueAt : undefined,
    review: raw.review && typeof raw.review === 'object'
      ? raw.review as OfficeTask['review']
      : undefined,
    carriedFindings: Array.isArray(raw.carriedFindings)
      ? raw.carriedFindings as OfficeTask['carriedFindings']
      : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
  };
};

const normalizeCharter = (value: unknown, now: string): OfficeCharter => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const participantIds = Array.isArray(raw.participantIds)
    ? raw.participantIds.filter(isAgentId)
    : [];
  return {
    kind: raw.kind === 'modernization' || raw.kind === 'integration'
      || raw.kind === 'assessment' || raw.kind === 'compliance-review'
      ? raw.kind
      : 'new-solution',
    objectives: asStringArray(raw.objectives),
    scope: asStringArray(raw.scope),
    outOfScope: asStringArray(raw.outOfScope),
    constraints: asStringArray(raw.constraints),
    regulatoryDrivers: asStringArray(raw.regulatoryDrivers),
    deliverables: Array.isArray(raw.deliverables)
      ? (raw.deliverables as OfficeCharter['deliverables']).filter(
        (item) => item && typeof item === 'object' && isAgentId(item.assigneeId),
      )
      : [],
    participantIds,
    coordinatorId: isAgentId(raw.coordinatorId) ? raw.coordinatorId : 'lucia',
    consolidatorId: isAgentId(raw.consolidatorId) ? raw.consolidatorId : 'alejandro',
    provenance: raw.provenance === 'ai-refined' ? 'ai-refined' : 'deterministic',
    proposedAt: asIsoDate(raw.proposedAt, now),
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : undefined,
    approvedBy: raw.approvedBy ? normalizeActor(raw.approvedBy) : undefined,
  };
};

/**
 * Coerces a stored document into a usable engagement. Unknown enum values fall
 * back to the safest option (`pending` / `intake`) rather than being dropped,
 * so a partially written document still renders and can be resumed.
 */
export const normalizeEngagement = (value: unknown, projectId: string): OfficeEngagement | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = asString(raw.id);
  if (!id) return null;
  const now = new Date().toISOString();

  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
      .map((task) => normalizeTask(task, id))
      .filter((task): task is OfficeTask => task !== null)
    : [];

  const budgetRaw = (raw.budget && typeof raw.budget === 'object' ? raw.budget : {}) as Record<string, unknown>;

  return {
    id,
    projectId: asString(raw.projectId, projectId),
    schemaVersion: asPositiveInt(raw.schemaVersion, OFFICE_ENGAGEMENT_SCHEMA_VERSION),
    title: asString(raw.title, 'Entregable sin título'),
    brief: asString(raw.brief),
    initiativeIds: asStringArray(raw.initiativeIds),
    businessProjectIds: normalizeBusinessProjectIds(raw.businessProjectIds),
    status: ENGAGEMENT_STATUSES.includes(raw.status as OfficeEngagementStatus)
      ? (raw.status as OfficeEngagementStatus)
      : 'intake',
    // Deliverables stored before priority existed read as 'medium' rather than
    // as undefined, so the board never has to guard a `Record` lookup.
    priority: ENGAGEMENT_PRIORITIES.includes(raw.priority as OfficeEngagementPriority)
      ? (raw.priority as OfficeEngagementPriority)
      : 'medium',
    dueAt: typeof raw.dueAt === 'string' && !Number.isNaN(Date.parse(raw.dueAt))
      ? raw.dueAt
      : undefined,
    charter: normalizeCharter(raw.charter, now),
    tasks,
    gateAssessment: raw.gateAssessment && typeof raw.gateAssessment === 'object'
      ? raw.gateAssessment as OfficeEngagement['gateAssessment']
      : undefined,
    arbDecisions: Array.isArray(raw.arbDecisions)
      ? raw.arbDecisions.filter((item): item is OfficeArbDecision => Boolean(item) && typeof item === 'object')
      : [],
    budget: {
      maxAiCalls: Math.max(1, asPositiveInt(budgetRaw.maxAiCalls, DEFAULT_OFFICE_BUDGET.maxAiCalls)),
      consumedAiCalls: asPositiveInt(budgetRaw.consumedAiCalls, 0),
    },
    currentRunId: typeof raw.currentRunId === 'string' ? raw.currentRunId : undefined,
    auditTrail: Array.isArray(raw.auditTrail)
      ? raw.auditTrail.filter((item): item is OfficeAuditEntry => Boolean(item) && typeof item === 'object')
      : [],
    createdBy: normalizeActor(raw.createdBy),
    createdAt: asIsoDate(raw.createdAt, now),
    updatedAt: asIsoDate(raw.updatedAt, now),
  };
};

export const buildAuditEntry = (
  engagementId: string,
  action: OfficeAuditAction,
  details: string,
  options: {
    actor?: OfficeActor;
    taskId?: string;
    before?: string;
    after?: string;
    runId?: string;
  } = {},
): OfficeAuditEntry => ({
  id: newOfficeAuditId(),
  engagementId,
  runId: options.runId,
  action,
  actor: options.actor ?? SYSTEM_OFFICE_ACTOR,
  timestamp: new Date().toISOString(),
  details,
  taskId: options.taskId,
  before: options.before,
  after: options.after,
});

/** Appends an audit entry and refreshes `updatedAt` without mutating the input. */
export const withAuditEntry = (
  engagement: OfficeEngagement,
  action: OfficeAuditAction,
  details: string,
  options: { actor?: OfficeActor; taskId?: string; before?: string; after?: string } = {},
): OfficeEngagement => ({
  ...engagement,
  auditTrail: [
    ...engagement.auditTrail,
    // The run is read from the engagement, not taken from the caller. The
    // runner writes eight kinds of entry, and a `runId` that has to be
    // remembered at each site is one that will be forgotten at one of them.
    buildAuditEntry(engagement.id, action, details, {
      ...options,
      runId: engagement.currentRunId,
    }),
  ],
  updatedAt: new Date().toISOString(),
});

export interface OfficeEngagementRepository {
  list(projectId: string): Promise<OfficeEngagement[]>;
  save(engagement: OfficeEngagement): Promise<PersistenceResult<void>>;
  remove(projectId: string, engagementId: string): Promise<PersistenceResult<void>>;
  recordArbDecision(engagement: OfficeEngagement, decision: OfficeArbDecision): Promise<PersistenceResult<void>>;
}

/**
 * Los encargos viven en su propia subcolección y no dentro del documento del
 * proyecto: el runner escribe en cada transición de tarea, y reescribir el
 * proyecto entero —artefactos incluidos— en cada una sería lento y una
 * ocasión de perder actualizaciones.
 */
const mirror = new MirroredList<OfficeEngagement>((projectId) => `engagements_${projectId}`);

class FirestoreOfficeEngagementRepository implements OfficeEngagementRepository {
  async list(projectId: string): Promise<OfficeEngagement[]> {
    const raw = mirror.cached(projectId) ?? await this.fetch(projectId);
    return raw
      .map((item) => normalizeEngagement(item, projectId))
      .filter((item): item is OfficeEngagement => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async fetch(projectId: string): Promise<OfficeEngagement[]> {
    try {
      const snapshot = await getDocs(collection(requireDb(db), PROJECTS_COLLECTION, projectId, ENGAGEMENTS_COLLECTION));
      return mirror.remember(
        projectId,
        snapshot.docs.map((snap) => ({ ...snap.data(), id: snap.id }) as OfficeEngagement),
      );
    } catch {
      return mirror.fallback(projectId);
    }
  }

  async save(engagement: OfficeEngagement): Promise<PersistenceResult<void>> {
    const normalized: OfficeEngagement = {
      ...engagement,
      initiativeIds: [...new Set(engagement.initiativeIds)],
      businessProjectIds: normalizeBusinessProjectIds(engagement.businessProjectIds),
      schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    const result = await executeRemoteWrite(
      { operationName: 'saveEngagement', projectId: normalized.projectId },
      async () => {
        const ref = doc(requireDb(db), PROJECTS_COLLECTION, normalized.projectId, ENGAGEMENTS_COLLECTION, normalized.id);
        await setDoc(ref, sanitizeForFirestore(normalized));
      },
    );
    mirror.upsert(normalized.projectId, normalized, result);
    return result as PersistenceResult<void>;
  }

  async remove(projectId: string, engagementId: string): Promise<PersistenceResult<void>> {
    const result = await executeRemoteWrite({ operationName: 'deleteEngagement', projectId }, async () => {
      await deleteDoc(doc(requireDb(db), PROJECTS_COLLECTION, projectId, ENGAGEMENTS_COLLECTION, engagementId));
    });
    mirror.remove(projectId, engagementId);
    return result as PersistenceResult<void>;
  }

  /**
   * Una decisión del ARB se añade a su propia subcolección inmutable.
   * `firestore.rules` hace esos documentos sólo-creación, así que éste es el
   * registro a prueba de manipulación de quién firmó un encargo y con qué
   * evidencia — el documento del encargo lleva un espejo para leer rápido.
   */
  async recordArbDecision(
    engagement: OfficeEngagement,
    decision: OfficeArbDecision,
  ): Promise<PersistenceResult<void>> {
    const result = await executeRemoteWrite(
      { operationName: 'recordArbDecision', projectId: engagement.projectId },
      async () => {
        const ref = doc(
          requireDb(db),
          PROJECTS_COLLECTION,
          engagement.projectId,
          ENGAGEMENTS_COLLECTION,
          decision.engagementId,
          ARB_DECISIONS_COLLECTION,
          decision.id,
        );
        await setDoc(ref, sanitizeForFirestore(decision));
      },
    );
    return result as PersistenceResult<void>;
  }
}

export const createOfficeEngagementRepository = (): OfficeEngagementRepository =>
  new FirestoreOfficeEngagementRepository();

export const officeEngagementRepository: OfficeEngagementRepository = createOfficeEngagementRepository();
