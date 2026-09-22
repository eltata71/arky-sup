import { describe, it, expect } from 'vitest';
import type { ArtifactTemplate } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import {
  getPhaseLabel,
  getArtifactActivityDate,
  getArtifactActivityTimestamp,
  getArtifactOrigin,
  getLatestArtifact,
  sortArtifacts,
  sortTemplates,
  ARTIFACT_SORT_OPTIONS,
  DEFAULT_ARTIFACT_SORT,
  DEFAULT_TEMPLATE_SORT,
} from '../../utils/artifactExploration';

const PHASE_1 = 'Fase 1: Estratégica y de Visión de Negocio';
const PHASE_3 = 'Fase 3: Diseño Físico y Tecnológico';

function makeArtifact(overrides: Partial<Artifact> & { id: string }): Artifact {
  return {
    versionGroupId: overrides.id,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Artifact',
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista de Gestión y Soporte',
    content: '',
    objective: '',
    keyConcepts: [],
    representation: 'document',
    ...overrides,
  } as Artifact;
}

function makeTemplate(overrides: Partial<ArtifactTemplate> & { name: string }): ArtifactTemplate {
  return {
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista de Gestión y Soporte',
    objective: '',
    keyConcepts: [],
    representation: 'document',
    ...overrides,
  } as ArtifactTemplate;
}

describe('getPhaseLabel', () => {
  it('maps roadmap phases to short labels', () => {
    expect(getPhaseLabel(PHASE_1)).toBe('Estrategia');
    expect(getPhaseLabel('Fase 2: Diseño Conceptual y Lógico')).toBe('Lógica');
    expect(getPhaseLabel(PHASE_3)).toBe('Física');
    expect(getPhaseLabel('Fase 4: Implementación y Operaciones')).toBe('Implementación');
    expect(getPhaseLabel('SDD: Especificación')).toBe('SDD');
  });

  it('falls back to General for unknown or empty phases', () => {
    expect(getPhaseLabel('General')).toBe('General');
    expect(getPhaseLabel('')).toBe('General');
  });
});

describe('getArtifactActivityDate', () => {
  it('returns the createdAt date when no richer field exists', () => {
    const artifact = makeArtifact({ id: 'a', createdAt: '2026-02-10T10:00:00.000Z' });
    expect(getArtifactActivityDate(artifact)?.toISOString()).toBe('2026-02-10T10:00:00.000Z');
  });

  it('prefers the most recent date across all candidate fields', () => {
    const artifact = makeArtifact({
      id: 'a',
      createdAt: '2026-01-01T00:00:00.000Z',
      generationTrace: {
        id: 't1',
        source: 'catalog',
        status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-03-15T09:30:00.000Z',
        decisions: [],
        errors: [],
      },
    });
    expect(getArtifactActivityDate(artifact)?.toISOString()).toBe('2026-03-15T09:30:00.000Z');
  });

  it('reports a 0 timestamp when no date is usable', () => {
    const artifact = makeArtifact({ id: 'a', createdAt: 'not-a-date' });
    expect(getArtifactActivityTimestamp(artifact)).toBe(0);
  });
});

