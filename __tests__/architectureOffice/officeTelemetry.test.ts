import { describe, expect, it } from 'vitest';
import { summarizeEngagementMetrics } from '../../services/architectureOffice/infrastructure/officeTelemetry';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';

const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId' | 'status'>): OfficeTask => ({
  engagementId: 'eng-1',
  title: overrides.id,
  objective: '',
  dependsOn: [],
  acceptanceCriteria: [],
  attempts: 0,
  maxAttempts: 2,
  ...overrides,
});

const engagement = (tasks: OfficeTask[], consumedAiCalls = 6): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo',
  brief: 'b',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  status: 'awaiting-arb',
  charter: {
    kind: 'modernization',
    objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
    deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic', proposedAt: '2026-08-26T00:00:00.000Z',
  },
  tasks,
  arbDecisions: [],
  budget: { maxAiCalls: DEFAULT_OFFICE_BUDGET.maxAiCalls, consumedAiCalls },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

describe('officeTelemetry', () => {
  it('counts a re-run as rework and reports the rate over deliverables', () => {
    const metrics = summarizeEngagementMetrics(engagement([
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', attempts: 2 }),
      task({ id: 'p2', kind: 'produce-artifact', assigneeId: 'mauricio', status: 'completed', attempts: 1 }),
    ]));

    expect(metrics.reworkCount).toBe(1);
    expect(metrics.reworkRate).toBeCloseTo(0.5);
  });

  it('reports no rework when every deliverable passed first time', () => {
    const metrics = summarizeEngagementMetrics(engagement([
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', attempts: 1 }),
    ]));
    expect(metrics.reworkCount).toBe(0);
    expect(metrics.reworkRate).toBe(0);
  });

  it('attributes changes-requested to the persona whose output was sent back', () => {
    const metrics = summarizeEngagementMetrics(engagement([
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed', attempts: 2 }),
      task({
        id: 'r1', kind: 'review-artifact', assigneeId: 'elena', status: 'completed', reviewsTaskId: 'p1',
        review: {
          reviewerId: 'elena', verdict: 'changes-requested', findings: [],
          summary: 's', deterministicScore: 70, decidedAt: '2026-08-26T00:00:00.000Z',
        },
      }),
    ]));

    const felipe = metrics.personas.find((persona) => persona.personaId === 'felipe')!;
    const elena = metrics.personas.find((persona) => persona.personaId === 'elena')!;
    expect(felipe.changesRequested).toBe(1);
    expect(felipe.averageScore).toBe(70);
    expect(elena.reviewed).toBe(1);
    expect(elena.changesRequested).toBe(0);
  });

  it('reports budget utilisation against the ceiling', () => {
    const metrics = summarizeEngagementMetrics(engagement([], 20));
    expect(metrics.aiCallsConsumed).toBe(20);
    expect(metrics.budgetUtilisation).toBeCloseTo(20 / DEFAULT_OFFICE_BUDGET.maxAiCalls);
  });

  it('measures elapsed time across the whole run', () => {
    const metrics = summarizeEngagementMetrics(engagement([
      task({
        id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed',
        startedAt: '2026-08-26T10:00:00.000Z', completedAt: '2026-08-26T10:03:00.000Z',
      }),
      task({
        id: 'p2', kind: 'produce-artifact', assigneeId: 'mauricio', status: 'completed',
        startedAt: '2026-08-26T10:01:00.000Z', completedAt: '2026-08-26T10:09:00.000Z',
      }),
    ]));

    expect(metrics.elapsedMinutes).toBe(9);
    expect(metrics.personas.find((persona) => persona.personaId === 'felipe')!.averageMinutes).toBe(3);
  });

  it('reports null rather than zero when there is nothing to average', () => {
    const metrics = summarizeEngagementMetrics(engagement([
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'pending' }),
    ]));
    expect(metrics.elapsedMinutes).toBeNull();
    expect(metrics.personas[0].averageMinutes).toBeNull();
    expect(metrics.personas[0].averageScore).toBeNull();
  });

  it('survives an empty engagement', () => {
    const metrics = summarizeEngagementMetrics(engagement([]));
    expect(metrics.totalTasks).toBe(0);
    expect(metrics.reworkRate).toBe(0);
    expect(metrics.personas).toEqual([]);
  });
});
