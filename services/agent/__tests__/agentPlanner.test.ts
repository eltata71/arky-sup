import { describe, it, expect } from 'vitest';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Artifact, Project } from '../../../types';

const FAKE_ARTIFACT: Artifact = {
  id: 'art-1',
  versionGroupId: 'grp-1',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Diagrama de Contexto',
  type: 'mermaid-c4-context',
  phase: 'Análisis',
  architecturalView: 'Vista de Contexto y Negocio',
  content: 'graph TD\n  A --> B',
  objective: 'Test',
  keyConcepts: [],
  representation: 'diagram',
};

const baseIntent = (overrides: Partial<AgentIntent> = {}): AgentIntent => ({
  type: 'artifact.improve',
  confidence: 0.8,
  userInstruction: 'mejora este artefacto',
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: 'diagram',
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'medium',
  suggestedTarget: 'new_version',
  ...overrides,
});

describe('planAgentAction', () => {
  it('produces a pending plan with a unique trace id', () => {
    const plan = planAgentAction({ intent: baseIntent(), artifact: FAKE_ARTIFACT });
    expect(plan.status).toBe('pending');
    expect(plan.traceId).toMatch(/^agent-/);
    expect(plan.actionId).toMatch(/^act-/);
  });

  it('populates a user-facing title and summary for each action type', () => {
    const types = [
      'artifact.regenerate',
      'artifact.improve',
      'artifact.patch',
      'artifact.createVersion',
      'artifact.applySuggestion',
    ] as const;
    for (const type of types) {
      const plan = planAgentAction({ intent: baseIntent({ type }), artifact: FAKE_ARTIFACT });
      expect(plan.title.length).toBeGreaterThan(0);
      expect(plan.summary).toContain(FAKE_ARTIFACT.name);
    }
  });

  it('flags high-impact intents for confirmation', () => {
    const plan = planAgentAction({
      intent: baseIntent({ type: 'artifact.regenerate', impact: 'high', requiresConfirmation: true }),
      artifact: FAKE_ARTIFACT,
    });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.risks.length).toBeGreaterThan(0);
  });

  it('defaults to new_version when the intent suggests it', () => {
    const plan = planAgentAction({ intent: baseIntent({ suggestedTarget: 'new_version' }), artifact: FAKE_ARTIFACT });
    expect(plan.target).toBe('new_version');
  });

  it('respects an explicit current target', () => {
    const plan = planAgentAction({ intent: baseIntent({ suggestedTarget: 'current' }), artifact: FAKE_ARTIFACT });
    expect(plan.target).toBe('current');
  });

  describe('batch scope resolution', () => {
    const projectFixture = (): Project => ({
      id: 'proj-1',
      name: 'Test',
      description: '',
      projectContext: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      artifacts: [
        { ...FAKE_ARTIFACT, id: 'art-c4-1', versionGroupId: 'g1', type: 'mermaid-c4-context' },
        { ...FAKE_ARTIFACT, id: 'art-c4-2', versionGroupId: 'g2', type: 'mermaid-c4-container' },
        { ...FAKE_ARTIFACT, id: 'art-md-1', versionGroupId: 'g3', type: 'markdown' },
      ],
    });

    it('resolves a "type" matcher to the matching latest-version ids', () => {
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'type', type: 'mermaid-c4-' } },
      });
      const plan = planAgentAction({ intent, artifact: FAKE_ARTIFACT, project: projectFixture() });
      expect(plan.batchArtifactIds).toBeDefined();
      expect(plan.batchArtifactIds!.length).toBeGreaterThanOrEqual(2);
      expect(plan.batchArtifactIds).toEqual(expect.arrayContaining(['art-c4-1', 'art-c4-2']));
    });

    it('falls back to the anchor artifact when project context is missing', () => {
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'all' } },
      });
      const plan = planAgentAction({ intent, artifact: FAKE_ARTIFACT });
      expect(plan.batchArtifactIds).toBeUndefined();
    });

    it('always includes the anchor artifact in the resolved batch', () => {
      const project = projectFixture();
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'type', type: 'markdown' } },
      });
      const plan = planAgentAction({ intent, artifact: FAKE_ARTIFACT, project });
      expect(plan.batchArtifactIds).toContain(FAKE_ARTIFACT.id);
    });

    it('resolves "all" to every distinct version group', () => {
      const project = projectFixture();
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'all' } },
      });
      const plan = planAgentAction({ intent, artifact: project.artifacts[0], project });
      expect(plan.batchArtifactIds!.length).toBe(3);
    });
  });
});
