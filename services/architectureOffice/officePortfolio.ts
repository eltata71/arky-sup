/**
 * The portfolio view of the Architecture Office.
 *
 * The office has three nested levels, and until now only the innermost one was
 * visible in the UI:
 *
 *   Iniciativa de negocio (`NEG-YYYY-NNN`)
 *     └─ Atención de Arquitectura (`Project`)
 *          └─ Entregable (`OfficeEngagement`)
 *               └─ Tareas / artefactos
 *
 * This module derives that tree — and the numbers a dashboard needs to talk
 * about it — from data the app already persists: `Project.linkedBusinessProjects`
 * and `OfficeEngagement.businessProjectIds`. There is no new collection and no
 * new document shape, so nothing here needs a `firestore.rules` change.
 *
 * Everything is a pure function over plain data: no React, no Firestore, no AI.
 */

import type { Project } from '../../types';
import type { OfficeAgentId } from './officeAgentPersonas';
import type { OfficeQualityGateStatus } from './officeQualityGates';
import {
  summarizeEngagementProgress,
  type OfficeEngagement,
  type OfficeEngagementStatus,
  type OfficeFindingSeverity,
  type OfficeTask,
} from './OfficeTypes';

/** Bucket used by every architecture project that declares no business code. */
export const UNASSIGNED_PROGRAM_ID = '__sin-programa__';

/** Label for that bucket. Kept here so the UI never invents a second name. */
export const UNASSIGNED_PROGRAM_NAME = 'Sin iniciativa de negocio';

// ---------------------------------------------------------------------------
// Health buckets
// ---------------------------------------------------------------------------

/**
 * The five states a portfolio node can be in, ordered by how loudly they ask
 * for attention. Collapsing eight engagement statuses into five buckets is the
 * point: a dashboard that repeats every internal status forces the reader to
 * do the triage the dashboard was supposed to do for them.
 */
export type OfficeHealthBucket =
  | 'blocked'
  | 'awaiting-decision'
  | 'running'
  | 'delivered'
  | 'idle';

/**
 * Priority order — also the fixed render order of every chart slot in the
 * dashboard. The order is a colour-safety mechanism, not a cosmetic choice:
 * it keeps amber and emerald apart from red in adjacent marks. Do not reorder
 * without re-running the palette validation documented in `officeChartTokens`.
 */
export const OFFICE_HEALTH_ORDER: readonly OfficeHealthBucket[] = Object.freeze([
  'blocked',
  'running',
  'awaiting-decision',
  'delivered',
  'idle',
]);

/** Severity order used when rolling findings up the tree. */
const SEVERITY_ORDER: readonly OfficeFindingSeverity[] = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
]);

const STATUS_TO_BUCKET: Readonly<Record<OfficeEngagementStatus, OfficeHealthBucket>> = Object.freeze({
  blocked: 'blocked',
  'awaiting-charter': 'awaiting-decision',
  'awaiting-arb': 'awaiting-decision',
  'in-progress': 'running',
  delivered: 'delivered',
  intake: 'idle',
  planning: 'idle',
  cancelled: 'idle',
});

export const healthBucketOf = (status: OfficeEngagementStatus): OfficeHealthBucket =>
  STATUS_TO_BUCKET[status];

/** The loudest bucket present. `idle` when there is nothing to say. */
export const worstHealthBucket = (
  buckets: readonly OfficeHealthBucket[],
): OfficeHealthBucket => {
  for (const candidate of OFFICE_HEALTH_ORDER) {
    if (buckets.includes(candidate)) return candidate;
  }
  return 'idle';
};

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

export type OfficeStatusMix = Readonly<Record<OfficeHealthBucket, number>>;

export type OfficeFindingMix = Readonly<Record<OfficeFindingSeverity, number>>;

export type OfficeGateMix = Readonly<Record<OfficeQualityGateStatus, number>>;

export interface OfficePortfolioRollup {
  engagements: number;
  /** Engagements grouped into the five health buckets. */
  statusMix: OfficeStatusMix;
  tasksTotal: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksInFlight: number;
  /** Tasks a reviewer sent back — the office's rework load. */
  tasksReworking: number;
  /** 0..1. Completed over total; 1 when there is nothing planned yet. */
  completionRatio: number;
  /** Tasks past their `dueAt`. */
  overdueTasks: number;
  findings: OfficeFindingMix;
  gates: OfficeGateMix;
  aiCallsUsed: number;
  aiCallsBudget: number;
  /** Deliverables produced (a task that persisted an artifact). */
  artifactsProduced: number;
  /** Reviews that ended in `approved`, over all reviews with a verdict. */
  reviewApprovalRatio: number;
  /** Engagements waiting on a human right now. */
  awaitingDecision: number;
}

