/**
 * Observability adapter for the publication pipeline.
 *
 * Every pipeline stage emits a structured event through `observabilityService`
 * so failures surface in the Global Observability Center instead of producing a
 * blank screen. This module is a thin, total wrapper — it never throws.
 */

import { observabilityService } from '../observability';
import type { ObservabilityEvent } from '../observability';

/** Canonical event names emitted by the publication pipeline (Task 16). */
export type PublicationEventName =
  | 'publication.preflight.started'
  | 'publication.preflight.completed'
  | 'publication.preflight.failed'
  | 'publication.readiness.evaluated'
  | 'publication.package.created'
  | 'publication.package.updated'
  | 'publication.package.approved'
  | 'publication.package.published'
  | 'publication.package.archived'
  | 'publication.export.started'
  | 'publication.export.completed'
  | 'publication.export.failed'
  | 'publication.accessibility.checked'
  | 'publication.approval.changed'
  | 'publication.manifest.generated'
  | 'publication.version.created'
  | 'publication.package.outdated'
  | 'publication.override.used';

type EventMetadata = Record<string, string | number | boolean | undefined>;

const FAILURE_EVENTS: ReadonlySet<PublicationEventName> = new Set([
  'publication.preflight.failed',
  'publication.export.failed',
]);

const WARNING_EVENTS: ReadonlySet<PublicationEventName> = new Set([
  'publication.package.outdated',
  'publication.override.used',
]);

/**
 * Emit a publication-pipeline event. Safe: any failure in the observability
 * layer is swallowed so the pipeline keeps running.
 */
export const trackPublicationEvent = (
  name: PublicationEventName,
  message: string,
  metadata?: EventMetadata,
): void => {
  try {
    const isFailure = FAILURE_EVENTS.has(name);
    const isWarning = WARNING_EVENTS.has(name);
    observabilityService.trackEvent({
      severity: isFailure ? 'error' : isWarning ? 'warning' : 'info',
      source: 'operation',
      status: isFailure ? 'failed' : 'observed',
      title: 'Pipeline de publicación',
      message,
      detail: name,
      recoverable: true,
      userVisible: isFailure || isWarning,
      metadata: { event: name, ...metadata },
    });
  } catch {
    /* observability must never break the pipeline */
  }
};

/**
 * Report a publication-pipeline failure. Always visible to the user so the
 * pipeline never fails silently.
 */
export const reportPublicationFailure = (
  name: Extract<PublicationEventName, 'publication.preflight.failed' | 'publication.export.failed'>,
  error: unknown,
  metadata?: EventMetadata,
): ObservabilityEvent | undefined => {
  try {
    return observabilityService.reportError(error, {
      source: 'operation',
      title: 'Pipeline de publicación interrumpido',
      message: 'Una etapa del pipeline de publicación falló. El estado se preservó y la operación es reintentable.',
      detail: name,
      severity: 'error',
      recoverable: true,
      userVisible: true,
      metadata: { event: name, ...metadata },
    });
  } catch {
    return undefined;
  }
};
