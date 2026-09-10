import type { Node, Edge } from 'reactflow';

/** ReactFlow graph payload shared by the diagram pipeline and its viewers. */
export type DiagramFlowData = { nodes: Node[]; edges: Edge[] };

/** Runtime guard ensuring a parsed JSON blob is a valid ReactFlow graph. */
export const isDiagramFlowData = (value: unknown): value is DiagramFlowData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(candidate.nodes) && Array.isArray(candidate.edges);
};