const emptyStatusMix = (): Record<OfficeHealthBucket, number> => ({
  blocked: 0,
  running: 0,
  'awaiting-decision': 0,
  delivered: 0,
  idle: 0,
});

const emptyFindingMix = (): Record<OfficeFindingSeverity, number> => ({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
});

const emptyGateMix = (): Record<OfficeQualityGateStatus, number> => ({
  pass: 0,
  conditional: 0,
  blocked: 0,
});

/** A rollup with every counter at zero. Used as the reduce seed and by tests. */
export const emptyPortfolioRollup = (): OfficePortfolioRollup => ({
  engagements: 0,
  statusMix: emptyStatusMix(),
  tasksTotal: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  tasksInFlight: 0,
  tasksReworking: 0,
  completionRatio: 1,
  overdueTasks: 0,
  findings: emptyFindingMix(),
  gates: emptyGateMix(),
  aiCallsUsed: 0,
  aiCallsBudget: 0,
  artifactsProduced: 0,
  reviewApprovalRatio: 1,
  awaitingDecision: 0,
});

const isOverdue = (task: OfficeTask, now: number): boolean => {
  if (!task.dueAt) return false;
  if (task.status === 'completed' || task.status === 'skipped' || task.status === 'cancelled') return false;
  const due = Date.parse(task.dueAt);
  return !Number.isNaN(due) && due < now;
};

/**
 * Rolls a set of engagements into one set of numbers.
 *
 * Ratios are recomputed from the summed counters rather than averaged, so a
 * program with one 10-task engagement and one 1-task engagement reports the
 * completion of its 11 tasks, not the mean of two percentages.
 */
export const rollupEngagements = (
  engagements: readonly OfficeEngagement[],
  now: number = Date.now(),
): OfficePortfolioRollup => {
  const statusMix = emptyStatusMix();
  const findings = emptyFindingMix();
  const gates = emptyGateMix();

  let tasksTotal = 0;
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let tasksInFlight = 0;
  let tasksReworking = 0;
  let overdueTasks = 0;
  let aiCallsUsed = 0;
  let aiCallsBudget = 0;
  let artifactsProduced = 0;
  let reviewsTotal = 0;
  let reviewsApproved = 0;
  let awaitingDecision = 0;

  for (const engagement of engagements) {
    const bucket = healthBucketOf(engagement.status);
    statusMix[bucket] += 1;
    if (bucket === 'awaiting-decision') awaitingDecision += 1;

    const progress = summarizeEngagementProgress(engagement.tasks);
    tasksTotal += progress.total;
    tasksCompleted += progress.completed;
    tasksFailed += progress.failed;
    tasksInFlight += progress.inFlight;
    tasksReworking += progress.blocked;

    aiCallsUsed += engagement.budget.consumedAiCalls;
    aiCallsBudget += engagement.budget.maxAiCalls;

    for (const task of engagement.tasks) {
      if (isOverdue(task, now)) overdueTasks += 1;
      if (task.producedArtifactId) artifactsProduced += 1;
      if (!task.review) continue;
      reviewsTotal += 1;
      if (task.review.verdict === 'approved') reviewsApproved += 1;
      for (const finding of task.review.findings) findings[finding.severity] += 1;
    }

    for (const gate of engagement.gateAssessment?.gates ?? []) {
      gates[gate.status] += 1;
    }
  }

  return {
    engagements: engagements.length,
    statusMix,
    tasksTotal,
    tasksCompleted,
    tasksFailed,
    tasksInFlight,
    tasksReworking,
    completionRatio: tasksTotal === 0 ? 1 : tasksCompleted / tasksTotal,
    overdueTasks,
    findings,
    gates,
    aiCallsUsed,
    aiCallsBudget,
    artifactsProduced,
    reviewApprovalRatio: reviewsTotal === 0 ? 1 : reviewsApproved / reviewsTotal,
    awaitingDecision,
  };
};

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export interface ArchitectureProjectNode {
  projectId: string;
  name: string;
  description: string;
  /** Business codes this project declares. May be empty. */
  businessProgramIds: string[];
  engagements: OfficeEngagement[];
  /** Latest version of each artifact in the project. */
  artifactCount: number;
  rollup: OfficePortfolioRollup;
  health: OfficeHealthBucket;
  /** ISO timestamp of the most recent office activity, when there is any. */
  lastActivityAt?: string;
}

