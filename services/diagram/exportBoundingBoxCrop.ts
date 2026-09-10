/**
 * Bounding-box export cropper.
 *
 * Gap 2 — the legacy export captured `.react-flow` at the user's current
 * zoom which produced two failure modes:
 *   - excessive empty space on the sides when the canvas aspect ratio did
 *     not match the content;
 *   - cropped labels / boundaries when the user had scrolled or zoomed in.
 *
 * `fitBounds` already centres the bbox before capture, but the resulting
 * image still contains the full viewport rectangle. The functions below
 * post-process the captured raster (PNG) or vector (SVG) so the output
 * is tight around the real content, with a configurable professional
 * padding, ready for the export-frame composition step.
 *
 * Pure / synchronous-ish — the PNG path needs the browser `Image`
 * decoder, but every API is null-safe and degrades to returning the
 * input unchanged when DOM primitives are unavailable (SSR, jsdom).
 */

export interface CropRectPx {
    /** Screen-space top-left x (in pixels, before scale). */
    x: number;
    /** Screen-space top-left y (in pixels, before scale). */
    y: number;
    width: number;
    height: number;
}

export interface BoundingBoxFromNodesOptions {
    /** Container element used to convert client rects into local space. */
    container: HTMLElement;
    /** Selector for nodes to include in the bbox. Defaults to `.react-flow__node`. */
    selector?: string;
    /** Selector for group/boundary rects to also include. */
    groupSelector?: string;
    /** Padding in CSS pixels around the bbox. Defaults to 48. */
    paddingPx?: number;
}

/**
 * Compute the bounding rectangle of all node DOM elements relative to
 * the supplied container, in *unscaled* container-local pixels. Returns
 * `null` when no nodes are present or the container is invisible.
 */
export function computeNodeBoundingRect(opts: BoundingBoxFromNodesOptions): CropRectPx | null {
    const { container, selector = '.react-flow__node', groupSelector = '.react-flow__node-groupZone', paddingPx = 48 } = opts;
    const containerRect = container.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0) return null;
    const nodes = container.querySelectorAll(selector);
    const groups = container.querySelectorAll(groupSelector);
    if (nodes.length === 0 && groups.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const consume = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const localLeft   = r.left   - containerRect.left;
        const localTop    = r.top    - containerRect.top;
        const localRight  = r.right  - containerRect.left;
        const localBottom = r.bottom - containerRect.top;
        if (localLeft < minX) minX = localLeft;
        if (localTop < minY) minY = localTop;
        if (localRight > maxX) maxX = localRight;
        if (localBottom > maxY) maxY = localBottom;
    };
    nodes.forEach(consume);
    groups.forEach(consume);
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    // Pad and clamp to the container.
    const padded = {
        x: Math.max(0, Math.floor(minX - paddingPx)),
        y: Math.max(0, Math.floor(minY - paddingPx)),
        width: 0,
        height: 0,
    };
    padded.width  = Math.min(containerRect.width  - padded.x, Math.ceil((maxX - minX) + paddingPx * 2));
    padded.height = Math.min(containerRect.height - padded.y, Math.ceil((maxY - minY) + paddingPx * 2));
    if (padded.width <= 0 || padded.height <= 0) return null;
    return padded;
}

export interface CropPngOptions {
    /** Crop rectangle in CSS pixels (pre-scale). */
    cropPx: CropRectPx;
    /**
     * pixelRatio used when the source PNG was captured. The crop area
     * needs to be multiplied by this factor when slicing the bitmap.
     */
    pixelRatio: number;
    /** Optional background fill (defaults to transparent). */
    backgroundColor?: string;
}

/**
 * Re-encode a PNG data URL cropped to `cropPx` (in CSS pixels) preserving
 * `pixelRatio` so the final raster keeps the original sharpness. Returns
 * the input unchanged when the DOM primitives required to perform the
 * crop (Image, canvas 2D) are unavailable — the export contract never
 * regresses.
 */
export async function cropPngToBoundingBox(dataUrl: string, opts: CropPngOptions): Promise<string> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;
    if (opts.cropPx.width <= 0 || opts.cropPx.height <= 0) return dataUrl;
    const img = await loadImage(dataUrl);
    const pr = Math.max(1, opts.pixelRatio || 1);
    const sourceX = Math.max(0, Math.round(opts.cropPx.x * pr));
    const sourceY = Math.max(0, Math.round(opts.cropPx.y * pr));
    const sourceW = Math.min(img.naturalWidth  - sourceX, Math.round(opts.cropPx.width  * pr));
    const sourceH = Math.min(img.naturalHeight - sourceY, Math.round(opts.cropPx.height * pr));
    if (sourceW <= 0 || sourceH <= 0) return dataUrl;
    const canvas = document.createElement('canvas');
    canvas.width = sourceW;
    canvas.height = sourceH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    if (opts.backgroundColor) {
        ctx.fillStyle = opts.backgroundColor;
        ctx.fillRect(0, 0, sourceW, sourceH);
    }
    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, sourceW, sourceH);
    return canvas.toDataURL('image/png');
}

/**
 * Tighten the viewBox of a captured SVG so the exported vector shows
 * only the bounding-box area. We never touch the inner geometry — only
 * the root `<svg>` `width`, `height`, and `viewBox` attributes. Returns
 * the input unchanged when the SVG cannot be parsed.
 */
export function cropSvgToBoundingBox(svgString: string, cropPx: CropRectPx): string {
    if (cropPx.width <= 0 || cropPx.height <= 0) return svgString;
    if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svgString;
    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    } catch {
        return svgString;
    }
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return svgString;
    const x = Math.max(0, Math.round(cropPx.x));
    const y = Math.max(0, Math.round(cropPx.y));
    const w = Math.round(cropPx.width);
    const h = Math.round(cropPx.height);
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    return new XMLSerializer().serializeToString(svg);
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
    });
}
