/**
 * Governance & approval workflow for publication packages (Task 8 & 19).
 *
 * The workflow is a small, explicit state machine layered on top of the
 * existing artifact `reviewStatus` — it never replaces or breaks it:
 *
 *   draft ─▶ ready-for-review ─▶ approved ─▶ published
 *     ▲            │   ▲                          │
 *     └─ changes-requested ◀┘            archived ◀┘
 *
 * Hard rules (Task 19):
 *  - a package can never reach `published` with critical blockers, corrupt
 *    artifacts, critical traceability gaps or a failed export gate;
 *  - a package that requires approval can never be published unapproved;
 *  - overrides are allowed ONLY when there are no critical blockers, and every
 *    override is written to the audit trail.
 *
 * Every transition returns a NEW package — the input is never mutated.
 */

import { appendAuditEntry } from './PublicationAuditTrailService';
import { trackPublicationEvent } from './PublicationObservability';
import type {
  PublicationActor,
  PublicationManifest,
  PublicationPackage,
  PublicationPackageStatus,
  PublicationReadinessReport,
} from './PublicationPipelineTypes';

/** Outcome of an approval-workflow transition. */
export interface PublicationTransitionResult {
  /** True when the transition was applied. */
  ok: boolean;
  /** The package — updated when `ok`, unchanged otherwise. */
  package: PublicationPackage;
  /** User-facing reason when the transition was rejected. */
  reason?: string;
}

const fail = (pkg: PublicationPackage, reason: string): PublicationTransitionResult =>
  ({ ok: false, package: pkg, reason });

const statusLabel = (status: PublicationPackageStatus): string => status;

/* ------------------------------------------------------------------------- */
/* Submit for review                                                          */
/* ------------------------------------------------------------------------- */

/** Move a draft / changes-requested package into `ready-for-review`. */
export const submitForReview = (
  pkg: PublicationPackage,
  actor?: PublicationActor,
  comment?: string,
): PublicationTransitionResult => {
  if (pkg.status !== 'draft' && pkg.status !== 'changes-requested' && pkg.status !== 'blocked') {
    return fail(pkg, `Solo se puede enviar a revisión un paquete en borrador (estado actual: ${statusLabel(pkg.status)}).`);
  }
  if (pkg.artifactRefs.length === 0) {
    return fail(pkg, 'No se puede enviar a revisión un paquete sin artefactos.');
  }
  const next = appendAuditEntry(
    { ...pkg, status: 'ready-for-review', updatedAt: new Date().toISOString() },
    {
      action: 'submitted-for-review',
      details: comment?.trim() ? `Enviado a revisión: ${comment.trim()}` : 'Paquete enviado a revisión.',
      ...(actor ? { actor } : {}),
      before: pkg.status,
      after: 'ready-for-review',
    },
  );
  trackPublicationEvent('publication.approval.changed', 'Paquete enviado a revisión.', {
    packageId: pkg.id, status: 'ready-for-review',
  });
  return { ok: true, package: next };
};

/* ------------------------------------------------------------------------- */
/* Request changes                                                            */
/* ------------------------------------------------------------------------- */

/** Reject a package for review and request changes (reason is mandatory). */
export const requestChanges = (
  pkg: PublicationPackage,
  reason: string,
  actor?: PublicationActor,
): PublicationTransitionResult => {
  if (pkg.status !== 'ready-for-review') {
    return fail(pkg, 'Solo se pueden solicitar cambios sobre un paquete en revisión.');
  }
  if (!reason.trim()) {
    return fail(pkg, 'Debes indicar el motivo de los cambios solicitados.');
  }
  const next = appendAuditEntry(
    { ...pkg, status: 'changes-requested', updatedAt: new Date().toISOString() },
    {
      action: 'changes-requested',
      details: `Cambios solicitados: ${reason.trim()}`,
      ...(actor ? { actor } : {}),
      before: pkg.status,
      after: 'changes-requested',
    },
  );
  trackPublicationEvent('publication.approval.changed', 'Se solicitaron cambios en el paquete.', {
    packageId: pkg.id, status: 'changes-requested',
  });
  return { ok: true, package: next };
};

/* ------------------------------------------------------------------------- */
/* Approve                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Approve a package. Rejected when the readiness report is blocked (critical
 * blockers must be resolved before an approval can be recorded).
 */
export const approvePackage = (
  pkg: PublicationPackage,
  readiness: PublicationReadinessReport,
  actor?: PublicationActor,
  comment?: string,
): PublicationTransitionResult => {
  if (pkg.status !== 'ready-for-review') {
    return fail(pkg, 'Solo se puede aprobar un paquete que esté en revisión.');
  }
  if (readiness.status === 'blocked' || readiness.blockers.length > 0) {
    return fail(pkg, 'No se puede aprobar: el paquete tiene bloqueadores críticos sin resolver.');
  }
  const now = new Date().toISOString();
  const next = appendAuditEntry(
    {
      ...pkg,
      status: 'approved',
      approvedBy: actor,
      approvedAt: now,
      updatedAt: now,
    },
    {
      action: 'approved',
      details: comment?.trim() ? `Paquete aprobado: ${comment.trim()}` : 'Paquete aprobado.',
      ...(actor ? { actor } : {}),
      before: pkg.status,
      after: 'approved',
    },
  );
  trackPublicationEvent('publication.package.approved', `Paquete "${pkg.name}" aprobado.`, {
    packageId: pkg.id,
  });
  return { ok: true, package: next };
};

