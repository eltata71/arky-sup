import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node, Edge } from 'reactflow';
import type { Artifact, Project, Settings } from '../../types';
import type { DiagramAudience } from '../../lib/diagram';
import type { ArtifactViewMode } from '../../lib/artifacts/contracts';
import type { RenderableDiagramResolution } from '../../services/diagram/resolveRenderableDiagram';
import { diagramGenerationService } from '../../services/ai';
import {
  isDiagramAIFallbackEnabled,
  mermaidToReactFlow as mermaidToReactFlowDeterministic,
  resolveRenderableDiagram,
} from '../../services/diagram';
import { hasManualLayout, irToReactFlowSmart } from '../../services/diagram/irToReactFlow';
import { irToMermaid } from '../../services/diagram/irToMermaid';
import { toDiagramIR as reactFlowToIR, mergeIRMetadata } from '../../services/diagram';
import { isDiagramFlowData, type DiagramFlowData } from '../../components/artifacts/diagram/diagramFlow';
import type { LayoutPlan } from '../../lib/layoutSelector';

// Aligns with the gemini timeout (180s) plus slack; prevents false timeouts
// on complex diagrams.
const DIAGRAM_GENERATION_TIMEOUT_MS = 300_000;

export interface UseDiagramRenderingInput {
  artifact: Artifact;
  project: Project;
  settings: Settings;
  viewMode: ArtifactViewMode;
  audience: DiagramAudience;
  mermaidCode: string | null;
  updateArtifact: (projectId: string, artifactId: string, patch: Partial<Artifact>) => void;
  /**
   * Reads the canonical artifact straight from the AppContext. Used by
   * `applyLayoutOverride` so the patch is built from the latest IR (which
   * may have been mutated by a concurrent flow) instead of the closure
   * snapshot. Optional for callers that don't trigger overrides.
   */
  getArtifact?: (projectId: string, artifactId: string) => Artifact | undefined;
  setViewMode: (next: ArtifactViewMode) => void;
  /** Called after auto-fix rewrites the artifact content. */
  onContentFixed: (content: string) => void;
}

export interface UseDiagramRenderingResult {
  /** Canonical render resolution (IR + ReactFlow graph + diagnostics). */
  renderable: RenderableDiagramResolution;
  /** Legacy in-effect re-parse output; fallback when the resolver is empty. */
  flowData: DiagramFlowData | null;
  /** Stable signature used to key the ReactFlow canvas. */
  renderableSignature: string;
  /** Nodes/edges actually mounted on the canvas. */
  displayFlowNodes: Node[];
  displayFlowEdges: Edge[];
  /** Provenance of the displayed graph (canonical IR vs. legacy parse). */
  displayedFlowSource: string;
  /** True when the canonical resolver produced renderable nodes. */
  hasRenderableNodes: boolean;
  isLoading: boolean;
  error: string | null;
  loadingMessage: string;
  cancelLoading: () => void;
  autoFix: () => Promise<void>;
  applyIssueFix: (issueId: string) => void;
  canvasChange: (flow: DiagramFlowData) => void;
  /**
   * Persist a layout override (density / direction) on the IR's
   * `metadata.layoutPlan` with `userOverride=true` and trigger a re-render.
   * Used by the Visual Quality Gate's auto-actions (RETRY_LAYOUT_SPACIOUS,
   * RETRY_LAYOUT_DENSITY_NORMAL, RETRY_LAYOUT_*_TB, …). Returns the
   * applied override so the caller can confirm what landed.
   */
  applyLayoutOverride: (override: { density?: 'compact' | 'normal' | 'spacious'; direction?: 'TB' | 'LR' }) => { density?: 'compact' | 'normal' | 'spacious'; direction?: 'TB' | 'LR' } | null;
  /** Full retry: clears caches and re-runs the render pipeline. */
  retryDiagram: () => void;
  /** Clears the cached flow data after a ReactFlow render crash. */
  resetCanvas: () => void;
  /**
   * Phase 2 — layout plan applied by the latest async ELK pass (when
   * available). Surfaced for diagnostics, the export frame and the
   * inspector. `null` until ELK resolves; the synchronous dagre render
   * is used in the meantime.
   */
  layoutPlan: LayoutPlan | null;
  /**
   * Gap 1 — true when the displayed nodes carry positions produced by an
   * external layout pass (ELK). The canvas uses this flag to skip its
   * internal Dagre layout so the external plan is not overwritten.
   */
  hasExternalPositions: boolean;
}

