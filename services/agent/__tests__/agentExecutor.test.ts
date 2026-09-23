import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAgentAction } from '../agentExecutor';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';

// ── Mocks ───────────────────────────────────────────────────────────────────
// The executor reuses `geminiService` — we mock its surface so the tests stay
// fast and offline. The contract we exercise:
//   - applyArtifactImprovements   → improve / applySuggestion paths
//   - runAgentTurn (AI boundary)  → patch path (function-calling), composed
//                                   by `agentConversation` since F5-01 corte 8
//   - generateArtifactContent     → regenerate path
const applyArtifactImprovements = vi.fn(async (..._args: unknown[]) => 'graph TD\n  A --> B\n  B --> C');
const runAgentTurn = vi.fn(async (..._args: unknown[]) => ({
  text: '',
  functionCall: { name: 'modifyArtifact', args: { newContent: 'graph TD\n  A --> B\n  B --> C', target: 'new_version' } },
}));
const generateArtifactContent = vi.fn(async (..._args: unknown[]) => 'graph TD\n  A --> B\n  B --> C');

vi.mock('../../geminiService', () => {
  class AIServiceError extends Error {
    category = 'unknown';
    status = 0;
    retryable = false;
    userMessage = 'Test error';
    constructor(message: string) {
      super(message);
    }
  }
  return {
    geminiService: {
      applyArtifactImprovements: (...args: [unknown, unknown, unknown, unknown]) => applyArtifactImprovements(...args),
      generateArtifactContent: (...args: [unknown, unknown, unknown, unknown?]) => generateArtifactContent(...args),
    },
    AIServiceError,
    classifyAIError: (err: unknown) => {
      const e = new AIServiceError(err instanceof Error ? err.message : String(err));
      return e;
    },
  };
});

vi.mock('../../ai/generation/assistant/agentTurn', () => ({
  runAgentTurn: (...args: unknown[]) => runAgentTurn(...args),
  streamAgentTurn: vi.fn(),
}));

// The quality gate runs only on diagrams with an IR — our fixture has none,
// so we exercise the structural validation path. That's fine: it's the path
// that runs in production for every non-IR artifact (documents, markdown).

const ARTIFACT: Artifact = {
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

const PROJECT: Project = {
  id: 'proj-1',
  name: 'Test',
  description: 'Test project',
  projectContext: [],
  artifacts: [ARTIFACT],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SETTINGS: Settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'professional', languageStyle: 'concise', apiKeySource: 'global' },
};

const baseIntent = (overrides: Partial<AgentIntent> = {}): AgentIntent => ({
  type: 'artifact.improve',
  confidence: 0.85,
  userInstruction: 'mejora con base en lo que conversamos',
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: 'diagram',
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'medium',
  suggestedTarget: 'new_version',
  ...overrides,
});

