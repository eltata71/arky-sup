import type { DiagramAudience, DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import { detectSemanticRole } from '../../lib/diagramTokens';

export type HierarchyLevel = 'focal' | 'primary' | 'secondary' | 'supporting' | 'external' | 'risk';

export interface NodeHierarchyDecision {
  level: HierarchyLevel;
  emphasis: 'high' | 'normal' | 'low';
  hideByDefault: boolean;
}

export interface EdgeHierarchyDecision {
  level: HierarchyLevel;
  emphasis: 'high' | 'normal' | 'low';
  hideByDefault: boolean;
}

const HIGH_CRITICALITY = new Set(['high', 'critical']);

export function resolveNodeHierarchy(
  // Kept in the signature: every other policy in this family takes the whole
  // IR, and a resolver that needs graph context tomorrow should not change its
  // callers. `noUnusedParameters` wants the underscore to say it is on purpose.
  _ir: DiagramIR,
  node: DiagramIRNode,
  audience: DiagramAudience,
): NodeHierarchyDecision {
  const role = detectSemanticRole(node.label, node.kind);
  const critical = node.criticality ? HIGH_CRITICALITY.has(node.criticality) : false;
  const external = role === 'external' || role === 'person';
  if (critical) return { level: 'risk', emphasis: 'high', hideByDefault: false };
  if (external) return { level: 'external', emphasis: audience === 'executive' ? 'normal' : 'low', hideByDefault: audience === 'technical' };
  if (audience === 'executive') {
    if (role === 'system' || role === 'gateway') return { level: 'focal', emphasis: 'high', hideByDefault: false };
    if (role === 'service' || role === 'data') return { level: 'primary', emphasis: 'normal', hideByDefault: false };
    return { level: 'supporting', emphasis: 'low', hideByDefault: true };
  }
  if (audience === 'operations') {
    if (role === 'messaging' || role === 'data' || role === 'gateway') return { level: 'focal', emphasis: 'high', hideByDefault: false };
    return { level: 'secondary', emphasis: 'normal', hideByDefault: false };
  }
  // technical default
  return { level: 'primary', emphasis: 'normal', hideByDefault: false };
}

export function resolveEdgeHierarchy(
  _ir: DiagramIR,
  edge: DiagramIREdge,
  audience: DiagramAudience,
): EdgeHierarchyDecision {
  const critical = edge.criticality ? HIGH_CRITICALITY.has(edge.criticality) : false;
  if (critical) return { level: 'risk', emphasis: 'high', hideByDefault: false };
  if (audience === 'executive' && (edge.relation === 'dependency' || edge.relation === 'default')) {
    return { level: 'supporting', emphasis: 'low', hideByDefault: true };
  }
  if (audience === 'operations' && (edge.relation === 'async' || edge.relation === 'data-flow')) {
    return { level: 'focal', emphasis: 'high', hideByDefault: false };
  }
  return { level: 'secondary', emphasis: 'normal', hideByDefault: false };
}