describe('getLatestArtifact', () => {
  it('returns null for an empty list', () => {
    expect(getLatestArtifact([])).toBeNull();
  });

  it('selects the most recently created or modified artifact', () => {
    const older = makeArtifact({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = makeArtifact({ id: 'new', createdAt: '2026-04-01T00:00:00.000Z' });
    const middle = makeArtifact({ id: 'mid', createdAt: '2026-02-01T00:00:00.000Z' });
    expect(getLatestArtifact([older, newer, middle])?.id).toBe('new');
  });
});

describe('sortArtifacts', () => {
  const a = makeArtifact({ id: 'a', name: 'Gamma', type: 'yaml', version: 2, phase: PHASE_3, createdAt: '2026-01-03T00:00:00.000Z' });
  const b = makeArtifact({ id: 'b', name: 'alpha', type: 'markdown', version: 5, phase: PHASE_1, createdAt: '2026-01-01T00:00:00.000Z' });
  const c = makeArtifact({ id: 'c', name: 'Beta', type: 'markdown', version: 1, phase: 'General', createdAt: '2026-01-02T00:00:00.000Z' });
  const list = [a, b, c];

  it('does not mutate the input array', () => {
    const copy = [...list];
    sortArtifacts(list, 'name-asc');
    expect(list).toEqual(copy);
  });

  it('orders by most recent first by default', () => {
    expect(sortArtifacts(list, 'recent-desc').map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(sortArtifacts(list, DEFAULT_ARTIFACT_SORT).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('orders by oldest first', () => {
    expect(sortArtifacts(list, 'recent-asc').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders by name A-Z and Z-A case-insensitively', () => {
    expect(sortArtifacts(list, 'name-asc').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(sortArtifacts(list, 'name-desc').map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });

  it('orders by version descending', () => {
    expect(sortArtifacts(list, 'version-desc').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('orders by phase following the roadmap', () => {
    expect(sortArtifacts(list, 'phase').map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('orders by artifact type, breaking ties by name', () => {
    // b and c share type "markdown"; the tie resolves by name (alpha < Beta).
    expect(sortArtifacts(list, 'type').map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('sortTemplates', () => {
  const t1 = makeTemplate({ name: 'Gamma', type: 'yaml', phase: PHASE_3 });
  const t2 = makeTemplate({ name: 'alpha', type: 'markdown', phase: PHASE_1 });
  const t3 = makeTemplate({ name: 'Beta', type: 'markdown', phase: 'General' });
  const list = [t1, t2, t3];

  it('orders templates by name', () => {
    expect(sortTemplates(list, 'name-asc').map((x) => x.name)).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('orders templates by phase', () => {
    expect(sortTemplates(list, 'phase').map((x) => x.name)).toEqual(['alpha', 'Gamma', 'Beta']);
  });

  it('keeps the incoming order for artifact-only criteria', () => {
    expect(sortTemplates(list, 'recent-desc')).toEqual(list);
    expect(sortTemplates(list, 'version-desc')).toEqual(list);
  });

  it('orders templates by the AI-recommended roadmap sequence (phase → priority → name)', () => {
    const vision = makeTemplate({ name: 'Visión de la Arquitectura', phase: PHASE_1 });
    const principles = makeTemplate({ name: 'Principios de Arquitectura', phase: PHASE_1 });
    const apiContract = makeTemplate({ name: 'Contrato de API (OpenAPI)', phase: 'Fase 4: Implementación y Operaciones' });
    const ordered = sortTemplates([apiContract, principles, vision], 'ai-recommended').map((t) => t.name);
    // Vision (priority 10) comes before Principios (priority 20); both come
    // before phase-4 templates regardless of name.
    expect(ordered).toEqual([
      'Visión de la Arquitectura',
      'Principios de Arquitectura',
      'Contrato de API (OpenAPI)',
    ]);
  });
});

describe('ARTIFACT_SORT_OPTIONS', () => {
  it('exposes both default sort keys', () => {
    expect(ARTIFACT_SORT_OPTIONS.some((option) => option.key === DEFAULT_ARTIFACT_SORT)).toBe(true);
    expect(ARTIFACT_SORT_OPTIONS.some((option) => option.key === DEFAULT_TEMPLATE_SORT)).toBe(true);
  });

  it('flags which criteria apply to catalog templates', () => {
    const templateKeys = ARTIFACT_SORT_OPTIONS.filter((o) => o.appliesToTemplates).map((o) => o.key);
    expect(templateKeys).toEqual(['ai-recommended', 'phase', 'type', 'name-asc', 'name-desc']);
  });

  it('uses the AI-recommended sequence as the catalog default', () => {
    expect(DEFAULT_TEMPLATE_SORT).toBe('ai-recommended');
  });
});

describe('getArtifactOrigin', () => {
  it('reports catalog provenance when the trace says so', () => {
    const artifact = makeArtifact({
      id: 'a',
      generationTrace: {
        id: 't1', source: 'catalog', status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z', decisions: [], errors: [],
      },
    });
    const origin = getArtifactOrigin(artifact);
    expect(origin.kind).toBe('catalog');
    expect(origin.label).toBe('Catálogo');
  });

  it('reports on-demand provenance', () => {
    const artifact = makeArtifact({
      id: 'b',
      generationTrace: {
        id: 't2', source: 'on-demand', status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z', decisions: [], errors: [],
        request: { userRequest: 'algo' },
      },
    });
    expect(getArtifactOrigin(artifact).kind).toBe('on-demand');
  });

  it('reports regeneration when the trace says so', () => {
    const artifact = makeArtifact({
      id: 'c',
      generationTrace: {
        id: 't3', source: 'regeneration', status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z', decisions: [], errors: [],
      },
    });
    expect(getArtifactOrigin(artifact).kind).toBe('regeneration');
  });

  it('falls back to unknown when no trace is present', () => {
    const artifact = makeArtifact({ id: 'd' });
    expect(getArtifactOrigin(artifact).kind).toBe('unknown');
  });
});