describe('executeAgentAction', () => {
  type CreateVersionFn = (projectId: string, versionGroupId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => Artifact;
  type UpdateArtifactFn = (projectId: string, artifactId: string, updates: Partial<Artifact>) => void;

  let createArtifactVersion: ReturnType<typeof vi.fn> & CreateVersionFn;
  let updateArtifact: ReturnType<typeof vi.fn> & UpdateArtifactFn;

  beforeEach(() => {
    createArtifactVersion = vi.fn((_projectId: string, versionGroupId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
      ...data,
      id: 'art-2',
      versionGroupId,
      version: 2,
      createdAt: new Date().toISOString(),
    })) as ReturnType<typeof vi.fn> & CreateVersionFn;
    updateArtifact = vi.fn() as ReturnType<typeof vi.fn> & UpdateArtifactFn;
    applyArtifactImprovements.mockClear();
    runAgentTurn.mockClear();
    generateArtifactContent.mockClear();
  });

  it('uses applyArtifactImprovements for the improve action and persists a new version', async () => {
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.improve' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
    });
    expect(applyArtifactImprovements).toHaveBeenCalledTimes(1);
    expect(createArtifactVersion).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.newArtifactVersionId).toBe('art-2');
  });

  it('uses the agent turn for the patch action and respects current-target override', async () => {
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.patch' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
      targetOverride: 'current',
    });
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(updateArtifact).toHaveBeenCalledWith(PROJECT.id, ARTIFACT.id, { content: expect.any(String) });
    expect(createArtifactVersion).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('speaks the patch in the persona its caller resolves from the instruction, offering the artifact tool', async () => {
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.patch' }), artifact: ARTIFACT });
    const resolvePersona = vi.fn((_message: string) => ({
      composeInstruction: (base: string) => `PERSONA-SOFIA\n${base}`,
      sections: ['ESTANDARES-OFICINA'],
    }));
    await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
      targetOverride: 'current',
      resolvePersona,
    });
    expect(resolvePersona).toHaveBeenCalledTimes(1);
    expect(resolvePersona.mock.calls[0][0]).toContain('Cambio solicitado:');
    const request = runAgentTurn.mock.calls[0][0] as { systemInstruction: string; offerArtifactTool: boolean };
    expect(request.systemInstruction).toContain('PERSONA-SOFIA');
    expect(request.systemInstruction).toContain('ESTANDARES-OFICINA');
    expect(request.offerArtifactTool).toBe(true);
  });

  it('uses generateArtifactContent for the regenerate action', async () => {
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.regenerate' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
    });
    expect(generateArtifactContent).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.newArtifactVersionId).toBe('art-2');
  });

  it('cancels gracefully when the AI returns unchanged content', async () => {
    applyArtifactImprovements.mockResolvedValueOnce(ARTIFACT.content);
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.improve' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
    });
    expect(result.status).toBe('cancelled');
    expect(createArtifactVersion).not.toHaveBeenCalled();
    expect(updateArtifact).not.toHaveBeenCalled();
  });

  it('returns failed and never mutates state when the AI throws', async () => {
    applyArtifactImprovements.mockRejectedValueOnce(new Error('overloaded'));
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.improve' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
    });
    expect(result.status).toBe('failed');
    expect(createArtifactVersion).not.toHaveBeenCalled();
    expect(updateArtifact).not.toHaveBeenCalled();
  });

  it('emits phase events through the onPhase listener in order', async () => {
    const phases: string[] = [];
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.improve' }), artifact: ARTIFACT });
    await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toContain('analyzing');
    expect(phases).toContain('generating');
    expect(phases).toContain('validating');
    expect(phases).toContain('persisting');
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('rejects empty AI output as failed', async () => {
    applyArtifactImprovements.mockResolvedValueOnce('   ');
    const plan = planAgentAction({ intent: baseIntent({ type: 'artifact.improve' }), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: { createArtifactVersion, updateArtifact },
    });
    expect(result.status).toBe('failed');
    expect(createArtifactVersion).not.toHaveBeenCalled();
  });

  describe('batch action', () => {
    const ART2: Artifact = { ...ARTIFACT, id: 'art-x', versionGroupId: 'grp-x', name: 'Diagrama 2' };
    const BATCH_PROJECT: Project = {
      ...PROJECT,
      artifacts: [ARTIFACT, ART2],
    };

    it('iterates over batchArtifactIds, succeeding all when AI returns valid content', async () => {
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'all' } },
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT, project: BATCH_PROJECT });
      expect(plan.batchArtifactIds?.length).toBe(2);

      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: BATCH_PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifactVersion, updateArtifact },
      });
      expect(result.status).toBe('success');
      expect(applyArtifactImprovements).toHaveBeenCalledTimes(2);
      expect(createArtifactVersion).toHaveBeenCalledTimes(2);
    });

    it('returns "partial" when some artifacts succeed and others fail', async () => {
      applyArtifactImprovements
        .mockResolvedValueOnce('graph TD\n  A --> B\n  B --> C')
        .mockRejectedValueOnce(new Error('overloaded'));
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'all' } },
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT, project: BATCH_PROJECT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: BATCH_PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifactVersion, updateArtifact },
      });
      expect(result.status).toBe('partial');
      expect(result.errors.length).toBe(1);
    });

    it('returns "failed" when every artifact in the batch fails', async () => {
      applyArtifactImprovements.mockRejectedValue(new Error('boom'));
      const intent = baseIntent({
        type: 'artifacts.batch',
        batchScope: { subAction: 'artifact.improve', matcher: { kind: 'all' } },
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT, project: BATCH_PROJECT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: BATCH_PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifactVersion, updateArtifact },
      });
      expect(result.status).toBe('failed');
      expect(createArtifactVersion).not.toHaveBeenCalled();
    });
  });

  describe('artifact.create action', () => {
    type CreateArtifactFn = (projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => Artifact;
    let createArtifact: ReturnType<typeof vi.fn> & CreateArtifactFn;

    beforeEach(() => {
      createArtifact = vi.fn((projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
        ...data,
        id: 'art-new',
        versionGroupId: 'art-new',
        version: 1,
        createdAt: new Date().toISOString(),
      })) as ReturnType<typeof vi.fn> & CreateArtifactFn;
    });

    it('creates a brand-new artifact via store.createArtifact (not createArtifactVersion)', async () => {
      const intent = baseIntent({
        type: 'artifact.create',
        impact: 'high',
        userInstruction: 'Crea un diagrama de contexto C4 para el sistema',
        createHint: { templateName: 'Diagrama de Contexto (C4-N1)' },
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifact, createArtifactVersion, updateArtifact },
      });
      expect(generateArtifactContent).toHaveBeenCalledTimes(1);
      expect(createArtifact).toHaveBeenCalledTimes(1);
      expect(createArtifactVersion).not.toHaveBeenCalled();
      expect(result.status).toBe('success');
      expect(result.newArtifactId).toBe('art-new');
      expect(result.newArtifactVersionId).toBeNull();
    });

    it('falls back to a custom template when no catalog match is found', async () => {
      const intent = baseIntent({
        type: 'artifact.create',
        impact: 'high',
        userInstruction: 'Crea un brief de adopción de IA para el equipo de soporte',
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifact, createArtifactVersion, updateArtifact },
      });
      expect(createArtifact).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('success');
    });

    it('returns a clear failure when the store does not expose createArtifact', async () => {
      const intent = baseIntent({
        type: 'artifact.create',
        impact: 'high',
        userInstruction: 'Crea un diagrama de contexto',
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifactVersion, updateArtifact }, // no createArtifact
      });
      expect(result.status).toBe('failed');
      expect(generateArtifactContent).not.toHaveBeenCalled();
      expect(result.errors[0]).toContain('createArtifact');
    });

    it('propagates Gemini errors as failed without persisting anything', async () => {
      generateArtifactContent.mockRejectedValueOnce(new Error('quota exceeded'));
      const intent = baseIntent({
        type: 'artifact.create',
        impact: 'high',
        userInstruction: 'Crea un diagrama de contexto',
      });
      const plan = planAgentAction({ intent, artifact: ARTIFACT });
      const result = await executeAgentAction({
        confirmedByUser: true,
        plan,
        artifact: ARTIFACT,
        project: PROJECT,
        settings: SETTINGS,
        history: [],
        store: { createArtifact, createArtifactVersion, updateArtifact },
      });
      expect(result.status).toBe('failed');
      expect(createArtifact).not.toHaveBeenCalled();
    });
  });
});
