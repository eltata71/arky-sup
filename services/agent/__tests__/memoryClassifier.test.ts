import { describe, it, expect } from 'vitest';
import { classifyAgentIntent } from '../intentClassifier';
import type { AgentContext } from '../agentTypes';
import type { Artifact } from '../../../types';

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

const ctx = (overrides: Partial<AgentContext> = {}): AgentContext => ({
  artifact: FAKE_ARTIFACT,
  viewMode: 'diagram',
  history: [],
  hasPendingSuggestions: false,
  ...overrides,
});

describe('classifyAgentIntent — memory.save.*', () => {
  it('classifies "guarda esto en la memoria del proyecto"', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria del proyecto', ctx());
    expect(intent.type).toBe('memory.save.project');
    expect(intent.memoryScope).toBe('project');
    expect(intent.requiresConfirmation).toBe(true);
  });

  it('classifies "agrega esto al contexto global"', () => {
    const intent = classifyAgentIntent('Agrega esta nota al contexto global', ctx());
    expect(intent.type).toBe('memory.save.global');
    expect(intent.memoryScope).toBe('global');
  });

  it('classifies "guarda esto en la memoria del artefacto"', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria del artefacto', ctx());
    expect(intent.type).toBe('memory.save.artifact');
    expect(intent.memoryScope).toBe('artifact');
  });

  it('falls back to project scope when scope is not specified', () => {
    const intent = classifyAgentIntent('Recuerda esto como contexto para futuras conversaciones', ctx());
    expect(intent.type).toBe('memory.save.project');
    expect(intent.memoryScope).toBe('project');
  });

  it('downgrades artifact scope to project when there is no active artifact', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria del artefacto', ctx({ artifact: null }));
    expect(intent.type).toBe('memory.save.project');
    expect(intent.memoryScope).toBe('project');
  });

  it('works without an active artifact for global scope', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria global', ctx({ artifact: null }));
    expect(intent.type).toBe('memory.save.global');
    expect(intent.memoryScope).toBe('global');
  });

  it('classifies "registra esto en memoria del proyecto"', () => {
    const intent = classifyAgentIntent('Registra esto en memoria del proyecto', ctx());
    expect(intent.type).toBe('memory.save.project');
  });

  it('classifies "captura esto como directriz"', () => {
    const intent = classifyAgentIntent('Captura esto como directriz para la IA', ctx());
    expect(intent.type).toBe('memory.save.project');
  });

  it('high confidence when scope is explicitly named', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria global', ctx());
    expect(intent.confidence).toBeGreaterThan(0.8);
  });

  it('is low impact (no version bump) even when high confidence', () => {
    const intent = classifyAgentIntent('Guarda esto en la memoria del proyecto', ctx());
    expect(intent.impact).toBe('low');
  });
});
