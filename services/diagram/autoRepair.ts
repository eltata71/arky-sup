/**
 * Deterministic auto-repair pipeline for DiagramIR.
 *
 * Given an IR plus a list of architectural violations (from the guardrails
 * module), this applies surgical, non-destructive fixes that do NOT depend
 * on the LLM:
 *
 *   - Generic edge label  → verb derived from source/target kinds.
 *   - Missing protocol    → derive from edge label or fall back to "HTTPS".
 *   - UI bypassing service→ insert synthetic gateway/service node.
 *   - External → data    → insert synthetic gateway between the two.
 *   - Missing grouping    → group nodes by their semantic role.
 *   - Illegal cycle       → relabel back-edges with "Reintenta" + async.
 *
 * Repairs are tracked in `metadata.repairHistory` so a downstream UI can
 * show the user what was changed automatically.
 *
 * Invariants:
 *   - Existing nodes / edges are NEVER deleted.
 *   - Mutations are minimal (one property at a time when possible).
 *   - Every repair returns a structured `RepairChange` so it can be undone or
 *     surfaced to the user.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode } from '../../lib/diagram';
import { detectSemanticRole } from '../../lib/diagramTokens';
import type { ArchitecturalViolation } from './guardrails';

export interface RepairChange {
    code: string;
    description: string;
    targetIds?: string[];
}

export interface AutoRepairResult {
    ir: DiagramIR;
    applied: RepairChange[];
    unfixed: ArchitecturalViolation[];
}

/** Verb table keyed by source role → fallback verb for generic labels. */
const VERB_BY_SOURCE_ROLE: Record<string, string> = {
    person: 'Solicita',
    gateway: 'Enruta',
    service: 'Invoca',
    process: 'Orquesta',
    messaging: 'Publica',
    data: 'Consulta',
    external: 'Integra',
    system: 'Coordina',
    generic: 'Conecta',
};

/** Object derived from target role — paired with a verb to form a phrase. */
const OBJECT_BY_TARGET_ROLE: Record<string, string> = {
    person: 'al usuario',
    gateway: 'a la pasarela',
    service: 'al servicio',
    process: 'el proceso',
    messaging: 'evento al broker',
    data: 'al almacén',
    external: 'al sistema externo',
    system: 'al sistema',
    generic: 'al destino',
};

function uniqueId(prefix: string, taken: Set<string>): string {
    let i = 1;
    while (taken.has(`${prefix}-${i}`)) i += 1;
    const id = `${prefix}-${i}`;
    taken.add(id);
    return id;
}

function deepCloneIR(ir: DiagramIR): DiagramIR {
    return {
        nodes: ir.nodes.map((n) => ({ ...n })),
        edges: ir.edges.map((e) => ({ ...e })),
        groups: ir.groups.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })),
        metadata: { ...(ir.metadata ?? {}) },
    };
}

function buildRepairLabel(source: DiagramIRNode | undefined, target: DiagramIRNode | undefined): string {
    if (!source || !target) return 'Interactúa';
    const sRole = detectSemanticRole(source.label ?? '', source.kind);
    const tRole = detectSemanticRole(target.label ?? '', target.kind);
    const verb = VERB_BY_SOURCE_ROLE[sRole] ?? 'Conecta';
    const obj = OBJECT_BY_TARGET_ROLE[tRole] ?? 'al destino';
    return `${verb} ${obj}`.slice(0, 60);
}

/* ─────────────────────────── individual repairs ─────────────────────────── */

function repairGenericLabels(
    ir: DiagramIR,
    violation: ArchitecturalViolation,
    applied: RepairChange[],
): boolean {
    if (!violation.targetIds?.length) return false;
    const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
    const fixed: string[] = [];
    for (const id of violation.targetIds) {
        const edge = ir.edges.find((e) => e.id === id);
        if (!edge) continue;
        const newLabel = buildRepairLabel(nodeMap.get(edge.source), nodeMap.get(edge.target));
        if (!newLabel || newLabel === edge.label) continue;
        edge.label = newLabel;
        fixed.push(id);
    }
    if (!fixed.length) return false;
    applied.push({
        code: 'EDGE_LABEL_GENERIC',
        description: `Reemplazado label genérico por verbo accionable en ${fixed.length} arista(s).`,
        targetIds: fixed,
    });
    return true;
}

