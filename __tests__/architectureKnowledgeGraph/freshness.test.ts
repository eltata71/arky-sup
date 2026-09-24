/**
 * Architecture Knowledge Graph — freshness, reconstruction, generation use
 * and impact tests.
 *
 * Covers the operational integration gaps: signature-based invalidation on
 * every relevant artifact change, controlled reconstruction, the graph being
 * used as canonical generation context, and impact analysis.
 */

import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import {
  analyzeArchitectureImpact,
  buildArchitectureKnowledgeGraph,
  buildArchitectureKnowledgeGraphForProject,
  buildGraphInputFromProject,
  buildArtifactGenerationGraphContext,
  computeArchitectureGraphSignature,
  resolveArchitectureGraphFreshness,
  resolveProjectArchitectureGraphFreshness,
  type ArchitectureGraphBuildInput,
} from '../../services/architectureKnowledgeGraph';
import { NOW, fullBuildInput, makeArtifact } from './fixtures';
import { getOfficeArchitectureContext } from '../../services/architectureOffice/officeArchitectureKnowledge';

/** A build input cloned from the full fixture, deeply enough for mutation. */
const cloneInput = (): ArchitectureGraphBuildInput => ({
  ...fullBuildInput,
  artifacts: (fullBuildInput.artifacts ?? []).map((a) => ({ ...a })),
});

describe('computeArchitectureGraphSignature', () => {
  it('is deterministic for the same input', () => {
    expect(computeArchitectureGraphSignature(fullBuildInput)).toBe(
      computeArchitectureGraphSignature(cloneInput()),
    );
  });

  it('is stable against artifact reordering (a reorder is not a change)', () => {
    const reordered = cloneInput();
    reordered.artifacts = [...(reordered.artifacts ?? [])].reverse();
    expect(computeArchitectureGraphSignature(reordered)).toBe(
      computeArchitectureGraphSignature(fullBuildInput),
    );
  });

  it.each([
    ['content', (a: Artifact) => ({ ...a, content: `${a.content}\nRF-999: nuevo requerimiento.` })],
    ['objective', (a: Artifact) => ({ ...a, objective: 'Objetivo modificado.' })],
    ['type', (a: Artifact) => ({ ...a, type: 'sdd-nfr' as Artifact['type'] })],
    ['representation', (a: Artifact) => ({ ...a, representation: 'hybrid' as Artifact['representation'] })],
    ['keyConcepts', (a: Artifact) => ({ ...a, keyConcepts: [{ term: 'X', definition: 'Y' }] })],
    ['ir', (a: Artifact) => ({ ...a, ir: { nodes: [{ id: 'n', label: 'N' }], edges: [], groups: [] } as unknown as Artifact['ir'] })],
    ['artifactEnvelope', (a: Artifact) => ({ ...a, artifactEnvelope: { id: 'env-x' } as unknown as Artifact['artifactEnvelope'] })],
    ['generationTrace', (a: Artifact) => ({ ...a, generationTrace: { id: 'trace-x', status: 'clean' } as unknown as Artifact['generationTrace'] })],
  ])('changes when an artifact %s changes', (_field, mutate) => {
    const before = computeArchitectureGraphSignature(fullBuildInput);
    const mutated = cloneInput();
    const target = mutated.artifacts![0] as unknown as Artifact;
    mutated.artifacts![0] = mutate(target) as unknown as NonNullable<typeof mutated.artifacts>[number];
    expect(computeArchitectureGraphSignature(mutated)).not.toBe(before);
  });

  it('changes when an artifact is deleted', () => {
    const before = computeArchitectureGraphSignature(fullBuildInput);
    const fewer = cloneInput();
    fewer.artifacts = (fewer.artifacts ?? []).slice(1);
    expect(computeArchitectureGraphSignature(fewer)).not.toBe(before);
  });

  it('changes when a new artifact (version) is added', () => {
    const before = computeArchitectureGraphSignature(fullBuildInput);
    const more = cloneInput();
    more.artifacts = [
      ...(more.artifacts ?? []),
      makeArtifact({ id: 'art-new', name: 'Nuevo artefacto', type: 'sdd-nfr' }),
    ];
    expect(computeArchitectureGraphSignature(more)).not.toBe(before);
  });

  it('ignores volatile generationTrace lifecycle/persistence churn', () => {
    const base = cloneInput();
    base.artifacts![0] = {
      ...base.artifacts![0],
      generationTrace: { id: 't', status: 'clean', lifecycle: ['generated'], persistence: { local: 'success', remote: 'pending' } } as unknown as NonNullable<typeof base.artifacts>[number]['generationTrace'],
    };
    const churned = cloneInput();
    churned.artifacts![0] = {
      ...churned.artifacts![0],
      generationTrace: { id: 't', status: 'clean', lifecycle: ['generated', 'persisted-remote'], persistence: { local: 'success', remote: 'success' } } as unknown as NonNullable<typeof churned.artifacts>[number]['generationTrace'],
    };
    expect(computeArchitectureGraphSignature(churned)).toBe(
      computeArchitectureGraphSignature(base),
    );
  });
});

