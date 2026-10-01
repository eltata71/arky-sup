import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';
import type { Artifact, ContextManifestRecord } from '../../lib/artifacts';
import type { ArtifactContentGenerationOptions } from '../../services/ai';
import type { Project } from '../../services/architectureProjects';
import { executeAgentAction } from '../../services/agent/agentExecutor';
import type { AgentActionPlan } from '../../services/agent/agentTypes';

const generateArtifactContent = vi.hoisted(() => vi.fn());
vi.mock('../../services/ai', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/ai')>();
  return { ...actual, artifactGenerationService: { ...actual.artifactGenerationService, generateArtifactContent } };
});

const existingArtifact = (id: string): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
  name: 'Arquitectura existente',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista de Gestión y Soporte',
  content: '# Arquitectura',
  objective: 'Documentar la solución.',
  keyConcepts: [],
  representation: 'document',
});

describe('executeAgentAction contexto histórico', () => {
  const captured: ContextManifestRecord = {
    label: 'Generación', sources: [{ id: 'p1', label: 'Proyecto original', revision: 2 }],
    sections: [{ scope: 'project', items: [{ text: 'Decisión original' }] }], omitted: [],
  };
  const generated = '# Arquitectura nueva\n\n## Objetivo\nDocumentar la plataforma de pagos y sus responsabilidades.\n\n## Alcance\nEl servicio procesa las transacciones de los clientes.';

  it.each(['artifact.create', 'artifact.regenerate'] as const)('guarda el contexto capturado al ejecutar %s', async action => {
    generateArtifactContent.mockImplementation(async (_p, _t, _s, _a, options: ArtifactContentGenerationOptions) => {
      options.onContextCaptured?.(captured);
      return generated;
    });
    const original = existingArtifact('a1');
    const currentPlan = plan('new-artifact');
    currentPlan.actionType = action;
    currentPlan.intent.type = action;
    const createArtifact = vi.fn((_id: string, draft: Partial<Artifact>) => ({ ...original, ...draft, id: 'new' }));
    const createArtifactVersion = vi.fn((_id: string, _group: string, draft: Partial<Artifact>) => ({ ...original, ...draft, id: 'new' }));
    const result = await executeAgentAction({
      plan: currentPlan, artifact: original, project: { id: 'p1', artifacts: [original] } as Project,
      settings: {} as Settings, history: [], store: { createArtifact, createArtifactVersion, updateArtifact: vi.fn() },
    });
    expect(result.status).toBe('success');
    const saved = action === 'artifact.create' ? createArtifact.mock.calls[0][1] : createArtifactVersion.mock.calls[0][2];
    expect(saved.generationTrace?.contextManifest?.records).toEqual([captured]);
    expect(saved.generationTrace?.source).toBe(action === 'artifact.create' ? 'on-demand' : 'regeneration');
  });

  it('regenerar sin captura sustituye la traza anterior también al actualizar en sitio', async () => {
    generateArtifactContent.mockResolvedValue(generated);
    const original = existingArtifact('a1');
    original.generationTrace = {
      id: 'old', source: 'catalog', status: 'clean', startedAt: 'old', decisions: [], errors: [],
      contextManifest: { version: 1, capturedAt: 'old', records: [captured] },
    };
    const currentPlan = plan('new');
    currentPlan.actionType = 'artifact.regenerate';
    currentPlan.intent.type = 'artifact.regenerate';
    const updateArtifact = vi.fn();
    const result = await executeAgentAction({
      plan: currentPlan, artifact: original, project: { id: 'p1', artifacts: [original] } as Project,
      settings: {} as Settings, history: [], targetOverride: 'current',
      store: { createArtifactVersion: vi.fn(), updateArtifact },
    });
    expect(result.status).toBe('success');
    const saved = updateArtifact.mock.calls[0][2] as Partial<Artifact>;
    expect(saved.generationTrace?.id).not.toBe('old');
    expect(saved.generationTrace?.contextManifest).toBeUndefined();
    expect(saved.generationTrace?.status).toBe('warning');
  });
});

const plan = (deterministicArtifactId: string): AgentActionPlan => ({
  actionId: 'action-1',
  artifactId: 'office-anchor-task-1',
  currentVersionId: 'office-anchor-task-1',
  actionType: 'artifact.create',
  title: 'Crear artefacto',
  summary: 'Crear entregable',
  rationale: 'El charter lo exige.',
  affectedAreas: ['Contenido'],
  risks: [],
  target: 'new_version',
  requiresConfirmation: false,
  status: 'pending',
  createdAt: '2026-09-20T00:00:00.000Z',
  traceId: 'trace-1',
  intent: {
    type: 'artifact.create',
    confidence: 1,
    userInstruction: 'Crear arquitectura',
    artifactId: null,
    artifactVersionGroupId: null,
    artifactViewContext: null,
    extractedRequirements: [],
    requiresConfirmation: false,
    impact: 'medium',
    suggestedTarget: 'new_version',
    createHint: { templateName: null, deterministicArtifactId },
  },
});

describe('executeAgentAction artifact.create idempotente', () => {
  it('reutiliza el artefacto del mismo executionId sin generar ni crear otro', async () => {
    const artifactId = 'office-art-office-task-exec-1';
    const artifact = existingArtifact(artifactId);
    const createArtifact = vi.fn();
    const result = await executeAgentAction({
      plan: plan(artifactId),
      artifact: existingArtifact('office-anchor-task-1'),
      project: { id: 'project-1', artifacts: [artifact] } as Project,
      settings: {} as Settings,
      history: [],
      store: {
        createArtifact,
        createArtifactVersion: vi.fn(),
        updateArtifact: vi.fn(),
      },
    });

    expect(result.status).toBe('success');
    expect(result.newArtifactId).toBe(artifactId);
    expect(createArtifact).not.toHaveBeenCalled();
    expect(result.messages.join(' ')).toMatch(/reutiliz/);
  });
});
