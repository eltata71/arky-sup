/**
 * The human gate, enforced where it can be.
 *
 * `AgentActionPlan.requiresConfirmation` was computed by the intent classifier,
 * by its LLM variant and by the planner — and read by nothing. A plan marked
 * `true` and one marked `false` reached the executor through the identical
 * path; the only thing that made high-impact actions wait was a UI hook that
 * happened to park the plan before running it. The flag described an intention
 * nobody enforced, which is the same class of defect as a capability declared
 * with no implementation behind it.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { executeAgentAction } from '../agentExecutor';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';

vi.mock('../../ai', () => ({
  artifactGenerationService: {
    applyArtifactImprovements: vi.fn(async () => 'contenido mejorado'),
    generateArtifactContent: vi.fn(async () => 'contenido nuevo'),
  },
  assistantService: { processAssistantChat: vi.fn(async () => ({ text: 'ok' })) },
  classifyAIError: vi.fn(() => ({ category: 'unknown' })),
  AIServiceError: class extends Error {},
}));

const ARTIFACT = {
  id: 'art-1',
  versionGroupId: 'grp-1',
  name: 'Diagrama de contexto',
  type: 'mermaid-c4-context',
  objective: 'Contexto del sistema',
  content: 'graph TD; A-->B;',
  version: 1,
  isLatest: true,
} as unknown as Artifact;

const PROJECT = { id: 'proj-1', name: 'Núcleo', artifacts: [ARTIFACT] } as unknown as Project;
const SETTINGS = { aiConfig: {} } as unknown as Settings;

const intent = (over: Partial<AgentIntent> = {}): AgentIntent => ({
  type: 'artifact.improve',
  confidence: 0.9,
  userInstruction: 'Mejora el diagrama',
  artifactId: ARTIFACT.id,
  artifactVersionGroupId: ARTIFACT.versionGroupId,
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'high',
  suggestedTarget: 'new_version',
  ...over,
} as AgentIntent);

const store = () => ({
  createArtifactVersion: vi.fn(async () => ({ ...ARTIFACT, id: 'art-2', version: 2 })),
  updateArtifact: vi.fn(async () => undefined),
});

const run = (over: Record<string, unknown>) =>
  executeAgentAction({
    plan: planAgentAction({ intent: intent(), artifact: ARTIFACT, project: PROJECT }),
    artifact: ARTIFACT,
    project: PROJECT,
    settings: SETTINGS,
    history: [],
    store: store() as never,
    ...over,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeAgentAction · la confirmación humana', () => {
  it('refuses a high-impact action that nobody confirmed', async () => {
    const result = await run({});
    expect(result.status).toBe('cancelled');
    expect(result.messages.join(' ')).toMatch(/confirmaci/i);
  });

  it('writes nothing when it refuses', async () => {
    const persistence = store();
    const result = await run({ store: persistence as never });
    expect(result.status).toBe('cancelled');
    expect(persistence.createArtifactVersion).not.toHaveBeenCalled();
    expect(persistence.updateArtifact).not.toHaveBeenCalled();
    expect(result.newArtifactVersionId).toBeNull();
  });

  it('runs the same action once a human has approved it', async () => {
    const result = await run({ confirmedByUser: true });
    expect(result.status).not.toBe('cancelled');
  });

  /**
   * `false` is not "no opinion". A plan the planner did not flag runs without a
   * card, which is what makes the flag worth enforcing rather than demanding
   * approval for everything.
   */
  it('does not demand approval for a plan the planner never flagged', async () => {
    const low = planAgentAction({
      intent: intent({ requiresConfirmation: false, impact: 'low' }),
      artifact: ARTIFACT,
      project: PROJECT,
    });
    const result = await executeAgentAction({
      plan: { ...low, requiresConfirmation: false },
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: store() as never,
    } as never);
    expect(result.status).not.toBe('cancelled');
  });
});