describe('buildArchitectureKnowledgeGraph — freshness signature', () => {
  it('stamps the graph with the signature of its build inputs', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    expect(graph.sourceSignature).toBe(computeArchitectureGraphSignature(fullBuildInput));
  });
});

describe('resolveArchitectureGraphFreshness', () => {
  it('reports `missing` when there is no graph', () => {
    expect(resolveArchitectureGraphFreshness(undefined, 'sig')).toBe('missing');
    expect(resolveArchitectureGraphFreshness(null, 'sig')).toBe('missing');
  });

  it('reports `current` when the signature matches', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const signature = computeArchitectureGraphSignature(fullBuildInput);
    expect(resolveArchitectureGraphFreshness(graph, signature)).toBe('current');
  });

  it('reports `stale` when the project changed since the build', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const changed = cloneInput();
    changed.artifacts![0] = { ...changed.artifacts![0], content: 'contenido totalmente nuevo' };
    expect(resolveArchitectureGraphFreshness(graph, computeArchitectureGraphSignature(changed))).toBe('stale');
  });

  it('treats a legacy graph (no signature) as `stale`', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const legacy = { ...graph, sourceSignature: undefined };
    expect(resolveArchitectureGraphFreshness(legacy, computeArchitectureGraphSignature(fullBuildInput))).toBe('stale');
  });
});

describe('graph reconstruction restores freshness', () => {
  it('a rebuild after a change yields a `current` graph again', () => {
    const initial = buildArchitectureKnowledgeGraph(fullBuildInput);
    // Mutate the project state.
    const next = cloneInput();
    next.artifacts![0] = { ...next.artifacts![0], content: 'RF-777: requerimiento adicional.' };
    // The old graph is now stale against the new state.
    expect(resolveArchitectureGraphFreshness(initial, computeArchitectureGraphSignature(next))).toBe('stale');
    // Controlled reconstruction restores freshness deterministically.
    const rebuilt = buildArchitectureKnowledgeGraph(next);
    expect(resolveArchitectureGraphFreshness(rebuilt, computeArchitectureGraphSignature(next))).toBe('current');
    // And the rebuild is deterministic.
    expect(buildArchitectureKnowledgeGraph(next).sourceSignature).toBe(rebuilt.sourceSignature);
  });
});

/* ------------------------------------------------------------------------- */
/* Project-level freshness                                                    */
/* ------------------------------------------------------------------------- */

const makeFullArtifact = (overrides: Partial<Artifact> & Pick<Artifact, 'id' | 'name' | 'type'>): Artifact => ({
  versionGroupId: overrides.id,
  version: 1,
  createdAt: NOW,
  phase: 'discovery',
  architecturalView: 'Vista SDD',
  content: '',
  objective: '',
  keyConcepts: [],
  representation: 'document',
  ...overrides,
});

