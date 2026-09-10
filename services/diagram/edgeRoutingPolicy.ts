import type { DiagramIR, DiagramIREdge } from '../../lib/diagram';

export type EdgeVisualPriority = 'critical' | 'primary' | 'secondary';

export interface EdgeRoutingDecision {
  relation: DiagramIREdge['relation'];
  preferredStyle: 'orthogonal' | 'smooth' | 'bezier';
  laneAware: boolean;
  avoidCrossBoundary: boolean;
  visualPriority: EdgeVisualPriority;
}

export function resolveEdgeRoutingDecision(ir: DiagramIR, edge: DiagramIREdge): EdgeRoutingDecision {
  const dtype = String(ir.metadata?.diagramType ?? '').toLowerCase();
  const critical = edge.criticality === 'critical' || edge.criticality === 'high';
  const visualPriority: EdgeVisualPriority = critical ? 'critical' : (edge.relation === 'sync' || edge.relation === 'data-flow' ? 'primary' : 'secondary');

  if (dtype.includes('bpmn')) {
    return {
      relation: edge.relation,
      preferredStyle: edge.relation === 'dependency' ? 'bezier' : 'orthogonal',
      laneAware: true,
      avoidCrossBoundary: true,
      visualPriority,
    };
  }
  if (dtype.includes('integration') || dtype.includes('value-stream')) {
    return {
      relation: edge.relation,
      preferredStyle: 'orthogonal',
      laneAware: true,
      avoidCrossBoundary: true,
      visualPriority,
    };
  }
  // Async edges keep their dashed stroke + animation as the visual cue;
  // routing stays smoothstep like every other relation. The previous
  // async→bezier rule produced long free-form arcs that crossed nodes and
  // other edges on any diagram with distant async pairs.
  return {
    relation: edge.relation,
    preferredStyle: 'smooth',
    laneAware: false,
    avoidCrossBoundary: false,
    visualPriority,
  };
}

