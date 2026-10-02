/**
 * The engine's edge routes, carried onto the canvas edges (plan de
 * diagramas, 8.3d). See `lib/edgeRoute.ts`.
 *
 * Only for an orthogonal ELK layout whose nodes nobody moved afterwards: a
 * dagre polyline is not routed around the nodes, and a cluster-separation
 * pass would leave every route pointing at where the nodes used to be.
 */
import type { Edge, Node } from 'reactflow';
import type { DiagramIREdge } from '../../lib/diagram';
import type { EdgeRoute } from '../../lib/edgeRoute';
import { edgeWaypointKey, type LayoutResult } from '../../lib/layoutEngine';

export function attachEngineRoutes(nodes: Node[], edges: Edge[], irEdges: DiagramIREdge[], layout: LayoutResult): Edge[] {
    const at = new Map(nodes.map((n) => [String(n.id), n.position] as const));
    const byId = new Map(irEdges.map((e) => [e.id, e] as const));
    return edges.map((edge) => {
        const ir = byId.get(String(edge.id));
        const points = ir ? layout.edgeWaypoints.get(edgeWaypointKey(ir.source, ir.target, ir.id)) : undefined;
        const sourceAt = at.get(String(edge.source));
        const targetAt = at.get(String(edge.target));
        if (!points || points.length < 2 || !sourceAt || !targetAt) return edge;
        const route: EdgeRoute = { points, sourceAt: { ...sourceAt }, targetAt: { ...targetAt } };
        return { ...edge, data: { ...(edge.data ?? {}), route } };
    });
}
