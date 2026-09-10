/**
 * Canonical diagram design tokens. Single source of truth for every downstream
 * renderer: CustomNode (ReactFlow), ExcalidrawViewer, LucidchartViewer, PDF
 * export and AI prompts describing visual defaults.
 *
 *  - Do NOT add colours inline in components.
 *  - Do NOT duplicate these scales in AI prompts — import the palette instead.
 */

import { resolveSemanticRole as resolveSemanticRoleImpl } from './semanticRoleResolver';

export type SemanticRole =
    | 'person'
    | 'system'
    | 'gateway'
    | 'data'
    | 'messaging'
    | 'external'
    | 'service'
    | 'process'
    | 'generic';

export interface SemanticPalette {
    bg: string;
    stroke: string;
    text: string;
    shadow: string;
    accent: string;
}

export interface ModePalette {
    person: SemanticPalette;
    system: SemanticPalette;
    gateway: SemanticPalette;
    data: SemanticPalette;
    messaging: SemanticPalette;
    external: SemanticPalette;
    service: SemanticPalette;
    process: SemanticPalette;
    generic: SemanticPalette;
}

export const DIAGRAM_TOKENS: { light: ModePalette; dark: ModePalette } = {
    light: {
        person:    { bg: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a', shadow: 'rgba(37,99,235,0.14)',  accent: '#3b82f6' },
        system:    { bg: '#e0e7ff', stroke: '#4338ca', text: '#1e1b4b', shadow: 'rgba(67,56,202,0.16)',  accent: '#6366f1' },
        gateway:   { bg: '#ede9fe', stroke: '#7c3aed', text: '#4c1d95', shadow: 'rgba(124,58,237,0.14)', accent: '#8b5cf6' },
        data:      { bg: '#d1fae5', stroke: '#059669', text: '#064e3b', shadow: 'rgba(5,150,105,0.14)',  accent: '#10b981' },
        messaging: { bg: '#fef9c3', stroke: '#ca8a04', text: '#713f12', shadow: 'rgba(202,138,4,0.14)',  accent: '#eab308' },
        external:  { bg: '#e0f2fe', stroke: '#0284c7', text: '#0c4a6e', shadow: 'rgba(2,132,199,0.14)',  accent: '#0ea5e9' },
        service:   { bg: '#eef2ff', stroke: '#4f46e5', text: '#312e81', shadow: 'rgba(79,70,229,0.14)',  accent: '#6366f1' },
        process:   { bg: '#fce7f3', stroke: '#db2777', text: '#831843', shadow: 'rgba(219,39,119,0.14)', accent: '#ec4899' },
        generic:   { bg: '#f1f5f9', stroke: '#64748b', text: '#334155', shadow: 'rgba(100,116,139,0.14)',accent: '#94a3b8' },
    },
    dark: {
        person:    { bg: '#1e3a5f', stroke: '#60a5fa', text: '#dbeafe', shadow: 'rgba(96,165,250,0.28)', accent: '#60a5fa' },
        system:    { bg: '#1e1b4b', stroke: '#a5b4fc', text: '#e0e7ff', shadow: 'rgba(165,180,252,0.28)',accent: '#818cf8' },
        gateway:   { bg: '#2e1065', stroke: '#c084fc', text: '#ede9fe', shadow: 'rgba(192,132,252,0.28)',accent: '#a78bfa' },
        data:      { bg: '#064e3b', stroke: '#34d399', text: '#d1fae5', shadow: 'rgba(52,211,153,0.28)', accent: '#34d399' },
        messaging: { bg: '#3b2200', stroke: '#fcd34d', text: '#fef9c3', shadow: 'rgba(252,211,77,0.28)', accent: '#facc15' },
        external:  { bg: '#0c4a6e', stroke: '#38bdf8', text: '#e0f2fe', shadow: 'rgba(56,189,248,0.28)', accent: '#38bdf8' },
        service:   { bg: '#1e1b4b', stroke: '#818cf8', text: '#e0e7ff', shadow: 'rgba(129,140,248,0.28)',accent: '#818cf8' },
        process:   { bg: '#500724', stroke: '#f472b6', text: '#fce7f3', shadow: 'rgba(244,114,182,0.28)',accent: '#f472b6' },
        generic:   { bg: '#1e293b', stroke: '#94a3b8', text: '#f1f5f9', shadow: 'rgba(148,163,184,0.28)',accent: '#cbd5e1' },
    },
};

export const EDGE_TOKENS = {
    light: {
        sync:        { stroke: '#4338ca', strokeWidth: 2,   dash: undefined as string | undefined },
        async:       { stroke: '#ca8a04', strokeWidth: 2,   dash: '6 4' },
        'data-flow': { stroke: '#059669', strokeWidth: 2.5, dash: undefined },
        dependency:  { stroke: '#64748b', strokeWidth: 1.5, dash: '2 3' },
        inheritance: { stroke: '#7c3aed', strokeWidth: 2,   dash: undefined },
        default:     { stroke: '#475569', strokeWidth: 1.8, dash: undefined },
    },
    dark: {
        sync:        { stroke: '#818cf8', strokeWidth: 2,   dash: undefined as string | undefined },
        async:       { stroke: '#facc15', strokeWidth: 2,   dash: '6 4' },
        'data-flow': { stroke: '#34d399', strokeWidth: 2.5, dash: undefined },
        dependency:  { stroke: '#94a3b8', strokeWidth: 1.5, dash: '2 3' },
        inheritance: { stroke: '#c084fc', strokeWidth: 2,   dash: undefined },
        default:     { stroke: '#cbd5e1', strokeWidth: 1.8, dash: undefined },
    },
};

/**
 * Arrowhead (marker) tokens. Default arrows are `arrowclosed` for clarity;
 * inheritance uses an open triangle to mirror UML conventions; data-flow
 * uses a wider closed arrow because data direction matters most. Values
 * are read by `CustomEdge` and the image-export pipeline.
 */
export type EdgeRelationKey = 'sync' | 'async' | 'data-flow' | 'dependency' | 'inheritance' | 'default';

export const MARKER_TOKENS: Record<EdgeRelationKey, { type: 'arrow' | 'arrowclosed'; width: number; height: number }> = {
    sync:        { type: 'arrowclosed', width: 16, height: 16 },
    async:       { type: 'arrowclosed', width: 16, height: 16 },
    'data-flow': { type: 'arrowclosed', width: 18, height: 18 },
    dependency:  { type: 'arrow',       width: 14, height: 14 },
    inheritance: { type: 'arrow',       width: 18, height: 18 },
    default:     { type: 'arrowclosed', width: 16, height: 16 },
};

/** Edges for which CustomEdge animates a flowing dash by default. */
export const ANIMATED_RELATIONS: ReadonlySet<EdgeRelationKey> = new Set(['async', 'data-flow']);

/**
 * LAYOUT_TOKENS — legacy single-preset entry point. Kept for compatibility with
 * existing callers; new code should prefer `LAYOUT_PRESETS.flow` /
 * `LAYOUT_PRESETS.excalidraw` which encode the real render sizes of each
 * target so dagre can reserve the right amount of room.
 */
export const LAYOUT_TOKENS = {
    node: {
        width:   260,
        height:  140,
        radius:  12,
        padding: 16,
    },
    spacing: {
        rankSep: 150,
        nodeSep: 90,
    },
    group: {
        padding:     36,
        topPadding:  48,
        radius:      16,
        labelOffset: 22,
    },
    fonts: {
        title: { family: 'Inter, sans-serif', size: 14, weight: 600 },
        body:  { family: 'Inter, sans-serif', size: 12, weight: 400 },
        edge:  { family: 'Inter, sans-serif', size: 11, weight: 500 },
    },
};

/**
 * Layout presets tuned per render target.
 *
 *  - `flow`       — mirrors the real DOM size of CustomNode (260 × 160) so
 *                   dagre reserves space that matches what ReactFlow draws.
 *  - `excalidraw` — slightly flatter rectangles that match Excalidraw's
 *                   default card proportions, with wider spacing because
 *                   Excalidraw does not route edges around nodes.
 */
export const LAYOUT_PRESETS = {
    flow: {
        node:    { width: 260, height: 160, radius: 14 },
        spacing: { rankSep: 170, nodeSep: 110, edgeSep: 60, marginX: 48, marginY: 48 },
        group:   { padding: 36, topPadding: 52, radius: 18 },
    },
    excalidraw: {
        node:    { width: 240, height: 110, radius: 12 },
        spacing: { rankSep: 190, nodeSep: 140, edgeSep: 70, marginX: 60, marginY: 60 },
        group:   { padding: 44, topPadding: 64, radius: 16 },
    },
} as const;

/**
 * Estimate the pixel dimensions of an edge label.  Used to feed dagre so it
 * reserves enough horizontal room between ranks for the label text and avoids
 * the "…truncated" effect visible in the current screenshots.
 */
export function estimateLabelDims(label: string | undefined, fontSize = 11): { width: number; height: number } {
    if (!label) return { width: 0, height: 0 };
    const text = label.trim();
    if (!text) return { width: 0, height: 0 };
    const AVG_CHAR = fontSize * 0.58;  // Inter at 11–14px averages ~60% of px-size per char.
    const PADDING  = 20;               // label pill horizontal padding + margin safety.
    const MAX      = 260;
    const MIN      = 56;
    const raw      = Math.min(MAX, Math.max(MIN, Math.ceil(text.length * AVG_CHAR) + PADDING));
    // two-line wrap for long labels
    const lines    = raw >= MAX ? 2 : 1;
    const lineH    = Math.ceil(fontSize * 1.45) + 4;
    return { width: raw, height: lineH * lines + 4 };
}

/**
 * Estimate the rendered card dimensions of a diagram node from its content.
 *
 * The flow preset's fixed 260 × 160 box wastes space on terse nodes ("API",
 * "Redis") and truncates verbose ones — both directly hurt the fit-to-view
 * zoom, because dagre reserves the same room for every node regardless of
 * what CustomNode actually paints. Feeding these per-node estimates into the
 * layout engine makes large diagrams measurably denser (higher zoom at fit)
 * without clipping any label.
 *
 * Mirrors CustomNode's layout: header (icon 36px + title at 14px/600 +
 * optional category/tech badge row) and an optional 3-line-clamped body.
 */
export function estimateNodeDims(
    node: { label?: string; description?: string; technology?: string; shape?: string },
    density: 'compact' | 'normal' | 'spacious' = 'normal',
): { width: number; height: number } {
    const preset = LAYOUT_PRESETS.flow.node;
    const label = (node.label ?? '').trim();
    const description = (node.description ?? '').trim();

    const MIN_W = density === 'compact' ? 190 : 220;
    const MAX_W = 320;
    // Title at 14px/600 averages ~8.1px per char; header reserves ~64px for
    // the icon block + paddings. Allow up to two title lines before widening.
    const titleCharW = 8.1;
    const headerChrome = 64;
    const titlePx = Math.ceil((label.length || 10) * titleCharW) + headerChrome;
    const idealW = titlePx > MAX_W ? Math.ceil(titlePx / 2) + headerChrome / 2 : titlePx;
    const width = Math.max(MIN_W, Math.min(MAX_W, idealW));

    // Header ≈ 56px (icon + title + badge row). Body adds ~17px per wrapped
    // description line (12px font, 1.4 line-height), clamped at 3 lines.
    const headerH = density === 'compact' ? 48 : 60;
    let bodyH = 0;
    if (description && density !== 'compact') {
        const bodyCharsPerLine = Math.max(18, Math.floor((width - 24) / 6.9));
        const lines = Math.min(3, Math.ceil(description.length / bodyCharsPerLine));
        bodyH = lines * 17 + 16;
    }
    // Decorated shapes (cylinder caps, person avatar) need vertical headroom.
    const shapeExtra = node.shape === 'cylinder' || node.shape === 'person' ? 20 : 0;
    const height = Math.max(
        density === 'compact' ? 64 : 96,
        Math.min(preset.height + 40, headerH + bodyH + shapeExtra + 24),
    );
    return { width, height };
}

/**
 * Heuristic role detection from label + kind. Used by renderers and prompts.
 *
 * Delegates to the canonical `resolveSemanticRole` in
 * `services/diagram/semanticRoleResolver` so the renderer, the prompts and
 * the IR pipeline always agree on the role of a given node. The resolver
 * has no React / DOM dependencies, so it is safe to import from the
 * design-tokens module that is consumed at render time.
 */
export function detectSemanticRole(label: string, kind?: string): SemanticRole {
    return resolveSemanticRoleImpl({ label, kind });
}

export function paletteFor(role: SemanticRole, isDark: boolean): SemanticPalette {
    return (isDark ? DIAGRAM_TOKENS.dark : DIAGRAM_TOKENS.light)[role];
}

export function inferPalette(label: string, kind: string | undefined, isDark: boolean): SemanticPalette {
    return paletteFor(detectSemanticRole(label, kind), isDark);
}

/**
 * Shared typography scale. Every renderer (CustomNode, CustomEdge,
 * irToExcalidraw, PDF export, ExecutiveOnePager) should read from here so a
 * single adjustment re-skins the whole diagram surface.
 */
export const TYPOGRAPHY_TOKENS = {
    fontFamilyUI: 'Inter, sans-serif',
    fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    scale: {
        caption:   { size: 10, weight: 500, lineHeight: 14, tracking: 0.04 },
        body:      { size: 12, weight: 400, lineHeight: 16, tracking: 0 },
        edge:      { size: 11, weight: 500, lineHeight: 14, tracking: 0.01 },
        title:     { size: 14, weight: 600, lineHeight: 18, tracking: 0 },
        display:   { size: 18, weight: 700, lineHeight: 24, tracking: -0.01 },
    },
} as const;

/**
 * Elevation scale. Favors modest shadows in light mode and subtle coloured
 * glows in dark mode to avoid the heavy dropshadow look that ages fast.
 */
export const ELEVATION_TOKENS = {
    light: {
        card:    '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)',
        hover:   '0 8px 24px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06)',
        popover: '0 20px 48px rgba(15,23,42,0.12), 0 6px 16px rgba(15,23,42,0.08)',
    },
    dark: {
        card:    '0 1px 2px rgba(0,0,0,0.45)',
        hover:   '0 10px 28px rgba(0,0,0,0.55), 0 4px 8px rgba(0,0,0,0.35)',
        popover: '0 24px 56px rgba(0,0,0,0.6), 0 8px 20px rgba(0,0,0,0.4)',
    },
} as const;

/**
 * Canvas background presets. Used by ReactFlowCanvas, PDF exporter and
 * ExecutiveOnePager so the "paper" under the diagram stays consistent.
 */
export const CANVAS_BACKGROUND = {
    light: {
        editorial:   { bg: '#fafafa', dot: '#e4e4e7', gap: 32, size: 1.2 },
        whiteboard:  { bg: '#ffffff', dot: '#d4d4d8', gap: 20, size: 1.5 },
        monochrome:  { bg: '#f8fafc', dot: '#cbd5e1', gap: 40, size: 0.9 },
        'high-contrast': { bg: '#ffffff', dot: '#475569', gap: 24, size: 1.4 },
    },
    dark: {
        editorial:   { bg: '#0b0b0f', dot: '#1f2937', gap: 32, size: 1.2 },
        whiteboard:  { bg: '#111827', dot: '#1f2937', gap: 20, size: 1.5 },
        monochrome:  { bg: '#0f172a', dot: '#1e293b', gap: 40, size: 0.9 },
        'high-contrast': { bg: '#000000', dot: '#64748b', gap: 24, size: 1.4 },
    },
} as const;
