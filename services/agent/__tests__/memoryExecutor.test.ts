import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAgentAction, type AgentMemoryStore } from '../agentExecutor';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';

// We never call the real Gemini service from these tests — memory.save.*
// never enters the artifact-generation pipeline.
vi.mock('../../ai/generation/artifacts/artifactGenerationEngine', () => {
  class AIServiceError extends Error {
    category = 'unknown';
    status = 0;
    retryable = false;
    userMessage = 'Test error';
  }
  return {
    artifactGenerationEngine: {
      generateArtifactContent: vi.fn(),
    },
    AIServiceError,
    classifyAIError: (err: unknown) => {
      const e = new AIServiceError(err instanceof Error ? err.message : String(err));
      return e;
    },
  };
});

const ARTIFACT: Artifact = {
  id: 'art-1',
  versionGroupId: 'grp-1',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Diagrama Test',
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
  description: '',
  projectContext: ['Nota existente del proyecto'],
  artifacts: [ARTIFACT],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SETTINGS: Settings = {
  globalContext: ['Estándar existente'],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'professional', languageStyle: 'concise', apiKeySource: 'global' },
};

const intent = (type: AgentIntent['type']): AgentIntent => ({
  type,
  confidence: 0.9,
  userInstruction: 'guarda esto en memoria del proyecto',
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: 'diagram',
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'low',
  suggestedTarget: 'new_version',
  memoryScope: type === 'memory.save.global' ? 'global' : type === 'memory.save.artifact' ? 'artifact' : 'project',
});

describe('executeAgentAction — memory.save.*', () => {
  let memoryStore: AgentMemoryStore;
  let updateGlobalContext: ReturnType<typeof vi.fn>;
  let updateProjectContext: ReturnType<typeof vi.fn>;
  let updateArtifactMemory: ReturnType<typeof vi.fn>;
  let globalState: string[];
  let projectState: string[];
  let artifactState: string[];

  beforeEach(() => {
    globalState = ['Estándar existente'];
    projectState = ['Nota existente del proyecto'];
    artifactState = [];
    updateGlobalContext = vi.fn((next: string[]) => { globalState = next; }) as ReturnType<typeof vi.fn>;
    updateProjectContext = vi.fn((_pid: string, next: string[]) => { projectState = next; }) as ReturnType<typeof vi.fn>;
    updateArtifactMemory = vi.fn((_pid: string, _aid: string, next: string[]) => { artifactState = next; }) as ReturnType<typeof vi.fn>;
    memoryStore = {
      getGlobalContext: () => globalState,
      updateGlobalContext: (next: string[]) => (updateGlobalContext as unknown as (n: string[]) => void)(next),
      getProjectContext: (pid: string) => (pid === PROJECT.id ? projectState : []),
      updateProjectContext: (pid: string, next: string[]) => (updateProjectContext as unknown as (p: string, n: string[]) => void)(pid, next),
      getArtifactMemory: () => artifactState,
      updateArtifactMemory: (pid: string, aid: string, next: string[]) => (updateArtifactMemory as unknown as (p: string, a: string, n: string[]) => void)(pid, aid, next),
    };
  });

  const buildStore = () => ({
    createArtifactVersion: vi.fn(),
    updateArtifact: vi.fn(),
  });

  it('appends new bullets to global context without duplicates', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.global'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Estándar existente', 'Nuevo principio arquitectónico'],
    });
    expect(result.status).toBe('success');
    expect(updateGlobalContext).toHaveBeenCalledTimes(1);
    expect(globalState).toEqual(['Estándar existente', 'Nuevo principio arquitectónico']);
  });

  it('appends new bullets to project context', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Decisión: usar PostgreSQL 15', 'Restricción: latencia < 200ms'],
    });
    expect(result.status).toBe('success');
    expect(projectState).toHaveLength(3);
    expect(projectState).toContain('Decisión: usar PostgreSQL 15');
    expect(projectState).toContain('Restricción: latencia < 200ms');
  });

  it('appends new bullets to artifact memory', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.artifact'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Audiencia: ejecutivos C-level'],
    });
    expect(result.status).toBe('success');
    expect(artifactState).toEqual(['Audiencia: ejecutivos C-level']);
    expect(updateArtifactMemory).toHaveBeenCalledWith(PROJECT.id, ARTIFACT.id, ['Audiencia: ejecutivos C-level']);
  });

  it('returns cancelled (not failed) when all bullets are duplicates', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Nota existente del proyecto', 'NOTA EXISTENTE DEL PROYECTO'],
    });
    expect(result.status).toBe('cancelled');
    expect(updateProjectContext).not.toHaveBeenCalled();
  });

  it('falls back to literal instruction when no bullets are provided', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
    });
    expect(result.status).toBe('success');
    expect(projectState[projectState.length - 1]).toBe('guarda esto en memoria del proyecto');
  });

  it('stamps author + timestamp + prioridad media on notes when the store is entries-aware', async () => {
    let savedEntries: import('../../../types').MemoryEntry[] | undefined;
    const entriesAwareStore: AgentMemoryStore = {
      ...memoryStore,
      getProjectContextEntries: () => [],
      updateProjectContext: (pid, next, nextEntries) => {
        (updateProjectContext as unknown as (p: string, n: string[]) => void)(pid, next);
        savedEntries = nextEntries;
      },
    };
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore: entriesAwareStore,
      memoryBullets: ['Decisión: usar PostgreSQL 15'],
      actor: { id: 'user-1', name: 'Ana' },
    });
    expect(result.status).toBe('success');
    expect(savedEntries).toBeDefined();
    const saved = savedEntries!.find((entry) => entry.text === 'Decisión: usar PostgreSQL 15');
    expect(saved).toBeDefined();
    expect(saved!.authorId).toBe('user-1');
    expect(saved!.authorName).toBe('Ana');
    expect(saved!.priority).toBe('medium');
    expect(saved!.createdAt).toBeTruthy();
  });

  it('returns failed when memory store is missing', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryBullets: ['x'],
      // memoryStore intentionally undefined
    });
    expect(result.status).toBe('failed');
    expect(result.errors[0]).toContain('memoryStore');
  });

  it('does not create or modify an artifact version', async () => {
    const store = buildStore();
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store,
      memoryStore,
      memoryBullets: ['Algo nuevo'],
    });
    expect(result.status).toBe('success');
    expect(result.newArtifactVersionId).toBeNull();
    expect(store.createArtifactVersion).not.toHaveBeenCalled();
    expect(store.updateArtifact).not.toHaveBeenCalled();
  });

  it('emits the persisting phase event before completing', async () => {
    const phases: string[] = [];
    const plan = planAgentAction({ intent: intent('memory.save.project'), artifact: ARTIFACT });
    await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Algo nuevo'],
      onPhase: (phase) => phases.push(phase),
    });
    expect(phases).toContain('persisting');
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('reports the scope in the user-facing messages', async () => {
    const plan = planAgentAction({ intent: intent('memory.save.global'), artifact: ARTIFACT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ARTIFACT,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: buildStore(),
      memoryStore,
      memoryBullets: ['Algo nuevo'],
    });
    expect(result.messages[0]).toMatch(/memoria global/i);
  });
});
