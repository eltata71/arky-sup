import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { DiagramAudience, DiagramIR, DiagramIREdge, DiagramNarrative } from '../../../lib/diagram';
import { layoutIR, inferDirection, type PositionedNode } from '../../../lib/layoutEngine';
import { estimateNodeDims, type SemanticRole } from '../../../lib/diagramTokens';
import {
  FABLE_ANIMATED_SEMANTICS,
  FABLE_CRITICALITY_COLORS,
  FABLE_ROLE_GLYPHS,
  FABLE_THEMES,
  fableGroupKindLabel,
  fableRoleFor,
  type FableThemeName,
} from './fableTheme';

export interface FableDiagramCanvasProps {
  ir: DiagramIR;
  artifactName: string;
  audience: DiagramAudience;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface GroupRect {
  id: string;
  label: string;
  kindLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const GROUP_PADDING = 28;
const GROUP_HEADER = 34;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;

const AUDIENCE_LABELS: Record<DiagramAudience, string> = {
  executive: 'Audiencia ejecutiva',
  technical: 'Audiencia técnica',
  operations: 'Audiencia de operaciones',
};

const narrativeOf = (ir: DiagramIR): DiagramNarrative | null => {
  const raw = ir.metadata?.narrative;
  if (!raw) return null;
  if (typeof raw === 'string') return { summary: raw };
  return raw;
};

/** Anchor points on the node border facing the flow direction. */
const edgeAnchors = (
  source: PositionedNode,
  target: PositionedNode,
  direction: 'TB' | 'LR',
): { sx: number; sy: number; tx: number; ty: number } => {
  if (direction === 'LR') {
    const forward = target.x >= source.x;
    return {
      sx: forward ? source.x + source.width : source.x,
      sy: source.y + source.height / 2,
      tx: forward ? target.x : target.x + target.width,
      ty: target.y + target.height / 2,
    };
  }
  const forward = target.y >= source.y;
  return {
    sx: source.x + source.width / 2,
    sy: forward ? source.y + source.height : source.y,
    tx: target.x + target.width / 2,
    ty: forward ? target.y : target.y + target.height,
  };
};

const edgePath = (a: { sx: number; sy: number; tx: number; ty: number }, direction: 'TB' | 'LR'): string => {
  const { sx, sy, tx, ty } = a;
  if (direction === 'LR') {
    const off = Math.min(170, Math.max(48, Math.abs(tx - sx) * 0.45));
    const dir = tx >= sx ? 1 : -1;
    return `M ${sx} ${sy} C ${sx + off * dir} ${sy}, ${tx - off * dir} ${ty}, ${tx} ${ty}`;
  }
  const off = Math.min(170, Math.max(48, Math.abs(ty - sy) * 0.45));
  const dir = ty >= sy ? 1 : -1;
  return `M ${sx} ${sy} C ${sx} ${sy + off * dir}, ${tx} ${ty - off * dir}, ${tx} ${ty}`;
};

const isFlowingEdge = (edge: DiagramIREdge): boolean =>
  Boolean(edge.animated)
  || (edge.semanticType ? FABLE_ANIMATED_SEMANTICS.has(edge.semanticType) : false)
  || edge.relation === 'async'
  || edge.relation === 'data-flow';

/**
 * FableDiagramCanvas — premium interactive rendering of a DiagramIR.
 *
 * Deterministic (no runtime AI): layout comes from the canonical dagre
 * engine and the visual language from `fableTheme`. Adds cinematic entry
 * animations, per-edge gradients, focus dimming on hover, a node detail
 * panel and free pan/zoom — all self-contained in this component.
 */
export const FableDiagramCanvas: React.FC<FableDiagramCanvasProps> = ({ ir, artifactName, audience }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [theme, setTheme] = useState<FableThemeName>('aurora');
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number; active: boolean }>({
    startX: 0, startY: 0, originX: 0, originY: 0, active: false,
  });

  const palette = FABLE_THEMES[theme];
  const canvas = palette.canvas;

  // ── Layout (deterministic dagre pass) ───────────────────────────────────
  const layout = useMemo(() => {
    try {
      return layoutIR(ir, {
        preset: 'flow',
        direction: inferDirection(ir),
        density: 'spacious',
        nodeDims: (node) => estimateNodeDims(node, 'normal'),
      });
    } catch (err) {
      console.warn('[FableDiagramCanvas] layout failed', err);
      return null;
    }
  }, [ir]);

  const nodes = ir.nodes;
  const positioned = useMemo(() => {
    if (!layout) return [];
    return nodes
      .map((node) => ({ node, pos: layout.positions.get(node.id) }))
      .filter((entry): entry is { node: (typeof nodes)[number]; pos: PositionedNode } => Boolean(entry.pos));
  }, [nodes, layout]);

  const positionById = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const { pos } of positioned) map.set(pos.id, pos);
    return map;
  }, [positioned]);

  const groupRects = useMemo<GroupRect[]>(() => {
    if (!layout) return [];
    const rects: GroupRect[] = [];
    for (const group of ir.groups ?? []) {
      const members = group.nodeIds
        .map((id) => positionById.get(id))
        .filter((pos): pos is PositionedNode => Boolean(pos));
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((m) => m.x)) - GROUP_PADDING;
      const minY = Math.min(...members.map((m) => m.y)) - GROUP_PADDING - GROUP_HEADER;
      const maxX = Math.max(...members.map((m) => m.x + m.width)) + GROUP_PADDING;
      const maxY = Math.max(...members.map((m) => m.y + m.height)) + GROUP_PADDING;
      rects.push({
        id: group.id,
        label: group.label,
        kindLabel: fableGroupKindLabel(group.kind),
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      });
    }
    return rects;
  }, [ir.groups, layout, positionById]);

  const narrative = useMemo(() => narrativeOf(ir), [ir]);
  const calloutsByNode = useMemo(() => {
    const map = new Map<string, { index: number; text: string; severity: string }[]>();
    (narrative?.callouts ?? []).forEach((callout, i) => {
      if (callout.targetKind === 'edge') return;
      const list = map.get(callout.targetId) ?? [];
      list.push({ index: callout.index ?? i + 1, text: callout.text, severity: callout.severity ?? 'info' });
      map.set(callout.targetId, list);
    });
    return map;
  }, [narrative]);

  // ── Focus / adjacency ───────────────────────────────────────────────────
  const focusId = hoveredId ?? selectedId;
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of ir.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [ir.edges]);

  const isNodeFocused = useCallback(
    (id: string) => !focusId || id === focusId || (adjacency.get(focusId)?.has(id) ?? false),
    [focusId, adjacency],
  );
  const isEdgeFocused = useCallback(
    (edge: DiagramIREdge) => !focusId || edge.source === focusId || edge.target === focusId,
    [focusId],
  );

  // ── Pan / zoom ──────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout) return;
    const { width: cw, height: ch } = el.getBoundingClientRect();
    if (cw <= 0 || ch <= 0 || layout.bbox.width <= 0 || layout.bbox.height <= 0) return;
    const margin = 80;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(
      (cw - margin) / layout.bbox.width,
      (ch - margin) / layout.bbox.height,
    )));
    setTransform({
      x: (cw - layout.bbox.width * k) / 2,
      y: (ch - layout.bbox.height * k) / 2,
      k,
    });
  }, [layout]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fitView();
  }, [fitView, size.w, size.h]);

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    setTransform((prev) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor));
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const px = cx ?? (rect ? rect.width / 2 : 0);
      const py = cy ?? (rect ? rect.height / 2 : 0);
      const scale = k / prev.k;
      return { k, x: px - (px - prev.x) * scale, y: py - (py - prev.y) * scale };
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      active: true,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }, [transform.x, transform.y]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!panRef.current.active) return;
    const dx = event.clientX - panRef.current.startX;
    const dy = event.clientY - panRef.current.startY;
    setTransform((prev) => ({ ...prev, x: panRef.current.originX + dx, y: panRef.current.originY + dy }));
  }, []);

  const onPointerUp = useCallback(() => {
    panRef.current.active = false;
  }, []);

  // ── Derived presentation data ───────────────────────────────────────────
  const rolesPresent = useMemo(() => {
    const set = new Set<SemanticRole>();
    for (const node of ir.nodes) set.add(fableRoleFor(node));
    return [...set];
  }, [ir.nodes]);

  const direction = layout?.direction ?? 'TB';
  const showAllEdgeLabels = ir.edges.length <= 14;
  const selectedNode = selectedId ? ir.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedConnections = useMemo(() => {
    if (!selectedId) return [];
    const labelOf = (id: string) => ir.nodes.find((n) => n.id === id)?.label ?? id;
    return ir.edges
      .filter((edge) => edge.source === selectedId || edge.target === selectedId)
      .map((edge) => ({
        id: edge.id,
        outgoing: edge.source === selectedId,
        peer: labelOf(edge.source === selectedId ? edge.target : edge.source),
        label: edge.label,
        protocol: edge.protocol,
      }));
  }, [ir.edges, ir.nodes, selectedId]);

  if (!layout || positioned.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        No fue posible calcular el layout del diagrama.
      </div>
    );
  }

  const title = ir.metadata?.title ?? artifactName;

  return (
    <div
      ref={containerRef}
      data-testid="fable-canvas"
      className="relative h-full w-full select-none overflow-hidden"
      style={{ background: canvas.bg, touchAction: 'none' }}
    >
      <svg
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={`Diagrama ${title} en vista Fable`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onClick={() => setSelectedId(null)}
      >
        <defs>
          <radialGradient id="fable-atmo-a" cx="20%" cy="12%" r="65%">
            <stop offset="0%" stopColor={canvas.glowA} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <radialGradient id="fable-atmo-b" cx="85%" cy="90%" r="70%">
            <stop offset="0%" stopColor={canvas.glowB} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <pattern id="fable-grid" width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill={canvas.grid} />
          </pattern>
          {rolesPresent.map((role) => (
            <marker
              key={`marker-${role}`}
              id={`fable-arrow-${role}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 Z" fill={palette.roles[role].accent} />
            </marker>
          ))}
          {ir.edges.map((edge) => {
            const source = positionById.get(edge.source);
            const target = positionById.get(edge.target);
            if (!source || !target) return null;
            const a = edgeAnchors(source, target, direction);
            const sourceNode = ir.nodes.find((n) => n.id === edge.source);
            const targetNode = ir.nodes.find((n) => n.id === edge.target);
            const fromColor = sourceNode ? palette.roles[fableRoleFor(sourceNode)].accent : canvas.edgeNeutral;
            const toColor = targetNode ? palette.roles[fableRoleFor(targetNode)].accent : canvas.edgeNeutral;
            return (
              <linearGradient
                key={`grad-${edge.id}`}
                id={`fable-edge-${edge.id}`}
                gradientUnits="userSpaceOnUse"
                x1={a.sx}
                y1={a.sy}
                x2={a.tx}
                y2={a.ty}
              >
                <stop offset="0%" stopColor={fromColor} stopOpacity={0.85} />
                <stop offset="100%" stopColor={toColor} />
              </linearGradient>
            );
          })}
          <style>{'@keyframes fableFlow { to { stroke-dashoffset: -26; } } .fable-flow { animation: fableFlow 1.1s linear infinite; }'}</style>
        </defs>

        {/* Atmosphere */}
        <rect width="100%" height="100%" fill="url(#fable-atmo-a)" />
        <rect width="100%" height="100%" fill="url(#fable-atmo-b)" />
        <rect width="100%" height="100%" fill="url(#fable-grid)" />

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          {/* Group boundaries */}
          {groupRects.map((group, i) => (
            <motion.g
              key={group.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05 + i * 0.05, duration: 0.5 }}
            >
              <rect
                x={group.x}
                y={group.y}
                width={group.width}
                height={group.height}
                rx={24}
                fill={canvas.groupFill}
                stroke={canvas.groupStroke}
                strokeWidth={1.5}
                strokeDasharray="10 6"
              />
              <text
                x={group.x + 20}
                y={group.y + 24}
                fill={canvas.groupLabel}
                fontSize={13}
                fontWeight={700}
                fontFamily="Inter, sans-serif"
                letterSpacing="0.06em"
              >
                {group.label.toUpperCase()}
              </text>
              <text
                x={group.x + 20}
                y={group.y + 40}
                fill={canvas.groupLabel}
                opacity={0.65}
                fontSize={10}
                fontFamily="Inter, sans-serif"
              >
                {group.kindLabel}
              </text>
            </motion.g>
          ))}

          {/* Edges */}
          {ir.edges.map((edge, i) => {
            const source = positionById.get(edge.source);
            const target = positionById.get(edge.target);
            if (!source || !target) return null;
            const a = edgeAnchors(source, target, direction);
            const d = edgePath(a, direction);
            const focused = isEdgeFocused(edge);
            const flowing = isFlowingEdge(edge);
            const targetNode = ir.nodes.find((n) => n.id === edge.target);
            const markerRole = targetNode ? fableRoleFor(targetNode) : 'generic';
            const showLabel = Boolean(edge.label) && (showAllEdgeLabels || (focusId !== null && focused));
            const midX = (a.sx + a.tx) / 2;
            const midY = (a.sy + a.ty) / 2;
            const labelWidth = Math.min(220, (edge.label?.length ?? 0) * 6.4 + 18);
            const critical = edge.criticality === 'critical' || edge.criticality === 'high';
            return (
              <motion.g
                key={edge.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: focused ? 1 : 0.12 }}
                transition={{ delay: 0.25 + Math.min(i, 20) * 0.02, duration: 0.35 }}
              >
                <path
                  d={d}
                  fill="none"
                  stroke={`url(#fable-edge-${edge.id})`}
                  strokeWidth={critical ? 3 : 2}
                  strokeLinecap="round"
                  strokeDasharray={flowing ? '9 8' : undefined}
                  className={flowing ? 'fable-flow' : undefined}
                  markerEnd={`url(#fable-arrow-${markerRole})`}
                  markerStart={edge.direction === 'bidirectional' ? `url(#fable-arrow-${markerRole})` : undefined}
                />
                {showLabel && (
                  <g>
                    <rect
                      x={midX - labelWidth / 2}
                      y={midY - 11}
                      width={labelWidth}
                      height={22}
                      rx={11}
                      fill={canvas.labelBg}
                      stroke={canvas.cardStroke}
                      strokeWidth={0.75}
                    />
                    <text
                      x={midX}
                      y={midY + 4}
                      textAnchor="middle"
                      fill={canvas.labelText}
                      fontSize={11}
                      fontFamily="Inter, sans-serif"
                    >
                      {edge.label!.length > 32 ? `${edge.label!.slice(0, 31)}…` : edge.label}
                    </text>
                  </g>
                )}
              </motion.g>
            );
          })}

          {/* Nodes */}
          {positioned.map(({ node, pos }, i) => {
            const role = fableRoleFor(node);
            const style = palette.roles[role];
            const focused = isNodeFocused(node.id);
            const selected = selectedId === node.id;
            const callouts = calloutsByNode.get(node.id) ?? [];
            const criticalityColor = node.criticality ? FABLE_CRITICALITY_COLORS[node.criticality] : null;
            return (
              <g key={node.id} transform={`translate(${pos.x}, ${pos.y})`}>
                <motion.g
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: focused ? 1 : 0.18, scale: 1 }}
                  transition={{ delay: Math.min(i, 24) * 0.04, type: 'spring', stiffness: 240, damping: 22 }}
                  style={{ transformOrigin: `${pos.width / 2}px ${pos.height / 2}px` }}
                >
                  <foreignObject width={pos.width} height={pos.height} overflow="visible">
                    <div
                      data-testid={`fable-node-${node.id}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`Componente ${node.label}`}
                      className="flex h-full w-full cursor-pointer flex-col justify-center rounded-2xl px-4 py-3 outline-none transition-transform duration-200 hover:-translate-y-0.5"
                      style={{
                        background: `linear-gradient(135deg, ${style.from}, ${style.to})`,
                        border: `1.5px solid ${selected ? style.accent : canvas.cardStroke}`,
                        boxShadow: selected || hoveredId === node.id
                          ? `0 0 0 3px ${style.glow}, 0 18px 42px -12px ${style.glow}`
                          : `0 14px 34px -16px ${style.glow}`,
                        borderLeft: criticalityColor ? `4px solid ${criticalityColor}` : undefined,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedId((prev) => (prev === node.id ? null : node.id));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedId((prev) => (prev === node.id ? null : node.id));
                        }
                      }}
                      onMouseEnter={() => setHoveredId(node.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.16)', color: style.text }}
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d={FABLE_ROLE_GLYPHS[role]} />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-tight" style={{ color: style.text }}>
                            {node.label}
                          </p>
                          {node.technology && (
                            <p className="truncate text-[10px] font-medium uppercase tracking-wide" style={{ color: style.subtext }}>
                              {node.technology}
                            </p>
                          )}
                        </div>
                      </div>
                      {node.description && pos.height >= 92 && (
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug" style={{ color: style.subtext }}>
                          {node.description}
                        </p>
                      )}
                    </div>
                  </foreignObject>
                  {node.status && node.status !== 'active' && (
                    <circle
                      cx={pos.width - 8}
                      cy={8}
                      r={5}
                      fill={node.status === 'error' ? '#f87171' : '#fbbf24'}
                      stroke={canvas.bg}
                      strokeWidth={2}
                    />
                  )}
                  {callouts.map((callout, ci) => (
                    <g key={`${node.id}-callout-${ci}`} transform={`translate(${pos.width - 14 - ci * 26}, ${-12})`}>
                      <circle
                        r={11}
                        fill={callout.severity === 'critical' ? '#ef4444' : callout.severity === 'warning' ? '#f59e0b' : '#6366f1'}
                      />
                      <text textAnchor="middle" y={4} fill="#fff" fontSize={11} fontWeight={700} fontFamily="Inter, sans-serif">
                        {callout.index}
                      </text>
                    </g>
                  ))}
                </motion.g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Header */}
      <div
        className="pointer-events-none absolute left-4 top-4 max-w-sm rounded-2xl border p-4 backdrop-blur-xl"
        style={{ background: canvas.panelBg, borderColor: canvas.panelBorder }}
      >
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ background: 'linear-gradient(90deg, #6366f1, #d946ef)', color: '#fff' }}
          >
            Fable
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: canvas.panelSubtext }}>
            Diseño · IA de Anthropic
          </span>
        </div>
        <h2 className="mt-1.5 text-base font-bold leading-tight" style={{ color: canvas.panelText }}>
          {title}
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: canvas.panelSubtext }}>
          {ir.nodes.length} componentes · {ir.edges.length} conexiones · {AUDIENCE_LABELS[audience]}
        </p>
        {narrative?.summary && (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed" style={{ color: canvas.panelSubtext }}>
            {narrative.summary}
          </p>
        )}
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setTheme((prev) => (prev === 'aurora' ? 'gallery' : 'aurora'))}
        className="absolute right-4 top-4 rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur-xl transition-opacity hover:opacity-80"
        style={{ background: canvas.panelBg, borderColor: canvas.panelBorder, color: canvas.panelText }}
        aria-label="Cambiar tema visual de la vista Fable"
      >
        {theme === 'aurora' ? '☀ Tema galería' : '✦ Tema aurora'}
      </button>

      {/* Legend */}
      <div
        className="pointer-events-none absolute bottom-4 left-4 flex max-w-md flex-wrap gap-1.5 rounded-2xl border p-2.5 backdrop-blur-xl"
        style={{ background: canvas.panelBg, borderColor: canvas.panelBorder }}
      >
        {rolesPresent.map((role) => (
          <span
            key={role}
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: canvas.panelText, border: `1px solid ${canvas.panelBorder}` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: palette.roles[role].accent }} />
            {palette.roles[role].label}
          </span>
        ))}
      </div>

      {/* Zoom controls */}
      <div
        className="absolute bottom-4 right-4 flex items-center gap-1 rounded-2xl border p-1.5 backdrop-blur-xl"
        style={{ background: canvas.panelBg, borderColor: canvas.panelBorder }}
      >
        <button
          type="button"
          aria-label="Alejar"
          onClick={() => zoomBy(1 / 1.25)}
          className="h-8 w-8 rounded-lg text-base font-bold transition-opacity hover:opacity-70"
          style={{ color: canvas.panelText }}
        >
          −
        </button>
        <span className="w-12 text-center text-[11px] font-semibold tabular-nums" style={{ color: canvas.panelSubtext }}>
          {Math.round(transform.k * 100)}%
        </span>
        <button
          type="button"
          aria-label="Acercar"
          onClick={() => zoomBy(1.25)}
          className="h-8 w-8 rounded-lg text-base font-bold transition-opacity hover:opacity-70"
          style={{ color: canvas.panelText }}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Ajustar a pantalla"
          onClick={fitView}
          className="h-8 rounded-lg px-2.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
          style={{ color: canvas.panelText }}
        >
          Ajustar
        </button>
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="absolute bottom-20 right-4 top-16 w-72 overflow-y-auto rounded-2xl border p-4 backdrop-blur-xl"
          style={{ background: canvas.panelBg, borderColor: canvas.panelBorder }}
          aria-label={`Detalle de ${selectedNode.label}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{ background: palette.roles[fableRoleFor(selectedNode)].accent, color: '#fff' }}
              >
                {palette.roles[fableRoleFor(selectedNode)].label}
              </span>
              <h3 className="mt-1.5 text-sm font-bold leading-tight" style={{ color: canvas.panelText }}>
                {selectedNode.label}
              </h3>
            </div>
            <button
              type="button"
              aria-label="Cerrar detalle"
              onClick={() => setSelectedId(null)}
              className="rounded-lg px-1.5 text-sm transition-opacity hover:opacity-60"
              style={{ color: canvas.panelSubtext }}
            >
              ✕
            </button>
          </div>
          {selectedNode.description && (
            <p className="mt-2 text-xs leading-relaxed" style={{ color: canvas.panelSubtext }}>
              {selectedNode.description}
            </p>
          )}
          <dl className="mt-3 space-y-1.5 text-xs">
            {[
              ['Tecnología', selectedNode.technology],
              ['Responsable', selectedNode.owner],
              ['Dominio', selectedNode.domain],
              ['Criticidad', selectedNode.criticality],
              ['Confianza', selectedNode.trust],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="font-semibold" style={{ color: canvas.panelSubtext }}>{label}</dt>
                <dd className="text-right" style={{ color: canvas.panelText }}>{value}</dd>
              </div>
            ))}
          </dl>
          {(calloutsByNode.get(selectedNode.id) ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: canvas.panelSubtext }}>
                Notas del diagrama
              </p>
              <ul className="mt-1 space-y-1">
                {(calloutsByNode.get(selectedNode.id) ?? []).map((callout, i) => (
                  <li key={i} className="text-xs leading-snug" style={{ color: canvas.panelText }}>
                    <span className="font-bold">{callout.index}.</span> {callout.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selectedConnections.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: canvas.panelSubtext }}>
                Conexiones ({selectedConnections.length})
              </p>
              <ul className="mt-1 space-y-1.5">
                {selectedConnections.map((conn) => (
                  <li key={conn.id} className="text-xs leading-snug" style={{ color: canvas.panelText }}>
                    <span className="font-semibold">{conn.outgoing ? '→' : '←'} {conn.peer}</span>
                    {conn.label && <span style={{ color: canvas.panelSubtext }}> · {conn.label}</span>}
                    {conn.protocol && <span style={{ color: canvas.panelSubtext }}> ({conn.protocol})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.aside>
      )}
    </div>
  );
};

export default FableDiagramCanvas;
