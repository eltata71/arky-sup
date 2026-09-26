/**
 * A portfolio built from unhydrated projects must not report an empty
 * organisation.
 *
 * This is the regression the lazy-loading change exists to avoid, and it is
 * the kind that ships: the code is correct, the types are satisfied, the suite
 * is green, and the dashboard quietly says the company has produced nothing.
 * `artifacts.length` is 0 on a project loaded from the portfolio and that
 * number means nothing at all — `artifactsLoaded` is what carries the fact.
 */

import { describe, expect, it } from 'vitest';
import { resolvePortfolioGraph } from '../../services/portfolioGraph';
import { buildOfficePortfolio } from '../../services/architectureOffice/domain/officePortfolio';
import type { ArtifactSummary } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';

const summary = (id: string, group = id, version = 1): ArtifactSummary => ({
  id,
  name: `Artefacto ${id}`,
  type: 'markdown',
  versionGroupId: group,
  version,
});

const baseProject = (overrides: Partial<Project>): Project => ({
  id: 'p1',
  name: 'Proyecto',
  description: '',
  projectContext: [],
  initiativeIds: [],
  linkedBusinessProjects: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** As the portfolio loads it: index present, bodies absent. */
const unhydrated = baseProject({
  artifactsLoaded: false,
  artifactCount: 3,
  // Two version groups, one with two versions — so "latest of each" is 2.
  artifactIndex: [summary('a1'), summary('a2-v1', 'g2', 1), summary('a2-v2', 'g2', 2)],
});

describe('the portfolio graph counts an unhydrated project', () => {
  it('builds artifact nodes from the index', () => {
    const graph = resolvePortfolioGraph([], [unhydrated], []);
    expect(graph.artifacts).toHaveLength(2);
    expect(graph.artifacts.map((node) => node.id).sort()).toEqual(['a1', 'a2-v2']);
  });

  it('keeps only the latest version of each group, as it does when hydrated', () => {
    const graph = resolvePortfolioGraph([], [unhydrated], []);
    expect(graph.artifacts.map((node) => node.id)).not.toContain('a2-v1');
  });

  it('reports the same shape whether the project is hydrated or not', () => {
    const hydrated = baseProject({
      artifactsLoaded: true,
      artifacts: [
        { ...summary('a1'), content: 'x', objective: '', keyConcepts: [], phase: 'Design', representation: 'document', architecturalView: 'Vista Lógica y de Diseño', createdAt: '2026-01-01T00:00:00.000Z' },
        { ...summary('a2-v2', 'g2', 2), content: 'x', objective: '', keyConcepts: [], phase: 'Design', representation: 'document', architecturalView: 'Vista Lógica y de Diseño', createdAt: '2026-01-01T00:00:00.000Z' },
      ] as Project['artifacts'],
    });

    const fromIndex = resolvePortfolioGraph([], [unhydrated], []);
    const fromDocuments = resolvePortfolioGraph([], [hydrated], []);

    expect(fromIndex.artifacts.map((n) => n.id).sort())
      .toEqual(fromDocuments.artifacts.map((n) => n.id).sort());
  });

  it('reports genuinely empty when the project has no artifacts at all', () => {
    // The distinction has to work in both directions, or the flag just hides
    // the zero instead of explaining it.
    const empty = baseProject({ artifactsLoaded: false, artifactCount: 0, artifactIndex: [] });
    const graph = resolvePortfolioGraph([], [empty], []);
    expect(graph.artifacts).toHaveLength(0);
  });
});

describe('the office rollup counts an unhydrated project', () => {
  it('counts the latest version of each group from the index', () => {
    const portfolio = buildOfficePortfolio([unhydrated], [], { initiatives: [] });
    const entry = portfolio.projects.find((p) => p.projectId === 'p1');
    expect(entry?.artifactCount).toBe(2);
  });

  it('does not report zero for a project whose documents are not loaded', () => {
    const portfolio = buildOfficePortfolio([unhydrated], [], { initiatives: [] });
    const entry = portfolio.projects.find((p) => p.projectId === 'p1');
    expect(entry?.artifactCount).not.toBe(0);
  });
});
