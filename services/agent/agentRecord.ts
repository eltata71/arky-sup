/**
 * Build the durable, append-only `AgentActionRecord` from the in-memory
 * plan + result tuple. Designed to be cheap and deterministic so the
 * AssistantPanel can call it on every executor completion without
 * thinking about persistence semantics.
 */

import type { AgentActionPlan, AgentActionRecord, AgentActionResult, MemoryScope } from './agentTypes';

export interface BuildAgentActionRecordInput {
  plan: AgentActionPlan;
  result: AgentActionResult;
  projectId: string;
  actorId?: string | null;
  actorName?: string | null;
  /** Memory scope persisted (for `memory.save.*` actions). */
  memoryScope?: MemoryScope | null;
  /** Bullets actually persisted (for `memory.save.*` actions). */
  memoryBullets?: string[] | null;
}

export function buildAgentActionRecord({
  plan,
  result,
  projectId,
  actorId,
  actorName,
  memoryScope,
  memoryBullets,
}: BuildAgentActionRecordInput): AgentActionRecord {
  return {
    traceId: plan.traceId,
    actionId: plan.actionId,
    projectId,
    artifactVersionGroupId: plan.intent.artifactVersionGroupId ?? '',
    previousArtifactVersionId: result.previousArtifactVersionId,
    newArtifactVersionId: result.newArtifactVersionId,
    actionType: plan.actionType,
    // `requires_selection` is a transient UI state — when an action never
    // gets to execute we persist it as `cancelled` so the audit trail only
    // carries terminal outcomes.
    status: result.status === 'requires_selection' ? 'cancelled' : result.status,
    target: plan.target,
    userInstruction: plan.intent.userInstruction,
    appliedChanges: result.appliedChanges,
    validationSummary: result.validationResult?.summary ?? null,
    validationScore: result.validationResult?.score ?? null,
    errors: result.errors,
    affectedArtifactIds: plan.batchArtifactIds,
    memoryScope: memoryScope ?? plan.intent.memoryScope ?? undefined,
    memoryBullets: memoryBullets ?? undefined,
    actorId: actorId ?? 'local-user',
    actorName: actorName ?? 'Arquitecto',
    createdAt: plan.createdAt,
    completedAt: new Date().toISOString(),
  };
}
