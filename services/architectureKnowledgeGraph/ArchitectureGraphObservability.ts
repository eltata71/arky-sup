/**
 * Observability adapter for the Architecture Knowledge Graph.
 *
 * Centralises the `graph.*` event vocabulary so every AKG service emits the
 * same, greppable event names. Failures are reported as recoverable warnings /
 * errors — never thrown — so the graph can never produce a blank screen.
 */

import { observabilityService } from '../observability';

export type ArchitectureGraphEvent =
  | 'graph.build.started'
  | 'graph.build.completed'
  | 'graph.build.failed'
  | 'graph.entity.extracted'
  | 'graph.entity.duplicated'
  | 'graph.relation.extracted'
  | 'graph.consistency.issue.detected'
  | 'graph.traceability.gap.detected'
  | 'graph.impact.analysis.completed'
  | 'graph.persistence.failed'
  | 'graph.promptContext.generated';

type EventMetadata = Record<string, string | number | boolean | undefined>;

const SUCCESS_EVENTS: ReadonlySet<ArchitectureGraphEvent> = new Set([
  'graph.build.completed',
  'graph.impact.analysis.completed',
  'graph.promptContext.generated',
]);

/**
 * Emits a structured AKG observability event. Informational events are
 * recorded at low severity so they never spam the global error center.
 */
export const trackGraphEvent = (
  event: ArchitectureGraphEvent,
  message: string,
  metadata?: EventMetadata,
): void => {
  try {
    observabilityService.trackEvent({
      severity: SUCCESS_EVENTS.has(event) ? 'success' : 'info',
      source: 'operation',
      status: SUCCESS_EVENTS.has(event) ? 'succeeded' : 'observed',
      title: 'Knowledge Graph',
      message: `${event} — ${message}`,
      operationName: event,
      recoverable: true,
      userVisible: false,
      metadata,
    });
  } catch {
    /* Observability must never break the graph pipeline. */
  }
};

/** Reports a recoverable AKG failure without throwing. */
export const reportGraphFailure = (
  event: Extract<ArchitectureGraphEvent, 'graph.build.failed' | 'graph.persistence.failed'>,
  error: unknown,
  metadata?: EventMetadata,
): void => {
  try {
    observabilityService.reportError(error, {
      source: 'operation',
      title: 'Fallo en el Grafo de Conocimiento Arquitectónico',
      message:
        event === 'graph.persistence.failed'
          ? 'No se pudo persistir el grafo de conocimiento. El proyecto sigue funcionando con su estado anterior.'
          : 'No se pudo construir el grafo de conocimiento. La generación de artefactos continúa sin él.',
      operationName: event,
      recoverable: true,
      userVisible: false,
      metadata,
    });
  } catch {
    /* noop */
  }
};
