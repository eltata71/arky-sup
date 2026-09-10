import { describe, expect, it } from 'vitest';
import { selectFallbackPlan, selectLayoutPlan } from '../../lib/layoutSelector';
import type { DiagramIR } from '../../lib/diagram';

/**
 * Recomendación 3: when a user applied a density / direction override via
 * the Visual Quality Gate's auto-actions, the override is persisted on
 * `metadata.layoutPlan.userOverride=true`. The async ELK selector honours
 * it; the synchronous dagre fallback used to drop it because it built a
 * fresh LayoutPlan literal. These tests pin the contract.
 */

const buildIR = (override: Partial<NonNullable<DiagramIR['metadata']>['layoutPlan']> = {}): DiagramIR => ({
  nodes: [
    { id: 'a', label: 'A', kind: 'service' },
    { id: 'b', label: 'B', kind: 'service' },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b', label: 'r' }],
  groups: [],
  metadata: {
    diagramType: 'integration',
    layoutPlan: {
      backend: 'elk',
      algorithm: 'layered',
      direction: 'TB',
      density: 'spacious',
      orthogonal: true,
      rationale: 'user override',
      computedAt: '2026-01-01T00:00:00.000Z',
      userOverride: true,
      ...override,
    },
  },
});

describe('selectFallbackPlan — userOverride preservation', () => {
  it('preserves userOverride=true when the original plan was an ELK plan with an override', () => {
    const ir = buildIR();
    const primary = selectLayoutPlan({ ir });
    expect(primary.userOverride).toBe(true);

    const fallback = selectFallbackPlan({ ir });
    expect(fallback.backend).toBe('dagre');
    expect(fallback.userOverride).toBe(true);
    // The override-chosen direction/density must survive too.
    expect(fallback.direction).toBe('TB');
    expect(fallback.density).toBe('spacious');
  });

  it('does not invent a userOverride when none was persisted', () => {
    const ir: DiagramIR = {
      nodes: [{ id: 'a', label: 'A', kind: 'service' }],
      edges: [],
      groups: [],
      metadata: { diagramType: 'c4-container' },
    };
    const fallback = selectFallbackPlan({ ir });
    expect(fallback.userOverride).toBeFalsy();
  });

  it('keeps the override across direction and density when ELK is bypassed', () => {
    const ir = buildIR({ direction: 'LR', density: 'compact' });
    const fallback = selectFallbackPlan({ ir });
    expect(fallback.direction).toBe('LR');
    expect(fallback.density).toBe('compact');
    expect(fallback.userOverride).toBe(true);
  });
});