/**
 * Diagram rendering hub for the artifact canvas.
 *
 * Owns the canonical `resolveRenderableDiagram` resolution, the legacy
 * in-effect Mermaid → ReactFlow re-parse (kept as a fallback), the stable
 * ReactFlow node/edge references, and every diagram recovery action
 * (cancel, auto-fix, issue-fix, retry, reset).
 */
export const useDiagramRendering = (input: UseDiagramRenderingInput): UseDiagramRenderingResult => {
  const {
    artifact,
    project,
    settings,
    viewMode,
    audience,
    mermaidCode,
    updateArtifact,
    getArtifact,
    setViewMode,
    onContentFixed,
  } = input;

  const [flowData, setFlowData] = useState<DiagramFlowData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('');
  // Phase 2: positions produced by the async ELK pass + the layout plan
  // metadata. When `null` the sync dagre render is used as-is so the
  // canvas is never blocked behind ELK.
  const [elkPositions, setElkPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [layoutPlan, setLayoutPlan] = useState<LayoutPlan | null>(null);
  const flowDataCache = useRef<Map<string, DiagramFlowData>>(new Map());
  const isMounted = useRef(true);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the IR signature ELK was asked for, so we can ignore stale
  // resolves that arrive after the IR has already changed.
  const elkRequestRef = useRef<string>('');

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const renderable = useMemo(
    () => resolveRenderableDiagram(artifact, { audience, generatedFlow: flowData }),
    [artifact, audience, flowData],
  );

  // Phase 2: async ELK pass. Kicks off once we have a stable IR with at
  // least one node and replaces the synchronous dagre positions when it
  // resolves. Failures are swallowed — the canvas keeps the dagre render
  // so the user always sees something.
  //
  // Disabled when the IR comes from the placeholder fallback (we don't
  // want to waste a layout pass on the warning card) or when the env flag
  // explicitly opts out (`VITE_DIAGRAM_ELK=off`).
  useEffect(() => {
    const ir = renderable.ir;
    if (!ir || ir.nodes.length < 2) {
      setElkPositions(null);
      setLayoutPlan(null);
      return;
    }
    if (ir.metadata?.degradationReason === 'no-parseable-content') return;
    // Manual layout: the architect's persisted canvas positions are the
    // source of truth — never let an async ELK pass move the nodes back.
    if (hasManualLayout(ir)) {
      setElkPositions(null);
      return;
    }
    const elkOptOut = ((import.meta.env.VITE_DIAGRAM_ELK ?? 'on') as string).toLowerCase() === 'off';
    if (elkOptOut) return;

    const signature = `${artifact.id}::${ir.nodes.length}::${ir.edges.length}::${ir.metadata?.diagramType ?? ''}`;
    elkRequestRef.current = signature;
    let cancelled = false;

    void (async () => {
      try {
        const result = await irToReactFlowSmart(ir, artifact.type);
        // Stale-result guard: another IR landed before ELK finished.
        if (cancelled || !isMounted.current || elkRequestRef.current !== signature) return;
        if (result.plan.backend === 'dagre') {
          // ELK was not even attempted (sequence/state diagrams stick to
          // dagre via the selector). Surface the plan but don't override
          // positions: the dagre result we already render IS the plan.
          setLayoutPlan(result.plan);
          setElkPositions(null);
          persistLayoutPlan(result.plan);
          return;
        }
        const positions = new Map<string, { x: number; y: number }>();
        for (const node of result.nodes) {
          if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
            positions.set(String(node.id), { x: node.position.x, y: node.position.y });
          }
        }
        if (positions.size === 0) {
          // ELK returned zero positions — treat it as a failure and stick
          // to the dagre canvas instead of moving every node to (0,0).
          console.warn('[useDiagramRendering] ELK returned no positions; keeping dagre render.');
          return;
        }
        setLayoutPlan(result.plan);
        setElkPositions(positions);
        persistLayoutPlan(result.plan);
      } catch (err) {
        // ELK can fail in browsers without WASM support, in jsdom or when
        // the bundle was tree-shaken out. The synchronous dagre render is
        // already on screen, so we just log.
        if (!cancelled) {
          console.warn('[useDiagramRendering] ELK pass failed, keeping dagre render', err);
        }
      }
    })();

    return () => { cancelled = true; };
    // We depend on the IR identity + the artifact id; using the renderable
    // IR reference directly would re-run on every memoised resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, artifact.type, renderable.ir, renderable.status]);

  /**
   * Persist the layout plan on `artifact.ir.metadata.layoutPlan` so the
   * preflight, export frame and observability panels can read it without
   * re-running ELK. Guarded against no-op writes so we never create an
   * infinite update loop when the plan didn't change.
   */
  const persistLayoutPlan = useCallback((plan: LayoutPlan) => {
    const currentIR = artifact.ir;
    if (!currentIR) return;
    const previous = currentIR.metadata?.layoutPlan;
    // Gap 3: preserve the userOverride marker across persistence so a
    // suggestion-action choice (LR / compact / spacious) survives an ELK
    // re-pass. Without this, every layout commit would silently strip the
    // sticky preference back to the heuristic default.
    const next = {
      backend: plan.backend,
      algorithm: plan.algorithm,
      direction: plan.direction,
      density: plan.density,
      orthogonal: plan.orthogonal,
      rationale: plan.rationale,
      computedAt: new Date().toISOString(),
      userOverride: plan.userOverride || previous?.userOverride || false,
    } as const;
    if (
      previous
      && previous.backend === next.backend
      && previous.algorithm === next.algorithm
      && previous.direction === next.direction
      && previous.density === next.density
      && previous.orthogonal === next.orthogonal
      && previous.rationale === next.rationale
      && (previous.userOverride ?? false) === next.userOverride
    ) {
      return; // no semantic change, skip to avoid the persist loop
    }
    const updatedIR = {
      ...currentIR,
      metadata: {
        ...(currentIR.metadata ?? {}),
        layoutPlan: next,
      },
    };
    updateArtifact(project.id, artifact.id, { ir: updatedIR });
  }, [artifact.id, artifact.ir, project.id, updateArtifact]);

  // Stabilize the reactFlow node/edge arrays: `resolveRenderableDiagram`
  // always returns fresh references. The signature includes IDs, labels,
  // positions and edges so a real diagram change reflows while unrelated
  // React renders keep stable references.
  const renderableSignature = useMemo(
    () => {
      // Manual layouts exclude positions from the signature: the canvas
      // already shows the dragged geometry, and keying the canvas on the
      // persisted positions would remount it (resetting the viewport)
      // right after every drag ends.
      const manual = renderable.ir ? hasManualLayout(renderable.ir) : false;
      return JSON.stringify({
        artifactId: artifact.id,
        contentLength: artifact.content.length,
        source: renderable.source,
        status: renderable.status,
        manual,
        nodes: renderable.reactFlow.nodes.map((n) => ({
          id: n.id,
          label: String((n.data as { label?: unknown } | undefined)?.label ?? ''),
          type: String((n.data as { type?: unknown } | undefined)?.type ?? ''),
          x: manual ? 0 : Math.round(n.position?.x ?? 0),
          y: manual ? 0 : Math.round(n.position?.y ?? 0),
        })),
        edges: renderable.reactFlow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: String(e.label ?? ''),
        })),
      });
    },
    [artifact.id, artifact.content.length, renderable.source, renderable.status, renderable.ir, renderable.reactFlow.nodes, renderable.reactFlow.edges],
  );
  const stableFlowNodes = useMemo(
    () => {
      // Phase 2: if the async ELK pass has produced positions, apply them
      // on top of the synchronous dagre render. We never replace the node
      // identities — we only move them — so React's reconciliation stays
      // stable and the inspector keeps its selection.
      const base = renderable.reactFlow.nodes;
      if (!elkPositions || elkPositions.size === 0) return base;
      let mutated = false;
      const next = base.map((n) => {
        const elk = elkPositions.get(String(n.id));
        if (!elk) return n;
        if (n.position && elk.x === n.position.x && elk.y === n.position.y) return n;
        mutated = true;
        return { ...n, position: elk };
      });
      return mutated ? next : base;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderableSignature, elkPositions],
  );
  const stableFlowEdges = useMemo(
    () => renderable.reactFlow.edges,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderableSignature],
  );

  const hasRenderableNodes = stableFlowNodes.length > 0;
  const legacyFlowNodes = flowData?.nodes ?? [];
  const legacyFlowEdges = flowData?.edges ?? [];
  const displayFlowNodes = hasRenderableNodes ? stableFlowNodes : legacyFlowNodes;
  const displayFlowEdges = hasRenderableNodes ? stableFlowEdges : legacyFlowEdges;
  const displayedFlowSource = hasRenderableNodes ? renderable.source : 'generated.ir';

  // Generate diagram with a safety timeout.
  useEffect(() => {
    if (viewMode !== 'diagram' && viewMode !== 'split' && viewMode !== 'lucidchart') {
      setIsLoading(false);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      return;
    }

    // The canonical resolver already consumes persisted IR and Mermaid/JSON
    // content synchronously. If it has a renderable graph, never block the
    // canvas behind the legacy async re-parse.
    if (hasRenderableNodes) {
      setIsLoading(false);
      setError(null);
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      return;
    }

    const embeddedMermaid = mermaidCode;
    if (artifact.representation === 'document' && !embeddedMermaid) {
      setFlowData(null);
      setIsLoading(false);
      setError('Este artefacto no contiene diagrama. Usa la vista Documento o Markdown.');
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      return;
    }

    const generate = async () => {
      if (flowDataCache.current.has(artifact.id)) {
        setFlowData(flowDataCache.current.get(artifact.id) ?? null);
        return;
      }

      setIsLoading(true);
      setLoadingMessage('Generando vista interactiva...');
      setError(null);

      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => {
        if (isMounted.current) {
          console.warn('Diagram generation timed out');
          setIsLoading(false);
          if (viewMode === 'diagram' || viewMode === 'split') {
            setError('El diagrama es complejo y tardó demasiado en generarse. Intenta con la vista Documento o presiona Reintentar.');
          }
        }
      }, DIAGRAM_GENERATION_TIMEOUT_MS);

      try {
        let diagramPart = artifact.content;
        let isJson = artifact.type === 'react-flow-graph';

        if (artifact.representation === 'hybrid' || (artifact.representation === 'document' && embeddedMermaid)) {
          const matchJson = artifact.content.match(/```json\s*([\s\S]*?)\s*```/);
          if (matchJson) {
            diagramPart = matchJson[1].trim();
            isJson = true;
          } else if (mermaidCode) {
            diagramPart = mermaidCode;
            isJson = false;
          } else {
            throw new Error('No se encontró un bloque de diagrama válido en el contenido híbrido.');
          }
        }

        let data: DiagramFlowData | null = null;
        if (isJson) {
          try {
            const parsed = JSON.parse(diagramPart) as unknown;
            if (!isDiagramFlowData(parsed)) {
              throw new Error('El JSON no contiene arreglos nodes/edges válidos.');
            }
            data = parsed;
          } catch {
            throw new Error('JSON inválido.');
          }
        } else {
          try {
            data = mermaidToReactFlowDeterministic(diagramPart);
            const emptyOrTooShallow =
              !data.nodes || data.nodes.length === 0 ||
              (data.nodes.length > 0 && data.edges.length === 0 && data.nodes.length > 1);
            if (emptyOrTooShallow && isDiagramAIFallbackEnabled()) {
              console.warn(
                '[useDiagramRendering] Deterministic parse degenerate; AI fallback engaged.',
                { nodes: data.nodes?.length ?? 0, edges: data.edges?.length ?? 0 },
              );
              data = await diagramGenerationService.parseMermaidToReactFlow(diagramPart, settings);
            }
          } catch (parserErr) {
            if (isDiagramAIFallbackEnabled()) {
              console.warn('[useDiagramRendering] Canonical parser failed, falling back to AI hop.', parserErr);
              data = await diagramGenerationService.parseMermaidToReactFlow(diagramPart, settings);
            } else {
              throw parserErr;
            }
          }
        }

        if (isMounted.current) {
          const nodeCount = data?.nodes.length ?? 0;
          const edgeCount = data?.edges.length ?? 0;
          if (nodeCount > 0 && data) {
            setFlowData(data);
            flowDataCache.current.set(artifact.id, data);
            setError(null);
          } else {
            console.warn(
              '[useDiagramRendering] Empty diagram after parse.',
              { artifactId: artifact.id, type: artifact.type, contentLength: artifact.content?.length ?? 0, nodeCount, edgeCount },
            );
            setError('El diagrama llegó vacío del generador. Pulsa Reintentar para regenerar con la IA, o cambia a la vista Documento para ver el contenido bruto.');
          }
        }
      } catch (e: unknown) {
        console.error('Diagram Gen Error:', e);
        const message = e instanceof Error ? e.message : 'Error al procesar el diagrama.';
        if (isMounted.current) setError(message);
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
          if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        }
      }
    };
    generate();

    return () => {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, artifact.content, viewMode, mermaidCode, hasRenderableNodes, renderable.status]);

  // Surface a diagnostic when the canonical resolver could not render.
  useEffect(() => {
    if (isLoading) return;
    if (renderable.status === 'ready') return;
    if (error) return;
    const stage = renderable.diagnostics[0]?.stage ?? 'render';
    setError(
      `No se pudo renderizar el diagrama (etapa: ${stage}). Nodos base: ${renderable.counters.baseNodes}, nodos proyectados: ${renderable.counters.projectedNodes}, nodos visibles: ${renderable.counters.renderNodes}.`,
    );
  }, [renderable, isLoading, error]);

  /**
   * Round-trip hook: every visual edit refreshes `Artifact.ir` and — for
   * non-C4 Mermaid artifacts — rewrites `Artifact.content` so the artifact
   * stays portable.
   */
  const canvasChange = useCallback((flow: DiagramFlowData) => {
    try {
      // Phase 2: round-trip preservation. `reactFlowToIR` recovers the
      // canvas state but the canvas does not surface every semantic field
      // (narrative, audience, layoutPlan, group.kind, owner, compliance,
      // …). We merge the fresh IR on top of the previously persisted one
      // so visual edits never degrade the IR to a poor structural model.
      const fresh = reactFlowToIR(flow.nodes, flow.edges);
      const ir = mergeIRMetadata(fresh, artifact.ir);
      // The edit snapshotted the current canvas geometry: from now on the
      // persisted positions drive the layout (until an explicit re-layout).
      ir.metadata = { ...(ir.metadata ?? {}), layoutMode: 'manual' };
      const patch: Partial<Artifact> = { ir };
      const isC4 = artifact.type.startsWith('mermaid-c4-');
      if (artifact.type.startsWith('mermaid') && !isC4 && artifact.representation === 'diagram') {
        patch.content = irToMermaid(ir);
      }
      updateArtifact(project.id, artifact.id, patch);
    } catch (err) {
      console.warn('[useDiagramRendering] round-trip IR update failed', err);
    }
  }, [artifact.id, artifact.type, artifact.representation, artifact.ir, project.id, updateArtifact]);

  const applyIssueFix = useCallback((issueId: string) => {
    // Gap 8: when the canvas is rendered straight from the canonical IR
    // (no legacy flowData re-parse), fall back to the renderable graph or
    // the currently displayed nodes. Without this fallback the quick-fix
    // panel silently no-ops on IR-direct diagrams.
    const sourceNodes = flowData?.nodes ?? renderable.reactFlow.nodes ?? displayFlowNodes;
    const sourceEdges = flowData?.edges ?? renderable.reactFlow.edges ?? displayFlowEdges;
    if (!sourceNodes?.length) return;

    const nextNodes: Node[] = [...sourceNodes];
    const nextEdges: Edge[] = [...(sourceEdges ?? [])];

    const extractTargetId = (prefix: string) => (issueId.startsWith(prefix) ? issueId.slice(prefix.length) : null);
    const nodeId = extractTargetId('node-label-eq-id-')
      || extractTargetId('node-label-long-')
      || extractTargetId('node-label-')
      || extractTargetId('node-description-')
      || extractTargetId('orphan-');
    const edgeId = extractTargetId('edge-label-')
      || extractTargetId('edge-label-long-')
      || extractTargetId('edge-ref-');

    if (nodeId) {
      const idx = nextNodes.findIndex((n: Node) => String(n.id) === nodeId);
      if (idx >= 0) {
        const current = nextNodes[idx];
        const data = { ...(current.data as Record<string, unknown>) };
        const currentLabel = String(data.label ?? current.id ?? '').trim();
        if (issueId.startsWith('node-label-eq-id-') || issueId.startsWith('node-label-')) {
          data.label = currentLabel
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (m) => m.toUpperCase()) || `Componente ${nodeId}`;
        }
        if (issueId.startsWith('node-label-long-')) {
          data.label = currentLabel.length > 24 ? `${currentLabel.slice(0, 22)}…` : currentLabel;
        }
        if (issueId.startsWith('node-description-')) {
          data.description = `Responsabilidad principal de ${String(data.label ?? currentLabel)}.`;
        }
        nextNodes[idx] = { ...current, data };
      }
    }

    if (edgeId) {
      const idx = nextEdges.findIndex((e: Edge) => String(e.id) === edgeId);
      if (idx >= 0) {
        const edge = nextEdges[idx];
        const label = String(edge.label ?? '').trim();
        let nextLabel = label;
        if (issueId.startsWith('edge-label-') || issueId.startsWith('edge-ref-')) {
          nextLabel = 'Intercambia datos';
        }
        if (issueId.startsWith('edge-label-long-')) {
          nextLabel = label.length > 32 ? `${label.slice(0, 30)}…` : label;
        }
        nextEdges[idx] = { ...edge, label: nextLabel || 'Intercambia datos' };
      }
    }

    const nextFlow = { nodes: nextNodes, edges: nextEdges };
    setFlowData(nextFlow);
    flowDataCache.current.set(artifact.id, nextFlow);
    canvasChange(nextFlow);
  }, [artifact.id, canvasChange, flowData, renderable.reactFlow.nodes, renderable.reactFlow.edges, displayFlowNodes, displayFlowEdges]);

  const cancelLoading = useCallback(() => {
    setIsLoading(false);
    setViewMode('document');
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
  }, [setViewMode]);

  const autoFix = useCallback(async () => {
    if (!error) return;
    setIsLoading(true);
    setLoadingMessage('Auto-reparando diagrama con IA...');
    setError(null);
    try {
      const fixedContent = await diagramGenerationService.fixDiagramError(artifact, error, project, settings);
      updateArtifact(project.id, artifact.id, { content: fixedContent });
      flowDataCache.current.delete(artifact.id);
      onContentFixed(fixedContent);
    } catch (err) {
      console.error('Error auto-fixing diagram:', err);
      setError('No se pudo auto-reparar el diagrama. Intenta editarlo manualmente.');
      setIsLoading(false);
    }
  }, [artifact, error, project, settings, updateArtifact, onContentFixed]);

  const resetCanvas = useCallback(() => {
    flowDataCache.current.delete(artifact.id);
    setFlowData(null);
  }, [artifact.id]);

  const retryDiagram = useCallback(() => {
    flowDataCache.current.delete(artifact.id);
    setFlowData(null);
    setError(null);
    setIsLoading(true);
    setViewMode('document');
    window.setTimeout(() => setViewMode('diagram'), 100);
  }, [artifact.id, setViewMode]);

  /**
   * Recomendación 3 → implementation: persist a layout override
   * (density or direction) on the IR's `metadata.layoutPlan` with
   * `userOverride=true` so the layout selector honours it on the next
   * ELK pass (see `lib/layoutSelector.applyUserOverride`). Triggers a
   * full retry so the canvas re-resolves with the new plan.
   *
   * Returns the applied patch (or `null` when there's no IR to update)
   * so callers can confirm the action in a toast / log.
   */
  const applyLayoutOverride = useCallback((override: { density?: 'compact' | 'normal' | 'spacious'; direction?: 'TB' | 'LR' }) => {
    if (!override.density && !override.direction) return null;
    // Recomendación 5: prefer the latest artifact state from AppContext so
    // a concurrent mutation between the user click and this dispatch
    // does not silently overwrite the override. Fall back to the closure
    // snapshot when the context accessor is not wired (legacy callers
    // and unit tests that build the hook input by hand).
    const latest = getArtifact?.(project.id, artifact.id);
    const ir = latest?.ir ?? artifact.ir;
    if (!ir) return null;
    const previous = ir.metadata?.layoutPlan;
    const nextLayoutPlan = {
      backend: previous?.backend ?? 'elk',
      algorithm: previous?.algorithm ?? 'layered',
      direction: override.direction ?? previous?.direction ?? 'LR',
      density: override.density ?? previous?.density ?? 'normal',
      orthogonal: previous?.orthogonal ?? true,
      rationale: `Override del usuario (auto-action del Visual Gate): ${[
        override.density ? `densidad ${override.density}` : null,
        override.direction ? `dirección ${override.direction}` : null,
      ].filter(Boolean).join(', ')}.`,
      computedAt: new Date().toISOString(),
      userOverride: true,
    };
    const nextIR = {
      ...ir,
      metadata: {
        ...(ir.metadata ?? {}),
        layoutPlan: nextLayoutPlan,
        // An explicit layout override asks the automatic engine to take
        // over again, releasing any previously persisted manual positions.
        layoutMode: 'auto' as const,
      },
    };
    updateArtifact(project.id, artifact.id, { ir: nextIR });
    // The selector's `applyUserOverride` will read the persisted plan on
    // the next resolve; we also bounce the view to force a re-render.
    flowDataCache.current.delete(artifact.id);
    setFlowData(null);
    return override;
  }, [artifact.id, artifact.ir, project.id, updateArtifact, getArtifact]);

  return {
    renderable,
    flowData,
    renderableSignature,
    displayFlowNodes,
    displayFlowEdges,
    displayedFlowSource,
    hasRenderableNodes,
    isLoading,
    error,
    loadingMessage,
    cancelLoading,
    autoFix,
    applyIssueFix,
    canvasChange,
    applyLayoutOverride,
    retryDiagram,
    resetCanvas,
    layoutPlan,
    hasExternalPositions: hasRenderableNodes && (
      (elkPositions !== null && elkPositions.size > 0)
      // Manual layouts ship their persisted positions inside the renderable
      // nodes themselves; the canvas must preserve them (skip its dagre pass).
      || (renderable.ir !== null && renderable.ir !== undefined && hasManualLayout(renderable.ir))
    ),
  };
};
