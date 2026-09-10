/**
 * Deterministic DiagramIR → Excalidraw elements serializer.
 *
 * Replaces AI hop #3 (Mermaid → Excalidraw JSON via Gemini) with a pure
 * function.  Coordinates come from dagre, colours from the canonical tokens.
 *
 * Design goals after the 2026-Q2 quality refresh:
 *   - No starburst arrows: edges exit/enter at perimeter points, fanned around
 *     each node so multiple incident edges don't overlap.
 *   - Polyline routing: dagre's per-edge waypoints are preserved instead of a
 *     single centre-to-centre line; result is visibly cleaner for ≥6 nodes.
 *   - Legible labels: each edge label gets its own background rectangle and is
 *     nudged off the midpoint when that midpoint is already occupied.
 *   - Breathing-room groups: top padding is larger than bottom/side so the
 *     group title doesn't intrude on the first-row nodes.
 */

import type { DiagramIR } from '../../lib/diagram';
import {
    DIAGRAM_TOKENS,
    EDGE_TOKENS,
    LAYOUT_PRESETS,
    detectSemanticRole,
    estimateLabelDims,
} from '../../lib/diagramTokens';
import { layoutIR, edgeWaypointKey } from '../../lib/layoutEngine';

export interface ExcalidrawBundle {
    elements: unknown[];
}

interface BaseElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    strokeColor: string;
    backgroundColor: string;
    strokeStyle?: 'solid' | 'dashed' | 'dotted';
    strokeWidth?: number;
    roughness?: number;
    opacity?: number;
    angle?: number;
    fillStyle?: string;
    seed?: number;
    groupIds?: string[];
    text?: string;
    fontSize?: number;
    fontFamily?: number;
    textAlign?: 'left' | 'center' | 'right';
    verticalAlign?: 'top' | 'middle' | 'bottom';
    containerId?: string | null;
    originalText?: string;
    points?: [number, number][];
    startBinding?: { elementId: string; focus: number; gap: number } | null;
    endBinding?: { elementId: string; focus: number; gap: number } | null;
    startArrowhead?: string | null;
    endArrowhead?: string | null;
    roundness?: { type: number } | null;
}

let seedCounter = 1;
const nextSeed = () => (seedCounter = (seedCounter * 16807) % 2147483647);

const PRESET = LAYOUT_PRESETS.excalidraw;

type DagrePoint = { x: number; y: number };

interface RectBox { x: number; y: number; width: number; height: number }

/** Returns the point where the line from `from` → `to` leaves rect `box`. */
function intersectRect(box: RectBox, from: DagrePoint, to: DagrePoint): DagrePoint {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const halfW = box.width / 2;
    const halfH = box.height / 2;
    // parametric t along the ray
    let tx = Infinity;
    let ty = Infinity;
    if (dx !== 0) {
        const edgeX = dx > 0 ? cx + halfW : cx - halfW;
        tx = (edgeX - from.x) / dx;
    }
    if (dy !== 0) {
        const edgeY = dy > 0 ? cy + halfH : cy - halfH;
        ty = (edgeY - from.y) / dy;
    }
    const t = Math.min(tx, ty);
    return { x: from.x + dx * t, y: from.y + dy * t };
}

/** Clamp to a sane finite float. */
const clamp = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

