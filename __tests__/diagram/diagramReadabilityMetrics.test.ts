import { describe, expect, it } from 'vitest';
import { analyzeLayoutReadability, scoreLayoutDensity } from '../../services/diagram/diagramReadabilityMetrics';
import type { LayoutQualityMetrics } from '../../services/diagram/layoutQualityService';

const base: LayoutQualityMetrics = {
  hasLayout: true,
  nodeCount: 5,
  boundingBox: { x: 0, y: 0, width: 1000, height: 700 },
  aspectRatio: 1.2,
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

describe('diagramReadabilityMetrics', () => {
  it('scores healthy layouts high', () => {
    expect(scoreLayoutDensity(base)).toBeGreaterThan(80);
  });

  it('recommends infinite-canvas exploration when content is out of viewport', () => {
    const result = analyzeLayoutReadability({
      ...base,
      nodesOutsideViewport: ['n-1'],
      aspectStrip: 'horizontal',
    });
    expect(result.recommendedMode).toBe('infinite-canvas');
    expect(result.recommendedActions).toContain('ENABLE_INFINITE_CANVAS_EXPLORATION');
  });
});

