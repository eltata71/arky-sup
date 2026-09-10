export interface RectBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface InfiniteCanvasState {
  visibleViewport: RectBounds;
  contentBounds: RectBounds;
  logicalCanvasBounds: RectBounds;
  safeInteractionBounds: RectBounds;
  exportBounds: RectBounds;
}

const pad = (b: RectBounds, p: number): RectBounds => ({ minX: b.minX - p, minY: b.minY - p, maxX: b.maxX + p, maxY: b.maxY + p });

export const buildInfiniteCanvasState = (
  visibleViewport: RectBounds,
  contentBounds: RectBounds,
  previous?: InfiniteCanvasState,
): InfiniteCanvasState => {
  const padded = pad(contentBounds, 240);
  const base = previous?.logicalCanvasBounds ?? visibleViewport;
  const logicalCanvasBounds: RectBounds = {
    minX: Math.min(base.minX, padded.minX),
    minY: Math.min(base.minY, padded.minY),
    maxX: Math.max(base.maxX, padded.maxX),
    maxY: Math.max(base.maxY, padded.maxY),
  };

  return {
    visibleViewport,
    contentBounds,
    logicalCanvasBounds,
    safeInteractionBounds: pad(logicalCanvasBounds, 120),
    exportBounds: pad(contentBounds, 48),
  };
};

export const shouldExpandCanvas = (state: InfiniteCanvasState): boolean => {
  const { contentBounds, visibleViewport } = state;
  return (
    contentBounds.minX < visibleViewport.minX
    || contentBounds.minY < visibleViewport.minY
    || contentBounds.maxX > visibleViewport.maxX
    || contentBounds.maxY > visibleViewport.maxY
  );
};
