import { describe, expect, it } from 'vitest';
import { buildLayoutRetryPlan } from '../../services/diagram/layoutRetryPlanner';
import type { LayoutQualityMetrics } from '../../services/diagram/layoutQualityService';

const base: LayoutQualityMetrics = {
  hasLayout: true,
  nodeCount: 10,
  boundingBox: { x: 0, y: 0, width: 1200, height: 700 },
  aspectRatio: 1.7,
  density: 0.2,
  overlappingNodePairs: [],
  edgeLabelCollisions: [],
  overflowingLabels: [],
  edgeCrossings: 2,
  aspectStrip: null,
  exportCropRisk: 'none',
  overlappingGroupPairs: [],
  boundaryContainmentBreaches: [],
  nodesOutsideViewport: [],
  edgesCrossingNodes: [],
  nodesObscuredByObstacles: [],
  excessiveEmptySpace: false,
  exportClipRisk: false,
};

describe('layoutRetryPlanner', () => {
  it('builds multi-step retry plan for dense and crossing-heavy layouts', () => {
    const plan = buildLayoutRetryPlan({
      ...base,
      density: 0.6,
      edgeCrossings: 16,
    });
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.some((p) => p.mode === 'spacious')).toBe(true);
    expect(plan.some((p) => p.direction === 'TB')).toBe(true);
  });

  it('suggests section split for extreme visual complexity', () => {
    const plan = buildLayoutRetryPlan({
      ...base,
      edgeCrossings: 30,
      overlappingGroupPairs: [
        { a: 'g1', b: 'g2' },
        { a: 'g3', b: 'g4' },
        { a: 'g5', b: 'g6' },
      ],
    });
    expect(plan.some((p) => p.splitIntoSections)).toBe(true);
  });
});
