/**
 * A run can be reconstructed from what the engagement recorded.
 *
 * This is the property the correlation ids exist for, and it did not hold: the
 * audit trail said a task started and finished, the agent action log held the
 * prompt, the phases, the versions and the rollback of the generation that did
 * the work, and nothing joined them. `executeAgentAction` returned its trace id
 * and `OfficeProduceOutcome` threw it away.
 */

import { describe, expect, it, vi } from 'vitest';
import { runEngagement, type OfficeRunnerPorts } from '../../services/architectureOffice/OfficeEngagementRunner';
import {
  describeRun,
  describeRuns,
  runIdsOf,
  unattributedWork,
} from '../../services/architectureOffice/officeRunTrace';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/OfficeTypes';
import type { OfficeAgentId } from '../../services/architectureOffice/officeAgentPersonas';

const task = (over: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId'>): OfficeTask => ({
  engagementId: 'eng-1',
  title: over.id,
  objective: '',
  dependsOn: [],
  acceptanceCriteria: [],
  status: over.dependsOn && over.dependsOn.length > 0 ? 'pending' : 'ready',
  attempts: 0,
  maxAttempts: 2,
  ...over,
});

const engagementWith = (tasks: OfficeTask[]): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo de prueba',
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium',
  status: 'in-progress',
  charter: {
    kind: 'new-solution',
    objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
    deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: '2026-08-26T00:00:00.000Z',
  },
  tasks,
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

const ports = (over: Partial<OfficeRunnerPorts> = {}): OfficeRunnerPorts => ({
  produceArtifact: vi.fn(async () => ({
    status: 'success' as const,
    artifactId: 'art-1',
    versionGroupId: 'grp-1',
    traceId: 'agent-trace-1',
  })),
  reviewArtifact: vi.fn(async (current: OfficeTask) => ({
    reviewerId: current.assigneeId,
    traceId: 'office-review-1',
    verdict: 'approved' as const,
    findings: [],
    summary: 'ok',
    decidedAt: '2026-08-26T00:00:00.000Z',
  })),
  consolidate: vi.fn(async () => ({
    status: 'success' as const,
    summary: 'Ready.',
    traceId: 'office-consolidate-1',
  })),
  persist: vi.fn(async () => undefined),
  ...over,
});

const chain = (): OfficeTask[] => [
  task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
  task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', reviewsTaskId: 'p1', dependsOn: ['p1'] }),
  task({ id: 'c1', kind: 'consolidate', assigneeId: 'alejandro', dependsOn: ['r1'] }),
];

describe('a run is an attempt, and it is identified', () => {
  it('stamps one run id on the engagement, its tasks and its audit trail', async () => {
    const { engagement } = await runEngagement(engagementWith(chain()), ports());

    expect(engagement.currentRunId).toBeTruthy();
    const runId = engagement.currentRunId as string;
    for (const item of engagement.tasks) expect(item.runId, item.id).toBe(runId);
    expect(engagement.auditTrail.length).toBeGreaterThan(0);
    for (const entry of engagement.auditTrail) expect(entry.runId).toBe(runId);
  });

  it('gives a second attempt its own id, so the trail can tell them apart', async () => {
    const first = await runEngagement(engagementWith(chain()), ports());
    // Resume: rewind the tasks the way a fresh scheduling pass would find them.
    const resumed: OfficeEngagement = {
      ...first.engagement,
      status: 'in-progress',
      tasks: first.engagement.tasks.map((item) => ({ ...item, status: 'ready' as const, completedAt: undefined })),
    };
    const second = await runEngagement(resumed, ports());

    expect(second.engagement.currentRunId).not.toBe(first.engagement.currentRunId);
    expect(runIdsOf(second.engagement)).toHaveLength(2);
  });

  it('honours a run id the caller supplies', async () => {
    const { engagement } = await runEngagement(engagementWith(chain()), ports(), { runId: 'run-fijo' });
    expect(engagement.currentRunId).toBe('run-fijo');
    expect(describeRun(engagement, 'run-fijo').tasks).toHaveLength(3);
  });
});