export interface BusinessProgramNode {
  id: string;
  name: string;
  /** True for the synthetic bucket holding projects with no business code. */
  isUnassigned: boolean;
  projects: ArchitectureProjectNode[];
  rollup: OfficePortfolioRollup;
  health: OfficeHealthBucket;
  lastActivityAt?: string;
}

/** One engagement that cannot move without a person. */
export interface OfficeDecisionItem {
  engagement: OfficeEngagement;
  programId: string;
  programName: string;
  projectName: string;
  bucket: OfficeHealthBucket;
  /** Why it is here, in one Spanish sentence. */
  reason: string;
  /** True when only an admin can clear it (an ARB decision). */
  requiresAdmin: boolean;
}

/** One day of office throughput, oldest first. */
export interface OfficeActivityPoint {
  /** `YYYY-MM-DD`, in the viewer's local calendar. */
  date: string;
  tasksCompleted: number;
  engagementsDelivered: number;
  reviewsRequested: number;
}

export interface OfficeSpecialistLoad {
  personaId: OfficeAgentId;
  /** Tasks currently in progress or waiting on their reviewer. */
  active: number;
  /** Tasks this persona has taken to a successful terminal state. */
  completed: number;
  /** Reviews this persona issued. */
  reviewed: number;
  /** Titles of the tasks in flight, for the tooltip / card body. */
  activeTaskTitles: string[];
}

export interface OfficePortfolio {
  programs: BusinessProgramNode[];
  /** Flat list of every architecture project, for switchers and search. */
  projects: ArchitectureProjectNode[];
  rollup: OfficePortfolioRollup;
  decisionQueue: OfficeDecisionItem[];
  activity: OfficeActivityPoint[];
  specialists: OfficeSpecialistLoad[];
}

const ACTIVE_TASK_STATUSES: ReadonlySet<string> = new Set(['in-progress', 'awaiting-review']);

/** `2026-08-27T15:09:00Z` → `2026-08-27`, in the local calendar. */
const localDayKey = (iso: string): string | null => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
};

const latestTimestamp = (values: readonly (string | undefined)[]): string | undefined => {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isNaN(ms) || ms <= bestMs) continue;
    bestMs = ms;
    best = value;
  }
  return best;
};

/**
 * Latest version of each artifact — the count a human means by "artefactos".
 *
 * Counts from the compact index when the project's documents have not been
 * loaded. The portfolio is built for every project at once, and reading
 * `artifacts.length` on an unhydrated one would report zero — a rollup that
 * says the office produced nothing is worse than one that is slow.
 */
const countLatestArtifacts = (project: Project): number => {
  const identities = project.artifactsLoaded === false
    ? (project.artifactIndex ?? [])
    : (project.artifacts ?? []);
  const groups = new Set<string>();
  for (const artifact of identities) groups.add(artifact.versionGroupId);
  return groups.size;
};

const describeDecision = (
  engagement: OfficeEngagement,
): { reason: string; requiresAdmin: boolean } => {
  switch (engagement.status) {
    case 'awaiting-charter':
      return { reason: 'El charter propuesto espera tu aprobación para empezar.', requiresAdmin: false };
    case 'awaiting-arb':
      return { reason: 'El trabajo está listo y espera la decisión del comité.', requiresAdmin: true };
    case 'blocked':
      return {
        reason: engagement.gateAssessment?.overallStatus === 'blocked'
          ? 'Hay quality gates bloqueados que impiden avanzar.'
          : 'El entregable está detenido y necesita una intervención.',
        requiresAdmin: false,
      };
    default:
      return { reason: 'Requiere tu atención.', requiresAdmin: false };
  }
};

/**
 * Builds the daily throughput series from the engagement audit trails.
 *
 * The audit trail is append-only and already timestamped, so it is the honest
 * source for "what did the office actually do" — no separate metrics store, and
 * no invented numbers when an engagement predates a counter.
 */