export function irToExcalidraw(ir: DiagramIR, isDark = false): ExcalidrawBundle {
    const palette = isDark ? DIAGRAM_TOKENS.dark : DIAGRAM_TOKENS.light;
    const edgeTokens = isDark ? EDGE_TOKENS.dark : EDGE_TOKENS.light;

    // ── 1. Layout (canonical engine, dagre under the hood) ──────────────────
    const direction = ir.nodes.length > 8 ? 'TB' : 'LR';
    const layout = layoutIR(ir, { preset: 'excalidraw', direction });

    const elements: BaseElement[] = [];

    // ── 2. Node boxes (top-left coordinates for Excalidraw) ──────────────────
    const nodeBoxes = new Map<string, RectBox>();
    for (const node of ir.nodes) {
        const pos = layout.positions.get(node.id);
        if (!pos) continue;
        nodeBoxes.set(node.id, {
            x: clamp(pos.x),
            y: clamp(pos.y),
            width: pos.width,
            height: pos.height,
        });
    }

    // ── 3. Group zones (drawn BEFORE nodes so they sit in the background) ───
    for (const group of ir.groups) {
        const memberBoxes = group.nodeIds
            .map(id => nodeBoxes.get(id))
            .filter((b): b is RectBox => Boolean(b));
        if (memberBoxes.length === 0) continue;
        const padX = PRESET.group.padding;
        const padTop = PRESET.group.topPadding;
        const minX = Math.min(...memberBoxes.map(b => b.x)) - padX;
        const maxX = Math.max(...memberBoxes.map(b => b.x + b.width)) + padX;
        const minY = Math.min(...memberBoxes.map(b => b.y)) - padTop;
        const maxY = Math.max(...memberBoxes.map(b => b.y + b.height)) + padX;

        elements.push({
            id: `group-${group.id}`,
            type: 'rectangle',
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            strokeColor: palette.generic.stroke,
            backgroundColor: isDark ? '#0f172a' : '#f8fafc',
            strokeStyle: 'dashed',
            strokeWidth: 1.5,
            roughness: 0,
            opacity: 50,
            fillStyle: 'solid',
            roundness: { type: 3 },
            seed: nextSeed(),
        });
        elements.push({
            id: `group-label-${group.id}`,
            type: 'text',
            x: minX + 14,
            y: minY + 10,
            width: Math.max(64, maxX - minX - 28),
            height: 22,
            strokeColor: palette.generic.text,
            backgroundColor: 'transparent',
            fontSize: 14,
            fontFamily: 3, // Excalidraw "Cascadia" numeric — renders as bold sans.
            textAlign: 'left',
            verticalAlign: 'top',
            containerId: null,
            text: group.label.toUpperCase(),
            originalText: group.label.toUpperCase(),
            roughness: 0,
            opacity: 100,
            seed: nextSeed(),
        });
    }

    // ── 4. Nodes ────────────────────────────────────────────────────────────
    for (const node of ir.nodes) {
        const box = nodeBoxes.get(node.id);
        if (!box) continue;
        const role = detectSemanticRole(node.label, node.kind);
        const p = palette[role];

        const shapeType = node.shape === 'diamond' ? 'diamond'
            : node.shape === 'cloud' ? 'ellipse'
            : node.shape === 'cylinder' ? 'ellipse'
            : 'rectangle';

        // Accent bar (gives each node a subtle coloured left edge à la modern C4).
        const accentWidth = 6;
        if (shapeType === 'rectangle') {
            elements.push({
                id: `node-accent-${node.id}`,
                type: 'rectangle',
                x: box.x,
                y: box.y,
                width: accentWidth,
                height: box.height,
                strokeColor: p.accent,
                backgroundColor: p.accent,
                strokeWidth: 0,
                fillStyle: 'solid',
                strokeStyle: 'solid',
                roughness: 0,
                opacity: 100,
                roundness: { type: 3 },
                seed: nextSeed(),
            });
        }

        elements.push({
            id: `node-${node.id}`,
            type: shapeType,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            strokeColor: p.stroke,
            backgroundColor: p.bg,
            strokeWidth: 2,
            fillStyle: 'solid',
            strokeStyle: 'solid',
            roughness: 0,
            opacity: 100,
            roundness: { type: 3 },
            seed: nextSeed(),
        });

        const hasDesc = !!node.description;
        const kindLabel = node.kind && node.kind !== 'Component' && node.kind !== 'Unknown'
            ? `‹${node.kind}›`
            : undefined;

        // Kind micro-label at the top (helps C4 hierarchy).
        if (kindLabel) {
            elements.push({
                id: `node-kind-${node.id}`,
                type: 'text',
                x: box.x + accentWidth + 10,
                y: box.y + 8,
                width: box.width - accentWidth - 20,
                height: 14,
                strokeColor: p.stroke,
                backgroundColor: 'transparent',
                fontSize: 10,
                fontFamily: 3,
                textAlign: 'left',
                verticalAlign: 'top',
                containerId: null,
                text: kindLabel,
                originalText: kindLabel,
                roughness: 0,
                opacity: 85,
                seed: nextSeed(),
            });
        }

        // Main label
        elements.push({
            id: `node-label-${node.id}`,
            type: 'text',
            x: box.x + accentWidth + 10,
            y: box.y + (kindLabel ? 24 : 12),
            width: box.width - accentWidth - 20,
            height: hasDesc ? 24 : box.height - (kindLabel ? 32 : 20),
            strokeColor: p.text,
            backgroundColor: 'transparent',
            fontSize: 15,
            fontFamily: 3,
            textAlign: 'left',
            verticalAlign: kindLabel ? 'top' : 'middle',
            text: node.label,
            originalText: node.label,
            containerId: null,
            roughness: 0,
            opacity: 100,
            seed: nextSeed(),
        });

        if (hasDesc) {
            elements.push({
                id: `node-desc-${node.id}`,
                type: 'text',
                x: box.x + accentWidth + 10,
                y: box.y + (kindLabel ? 52 : 40),
                width: box.width - accentWidth - 20,
                height: box.height - (kindLabel ? 60 : 48),
                strokeColor: p.text,
                backgroundColor: 'transparent',
                fontSize: 11,
                fontFamily: 3,
                textAlign: 'left',
                verticalAlign: 'top',
                text: node.description!,
                originalText: node.description!,
                containerId: null,
                roughness: 0,
                opacity: 80,
                seed: nextSeed(),
            });
        }
    }

    // ── 5. Edges with perimeter endpoints + fanning ─────────────────────────
    // For each node, count incident edges to fan them around the perimeter
    // instead of all attaching at a single centre point (the "starburst" bug).
    const incidentCounts = new Map<string, { out: number; in: number }>();
    for (const edge of ir.edges) {
        const src = incidentCounts.get(edge.source) ?? { out: 0, in: 0 };
        const tgt = incidentCounts.get(edge.target) ?? { out: 0, in: 0 };
        incidentCounts.set(edge.source, { out: src.out + 1, in: src.in });
        incidentCounts.set(edge.target, { out: tgt.out, in: tgt.in + 1 });
    }
    const outIdx = new Map<string, number>();
    const inIdx = new Map<string, number>();
    const labelPlacements: { x: number; y: number; width: number; height: number }[] = [];

    for (const edge of ir.edges) {
        const srcBox = nodeBoxes.get(edge.source);
        const tgtBox = nodeBoxes.get(edge.target);
        if (!srcBox || !tgtBox) continue;

        const relation = edge.relation && edge.relation !== 'default' ? edge.relation : 'default';
        const edgeStyle = edgeTokens[relation as keyof typeof edgeTokens] ?? edgeTokens.default;

        const waypoints = (layout.edgeWaypoints.get(edgeWaypointKey(edge.source, edge.target, edge.id)) ?? [])
            .map((p) => ({ x: clamp(p.x), y: clamp(p.y) }));

        const srcCentre = { x: srcBox.x + srcBox.width / 2, y: srcBox.y + srcBox.height / 2 };
        const tgtCentre = { x: tgtBox.x + tgtBox.width / 2, y: tgtBox.y + tgtBox.height / 2 };

        // First / last waypoints define the direction into/out of each node.
        const firstOut = waypoints[1] ?? waypoints[0] ?? tgtCentre;
        const lastIn   = waypoints[waypoints.length - 2] ?? waypoints[waypoints.length - 1] ?? srcCentre;

        const startPt = intersectRect(srcBox, srcCentre, firstOut);
        const endPt   = intersectRect(tgtBox, tgtCentre, lastIn);

        // Build polyline from startPt through middle waypoints to endPt, stripping
        // any waypoints that fall inside the source/target boxes.
        const insideBox = (b: RectBox, pt: DagrePoint) =>
            pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;

        const midPoints = waypoints.filter(p => !insideBox(srcBox, p) && !insideBox(tgtBox, p));
        const polyline: DagrePoint[] = [startPt, ...midPoints, endPt];

        // Fan factor: perturb start/end by a few px along the node perimeter when
        // many edges share the same endpoint.  This is what kills the starburst.
        const srcCount = incidentCounts.get(edge.source)!.out;
        const tgtCount = incidentCounts.get(edge.target)!.in;
        const oIdx = (outIdx.get(edge.source) ?? 0);
        const iIdx = (inIdx.get(edge.target) ?? 0);
        outIdx.set(edge.source, oIdx + 1);
        inIdx.set(edge.target, iIdx + 1);

        if (srcCount > 1) {
            const spread = 28;
            const offset = (oIdx - (srcCount - 1) / 2) * spread / srcCount;
            if (Math.abs(firstOut.x - srcCentre.x) > Math.abs(firstOut.y - srcCentre.y)) {
                polyline[0] = { x: polyline[0].x, y: polyline[0].y + offset };
            } else {
                polyline[0] = { x: polyline[0].x + offset, y: polyline[0].y };
            }
        }
        if (tgtCount > 1) {
            const spread = 28;
            const offset = (iIdx - (tgtCount - 1) / 2) * spread / tgtCount;
            const last = polyline[polyline.length - 1];
            if (Math.abs(lastIn.x - tgtCentre.x) > Math.abs(lastIn.y - tgtCentre.y)) {
                polyline[polyline.length - 1] = { x: last.x, y: last.y + offset };
            } else {
                polyline[polyline.length - 1] = { x: last.x + offset, y: last.y };
            }
        }

        const anchor = polyline[0];
        const relativePoints: [number, number][] = polyline.map(p => [p.x - anchor.x, p.y - anchor.y]);

        const farCorner = polyline.reduce((acc, p) => ({
            x: Math.max(acc.x, p.x),
            y: Math.max(acc.y, p.y),
        }), { x: anchor.x, y: anchor.y });

        elements.push({
            id: `edge-${edge.id}`,
            type: 'arrow',
            x: anchor.x,
            y: anchor.y,
            width: Math.max(1, farCorner.x - anchor.x),
            height: Math.max(1, farCorner.y - anchor.y),
            strokeColor: edgeStyle.stroke,
            backgroundColor: 'transparent',
            strokeWidth: edgeStyle.strokeWidth,
            strokeStyle: edgeStyle.dash ? 'dashed' : 'solid',
            roughness: 0,
            opacity: 100,
            points: relativePoints,
            startBinding: { elementId: `node-${edge.source}`, focus: 0, gap: 6 },
            endBinding: { elementId: `node-${edge.target}`, focus: 0, gap: 6 },
            startArrowhead: null,
            endArrowhead: 'triangle',
            roundness: { type: 2 },
            seed: nextSeed(),
        });

        if (edge.label) {
            // Label anchored near the midpoint of the polyline, with collision
            // avoidance against previously placed labels.
            const mid = polyline.length >= 3
                ? polyline[Math.floor(polyline.length / 2)]
                : { x: (polyline[0].x + polyline[polyline.length - 1].x) / 2,
                    y: (polyline[0].y + polyline[polyline.length - 1].y) / 2 };

            const dims = estimateLabelDims(edge.label, 11);
            const labelW = Math.max(80, dims.width);
            const labelH = Math.max(22, dims.height);
            const lx = mid.x - labelW / 2;
            let ly = mid.y - labelH / 2;

            // If it overlaps a previous label, nudge perpendicular to the edge.
            const overlaps = (a: RectBox, b: RectBox) =>
                !(a.x + a.width < b.x || b.x + b.width < a.x ||
                  a.y + a.height < b.y || b.y + b.height < a.y);
            const candidate: RectBox = { x: lx, y: ly, width: labelW, height: labelH };
            let nudges = 0;
            const step = labelH + 6;
            while (labelPlacements.some(p => overlaps(candidate, p)) && nudges < 6) {
                ly += (nudges % 2 === 0 ? 1 : -1) * step * Math.ceil((nudges + 1) / 2);
                candidate.y = ly;
                nudges++;
            }
            labelPlacements.push({ x: lx, y: ly, width: labelW, height: labelH });

            // Background pill so text is readable on top of lines / fills.
            elements.push({
                id: `edge-label-bg-${edge.id}`,
                type: 'rectangle',
                x: lx - 4,
                y: ly - 2,
                width: labelW + 8,
                height: labelH + 4,
                strokeColor: 'transparent',
                backgroundColor: isDark ? '#0f172aee' : '#ffffffee',
                strokeWidth: 0,
                fillStyle: 'solid',
                strokeStyle: 'solid',
                roughness: 0,
                opacity: 92,
                roundness: { type: 3 },
                seed: nextSeed(),
            });

            elements.push({
                id: `edge-label-${edge.id}`,
                type: 'text',
                x: lx,
                y: ly,
                width: labelW,
                height: labelH,
                strokeColor: edgeStyle.stroke,
                backgroundColor: 'transparent',
                fontSize: 11,
                fontFamily: 3,
                textAlign: 'center',
                verticalAlign: 'middle',
                text: edge.label,
                originalText: edge.label,
                containerId: null,
                roughness: 0,
                opacity: 100,
                seed: nextSeed(),
            });
        }
    }

    return { elements };
}