function repairMissingProtocols(
    ir: DiagramIR,
    violation: ArchitecturalViolation,
    applied: RepairChange[],
): boolean {
    if (!violation.targetIds?.length) return false;
    const fixed: string[] = [];
    for (const id of violation.targetIds) {
        const edge = ir.edges.find((e) => e.id === id);
        if (!edge || edge.protocol) continue;
        edge.protocol = 'HTTPS/JSON';
        if (edge.label && !/\b(http|grpc|jdbc|amqp|kafka|sql)\b/i.test(edge.label)) {
            edge.label = `${edge.label} (HTTPS)`.slice(0, 60);
        }
        fixed.push(id);
    }
    if (!fixed.length) return false;
    applied.push({
        code: 'EDGE_MISSING_PROTOCOL',
        description: `Agregado protocolo HTTPS por defecto a ${fixed.length} arista(s) sync.`,
        targetIds: fixed,
    });
    return true;
}

function repairLayerViolation(
    ir: DiagramIR,
    violation: ArchitecturalViolation,
    applied: RepairChange[],
): boolean {
    const edgeId = violation.targetIds?.[0];
    if (!edgeId) return false;
    const edge = ir.edges.find((e) => e.id === edgeId);
    if (!edge) return false;
    const nodeIdSet = new Set(ir.nodes.map((n) => n.id));
    const edgeIdSet = new Set(ir.edges.map((e) => e.id));
    const sourceNode = ir.nodes.find((n) => n.id === edge.source);
    const targetNode = ir.nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) return false;

    const isExternal = violation.code === 'C4_EXTERNAL_TOUCHES_DATA';
    const newKind = isExternal ? 'gateway' : 'service';
    const newLabel = isExternal ? 'API Gateway' : `${targetNode.label} Service`.slice(0, 24);
    const newId = uniqueId(isExternal ? 'gateway' : 'svc', nodeIdSet);

    ir.nodes.push({
        id: newId,
        label: newLabel,
        kind: newKind,
        description: isExternal
            ? 'Gateway sintético: media el acceso externo al almacén interno.'
            : 'Servicio sintético: encapsula el acceso al almacén de datos.',
    });

    const inboundLabel = buildRepairLabel(sourceNode, { id: newId, label: newLabel, kind: newKind });
    const outboundLabel = buildRepairLabel({ id: newId, label: newLabel, kind: newKind }, targetNode);

    edge.target = newId;
    if (!edge.label || edge.label === 'Interactúa') edge.label = inboundLabel;

    const outboundId = uniqueId(`${newId}-to`, edgeIdSet);
    const outboundEdge: DiagramIREdge = {
        id: outboundId,
        source: newId,
        target: targetNode.id,
        label: outboundLabel,
        relation: 'sync',
    };
    ir.edges.push(outboundEdge);

    applied.push({
        code: violation.code,
        description: isExternal
            ? `Insertado API Gateway sintético entre "${sourceNode.label}" y "${targetNode.label}" para evitar acceso externo directo a datos.`
            : `Insertado servicio sintético entre "${sourceNode.label}" y "${targetNode.label}" para no saltarse la capa de servicio.`,
        targetIds: [newId, edge.id, outboundId],
    });
    return true;
}

