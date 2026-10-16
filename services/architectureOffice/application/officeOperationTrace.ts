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

export type OperationTraceNodeKind =
  | 'operation'
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
  children: OperationTraceNode[];
}

const clean = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : redactSecretShapes(text);

const eventNode = (event: CoordinationEvent): OperationTraceNode => ({
  id: event.id,
  kind: 'event',
  label: redactSecretShapes(event.summary),
  status: event.kind === 'agent-failed' || event.kind === 'operation-failed' ? 'failed' : undefined,
  detail: clean(event.detail),
  prompt: event.prompt,
  elapsedMs: event.elapsedMs,
  children: [],
});

export const describeOperation = (outcome: CoordinationOutcome): OperationTraceNode => {
  const children: OperationTraceNode[] = [];

  for (const member of outcome.team) {
    const own = outcome.events.filter(
      (event) => event.from === member.personaId || event.to === member.personaId,
    );
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

  const unassigned = outcome.events.filter(
    (event) => !outcome.team.some((m) => event.from === m.personaId || event.to === m.personaId),
  );
  children.push(...unassigned.map(eventNode));

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
    id: outcome.operationId,
    kind: 'operation',
    label: outcome.operationId,
    status: outcome.status === 'completed' ? 'ok' : outcome.status === 'failed' ? 'failed' : 'warning',
    detail: clean(outcome.framing) || undefined,
    children,
  };
};

export const flattenPromptStamps = (outcome: CoordinationOutcome): string[] => [
  ...(outcome.promptStamps ?? []),
];

/** JSON de la traza, sin credenciales. */
export const exportOperationTrace = (outcome: CoordinationOutcome): string =>
  JSON.stringify(
    {
      tree: describeOperation(outcome),
      promptStamps: flattenPromptStamps(outcome),
      usage: outcome.usage ?? null,
    },
    null,
    2,
  );