describe('a task carries the invocations it caused', () => {
  /**
   * The thread back to `projects/{id}/agent_actions/{traceId}` — the prompt,
   * the phases, the versions and the rollback of the generation that made the
   * deliverable.
   */
  it('records the agent trace of the production that made the artifact', async () => {
    const { engagement } = await runEngagement(engagementWith(chain()), ports());
    const produced = engagement.tasks.find((item) => item.id === 'p1');
    expect(produced?.traceIds).toEqual(['agent-trace-1']);
  });

  it('records the trace of a production that failed, which is when it matters most', async () => {
    const { engagement } = await runEngagement(
      engagementWith([task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })]),
      ports({
        produceArtifact: vi.fn(async () => ({
          status: 'failed' as const,
          traceId: 'agent-trace-fallida',
          message: 'no se pudo',
        })),
      }),
    );
    const failed = engagement.tasks.find((item) => item.id === 'p1');
    expect(failed?.status).toBe('failed');
    expect(failed?.traceIds).toEqual(['agent-trace-fallida']);
  });

  it('keeps every attempt’s trace when a reviewer sends work back', async () => {
    let attempt = 0;
    const { engagement } = await runEngagement(
      engagementWith(chain()),
      ports({
        produceArtifact: vi.fn(async () => {
          attempt += 1;
          return {
            status: 'success' as const,
            artifactId: 'art-1',
            versionGroupId: 'grp-1',
            traceId: `agent-trace-${attempt}`,
          };
        }),
        reviewArtifact: vi.fn(async (current: OfficeTask) => ({
          reviewerId: current.assigneeId,
          verdict: attempt < 2 ? ('changes-requested' as const) : ('approved' as const),
          findings: [{ severity: 'high' as const, message: 'falta la vista de despliegue' }],
          summary: 'correcciones',
          decidedAt: '2026-08-26T00:00:00.000Z',
        })),
      }),
    );
    const produced = engagement.tasks.find((item) => item.id === 'p1');
    // Both generations are reachable, not just the one that survived.
    expect(produced?.traceIds).toEqual(['agent-trace-1', 'agent-trace-2']);
  });

  it('records the review and consolidation invocations too', async () => {
    const { engagement } = await runEngagement(engagementWith(chain()), ports());
    expect(engagement.tasks.find((i) => i.id === 'r1')?.traceIds).toEqual(['office-review-1']);
    expect(engagement.tasks.find((i) => i.id === 'c1')?.traceIds).toEqual(['office-consolidate-1']);
  });
});

describe('describeRun', () => {
  it('reconstructs the whole attempt: tasks, trail and every correlation id', async () => {
    const { engagement } = await runEngagement(engagementWith(chain()), ports());
    const summary = describeRun(engagement, engagement.currentRunId as string);

    expect(summary.tasks.map((t) => t.id)).toEqual(['p1', 'r1', 'c1']);
    expect(summary.traceIds).toEqual(['agent-trace-1', 'office-review-1', 'office-consolidate-1']);
    expect(summary.auditTrail.length).toBeGreaterThan(0);
    expect(summary.startedAt).toBeTruthy();
    expect(summary.finishedAt).toBeTruthy();
  });

  it('does not leak one attempt’s work into another', async () => {
    const first = await runEngagement(engagementWith(chain()), ports(), { runId: 'run-a' });
    const resumed: OfficeEngagement = {
      ...first.engagement,
      status: 'in-progress',
      tasks: first.engagement.tasks.map((t) => ({ ...t, status: 'ready' as const, completedAt: undefined })),
    };
    const second = await runEngagement(resumed, ports(), { runId: 'run-b' });

    // The tasks moved to run-b; run-a keeps only the trail it wrote.
    expect(describeRun(second.engagement, 'run-a').tasks).toEqual([]);
    expect(describeRun(second.engagement, 'run-a').auditTrail.length).toBeGreaterThan(0);
    expect(describeRun(second.engagement, 'run-b').tasks).toHaveLength(3);
    expect(describeRuns(second.engagement).map((r) => r.runId)).toEqual(['run-a', 'run-b']);
  });

  /**
   * An engagement stored by an older build has real history. Dating it to an
   * attempt it never belonged to would be worse than admitting it is
   * unattributed.
   */
  it('reports pre-correlation work as unattributed instead of folding it in', () => {
    const legacy = engagementWith(chain());
    expect(runIdsOf(legacy)).toEqual([]);
    expect(unattributedWork(legacy).tasks).toHaveLength(3);
  });
});
