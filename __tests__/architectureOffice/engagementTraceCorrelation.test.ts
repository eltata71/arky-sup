import { describe, expect, it } from 'vitest';
import { runEngagement, type OfficeRunnerPorts } from '../../services/architectureOffice/application/OfficeEngagementRunner';
import { fromEngagementRun, describeOperation, exportOperationTrace, type OperationTraceNode } from '../../services/architectureOffice/operationTrace';
import { describeRun, runIdsOf } from '../../services/architectureOffice/application/officeRunTrace';
import { normalizeEngagement } from '../../services/architectureOffice/domain/officeEngagementRecord';
import { DEFAULT_OFFICE_BUDGET, OFFICE_ENGAGEMENT_SCHEMA_VERSION, SYSTEM_OFFICE_ACTOR, type OfficeEngagement, type OfficeTask } from '../../services/architectureOffice/domain/OfficeTypes';
import type { AgentInvocationMeasurement } from '../../lib/ai/agentUsage';


const flatten = (node: OperationTraceNode): OperationTraceNode[] => [node, ...node.children.flatMap(flatten)];

const task = (id: string, kind: OfficeTask['kind'], assigneeId: OfficeTask['assigneeId'], dependsOn: string[] = []): OfficeTask => ({
  id, kind, assigneeId, dependsOn, engagementId: 'eng-1', title: id, objective: '', acceptanceCriteria: [],
  status: 'pending', attempts: 0, maxAttempts: 2,
});
const fixture = (): OfficeEngagement => ({
  id: 'eng-1', projectId: 'p', schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION, title: 'Encargo', brief: 'brief',
  businessProjectIds: [], initiativeIds: [], priority: 'medium', status: 'in-progress',
  charter: { kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
    deliverables: [], participantIds: [], coordinatorId: 'lucia', consolidatorId: 'alejandro', provenance: 'deterministic',
    proposedAt: '2026-08-26T00:00:00.000Z', approvedAt: '2026-08-26T01:00:00.000Z', approvedBy: SYSTEM_OFFICE_ACTOR },
  tasks: [task('p1', 'produce-artifact', 'felipe'),
    { ...task('r1', 'review-artifact', 'elena', ['p1']), reviewsTaskId: 'p1' },
    task('c1', 'consolidate', 'alejandro', ['r1'])],
  arbDecisions: [], budget: { ...DEFAULT_OFFICE_BUDGET }, auditTrail: [], createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
});
const measured = (id: string): AgentInvocationMeasurement => ({
  model: `model-${id}`, traceId: `trace-${id}`, invocationId: `invocation-${id}`,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, latencyMs: 25, estimatedCostUsd: null,
  promptStamp: `stamp-${id}`, status: 'completed', toolCalls: ['lookup'],
});
const ports = (): OfficeRunnerPorts => ({
  produceArtifact: async () => ({ status: 'success', artifactId: 'a', traceId: 'agent-action', aiCalls: 2,
    measurements: [measured('p1'), measured('p2')] }),
  reviewArtifact: async (current) => ({ reviewerId: current.assigneeId, verdict: 'approved', basis: 'model-and-evidence',
    summary: 'ok', findings: [], decidedAt: '2026-08-26T00:00:00.000Z', traceId: 'trace-r', measurement: measured('r') }),
  consolidate: async () => ({ status: 'success', summary: 'Ready', traceId: 'trace-c', measurement: measured('c') }),
  persist: async (engagement) => ({ status: 'success', success: true, operationId: 'persist', target: 'supabase', data: engagement }),
});

describe('engagement trace correlation', () => {
  it('runs production, review and consolidation; exports all four measured calls after reload', async () => {
    const result = await runEngagement(fixture(), ports(), { runId: 'run-1' });
    expect(result.status).toBe('completed');
    const reloaded = normalizeEngagement(JSON.parse(JSON.stringify(result.engagement)), 'p')!;
    const source = fromEngagementRun(reloaded, 'run-1');
    expect(source.invocations).toHaveLength(4);
    expect(source.invocations?.map((invocation) => invocation.promptStamp))
      .toEqual(['stamp-p1', 'stamp-p2', 'stamp-r', 'stamp-c']);
    const exported = exportOperationTrace(source);
    for (const id of ['p1', 'p2', 'r', 'c']) {
      expect(exported).toContain(`model-${id}`);
      expect(exported).toContain(`trace-${id}`);
      expect(describeRun(reloaded, 'run-1').traceIds).toContain(`trace-${id}`);
    }
    expect(source.invocations?.every((invocation) => invocation.measurement.usage?.totalTokens === 15)).toBe(true);
    const nodes = flatten(JSON.parse(exported).tree as OperationTraceNode);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    for (const invocation of source.invocations ?? []) {
      expect(nodes.some((node) => node.kind === 'handoff'
        && node.children.some((child) => child.id === invocation.invocationId))).toBe(true);
      expect(nodes.find((node) => node.id === `${invocation.invocationId}:model`)?.measurement)
        .toEqual(invocation.measurement);
    }
    expect(describeOperation(source).runId).toBe('run-1');
    expect(exported).toContain('lookup');
  });

  it('does not redate measurements to a newer run when tasks are retried', async () => {
    const first = await runEngagement(fixture(), ports(), { runId: 'run-1' });
    const resumed = { ...first.engagement, status: 'in-progress' as const,
      tasks: first.engagement.tasks.map((item) => ({ ...item, status: 'ready' as const })) };
    const second = await runEngagement(resumed, ports(), { runId: 'run-2' });
    expect(fromEngagementRun(second.engagement, 'run-1').invocations).toHaveLength(4);
    expect(fromEngagementRun(second.engagement, 'run-2').invocations).toHaveLength(4);
    expect(describeRun(second.engagement, 'run-1').traceIds).toContain('trace-p1');
    expect(fromEngagementRun(second.engagement, 'run-1').traceIds).toContain('trace-p1');
  });

  it('keeps canonical trace ids in their measured run instead of leaking accumulated task ids', () => {
    const engagement = fixture();
    engagement.tasks[0] = { ...engagement.tasks[0], runId: 'run-2', traceIds: ['trace-old', 'trace-new'],
      measurements: [{ ...measured('old'), runId: 'run-1' }, { ...measured('new'), runId: 'run-2' }] };
    expect(describeRun(engagement, 'run-1').traceIds).toEqual(['trace-old']);
    expect(describeRun(engagement, 'run-2').traceIds).toEqual(['trace-new']);
    expect(runIdsOf(engagement)).toContain('run-1');
  });
});
