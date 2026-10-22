import { describe, expect, it } from 'vitest';
import { isCurrentStamp } from './agentEvalHarness';
import { coordinateRequest } from '../../../services/architectureOffice/application/officeCoordination';
import { describeOperation, exportOperationTrace } from '../../../services/architectureOffice/application/officeOperationTrace';
import type { OperationTraceNode } from '../../../services/architectureOffice/application/officeOperationTrace';

const flatten = (node: OperationTraceNode): OperationTraceNode[] => [node, ...node.children.flatMap(flatten)];

describe('operation trace correlation bench', () => {
  it('retains every measured invocation under its handoff, including refinement, without duplicating events', async () => {
    let calls = 0;
    const outcome = await coordinateRequest({
      request: 'Arquitectura de software e integración de aplicaciones',
      scope: { level: 'project', id: 'p', name: 'Proyecto', briefing: [] },
      maxSpecialists: 2,
      invoke: async (_persona, _prompt, _stamp, options) => {
        calls += 1;
        expect(options?.operationId).toBeTruthy();
        expect(options?.invocationId).toBeTruthy();
        return { text: 'Respuesta sin evidencia', model: `model-${calls}`, usage: { totalTokens: calls * 10 },
          latencyMs: calls * 5, traceId: `trace-${calls}`, estimatedCostUsd: null, toolCalls: ['lookup'],
          privatePayload: 'sensitive-provider-payload-must-not-export' };
      },
    });
    expect(calls).toBeGreaterThanOrEqual(4);
    expect(outcome.runId).toBeTruthy();
    expect(outcome.invocations).toHaveLength(calls);
    const nodes = flatten(describeOperation(outcome));
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(nodes.filter((node) => node.kind === 'invocation')).toHaveLength(calls);
    const exported = JSON.parse(exportOperationTrace(outcome));
    const exportedNodes = flatten(exported.tree as OperationTraceNode);
    expect(JSON.stringify(exported)).not.toContain('sensitive-provider-payload-must-not-export');
    for (const event of outcome.events) {
      expect(nodes.filter((node) => node.id === event.id)).toHaveLength(1);
    }
    for (const invocation of outcome.invocations ?? []) {
      expect(isCurrentStamp(invocation.promptStamp)).toBe(true);
      const node = nodes.find((item) => item.id === invocation.invocationId);
      expect(node?.children.some((item) => item.kind === 'model-call')).toBe(true);
      expect(nodes.some((item) => item.kind === 'handoff' && item.children.some((child) => child.id === invocation.invocationId))).toBe(true);
      expect(JSON.stringify(exported)).toContain(invocation.measurement.traceId);
      expect(JSON.stringify(exported)).toContain(invocation.measurement.model);
      expect(outcome.events.some((event) => event.invocationId === invocation.invocationId)).toBe(true);
      expect(invocation.measurement.runId).toBe(outcome.runId);
      expect(exportedNodes.find((item) => item.id === `${invocation.invocationId}:model`)?.measurement)
        .toEqual(invocation.measurement);
      expect(node?.children.find((item) => item.kind === 'model-call')?.children[0].label).toContain('lookup');
    }
  });

  it('retains a failed invocation and its event without inventing model accounting', async () => {
    const outcome = await coordinateRequest({
      request: 'Arquitectura de software',
      scope: { level: 'project', id: 'p', name: 'Proyecto', briefing: [] },
      invoke: async () => { throw new Error('provider unavailable'); },
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.invocations).toHaveLength(1);
    const invocation = outcome.invocations![0];
    expect(invocation.status).toBe('failed');
    expect(invocation.measurement).toMatchObject({ model: null, usage: null, traceId: null });
    const nodes = flatten(describeOperation(outcome));
    expect(nodes.find((node) => node.id === invocation.invocationId)?.status).toBe('failed');
    expect(nodes.some((node) => node.kind === 'handoff'
      && node.children.some((child) => child.id === invocation.invocationId))).toBe(true);
    for (const event of outcome.events) expect(nodes.filter((node) => node.id === event.id)).toHaveLength(1);
  });
});
