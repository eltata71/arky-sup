import type { Node } from 'reactflow';
import { computeContentBBox, computeSmartFitViewport, type SmartFitOptions } from './smartFit';

export interface SmartViewportContext {
  viewportWidth: number;
  viewportHeight: number;
  hasFloatingPanels?: boolean;
  iPadMode?: boolean;
}

export interface SmartViewportDecision {
  viewport: { x: number; y: number; zoom: number } | null;
  showExploreHint: boolean;
  showViewAllSecondary: boolean;
  readable: boolean;
  reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
}

export function computeSmartViewportDecision(nodes: Node[], ctx: SmartViewportContext, options: SmartFitOptions = {}): SmartViewportDecision {
  const bbox = computeContentBBox(nodes);
  if (!bbox) return { viewport: null, showExploreHint: false, showViewAllSecondary: false, readable: true, reason: 'ok' };

  const topReserve = (options.topReserve ?? 16) + (ctx.hasFloatingPanels ? 36 : 0);
  const bottomReserve = (options.bottomReserve ?? 96) + (ctx.iPadMode ? 24 : 0);
  const viewport = computeSmartFitViewport(bbox, ctx.viewportWidth, ctx.viewportHeight, { ...options, topReserve, bottomReserve });
  const minZoom = options.minZoom ?? 0.45;
  const minNodeWidthPx = ctx.iPadMode ? 120 : 104;
  const minNodeHeightPx = ctx.iPadMode ? 54 : 46;
  const minLabelFontPx = ctx.iPadMode ? 12 : 11;

  const contentNodes = nodes.filter((n) => n.type !== 'groupZone');
  const smallestNodePx = contentNodes.reduce((acc, node) => {
    const w = (node.width ?? 260) * viewport.zoom;
    const h = (node.height ?? 160) * viewport.zoom;
    return {
      width: Math.min(acc.width, w),
      height: Math.min(acc.height, h),
    };
  }, { width: Infinity, height: Infinity });

  const longestLabel = contentNodes.reduce((acc, node) => {
    const label = String((node.data as { label?: string } | undefined)?.label ?? '');
    return Math.max(acc, label.trim().length);
  }, 0);
  // Heurística simple: a mayor longitud de label, mayor tamaño visual mínimo.
  const estimatedLabelPx = (longestLabel > 28 ? 13 : longestLabel > 16 ? 12 : 11) * viewport.zoom;

  const zoomReadable = viewport.zoom >= minZoom;
  const nodeReadable = smallestNodePx.width >= minNodeWidthPx && smallestNodePx.height >= minNodeHeightPx;
  const labelReadable = estimatedLabelPx >= minLabelFontPx;
  const readable = zoomReadable && nodeReadable && labelReadable;
  const reason: SmartViewportDecision['reason'] = !zoomReadable
    ? 'zoom-too-low'
    : !nodeReadable
      ? 'node-too-small'
      : !labelReadable
        ? 'label-too-small'
        : 'ok';

  return {
    viewport,
    readable,
    showExploreHint: bbox.width > ctx.viewportWidth || bbox.height > ctx.viewportHeight,
    showViewAllSecondary: !readable || bbox.width > ctx.viewportWidth * 1.5 || bbox.height > ctx.viewportHeight * 1.5,
    reason,
  };
}
