/**
 * Tests focused on `artifact.create` execution: the path that historically
 * surfaced the silent-success regression where the Copiloto Global would
 * say "creé el artefacto" but no new artifact appeared in the Hub.
 *
 * Covers:
 *  - the executor fails cleanly when `store.createArtifact` is missing
 *  - it returns `newArtifactId` (not `newArtifactVersionId`) on success
 *  - it never claims success when the AI returns empty content
 *  - it validates the store contract (artifact with id) before reporting success
 *  - it normalises diagram semantics before persistence (the IR repair pass)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeAgentAction } from '../agentExecutor';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';

const generateArtifactContent = vi.fn(async (..._args: unknown[]) => `C4Context\n    Person(asegurado, "Asegurado", "Cliente del seguro")\n    System(core, "Core de Pólizas", "Backend")\n    Rel(asegurado, core, "Compra póliza")`);

vi.mock('../../geminiService', () => {
  class AIServiceError extends Error {
    category = 'unknown';
    status = 0;
    retryable = false;
    userMessage = 'Test error';
    constructor(message: string) { super(message); }
  }
  return {
    geminiService: {
      generateArtifactContent: (...args: unknown[]) => generateArtifactContent(...args),
      applyArtifactImprovements: vi.fn(),
      processAssistantChat: vi.fn(),
    },
    AIServiceError,
    classifyAIError: (err: unknown) => {
      const e = new AIServiceError(err instanceof Error ? err.message : String(err));
      return e;
    },
  };
});

const PROJECT: Project = {
  id: 'proj-1',
  name: 'Seguros',
  description: 'Insurance project',
  projectContext: [],
  artifacts: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SETTINGS: Settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'professional', languageStyle: 'concise', apiKeySource: 'global' },
};

// Synthetic anchor — copilot global uses one when no artifact is open.
const ANCHOR: Artifact = {
  id: 'copilot-anchor',
  versionGroupId: 'copilot-anchor',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Anchor',
  type: 'markdown',
  phase: '—',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '',
  objective: 'Synthetic',
  keyConcepts: [],
  representation: 'document',
};

const createIntent = (instruction = 'crea un diagrama de contexto C4 con Asegurado y Proveedor Médico'): AgentIntent => ({
  type: 'artifact.create',
  confidence: 0.9,
  userInstruction: instruction,
  artifactId: null,
  artifactVersionGroupId: null,
  artifactViewContext: null,
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'medium',
  suggestedTarget: 'new_version',
});

describe('executeAgentAction — artifact.create', () => {
  beforeEach(() => {
    generateArtifactContent.mockClear();
  });

  it('fails cleanly when store.createArtifact is missing (the historical AssistantPanel bug)', async () => {
    const plan = planAgentAction({ intent: createIntent(), artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: {
        // createArtifact intentionally omitted — mirrors the legacy
        // AssistantPanel bug. The executor must NOT silently succeed.
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });
    expect(result.status).toBe('failed');
    expect(result.errors).toContain('agent.createArtifact.unavailable');
    expect(result.newArtifactId).toBeFalsy();
  });

  it('returns newArtifactId (not newArtifactVersionId) on success', async () => {
    const createArtifact = vi.fn((_projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
      ...data,
      id: 'art-new',
      versionGroupId: 'grp-new',
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    const plan = planAgentAction({ intent: createIntent(), artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: {
        createArtifact,
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });
    expect(result.status).toBe('success');
    expect(result.newArtifactId).toBe('art-new');
    expect(result.newArtifactVersionId).toBeNull();
    expect(createArtifact).toHaveBeenCalledTimes(1);
  });

  it('surfaces a governance advisory when prerequisite artifacts are missing', async () => {
    const createArtifact = vi.fn((_projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
      ...data,
      id: 'art-c4n2',
      versionGroupId: 'grp-c4n2',
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    const intent: AgentIntent = {
      ...createIntent('crea el diagrama de contenedores'),
      createHint: { templateName: 'Diagrama de Contenedores (C4-N2)' },
    };
    const plan = planAgentAction({ intent, artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT, // sin C4-N1 ni Visión de la Arquitectura
      settings: SETTINGS,
      history: [],
      store: { createArtifact, createArtifactVersion: vi.fn(), updateArtifact: vi.fn() },
    });
    expect(result.status).toBe('success');
    const advisory = result.messages.find((m) => m.includes('Aviso de gobernanza'));
    expect(advisory).toBeDefined();
    expect(advisory).toContain('Diagrama de Contexto (C4-N1)');
    // The generation template is biased to declare assumptions for the
    // missing prerequisites.
    const generationTemplate = generateArtifactContent.mock.calls[0]?.[1] as { objective: string };
    expect(generationTemplate.objective).toContain('Nota de gobernanza');
  });

  it('emits no governance advisory when prerequisites exist', async () => {
    const prereq = (name: string, id: string): Artifact => ({
      ...ANCHOR,
      id,
      versionGroupId: id,
      name,
      content: 'Contenido sustancial del prerrequisito.',
    });
    const projectWithPrereqs: Project = {
      ...PROJECT,
      artifacts: [
        prereq('Diagrama de Contexto (C4-N1)', 'a-c4n1'),
        prereq('Visión de la Arquitectura', 'a-vision'),
      ],
    };
    const createArtifact = vi.fn((_projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
      ...data,
      id: 'art-c4n2',
      versionGroupId: 'grp-c4n2',
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    const intent: AgentIntent = {
      ...createIntent('crea el diagrama de contenedores'),
      createHint: { templateName: 'Diagrama de Contenedores (C4-N2)' },
    };
    const plan = planAgentAction({ intent, artifact: ANCHOR, project: projectWithPrereqs });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: projectWithPrereqs,
      settings: SETTINGS,
      history: [],
      store: { createArtifact, createArtifactVersion: vi.fn(), updateArtifact: vi.fn() },
    });
    expect(result.status).toBe('success');
    expect(result.messages.some((m) => m.includes('Aviso de gobernanza'))).toBe(false);
  });

  it('refuses to declare success when the AI returns empty content', async () => {
    generateArtifactContent.mockResolvedValueOnce('   ');
    const createArtifact = vi.fn();
    const plan = planAgentAction({ intent: createIntent(), artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: {
        createArtifact,
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });
    expect(result.status).toBe('failed');
    expect(createArtifact).not.toHaveBeenCalled();
    expect(result.errors).toContain('agent.create.emptyContent');
  });

  it('fails when the store contract returns an artifact without id', async () => {
    // Simulates an offline / broken persistence path that returns a
    // truthy-but-invalid object. The executor MUST detect this.
    const createArtifact = vi.fn(() => ({ id: '', name: 'x' } as unknown as Artifact));
    const plan = planAgentAction({ intent: createIntent(), artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: {
        createArtifact,
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });
    expect(result.status).toBe('failed');
    expect(result.errors.join(' ')).toMatch(/objeto válido/i);
  });

  it('reports diagram renderability in appliedChanges when persisting a diagram artifact', async () => {
    const createArtifact = vi.fn((_projectId: string, data: Omit<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>) => ({
      ...data,
      id: 'art-c4',
      versionGroupId: 'grp-c4',
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    const plan = planAgentAction({ intent: createIntent(), artifact: ANCHOR, project: PROJECT });
    const result = await executeAgentAction({
      confirmedByUser: true,
      plan,
      artifact: ANCHOR,
      project: PROJECT,
      settings: SETTINGS,
      history: [],
      store: {
        createArtifact,
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });
    expect(result.status).toBe('success');
    // The created C4 artifact's content describes 2 nodes and 1 edge.
    // The executor's render-validation block must record this.
    const summary = result.appliedChanges.join(' | ');
    expect(summary).toMatch(/Diagrama renderizable/);
    expect(summary).toMatch(/2 nodos/);
    expect(summary).toMatch(/1 relaciones/);
  });
});
