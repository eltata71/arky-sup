import type { DiagramIREdge, DiagramIRNode } from '../../lib/diagram';

export interface NodeLabelDecision {
  title: string;
  subtitle?: string;
  tooltip: string;
}

export interface EdgeLabelDecision {
  visibleLabel: string;
  protocolBadge?: string;
  tooltip: string;
}

const truncateWords = (value: string, max = 48): string => {
  const text = value.trim();
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > Math.floor(max * 0.6) ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
};

export function resolveNodeLabelDecision(node: DiagramIRNode): NodeLabelDecision {
  const rawTitle = (node.label ?? '').trim() || node.id;
  const title = truncateWords(rawTitle, 56);
  const subtitle = node.technology?.trim() || node.kind?.trim() || undefined;
  const tooltip = [rawTitle, node.description, node.businessMeaning, node.technicalMeaning].filter(Boolean).join(' · ');
  return { title, subtitle, tooltip: tooltip || rawTitle };
}

export function resolveEdgeLabelDecision(edge: DiagramIREdge): EdgeLabelDecision {
  const raw = (edge.label ?? '').trim() || 'Relaciona';
  const visibleLabel = truncateWords(raw.replace(/\s*[·|-]\s*\S+$/u, ''), 42);
  const protocolBadge = edge.protocol?.trim() || undefined;
  const tooltip = [raw, edge.protocol, edge.security, edge.frequency, edge.payload].filter(Boolean).join(' · ');
  return { visibleLabel, protocolBadge, tooltip: tooltip || raw };
}
