/**
 * Document-quality parity tests for agent paths (improve / patch /
 * applySuggestion): these bypass `generateArtifactContent`, so the executor's
 * own validation must reject truncated or drastically-shrunken documents the
 * same way the Workspace generation gate would.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeAgentAction } from '../agentExecutor';
import { planAgentAction } from '../agentPlanner';
import type { AgentIntent } from '../agentTypes';
import type { Artifact, Project, Settings } from '../../../types';

const applyArtifactImprovements = vi.fn(async (..._args: unknown[]) => '');

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
      applyArtifactImprovements: (...args: unknown[]) => applyArtifactImprovements(...args),
      processAssistantChat: vi.fn(),
      generateArtifactContent: vi.fn(),
    },
    AIServiceError,
    classifyAIError: (err: unknown) => new AIServiceError(err instanceof Error ? err.message : String(err)),
  };
});

const LONG_DOC = `# Documento de Arquitectura

## Resumen Ejecutivo
${'Contenido sustantivo del documento de arquitectura para reclamos médicos. '.repeat(20)}

## Decisiones
${'Decisión arquitectónica relevante con su justificación detallada. '.repeat(20)}

## Cierre
Documento completo y aprobado.`;

const DOC_ARTIFACT: Artifact = {
  id: 'doc-1',
  versionGroupId: 'grp-doc',
  version: 1,
  createdAt: new Date().toISOString(),
  name: 'Documento de Arquitectura',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: LONG_DOC,
  objective: 'Documentar la arquitectura',
  keyConcepts: [],
  representation: 'document',
};

const PROJECT: Project = {
  id: 'proj-1',
  name: 'Seguros',
  description: 'Insurance project',
  projectContext: [],
  artifacts: [DOC_ARTIFACT],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SETTINGS: Settings = {
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: { model: 'gemini-2.5-flash', temperature: 0.7, tone: 'professional', languageStyle: 'concise', apiKeySource: 'global' },
};

const improveIntent: AgentIntent = {
  type: 'artifact.improve',
  confidence: 0.9,
  userInstruction: 'mejora la sección de decisiones',
  artifactId: 'doc-1',
  artifactVersionGroupId: 'grp-doc',
  artifactViewContext: 'document',
  extractedRequirements: [],
  requiresConfirmation: false,
  impact: 'medium',
  suggestedTarget: 'new_version',
};

const runImprove = async () => {
  const plan = planAgentAction({ intent: improveIntent, artifact: DOC_ARTIFACT });
  return executeAgentAction({
    plan,
    artifact: DOC_ARTIFACT,
    project: PROJECT,
    settings: SETTINGS,
    history: [],
    store: { createArtifactVersion: vi.fn(() => ({ ...DOC_ARTIFACT, id: 'doc-2' })), updateArtifact: vi.fn() },
  });
};

describe('executeAgentAction — document quality parity', () => {
  it('rejects truncated documents (unclosed code fence)', async () => {
    applyArtifactImprovements.mockResolvedValueOnce(
      `# Documento

## Sección
${'Texto suficiente para superar el umbral mínimo de longitud del documento. '.repeat(10)}

\`\`\`mermaid
graph TD
  A --> B`,
    );
    const result = await runImprove();
    expect(result.status).toBe('failed');
    expect(result.validationResult?.passed).toBe(false);
    expect(result.validationResult?.summary).toContain('truncado');
  });

  it('rejects drastic content shrinkage', async () => {
    applyArtifactImprovements.mockResolvedValueOnce('# Documento\n\nQuedó muy corto pero termina bien.');
    const result = await runImprove();
    expect(result.status).toBe('failed');
    expect(result.validationResult?.summary).toContain('drásticamente');
  });

  it('accepts complete documents and reports the quality score', async () => {
    applyArtifactImprovements.mockResolvedValueOnce(`${LONG_DOC}\n\n## Nueva sección de decisiones mejorada\nContenido mejorado y completo.`);
    const result = await runImprove();
    expect(result.status).toBe('success');
    expect(result.validationResult?.passed).toBe(true);
    expect(result.validationResult?.summary).toMatch(/\d+\/100/);
  });
});
