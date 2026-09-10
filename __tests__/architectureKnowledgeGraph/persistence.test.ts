import { describe, expect, it } from 'vitest';
import type { Project } from '../../types';
import {
  attachGraphToProject,
  buildArchitectureKnowledgeGraph,
  buildGraphUpdatePayload,
  createEmptyArchitectureGraph,
  deserializeArchitectureGraph,
  migrateArchitectureGraph,
  readGraphFromProject,
  serializeArchitectureGraph,
  validateArchitectureGraph,
} from '../../services/architectureKnowledgeGraph';
import { NOW, fullBuildInput } from './fixtures';

const legacyProject: Project = {
  id: 'legacy-1',
  name: 'Proyecto legado',
  description: 'Un proyecto creado antes del grafo de conocimiento.',
  projectContext: [],
  artifacts: [],
  createdAt: NOW,
  updatedAt: NOW,
};

describe('ArchitectureGraphPersistenceAdapter', () => {
  it('treats a legacy project (no graph) as having no graph', () => {
    expect(readGraphFromProject(legacyProject)).toBeNull();
    expect(legacyProject.architectureKnowledgeGraph).toBeUndefined();
  });

  it('attaches a serialized graph to a project without mutating the original', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const updated = attachGraphToProject(legacyProject, graph);
    expect(updated.architectureKnowledgeGraph).toBeDefined();
    expect(legacyProject.architectureKnowledgeGraph).toBeUndefined();
    const roundTripped = readGraphFromProject(updated);
    expect(roundTripped?.entities.length).toBe(graph.entities.length);
  });

  it('serialization drops undefined values that Firestore rejects', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const serialized = serializeArchitectureGraph(graph);
    const json = JSON.stringify(serialized);
    expect(json).not.toContain(':undefined');
    expect(buildGraphUpdatePayload(graph).architectureKnowledgeGraph).toBeDefined();
  });

  it('returns null for absent persisted data', () => {
    expect(deserializeArchitectureGraph(undefined)).toBeNull();
    expect(deserializeArchitectureGraph(null)).toBeNull();
  });
});

describe('ArchitectureGraph runtime validation', () => {
  it('drops corrupt entities and dangling relations while keeping valid data', () => {
    const result = validateArchitectureGraph({
      projectId: 'p',
      entities: [
        { id: 'e1', name: 'Entidad válida', type: 'system' },
        { name: 'sin id' },
        'no es un objeto',
      ],
      relations: [
        { id: 'r1', sourceEntityId: 'e1', targetEntityId: 'inexistente', type: 'uses' },
        { id: 'r2', sourceEntityId: 'e1', targetEntityId: 'e1', type: 'relatedTo' },
      ],
    });
    expect(result.value).not.toBeNull();
    expect(result.value!.entities).toHaveLength(1);
    // r1 dangles (missing target) and is dropped; r2 is kept.
    expect(result.value!.relations).toHaveLength(1);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('never throws on garbage input — no blank screen', () => {
    expect(() => validateArchitectureGraph(null)).not.toThrow();
    expect(() => validateArchitectureGraph('garbage')).not.toThrow();
    expect(() => validateArchitectureGraph(42)).not.toThrow();
    expect(validateArchitectureGraph(null).value).toBeNull();
    expect(() => migrateArchitectureGraph({ broken: true })).not.toThrow();
  });

  it('migrates a current-schema graph without data loss', () => {
    const graph = createEmptyArchitectureGraph('p', NOW);
    const migrated = migrateArchitectureGraph(graph);
    expect(migrated).not.toBeNull();
    expect(migrated!.projectId).toBe('p');
    expect(migrated!.version).toBe(graph.version);
  });

  it('normalizes an unknown entity type to "unknown"', () => {
    const result = validateArchitectureGraph({
      projectId: 'p',
      entities: [{ id: 'e1', name: 'X', type: 'not-a-real-type' }],
      relations: [],
    });
    expect(result.value!.entities[0].type).toBe('unknown');
  });
});
