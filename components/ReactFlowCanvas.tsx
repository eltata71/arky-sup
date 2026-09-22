import React, { useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, useState, useRef } from 'react';
import ReactFlow, {
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  updateEdge,
  Connection
} from 'reactflow';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';
import PresentationMode from './PresentationMode';
import { XMarkIcon, ChevronDownIcon, ArrowUturnLeftIcon, ArrowPathIcon, ViewfinderCircleIcon, PresentationChartBarIcon, SparklesIcon } from './Icons';
import { Dropdown, type DropdownItem } from './ui/Dropdown';
import { CANVAS_BACKGROUND, MARKER_TOKENS } from '../lib/diagramTokens';
import type { DiagramDensity, DiagramIR, DiagramTheme } from '../lib/diagram';
import type { EdgeSemanticType, NodeSemanticType } from '../lib/diagramCategoryLabels';
import { EdgeInspector, NodeInspector } from './diagram/DiagramInspectorSection';
import { applySmartFit } from '../services/diagram/smartFit';
import { computeSmartViewportDecision } from '../services/diagram/smartViewportFit';
import { buildAccessibleSummary, buildShortAriaDescription, type AccessibleSummary } from '../services/diagram/accessibleSummary';
import { buildInfiniteCanvasState } from '../services/diagram/infiniteCanvasService';
import { computeFocalBoundingBox, pickPrimaryFocus } from '../services/diagram/focusPrimaryFit';
import { assignEdgeAnchors } from '../services/diagram/edgeHandleAssignment';

/**
 * The canvas's own modules.
 *
 * This file had reached 2.715 lines. Layout, narrative scenes, group zones and
 * the legend now live in `./reactFlowCanvas/`; what stays here is the part that
 * actually needs React.
 *
 * The paint helpers and `AUTO_MINIMAP_THRESHOLD` are re-exported because tests
 * and sibling components import them from this path. The extraction changed
 * where the code lives, not this module's public shape — which is what let it
 * happen without touching a single call site.
 */
import {
    exportCanvasImage,
    type CanvasExportOptions,
    type ExportViewMode,
} from './reactFlowCanvas/canvasImageExport';
import {
    AUTO_MINIMAP_THRESHOLD,
    DiagramLegend,
    GroupZoneNode,
    NODE_HEIGHT,
    NODE_WIDTH,
    VIRTUALIZATION_THRESHOLD,
    applyNarrativeFocus,
    buildGroupZoneNodes,
    buildNarrativeScenes,
    calculateLayout,
    detectOptimalDirection,
    materializeNodesOnVisibleGrid,
    prepareEdgesForInitialPaint,
    prepareNodesForInitialPaint,
    type GroupKindHint,
    type LayoutPreset,
    type NarrativeScene,
} from './reactFlowCanvas';


/** How long a layout pass may run before the canvas reports it as stalled. */
const LAYOUT_STALL_DIAGNOSTIC_MS = 1500;
/** Same, for the paint that follows it. */
const DOM_RENDER_STALL_DIAGNOSTIC_MS = 1800;




interface ReactFlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  layoutHint?: 'TB' | 'LR';
  /** Visual theme applied to the canvas background. Defaults to editorial. */
  theme?: DiagramTheme;
  /** Density propagated to CustomNode (compact / standard / rich). */
  density?: DiagramDensity;
  /**
   * Optional change notifier fired on every edit that mutates nodes/edges
   * (create, delete, reconnect, relabel). Parent components may use it to
   * persist the round-tripped IR.
   */
  onChange?: (flow: { nodes: Node[]; edges: Edge[] }) => void;
  /**
   * Narrative payload for the cinematic presentation mode. The walk comes
   * from the IR's own story when it carries one; otherwise it is derived
   * from the graph. `scenes` used to be declared here and was passed by
   * nobody and read by nobody — the story lives in the IR.
   */
  presentation?: {
    title?: string;
    summary?: string;
    ir?: DiagramIR;
  };
  /**
   * Whether the React Flow minimap is visible. Hidden by default so the
   * canvas stays focused on the artifact; surfaced on demand by the host.
   */
  showMiniMap?: boolean;
  /**
   * When true, the canvas trusts that the incoming `nodes` already carry
   * finite, externally-computed positions (e.g. from `irToReactFlowSmart`
   * with ELK) and SKIPS the internal Dagre layout pass. Critical so the
   * ELK plan that `useDiagramRendering` resolves asynchronously is not
   * overwritten by the synchronous Dagre fallback. The manual "Re-layout"
   * toolbar action still runs Dagre on demand.
   */
  preserveExternalLayout?: boolean;
  /**
   * Layout plan that produced the incoming positions. Surfaced in the
   * toolbar tooltip / observability panel so the user can see whether the
   * canvas is rendering an ELK plan, a dagre fallback, or has no plan.
   * Used only for display; positions are still taken from `nodes`.
   */
  externalLayoutPlan?: {
    backend: 'dagre' | 'elk';
    algorithm?: string;
    direction?: 'TB' | 'LR' | 'BT' | 'RL';
    density?: 'compact' | 'normal' | 'spacious';
    orthogonal?: boolean;
    rationale?: string;
    computedAt?: string;
  } | null;
  /**
   * Gap 4 — fired after the canvas commits a new layout with real positions.
   * Receives node rectangles, optional group rectangles, the bounding box
   * and the current layout plan so callers (the diagram quality service,
   * preflight, export modal) can lint the actual rendered layout instead
   * of an IR-only approximation. Debounced upstream; safe to leave the
   * handler stable across renders.
   *
   * Gap-extension: the snapshot also includes the real *useful* viewport
   * (excluding toolbars/minimap/inspector), floating obstacles (panels
   * that visually cover part of the canvas) and edge segments with
   * waypoints when available, so `analyzeDiagramQuality` can detect
   * off-screen nodes, panel-obscured nodes and edges that cross nodes
   * orthogonally.
   */
  onLayoutQualityComputed?: (snapshot: {
    nodeRects: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    groupRects: Array<{ id: string; label: string; x: number; y: number; width: number; height: number; memberIds?: string[] }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    viewport?: { x: number; y: number; width: number; height: number };
    floatingObstacles?: Array<{ x: number; y: number; width: number; height: number; label?: string }>;
    edgeSegments?: Array<{ id: string; source: string; target: string; waypoints: Array<{ x: number; y: number }> }>;
    smartViewport?: {
      readable: boolean;
      showExploreHint: boolean;
      showViewAllSecondary: boolean;
      reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
    };
    canvasState?: {
      visibleViewport: { minX: number; minY: number; maxX: number; maxY: number };
      contentBounds: { minX: number; minY: number; maxX: number; maxY: number };
      logicalCanvasBounds: { minX: number; minY: number; maxX: number; maxY: number };
      safeInteractionBounds: { minX: number; minY: number; maxX: number; maxY: number };
      exportBounds: { minX: number; minY: number; maxX: number; maxY: number };
    };
    layoutPlan: ReactFlowCanvasProps['externalLayoutPlan'];
  }) => void;
}

export type { ExportViewMode };

export interface ReactFlowCanvasHandle {
    /**
     * Capture the canvas as PNG or SVG.
     *
     * Gap 2 — supports `view`:
     *   - `useful`    (default) crops to the real bounding box of the nodes
     *                 with a professional padding (no toolbar/minimap/panel
     *                 capture; no excessive empty space).
     *   - `current`   captures exactly what is on screen at the user's
     *                 current zoom/pan (no fitBounds).
     *   - `executive` / `technical` capture the same bounding box as
     *                 `useful` but bias the fit to the audience-projected
     *                 subgraph when one is present.
     *   - `full`      captures the entire canvas with extra padding so even
     *                 partially clipped boundaries stay inside the frame.
     *
     * `scale` (1×/2×/3×) controls pixel ratio for PNG; ignored for SVG.
     */
    exportImage: (format: 'png' | 'svg', options?: { scale?: 1 | 2 | 3; view?: ExportViewMode; frame?: boolean; legend?: boolean }) => Promise<string | null>;
    getFlowData: () => { nodes: Node[], edges: Edge[] };
    /** Undo last mutation. Returns true when a step was popped. */
    undo: () => boolean;
    /** Redo most recently undone mutation. Returns true when a step was pushed. */
    redo: () => boolean;
    /** Open the cinematic presentation overlay. */
    startPresentation: () => void;
    /** Close the cinematic presentation overlay. */
    stopPresentation: () => void;
    /** Zoom the viewport in by one step. */
    zoomIn: () => void;
    /** Zoom the viewport out by one step. */
    zoomOut: () => void;
    /** Fit the whole graph into the viewport. */
    fitToScreen: () => void;
    /** Center and gently zoom on the graph. */
    centerGraph: () => void;
    /**
     * Toggle the focus-primary mode imperatively (Brecha 4: lets the quality
     * panel apply the `APPLY_FOCUS_PRIMARY_FIT` auto-action). The canvas
     * decides which nodes are focal by hierarchy hints or graph centrality
     * and dims the rest.
     */
    toggleFocusPrimary: () => void;
}


