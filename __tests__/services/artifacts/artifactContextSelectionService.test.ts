import { describe, expect, it } from 'vitest';
import type { Artifact, Project } from '../../../types';
import { buildDeterministicArtifactBrief } from '../../../services/artifacts/artifactBriefService';
import { selectArtifactGenerationContext } from '../../../services/artifacts/artifactContextSelectionService';

const artifact = (id: string, name: string, content: string, version = 1): Artifact => ({
  id,
  versionGroupId: name,
  version,
  createdAt: `2026-01-0${version}T00:00:00.000Z`,
  name,
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista Lógica y de Diseño',
  content,
  objective: content,
  keyConcepts: [],
  representation: 'document',
});

const project: Project = {
  id: 'p1',
  name: 'Core',
  description: 'Proyecto Core',
  projectContext: ['Usar API Gateway', 'No usar sistema legacy de pólizas'],
  artifacts: [
    artifact('a1', 'Mapa APIs', 'API Gateway y eventos relevantes', 1),
    artifact('a2-old', 'Riesgos', 'Versión antigua de riesgos', 1),
    artifact('a2', 'Riesgos', 'Riesgos actuales de integración', 2),
    artifact('a3', 'Legacy', 'Sistema legacy excluido', 1),
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('artifactContextSelectionService', () => {
  it('conserva fuentes obligatorias y excluye explícitamente fuentes no permitidas', () => {
    const base = buildDeterministicArtifactBrief(project, 'Generar documento de integración API con riesgos actuales.', { now: '2026-05-18T00:00:00.000Z' });
    const contract = {
      ...base,
      requiredSourceArtifactIds: ['a1'],
      optionalSourceArtifactIds: ['a2', 'a3'],
      excludedSourceArtifactIds: ['a3'],
      excludedContextItems: ['legacy'],
    };

    const result = selectArtifactGenerationContext(project, contract, { maxOptionalSources: 3, sourceSummaryChars: 120 });

    expect(result.requiredSources.map(source => source.id)).toEqual(['a1']);
    expect(result.optionalSources.map(source => source.id)).toContain('a2');
    expect(result.optionalSources.map(source => source.id)).not.toContain('a3');
    expect(result.excludedSources.map(source => source.id)).toEqual(['a3']);
    expect(result.usedContextItems.join('\n')).not.toContain('legacy');
    expect(result.promptBlock).toContain('Fuentes excluidas');
    expect(result.promptBlock).toContain('[a3] Legacy');
    expect(result.promptBlock).not.toContain('Sistema legacy excluido\n### Contexto textual usado');
  });
});