/* ------------------------------------------------------------------------- */
/* Publish                                                                    */
/* ------------------------------------------------------------------------- */

export interface PublishOptions {
  actor?: PublicationActor;
  /** Whether the profile mandates a formal approval before publication. */
  approvalRequired: boolean;
  /** Set when the user explicitly accepts non-critical warnings. */
  override?: boolean;
  overrideReason?: string;
  /** The manifest frozen onto the package on a successful publication. */
  manifest?: PublicationManifest;
}

/**
 * Publish a package. Enforces the Task 19 hard rules. When the readiness report
 * carries non-critical warnings the caller must pass `override: true` (which is
 * audited). Critical blockers can never be overridden.
 */
export const publishPackage = (
  pkg: PublicationPackage,
  readiness: PublicationReadinessReport,
  options: PublishOptions,
): PublicationTransitionResult => {
  if (pkg.status === 'archived') {
    return fail(pkg, 'No se puede publicar un paquete archivado.');
  }
  if (readiness.status === 'blocked' || readiness.blockers.length > 0 || !readiness.canPublish) {
    return fail(pkg, 'No se puede publicar: el paquete tiene bloqueadores críticos. Resuélvelos antes de publicar.');
  }
  if (options.approvalRequired && pkg.status !== 'approved') {
    return fail(pkg, 'Este perfil requiere aprobación formal antes de publicar el paquete.');
  }
  const hasWarnings = readiness.status === 'warning' || readiness.warnings.length > 0;
  if (hasWarnings && !options.override) {
    return fail(pkg, 'El paquete tiene advertencias. Confirma la publicación con override para continuar.');
  }

  const now = new Date().toISOString();
  let next: PublicationPackage = {
    ...pkg,
    status: 'published',
    publishedAt: now,
    updatedAt: now,
    freshness: 'current',
    ...(options.manifest ? { manifest: options.manifest } : {}),
  };

  if (hasWarnings && options.override) {
    next = appendAuditEntry(next, {
      action: 'override-used',
      details: options.overrideReason?.trim()
        ? `Override de publicación: ${options.overrideReason.trim()}`
        : 'Se publicó el paquete aceptando advertencias no críticas.',
      ...(options.actor ? { actor: options.actor } : {}),
    });
    trackPublicationEvent('publication.override.used',
      'Se usó override para publicar un paquete con advertencias.', { packageId: pkg.id });
  }

  next = appendAuditEntry(next, {
    action: 'published',
    details: `Paquete publicado (versión ${pkg.version}).`,
    ...(options.actor ? { actor: options.actor } : {}),
    before: pkg.status,
    after: 'published',
  });

  trackPublicationEvent('publication.package.published', `Paquete "${pkg.name}" publicado.`, {
    packageId: pkg.id, version: pkg.version,
  });
  return { ok: true, package: next };
};

/* ------------------------------------------------------------------------- */
/* Archive                                                                    */
/* ------------------------------------------------------------------------- */

/** Archive a package. Allowed from any non-archived state. */
export const archivePackage = (
  pkg: PublicationPackage,
  actor?: PublicationActor,
  reason?: string,
): PublicationTransitionResult => {
  if (pkg.status === 'archived') {
    return fail(pkg, 'El paquete ya está archivado.');
  }
  const next = appendAuditEntry(
    { ...pkg, status: 'archived', updatedAt: new Date().toISOString() },
    {
      action: 'archived',
      details: reason?.trim() ? `Paquete archivado: ${reason.trim()}` : 'Paquete archivado.',
      ...(actor ? { actor } : {}),
      before: pkg.status,
      after: 'archived',
    },
  );
  trackPublicationEvent('publication.package.archived', `Paquete "${pkg.name}" archivado.`, {
    packageId: pkg.id,
  });
  return { ok: true, package: next };
};

/** Reopen an archived or published package back into `draft` for new work. */
export const reopenPackage = (
  pkg: PublicationPackage,
  actor?: PublicationActor,
): PublicationTransitionResult => {
  if (pkg.status !== 'archived' && pkg.status !== 'published') {
    return fail(pkg, 'Solo se puede reabrir un paquete archivado o publicado.');
  }
  const next = appendAuditEntry(
    { ...pkg, status: 'draft', updatedAt: new Date().toISOString() },
    {
      action: 'package-updated',
      details: 'Paquete reabierto como borrador.',
      ...(actor ? { actor } : {}),
      before: pkg.status,
      after: 'draft',
    },
  );
  return { ok: true, package: next };
};