const ReactFlowCanvas = forwardRef<ReactFlowCanvasHandle, ReactFlowCanvasProps>(({ nodes: initialNodes, edges: initialEdges, layoutHint, theme = 'editorial', density = 'standard', onChange, presentation, showMiniMap = false, preserveExternalLayout = false, externalLayoutPlan = null, onLayoutQualityComputed }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const reactFlowInstance = useReactFlow();
    const { fitView, zoomIn, zoomOut } = reactFlowInstance;

    /**
     * Smart-fit wrapper: clamps zoom to a comfortable readability window
     * (default 0.45–1.35) and centres the bbox so narrow strips on wide
     * viewports no longer render as tiny columns in a corner. Falls back to
     * ReactFlow's stock `fitView` when smart-fit can't compute (no content
     * yet, or container not measurable).
     */
    // Last viewport applied by an automatic fit. Used by the resize handler
    // to decide whether the user has manually panned/zoomed since: we only
    // re-frame on container resize while the view is still "ours".
    const lastAutoFitViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

    const runSmartFit = useCallback((duration = 400, attempt = 0) => {
        try {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
                const decision = computeSmartViewportDecision(
                    reactFlowInstance.getNodes(),
                    { viewportWidth: rect.width, viewportHeight: rect.height, hasFloatingPanels: true },
                    { minZoom: 0.5, topReserve: 24, bottomReserve: 110 },
                );
                setSmartViewportHint({
                    explore: decision.showExploreHint,
                    viewAllSecondary: decision.showViewAllSecondary,
                    reason: decision.reason,
                });
            }
        } catch {
            // viewport hint is non-blocking
        }
        const applied = applySmartFit(reactFlowInstance, containerRef.current, { duration });
        if (applied === null) {
            // Smart-fit could not compute: either there is no content yet or
            // the container is not measurable (animated parents report a
            // 0×0 rect for a few frames). Retry on subsequent frames before
            // surrendering to the stock fitView, so the first impression is
            // always a properly framed diagram instead of a tiny strip.
            if (attempt < 8 && reactFlowInstance.getNodes().some((n) => n.type !== 'groupZone')) {
                window.requestAnimationFrame(() => runSmartFit(duration, attempt + 1));
                return;
            }
            fitView({ padding: 0.15, duration });
            return;
        }
        lastAutoFitViewportRef.current = applied;
    }, [reactFlowInstance, fitView]);

    const normalizedDensity = density as DiagramDensity;

    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
    const [inspectorPinned, setInspectorPinned] = useState(false);
    const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR' | 'auto'>('auto');
    const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('normal');
    const [showLegend, setShowLegend] = useState(false);
    const [storyMode, setStoryMode] = useState(false);
    const [storyStep, setStoryStep] = useState(0);
    const [storyScenes, setStoryScenes] = useState<NarrativeScene[]>([]);
    const [presentationOpen, setPresentationOpen] = useState(false);
    const [a11yOpen, setA11yOpen] = useState(false);
    const [smartViewportHint, setSmartViewportHint] = useState<{ explore: boolean; viewAllSecondary: boolean; reason?: string }>({ explore: false, viewAllSecondary: false });
    const [focusPrimaryActive, setFocusPrimaryActive] = useState(false);

    
    const focusNeighbors = useCallback(() => {
        if (!selectedNode) return;
        const neighborIds = new Set<string>([selectedNode.id]);
        edges.forEach((e) => {
            if (e.source === selectedNode.id) neighborIds.add(e.target);
            if (e.target === selectedNode.id) neighborIds.add(e.source);
        });
        setNodes((prev) => prev.map((n) => ({ ...n, data: { ...(n.data ?? {}), isDimmed: !neighborIds.has(n.id), isNarrativeFocus: neighborIds.has(n.id) } })));
        setEdges((prev) => prev.map((e) => ({ ...e, data: { ...(e.data ?? {}), isDimmed: !(neighborIds.has(e.source) && neighborIds.has(e.target)), isNarrativeFocus: neighborIds.has(e.source) && neighborIds.has(e.target) } })));
    }, [selectedNode, edges, setNodes, setEdges]);

    const clearFocusFilters = useCallback(() => {
        setNodes((prev) => prev.map((n) => ({ ...n, data: { ...(n.data ?? {}), isDimmed: false, isNarrativeFocus: false } })));
        setEdges((prev) => prev.map((e) => ({ ...e, data: { ...(e.data ?? {}), isDimmed: false, isNarrativeFocus: false } })));
    }, [setNodes, setEdges]);

    /**
     * Focus-primary mode (Mejoras 2/3/6): when the smart viewport flags the
     * diagram as too sprawling to be readable at one zoom level, this picks
     * the focal subset (by hierarchy hints or graph centrality), dims the
     * rest and fits the viewport to the focal bbox. A second click clears
     * the dim and runs the smart fit so the user can step back to the
     * canvas-wide view.
     */
    const toggleFocusPrimary = useCallback(() => {
        if (focusPrimaryActive) {
            clearFocusFilters();
            setFocusPrimaryActive(false);
            window.requestAnimationFrame(() => runSmartFit(320));
            return;
        }
        const currentNodes = reactFlowInstance.getNodes();
        const currentEdges = reactFlowInstance.getEdges();
        const result = pickPrimaryFocus(currentNodes, currentEdges);
        if (result.focalIds.size === 0) return;
        const focalEdgeIds = new Set<string>();
        for (const edge of currentEdges) {
            if (result.focalIds.has(String(edge.source)) && result.focalIds.has(String(edge.target))) {
                focalEdgeIds.add(String(edge.id));
            }
        }
        setNodes((prev) => prev.map((node) => ({
            ...node,
            data: {
                ...(node.data ?? {}),
                isDimmed: node.type === 'groupZone' ? false : !result.focalIds.has(String(node.id)),
                isNarrativeFocus: result.focalIds.has(String(node.id)),
            },
        })));
        setEdges((prev) => prev.map((edge) => ({
            ...edge,
            data: {
                ...(edge.data ?? {}),
                isDimmed: !focalEdgeIds.has(String(edge.id)),
                isNarrativeFocus: focalEdgeIds.has(String(edge.id)),
            },
        })));
        setFocusPrimaryActive(true);
        const bbox = computeFocalBoundingBox(currentNodes, result.focalIds);
        if (bbox && typeof reactFlowInstance.fitBounds === 'function') {
            try {
                reactFlowInstance.fitBounds({ x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height }, { padding: 0.18, duration: 320 });
            } catch {
                runSmartFit(320);
            }
        } else {
            runSmartFit(320);
        }
    }, [focusPrimaryActive, reactFlowInstance, setNodes, setEdges, clearFocusFilters, runSmartFit]);

    const nodeTypes = useMemo(() => ({ custom: CustomNode, groupZone: GroupZoneNode }), []);
    const edgeTypes = useMemo(() => ({ custom: CustomEdge }), []);

    // Cache `defaultEdgeOptions` so ReactFlow doesn't see a fresh object on
    // every render; this prevents needless edge-redrawn work on hover/zoom.
    const defaultEdgeOptions = useMemo(() => ({
        type: 'custom' as const,
        markerEnd: {
            type: MarkerType.ArrowClosed,
            width: MARKER_TOKENS.default.width,
            height: MARKER_TOKENS.default.height,
        },
    }), []);

    // Virtualise rendering once the graph crosses the threshold — keeps
    // pan/zoom smooth on dense C4 Container/Component diagrams.
    const enableVirtualization = nodes.length >= VIRTUALIZATION_THRESHOLD;

    // Compute the legend rows from the types actually present on the canvas
    // so the legend never advertises categories the user can't see. Keeps a
    // stable reference so the legend doesn't re-render on hover / pan.
    const legendData = useMemo<{ nodeTypes: NodeSemanticType[]; edgeRelations: string[]; edgeTypes: EdgeSemanticType[] }>(() => {
        const nodeTypes = new Set<NodeSemanticType>();
        for (const node of nodes) {
            const data = (node.data ?? {}) as { semanticType?: NodeSemanticType };
            if (data.semanticType) nodeTypes.add(data.semanticType);
        }
        const edgeRelations = new Set<string>();
        const edgeTypes = new Set<EdgeSemanticType>();
        for (const edge of edges) {
            const data = (edge.data ?? {}) as { edgeType?: string; semanticType?: EdgeSemanticType };
            edgeRelations.add(data.edgeType ?? 'default');
            if (data.semanticType) edgeTypes.add(data.semanticType);
        }
        return {
            nodeTypes: Array.from(nodeTypes),
            edgeRelations: Array.from(edgeRelations),
            edgeTypes: Array.from(edgeTypes),
        };
    }, [nodes, edges]);

    // Group-kind hints lifted from the IR: maps `group.label` → semantic
    // kind so the renderer can paint each boundary with its semantic
    // palette (data zones green, security boundaries red, etc.) instead
    // of cycling colours blindly.
    const groupHints = useMemo<Map<string, GroupKindHint>>(() => {
        const m = new Map<string, GroupKindHint>();
        const groups = presentation?.ir?.groups ?? [];
        for (const g of groups) {
            m.set(g.label, {
                label: g.label,
                kind: g.kind,
                // Gap 7: carry the full semantic metadata to the group zone
                // so a round-trip back to IR (via `toDiagramIR`) can recover
                // purpose, boundaryType, owner and trust from the canvas.
                purpose: g.purpose,
                boundaryType: g.boundaryType,
                owner: g.owner,
                trust: g.trust,
                id: g.id,
            });
        }
        return m;
    }, [presentation?.ir?.groups]);

    // Accessible diagram summary: a plain-text alternative for screen
    // readers, also surfaced in the "Descripción accesible" dialog.
    // Computed from the IR (when present) so the summary reflects the
    // canonical semantic model rather than the noisy ReactFlow graph.
    const accessibleSummary = useMemo<AccessibleSummary | null>(() => {
        if (!presentation?.ir) return null;
        try {
            return buildAccessibleSummary(presentation.ir, { audience: presentation.ir.metadata?.audience });
        } catch {
            return null;
        }
    }, [presentation?.ir]);
    const shortAriaDescription = useMemo<string>(() => {
        if (!presentation?.ir) return 'Diagrama de arquitectura interactivo. Navega con el ratón o el teclado para inspeccionar elementos.';
        try {
            return buildShortAriaDescription(presentation.ir, presentation.ir.metadata?.audience);
        } catch {
            return 'Diagrama de arquitectura interactivo.';
        }
    }, [presentation?.ir]);

    // Dark mode tracking for theme-aware canvas background.
    const [isDark, setIsDark] = useState<boolean>(
        () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    );
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const observer = new MutationObserver(() => setIsDark(document.documentElement.classList.contains('dark')));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    const canvasBg = useMemo(() => {
        const themeMap = isDark ? CANVAS_BACKGROUND.dark : CANVAS_BACKGROUND.light;
        // Map theme → background variant. Whiteboard/monochrome/high-contrast
        // each pick their own preset; default theme falls back to editorial.
        const variant = theme === 'whiteboard' || theme === 'monochrome' || theme === 'high-contrast'
            ? themeMap[theme]
            : themeMap.editorial;
        return variant;
    }, [isDark, theme]);

    // --- Undo / Redo -------------------------------------------------------
    type FlowSnapshot = { nodes: Node[]; edges: Edge[] };
    const undoStack = useRef<FlowSnapshot[]>([]);
    const redoStack = useRef<FlowSnapshot[]>([]);
    const snapshotLimit = 50;
    const applyingHistoryRef = useRef(false);
    const pushSnapshot = useCallback((snapshot: FlowSnapshot) => {
        if (applyingHistoryRef.current) return;
        undoStack.current.push(snapshot);
        if (undoStack.current.length > snapshotLimit) undoStack.current.shift();
        redoStack.current.length = 0;
    }, []);
    const notifyChange = useCallback((next: FlowSnapshot) => {
        if (onChange && !applyingHistoryRef.current) onChange(next);
    }, [onChange]);

    const applyScene = useCallback((
        layoutedNodes: Node[],
        layoutedEdges: Edge[],
        zones: Node[],
        scenes: NarrativeScene[],
        step: number,
        enabled: boolean,
    ) => {
        const scene = enabled ? scenes[Math.max(0, Math.min(step, scenes.length - 1))] ?? null : null;
        const mergedNodes = [...zones, ...layoutedNodes];
        // Single choke point for geometric edge anchoring: every layout path
        // (immediate paint, dagre pass, manual re-layout, density change)
        // flows through here, so edges always exit through the side that
        // faces their counterpart.
        const anchoredEdges = assignEdgeAnchors(layoutedNodes, layoutedEdges);
        const focused = applyNarrativeFocus(mergedNodes, anchoredEdges, scene);
        setNodes(focused.nodes);
        setEdges(focused.edges);
    }, [setNodes, setEdges]);

    // Expose imperative API
    useImperativeHandle(ref, () => ({
        // The capture pipeline lives in `./reactFlowCanvas/canvasImageExport`;
        // what stays here is the wiring, which is all a ref handle should be.
        exportImage: (format: 'png' | 'svg', exportOptions?: CanvasExportOptions) => exportCanvasImage(
            format,
            exportOptions,
            { nodes, reactFlowInstance, fitView, canvasBg, presentation, isDark },
        ),
        getFlowData: () => {
            return { nodes: nodes.filter(n => n.type !== 'groupZone'), edges };
        },
        undo: () => {
            const prev = undoStack.current.pop();
            if (!prev) return false;
            applyingHistoryRef.current = true;
            redoStack.current.push({ nodes, edges });
            setNodes(prev.nodes);
            setEdges(prev.edges);
            queueMicrotask(() => { applyingHistoryRef.current = false; });
            if (onChange) onChange({ nodes: prev.nodes.filter(n => n.type !== 'groupZone'), edges: prev.edges });
            return true;
        },
        redo: () => {
            const next = redoStack.current.pop();
            if (!next) return false;
            applyingHistoryRef.current = true;
            undoStack.current.push({ nodes, edges });
            setNodes(next.nodes);
            setEdges(next.edges);
            queueMicrotask(() => { applyingHistoryRef.current = false; });
            if (onChange) onChange({ nodes: next.nodes.filter(n => n.type !== 'groupZone'), edges: next.edges });
            return true;
        },
        startPresentation: () => setPresentationOpen(true),
        stopPresentation: () => setPresentationOpen(false),
        zoomIn: () => { void zoomIn({ duration: 200 }); },
        zoomOut: () => { void zoomOut({ duration: 200 }); },
        fitToScreen: () => { runSmartFit(320); },
        centerGraph: () => { runSmartFit(320); },
        toggleFocusPrimary: () => { toggleFocusPrimary(); },
    }));

    // Cinematic presentation: dim non-focus nodes/edges in response to scene changes.
    const handlePresentationSceneChange = useCallback((focus: { nodeIds: Set<string>; edgeIds: Set<string> } | null) => {
        if (!focus) {
            setNodes((current) => current.map((node) => ({
                ...node,
                data: { ...(node.data ?? {}), isDimmed: false, isNarrativeFocus: false },
            })));
            setEdges((current) => current.map((edge) => ({
                ...edge,
                data: { ...(edge.data ?? {}), isDimmed: false, isNarrativeFocus: false },
            })));
            return;
        }
        setNodes((current) => current.map((node) => ({
            ...node,
            data: {
                ...(node.data ?? {}),
                isDimmed: node.type === 'groupZone' ? false : !focus.nodeIds.has(node.id),
                isNarrativeFocus: focus.nodeIds.has(node.id),
            },
        })));
        setEdges((current) => current.map((edge) => ({
            ...edge,
            data: {
                ...(edge.data ?? {}),
                isDimmed: !focus.edgeIds.has(edge.id),
                isNarrativeFocus: focus.edgeIds.has(edge.id),
            },
        })));
    }, [setNodes, setEdges]);

    // Track whether we've done the initial fitView / emergency recovery for the current data set.
    const initialFitDoneRef = useRef(false);
    const domRecoveryAttemptsRef = useRef(0);

    // Effect to handle data updates and layouting
    useEffect(() => {
        initialFitDoneRef.current = false; // Reset on data change
        domRecoveryAttemptsRef.current = 0;
        // Mejoras 2/3/6: focus-primary is a per-diagram explicit choice; when a
        // new artifact loads we drop it so the new diagram opens in its full
        // state rather than inheriting a dim/focus filter from a previous one.
        setFocusPrimaryActive(false);

        if (!initialNodes || initialNodes.length === 0) {
            setNodes([]);
            setEdges([]);
            return;
        }

        // Sanitize nodes/edges once and paint immediately. The async layout pass
        // below improves placement, but rendering must not depend on a timer: in
        // Vercel/prod we have seen animated parents and keyed remounts cancel the
        // timer repeatedly, leaving users with the exact diagnostic shown in the
        // reported screenshot (IR nodes > 0, ReactFlow nodes > 0, screen empty).
        const safeNodes = prepareNodesForInitialPaint(initialNodes, normalizedDensity);
        const nodeIds = new Set(safeNodes.map(n => n.id));
        const safeEdges = prepareEdgesForInitialPaint(initialEdges || [], nodeIds);
        const immediateZones = buildGroupZoneNodes(safeNodes, groupHints);
        const immediateScenes = buildNarrativeScenes(safeNodes, safeEdges, presentation?.ir);
        setStoryScenes(immediateScenes);
        setStoryStep(0);
        applyScene(safeNodes, safeEdges, immediateZones, immediateScenes, 0, storyMode);

        // Layout calculation. This is now an enhancement over a guaranteed
        // visible first paint, not a prerequisite for the artifact to appear.
        //
        // Gap 1: when the caller passes pre-positioned nodes (typically from
        // `irToReactFlowSmart` with ELK), `preserveExternalLayout` skips the
        // Dagre pass entirely so the external plan is not overwritten. Each
        // incoming node must already carry a finite position — the safety
        // sanitisation above grids any stragglers, so the canvas always
        // renders even if ELK partially failed.
        if (preserveExternalLayout) {
            // Just run smart-fit on the already-positioned nodes.
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    runSmartFit(600);
                });
            });
            return;
        }

        const diagramTitle = presentation?.ir?.metadata?.title ?? presentation?.title;
        const layoutTimer = setTimeout(() => {
            const direction = layoutHint || (layoutDirection === 'auto' ? detectOptimalDirection(safeNodes, safeEdges, { title: diagramTitle }) : layoutDirection);
            const { nodes: layoutedNodes, edges: layoutedEdges } = calculateLayout(safeNodes, safeEdges, direction, layoutPreset);
            const zoneNodes = buildGroupZoneNodes(layoutedNodes, groupHints);
            const scenes = buildNarrativeScenes(layoutedNodes, layoutedEdges, presentation?.ir);
            setStoryScenes(scenes);
            setStoryStep(0);
            applyScene(layoutedNodes, layoutedEdges, zoneNodes, scenes, 0, storyMode);

            // Double rAF ensures React has committed the new nodes to the DOM
            // before the fit pass measures the viewport — critical inside
            // animated containers. Smart-fit clamps zoom into a readable
            // window so a narrow vertical strip on an iPad landscape no
            // longer paints as a 10% column on the left.
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    runSmartFit(600);
                });
            });
        }, 10);

        return () => clearTimeout(layoutTimer);

    }, [initialNodes, initialEdges, layoutHint, layoutDirection, layoutPreset, setNodes, setEdges, fitView, applyScene, storyMode, normalizedDensity, runSmartFit, presentation?.title, presentation?.ir, groupHints, preserveExternalLayout]);

    // Backup smart-fit: runs once after nodes state is committed (catches
    // the Lucidchart animated-container race condition where the layout
    // effect's rAF lands before React has measured the new DOM).
    useEffect(() => {
        if (nodes.length === 0 || initialFitDoneRef.current) return;
        initialFitDoneRef.current = true;
        const t = setTimeout(() => {
            runSmartFit(500);
        }, 300);
        return () => clearTimeout(t);
    }, [nodes, runSmartFit]);

    // Re-frame on container resize (iPad rotation, panel open/close,
    // fullscreen toggle) — but ONLY while the viewport still matches the
    // last automatic fit. The moment the user pans or zooms manually, the
    // comparison fails and we never fight their navigation.
    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        let debounce: number | null = null;
        let lastSize = { w: el.clientWidth, h: el.clientHeight };
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            if (width <= 0 || height <= 0) return;
            if (Math.abs(width - lastSize.w) < 8 && Math.abs(height - lastSize.h) < 8) return;
            lastSize = { w: width, h: height };
            if (debounce !== null) window.clearTimeout(debounce);
            debounce = window.setTimeout(() => {
                const auto = lastAutoFitViewportRef.current;
                if (!auto) return;
                const current = reactFlowInstance.getViewport();
                const untouched = Math.abs(current.zoom - auto.zoom) < 0.02
                    && Math.abs(current.x - auto.x) < 24
                    && Math.abs(current.y - auto.y) < 24;
                if (untouched) runSmartFit(240);
            }, 180);
        });
        observer.observe(el);
        return () => {
            if (debounce !== null) window.clearTimeout(debounce);
            observer.disconnect();
        };
    }, [reactFlowInstance, runSmartFit]);

    // Gap 4: publish a layout-quality snapshot whenever the canvas settles.
    // Includes the materialised node rectangles, group zone rectangles,
    // bounding box and the layout plan so callers can lint the layout
    // against real positions instead of the IR-only approximation. Heavy
    // debounce so we don't fire on every micro-update during drag.
    const lastSnapshotSignatureRef = useRef<string>('');
    useEffect(() => {
        if (!onLayoutQualityComputed) return;
        if (nodes.length === 0) return;
        const handle = setTimeout(() => {
            const contentNodes = nodes.filter((n) => n.type !== 'groupZone');
            const nodeRects = contentNodes
                .filter((n) => n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
                .map((n) => ({
                    id: String(n.id),
                    x: n.position.x,
                    y: n.position.y,
                    width: Number.isFinite(n.width as number) ? (n.width as number) : NODE_WIDTH,
                    height: Number.isFinite(n.height as number) ? (n.height as number) : NODE_HEIGHT,
                }));
            const groupRects = nodes
                .filter((n) => n.type === 'groupZone' && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
                .map((n) => {
                    const label = String((n.data as { label?: string })?.label ?? '');
                    const widthRaw = (n.style as { width?: number | string } | undefined)?.width;
                    const heightRaw = (n.style as { height?: number | string } | undefined)?.height;
                    const widthNum = typeof widthRaw === 'number' ? widthRaw : Number(widthRaw);
                    const heightNum = typeof heightRaw === 'number' ? heightRaw : Number(heightRaw);
                    return {
                        id: String(n.id),
                        label,
                        x: n.position.x,
                        y: n.position.y,
                        width: Number.isFinite(widthNum) ? widthNum : 0,
                        height: Number.isFinite(heightNum) ? heightNum : 0,
                        memberIds: contentNodes
                            .filter((c) => (c.data as { group?: string })?.group === label)
                            .map((c) => String(c.id)),
                    };
                });
            if (nodeRects.length === 0) return;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const r of nodeRects) {
                if (r.x < minX) minX = r.x;
                if (r.y < minY) minY = r.y;
                if (r.x + r.width > maxX) maxX = r.x + r.width;
                if (r.y + r.height > maxY) maxY = r.y + r.height;
            }
            const boundingBox = {
                x: minX,
                y: minY,
                width: Math.max(0, maxX - minX),
                height: Math.max(0, maxY - minY),
            };

            // Gap 1: capture the real *useful* viewport (the canvas rect
            // mapped to flow coordinates via project()) and the floating
            // obstacles that visually cover part of it (toolbar, controls,
            // minimap, panels, inspector, legend). Both are expressed in
            // flow coordinates so they can be compared against `nodeRects`.
            // Computed inside the snapshot effect so we don't touch the DOM
            // on every render.
            let viewport: { x: number; y: number; width: number; height: number } | undefined;
            let floatingObstacles: Array<{ x: number; y: number; width: number; height: number; label?: string }> | undefined;
            try {
                const containerEl = containerRef.current as HTMLElement | null;
                const flowEl = containerEl?.querySelector('.react-flow') as HTMLElement | null;
                const rfRect = flowEl?.getBoundingClientRect();
                const project = (reactFlowInstance as unknown as { project?: (p: { x: number; y: number }) => { x: number; y: number } }).project;
                if (rfRect && rfRect.width > 0 && rfRect.height > 0 && typeof project === 'function') {
                    const topLeft = project({ x: 0, y: 0 });
                    const bottomRight = project({ x: rfRect.width, y: rfRect.height });
                    viewport = {
                        x: topLeft.x,
                        y: topLeft.y,
                        width: Math.max(0, bottomRight.x - topLeft.x),
                        height: Math.max(0, bottomRight.y - topLeft.y),
                    };
                    // Identify floating obstacles by class — toolbar, controls,
                    // minimap, panels, inspector, legend. Skip anything whose
                    // rect is degenerate (display:none).
                    const obstacleSelectors: Array<{ sel: string; label: string }> = [
                        { sel: '.react-flow__controls',     label: 'Controles ReactFlow' },
                        { sel: '.react-flow__minimap',      label: 'Minimap' },
                        { sel: '.react-flow__panel',        label: 'Panel flotante' },
                        { sel: '.diagram-toolbar',          label: 'Toolbar inferior' },
                        { sel: '.diagram-editor-panel',     label: 'Inspector' },
                        { sel: '[data-canvas-obstacle]',    label: 'Panel flotante' },
                    ];
                    const seen = new Set<HTMLElement>();
                    const obstacles: Array<{ x: number; y: number; width: number; height: number; label?: string }> = [];
                    for (const { sel, label } of obstacleSelectors) {
                        const els = containerEl?.querySelectorAll(sel);
                        els?.forEach((el) => {
                            const h = el as HTMLElement;
                            if (seen.has(h)) return;
                            seen.add(h);
                            const r = h.getBoundingClientRect();
                            if (r.width <= 0 || r.height <= 0) return;
                            const labelOverride = h.getAttribute('data-canvas-obstacle-label') ?? label;
                            const screenTopLeft = project({ x: r.left - rfRect.left, y: r.top - rfRect.top });
                            const screenBottomRight = project({ x: r.right - rfRect.left, y: r.bottom - rfRect.top });
                            obstacles.push({
                                x: screenTopLeft.x,
                                y: screenTopLeft.y,
                                width: Math.max(0, screenBottomRight.x - screenTopLeft.x),
                                height: Math.max(0, screenBottomRight.y - screenTopLeft.y),
                                label: labelOverride,
                            });
                        });
                    }
                    floatingObstacles = obstacles.length > 0 ? obstacles : undefined;
                }
            } catch {
                // DOM/jsdom limits or missing project() — leave viewport/
                // obstacles undefined and let the analyser fall back to the
                // legacy IR-only path. We never want to block snapshot
                // emission because of a measurement glitch.
            }

            // Gap 1: edge segments. ReactFlow custom edges produce SVG
            // paths via getBezierPath/getSmoothStepPath, so we don't always
            // have explicit waypoints. We do however have source/target
            // positions, which yields a 2-point segment that the analyser
            // already supports. Callers that compute orthogonal routes can
            // override this list later.
            const rectById = new Map(nodeRects.map((r) => [r.id, r] as const));
            const edgeSegments = edges
                .map((e) => {
                    const s = rectById.get(String(e.source));
                    const t = rectById.get(String(e.target));
                    if (!s || !t) return null;
                    return {
                        id: String(e.id),
                        source: String(e.source),
                        target: String(e.target),
                        waypoints: [
                            { x: s.x + s.width / 2, y: s.y + s.height / 2 },
                            { x: t.x + t.width / 2, y: t.y + t.height / 2 },
                        ],
                    };
                })
                .filter((s): s is { id: string; source: string; target: string; waypoints: Array<{ x: number; y: number }> } => s !== null);

            // Debounce by signature: re-emit only when positions/identity
            // actually changed (avoids firing on hover / dim state). Viewport
            // changes (zoom/pan) intentionally do NOT bust the signature —
            // we re-fire on pan/zoom via a separate effect to keep this one
            // cheap.
            const signature = JSON.stringify({
                nodes: nodeRects.map((r) => `${r.id}:${Math.round(r.x)},${Math.round(r.y)}`),
                groups: groupRects.map((g) => `${g.id}:${Math.round(g.x)},${Math.round(g.y)}`),
                plan: externalLayoutPlan
                    ? `${externalLayoutPlan.backend}-${externalLayoutPlan.algorithm ?? ''}-${externalLayoutPlan.direction ?? ''}-${externalLayoutPlan.density ?? ''}`
                    : '',
                vp: viewport ? `${Math.round(viewport.x)},${Math.round(viewport.y)},${Math.round(viewport.width)},${Math.round(viewport.height)}` : '',
                ob: floatingObstacles ? floatingObstacles.length : 0,
            });
            if (lastSnapshotSignatureRef.current === signature) return;
            lastSnapshotSignatureRef.current = signature;
            const vp = viewport
                ? { minX: viewport.x, minY: viewport.y, maxX: viewport.x + viewport.width, maxY: viewport.y + viewport.height }
                : { minX: boundingBox.x - 200, minY: boundingBox.y - 200, maxX: boundingBox.x + boundingBox.width + 200, maxY: boundingBox.y + boundingBox.height + 200 };
            const cb = { minX: boundingBox.x, minY: boundingBox.y, maxX: boundingBox.x + boundingBox.width, maxY: boundingBox.y + boundingBox.height };
            const canvasState = buildInfiniteCanvasState(vp, cb);

            onLayoutQualityComputed({
                nodeRects,
                groupRects,
                boundingBox,
                viewport,
                floatingObstacles,
                edgeSegments: edgeSegments.length > 0 ? edgeSegments : undefined,
                smartViewport: {
                    readable: !smartViewportHint.explore || !smartViewportHint.viewAllSecondary,
                    showExploreHint: smartViewportHint.explore,
                    showViewAllSecondary: smartViewportHint.viewAllSecondary,
                    reason: (smartViewportHint.reason as 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small' | undefined) ?? 'ok',
                },
                canvasState,
                layoutPlan: externalLayoutPlan,
            });
        }, 250);
        return () => clearTimeout(handle);
    }, [nodes, edges, externalLayoutPlan, onLayoutQualityComputed, reactFlowInstance, smartViewportHint]);

    const onLayout = useCallback((direction: 'TB' | 'LR') => {
        setLayoutDirection(direction);
        pushSnapshot({ nodes, edges });
        const contentNodes = nodes.filter(n => n.type !== 'groupZone');
        const { nodes: layoutedNodes, edges: layoutedEdges } = calculateLayout(contentNodes, edges, direction, layoutPreset);
        const zoneNodes = buildGroupZoneNodes(layoutedNodes, groupHints);
        const scenes = buildNarrativeScenes(layoutedNodes, layoutedEdges, presentation?.ir);
        setStoryScenes(scenes);
        setStoryStep(0);
        applyScene(layoutedNodes, layoutedEdges, zoneNodes, scenes, 0, storyMode);
        // Persist the rearrangement: an explicit re-layout is an edit the
        // architect expects to survive a reload, just like a manual drag.
        notifyChange({ nodes: layoutedNodes, edges: layoutedEdges });
        window.requestAnimationFrame(() => runSmartFit(500));
    }, [nodes, edges, layoutPreset, applyScene, storyMode, runSmartFit, groupHints, presentation?.ir, pushSnapshot, notifyChange]);

    const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNode(node);
        setSelectedEdge(null);
    }, []);

    const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
        setSelectedEdge(edge);
        setSelectedNode(null);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
        setSelectedEdge(null);
    }, []);

    // Manual repositioning round-trip (Top 1): snapshot the pre-drag state
    // for undo, then — when the drag ends — refresh the group zones around
    // the new geometry and notify the host so the positions persist in the
    // artifact IR. Without this, every manual adjustment was lost on reload.
    const onNodeDragStart = useCallback(() => {
        pushSnapshot({ nodes, edges });
    }, [nodes, edges, pushSnapshot]);

    const onNodeDragStop = useCallback(() => {
        const current = reactFlowInstance.getNodes();
        const contentNodes = current.filter((n) => n.type !== 'groupZone');
        const zones = buildGroupZoneNodes(contentNodes, groupHints);
        setNodes([...zones, ...contentNodes]);
        // Re-anchor edges to the new geometry so connections keep leaving
        // through the side that faces their counterpart after the drag.
        const reanchored = assignEdgeAnchors(contentNodes, edges);
        if (reanchored !== edges) setEdges(reanchored);
        notifyChange({ nodes: contentNodes, edges: reanchored });
    }, [reactFlowInstance, groupHints, setNodes, setEdges, notifyChange, edges]);

    // Deletion round-trip: ReactFlow applies the removal to its own state via
    // onNodesChange/onEdgesChange; these callbacks make it durable (snapshot
    // for undo + zone refresh + notify) so a deleted node never reappears on
    // reload. A node deletion also cascades its edges, firing both callbacks
    // in the same tick — the timestamp guard keeps a single undo entry.
    const deletionSnapshotAtRef = useRef(0);
    const snapshotOnceForDeletion = useCallback(() => {
        const now = Date.now();
        if (now - deletionSnapshotAtRef.current < 200) return;
        deletionSnapshotAtRef.current = now;
        pushSnapshot({ nodes, edges });
    }, [nodes, edges, pushSnapshot]);

    const commitCanvasTopologyEdit = useCallback(() => {
        // Wait one frame so ReactFlow has committed the removal before we
        // read its state back; otherwise we'd persist the pre-delete graph.
        window.requestAnimationFrame(() => {
            const contentNodes = reactFlowInstance.getNodes().filter((n) => n.type !== 'groupZone');
            const currentEdges = reactFlowInstance.getEdges();
            const zones = buildGroupZoneNodes(contentNodes, groupHints);
            setNodes([...zones, ...contentNodes]);
            notifyChange({ nodes: contentNodes, edges: currentEdges });
        });
    }, [reactFlowInstance, groupHints, setNodes, notifyChange]);

    const onNodesDelete = useCallback(() => {
        snapshotOnceForDeletion();
        setSelectedNode(null);
        commitCanvasTopologyEdit();
    }, [snapshotOnceForDeletion, commitCanvasTopologyEdit]);

    const onEdgesDelete = useCallback(() => {
        snapshotOnceForDeletion();
        setSelectedEdge(null);
        commitCanvasTopologyEdit();
    }, [snapshotOnceForDeletion, commitCanvasTopologyEdit]);

    // Edge reconnection: drag an edge endpoint onto another handle/node.
    const onEdgeUpdate = useCallback((oldEdge: Edge, newConnection: Connection) => {
        if (!newConnection.source || !newConnection.target) return;
        pushSnapshot({ nodes, edges });
        setEdges((eds) => {
            const next = updateEdge(oldEdge, newConnection, eds);
            notifyChange({ nodes: nodes.filter(n => n.type !== 'groupZone'), edges: next });
            return next;
        });
    }, [nodes, edges, pushSnapshot, setEdges, notifyChange]);

    /** Create a fresh node at the visual centre of the viewport and select it. */
    const addNewNode = useCallback(() => {
        pushSnapshot({ nodes, edges });
        const id = `node-${Date.now().toString(36)}`;
        let position = { x: 80, y: 80 };
        try {
            const rect = containerRef.current?.getBoundingClientRect();
            const project = (reactFlowInstance as unknown as { project?: (p: { x: number; y: number }) => { x: number; y: number } }).project;
            if (rect && rect.width > 0 && typeof project === 'function') {
                position = project({ x: rect.width / 2, y: rect.height / 2 });
            }
        } catch { /* keep the default position */ }
        const newNode: Node = {
            id,
            type: 'custom',
            position,
            selected: true,
            data: {
                label: 'Nuevo componente',
                kind: 'Component',
                type: 'Component',
                description: '',
                density: normalizedDensity,
            },
        };
        setNodes((nds) => {
            const next = [...nds.map((n) => ({ ...n, selected: false })), newNode];
            notifyChange({ nodes: next.filter((n) => n.type !== 'groupZone'), edges });
            return next;
        });
        setSelectedNode(newNode);
        setSelectedEdge(null);
    }, [nodes, edges, pushSnapshot, reactFlowInstance, normalizedDensity, setNodes, notifyChange]);

    /** Clone the selected node 48px down-right and select the copy. */
    const duplicateSelectedNode = useCallback(() => {
        if (!selectedNode || selectedNode.type === 'groupZone') return;
        pushSnapshot({ nodes, edges });
        const clone: Node = {
            ...selectedNode,
            id: `${selectedNode.id}-copia-${Date.now().toString(36)}`,
            position: {
                x: (selectedNode.position?.x ?? 0) + 48,
                y: (selectedNode.position?.y ?? 0) + 48,
            },
            selected: true,
            data: {
                ...(selectedNode.data ?? {}),
                label: `${String((selectedNode.data as { label?: string })?.label ?? 'Componente')} (copia)`,
            },
        };
        setNodes((nds) => {
            const next = [...nds.map((n) => ({ ...n, selected: false })), clone];
            notifyChange({ nodes: next.filter((n) => n.type !== 'groupZone'), edges });
            return next;
        });
        setSelectedNode(clone);
        setSelectedEdge(null);
    }, [selectedNode, nodes, edges, pushSnapshot, setNodes, notifyChange]);

    const onConnect = useCallback((params: Connection) => {
        pushSnapshot({ nodes, edges });
        setEdges((eds) => {
            const next = addEdge({
                ...params,
                type: 'custom',
                markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' }
            }, eds);
            notifyChange({ nodes: nodes.filter(n => n.type !== 'groupZone'), edges: next });
            return next;
        });
    }, [setEdges, nodes, edges, pushSnapshot, notifyChange]);

    const updateNodeData = (id: string, newData: Record<string, unknown>) => {
        pushSnapshot({ nodes, edges });
        setNodes((nds) => {
            const next = nds.map((node) => {
                if (node.id === id) {
                    const updatedNode = { ...node, data: { ...node.data, ...newData } };
                    if (selectedNode?.id === id) setSelectedNode(updatedNode);
                    return updatedNode;
                }
                return node;
            });
            notifyChange({ nodes: next.filter(n => n.type !== 'groupZone'), edges });
            return next;
        });
    };

    const updateEdgeData = (id: string, newData: Record<string, unknown>) => {
        pushSnapshot({ nodes, edges });
        setEdges((eds) => {
            const next = eds.map((edge) => {
                if (edge.id === id) {
                    const updatedEdge = { ...edge, ...newData };
                    if (selectedEdge?.id === id) setSelectedEdge(updatedEdge);
                    return updatedEdge;
                }
                return edge;
            });
            notifyChange({ nodes: nodes.filter(n => n.type !== 'groupZone'), edges: next });
            return next;
        });
    };

    const applyStoryState = useCallback((enabled: boolean, nextStep: number) => {
        const scene = enabled ? storyScenes[Math.max(0, Math.min(nextStep, storyScenes.length - 1))] ?? null : null;
        const focused = applyNarrativeFocus(nodes, edges, scene);
        setNodes(focused.nodes);
        setEdges(focused.edges);
    }, [storyScenes, nodes, edges, setNodes, setEdges]);

    // Local undo/redo handlers the toolbar wires to; kept in sync with the
    // imperative handle so keyboard shortcuts and UI buttons share semantics.
    const handleUndo = useCallback(() => {
        const prev = undoStack.current.pop();
        if (!prev) return;
        applyingHistoryRef.current = true;
        redoStack.current.push({ nodes, edges });
        setNodes(prev.nodes);
        setEdges(prev.edges);
        queueMicrotask(() => { applyingHistoryRef.current = false; });
        if (onChange) onChange({ nodes: prev.nodes.filter(n => n.type !== 'groupZone'), edges: prev.edges });
    }, [nodes, edges, setNodes, setEdges, onChange]);

    const handleRedo = useCallback(() => {
        const next = redoStack.current.pop();
        if (!next) return;
        applyingHistoryRef.current = true;
        undoStack.current.push({ nodes, edges });
        setNodes(next.nodes);
        setEdges(next.edges);
        queueMicrotask(() => { applyingHistoryRef.current = false; });
        if (onChange) onChange({ nodes: next.nodes.filter(n => n.type !== 'groupZone'), edges: next.edges });
    }, [nodes, edges, setNodes, setEdges, onChange]);

    // Keyboard shortcuts: ← / → for narrative scenes when story mode is on,
    // F for fit-view, Esc to clear selection, Ctrl/Cmd+Z / Shift+Z for history.
    useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            // Never intercept typing inside inputs.
            const target = ev.target as HTMLElement | null;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
                ev.preventDefault();
                if (ev.shiftKey) handleRedo(); else handleUndo();
                return;
            }
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
                ev.preventDefault();
                handleRedo();
                return;
            }
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
                ev.preventDefault();
                duplicateSelectedNode();
                return;
            }
            if (ev.key === 'Escape') {
                setSelectedNode(null);
                setSelectedEdge(null);
                return;
            }
            if (ev.key.toLowerCase() === 'f') {
                ev.preventDefault();
                runSmartFit(500);
                return;
            }
            if (storyMode && storyScenes.length > 0) {
                if (ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    const next = Math.max(storyStep - 1, 0);
                    setStoryStep(next);
                    applyStoryState(storyMode, next);
                    return;
                }
                if (ev.key === 'ArrowRight') {
                    ev.preventDefault();
                    const next = Math.min(storyStep + 1, storyScenes.length - 1);
                    setStoryStep(next);
                    applyStoryState(storyMode, next);
                    return;
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [runSmartFit, handleUndo, handleRedo, storyMode, storyScenes.length, storyStep, applyStoryState, duplicateSelectedNode]);

    // Show an explicit empty state instead of an inscrutable black canvas
    // when generation produced nothing usable. CustomNode + GroupZoneNode
    // have been observed to render a single empty rectangle in this case
    // (the IR was a lone group with no member nodes); surfacing the
    // diagnosis lets the user re-trigger generation immediately.
    const hasContent = nodes.some(n => n.type !== 'groupZone');
    const incomingNodeCount = initialNodes?.length ?? 0;
    const incomingEdgeCount = initialEdges?.length ?? 0;
    const [layoutStalled, setLayoutStalled] = useState(false);
    const [domRenderStalled, setDomRenderStalled] = useState(false);
    const irNodes  = presentation?.ir?.nodes?.length ?? 0;
    const irEdges  = presentation?.ir?.edges?.length ?? 0;

    useEffect(() => {
        if (hasContent || incomingNodeCount === 0) {
            setLayoutStalled(false);
            return;
        }
        const timer = window.setTimeout(() => setLayoutStalled(true), LAYOUT_STALL_DIAGNOSTIC_MS);
        return () => window.clearTimeout(timer);
    }, [hasContent, incomingNodeCount, incomingEdgeCount]);

    useEffect(() => {
        setDomRenderStalled(false);
        if (!hasContent || incomingNodeCount === 0) return;

        const measureVisibleNodes = () => {
            const root = containerRef.current;
            if (!root) return 0;
            const rootRect = root.getBoundingClientRect();
            if (rootRect.width <= 8 || rootRect.height <= 8) return 0;
            return Array.from(root.querySelectorAll('.react-flow__node') as NodeListOf<HTMLElement>)
                .filter(element => !element.classList.contains('react-flow__node-groupZone'))
                .filter(element => {
                    const rect = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);
                    const intersectsViewport = rect.right > rootRect.left
                        && rect.left < rootRect.right
                        && rect.bottom > rootRect.top
                        && rect.top < rootRect.bottom;
                    return rect.width > 8
                        && rect.height > 8
                        && intersectsViewport
                        && style.visibility !== 'hidden'
                        && style.display !== 'none'
                        && Number(style.opacity || '1') > 0;
                }).length;
        };

        const firstPaint = window.setTimeout(() => {
            if (measureVisibleNodes() === 0) {
                setDomRenderStalled(true);
                console.warn('[ReactFlowCanvas] ReactFlow state has nodes but no visible DOM nodes after paint.', {
                    incomingNodeCount,
                    incomingEdgeCount,
                    stateNodes: nodes.length,
                    stateEdges: edges.length,
                    irNodes,
                    irEdges,
                    recoveryAttempt: domRecoveryAttemptsRef.current + 1,
                });

                if (domRecoveryAttemptsRef.current < 2) {
                    domRecoveryAttemptsRef.current += 1;
                    const sourceNodes = (nodes.length > 0 ? nodes : initialNodes).filter(node => node.type !== 'groupZone');
                    const recoveredNodes = materializeNodesOnVisibleGrid(sourceNodes, normalizedDensity);
                    const recoveredIds = new Set(recoveredNodes.map(node => node.id));
                    const sourceEdges = edges.length > 0 ? edges : initialEdges;
                    const recoveredEdges = prepareEdgesForInitialPaint(sourceEdges || [], recoveredIds);
                    const recoveredScenes = buildNarrativeScenes(recoveredNodes, recoveredEdges, presentation?.ir);
                    setStoryScenes(recoveredScenes);
                    setStoryStep(0);
                    applyScene(recoveredNodes, recoveredEdges, [], recoveredScenes, 0, false);
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => fitView({ padding: 0.18, duration: 0 }));
                    });
                }
            }
        }, DOM_RENDER_STALL_DIAGNOSTIC_MS);

        const recovery = window.setTimeout(() => {
            if (measureVisibleNodes() > 0) {
                setDomRenderStalled(false);
                fitView({ padding: 0.18, duration: 300 });
            }
        }, DOM_RENDER_STALL_DIAGNOSTIC_MS + 900);

        return () => {
            window.clearTimeout(firstPaint);
            window.clearTimeout(recovery);
        };
    }, [hasContent, incomingNodeCount, incomingEdgeCount, nodes, edges, initialNodes, initialEdges, irNodes, irEdges, fitView, normalizedDensity, presentation?.ir, applyScene]);

    // Guard: if initialNodes is non-empty, the layout timer is probably pending
    // (10 ms debounce in the effect above). If it remains empty after the stall
    // threshold, show diagnostics anyway; this closes the historical failure
    // mode where ReactFlow received nodes but the user saw a permanent blank grid.
    const isLayoutPending = !hasContent && incomingNodeCount > 0 && !layoutStalled;

    // Surface a structured diagnosis when the canvas is truly empty or stalled.
    // Counts come from the underlying IR (supplied via `presentation.ir`) and
    // the incoming ReactFlow arrays.
    const emptyStateDetail = ((!hasContent && !isLayoutPending) || domRenderStalled) ? {
        initialNodes: incomingNodeCount,
        initialEdges: incomingEdgeCount,
        irNodes,
        irEdges,
        layoutStalled: layoutStalled || domRenderStalled,
        domRenderStalled,
    } : null;

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full"
            role="region"
            aria-label="Lienzo de diagrama de arquitectura"
        >
            {/* Off-screen accessible description: read by assistive tech as
                the canvas region is focused / announced. Hidden visually
                but exposed via aria-describedby. The user can open the
                fully visible dialog (see toolbar button) to read it. */}
            <div id="diagram-canvas-aria-description" className="sr-only">
                {accessibleSummary?.fullText ?? shortAriaDescription}
            </div>
            {emptyStateDetail && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none p-6">
                    <div className="pointer-events-auto max-w-lg w-full rounded-2xl border border-amber-200 dark:border-amber-700/50 bg-amber-50/95 dark:bg-amber-900/30 backdrop-blur-md px-6 py-5 shadow-xl">
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                            El diagrama no se está renderizando.
                        </p>
                        <p className="mt-2 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                            {emptyStateDetail.layoutStalled
                                ? (emptyStateDetail.domRenderStalled ? 'ReactFlow recibió nodos y estado interno, pero no hay nodos visibles en el DOM. Conteos por capa:' : 'ReactFlow recibió nodos, pero el layout no terminó de materializarlos en pantalla. Conteos por capa:')
                                : irNodes > 0
                                    ? 'El IR tiene nodos pero la conversión a vista visual quedó vacía. Conteos por capa:'
                                    : 'No se pudo construir un IR renderizable. Conteos por capa:'}
                        </p>
                        <ul className="mt-2 text-[11px] font-mono text-amber-900 dark:text-amber-200 space-y-0.5">
                            <li>IR.nodes: {emptyStateDetail.irNodes}</li>
                            <li>IR.edges: {emptyStateDetail.irEdges}</li>
                            <li>ReactFlow.nodes: {emptyStateDetail.initialNodes}</li>
                            <li>ReactFlow.edges: {emptyStateDetail.initialEdges}</li>
                        </ul>
                        <p className="mt-3 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                            Posibles causas: el modelo devolvió Mermaid inválido,
                            la audiencia filtró todos los elementos, o el contenido
                            del artefacto está corrupto. Regenera el artefacto o
                            cambia la audiencia desde la barra inferior.
                        </p>
                    </div>
                </div>
            )}
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onNodesDelete={onNodesDelete}
                onEdgesDelete={onEdgesDelete}
                onEdgeUpdate={onEdgeUpdate}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onConnect={onConnect}
                deleteKeyCode={['Backspace', 'Delete']}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                proOptions={{ hideAttribution: true }}
                nodesConnectable={true}
                nodesDraggable={true}
                minZoom={0.15}
                maxZoom={2.5}
                className="min-h-full"
                defaultEdgeOptions={defaultEdgeOptions}
                onlyRenderVisibleElements={enableVirtualization}
                elevateEdgesOnSelect
                elevateNodesOnSelect
                aria-label={presentation?.title ?? 'Diagrama de arquitectura'}
                aria-describedby="diagram-canvas-aria-description"
            >
                <Controls showInteractive={false} className="!rounded-xl !shadow-lg !border !border-gray-200 dark:!border-gray-700" />
                {externalLayoutPlan && (
                    <div
                        className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-md border border-gray-200/80 dark:border-gray-700/80 shadow-sm text-[10px] font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
                        role="status"
                        aria-label="Plan de layout aplicado"
                        title={externalLayoutPlan.rationale ?? 'Plan de layout aplicado por el motor canónico.'}
                    >
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${externalLayoutPlan.backend === 'elk' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <span>{externalLayoutPlan.backend.toUpperCase()}</span>
                        {externalLayoutPlan.algorithm && <span className="text-gray-400 dark:text-gray-500">·</span>}
                        {externalLayoutPlan.algorithm && <span>{externalLayoutPlan.algorithm}</span>}
                        {externalLayoutPlan.direction && <span className="text-gray-400 dark:text-gray-500">·</span>}
                        {externalLayoutPlan.direction && <span>{externalLayoutPlan.direction}</span>}
                        {externalLayoutPlan.density && <span className="text-gray-400 dark:text-gray-500">·</span>}
                        {externalLayoutPlan.density && <span>{externalLayoutPlan.density}</span>}
                    </div>
                )}
                {(showMiniMap || nodes.filter(n => n.type !== 'groupZone').length >= AUTO_MINIMAP_THRESHOLD) && (
                    <MiniMap
                        nodeStrokeWidth={3}
                        zoomable
                        pannable
                        className="!rounded-xl !shadow-lg !border !border-gray-200 dark:!border-gray-700"
                        maskColor="rgba(0, 0, 0, 0.08)"
                    />
                )}
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={canvasBg.gap}
                    size={canvasBg.size}
                    color={canvasBg.dot}
                    style={{ backgroundColor: canvasBg.bg }}
                />

                {/* Diagram toolbar — redesigned: grouped under three dropdowns
                    (Vista, Narrativa, Historial) plus Presentar as the only
                    primary action. Reduces 13 controls down to 4 visible chips. */}
                <div className="diagram-toolbar absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md p-1.5 rounded-xl shadow-lg border border-gray-200/80 dark:border-gray-700/80">
                   {(() => {
                       const layoutItems: DropdownItem[] = [
                           {
                               id: 'tb',
                               label: 'Vertical (de arriba a abajo)',
                               description: 'TB · jerarquías y flujos descendentes',
                               icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>,
                               active: layoutDirection === 'TB',
                               onClick: () => onLayout('TB'),
                           },
                           {
                               id: 'lr',
                               label: 'Horizontal (izquierda → derecha)',
                               description: 'LR · procesos y secuencias',
                               icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>,
                               active: layoutDirection === 'LR',
                               onClick: () => onLayout('LR'),
                           },
                       ];
                       const densityItems: DropdownItem[] = (['compact', 'normal', 'spacious'] as LayoutPreset[]).map(p => ({
                           id: p,
                           label: p === 'compact' ? 'Compacto' : p === 'normal' ? 'Normal' : 'Amplio',
                           description: p === 'compact' ? 'Densidad alta · ideal en monitores pequeños' : p === 'normal' ? 'Densidad equilibrada' : 'Más aire alrededor de cada nodo',
                           active: layoutPreset === p,
                           onClick: () => {
                               setLayoutPreset(p);
                               pushSnapshot({ nodes, edges });
                               const contentNodes = nodes.filter(n => n.type !== 'groupZone');
                               const directiveTitle = presentation?.ir?.metadata?.title ?? presentation?.title;
                               const dir = layoutDirection === 'auto' ? detectOptimalDirection(contentNodes, edges, { title: directiveTitle }) : layoutDirection;
                               const { nodes: ln, edges: le } = calculateLayout(contentNodes, edges, dir, p);
                               const zn = buildGroupZoneNodes(ln, groupHints);
                               const scenes = buildNarrativeScenes(ln, le, presentation?.ir);
                               setStoryScenes(scenes);
                               setStoryStep(0);
                               applyScene(ln, le, zn, scenes, 0, storyMode);
                               notifyChange({ nodes: ln, edges: le });
                               window.requestAnimationFrame(() => runSmartFit(500));
                           },
                       }));

                       const historyItems: DropdownItem[] = [
                           { id: 'undo', icon: <ArrowUturnLeftIcon className="w-4 h-4" />, label: 'Deshacer', description: 'Ctrl/⌘+Z', onClick: handleUndo },
                           { id: 'redo', icon: <ArrowUturnLeftIcon className="w-4 h-4" style={{ transform: 'scaleX(-1)' }} />, label: 'Rehacer', description: 'Ctrl/⌘+Shift+Z', onClick: handleRedo },
                           { id: 'fit',  icon: <ViewfinderCircleIcon className="w-4 h-4" />, label: 'Ajustar a pantalla', description: 'Tecla F', onClick: () => runSmartFit(500) },
                       ];

                       const densityLabel = layoutPreset === 'compact' ? 'Compacto' : layoutPreset === 'normal' ? 'Normal' : 'Amplio';
                       const dirLabel = layoutDirection === 'TB' ? '↓' : layoutDirection === 'LR' ? '→' : '⤵';

                       return (
                           <>
                               {/* Vista del diagrama: layout direction + density */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label="Vista del diagrama"
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                           title="Layout y densidad"
                                       >
                                           <span className="text-base leading-none">{dirLabel}</span>
                                           <span>{densityLabel}</span>
                                           <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                       </button>
                                   )}
                                   sections={[
                                       { label: 'Dirección', items: layoutItems },
                                       { label: 'Densidad', items: densityItems },
                                   ]}
                               />

                               {/* Añadir nodo — edición topológica directa en el lienzo */}
                               <button
                                   type="button"
                                   onClick={addNewNode}
                                   className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                   title="Añadir un nodo nuevo al diagrama (se guarda automáticamente)"
                               >
                                   <span className="text-sm leading-none">＋</span>
                                   <span>Nodo</span>
                               </button>

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />
                               {smartViewportHint.explore && (
                                   <span
                                       className="px-2 py-1 rounded-lg text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700"
                                       title={smartViewportHint.reason ? `Legibilidad: ${smartViewportHint.reason}` : undefined}
                                   >
                                       Explora: hay contenido fuera de vista
                                   </span>
                               )}
                               {smartViewportHint.viewAllSecondary && (
                                   <button
                                       type="button"
                                       onClick={() => fitView({ padding: 0.08, duration: 240 })}
                                       className="px-2 py-1 rounded-lg text-[10px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600"
                                       title="Ver todo (puede comprometer legibilidad)"
                                   >
                                       Ver todo
                                   </button>
                               )}
                               {(smartViewportHint.explore || smartViewportHint.viewAllSecondary || focusPrimaryActive) && nodes.filter(n => n.type !== 'groupZone').length > 6 && (
                                   <button
                                       type="button"
                                       onClick={toggleFocusPrimary}
                                       aria-pressed={focusPrimaryActive}
                                       className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition-colors ${focusPrimaryActive
                                           ? 'bg-primary-100 text-primary-700 border-primary-300 dark:bg-primary-900/50 dark:text-primary-200 dark:border-primary-700'
                                           : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-600'}`}
                                       title={focusPrimaryActive
                                           ? 'Volver a la vista completa'
                                           : 'Resaltar nodos clave y atenuar el resto · prioriza legibilidad'}
                                   >
                                       {focusPrimaryActive ? 'Salir del foco' : 'Foco principal'}
                                   </button>
                               )}
                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Narrativa: Story mode + scenes */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label="Narrativa por escenas"
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           aria-pressed={storyMode}
                                           className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${storyMode ? 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                           title="Modo narrativo por escenas"
                                       >
                                           <SparklesIcon className="w-3.5 h-3.5" />
                                           <span>{storyMode && storyScenes.length > 0 ? (storyScenes[storyStep]?.title ?? `Escena ${storyStep + 1}`) : 'Narrativa'}</span>
                                           <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                                       </button>
                                   )}
                                   sections={[
                                       {
                                           items: [
                                               {
                                                   id: 'toggle',
                                                   icon: <SparklesIcon className="w-4 h-4" />,
                                                   label: storyMode ? 'Salir del modo narrativo' : 'Activar modo narrativo',
                                                   description: 'Cuenta la historia escena por escena',
                                                   active: storyMode,
                                                   onClick: () => {
                                                       const enabled = !storyMode;
                                                       setStoryMode(enabled);
                                                       setStoryStep(0);
                                                       applyStoryState(enabled, 0);
                                                   },
                                               },
                                           ],
                                       },
                                       {
                                           label: 'Escenas',
                                           items: [
                                               {
                                                   id: 'prev',
                                                   icon: <span className="text-sm leading-none">←</span>,
                                                   label: 'Escena anterior',
                                                   description: storyScenes.length > 0 ? `Paso ${Math.max(storyStep, 0) + 1} de ${storyScenes.length}` : 'Sin escenas',
                                                   disabled: !storyMode || storyScenes.length === 0 || storyStep === 0,
                                                   onClick: () => {
                                                       const next = Math.max(storyStep - 1, 0);
                                                       setStoryStep(next);
                                                       applyStoryState(storyMode, next);
                                                   },
                                               },
                                               {
                                                   id: 'next',
                                                   icon: <span className="text-sm leading-none">→</span>,
                                                   label: 'Escena siguiente',
                                                   description: storyScenes.length > 0 ? `Paso ${Math.max(storyStep, 0) + 1} de ${storyScenes.length}` : 'Sin escenas',
                                                   disabled: !storyMode || storyScenes.length === 0 || storyStep >= storyScenes.length - 1,
                                                   onClick: () => {
                                                       const next = Math.min(storyStep + 1, Math.max(0, storyScenes.length - 1));
                                                       setStoryStep(next);
                                                       applyStoryState(storyMode, next);
                                                   },
                                               },
                                           ],
                                       },
                                   ]}
                               />

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Historial + Fit */}
                               <Dropdown
                                   align="center"
                                   direction="up"
                                   width="md"
                                   aria-label="Historial y vista"
                                   trigger={({ open, toggle }) => (
                                       <button
                                           type="button"
                                           onClick={toggle}
                                           aria-expanded={open}
                                           aria-label="Historial y ajuste de vista"
                                           className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                                           title="Deshacer · Rehacer · Ajustar"
                                       >
                                           <ArrowPathIcon className="w-4 h-4" />
                                       </button>
                                   )}
                                   items={historyItems}
                               />

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Descripción accesible / narrativa textual */}
                               <button
                                   type="button"
                                   onClick={() => setA11yOpen(true)}
                                   aria-label="Abrir descripción accesible del diagrama"
                                   title="Descripción accesible (lectores de pantalla / handoff)"
                                   className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                               >
                                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                       <circle cx="12" cy="6" r="2.2" />
                                       <path d="M9 11h6" />
                                       <path d="M12 11v9" />
                                       <path d="M9 16l3-1 3 1" />
                                   </svg>
                               </button>

                               <div className="w-px h-6 bg-gray-200 dark:bg-gray-600" aria-hidden />

                               {/* Presentar — única acción primaria visible */}
                               <button
                                   onClick={() => setPresentationOpen(true)}
                                   className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 text-white hover:scale-[1.03] active:scale-95 transition shadow-md"
                                   title="Modo presentación cinemático"
                               >
                                   <PresentationChartBarIcon className="w-3.5 h-3.5" />
                                   Presentar
                               </button>
                           </>
                       );
                   })()}
                </div>
            </ReactFlow>

            {/* Accessible description dialog — visible alternative to the
                sr-only summary. Built from the IR so it stays in sync with
                the canonical semantic model. Includes a "Copiar" button so
                the description can be reused as a handoff document. */}
            {a11yOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="a11y-dialog-title"
                    className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 animate-fade-in"
                    onClick={(e) => { if (e.target === e.currentTarget) setA11yOpen(false); }}
                >
                    <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col">
                        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                            <div>
                                <h2 id="a11y-dialog-title" className="text-sm font-semibold text-gray-900 dark:text-white">Descripción accesible del diagrama</h2>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Resumen textual usado por lectores de pantalla. Útil como handoff cuando el lector no puede ver el lienzo.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setA11yOpen(false)}
                                aria-label="Cerrar descripción accesible"
                                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4 text-sm text-gray-700 dark:text-gray-200">
                            {accessibleSummary ? (
                                <>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{accessibleSummary.headline}</p>
                                    {accessibleSummary.boundaries.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">Agrupaciones / límites</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.boundaries.map((b, i) => <li key={i}>{b}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                    {accessibleSummary.keyNodes.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">Elementos clave</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.keyNodes.map((n, i) => <li key={i}>{n}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                    {accessibleSummary.keyFlows.length > 0 && (
                                        <section>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-1">Relaciones clave</p>
                                            <ul className="list-disc pl-5 space-y-0.5 text-[12.5px]">
                                                {accessibleSummary.keyFlows.map((f, i) => <li key={i}>{f}</li>)}
                                            </ul>
                                        </section>
                                    )}
                                </>
                            ) : (
                                <p className="text-gray-500 dark:text-gray-400 italic">El diagrama todavía no tiene una representación semántica (IR) disponible. Carga o regenera el artefacto para producir un resumen accesible.</p>
                            )}
                        </div>
                        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    if (accessibleSummary?.fullText && typeof navigator !== 'undefined' && navigator.clipboard) {
                                        void navigator.clipboard.writeText(accessibleSummary.fullText);
                                    }
                                }}
                                disabled={!accessibleSummary?.fullText}
                                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                Copiar texto
                            </button>
                            <button
                                type="button"
                                onClick={() => setA11yOpen(false)}
                                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cinematic presentation overlay */}
            <PresentationMode
                open={presentationOpen}
                onClose={() => {
                    setPresentationOpen(false);
                    handlePresentationSceneChange(null);
                }}
                title={presentation?.title}
                summary={presentation?.summary}
                ir={presentation?.ir}
                nodes={nodes}
                edges={edges}
                onSceneChange={handlePresentationSceneChange}
            />

            {/* Toggleable Legend */}
            <DiagramLegend show={showLegend} onToggle={() => setShowLegend(v => !v)} legendData={legendData} />

            {/* Editor Panel */}
            {(selectedNode || selectedEdge) && (
                <div className="diagram-editor-panel absolute top-4 right-4 w-96 bg-white/95 dark:bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-20 flex flex-col max-h-[calc(100%-2rem)] overflow-hidden animate-fade-in">
                    <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                            {selectedNode ? 'Inspeccionar / Editar Nodo' : 'Inspeccionar / Editar Conexión'}
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setInspectorPinned((v) => !v)}
                                className="text-[10px] px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
                                aria-label={inspectorPinned ? 'Desfijar inspector' : 'Fijar inspector'}
                            >
                                {inspectorPinned ? 'Unpin' : 'Pin'}
                            </button>
                        <button onClick={() => { if (inspectorPinned) return; onPaneClick(); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                        </div>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1 space-y-4">
                        {selectedNode && (
                            <>
                                <NodeInspector node={selectedNode} nodes={nodes} edges={edges} />
                                <div className="border-t border-gray-100 dark:border-gray-700 -mx-4" />
                                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Editar</div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={focusNeighbors} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Enfocar vecinos</button>
                                    <button type="button" onClick={clearFocusFilters} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Mostrar secundarios</button>
                                    <button
                                        type="button"
                                        onClick={duplicateSelectedNode}
                                        className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700"
                                        title="Duplicar nodo (Ctrl/⌘+D)"
                                    >
                                        Duplicar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedNode) return;
                                            try {
                                                reactFlowInstance.deleteElements({ nodes: [{ id: selectedNode.id }] });
                                            } catch { /* deleteElements unavailable in this ReactFlow build */ }
                                        }}
                                        className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                        title="Eliminar nodo (Supr / Retroceso)"
                                    >
                                        Eliminar
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
                                    <input
                                        type="text"
                                        value={selectedNode.data.label || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo / Tecnología</label>
                                    <input
                                        type="text"
                                        value={selectedNode.data.type || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { type: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                        placeholder="Ej: Database, API, Web..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
                                    <textarea
                                        value={selectedNode.data.description || ''}
                                        onChange={(e) => updateNodeData(selectedNode.id, { description: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white resize-none h-24"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Color Personalizado</label>
                                    <input
                                        type="color"
                                        value={selectedNode.data.color || '#ffffff'}
                                        onChange={(e) => updateNodeData(selectedNode.id, { color: e.target.value })}
                                        className="w-full h-10 p-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                                    />
                                    <button
                                        onClick={() => updateNodeData(selectedNode.id, { color: undefined })}
                                        className="mt-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                                    >
                                        Restablecer color por defecto
                                    </button>
                                </div>
                            </>
                        )}
                        {selectedEdge && (
                            <>
                                <EdgeInspector edge={selectedEdge} nodes={nodes} />
                                <div className="border-t border-gray-100 dark:border-gray-700 -mx-4" />
                                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">Editar</div>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={focusNeighbors} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Enfocar vecinos</button>
                                    <button type="button" onClick={clearFocusFilters} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700">Mostrar secundarios</button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!selectedEdge) return;
                                            try {
                                                reactFlowInstance.deleteElements({ edges: [{ id: selectedEdge.id }] });
                                            } catch { /* deleteElements unavailable in this ReactFlow build */ }
                                        }}
                                        className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                        title="Eliminar conexión (Supr / Retroceso)"
                                    >
                                        Eliminar
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Etiqueta de la Conexión</label>
                                    <input
                                        type="text"
                                        value={selectedEdge.label as string || ''}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { label: e.target.value })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Relación</label>
                                    <select
                                        value={selectedEdge.data?.edgeType || 'default'}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { data: { ...selectedEdge.data, edgeType: e.target.value } })}
                                        className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
                                    >
                                        <option value="default">Por defecto</option>
                                        <option value="sync">Síncrona (HTTP/REST)</option>
                                        <option value="async">Asíncrona (Eventos)</option>
                                        <option value="data-flow">Flujo de datos</option>
                                        <option value="dependency">Dependencia</option>
                                        <option value="inheritance">Herencia/Composición</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Color de la Conexión</label>
                                    <input
                                        type="color"
                                        value={selectedEdge.style?.stroke || '#64748b'}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, {
                                            style: { ...selectedEdge.style, stroke: e.target.value },
                                            markerEnd: { type: MarkerType.ArrowClosed, color: e.target.value }
                                        })}
                                        className="w-full h-10 p-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                                    />
                                </div>
                                <div className="flex items-center mt-2">
                                    <input
                                        type="checkbox"
                                        id="animated-edge"
                                        checked={selectedEdge.data?.animated || false}
                                        onChange={(e) => updateEdgeData(selectedEdge.id, { data: { ...selectedEdge.data, animated: e.target.checked } })}
                                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                                    />
                                    <label htmlFor="animated-edge" className="ml-2 block text-sm text-gray-900 dark:text-gray-300">
                                        Animar flujo
                                    </label>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

// Wrapper
const ReactFlowCanvasWrapper = forwardRef<ReactFlowCanvasHandle, ReactFlowCanvasProps>((props, ref) => (
    <div className="w-full h-full" style={{ minHeight: '100%', height: '100%' }}>
        <ReactFlowProvider>
            <ReactFlowCanvas {...props} ref={ref} />
        </ReactFlowProvider>
    </div>
));

export default ReactFlowCanvasWrapper;
