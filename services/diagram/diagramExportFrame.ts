/**
 * Diagram export frame.
 *
 * Wraps a raw PNG/SVG data URL produced by ReactFlow with a professional
 * header / footer band so the exported image is presentable in an
 * executive committee or a technical review without extra editing:
 *
 *   ┌──────────────────────────────────────────┐
 *   │ HEADER   Title · Subtitle · Version       │
 *   ├──────────────────────────────────────────┤
 *   │                                          │
 *   │           [diagram contents]              │
 *   │                                          │
 *   ├──────────────────────────────────────────┤
 *   │ FOOTER   Leyenda · Fecha · Confidencial   │
 *   └──────────────────────────────────────────┘
 *
 * Pure-DOM implementation: uses an offscreen `<canvas>` to composite. The
 * caller (`ReactFlowCanvas.exportImage`) passes the raw image data URL
 * plus a `FrameMetadata` payload; the function returns a new data URL
 * with the frame applied.
 *
 * Falls back to the unframed input when the canvas API is unavailable
 * (SSR, jsdom in tests, etc.) so the export still works.
 */

export interface LegendEntry {
    /** Short label such as "Sincrónico (REST)". */
    label: string;
    /** Hex / rgba colour for the swatch. */
    color: string;
    /** Optional dash pattern; renders the swatch as a stroked line. */
    dash?: string;
}

export interface FrameMetadata {
    /** Diagram title (e.g. "Diagrama de Integración — PBM WeeCompany"). */
    title: string;
    /** Optional subtitle (e.g. archetype label). */
    subtitle?: string;
    /** Version label (e.g. "v1.2"). */
    version?: string;
    /** ISO date string; defaults to `new Date().toISOString()` when omitted. */
    date?: string;
    /** Confidentiality banner ("Uso interno", "Confidencial", "Público"…). */
    confidentiality?: string;
    /** Project / organization name. */
    owner?: string;
    /** Up to 8 legend entries. The frame trims excess. */
    legend?: LegendEntry[];
    /** Whether the source image already has a dark background. Defaults true. */
    isDark?: boolean;
}

export interface FrameOptions {
    /** Pixel ratio for the offscreen canvas. Matches the source export. */
    pixelRatio?: number;
    /** Maximum number of legend entries rendered in the footer band. */
    maxLegendEntries?: number;
}

const DEFAULT_OPTIONS: Required<FrameOptions> = {
    pixelRatio: 2,
    maxLegendEntries: 6,
};

const HEADER_HEIGHT = 72;
const FOOTER_HEIGHT = 88;
const SIDE_PADDING  = 32;
const BORDER_WIDTH  = 1;

// ---- Public helpers ------------------------------------------------------

/**
 * Compose a labelled frame around an existing data URL image.
 *
 * Returns the original `imageDataUrl` unchanged when:
 *   - `document` or `Image` are unavailable (SSR / jsdom),
 *   - the source image cannot be decoded.
 *
 * Synchronously returns a Promise so call-sites can `await` it next to the
 * existing `toPng()` calls.
 */
export async function applyExportFrame(
    imageDataUrl: string,
    metadata: FrameMetadata,
    options: FrameOptions = {},
): Promise<string> {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return imageDataUrl;
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const img = await loadImage(imageDataUrl).catch(() => null);
    if (!img) return imageDataUrl;

    const canvas = document.createElement('canvas');
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w <= 0 || h <= 0) return imageDataUrl;

    canvas.width  = w;
    canvas.height = h + (HEADER_HEIGHT + FOOTER_HEIGHT) * opts.pixelRatio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageDataUrl;

    // Background — match the source image tone so the band blends in.
    const isDark = metadata.isDark ?? true;
    ctx.fillStyle = isDark ? '#0b0b0f' : '#fafafa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const headerH = HEADER_HEIGHT * opts.pixelRatio;
    const footerH = FOOTER_HEIGHT * opts.pixelRatio;
    const sidePad = SIDE_PADDING  * opts.pixelRatio;

    drawHeader(ctx, canvas.width, headerH, sidePad, opts.pixelRatio, metadata, isDark);
    ctx.drawImage(img, 0, headerH, canvas.width, h);
    drawFooter(ctx, canvas.width, footerH, sidePad, opts.pixelRatio, metadata, opts.maxLegendEntries, isDark, headerH + h);
    drawBorders(ctx, canvas.width, canvas.height, opts.pixelRatio, isDark);

    return canvas.toDataURL('image/png');
}