function repairMissingGrouping(
    ir: DiagramIR,
    violation: ArchitecturalViolation,
    applied: RepairChange[],
): boolean {
    if (ir.groups.length > 0) return false;
    const buckets = new Map<string, string[]>();
    for (const node of ir.nodes) {
        const role = detectSemanticRole(node.label ?? '', node.kind);
        if (!buckets.has(role)) buckets.set(role, []);
        buckets.get(role)!.push(node.id);
    }
    const groups: DiagramIRGroup[] = [];
    let i = 1;
    for (const [role, ids] of buckets) {
        if (ids.length < 2) continue;
        groups.push({
            id: `group-${i++}`,
            label: groupLabelForRole(role),
            nodeIds: ids,
        });
    }
    if (!groups.length) return false;
    ir.groups.push(...groups);
    applied.push({
        code: violation.code,
        description: `Creados ${groups.length} grupo(s) por rol semántico para mejorar jerarquía visual.`,
        targetIds: groups.map((g) => g.id),
    });
    return true;
}

function groupLabelForRole(role: string): string {
    switch (role) {
        case 'person':    return 'Actores';
        case 'gateway':   return 'Capa de borde';
        case 'service':   return 'Servicios';
        case 'process':   return 'Procesos';
        case 'messaging': return 'Mensajería';
        case 'data':      return 'Datos';
        case 'external':  return 'Sistemas externos';
        case 'system':    return 'Sistemas';
        default:          return 'Componentes';
    }
}

function repairCycle(
    ir: DiagramIR,
    violation: ArchitecturalViolation,
    applied: RepairChange[],
): boolean {
    if (!violation.targetIds?.length) return false;
    const fixed: string[] = [];
    for (const id of violation.targetIds) {
        const edge = ir.edges.find((e) => e.id === id);
        if (!edge) continue;
        edge.relation = 'async';
        if (!/\b(retry|reintenta|fallback|reintento)\b/i.test(edge.label ?? '')) {
            edge.label = `Reintenta · ${edge.label ?? ''}`.trim().slice(0, 60);
        }
        fixed.push(id);
    }
    if (!fixed.length) return false;
    applied.push({
        code: 'FLOW_ILLEGAL_CYCLE',
        description: `Marcadas ${fixed.length} arista(s) cíclica(s) como retry async.`,
        targetIds: fixed,
    });
    return true;
}

/* ─────────────────────────── public API ─────────────────────────── */

/**
 * Apply deterministic repairs for any violation we know how to fix.  Returns
 * the (possibly mutated) IR alongside the list of changes applied and any
 * violations we couldn't address — those should be passed back to the
 * AI critique pass for resolution.
 */
export function autoRepairIR(
    ir: DiagramIR,
    violations: ArchitecturalViolation[],
): AutoRepairResult {
    const next = deepCloneIR(ir);
    const applied: RepairChange[] = [];
    const unfixed: ArchitecturalViolation[] = [];

    for (const violation of violations) {
        let handled: boolean;
        switch (violation.code) {
            case 'EDGE_LABEL_GENERIC':
                handled = repairGenericLabels(next, violation, applied);
                break;
            case 'EDGE_MISSING_PROTOCOL':
                handled = repairMissingProtocols(next, violation, applied);
                break;
            case 'C4_UI_BYPASSES_SERVICE':
            case 'C4_EXTERNAL_TOUCHES_DATA':
                handled = repairLayerViolation(next, violation, applied);
                break;
            case 'GROUPING_RECOMMENDED':
                handled = repairMissingGrouping(next, violation, applied);
                break;
            case 'FLOW_ILLEGAL_CYCLE':
                handled = repairCycle(next, violation, applied);
                break;
            default:
                handled = false;
        }
        if (!handled) unfixed.push(violation);
    }

    if (applied.length > 0) {
        next.metadata = next.metadata ?? {};
        const history = Array.isArray(next.metadata.repairHistory) ? [...next.metadata.repairHistory] : [];
        history.push({
            at: new Date().toISOString(),
            reason: 'auto-repair',
            changes: applied.map((a) => `${a.code}: ${a.description}`),
        });
        next.metadata.repairHistory = history;
    }

    return { ir: next, applied, unfixed };
}
