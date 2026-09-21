import type { Project } from '../../types';
import type { AgentActionResult, AgentExecutionPhase } from './agentTypes';

/** Reuses the artifact created by the same Office task execution, if any. */
export const reuseDeterministicArtifact = (
  project: Project,
  deterministicId: string | null | undefined,
  traceId: string,
  base: AgentActionResult,
  emit: (phase: AgentExecutionPhase, message: string) => void,
): AgentActionResult | null => {
  if (!deterministicId) return null;
  const existing = project.artifacts.find((artifact) => artifact.id === deterministicId);
  if (!existing) return null;

  emit('done', `Artefacto "${existing.name}" ya existía para esta ejecución; no se duplicó.`);
  return {
    ...base,
    status: 'success',
    newArtifactId: existing.id,
    newArtifactVersionId: null,
    appliedChanges: [`Artefacto ya existente devuelto sin regenerar: "${existing.name}"`],
    messages: [`El artefacto "${existing.name}" ya existía para esta ejecución; se reutilizó.`],
    errors: [],
    traceId,
  };
};
