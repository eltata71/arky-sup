/**
 * Architectural guardrails for DiagramIR.
 *
 * The deterministic quality analyser (`diagramQualityService`) already covers
 * "shape" issues — broken edges, missing labels, orphan nodes, etc.  This
 * module covers a different axis: **architectural correctness** in the sense
 * a senior solution architect would reject during a design review.
 *
 *  - C4 layer violations (UI → DB without going through a service/gateway).
 *  - External system depending directly on internal data stores.
 *  - Generic, non-narrative edge labels that betray the lack of a story.
 *  - Sync edges missing protocol hints when the audience is technical.
 *  - Cycles in flow-style diagrams that are not labelled as retry/feedback.
 *
 * The output is consumed by:
 *   1. The AI critique pass (so the LLM can fix what we already detected).
 *   2. `autoRepairIR` (so deterministic fixes can be applied without an LLM).
 *
 * These checks deliberately do not raise exceptions: they accumulate a list
 * of `ArchitecturalViolation` items so callers can decide whether to gate,
 * repair, or just surface them.
 */

import type { ArtifactType } from '../../types';
import type { DiagramAudience, DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import { detectSemanticRole } from '../../lib/diagramTokens';

export type ViolationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ArchitecturalViolation {
    code: string;
    severity: ViolationSeverity;
    message: string;
    /** Human-friendly recommendation an architect can act on. */
    recommendation: string;
    /** Affected nodeIds / edgeIds — used by the auto-repair pass. */
    targetIds?: string[];
    /** Optional category for routing fixes. */
    category?:
        | 'layer-violation'
        | 'cycle'
        | 'orphan-architecture'
        | 'narrative-poverty'
        | 'protocol-missing'
        | 'grouping'
        | 'consistency';
}

export interface GuardrailContext {
    type: ArtifactType;
    audience: DiagramAudience;
}

/** Conservative dictionary of weak / generic edge labels we treat as poor narrative. */
const GENERIC_EDGE_LABELS = new Set([
    'call', 'calls', 'invoke', 'invokes', 'request', 'requests', 'response',
    'data', 'datos', 'flow', 'flujo', 'uses', 'usa', 'use',
    'connects', 'connection', 'link', 'enlace', 'edge', 'arrow',
    'reads', 'writes', 'read', 'write', 'rw',
    '->', '-->', '=>', '<-', '<->', '',
]);

/** Layer rank used to detect C4 layer violations. Lower = closer to the user. */
const LAYER_RANK: Record<string, number> = {
    person: 0,
    external: 1,
    gateway: 2,
    service: 3,
    process: 4,
    messaging: 5,
    data: 6,
    system: 3,
    generic: 3,
};

/**
 * Returns true when an edge labelled "Reintenta", "Retry", "Feedback" etc.
 * — we don't flag these as illegal cycles.
 */
function looksLikeFeedbackEdge(edge: DiagramIREdge): boolean {
    const label = (edge.label ?? '').toLowerCase();
    if (!label) return false;
    return /\b(retry|reintenta|feedback|loop|reintenta|reintento|fallback)\b/.test(label);
}

function nodeRole(node: DiagramIRNode): string {
    return detectSemanticRole(node.label ?? '', node.kind);
}

/** Detects edges that traverse the user→data layer without a service/gateway. */
function detectLayerViolations(ir: DiagramIR, ctx: GuardrailContext): ArchitecturalViolation[] {
    if (!ctx.type.startsWith('mermaid-c4-') && ctx.type !== 'mermaid-graph' && ctx.type !== 'react-flow-graph') {
        return [];
    }
    const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
    const violations: ArchitecturalViolation[] = [];
    for (const edge of ir.edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        const sourceRole = nodeRole(source);
        const targetRole = nodeRole(target);
        const sRank = LAYER_RANK[sourceRole] ?? 3;
        const tRank = LAYER_RANK[targetRole] ?? 3;
        // UI / person → data store directly (skipping service/gateway).
        if (sourceRole === 'person' && targetRole === 'data') {
            violations.push({
                code: 'C4_UI_BYPASSES_SERVICE',
                severity: 'high',
                message: `Person/UI "${source.label}" connects directly to data store "${target.label}".`,
                recommendation: `Insert a service or gateway node between "${source.label}" and "${target.label}", and route the edge through it.`,
                targetIds: [edge.id],
                category: 'layer-violation',
            });
        }
        // External system → internal data store.
        if (sourceRole === 'external' && targetRole === 'data') {
            violations.push({
                code: 'C4_EXTERNAL_TOUCHES_DATA',
                severity: 'high',
                message: `External system "${source.label}" reads/writes the internal data store "${target.label}" directly.`,
                recommendation: `Cross via a gateway, public API or anti-corruption layer instead of letting an external system reach a private data store.`,
                targetIds: [edge.id],
                category: 'layer-violation',
            });
        }
        // Layer skip: jumping more than 2 layers downstream looks suspicious.
        if (tRank - sRank >= 4) {
            violations.push({
                code: 'C4_LAYER_SKIP',
                severity: 'medium',
                message: `Edge from "${source.label}" (${sourceRole}) jumps to "${target.label}" (${targetRole}) skipping intermediate layers.`,
                recommendation: `Either route through the missing layer (e.g. service / gateway) or document explicitly why the shortcut is intentional.`,
                targetIds: [edge.id],
                category: 'layer-violation',
            });
        }
    }
    return violations;
}

/** Detects cycles that are not labelled as retry/feedback in flow diagrams. */
function detectIllegalCycles(ir: DiagramIR, ctx: GuardrailContext): ArchitecturalViolation[] {
    if (
        ctx.type !== 'mermaid-graph' &&
        ctx.type !== 'react-flow-graph' &&
        ctx.type !== 'hybrid-text-diagram'
    ) {
        return [];
    }
    const adjacency = new Map<string, DiagramIREdge[]>();
    for (const edge of ir.edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        adjacency.get(edge.source)!.push(edge);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();
    const cycleEdgeIds = new Set<string>();

    const dfs = (id: string, parentEdgeId?: string): void => {
        if (stack.has(id)) {
            if (parentEdgeId) cycleEdgeIds.add(parentEdgeId);
            return;
        }
        if (visited.has(id)) return;
        visited.add(id);
        stack.add(id);
        for (const edge of adjacency.get(id) ?? []) {
            if (looksLikeFeedbackEdge(edge)) continue;
            dfs(edge.target, edge.id);
        }
        stack.delete(id);
    };
    for (const node of ir.nodes) dfs(node.id);

    if (cycleEdgeIds.size === 0) return [];
    return [{
        code: 'FLOW_ILLEGAL_CYCLE',
        severity: 'medium',
        message: `Flow contains ${cycleEdgeIds.size} edge(s) participating in a cycle without a retry/feedback label.`,
        recommendation: `If the loop is intentional (retry, feedback, polling), label the back-edge with a verb such as "Reintenta", "Reprograma" or "Notifica fallback" and use the "async" relation.`,
        targetIds: Array.from(cycleEdgeIds),
        category: 'cycle',
    }];
}

/** Detects edges with weak / generic labels that betray narrative poverty. */
function detectGenericLabels(ir: DiagramIR): ArchitecturalViolation[] {
    const offenders: string[] = [];
    for (const edge of ir.edges) {
        const label = (edge.label ?? '').trim().toLowerCase();
        if (!label) continue; // covered by static analyser as missing label
        if (GENERIC_EDGE_LABELS.has(label)) {
            offenders.push(edge.id);
        }
    }
    if (offenders.length === 0) return [];
    return [{
        code: 'EDGE_LABEL_GENERIC',
        severity: 'medium',
        message: `${offenders.length} edge(s) use generic, non-narrative labels (e.g. "data", "call", "uses").`,
        recommendation: `Replace with verb + object phrases that tell the story: "Autentica al usuario", "Publica evento de pago", "Sincroniza catálogo".`,
        targetIds: offenders,
        category: 'narrative-poverty',
    }];
}

/** Technical audience without protocols on sync edges is a smell. */
function detectMissingProtocols(ir: DiagramIR, ctx: GuardrailContext): ArchitecturalViolation[] {
    if (ctx.audience !== 'technical') return [];
    const offenders: string[] = [];
    const protocolHint = /\b(http|https|grpc|rest|graphql|jdbc|odbc|amqp|mqtt|kafka|tcp|udp|ws|sse|s3|sql|nfs|smb)\b/i;
    for (const edge of ir.edges) {
        if (edge.relation && edge.relation !== 'sync') continue;
        if (edge.protocol) continue;
        if (protocolHint.test(edge.label ?? '')) continue;
        offenders.push(edge.id);
    }
    if (offenders.length === 0) return [];
    return [{
        code: 'EDGE_MISSING_PROTOCOL',
        severity: 'low',
        message: `${offenders.length} sync edge(s) lack an explicit protocol — required when the audience is "technical".`,
        recommendation: `Append the wire format to the edge label or set the \`protocol\` field ("HTTPS/JSON", "gRPC", "JDBC").`,
        targetIds: offenders,
        category: 'protocol-missing',
    }];
}

/** Suggests a group when there are ≥5 ungrouped nodes and no group exists. */
function detectMissingGrouping(ir: DiagramIR): ArchitecturalViolation[] {
    if (ir.groups.length > 0) return [];
    if (ir.nodes.length < 5) return [];
    return [{
        code: 'GROUPING_RECOMMENDED',
        severity: 'low',
        message: `Diagram has ${ir.nodes.length} nodes but no grouping/boundary blocks.`,
        recommendation: `Introduce a boundary group per bounded context, capability or runtime tier — the renderer will emit subgraphs for navigation.`,
        category: 'grouping',
    }];
}

/** Inconsistent kinds (e.g. "DB" mixed with "data" mixed with "database"). */
function detectInconsistentKinds(ir: DiagramIR): ArchitecturalViolation[] {
    const counts = new Map<string, string[]>();
    for (const node of ir.nodes) {
        const role = nodeRole(node);
        if (!counts.has(role)) counts.set(role, []);
        counts.get(role)!.push((node.kind ?? '').toLowerCase());
    }
    const offenders: string[] = [];
    for (const [, kinds] of counts) {
        const unique = new Set(kinds.filter(Boolean));
        if (unique.size > 2) offenders.push(...kinds);
    }
    if (offenders.length === 0) return [];
    return [{
        code: 'KIND_INCONSISTENT',
        severity: 'low',
        message: `Multiple synonymous "kind" values are used for nodes that map to the same semantic role.`,
        recommendation: `Pick a single canonical kind per role (e.g. always "data" instead of mixing "data", "db", "database").`,
        category: 'consistency',
    }];
}

/**
 * Public entry point. Runs every guardrail and returns the union of
 * violations.  The order in the returned array matches the order checks ran
 * — callers can sort by severity if they need to.
 */
export function detectArchitecturalViolations(ir: DiagramIR, ctx: GuardrailContext): ArchitecturalViolation[] {
    if (!ir || !Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) return [];
    return [
        ...detectLayerViolations(ir, ctx),
        ...detectIllegalCycles(ir, ctx),
        ...detectGenericLabels(ir),
        ...detectMissingProtocols(ir, ctx),
        ...detectMissingGrouping(ir),
        ...detectInconsistentKinds(ir),
    ];
}

/**
 * Convenience helper: returns true when the IR has no violation at the given
 * severity threshold or above.  Useful for preflight checks.
 */
export function passesArchitecturalGate(
    ir: DiagramIR,
    ctx: GuardrailContext,
    threshold: ViolationSeverity = 'high',
): boolean {
    const order: ViolationSeverity[] = ['low', 'medium', 'high', 'critical'];
    const cutoff = order.indexOf(threshold);
    return detectArchitecturalViolations(ir, ctx).every((v) => order.indexOf(v.severity) < cutoff);
}