// ---- Internal drawing ----------------------------------------------------

function loadImage(src: string, timeoutMs = 4000): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Defensive timeout: in jsdom (and on some real browsers with bad
        // data URLs) the Image element never fires onload or onerror, which
        // would otherwise hang the entire export pipeline.
        const timer = setTimeout(() => reject(new Error('image-load-timeout')), timeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = (e) => { clearTimeout(timer); reject(e); };
        img.src = src;
    });
}

function drawHeader(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    padX: number,
    pr: number,
    metadata: FrameMetadata,
    isDark: boolean,
): void {
    // Band background slightly darker / lighter than diagram surface.
    ctx.fillStyle = isDark ? '#13131a' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Title (large bold)
    ctx.fillStyle = isDark ? '#f1f5f9' : '#0f172a';
    ctx.font = `${18 * pr}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const title = metadata.title || 'Diagrama de arquitectura';
    ctx.fillText(title, padX, 20 * pr);

    // Subtitle (smaller, muted)
    if (metadata.subtitle) {
        ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
        ctx.font = `${11 * pr}px Inter, sans-serif`;
        ctx.fillText(metadata.subtitle, padX, 44 * pr);
    }

    // Right-aligned: owner + version
    ctx.textAlign = 'right';
    ctx.font = `${11 * pr}px Inter, sans-serif`;
    ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
    const right = width - padX;
    const ownerLine = metadata.owner ?? '';
    const versionLine = metadata.version ?? '';
    if (ownerLine) ctx.fillText(ownerLine, right, 20 * pr);
    if (versionLine) ctx.fillText(versionLine, right, 44 * pr);
}

function drawFooter(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    padX: number,
    pr: number,
    metadata: FrameMetadata,
    maxLegend: number,
    isDark: boolean,
    yTop: number,
): void {
    ctx.fillStyle = isDark ? '#13131a' : '#ffffff';
    ctx.fillRect(0, yTop, width, height);

    // Legend (left)
    const legend = (metadata.legend ?? []).slice(0, maxLegend);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let x = padX;
    const y = yTop + height / 2;
    ctx.font = `${10 * pr}px Inter, sans-serif`;
    ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
    for (const entry of legend) {
        // Swatch
        ctx.fillStyle = entry.color;
        const swatchSize = 10 * pr;
        if (entry.dash) {
            // Draw as a horizontal stroke pattern
            ctx.strokeStyle = entry.color;
            ctx.lineWidth = 2 * pr;
            const dash = entry.dash.split(/\s+/).map((n) => Number(n) * pr).filter(Number.isFinite);
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + 18 * pr, y);
            ctx.stroke();
            ctx.setLineDash([]);
            x += 22 * pr;
        } else {
            ctx.fillRect(x, y - swatchSize / 2, swatchSize, swatchSize);
            x += swatchSize + 6 * pr;
        }
        // Label
        ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
        ctx.fillText(entry.label, x, y);
        x += ctx.measureText(entry.label).width + 18 * pr;
        if (x > width - padX - 220 * pr) break; // avoid overlapping the right column
    }

    // Date + confidentiality (right)
    ctx.textAlign = 'right';
    const right = width - padX;
    const dateLine = formatDate(metadata.date ?? new Date().toISOString());
    ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
    ctx.font = `${10 * pr}px Inter, sans-serif`;
    ctx.fillText(dateLine, right, y - 8 * pr);
    if (metadata.confidentiality) {
        ctx.fillStyle = isDark ? '#fcd34d' : '#b45309';
        ctx.font = `${10 * pr}px Inter, sans-serif`;
        ctx.fillText(metadata.confidentiality, right, y + 8 * pr);
    }
}

function drawBorders(ctx: CanvasRenderingContext2D, w: number, h: number, pr: number, isDark: boolean): void {
    ctx.strokeStyle = isDark ? '#27272a' : '#e5e7eb';
    ctx.lineWidth = BORDER_WIDTH * pr;
    ctx.strokeRect(0, 0, w, h);
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Convenience: given a DiagramIR, produce a default `FrameMetadata` with
 * the title, audience subtitle, current date and a legend derived from
 * the relation types actually present.
 *
 * Caller can spread this and override fields.
 */
/**
 * Gap 12 — SVG-flavoured frame. Wraps an SVG data URL (data:image/svg+xml,…)
 * with a header / footer band rendered as native SVG elements so vector
 * editors (Illustrator, Inkscape, Figma) can re-style or re-translate the
 * frame text. Returns the original input unchanged when:
 *   - the input cannot be decoded as SVG (we fall back to no-frame),
 *   - the runtime lacks `atob` / `btoa` (jsdom in older nodes).
 *
 * The visual layout mirrors the PNG frame so PNG / SVG exports look the
 * same.
 */
export async function applySvgExportFrame(
    svgDataUrl: string,
    metadata: FrameMetadata,
): Promise<string> {
    if (typeof atob === 'undefined' || typeof btoa === 'undefined') return svgDataUrl;
    const match = svgDataUrl.match(/^data:image\/svg\+xml(?:;charset=[^,;]+)?(;base64)?,(.*)$/);
    if (!match) return svgDataUrl;
    const isBase64 = !!match[1];
    const body = match[2];
    let svgText: string;
    try {
        svgText = isBase64 ? atob(body) : decodeURIComponent(body);
    } catch {
        return svgDataUrl;
    }

    const widthMatch = svgText.match(/<svg[^>]*\bwidth="([\d.]+)"/);
    const heightMatch = svgText.match(/<svg[^>]*\bheight="([\d.]+)"/);
    const innerWidth = widthMatch ? Number(widthMatch[1]) : 1200;
    const innerHeight = heightMatch ? Number(heightMatch[1]) : 800;
    const headerH = HEADER_HEIGHT;
    const footerH = FOOTER_HEIGHT;
    const isDark = metadata.isDark ?? true;
    const fillBg = isDark ? '#0b0b0f' : '#fafafa';
    const fillBand = isDark ? '#13131a' : '#ffffff';
    const fgTitle = isDark ? '#f1f5f9' : '#0f172a';
    const fgMuted = isDark ? '#94a3b8' : '#475569';
    const borderC = isDark ? '#27272a' : '#e5e7eb';

    const totalH = innerHeight + headerH + footerH;
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const headerTitle = escape(metadata.title || 'Diagrama de arquitectura');
    const subtitle = metadata.subtitle ? escape(metadata.subtitle) : '';
    const owner = metadata.owner ? escape(metadata.owner) : '';
    const version = metadata.version ? escape(metadata.version) : '';
    const dateStr = formatDate(metadata.date ?? new Date().toISOString());
    const confidentiality = metadata.confidentiality ? escape(metadata.confidentiality) : '';
    const legendEntries = (metadata.legend ?? []).slice(0, 6);

    // Strip the outer <svg ...> opening tag and re-emit it inside a wrapper.
    const innerSvg = svgText.replace(/<\?xml[^?]*\?>/, '').trim();

    let legendOffsetX = SIDE_PADDING;
    const legendSvg = legendEntries.map((entry) => {
        const swatchY = innerHeight + headerH + footerH / 2 - 6;
        let chunk: string;
        if (entry.dash) {
            chunk = `<line x1="${legendOffsetX}" y1="${innerHeight + headerH + footerH / 2}" x2="${legendOffsetX + 22}" y2="${innerHeight + headerH + footerH / 2}" stroke="${entry.color}" stroke-width="2" stroke-dasharray="${escape(entry.dash)}" />`;
            legendOffsetX += 28;
        } else {
            chunk = `<rect x="${legendOffsetX}" y="${swatchY}" width="12" height="12" fill="${entry.color}" />`;
            legendOffsetX += 18;
        }
        chunk += `<text x="${legendOffsetX}" y="${innerHeight + headerH + footerH / 2 + 4}" fill="${fgMuted}" font-size="11" font-family="Inter, sans-serif">${escape(entry.label)}</text>`;
        legendOffsetX += entry.label.length * 6 + 18;
        return chunk;
    }).join('\n');

    const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${totalH}" viewBox="0 0 ${innerWidth} ${totalH}">
  <rect x="0" y="0" width="${innerWidth}" height="${totalH}" fill="${fillBg}" />
  <rect x="0" y="0" width="${innerWidth}" height="${headerH}" fill="${fillBand}" />
  <text x="${SIDE_PADDING}" y="32" fill="${fgTitle}" font-size="18" font-weight="600" font-family="Inter, sans-serif">${headerTitle}</text>
  ${subtitle ? `<text x="${SIDE_PADDING}" y="55" fill="${fgMuted}" font-size="11" font-family="Inter, sans-serif">${subtitle}</text>` : ''}
  ${owner ? `<text x="${innerWidth - SIDE_PADDING}" y="32" fill="${fgMuted}" font-size="11" font-family="Inter, sans-serif" text-anchor="end">${owner}</text>` : ''}
  ${version ? `<text x="${innerWidth - SIDE_PADDING}" y="55" fill="${fgMuted}" font-size="11" font-family="Inter, sans-serif" text-anchor="end">${version}</text>` : ''}
  <g transform="translate(0, ${headerH})">
    ${innerSvg}
  </g>
  <rect x="0" y="${innerHeight + headerH}" width="${innerWidth}" height="${footerH}" fill="${fillBand}" />
  ${legendSvg}
  <text x="${innerWidth - SIDE_PADDING}" y="${innerHeight + headerH + footerH / 2 - 4}" fill="${fgMuted}" font-size="10" font-family="Inter, sans-serif" text-anchor="end">${dateStr}</text>
  ${confidentiality ? `<text x="${innerWidth - SIDE_PADDING}" y="${innerHeight + headerH + footerH / 2 + 12}" fill="${isDark ? '#fcd34d' : '#b45309'}" font-size="10" font-family="Inter, sans-serif" text-anchor="end">${confidentiality}</text>` : ''}
  <rect x="0.5" y="0.5" width="${innerWidth - 1}" height="${totalH - 1}" fill="none" stroke="${borderC}" stroke-width="1" />
</svg>`;
    const encoded = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(wrapper))) : null;
    return encoded ? `data:image/svg+xml;base64,${encoded}` : svgDataUrl;
}

