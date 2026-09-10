/**
 * Default Architecture Knowledge Graph resolution for artifact generation.
 *
 * Every generation call site that does NOT resolve a graph block explicitly
 * (Arquitecto Agente, creación guiada, SDD) must still ground the model on
 * the project's architectural knowledge: the service rebuilds a stale or
 * missing graph in-memory (deterministic, no AI) and injects the prompt
 * block; empty projects and failures degrade to '' without breaking the
 * generation.
 */

import { describe, expect, it } from 'vitest';
import { geminiService } from '../../services/geminiService';
import { buildArchitectureKnowledgeGraphForProject } from '../../services/architectureKnowledgeGraph';
import type { Artifact, ArtifactTemplate, Project, Settings } from '../../types';

const artifact = (overrides: Partial<Artifact>): Artifact => ({
  id: 'a1',
  versionGroupId: 'g1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Diagrama de Contexto (C4-N1)',
  type: 'mermaid-c4-context',
  phase: 'Fase 2: Diseño Conceptual y Lógico',
  architecturalView: 'Vista de Contexto y Negocio',
  content: 'C4Context\n  Person(asegurado, "Asegurado", "Cliente del seguro")\n  System(core, "Core de Reclamos", "Procesa reclamos médicos")\n  Rel(asegurado, core, "Radica reclamo")',
  objective: 'Mostrar el alcance del sistema de reclamos.',
  keyConcepts: [],
  representation: 'diagram',
  ...overrides,
});

const project: Project = {
  id: 'p1',
  name: 'Reclamos médicos',
  description: 'Modernización del core de reclamos médicos.',
  projectContext: ['El Core de Reclamos publica eventos en Kafka.'],
  artifacts: [artifact({})],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const settings: Settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'user',
  },
};

const template: ArtifactTemplate = {
  name: 'Diagrama de Contenedores (C4-N2)',
  type: 'mermaid-c4-container',
  phase: 'Fase 2: Diseño Conceptual y Lógico',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Contenedores del sistema de reclamos.',
  keyConcepts: [],
  representation: 'diagram',
} as ArtifactTemplate;

type GraphResolver = {
  resolveDefaultArchitectureGraphBlock: (p: Project, t: ArtifactTemplate, s: Settings) => string;
};

const resolveBlock = (p: Project) =>
  (geminiService as unknown as GraphResolver).resolveDefaultArchitectureGraphBlock(p, template, settings);

describe('geminiService.resolveDefaultArchitectureGraphBlock', () => {
  it('rebuilds a missing graph in-memory and returns a prompt block', () => {
    const block = resolveBlock(project); // no persisted graph
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('Core de Reclamos');
  });

  it('uses the persisted graph when current and flags nothing stale', () => {
    const persisted = buildArchitectureKnowledgeGraphForProject(project, { globalContext: settings.globalContext });
    const withGraph: Project = { ...project, architectureKnowledgeGraph: persisted };
    const block = resolveBlock(withGraph);
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain('desactualizado');
  });

  it('returns empty string for projects without artifacts', () => {
    expect(resolveBlock({ ...project, artifacts: [] })).toBe('');
  });
});
