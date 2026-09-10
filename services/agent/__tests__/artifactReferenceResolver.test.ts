import { describe, it, expect } from 'vitest';
import { resolveArtifactReference } from '../artifactReferenceResolver';
import type { Artifact, Project } from '../../../types';

const baseArtifact = (overrides: Partial<Artifact>): Artifact => ({
  id: 'art-1',
  versionGroupId: 'grp-1',
  version: 1,
  createdAt: new Date('2026-05-01').toISOString(),
  name: 'Diagrama de Contexto',
  type: 'mermaid-c4-context',
  phase: 'Análisis',
  architecturalView: 'Vista de Contexto y Negocio',
  content: '',
  objective: 'Mostrar el sistema',
  keyConcepts: [],
  representation: 'diagram',
  ...overrides,
});

const makeProject = (artifacts: Artifact[]): Project => ({
  id: 'prj-1',
  name: 'Test',
  description: 'Test project',
  artifacts,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  projectContext: [],
});

describe('resolveArtifactReference', () => {
  it('returns no match when the project has no artifacts', () => {
    const project = makeProject([]);
    const result = resolveArtifactReference(project, 'mejora el diagrama de contexto');
    expect(result.resolved).toBeNull();
    expect(result.candidates).toHaveLength(0);
    expect(result.unambiguous).toBe(false);
  });

  it('resolves to the single matching artifact when the user names it', () => {
    const project = makeProject([
      baseArtifact({ id: 'a1', name: 'Diagrama de Contexto', versionGroupId: 'a1' }),
      baseArtifact({ id: 'b1', name: 'Mapa de Capacidades de Negocio', versionGroupId: 'b1', type: 'react-flow-graph' }),
    ]);
    const result = resolveArtifactReference(project, 'mejora el diagrama de contexto');
    expect(result.unambiguous).toBe(true);
    expect(result.resolved?.id).toBe('a1');
  });

  it('returns multiple candidates when the reference is ambiguous', () => {
    const project = makeProject([
      baseArtifact({ id: 'a1', name: 'Diagrama de Integración A', versionGroupId: 'a1' }),
      baseArtifact({ id: 'b1', name: 'Diagrama de Integración B', versionGroupId: 'b1' }),
      baseArtifact({ id: 'c1', name: 'Resumen Ejecutivo', versionGroupId: 'c1', type: 'markdown' }),
    ]);
    const result = resolveArtifactReference(project, 'mejora el diagrama de integración');
    expect(result.unambiguous).toBe(false);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    const ids = result.candidates.map((a) => a.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('b1');
  });

  it('picks the most recent artifact when the user requests "el más reciente"', () => {
    const project = makeProject([
      baseArtifact({ id: 'old', name: 'Diagrama de Contexto', versionGroupId: 'old', createdAt: new Date('2026-01-01').toISOString() }),
      baseArtifact({ id: 'fresh', name: 'Mapa de Procesos', versionGroupId: 'fresh', createdAt: new Date('2026-05-10').toISOString(), type: 'markdown' }),
    ]);
    const result = resolveArtifactReference(project, 'regenera el más reciente artefacto');
    expect(result.unambiguous).toBe(true);
    expect(result.resolved?.id).toBe('fresh');
  });

  it('only inspects the latest version per group', () => {
    const project = makeProject([
      baseArtifact({ id: 'g1-v1', name: 'Diagrama de Contexto', versionGroupId: 'g1', version: 1 }),
      baseArtifact({ id: 'g1-v2', name: 'Diagrama de Contexto Mejorado', versionGroupId: 'g1', version: 2 }),
    ]);
    const result = resolveArtifactReference(project, 'mejora el diagrama de contexto mejorado');
    expect(result.candidates.every((a) => a.id !== 'g1-v1')).toBe(true);
    expect(result.candidates[0]?.id).toBe('g1-v2');
  });
});
