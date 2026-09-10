/**
 * Architecture Review Board — the human checkpoint of the Office.
 *
 * Modelled on `PublicationApprovalService`, which is the one place in this
 * codebase with a *real* guarded state machine. The artifact review flow in
 * `services/review/` deliberately has none (any status can go to any status),
 * so it is not the pattern to copy here: an engagement that can be marked
 * `delivered` from any state is not governance, it is a label.
 *
 * Rules enforced here:
 *  - transitions are legal or the call is rejected — never silently coerced;
 *  - a blocking quality gate cannot be approved away;
 *  - `changes-requested` and `rejected` require a written rationale;
 *  - decisions are immutable and always carry the gate verdict they rested on;
 *  - the input engagement is never mutated.
 *
 * Client-side checks are not the security boundary. `firestore.rules` also
 * requires an admin claim for the `delivered` transition and for writing an
 * ARB decision, so a crafted write cannot self-approve.
 */

import {
  withAuditEntry,
  newArbDecisionId,
} from './OfficeEngagementRepository';
import { can } from '../../lib/authz';
import type {
  OfficeActor,
  OfficeArbDecision,
  OfficeArbVerdict,
  OfficeEngagement,
  OfficeEngagementStatus,
} from './OfficeTypes';
import { summarizeEngagementProgress } from './OfficeTypes';
import { transitionEngagement } from './officeEngagementTransitions';

export interface OfficeTransitionResult {
  ok: boolean;
  /** Updated engagement when `ok`; the unchanged input otherwise. */
  engagement: OfficeEngagement;
  /** User-facing Spanish reason when the transition was refused. */
  reason?: string;
  /** The decision that was recorded, when one was. */
  decision?: OfficeArbDecision;
}

const fail = (engagement: OfficeEngagement, reason: string): OfficeTransitionResult =>
  ({ ok: false, engagement, reason });

/**
 * Who may sit on the review board.
 *
 * Asked as a permission, not as a role list. The previous set named `admin` and
 * `superadmin`, which excluded the one role whose whole purpose is governance:
 * a `reviewer` decides at the ARB, and an administrator does so because the
 * matrix also grants it, not because the board is an administrative function.
 * `firestore.rules` grants `arb:decide` from the same table.
 */
export const canActAsArb = (actor: OfficeActor | null | undefined): boolean =>
  can(actor, 'arb:decide');

// ---------------------------------------------------------------------------
// Charter approval
// ---------------------------------------------------------------------------

const CHARTER_APPROVABLE_FROM: readonly OfficeEngagementStatus[] = ['awaiting-charter', 'planning'];

/**
 * Approves the proposed charter and releases the engagement to the runner.
 *
 * Charter approval is deliberately *not* admin-gated: it is the project owner
 * saying "yes, this is the work". The board gate is at delivery.
 */
export const approveCharter = (
  engagement: OfficeEngagement,
  actor: OfficeActor,
): OfficeTransitionResult => {
  if (!CHARTER_APPROVABLE_FROM.includes(engagement.status)) {
    return fail(engagement, `No se puede aprobar el charter desde el estado "${engagement.status}".`);
  }
  if (engagement.charter.deliverables.length === 0) {
    return fail(engagement, 'El charter no propone entregables; no hay nada que aprobar.');
  }

  // La firma del charter y el paso a ejecución son el mismo hecho, así que se
  // escriben en una sola operación: `transitionEngagement` no deja que el
  // cambio de estado ocurra sin su entrada de auditoría.
  const signed: OfficeEngagement = {
    ...engagement,
    charter: {
      ...engagement.charter,
      approvedAt: new Date().toISOString(),
      approvedBy: actor,
    },
  };

  return {
    ok: true,
    engagement: transitionEngagement(
      signed,
      'in-progress',
      'charter-approved',
      `${actor.name} aprobó el charter con ${engagement.charter.deliverables.length} entregable(s).`,
      { actor, before: engagement.status },
    ),
  };
};

// ---------------------------------------------------------------------------
// Board decision
// ---------------------------------------------------------------------------

export interface ArbDecisionInput {
  verdict: OfficeArbVerdict;
  rationale: string;
  actor: OfficeActor;
}

