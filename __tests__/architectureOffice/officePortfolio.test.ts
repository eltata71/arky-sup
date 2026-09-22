import { describe, expect, it } from 'vitest';
import type { Project } from '../../services/architectureProjects';
import {
  buildActivitySeries,
  buildOfficePortfolio,
  buildSpecialistLoad,
  healthBucketOf,
  rollupEngagements,
  totalFindings,
  UNASSIGNED_PROGRAM_ID,
  UNASSIGNED_PROGRAM_NAME,
  worstHealthBucket,
} from '../../services/architectureOffice/officePortfolio';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeAuditEntry,
  type OfficeEngagement,
  type OfficeEngagementStatus,
  type OfficeTask,
} from '../../services/architectureOffice/OfficeTypes';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

const task = (
  overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'status'>,
): OfficeTask => ({
  engagementId: 'eng-1',
  kind: 'produce-artifact',
  title: overrides.id,
  objective: '',
  assigneeId: 'felipe',
  dependsOn: [],
  acceptanceCriteria: [],
  attempts: 1,
  maxAttempts: 2,
  ...overrides,
});

const engagement = (
  overrides: Partial<OfficeEngagement> & Pick<OfficeEngagement, 'id' | 'projectId' | 'status'>,
): OfficeEngagement => ({
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: overrides.id,
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [],
    participantIds: ['felipe', 'elena'],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: '2026-08-20T00:00:00.000Z',
  },
  tasks: [],
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

const project = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

const audit = (action: OfficeAuditEntry['action'], timestamp: string): OfficeAuditEntry => ({
  id: `${action}-${timestamp}`,
  engagementId: 'eng-1',
  action,
  actor: SYSTEM_OFFICE_ACTOR,
  timestamp,
  details: '',
});

describe('healthBucketOf / worstHealthBucket', () => {
  it('collapses the eight engagement statuses into five readable buckets', () => {
    const cases: [OfficeEngagementStatus, string][] = [
      ['blocked', 'blocked'],
      ['awaiting-charter', 'awaiting-decision'],
      ['awaiting-arb', 'awaiting-decision'],
      ['in-progress', 'running'],
      ['delivered', 'delivered'],
      ['intake', 'idle'],
      ['planning', 'idle'],
      ['cancelled', 'idle'],
    ];
    for (const [status, bucket] of cases) {
      expect(healthBucketOf(status)).toBe(bucket);
    }
  });

  it('reports the loudest bucket present, so a parent never looks calmer than its children', () => {
    expect(worstHealthBucket(['delivered', 'blocked', 'running'])).toBe('blocked');
    expect(worstHealthBucket(['delivered', 'running'])).toBe('running');
    expect(worstHealthBucket(['delivered', 'awaiting-decision'])).toBe('awaiting-decision');
    expect(worstHealthBucket([])).toBe('idle');
  });
});

describe('rollupEngagements', () => {
  it('recomputes ratios from summed counters rather than averaging percentages', () => {
    const rollup = rollupEngagements([
      engagement({
        id: 'eng-big',
        projectId: 'p1',
        status: 'in-progress',
        tasks: [
          ...Array.from({ length: 9 }, (_, index) => task({ id: `t${index}`, status: 'completed' })),
          task({ id: 't9', status: 'in-progress' }),
        ],
      }),
      engagement({
        id: 'eng-small',
        projectId: 'p1',
        status: 'in-progress',
        tasks: [task({ id: 's0', status: 'pending' })],
      }),
    ], NOW);

    // 9 of 11 tasks, not the mean of 90 % and 0 %.
    expect(rollup.tasksTotal).toBe(11);
    expect(rollup.tasksCompleted).toBe(9);
    expect(rollup.completionRatio).toBeCloseTo(9 / 11);
  });

  it('counts overdue tasks but never blames one that already finished', () => {
    const rollup = rollupEngagements([
      engagement({
        id: 'eng-1',
        projectId: 'p1',
        status: 'in-progress',
        tasks: [
          task({ id: 'late', status: 'in-progress', dueAt: '2026-08-26T00:00:00.000Z' }),
          task({ id: 'done-late', status: 'completed', dueAt: '2026-08-26T00:00:00.000Z' }),
          task({ id: 'future', status: 'ready', dueAt: '2026-08-30T00:00:00.000Z' }),
        ],
      }),
    ], NOW);

    expect(rollup.overdueTasks).toBe(1);
  });

  it('rolls up review findings, gates, budget and artifacts', () => {
    const rollup = rollupEngagements([
      engagement({
        id: 'eng-1',
        projectId: 'p1',
        status: 'blocked',
        budget: { maxAiCalls: 40, consumedAiCalls: 17 },
        gateAssessment: {
          overallStatus: 'blocked',
          evaluatedAt: '2026-08-26T00:00:00.000Z',
          gates: [
            { id: 'security-review', status: 'conditional', evidenceArtifactIds: [], blockers: [], conditions: ['x'] },
            { id: 'diagram-review', status: 'blocked', evidenceArtifactIds: ['a1'], blockers: ['y'], conditions: [] },
          ],
        },
        tasks: [
          task({
            id: 'produced',
            status: 'completed',
            producedArtifactId: 'a1',
            review: {
              reviewerId: 'elena',
              verdict: 'changes-requested',
              findings: [
                { severity: 'critical', message: 'c' },
                { severity: 'high', message: 'h' },
                { severity: 'low', message: 'l' },
              ],
              summary: 's',
              decidedAt: '2026-08-26T00:00:00.000Z',
            },
          }),
          task({
            id: 'approved',
            status: 'completed',
            review: {
              reviewerId: 'carmen',
              verdict: 'approved',
              findings: [],
              summary: 's',
              decidedAt: '2026-08-26T00:00:00.000Z',
            },
          }),
        ],
      }),
    ], NOW);

    expect(rollup.statusMix.blocked).toBe(1);
    expect(rollup.aiCallsUsed).toBe(17);
    expect(rollup.aiCallsBudget).toBe(40);
    expect(rollup.artifactsProduced).toBe(1);
    expect(rollup.gates).toEqual({ pass: 0, conditional: 1, blocked: 1 });
    expect(totalFindings(rollup.findings)).toBe(3);
    expect(rollup.findings.critical).toBe(1);
    expect(rollup.reviewApprovalRatio).toBeCloseTo(0.5);
  });

  it('treats an empty portfolio as complete rather than as zero progress', () => {
    const rollup = rollupEngagements([], NOW);
    expect(rollup.completionRatio).toBe(1);
    expect(rollup.reviewApprovalRatio).toBe(1);
    expect(rollup.engagements).toBe(0);
  });
});

describe('buildActivitySeries', () => {
  it('seeds every day in the window so an idle stretch reads as zero, not as a gap', () => {
    const series = buildActivitySeries([], 7, NOW);
    expect(series).toHaveLength(7);
    expect(series.every((point) => point.tasksCompleted === 0)).toBe(true);
    // Oldest first.
    expect(series[0].date < series[6].date).toBe(true);
  });

  it('counts what the audit trail actually recorded, and ignores entries outside the window', () => {
    const series = buildActivitySeries([
      engagement({
        id: 'eng-1',
        projectId: 'p1',
        status: 'delivered',
        auditTrail: [
          audit('task-completed', '2026-08-27T09:00:00.000Z'),
          audit('task-completed', '2026-08-27T10:00:00.000Z'),
          audit('engagement-delivered', '2026-08-27T11:00:00.000Z'),
          audit('task-changes-requested', '2026-08-27T11:30:00.000Z'),
          audit('task-completed', '2020-01-01T00:00:00.000Z'),
        ],
      }),
    ], 3, NOW);

    const today = series[series.length - 1];
    expect(today.tasksCompleted).toBe(2);
    expect(today.engagementsDelivered).toBe(1);
    expect(today.reviewsRequested).toBe(1);
    expect(series.reduce((sum, point) => sum + point.tasksCompleted, 0)).toBe(2);
  });
});

describe('buildSpecialistLoad', () => {
  it('separates who is producing from who is reviewing, and ranks by active load', () => {
    const load = buildSpecialistLoad([
      engagement({
        id: 'eng-1',
        projectId: 'p1',
        status: 'in-progress',
        tasks: [
          task({ id: 't1', status: 'in-progress', assigneeId: 'felipe', title: 'Contexto C4' }),
          task({ id: 't2', status: 'awaiting-review', assigneeId: 'felipe', title: 'Contenedores C4' }),
          task({ id: 't3', status: 'completed', assigneeId: 'daniel' }),
          task({
            id: 't4',
            status: 'completed',
            assigneeId: 'daniel',
            review: {
              reviewerId: 'carmen',
              verdict: 'approved',
              findings: [],
              summary: 's',
              decidedAt: '2026-08-26T00:00:00.000Z',
            },
          }),
        ],
      }),
    ]);

    expect(load[0].personaId).toBe('felipe');
    expect(load[0].active).toBe(2);
    expect(load[0].activeTaskTitles).toEqual(['Contexto C4', 'Contenedores C4']);

    const daniel = load.find((entry) => entry.personaId === 'daniel');
    expect(daniel?.completed).toBe(2);
    expect(daniel?.active).toBe(0);

    const carmen = load.find((entry) => entry.personaId === 'carmen');
    expect(carmen?.reviewed).toBe(1);
  });
});

describe('buildOfficePortfolio', () => {
  const projects = [
    project({ id: 'p1', name: 'Plataforma de Pre-Autorizaciones', linkedBusinessProjects: ['NEG-2026-001'] }),
    project({ id: 'p2', name: 'Core de Siniestros', linkedBusinessProjects: ['NEG-2026-001', 'NEG-2026-002'] }),
    project({ id: 'p3', name: 'Laboratorio interno' }),
  ];

  const engagements = [
    engagement({ id: 'eng-1', projectId: 'p1', status: 'blocked', title: 'Auto aprobación' }),
    engagement({ id: 'eng-2', projectId: 'p2', status: 'delivered', title: 'Modernización AS/400' }),
    engagement({ id: 'eng-3', projectId: 'p3', status: 'awaiting-charter', title: 'Prueba de concepto' }),
  ];

  it('nests architecture projects under the business projects they declare', () => {
    const portfolio = buildOfficePortfolio(projects, engagements, { now: NOW });
    const first = portfolio.programs.find((program) => program.id === 'NEG-2026-001');
    expect(first?.projects.map((node) => node.projectId)).toEqual(['p1', 'p2']);

    const second = portfolio.programs.find((program) => program.id === 'NEG-2026-002');
    // A shared platform genuinely serves both initiatives, so it appears under
    // both rather than being hidden from one of them.
    expect(second?.projects.map((node) => node.projectId)).toEqual(['p2']);
  });

  it('parks a project with no business code in the unassigned bucket, sorted last', () => {
    const portfolio = buildOfficePortfolio(projects, engagements, { now: NOW });
    const unassigned = portfolio.programs[portfolio.programs.length - 1];
    expect(unassigned.id).toBe(UNASSIGNED_PROGRAM_ID);
    expect(unassigned.name).toBe(UNASSIGNED_PROGRAM_NAME);
    expect(unassigned.isUnassigned).toBe(true);
    expect(unassigned.projects.map((node) => node.projectId)).toEqual(['p3']);
  });

  it('counts each engagement once at the top even when its project spans two programs', () => {
    const portfolio = buildOfficePortfolio(projects, engagements, { now: NOW });
    expect(portfolio.rollup.engagements).toBe(3);
    // The programs together would double-count p2's engagement.
    const summed = portfolio.programs.reduce((total, program) => total + program.rollup.engagements, 0);
    expect(summed).toBe(4);
  });

  it('lets an engagement place its project under a program the project has not declared yet', () => {
    const portfolio = buildOfficePortfolio(
      [project({ id: 'p9', name: 'Nuevo' })],
      [engagement({ id: 'eng-9', projectId: 'p9', status: 'intake', businessProjectIds: ['NEG-2026-009'] })],
      { now: NOW },
    );
    expect(portfolio.programs[0].id).toBe('NEG-2026-009');
    expect(portfolio.projects[0].businessProgramIds).toEqual(['NEG-2026-009']);
  });

  it('orders programs by how loudly they need attention, ignoring the name', () => {
    const portfolio = buildOfficePortfolio(projects, engagements, { now: NOW });
    const realPrograms = portfolio.programs.filter((program) => !program.isUnassigned);
    // NEG-2026-001 holds the blocked engagement, so it outranks NEG-2026-002.
    expect(realPrograms[0].id).toBe('NEG-2026-001');
    expect(realPrograms[0].health).toBe('blocked');
  });

  it('builds a decision queue that says why each engagement is stuck', () => {
    const portfolio = buildOfficePortfolio(projects, engagements, { now: NOW });
    expect(portfolio.decisionQueue.map((item) => item.engagement.id)).toEqual(['eng-1', 'eng-3']);

    const blocked = portfolio.decisionQueue[0];
    expect(blocked.bucket).toBe('blocked');
    expect(blocked.projectName).toBe('Plataforma de Pre-Autorizaciones');
    expect(blocked.programName).toBe('NEG-2026-001');
    expect(blocked.reason).toMatch(/detenido|gates/i);

    const charter = portfolio.decisionQueue[1];
    expect(charter.requiresAdmin).toBe(false);
    expect(charter.reason).toMatch(/charter/i);
  });

  it('flags the board decision as admin-only so the UI never offers a write that will be rejected', () => {
    const portfolio = buildOfficePortfolio(
      [project({ id: 'p1', name: 'Proyecto' })],
      [engagement({ id: 'eng-arb', projectId: 'p1', status: 'awaiting-arb' })],
      { now: NOW },
    );
    expect(portfolio.decisionQueue[0].requiresAdmin).toBe(true);
  });

  it('counts only the latest version of each artifact', () => {
    const portfolio = buildOfficePortfolio(
      [project({
        id: 'p1',
        name: 'Proyecto',
        artifacts: [
          { versionGroupId: 'g1', version: 1 },
          { versionGroupId: 'g1', version: 2 },
          { versionGroupId: 'g2', version: 1 },
        ] as Project['artifacts'],
      })],
      [],
      { now: NOW },
    );
    expect(portfolio.projects[0].artifactCount).toBe(2);
  });

  it('survives an empty office without inventing a portfolio', () => {
    const portfolio = buildOfficePortfolio([], [], { now: NOW });
    expect(portfolio.programs).toEqual([]);
    expect(portfolio.projects).toEqual([]);
    expect(portfolio.decisionQueue).toEqual([]);
    expect(portfolio.specialists).toEqual([]);
    expect(portfolio.activity).toHaveLength(14);
  });
});
