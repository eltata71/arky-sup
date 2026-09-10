/**
 * DiagramIR → Mermaid serializer. Used when the IR has been edited in-app and
 * we need a Mermaid representation for sharing, PDF embedding, or Lucidchart
 * import.  Deterministic; no LLM calls.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode, NodeShape } from '../../lib/diagram';

const SHAPE_WRAPPERS: Record<NodeShape, [string, string]> = {
    rectangle: ['[', ']'],
    cylinder: ['[(', ')]'],
    hexagon: ['{{', '}}'],
    cloud: ['((', '))'],
    person: ['[', ']'],
    diamond: ['{', '}'],
    'tab-box': ['[[', ']]'],
};

const RELATION_OPERATORS: Record<NonNullable<DiagramIREdge['relation']>, string> = {
    sync: '-->',
    async: '-.->',
    'data-flow': '==>',
    dependency: '---',
    inheritance: '-->',
    default: '-->',
};

function renderNode(node: DiagramIRNode): string {
    const [open, close] = SHAPE_WRAPPERS[node.shape ?? 'rectangle'];
    const label = node.label.replace(/"/g, "'");
    return `${node.id}${open}"${label}"${close}`;
}

function renderEdge(edge: DiagramIREdge): string {
    const op = RELATION_OPERATORS[edge.relation ?? 'default'];
    const rawLabel = edge.protocol && edge.label && !edge.label.toLowerCase().includes(edge.protocol.toLowerCase())
        ? `${edge.label} · ${edge.protocol}`
        : edge.label;
    const label = rawLabel ? `|${rawLabel.replace(/\|/g, '/')}|` : '';
    return `${edge.source} ${op}${label} ${edge.target}`;
}

export function irToMermaid(ir: DiagramIR): string {
    const direction = ir.nodes.length > 8 ? 'TB' : 'LR';
    const lines: string[] = [];
    if (ir.metadata?.title) {
        lines.push('---', `title: ${ir.metadata.title}`, '---');
    }
    lines.push(`flowchart ${direction}`);

    const groupedIds = new Set(ir.groups.flatMap(g => g.nodeIds));

    for (const group of ir.groups) {
        lines.push(`    subgraph ${group.id} ["${group.label}"]`);
        for (const nodeId of group.nodeIds) {
            const node = ir.nodes.find(n => n.id === nodeId);
            if (node) lines.push(`        ${renderNode(node)}`);
        }
        lines.push('    end');
    }

    for (const node of ir.nodes) {
        if (groupedIds.has(node.id)) continue;
        lines.push(`    ${renderNode(node)}`);
    }

    for (const edge of ir.edges) {
        lines.push(`    ${renderEdge(edge)}`);
    }

    return lines.join('\n');
}
