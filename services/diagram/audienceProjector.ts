/**
 * Audience-aware DiagramIR projections.
 *
 *  executive  → strip implementation detail, collapse small groups into a
 *               single "System" super-node, surface only person/gateway/data
 *               actors, keep every edge whose label maps to a business verb.
 *  technical  → preserve full detail, but drop noise (undescribed leaf nodes
 *               that are not connected to other components).
 *  operations → emphasise runtime flows; hide group boundaries; promote
 *               queue/messaging edges with asterisks.
 */

import type { DiagramAudience, DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import { detectSemanticRole } from '../../lib/diagramTokens';

function cloneIR(ir: DiagramIR): DiagramIR {
    return {
        nodes: ir.nodes.map(n => ({ ...n })),
        edges: ir.edges.map(e => ({ ...e })),
        groups: ir.groups.map(g => ({ ...g, nodeIds: [...g.nodeIds] })),
        metadata: { ...(ir.metadata ?? {}) },
    };
}

function filterDanglingEdges(ir: DiagramIR): DiagramIR {
    const ids = new Set(ir.nodes.map(n => n.id));
    ir.edges = ir.edges.filter(e => ids.has(e.source) && ids.has(e.target));
    return ir;
}

function executiveProjection(input: DiagramIR): DiagramIR {
    const ir = cloneIR(input);
    const prioritisedRoles: Array<ReturnType<typeof detectSemanticRole>> = ['person', 'system', 'gateway', 'data', 'external'];
    const promoted = new Map<string, DiagramIRNode>();

    for (const node of ir.nodes) {
        const role = detectSemanticRole(node.label, node.kind);
        if (prioritisedRoles.includes(role)) promoted.set(node.id, node);
    }

    // Collapse untyped "services" into their group as one node per group.
    const leftover = ir.nodes.filter(n => !promoted.has(n.id));
    const grouped: Record<string, DiagramIRNode[]> = {};
    for (const n of leftover) {
        const key = n.group ?? '__ungrouped__';
        grouped[key] = grouped[key] ?? [];
        grouped[key].push(n);
    }

    const newNodes: DiagramIRNode[] = Array.from(promoted.values());
    const idMap: Record<string, string> = {};
    ir.nodes.forEach(n => (idMap[n.id] = n.id));

    Object.entries(grouped).forEach(([groupLabel, nodes]) => {
        if (nodes.length === 0) return;
        if (groupLabel === '__ungrouped__' && nodes.length <= 1) {
            newNodes.push(...nodes);
            return;
        }
        const collapsedId = `group_${groupLabel.replace(/\W+/g, '_')}`;
        newNodes.push({
            id: collapsedId,
            label: groupLabel === '__ungrouped__' ? 'Sistemas internos' : groupLabel,
            kind: 'Subsystem',
            description: nodes.map(n => n.label).slice(0, 4).join(', '),
        });
        nodes.forEach(n => (idMap[n.id] = collapsedId));
    });

    const dedupeKey = (e: DiagramIREdge) => `${e.source}→${e.target}`;
    const seen = new Map<string, DiagramIREdge>();
    for (const e of ir.edges) {
        const src = idMap[e.source] ?? e.source;
        const tgt = idMap[e.target] ?? e.target;
        if (src === tgt) continue;
        const next: DiagramIREdge = { ...e, source: src, target: tgt };
        const key = dedupeKey(next);
        if (!seen.has(key)) seen.set(key, next);
    }

    ir.nodes = newNodes;
    ir.edges = Array.from(seen.values());
    ir.groups = [];
    ir.metadata = { ...(ir.metadata ?? {}), audience: 'executive' };
    return filterDanglingEdges(ir);
}

// C4 canonical element kinds that are always meaningful, even if they appear
// as isolated declarations with no edge at this diagram level (e.g. a Person
// actor whose Rel lives one level up, or an external System_Ext stub).
//
// Includes Db/Queue variants because Mermaid's C4 dialect uses ContainerDb,
// ContainerQueue, ComponentDb, ComponentQueue, SystemDb to type databases and
// message brokers. Without these, persisted IRs that retain the suffix would
// be silently dropped from the technical view, leaving only the application
// containers visible (the most common "blank canvas after C4 generation"
// failure mode reported by the field).
const C4_PRIMARY_KINDS = /^(Person|System(?:Db|Queue)?|SoftwareSystem|Container(?:Db|Queue)?|Component(?:Db|Queue)?)$/i;

function technicalProjection(input: DiagramIR): DiagramIR {
    const ir = cloneIR(input);
    const connected = new Set<string>();
    ir.edges.forEach(e => { connected.add(e.source); connected.add(e.target); });

    // Detect C4 diagrams by presence of at least one canonical C4 kind.
    // When detected, keep all primary C4 element nodes unconditionally so
    // that top-level actors (Person, System_Ext) are never silently dropped.
    const hasC4Nodes = ir.nodes.some(n => C4_PRIMARY_KINDS.test(n.kind));
    const isC4Primary = (n: DiagramIRNode) => hasC4Nodes && C4_PRIMARY_KINDS.test(n.kind);

    ir.nodes = ir.nodes.filter(n =>
        connected.has(n.id) ||
        !!n.description ||
        !!n.group ||
        isC4Primary(n)
    );
    ir.metadata = { ...(ir.metadata ?? {}), audience: 'technical' };
    return filterDanglingEdges(ir);
}

function operationsProjection(input: DiagramIR): DiagramIR {
    const ir = cloneIR(input);
    ir.groups = [];
    ir.nodes = ir.nodes.map(n => ({ ...n, group: undefined }));
    ir.edges = ir.edges.map(e => {
        if (!e.label) return e;
        const l = e.label.trim();
        if (!/^[*⏱🔁]/u.test(l) && (e.relation === 'async' || e.relation === 'data-flow')) {
            return { ...e, label: `* ${l}` };
        }
        return e;
    });
    ir.metadata = { ...(ir.metadata ?? {}), audience: 'operations' };
    return filterDanglingEdges(ir);
}

export function projectIR(ir: DiagramIR, audience: DiagramAudience): DiagramIR {
    let projected: DiagramIR;
    switch (audience) {
        case 'executive':   projected = executiveProjection(ir); break;
        case 'operations':  projected = operationsProjection(ir); break;
        case 'technical':
        default:            projected = technicalProjection(ir); break;
    }
    // Safety net: a projection that strips every node would render as an
    // empty canvas (the "blank workspace" failure mode). When that happens,
    // fall back to the original IR with the audience tag attached so the
    // user still sees *something* and the metadata stays accurate.
    if (projected.nodes.length === 0 && ir.nodes.length > 0) {
        return {
            ...ir,
            nodes: ir.nodes.map(n => ({ ...n })),
            edges: ir.edges.map(e => ({ ...e })),
            groups: ir.groups.map(g => ({ ...g, nodeIds: [...g.nodeIds] })),
            metadata: { ...(ir.metadata ?? {}), audience, degradationReason: 'audience-empty-fallback' },
        };
    }
    return projected;
}
