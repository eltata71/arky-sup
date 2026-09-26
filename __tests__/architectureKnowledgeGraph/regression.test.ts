/**
 * Regression guards: the Architecture Knowledge Graph is strictly additive and
 * must not perturb existing artifact / project structures.
 */

import { describe, expect, it } from 'vitest';
import { validateProject } from '../../services/architectureProjects/domain/projectRuntimeValidation';
import {
  buildArchitectureKnowledgeGraph,
  createEmptyArchitectureGraph,
  type ArchitectureGraphArtifactInput,
} from '../../services/architectureKnowledgeGraph';
import { NOW } from './fixtures';

describe('AKG regression — additive, non-mutating', () => {
  it('reads an artifact carrying ir / envelope / compilation / trace without touching them', () => {
    const ir = { nodes: [{ id: 'n', label: 'Servicio Core', kind: 'System' }], edges: [], groups: [] };
    const generationTrace = { id: 'trace-1', status: 'clean' };
    const artifactEnvelope = { id: 'env-1', primaryViewMode: 'diagram' };
    const compilation = { compilerStatus: 'passed', compilerScore: 90 };
    const artifact: ArchitectureGraphArtifactInput = {
      id: 'art-1',
      name: 'Artefacto completo',
      type: 'mermaid-c4-context',
      content: 'Contenido',
      ir,
      generationTrace,
      artifactEnvelope,
      compilation,
    };

    const graph = buildArchitectureKnowledgeGraph({ projectId: 'p', now: NOW, artifacts: [artifact] });
    expect(graph.entities.length).toBeGreaterThan(0);
    // The build only reads — every original sub-object keeps its identity.
    expect(artifact.ir).toBe(ir);
    expect(artifact.generationTrace).toBe(generationTrace);
    expect(artifact.artifactEnvelope).toBe(artifactEnvelope);
    expect(artifact.compilation).toBe(compilation);
  });

  it('validateProject round-trips the optional architectureKnowledgeGraph field', () => {
    const graph = createEmptyArchitectureGraph('p', NOW);
    const result = validateProject({
      id: 'p',
      name: 'Proyecto',
      description: '',
      projectContext: [],
      artifacts: [],
      createdAt: NOW,
      updatedAt: NOW,
      architectureKnowledgeGraph: graph,
    });
    expect(result.value).not.toBeNull();
    expect(result.value!.architectureKnowledgeGraph).toBeDefined();
  });

  it('validateProject still accepts a legacy project without the graph field', () => {
    const result = validateProject({
      id: 'legacy',
      name: 'Legado',
      description: '',
      projectContext: [],
      artifacts: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(result.value).not.toBeNull();
    expect(result.value!.architectureKnowledgeGraph).toBeUndefined();
  });
});
