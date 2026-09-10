/**
 * The human gate: a high-impact action does not run until someone approves it.
 *
 * `AgentActionPlan.requiresConfirmation` was computed by the intent classifier,
 * by its LLM variant and by the planner — and **read by nothing**. A plan
 * marked `true` and one marked `false` reached the executor through the
 * identical path; the only thing that made high-impact actions wait was that
 * one UI hook happened to park the plan in `pendingPlan` before running it. The
 * flag described an intention nobody enforced, which is the same class of
 * defect as a capability declared with no implementation behind it.
 *
 * The rule lives in its own file rather than inside `agentExecutor` because it
 * is a policy, not a step of execution: it is the answer to "may this run at
 * all", asked before anything is generated or written, and it should be
 * readable — and testable — without loading the executor.
 */

import type { AgentActionPlan, AgentActionResult } from './agentTypes';
import { logAgentEvent } from './agentLogger';

/** What the user sees when the agent refuses for want of approval. */
export const UNCONFIRMED_ACTION_MESSAGE =
  'Esta acción necesita tu confirmación antes de ejecutarse.';

/**
 * True when the plan may not run yet.
 *
 * `confirmedByUser` is deliberately checked against `true` rather than for
 * truthiness: a caller that forgets the flag is refused, which is the safe
 * direction for a gate whose whole purpose is to stop an unattended write.
 */
export const needsHumanApproval = (
  plan: Pick<AgentActionPlan, 'requiresConfirmation'>,
  confirmedByUser: boolean | undefined,
): boolean => plan.requiresConfirmation === true && confirmedByUser !== true;

/**
 * The refusal itself, or `null` when the action may proceed.
 *
 * Returned rather than thrown: `executeAgentAction` never throws, and a
 * refusal the UI can render beats an exception it has to catch. The status is
 * `cancelled`, not `failed` — nothing went wrong, the action was simply not
 * authorised to run yet, and telling a user their diagram *failed* when it was
 * merely waiting for them is a different and worse message.
 */
export const refuseUnconfirmedAction = (
  plan: AgentActionPlan,
  confirmedByUser: boolean | undefined,
  baseResult: AgentActionResult,
): AgentActionResult | null => {
  if (!needsHumanApproval(plan, confirmedByUser)) return null;
  logAgentEvent({
    traceId: plan.traceId,
    phase: 'cancelled',
    level: 'warn',
    message: 'Acción de alto impacto ejecutada sin confirmación del usuario.',
    meta: { actionType: plan.actionType, impact: plan.intent.impact },
  });
  return { ...baseResult, status: 'cancelled', messages: [UNCONFIRMED_ACTION_MESSAGE] };
};