export const buildActivitySeries = (
  engagements: readonly OfficeEngagement[],
  days: number,
  now: number = Date.now(),
): OfficeActivityPoint[] => {
  const span = Math.max(1, Math.floor(days));
  const byDay = new Map<string, OfficeActivityPoint>();

  // Seed every day in the window so the chart has a continuous x axis even
  // when the office was idle — gaps in a time series read as missing data.
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  const startMs = cursor.getTime() - (span - 1) * 86_400_000;
  for (let index = 0; index < span; index += 1) {
    const date = new Date(startMs + index * 86_400_000);
    const key = localDayKey(date.toISOString());
    if (key) byDay.set(key, { date: key, tasksCompleted: 0, engagementsDelivered: 0, reviewsRequested: 0 });
  }

  for (const engagement of engagements) {
    for (const entry of engagement.auditTrail) {
      const key = localDayKey(entry.timestamp);
      if (!key) continue;
      const point = byDay.get(key);
      if (!point) continue; // outside the window
      if (entry.action === 'task-completed') point.tasksCompleted += 1;
      else if (entry.action === 'engagement-delivered') point.engagementsDelivered += 1;
      else if (entry.action === 'task-changes-requested') point.reviewsRequested += 1;
    }
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
};

/** Who is carrying what, across every engagement in the portfolio. */
export const buildSpecialistLoad = (
  engagements: readonly OfficeEngagement[],
): OfficeSpecialistLoad[] => {
  const byPersona = new Map<OfficeAgentId, OfficeSpecialistLoad>();

  const entryFor = (personaId: OfficeAgentId): OfficeSpecialistLoad => {
    const existing = byPersona.get(personaId);
    if (existing) return existing;
    const created: OfficeSpecialistLoad = {
      personaId,
      active: 0,
      completed: 0,
      reviewed: 0,
      activeTaskTitles: [],
    };
    byPersona.set(personaId, created);
    return created;
  };

  for (const engagement of engagements) {
    for (const task of engagement.tasks) {
      const assignee = entryFor(task.assigneeId);
      if (ACTIVE_TASK_STATUSES.has(task.status)) {
        assignee.active += 1;
        assignee.activeTaskTitles.push(task.title);
      } else if (task.status === 'completed') {
        assignee.completed += 1;
      }
      if (task.review) entryFor(task.review.reviewerId).reviewed += 1;
    }
  }

  return [...byPersona.values()].sort((a, b) => (
    b.active - a.active
    || b.completed - a.completed
    || a.personaId.localeCompare(b.personaId)
  ));
};

/** Just enough of a business initiative to name and rank a program node. */
export interface InitiativeSummary {
  id: string;
  code: string;
  title: string;
}

export interface BuildPortfolioOptions {
  /** Days covered by the activity series. Defaults to 14. */
  activityDays?: number;
  /**
   * Registered business initiatives, so a program node can show its real name
   * instead of only its code. Optional: the codes on the projects remain the
   * join key, and an unregistered code still forms a program — the Office must
   * keep working while an initiative is only a code someone typed.
   */
  initiatives?: readonly InitiativeSummary[];
  /** Injectable clock — tests pin it, the app leaves it alone. */
  now?: number;
}

/**
 * Assembles the whole portfolio: the business → architecture → engagement tree,
 * the rollups at each level, the decision queue, throughput and specialist load.
 *
 * A project that declares several business codes appears under each of them —
 * that is how a shared platform genuinely serves several initiatives, and
 * hiding it under only the first would misreport every program but one. The
 * top-level `rollup` therefore counts each engagement once, from the flat list,
 * rather than summing the programs.
 */
export const buildOfficePortfolio = (
  projects: readonly Project[],
  engagements: readonly OfficeEngagement[],
  options: BuildPortfolioOptions = {},
): OfficePortfolio => {
  const now = options.now ?? Date.now();
  const activityDays = options.activityDays ?? 14;
  const initiativeIndex = options.initiatives ?? [];
  const initiativeById = new Map(initiativeIndex.map((item) => [item.id, item]));
  const initiativeByCode = new Map(
    initiativeIndex.filter((item) => item.code).map((item) => [item.code, item]),
  );

  /**
   * The programs a project belongs to, by **id**.
   *
   * `initiativeIds` is the relation. A legacy project that only carries codes
   * is migrated here, in memory, so it keeps grouping correctly before anyone
   * re-saves it through the picker. A code that resolves to nothing survives as
   * its own group rather than making the work disappear.
   */
  const programKeysFor = (node: { initiativeIds: string[]; codes: string[] }): string[] => {
    const keys = new Set<string>();
    for (const id of node.initiativeIds) {
      if (initiativeById.has(id)) keys.add(id);
    }
    if (keys.size === 0) {
      for (const code of node.codes) {
        const resolved = initiativeByCode.get(code);
        keys.add(resolved ? resolved.id : code);
      }
    }
    return [...keys];
  };

  const engagementsByProject = new Map<string, OfficeEngagement[]>();
  for (const engagement of engagements) {
    const list = engagementsByProject.get(engagement.projectId) ?? [];
    list.push(engagement);
    engagementsByProject.set(engagement.projectId, list);
  }

  const projectNodes: ArchitectureProjectNode[] = projects.map((project) => {
    const own = engagementsByProject.get(project.id) ?? [];
    // A code declared on the engagement but not yet on the project still places
    // the project under that program — the intake is the more recent statement.
    // Ids from the project and from any deliverable that narrowed them; the
    // codes are consulted only where nothing has migrated yet.
    const ids = new Set<string>(project.initiativeIds ?? []);
    const codes = new Set<string>(project.linkedBusinessProjects ?? []);
    for (const engagement of own) {
      for (const id of engagement.initiativeIds) ids.add(id);
      for (const code of engagement.businessProjectIds) codes.add(code);
    }
    const programKeys = programKeysFor({ initiativeIds: [...ids], codes: [...codes] });
    const rollup = rollupEngagements(own, now);
    return {
      projectId: project.id,
      name: project.name,
      description: project.description,
      businessProgramIds: programKeys.sort((a, b) => a.localeCompare(b)),
      engagements: [...own].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      artifactCount: countLatestArtifacts(project),
      rollup,
      health: worstHealthBucket(own.map((engagement) => healthBucketOf(engagement.status))),
      lastActivityAt: latestTimestamp([
        project.updatedAt,
        ...own.map((engagement) => engagement.updatedAt),
      ]),
    };
  });

  const programsById = new Map<string, BusinessProgramNode>();
  const programFor = (id: string, name: string): BusinessProgramNode => {
    const existing = programsById.get(id);
    if (existing) return existing;
    const created: BusinessProgramNode = {
      id,
      name,
      isUnassigned: id === UNASSIGNED_PROGRAM_ID,
      projects: [],
      rollup: emptyPortfolioRollup(),
      health: 'idle',
      lastActivityAt: undefined,
    };
    programsById.set(id, created);
    return created;
  };

  for (const node of projectNodes) {
    if (node.businessProgramIds.length === 0) {
      programFor(UNASSIGNED_PROGRAM_ID, UNASSIGNED_PROGRAM_NAME).projects.push(node);
      continue;
    }
    for (const key of node.businessProgramIds) {
      // A registered initiative lends its code and title; an unresolved key is
      // its own name, which is still better than hiding the work behind it.
      const initiative = initiativeById.get(key);
      const name = initiative
        ? `${initiative.code || 'sin código'} · ${initiative.title}`
        : key;
      programFor(key, name).projects.push(node);
    }
  }

  const programs = [...programsById.values()].map((program) => {
    const programEngagements = program.projects.flatMap((node) => node.engagements);
    return {
      ...program,
      rollup: rollupEngagements(programEngagements, now),
      health: worstHealthBucket(program.projects.map((node) => node.health)),
      lastActivityAt: latestTimestamp(program.projects.map((node) => node.lastActivityAt)),
    };
  });

  // Loudest program first; the synthetic bucket always sinks to the bottom so
  // it never outranks a real business initiative.
  programs.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    const rank = OFFICE_HEALTH_ORDER.indexOf(a.health) - OFFICE_HEALTH_ORDER.indexOf(b.health);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });

  const projectNameById = new Map(projectNodes.map((node) => [node.projectId, node.name]));
  const programNameByProject = new Map<string, { id: string; name: string }>();
  for (const program of programs) {
    for (const node of program.projects) {
      if (!programNameByProject.has(node.projectId)) {
        programNameByProject.set(node.projectId, { id: program.id, name: program.name });
      }
    }
  }

  const decisionQueue: OfficeDecisionItem[] = engagements
    .filter((engagement) => healthBucketOf(engagement.status) === 'awaiting-decision'
      || healthBucketOf(engagement.status) === 'blocked')
    .map((engagement) => {
      const program = programNameByProject.get(engagement.projectId);
      const { reason, requiresAdmin } = describeDecision(engagement);
      return {
        engagement,
        programId: program?.id ?? UNASSIGNED_PROGRAM_ID,
        programName: program?.name ?? UNASSIGNED_PROGRAM_NAME,
        projectName: projectNameById.get(engagement.projectId) ?? 'Proyecto',
        bucket: healthBucketOf(engagement.status),
        reason,
        requiresAdmin,
      };
    })
    .sort((a, b) => (
      OFFICE_HEALTH_ORDER.indexOf(a.bucket) - OFFICE_HEALTH_ORDER.indexOf(b.bucket)
      || a.engagement.updatedAt.localeCompare(b.engagement.updatedAt)
    ));

  return {
    programs,
    projects: projectNodes,
    rollup: rollupEngagements(engagements, now),
    decisionQueue,
    activity: buildActivitySeries(engagements, activityDays, now),
    specialists: buildSpecialistLoad(engagements),
  };
};

/** Total findings across all severities — the headline "hallazgos" number. */
export const totalFindings = (mix: OfficeFindingMix): number =>
  SEVERITY_ORDER.reduce((sum, severity) => sum + mix[severity], 0);
