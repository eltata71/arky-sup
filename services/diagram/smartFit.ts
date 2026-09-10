/**
 * Smart fit-to-view for the diagram canvas.
 *
 * Symptom this fixes: in the field reports and iPad screenshots the diagram
 * frequently appeared as a tiny strip in one corner of an otherwise empty
 * canvas. Root cause: ReactFlow's plain `fitView({ padding: 0.15 })` honours
 * the content bbox to the letter. When the bbox is narrow (a vertical BPMN
 * strip) and the viewport is wide (iPad landscape), fitView ends up zooming
 * out aggressively so the content height fits — and the user sees a 10–15%
 * wide column on the left, surrounded by black space.
 *
 * Strategy here:
 *   1. Measure the *real* content bbox (excluding `groupZone` decorations).
 *   2. Compute the zoom level that would make it fit, with padding.
 *   3. Clamp to a comfortable readability window (default 0.45 → 1.35) so:
 *        - small/sparse diagrams stay legible (don't shrink below 0.45);
 *        - dense diagrams don't over-zoom (cap at 1.35).
 *   4. Center on the bbox centroid using `setCenter`, NOT fitView, so the
 *      clamp is actually honoured. fitView always recomputes its own zoom.
 *   5. Subtract the height taken by the bottom toolbar so the diagram is
 *      visually centred in the *visible* area, not the raw viewport.
 *
 * Pure, side-effect-free w.r.t. external state (only manipulates the
 * ReactFlow viewport). Exported as a thin function so the canvas component
 * can call it from useEffect/imperative handles uniformly.
 */

import type { Node, ReactFlowInstance, Viewport } from 'reactflow';
import { LAYOUT_PRESETS } from '../../lib/diagramTokens';

export interface SmartFitOptions {
    /** Fraction of viewport reserved as padding on each side. Default 0.10 (10%). */
    paddingFraction?: number;
    /** Hard lower bound on zoom. Anything smaller is too tiny to read on iPad. */
    minZoom?: number;
    /** Hard upper bound on zoom — anything larger looks pixelated. */
    maxZoom?: number;
    /** Animation duration in ms. 0 disables animation (useful for first paint). */
    duration?: number;
    /** Pixels reserved at the bottom for the toolbar. Default 96 (toolbar + margin). */
    bottomReserve?: number;
    /** Pixels reserved at the top (e.g. for a top toolbar). Default 16. */
    topReserve?: number;
}

const DEFAULT_OPTIONS: Required<SmartFitOptions> = {
    paddingFraction: 0.10,
    minZoom:         0.45,
    maxZoom:         1.35,
    duration:        400,
    bottomReserve:   96,
    topReserve:      16,
};

/** Filter out non-content nodes (group zones, presentation overlays). */
const isContentNode = (n: Node): boolean => n.type !== 'groupZone';

interface ContentBBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

/**
 * Compute the bounding box of the content nodes. Returns `null` when there
 * are no content nodes or when their positions are non-finite.
 *
 * Uses the `width` / `height` from each node when available, falling back to
 * the canonical flow preset (260 × 160) so sparse diagrams whose nodes were
 * grid-fallbacked still produce a sane bbox.
 */
export function computeContentBBox(nodes: Node[]): ContentBBox | null {
    const fallbackW = LAYOUT_PRESETS.flow.node.width;
    const fallbackH = LAYOUT_PRESETS.flow.node.height;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
        if (!isContentNode(node)) continue;
        const { x, y } = node.position ?? { x: NaN, y: NaN };
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const styleW = typeof node.style?.width === 'number' ? node.style.width : null;
        const styleH = typeof node.style?.height === 'number' ? node.style.height : null;
        const w = node.width ?? styleW ?? fallbackW;
        const h = node.height ?? styleH ?? fallbackH;

        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
    if (maxX <= minX || maxY <= minY) return null;

    const width = maxX - minX;
    const height = maxY - minY;
    return {
        minX, minY, maxX, maxY,
        width, height,
        centerX: minX + width / 2,
        centerY: minY + height / 2,
    };
}

/**
 * Compute the zoom level that would fit `bbox` into a viewport of
 * (`viewportW` × `viewportH`) with the requested padding, then clamp it to
 * the comfortable readability window. Pure function — easy to unit-test.
 */
export function computeFitZoom(
    bbox: ContentBBox,
    viewportW: number,
    viewportH: number,
    options: Required<SmartFitOptions>,
): number {
    const availableW = Math.max(120, viewportW * (1 - options.paddingFraction * 2));
    const availableH = Math.max(120, viewportH - options.topReserve - options.bottomReserve);
    if (bbox.width <= 0 || bbox.height <= 0) return options.maxZoom;

    const zoomX = availableW / bbox.width;
    const zoomY = availableH / bbox.height;
    const idealZoom = Math.min(zoomX, zoomY);

    // Clamp into the readability window. Values outside this window
    // produce diagrams that are either microscopic or pixelated.
    return Math.max(options.minZoom, Math.min(options.maxZoom, idealZoom));
}

/**
 * Compute the viewport (x, y, zoom) that centers `bbox` in the available
 * area while honouring the smart-fit clamp. Exported separately so call
 * sites that need to set viewport synchronously (e.g. before a `toPng`
 * export) can do so without hitting the animation queue.
 */
export function computeSmartFitViewport(
    bbox: ContentBBox,
    viewportW: number,
    viewportH: number,
    options: SmartFitOptions = {},
): Viewport {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const zoom = computeFitZoom(bbox, viewportW, viewportH, opts);

    // setCenter would do this math internally, but we re-implement it so the
    // computation is testable in isolation and so we can apply the
    // top/bottom reserve asymmetrically (the centroid moves up to leave room
    // for the bottom toolbar).
    const visibleCenterY = opts.topReserve + (viewportH - opts.topReserve - opts.bottomReserve) / 2;
    const x = viewportW / 2 - bbox.centerX * zoom;
    const y = visibleCenterY - bbox.centerY * zoom;
    return { x, y, zoom };
}

/**
 * Apply smart-fit to the supplied ReactFlow instance. Reads the rendered
 * container's `getBoundingClientRect` to know the real viewport size.
 * Returns the viewport actually applied so callers can log / test.
 *
 * Returns `null` when the canvas has no content yet — callers should treat
 * that as a no-op (and probably retry on the next frame).
 */
export function applySmartFit(
    rf: ReactFlowInstance,
    container: HTMLElement | null | undefined,
    options: SmartFitOptions = {},
): Viewport | null {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const nodes = rf.getNodes();
    const bbox = computeContentBBox(nodes);
    if (!bbox) return null;

    const rect = container?.getBoundingClientRect();
    const viewportW = rect?.width  ?? window.innerWidth  ?? 1024;
    const viewportH = rect?.height ?? window.innerHeight ??  768;
    if (viewportW < 80 || viewportH < 80) return null;

    const target = computeSmartFitViewport(bbox, viewportW, viewportH, opts);
    rf.setViewport(target, { duration: opts.duration });
    return target;
}
