/**
 * Una operación coordinada, leída como árbol.
 *
 * `describeRun` reconstruye un intento de un encargo; esto reconstruye una
 * petición del asistente: quién se convocó, qué se le pidió a cada uno, qué
 * handoffs se rechazaron antes de gastar una llamada y si la consolidación
 * necesitó corrección. Se deriva del resultado de `coordinateRequest`, nunca se
 * guarda. Lo que sale en texto (resúmenes, detalle, exportación) pasa por
 * `redactSecretShapes`: una traza se copia y sobrevive a la pantalla.
 */

import { redactSecretShapes } from '../../../lib/secretShapes';
import type { CoordinationEvent, CoordinationOutcome } from './officeCoordination';
import type { OfficeEngagement } from '../domain/OfficeTypes';
import type { AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import { describeRun } from './officeRunTrace';
import { invocationBranches } from './operationInvocationTrace';
import { unknownInvocation } from '../domain/officeUsage';
import { usageForTrace } from './operationTraceUsage';

/** Both surfaces project onto the same neutral read model; old outcomes remain valid. */
export type OperationTraceSource = Pick<CoordinationOutcome,
  'operationId' | 'runId' | 'status' | 'team' | 'framing' | 'contributions' | 'events'
  | 'invocations' | 'usage' | 'rejectedHandoffs' | 'promptStamps' | 'refined' | 'consolidationReview'> & { traceIds?: string[] };

export const fromCoordinationOutcome = (outcome: CoordinationOutcome): OperationTraceSource => outcome;

export const fromEngagementRun = (engagement: OfficeEngagement, runId: string): OperationTraceSource => {
  const run = describeRun(engagement, runId);
  return {
    operationId: engagement.id, runId, traceIds: run.traceIds,
    status: run.tasks.some((task) => task.status === 'failed') ? 'failed'
      : run.tasks.length > 0 && run.tasks.every((task) => task.status === 'completed') ? 'completed' : 'partial',
    team: [], framing: engagement.title, contributions: [], events: [],
    promptStamps: run.tasks.flatMap((task) => task.promptStamps ?? []),
    invocations: engagement.tasks.flatMap((task) => {
      const measured = (task.measurements ?? []).filter((item) => item.runId === runId || (!item.runId && task.runId === runId));
      const values = measured.length || task.runId !== runId ? measured
        : (task.traceIds ?? []).map((traceId) => unknownInvocation(traceId));
      return values.map((measurement, index) => ({
      invocationId: measurement.invocationId ?? `${runId}:${task.id}:${index}`,
      personaId: task.assigneeId,
      role: task.kind === 'consolidate' ? 'consolidator' as const
        : task.kind === 'review-artifact' ? 'reviewer' as const : 'producer' as const,
      promptId: task.kind,
      promptStamp: measurement.promptStamp ?? (task.runId === runId ? task.promptStamps?.[index] : undefined) ?? '',
      handoffId: `${runId}:${task.id}`, workstreamId: task.id,
      attempt: index === 0 ? 'primary' as const : 'refinement' as const,
      status: measurement.status ?? (task.status === 'failed' ? 'failed' as const : 'completed' as const),
      measurement,
      startedAtMs: measurement.startedAtMs ?? (task.startedAt ? Date.parse(task.startedAt) : 0),
    }));
    }),
  };
};

export type OperationTraceNodeKind =
  | 'operation'
  | 'handoff'
  | 'invocation'
  | 'model-call'
  | 'agent'
  | 'event'
  | 'rejected-handoff'
  | 'review';

export interface OperationTraceNode {
  id: string;
  kind: OperationTraceNodeKind;
  label: string;
  status?: 'ok' | 'failed' | 'warning';
  detail?: string;
  prompt?: string;
  elapsedMs?: number;
  runId?: string;
  traceIds?: string[];
  measurement?: AgentInvocationMeasurement;
  children: OperationTraceNode[];
}

const clean = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : redactSecretShapes(text);

const eventNode = (event: CoordinationEvent): OperationTraceNode => ({
  id: redactSecretShapes(event.id),
  kind: 'event',
  label: redactSecretShapes(event.summary),
  status: event.kind === 'agent-failed' || event.kind === 'operation-failed' ? 'failed' : undefined,
  detail: clean(event.detail),
  prompt: clean(event.prompt),
  elapsedMs: event.elapsedMs,
  children: [],
});

export const describeOperation = (outcome: OperationTraceSource): OperationTraceNode => {
  const children: OperationTraceNode[] = [];
  const attributed = new Set((outcome.invocations ?? []).map((invocation) => invocation.invocationId));
  // Canonical order: the tree a reader reconstructs cannot depend on the order
  // in which events arrived, only on their identity. Arrival order is presentation.
  const remaining = outcome.events
    .filter((event) => !event.invocationId || !attributed.has(event.invocationId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const claimed = new Set<string>();

  for (const member of [...outcome.team].sort((a, b) => a.personaId.localeCompare(b.personaId))) {
    const own = remaining.filter((event) => !claimed.has(event.id)
      && (event.from === member.personaId || event.to === member.personaId));
    own.forEach((event) => claimed.add(event.id));
    const contribution = outcome.contributions.find((c) => c.personaId === member.personaId);
    children.push({
      id: `agent:${member.personaId}`,
      kind: 'agent',
      label: `${member.personaId} · ${member.role}`,
      status: contribution ? (contribution.status === 'completed' ? 'ok' : 'failed') : undefined,
      detail: clean(member.rationale),
      children: own.map(eventNode),
    });
  }

  const unassigned = remaining.filter((event) => !claimed.has(event.id));
  children.push(...unassigned.map(eventNode));
  children.push(...invocationBranches(outcome.invocations ?? [], outcome.events, eventNode));

  (outcome.rejectedHandoffs ?? []).forEach((rejected, index) => {
    children.push({
      id: `rejected:${index}`,
      kind: 'rejected-handoff',
      label: `${rejected.sourceAgentId} → ${rejected.targetAgentId} (${rejected.kind})`,
      status: 'warning',
      children: rejected.rejections.map((r, i) => ({
        id: `rejected:${index}:${i}`,
        kind: 'event' as const,
        label: redactSecretShapes(r.message),
        detail: r.code,
        children: [],
      })),
    });
  });

  if (outcome.consolidationReview) {
    const { ok, gaps } = outcome.consolidationReview;
    children.push({
      id: 'review',
      kind: 'review',
      label: outcome.refined ? 'Consolidación corregida una vez' : 'Consolidación evaluada',
      status: ok ? 'ok' : 'warning',
      children: gaps.map((gap, i) => ({
        id: `review:${i}`,
        kind: 'event' as const,
        label: redactSecretShapes(gap),
        children: [],
      })),
    });
  }

  return {
    id: clean(outcome.operationId) ?? '',
    runId: clean(outcome.runId),
    traceIds: (outcome.traceIds ?? outcome.invocations?.flatMap((item) => item.measurement.traceId ? [item.measurement.traceId] : []) ?? []).map(redactSecretShapes),
    kind: 'operation',
    label: clean(outcome.operationId) ?? '',
    status: outcome.status === 'completed' ? 'ok' : outcome.status === 'failed' ? 'failed' : 'warning',
    detail: clean(outcome.framing) || undefined,
    children,
  };
};

export const flattenPromptStamps = (outcome: OperationTraceSource): string[] => [
  ...(outcome.promptStamps ?? []).map(redactSecretShapes),
];

/** JSON de la traza, sin credenciales. */
export const exportOperationTrace = (outcome: OperationTraceSource): string =>
  JSON.stringify(
    {
      tree: describeOperation(outcome),
      promptStamps: flattenPromptStamps(outcome),
      usage: usageForTrace(outcome.usage),
    },
    (_key, value: unknown) => typeof value === 'string' ? redactSecretShapes(value) : value,
    2,
  );
