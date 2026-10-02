import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtifactType } from '../../types';
import type { DiagramIR } from '../../lib/diagram';
import type { EdgeRoute } from '../../lib/edgeRoute';
import type { LayoutPlan } from '../../lib/layoutSelector';
import { hasManualLayout, irToReactFlowSmart } from '../../services/diagram/irToReactFlow';

/** How long the canvas waits for the ELK pass before showing the dagre layout (8.3d). */
const ELK_WAIT_MS = 1500;

export interface ElkLayoutPass {
  /** Node positions from the ELK pass; `null` keeps the synchronous dagre render. */
  elkPositions: Map<string, { x: number; y: number }> | null;
  /** The orthogonal route ELK computed for each edge, by edge id (8.3d). */
  elkRoutes: Map<string, EdgeRoute> | null;
  /** The plan the pass chose. Kept in memory: opening never writes it (8.1d). */
  layoutPlan: LayoutPlan | null;
  /** True while the canvas should wait for the pass instead of painting dagre. */
  layoutPending: boolean;
}

/**
 * The async ELK pass of the diagram canvas, extracted from
 * `useDiagramRendering` (plan de diagramas 8.3d).
 *
 * No flicker. The canvas used to paint the synchronous dagre layout and jump
 * to ELK's a moment later, which reads as the diagram rearranging itself.
 * When a pass is due, `layoutPending` holds the canvas behind the skeleton
 * up to ELK_WAIT_MS; past that the dagre layout is shown and the late result
 * still lands. It is derived during render from the IR's signature, not set
 * in an effect, so not even one frame of the dagre layout is painted.
 *
 * No pass for an IR with fewer than two nodes, a placeholder, a manual
 * layout (the architect's positions are the source of truth) or with
 * `VITE_DIAGRAM_ELK=off`. Failures are swallowed: the canvas keeps dagre.
 */
export const useElkLayoutPass = (
  artifactId: string,
  artifactType: ArtifactType,
  ir: DiagramIR | null | undefined,
): ElkLayoutPass => {
  const [elkPositions, setElkPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [elkRoutes, setElkRoutes] = useState<Map<string, EdgeRoute> | null>(null);
  const [layoutPlan, setLayoutPlan] = useState<LayoutPlan | null>(null);
  // The signature whose pass is over — resolved, failed or past its wait.
  const [settledSignature, setSettledSignature] = useState<string | null>(null);
  // The signature ELK was last asked for, to ignore stale resolves.
  const requestRef = useRef('');
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const signature = useMemo(() => {
    if (!ir || ir.nodes.length < 2) return null;
    if (ir.metadata?.degradationReason === 'no-parseable-content' || hasManualLayout(ir)) return null;
    if (((import.meta.env.VITE_DIAGRAM_ELK ?? 'on') as string).toLowerCase() === 'off') return null;
    return `${artifactId}::${ir.nodes.length}::${ir.edges.length}::${ir.metadata?.diagramType ?? ''}`;
  }, [artifactId, ir]);

  useEffect(() => {
    if (!ir || ir.nodes.length < 2 || hasManualLayout(ir)) {
      setElkPositions(null);
      setElkRoutes(null);
      if (!ir || ir.nodes.length < 2) setLayoutPlan(null);
      return;
    }
    if (!signature) return;
    requestRef.current = signature;
    let cancelled = false;
    const settle = () => {
      if (!cancelled && isMounted.current) setSettledSignature(signature);
    };
    const waitTimer = setTimeout(settle, ELK_WAIT_MS);

    void (async () => {
      try {
        const result = await irToReactFlowSmart(ir, artifactType);
        if (cancelled || !isMounted.current || requestRef.current !== signature) return;
        if (result.plan.backend === 'dagre') {
          // ELK was not attempted (or fell back): the dagre render IS the plan.
          setLayoutPlan(result.plan);
          setElkPositions(null);
          setElkRoutes(null);
          settle();
          return;
        }
        const positions = new Map<string, { x: number; y: number }>();
        for (const node of result.nodes) {
          if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) {
            positions.set(String(node.id), { x: node.position.x, y: node.position.y });
          }
        }
        if (positions.size === 0) {
          // Zero positions is a failure: keep dagre rather than stack every node at (0,0).
          console.warn('[useElkLayoutPass] ELK returned no positions; keeping dagre render.');
          settle();
          return;
        }
        const routes = new Map<string, EdgeRoute>();
        for (const edge of result.edges) {
          const route = (edge.data as { route?: EdgeRoute } | undefined)?.route;
          if (route) routes.set(String(edge.id), route);
        }
        setLayoutPlan(result.plan);
        setElkPositions(positions);
        setElkRoutes(routes.size > 0 ? routes : null);
        settle();
      } catch (err) {
        // No WASM, jsdom, or the bundle tree-shaken out: dagre is on screen.
        if (!cancelled) console.warn('[useElkLayoutPass] ELK pass failed, keeping dagre render', err);
        settle();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(waitTimer);
    };
  }, [artifactType, ir, signature]);

  return {
    elkPositions,
    elkRoutes,
    layoutPlan,
    layoutPending: signature !== null && settledSignature !== signature,
  };
};
