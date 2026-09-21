import { describe, expect, it, vi } from 'vitest';
import type { Artifact, Project, Settings } from '../../types';
import { executeAgentAction } from '../../services/agent/agentExecutor';
import type { AgentActionPlan } from '../../services/agent/agentTypes';

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
    createHint: { deterministicArtifactId },
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
