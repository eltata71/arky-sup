/**
 * Mermaid → PNG rasterizer for export adapters (PPTX embeds, future PDF
 * images).
 *
 * Runs entirely in the browser: mermaid renders the code to SVG, the SVG is
 * drawn on a canvas at @2x and re-encoded as PNG bytes. Every step is
 * defensive — in non-browser environments (jsdom tests) or when mermaid
 * rejects the code, the function resolves `null` and the caller falls back
 * to the legacy text representation, so an export can never fail because a
 * diagram refused to rasterize.
 */

export interface RasterizedDiagram {
    pngBytes: Uint8Array;
    /** Intrinsic pixel size of the rasterized image. */
    width: number;
    height: number;
}

const RASTER_SCALE = 2;
const MAX_DIMENSION_PX = 4096;
const RENDER_TIMEOUT_MS = 8000;

let renderCounter = 0;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`mermaid render timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
};

function parseSvgDimensions(svg: string): { width: number; height: number } {
    const viewBox = /viewBox="([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
    if (viewBox) {
        const w = Number(viewBox[3]);
        const h = Number(viewBox[4]);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
    }
    const widthAttr = /\bwidth="([\d.]+)(?:px)?"/.exec(svg);
    const heightAttr = /\bheight="([\d.]+)(?:px)?"/.exec(svg);
    const w = Number(widthAttr?.[1]);
    const h = Number(heightAttr?.[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
    return { width: 960, height: 540 };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function svgToPng(svg: string, background: string): Promise<RasterizedDiagram | null> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    const dims = parseSvgDimensions(svg);
    const scale = Math.min(
        RASTER_SCALE,
        MAX_DIMENSION_PX / Math.max(dims.width, dims.height, 1),
    );
    const width = Math.max(1, Math.round(dims.width * scale));
    const height = Math.max(1, Math.round(dims.height * scale));

    // Ensure the SVG carries explicit dimensions so drawImage scales cleanly.
    const sized = svg.replace(
        /<svg /,
        `<svg width="${dims.width}" height="${dims.height}" `,
    );
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;

    const image = await new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = svgUrl;
    });
    if (!image) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    let dataUrl: string;
    try {
        dataUrl = canvas.toDataURL('image/png');
    } catch {
        return null; // canvas tainted or unsupported (jsdom)
    }
    if (!dataUrl.startsWith('data:image/png')) return null;
    const pngBytes = dataUrlToBytes(dataUrl);
    if (pngBytes.length < 100) return null; // jsdom stub canvases emit ~empty data
    return { pngBytes, width, height };
}

/**
 * Rasterize Mermaid source to PNG bytes. Resolves `null` (never throws) when
 * the environment cannot render — callers keep their text fallback.
 */
export async function rasterizeMermaidToPng(
    code: string,
    opts: { background?: string } = {},
): Promise<RasterizedDiagram | null> {
    const trimmed = (code ?? '').trim();
    if (!trimmed) return null;
    if (typeof document === 'undefined') return null;
    // jsdom and other non-layout DOMs expose `document` but lack the SVG
    // geometry API Mermaid requires. Fail fast before the expensive dynamic
    // import; under a parallel full suite that import can otherwise exhaust
    // the test timeout before Mermaid reaches its own render timeout.
    if (typeof SVGGraphicsElement === 'undefined' || typeof SVGGraphicsElement.prototype.getBBox !== 'function') return null;
    try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'neutral',
            fontFamily: 'Inter, sans-serif',
        });
        renderCounter += 1;
        const { svg } = await withTimeout(
            mermaid.render(`export-raster-${Date.now().toString(36)}-${renderCounter}`, trimmed),
            RENDER_TIMEOUT_MS,
        );
        if (!svg || !svg.includes('<svg')) return null;
        return await svgToPng(svg, opts.background ?? '#ffffff');
    } catch (err) {
        console.warn('[mermaidRaster] rasterization failed; export keeps text fallback.', err);
        return null;
    }
}