const makeProject = (artifacts: Artifact[]): Project => ({
  id: 'project-fresh',
  name: 'Proyecto de frescura',
  description: 'Proyecto para probar la frescura del grafo.',
  projectContext: [],
  artifacts,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('resolveProjectArchitectureGraphFreshness', () => {
  it('keeps the default graph signature compatible when Office context is not requested', () => {
    const project = makeProject([makeFullArtifact({ id: 'a1', name: 'BRD', type: 'sdd-brd', content: 'RF-001: pagos.' })]);
    const graph = buildArchitectureKnowledgeGraphForProject(project);
    const legacyCompatible = buildArchitectureKnowledgeGraph(buildGraphInputFromProject(project));
    expect(graph.sourceSignature).toBe(legacyCompatible.sourceSignature);
  });

  it('includes Office standards in the signature only when the caller passes them (F5-03)', () => {
    const project = makeProject([makeFullArtifact({ id: 'a1', name: 'BRD', type: 'sdd-brd', content: 'RF-001: pagos.' })]);
    const baseline = buildArchitectureKnowledgeGraphForProject(project);
    const officeGraph = buildArchitectureKnowledgeGraphForProject(project, {
      globalContext: getOfficeArchitectureContext().promptContext,
    });
    expect(officeGraph.sourceSignature).not.toBe(baseline.sourceSignature);
  });

  it('is `missing` for a project with no persisted graph (backwards-compatible)', () => {
    const project = makeProject([makeFullArtifact({ id: 'a1', name: 'BRD', type: 'sdd-brd', content: 'RF-001: pagos.' })]);
    expect(resolveProjectArchitectureGraphFreshness(project)).toBe('missing');
  });

  it('is `current` right after persisting a freshly built graph', () => {
    const project = makeProject([makeFullArtifact({ id: 'a1', name: 'BRD', type: 'sdd-brd', content: 'RF-001: pagos.' })]);
    const graph = buildArchitectureKnowledgeGraphForProject(project);
    const persisted: Project = { ...project, architectureKnowledgeGraph: graph };
    expect(resolveProjectArchitectureGraphFreshness(persisted)).toBe('current');
  });

  it('becomes `stale` when an artifact changes after the graph was persisted', () => {
    const project = makeProject([makeFullArtifact({ id: 'a1', name: 'BRD', type: 'sdd-brd', content: 'RF-001: pagos.' })]);
    const graph = buildArchitectureKnowledgeGraphForProject(project);
    const persisted: Project = { ...project, architectureKnowledgeGraph: graph };
    const edited: Project = {
      ...persisted,
      artifacts: [{ ...persisted.artifacts[0], content: 'RF-001: pagos.\nRF-002: comprobantes.' }],
    };
    expect(resolveProjectArchitectureGraphFreshness(edited)).toBe('stale');
  });
});

/* ------------------------------------------------------------------------- */
/* Graph as generation context                                                */
/* ------------------------------------------------------------------------- */

describe('buildArtifactGenerationGraphContext', () => {
  it('produces a budgeted prompt block and a usage summary from a populated graph', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const result = buildArtifactGenerationGraphContext(graph, 'current', {
      artifactType: 'mermaid-erd',
      intent: 'modelo de datos de pagos',
    });
    expect(result.usage.used).toBe(true);
    expect(result.usage.buildId).toBe(graph.buildId);
    expect(result.usage.freshness).toBe('current');
    expect(result.usage.entitiesIncluded).toBeGreaterThan(0);
    expect(result.promptBlock.length).toBeGreaterThan(0);
    // The prompt context builder enforces a soft character budget.
    expect(result.promptBlock.length).toBeLessThan(4000);
  });

  it('adds a staleness note to the prompt block when the graph is stale', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const result = buildArtifactGenerationGraphContext(graph, 'stale', { artifactType: 'sdd-brd' });
    expect(result.usage.used).toBe(true);
    expect(result.usage.freshness).toBe('stale');
    expect(result.promptBlock.toLowerCase()).toContain('desactualizad');
  });

  it('degrades safely (no block, inert usage) for an absent or empty graph', () => {
    const absent = buildArtifactGenerationGraphContext(undefined, 'missing', {});
    expect(absent.promptBlock).toBe('');
    expect(absent.usage.used).toBe(false);

    const empty = buildArchitectureKnowledgeGraph({ projectId: 'p-empty', now: NOW });
    const emptyResult = buildArtifactGenerationGraphContext(empty, 'current', {});
    expect(emptyResult.promptBlock).toBe('');
    expect(emptyResult.usage.used).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* Impact analysis                                                            */
/* ------------------------------------------------------------------------- */

describe('analyzeArchitectureImpact', () => {
  it('resolves the artifacts impacted by a change to a graphed artifact', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const impact = analyzeArchitectureImpact(graph, { kind: 'artifact', targetId: 'art-c4' });
    expect(impact.resolved).toBe(true);
    expect(Array.isArray(impact.impactedArtifactIds)).toBe(true);
    expect(impact.recommendations.length).toBeGreaterThan(0);
  });

  it('reports an unresolved result for an unknown target without throwing', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    expect(() => analyzeArchitectureImpact(graph, { kind: 'artifact', targetId: 'does-not-exist' })).not.toThrow();
    const impact = analyzeArchitectureImpact(graph, { kind: 'artifact', targetId: 'does-not-exist' });
    expect(impact.resolved).toBe(false);
  });
});
