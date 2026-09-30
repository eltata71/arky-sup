/**
 * The decisions a person just stated, offered as project memory (plan de
 * calidad de artefactos, 7.3b).
 *
 * The chat already extracts decisions for every prompt (`extractConversationDecisions`);
 * this turns the ones not yet in the project's memory into a `memory.save.project`
 * plan whose draft is already filled — no model call, since the wording is
 * the person's own. The card the chat already shows for memory actions does
 * the rest, and nothing is written until the person confirms it: a field the
 * assistant filled by itself is indistinguishable from one somebody filled
 * in badly.
 */
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import { extractConversationDecisions } from '../chat';
import { planAgentAction } from './agentPlanner';
import type { AgentActionPlan, AgentIntent, MemoryDraft } from './agentTypes';

const normalize = (text: string): string => text.toLowerCase().replace(/[.!\s]+$/, '').trim();

/** The plan and its draft, or `null` when every decision is already remembered. */
export function offerDecisionsAsMemory(
  userText: string,
  project: Project | undefined,
): { plan: AgentActionPlan; draft: MemoryDraft } | null {
  const known = [...(project?.projectContext ?? []), ...(project?.agentMemory ?? [])].map(normalize);
  const decisions = extractConversationDecisions([{ role: 'user', content: userText }]).decisions
    .filter((decision) => !known.some((note) => note.includes(normalize(decision))));
  if (decisions.length === 0) return null;
  const intent: AgentIntent = {
    type: 'memory.save.project',
    confidence: 1,
    userInstruction: 'Guardar en la memoria del proyecto las decisiones acordadas en la conversación',
    artifactId: null,
    artifactVersionGroupId: null,
    artifactViewContext: null,
    extractedRequirements: [...decisions],
    requiresConfirmation: true,
    impact: 'low',
    suggestedTarget: 'current',
    memoryScope: 'project',
  };
  return {
    plan: planAgentAction({ intent, artifact: createMemoryAnchorArtifact(), project }),
    draft: { scope: 'project', bullets: [...decisions], status: 'ready' },
  };
}

/**
 * Synthetic anchor artifact used to satisfy the planner signature on
 * memory-save actions when no artifact is active. The planner only reads
 * `id`, `versionGroupId` and `name` from the anchor — nothing is persisted
 * with this stub, and the executor's memory branch never calls
 * `createArtifactVersion`/`updateArtifact` on it.
 */
export function createMemoryAnchorArtifact(): Artifact {
  const now = new Date().toISOString();
  return {
    id: 'memory-anchor',
    versionGroupId: 'memory-anchor',
    version: 1,
    createdAt: now,
    name: 'Conversación actual',
    type: 'markdown',
    phase: '—',
    architecturalView: 'Vista de Gestión y Soporte',
    content: '',
    objective: 'Anclaje sintético para acciones de memoria sin artefacto activo.',
    keyConcepts: [],
    representation: 'document',
  };
}