const DECIDABLE_FROM: readonly OfficeEngagementStatus[] = ['awaiting-arb', 'blocked'];

/**
 * Records the board's decision on a finished engagement.
 *
 * Approval is refused while the quality gates report `blocked`: a critical
 * gate is evidence the work is not deliverable, and the board's job is to act
 * on it, not to wave it through. A `conditional` assessment is approvable —
 * that is exactly the judgement call the board exists to make — but the
 * decision records the gate verdict it rested on either way.
 */
export const decideEngagement = (
  engagement: OfficeEngagement,
  input: ArbDecisionInput,
): OfficeTransitionResult => {
  if (!DECIDABLE_FROM.includes(engagement.status)) {
    return fail(engagement, `El encargo no está en revisión del comité (estado actual: "${engagement.status}").`);
  }
  if (!canActAsArb(input.actor)) {
    return fail(engagement, 'Solo un administrador puede emitir una decisión del comité de arquitectura.');
  }

  const rationale = input.rationale.trim();
  if (input.verdict !== 'approved' && rationale.length === 0) {
    return fail(engagement, 'Pedir cambios o rechazar requiere un motivo escrito.');
  }

  const gateStatus = engagement.gateAssessment?.overallStatus ?? 'conditional';

  if (input.verdict === 'approved') {
    if (gateStatus === 'blocked') {
      const blockers = (engagement.gateAssessment?.gates ?? [])
        .filter((current) => current.status === 'blocked')
        .flatMap((current) => current.blockers);
      return fail(
        engagement,
        `No se puede aprobar: hay quality gates bloqueados. ${blockers.join(' ')}`.trim(),
      );
    }
    const progress = summarizeEngagementProgress(engagement.tasks);
    if (progress.failed > 0 && rationale.length === 0) {
      return fail(
        engagement,
        `Hay ${progress.failed} entregable(s) fallidos; aprobar requiere justificar por qué el encargo es entregable así.`,
      );
    }
  }

  const decision: OfficeArbDecision = {
    id: newArbDecisionId(),
    engagementId: engagement.id,
    verdict: input.verdict,
    rationale,
    actor: input.actor,
    gateStatusAtDecision: gateStatus,
    previousStatus: engagement.status,
    decidedAt: new Date().toISOString(),
  };

  const nextStatus: OfficeEngagementStatus = input.verdict === 'approved'
    ? 'delivered'
    : input.verdict === 'changes-requested'
      ? 'in-progress'
      : 'cancelled';

  const decided: OfficeEngagement = {
    ...engagement,
    // Mirror for fast reads. The authoritative copy is the immutable
    // `arbDecisions` subcollection written by the repository.
    arbDecisions: [...engagement.arbDecisions, decision],
  };

  const verdictLabel = input.verdict === 'approved'
    ? 'aprobó'
    : input.verdict === 'changes-requested'
      ? 'pidió cambios en'
      : 'rechazó';

  let audited = transitionEngagement(
    decided,
    nextStatus,
    'arb-decided',
    `${input.actor.name} ${verdictLabel} el encargo (gates: ${gateStatus}).${rationale ? ` Motivo: ${rationale}` : ''}`,
    { actor: input.actor, before: engagement.status },
  );

  if (input.verdict === 'approved') {
    audited = withAuditEntry(audited, 'engagement-delivered', 'El encargo quedó entregado.', { actor: input.actor });
  } else if (input.verdict === 'rejected') {
    audited = withAuditEntry(audited, 'engagement-cancelled', 'El encargo fue rechazado por el comité.', { actor: input.actor });
  }

  return { ok: true, engagement: audited, decision };
};

/**
 * Records the gate assessment on the engagement and moves it to the board when
 * the run is finished. Pure — the caller persists.
 */
export const attachGateAssessment = (
  engagement: OfficeEngagement,
  assessment: NonNullable<OfficeEngagement['gateAssessment']>,
): OfficeEngagement => withAuditEntry(
  { ...engagement, gateAssessment: assessment },
  'gates-evaluated',
  `Quality gates evaluados: ${assessment.overallStatus}.`,
);