export function defaultFrameMetadataFromIR(
    ir: { metadata?: { title?: string; audience?: string; theme?: string }; edges: Array<{ relation?: string }> },
    options: { owner?: string; version?: string; confidentiality?: string; isDark?: boolean } = {},
): FrameMetadata {
    const presentRelations = new Set(ir.edges.map((e) => e.relation ?? 'default'));
    const legend: LegendEntry[] = [];
    const legendByRelation: Record<string, LegendEntry> = {
        sync:        { label: 'Sincrónico (REST)',           color: '#6366f1' },
        async:       { label: 'Asíncrono (evento)',          color: '#f59e0b', dash: '6 4' },
        'data-flow': { label: 'Flujo de datos',              color: '#06b6d4' },
        dependency:  { label: 'Dependencia',                 color: '#94a3b8', dash: '4 4' },
        inheritance: { label: 'Composición / herencia',      color: '#8b5cf6' },
        default:     { label: 'Relación',                    color: '#475569' },
    };
    for (const relation of presentRelations) {
        const entry = legendByRelation[relation];
        if (entry) legend.push(entry);
    }

    return {
        title: ir.metadata?.title ?? 'Diagrama de arquitectura',
        subtitle: ir.metadata?.audience
            ? `Audiencia ${ir.metadata.audience} · Tema ${ir.metadata.theme ?? 'editorial'}`
            : undefined,
        version: options.version,
        date: new Date().toISOString(),
        owner: options.owner,
        confidentiality: options.confidentiality,
        legend,
        isDark: options.isDark ?? true,
    };
}
