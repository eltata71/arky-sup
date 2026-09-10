import { describe, expect, it } from 'vitest';
import { buildInfiniteCanvasState, shouldExpandCanvas } from '../../services/diagram/infiniteCanvasService';

describe('infiniteCanvasService', () => {
  it('expands logical bounds when content overflows viewport', () => {
    const state = buildInfiniteCanvasState(
      { minX: 0, minY: 0, maxX: 1000, maxY: 600 },
      { minX: -200, minY: -50, maxX: 1500, maxY: 1200 },
    );
    expect(state.logicalCanvasBounds.minX).toBeLessThanOrEqual(-200);
    expect(state.logicalCanvasBounds.maxY).toBeGreaterThanOrEqual(1200);
    expect(shouldExpandCanvas(state)).toBe(true);
  });
});
