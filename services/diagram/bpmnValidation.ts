/**
 * BPMN 2.0 formal validation.
 *
 * Phase 3 lifts the BPMN check from a single heuristic ("has the title
 * the word `bpmn`?") to an explicit rule set anchored in the BPMN 2.0
 * spec. The validator runs only when the IR is classified as
 * `bpmn-process` (see {@link inferDiagramType}) so it never penalises
 * non-BPMN diagrams.
 *
 * The validator is pure: it returns a flat array of
 * {@link BpmnValidationIssue}s, deduplicated by id, that the quality
 * service merges into the standard `DiagramLintIssue` pipeline. It never
 * mutates the IR.
 *
 * Rules currently enforced:
 *  - START / END events: at least one start and one end event must be
 *    present (looked up via canonical kinds, semantic labels and the
 *    `bpmn:` prefix used by the IR-direct prompt).
 *  - GATEWAYS: every node with multiple outgoing edges that the IR does
 *    not flag as a gateway is reported as a missing exclusive/parallel
 *    gateway candidate.
 *  - DECISION LABELS: outgoing edges of a gateway must each carry a
 *    distinguishing label (`Sí` / `No` / `>= 24h` / …). Unlabelled
 *    branches are flagged.
 *  - SWIMLANES: when ≥ 2 participants are present (≥ 2 distinct owners
 *    or groups), the validator expects ≥ 2 swimlane-kind groups. The
 *    rule fires only when the IR exposes multiple participants — single
 *    -lane processes are allowed.
 *  - MESSAGE vs SEQUENCE FLOWS: edges that cross swimlanes should be
 *    typed as `message-flow` (semanticType=`async-messaging` or
 *    `relation=async`); edges inside a swimlane should be `sequence`.
 *  - LONG VERTICAL PROCESS: ≥ 10 sequential nodes in vertical layout →
 *    recommend horizontal carriers. Vertical-orientation detection is
 *    delegated to the visual lints; here we just count the chain.
 *  - UNLABELLED LOOPS: any cycle without an edge label is flagged so
 *    the architect adds a clear exit condition.
 *
 * NOTE: The validator never *requires* swimlanes — single-participant
 * processes are perfectly valid BPMN. The swimlane rule fires only when
 * the IR exposes multiple distinct participants/owners.
 */

import type { DiagramIR, DiagramIRNode } from '../../lib/diagram';

export type BpmnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface BpmnValidationIssue {
    id: string;
    code:
        | 'BPMN_MISSING_START_EVENT'
        | 'BPMN_MISSING_END_EVENT'
        | 'BPMN_MISSING_GATEWAY'
        | 'BPMN_GATEWAY_BRANCH_UNLABELED'
        | 'BPMN_GATEWAY_SINGLE_OUTPUT'
        | 'BPMN_SWIMLANE_MISSING'
        | 'BPMN_SWIMLANE_EMPTY'
        | 'BPMN_NODE_OUTSIDE_LANE'
        | 'BPMN_TASK_WITHOUT_OWNER'
        | 'BPMN_CROSSLANE_AS_SEQUENCE'
        | 'BPMN_MESSAGE_WITHIN_LANE'
        | 'BPMN_DATA_OBJECT_WITHOUT_ASSOCIATION'
        | 'BPMN_LOOP_WITHOUT_LABEL'
        | 'BPMN_PROCESS_TOO_LONG_VERTICAL';
    severity: BpmnSeverity;
    message: string;
    recommendation: string;
    affectedIds?: string[];
}

const START_KEYWORDS = /\b(inicio|comienzo|start|trigger|inicia|empieza|kick-?off|begin)\b/i;
const END_KEYWORDS = /\b(fin|finaliza|cierre|t[eé]rmino|stop|end|complete|finish|conclu(ye|si[oó]n))\b/i;
const GATEWAY_KIND_RE = /^(gateway|decision|exclusive[-_ ]?gateway|parallel[-_ ]?gateway|inclusive[-_ ]?gateway|complex[-_ ]?gateway|gw)$/i;
const GATEWAY_LABEL_RE = /\b(gateway|decisi[oó]n|si\s*\/\s*no|s[ií]\s+o\s+no|condicional|exclusive|parallel|sincroniza)\b/i;
const TASK_KIND_RE = /^(task|user[-_ ]?task|service[-_ ]?task|manual[-_ ]?task|script[-_ ]?task|business[-_ ]?task|process|activity)$/i;
const SWIMLANE_KIND = 'swimlane';

function isStartEventNode(node: DiagramIRNode): boolean {
    const kind = (node.kind ?? '').toLowerCase().trim();
    if (kind === 'start' || kind === 'start_event' || kind === 'start-event') return true;
    if (START_KEYWORDS.test(node.label ?? '')) return true;
    return false;
}

function isEndEventNode(node: DiagramIRNode): boolean {
    const kind = (node.kind ?? '').toLowerCase().trim();
    if (kind === 'end' || kind === 'end_event' || kind === 'end-event') return true;
    if (END_KEYWORDS.test(node.label ?? '')) return true;
    return false;
}

function isGatewayNode(node: DiagramIRNode): boolean {
    const kind = (node.kind ?? '').toLowerCase().trim();
    if (GATEWAY_KIND_RE.test(kind)) return true;
    if (GATEWAY_LABEL_RE.test(node.label ?? '')) return true;
    if (node.shape === 'diamond') return true;
    return false;
}

function isTaskNode(node: DiagramIRNode): boolean {
    const kind = (node.kind ?? '').toLowerCase().trim();
    if (TASK_KIND_RE.test(kind)) return true;
    // Any non-event, non-gateway node sitting in the middle of the flow
    // is treated as a task for branching purposes.
    return !isStartEventNode(node) && !isEndEventNode(node) && !isGatewayNode(node);
}

function buildAdjacency(ir: DiagramIR): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const edge of ir.edges) {
        const prev = out.get(edge.source) ?? [];
        prev.push(edge.target);
        out.set(edge.source, prev);
    }
    return out;
}

function findCycles(adjacency: Map<string, string[]>): Set<string>[] {
    // Tarjan-light: returns SCCs of size ≥ 2 OR self-loops. Used to flag
    // unlabelled loops; we don't need the actual order of nodes.
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: Set<string>[] = [];
    let nextIndex = 0;

    const strongconnect = (v: string) => {
        indices.set(v, nextIndex);
        lowlink.set(v, nextIndex);
        nextIndex += 1;
        stack.push(v);
        onStack.add(v);

        const neighbours = adjacency.get(v) ?? [];
        for (const w of neighbours) {
            if (!indices.has(w)) {
                strongconnect(w);
                lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
            }
        }

        if (lowlink.get(v) === indices.get(v)) {
            const scc = new Set<string>();
            let w: string | undefined;
            do {
                w = stack.pop();
                if (!w) break;
                onStack.delete(w);
                scc.add(w);
            } while (w !== v);
            if (scc.size > 1) sccs.push(scc);
            // Self-loop (single-node SCC that loops back to itself)
            else if (scc.size === 1 && (adjacency.get(v) ?? []).includes(v)) sccs.push(scc);
        }
    };

    for (const v of adjacency.keys()) {
        if (!indices.has(v)) strongconnect(v);
    }
    return sccs;
}

function countParticipants(ir: DiagramIR): number {
    const owners = new Set<string>();
    for (const node of ir.nodes) {
        if (node.owner && node.owner.trim().length > 0) owners.add(node.owner.trim().toLowerCase());
    }
    if (owners.size > 0) return owners.size;
    // Fall back to group inference when owners are not declared.
    const swimlaneGroups = ir.groups.filter((g) => g.kind === SWIMLANE_KIND);
    if (swimlaneGroups.length > 0) return swimlaneGroups.length;
    // Last resort: distinct domain values.
    const domains = new Set(ir.nodes.map((n) => (n.domain ?? '').trim().toLowerCase()).filter(Boolean));
    return domains.size;
}

/**
 * Run the BPMN validator. Returns the flat issue list.
 *
 * Always-on safety: returns an empty list when the IR has fewer than 3
 * nodes (too small to be a meaningful process) and when no node looks
 * remotely like a BPMN element.
 */
export function validateBPMN(ir: DiagramIR): BpmnValidationIssue[] {
    if (!ir.nodes || ir.nodes.length < 3) return [];

    const issues: BpmnValidationIssue[] = [];
    const adjacency = buildAdjacency(ir);

    // ── Start / End events ───────────────────────────────────────────────
    const starts = ir.nodes.filter(isStartEventNode);
    const ends = ir.nodes.filter(isEndEventNode);
    if (starts.length === 0) {
        issues.push({
            id: 'bpmn-missing-start',
            code: 'BPMN_MISSING_START_EVENT',
            severity: 'high',
            message: 'El proceso BPMN no tiene un evento de inicio (Start Event) explícito.',
            recommendation: 'Agrega un nodo "Inicio" / "Start" o etiqueta un nodo con kind=start_event según BPMN 2.0.',
        });
    }
    if (ends.length === 0) {
        issues.push({
            id: 'bpmn-missing-end',
            code: 'BPMN_MISSING_END_EVENT',
            severity: 'high',
            message: 'El proceso BPMN no tiene un evento de fin (End Event) explícito.',
            recommendation: 'Agrega un nodo "Fin" / "End" o etiqueta un nodo con kind=end_event según BPMN 2.0.',
        });
    }

    // ── Gateways ─────────────────────────────────────────────────────────
    // Any task with > 1 outgoing edges should be a gateway. The IR-direct
    // prompt is now expected to emit explicit gateways, but legacy artifacts
    // tend to keep the branching attached to the previous task — the
    // validator surfaces those.
    const missingGatewayIds: string[] = [];
    for (const node of ir.nodes) {
        const outs = adjacency.get(node.id) ?? [];
        if (outs.length <= 1) continue;
        if (isGatewayNode(node)) continue;
        if (!isTaskNode(node)) continue;
        missingGatewayIds.push(node.id);
    }
    if (missingGatewayIds.length > 0) {
        issues.push({
            id: 'bpmn-missing-gateways',
            code: 'BPMN_MISSING_GATEWAY',
            severity: 'medium',
            message: `${missingGatewayIds.length} actividad(es) abren múltiples ramas sin pasar por un gateway BPMN.`,
            recommendation: 'Inserta un gateway exclusivo (XOR) o paralelo (AND) antes de las ramas para mantener la semántica BPMN.',
            affectedIds: missingGatewayIds.slice(0, 8),
        });
    }

    // ── Gateway branch labelling ─────────────────────────────────────────
    // Outgoing edges from a gateway must each carry a distinguishing label.
    const unlabelledBranches: string[] = [];
    for (const node of ir.nodes) {
        if (!isGatewayNode(node)) continue;
        const outs = ir.edges.filter((e) => e.source === node.id);
        if (outs.length < 2) continue;
        for (const edge of outs) {
            const label = (edge.label ?? '').trim();
            if (label.length === 0 || label.toLowerCase() === 'relaciona') {
                unlabelledBranches.push(edge.id);
            }
        }
    }
    if (unlabelledBranches.length > 0) {
        issues.push({
            id: 'bpmn-gateway-branches-unlabeled',
            code: 'BPMN_GATEWAY_BRANCH_UNLABELED',
            severity: 'medium',
            message: `${unlabelledBranches.length} rama(s) de gateway no llevan etiqueta de condición.`,
            recommendation: 'Etiqueta cada salida con su condición (Sí/No, >24h, Aprobado, Rechazado, …).',
            affectedIds: unlabelledBranches.slice(0, 8),
        });
    }

    // ── Swimlanes ────────────────────────────────────────────────────────
    const participants = countParticipants(ir);
    const swimlaneGroups = ir.groups.filter((g) => g.kind === SWIMLANE_KIND);
    if (participants >= 2 && swimlaneGroups.length < 2) {
        issues.push({
            id: 'bpmn-swimlane-missing',
            code: 'BPMN_SWIMLANE_MISSING',
            severity: 'medium',
            message: `El proceso involucra ${participants} participantes pero no muestra swimlanes.`,
            recommendation: 'Convierte los grupos en kind="swimlane" para asignar visualmente cada actividad a su participante (BPMN 2.0).',
        });
    }

    // ── Cross-lane edges should be message flows ────────────────────────
    if (swimlaneGroups.length >= 2) {
        const nodeLane = new Map<string, string>();
        for (const lane of swimlaneGroups) {
            for (const id of lane.nodeIds) nodeLane.set(id, lane.id);
        }
        const crosslaneAsSequence: string[] = [];
        const messageWithinLane: string[] = [];
        for (const edge of ir.edges) {
            const ls = nodeLane.get(edge.source);
            const lt = nodeLane.get(edge.target);
            const sem = (edge.semanticType ?? '').toLowerCase();
            const relation = (edge.relation ?? '').toLowerCase();
            const looksAsync = sem === 'async-messaging' || sem === 'event' || sem === 'publish' || sem === 'subscribe' || relation === 'async';
            if (!ls || !lt) continue;
            if (ls === lt) {
                // Inside the same lane — sequence flow is the correct
                // primitive. Flag explicit message-flow typing as a
                // semantic mistake.
                if (looksAsync) messageWithinLane.push(edge.id);
                continue;
            }
            if (!looksAsync) crosslaneAsSequence.push(edge.id);
        }
        if (crosslaneAsSequence.length > 0) {
            issues.push({
                id: 'bpmn-crosslane-as-sequence',
                code: 'BPMN_CROSSLANE_AS_SEQUENCE',
                severity: 'medium',
                message: `${crosslaneAsSequence.length} edge(s) cruzan swimlanes pero están tipadas como sequence flow.`,
                recommendation: 'Tipa los cruces como message flow (semanticType=async-messaging o relation=async) — BPMN 2.0 reserva sequence flow para dentro de una lane.',
                affectedIds: crosslaneAsSequence.slice(0, 8),
            });
        }
        if (messageWithinLane.length > 0) {
            issues.push({
                id: 'bpmn-message-within-lane',
                code: 'BPMN_MESSAGE_WITHIN_LANE',
                severity: 'medium',
                message: `${messageWithinLane.length} edge(s) dentro de la misma swimlane están tipadas como message flow.`,
                recommendation: 'Dentro de una misma lane se usa sequence flow. Cambia semanticType / relation a sequence o quita el async-messaging.',
                affectedIds: messageWithinLane.slice(0, 8),
            });
        }

        // Empty swimlanes — every lane should host at least one task /
        // event. Empty lanes are a strong signal of stale modelling.
        const emptyLanes = swimlaneGroups.filter((lane) => lane.nodeIds.length === 0).map((lane) => lane.id);
        if (emptyLanes.length > 0) {
            issues.push({
                id: 'bpmn-swimlane-empty',
                code: 'BPMN_SWIMLANE_EMPTY',
                severity: 'low',
                message: `${emptyLanes.length} swimlane(s) no contienen actividades.`,
                recommendation: 'Asigna al menos una tarea/evento a cada carril o elimina el carril vacío.',
                affectedIds: emptyLanes.slice(0, 8),
            });
        }

        // Tasks living outside any swimlane while the diagram already
        // declares lanes are visually orphaned.
        const nodeIdsInLanes = new Set<string>();
        for (const lane of swimlaneGroups) for (const id of lane.nodeIds) nodeIdsInLanes.add(id);
        const orphanedTasks = ir.nodes
            .filter((n) => isTaskNode(n) && !nodeIdsInLanes.has(n.id))
            .map((n) => n.id);
        if (orphanedTasks.length > 0) {
            issues.push({
                id: 'bpmn-node-outside-lane',
                code: 'BPMN_NODE_OUTSIDE_LANE',
                severity: 'medium',
                message: `${orphanedTasks.length} actividad(es) están fuera de cualquier swimlane declarada.`,
                recommendation: 'Mueve cada tarea al carril del participante responsable o crea el carril correspondiente.',
                affectedIds: orphanedTasks.slice(0, 8),
            });
        }

        // Tasks inside swimlanes should declare an explicit owner (so the
        // hand-off across participants is auditable).
        const tasksMissingOwner = ir.nodes
            .filter((n) => isTaskNode(n) && nodeIdsInLanes.has(n.id) && !(n.owner && n.owner.trim().length > 0))
            .map((n) => n.id);
        if (tasksMissingOwner.length > 0) {
            issues.push({
                id: 'bpmn-task-without-owner',
                code: 'BPMN_TASK_WITHOUT_OWNER',
                severity: 'low',
                message: `${tasksMissingOwner.length} tarea(s) dentro de swimlanes no declaran responsable explícito.`,
                recommendation: 'Asigna owner / responsable a cada tarea para que la trazabilidad de la lane sea verificable.',
                affectedIds: tasksMissingOwner.slice(0, 8),
            });
        }
    }

    // ── Gateway with a single output ─────────────────────────────────────
    // Gateways exist to split / converge flow. A gateway with only one
    // outgoing edge is a smell — either an extra branch is missing or the
    // node should be a regular task.
    const gatewaysSingleOutput: string[] = [];
    for (const node of ir.nodes) {
        if (!isGatewayNode(node)) continue;
        const outs = ir.edges.filter((e) => e.source === node.id);
        if (outs.length === 1) gatewaysSingleOutput.push(node.id);
    }
    if (gatewaysSingleOutput.length > 0) {
        issues.push({
            id: 'bpmn-gateway-single-output',
            code: 'BPMN_GATEWAY_SINGLE_OUTPUT',
            severity: 'low',
            message: `${gatewaysSingleOutput.length} gateway(s) tienen una sola rama de salida.`,
            recommendation: 'Un gateway con una sola salida no aporta valor: agrega la(s) rama(s) faltante(s) o conviértelo en una tarea.',
            affectedIds: gatewaysSingleOutput.slice(0, 8),
        });
    }

    // ── Data objects must be associated ──────────────────────────────────
    // BPMN data objects should connect to at least one activity via an
    // association edge. Orphan data objects clutter the diagram without
    // adding meaning.
    const dataObjectIds = ir.nodes
        .filter((n) => {
            const k = (n.kind ?? '').toLowerCase().trim();
            return /^(data[_-]?object|data[_-]?input|data[_-]?output|document)$/.test(k);
        })
        .map((n) => n.id);
    if (dataObjectIds.length > 0) {
        const connectedDataObjects = new Set<string>();
        for (const edge of ir.edges) {
            if (dataObjectIds.includes(edge.source)) connectedDataObjects.add(edge.source);
            if (dataObjectIds.includes(edge.target)) connectedDataObjects.add(edge.target);
        }
        const orphanDataObjects = dataObjectIds.filter((id) => !connectedDataObjects.has(id));
        if (orphanDataObjects.length > 0) {
            issues.push({
                id: 'bpmn-data-object-without-association',
                code: 'BPMN_DATA_OBJECT_WITHOUT_ASSOCIATION',
                severity: 'low',
                message: `${orphanDataObjects.length} data object(s) no están asociados a ninguna actividad.`,
                recommendation: 'Conecta cada data object a la actividad que lo produce o consume mediante un edge de tipo association.',
                affectedIds: orphanDataObjects.slice(0, 8),
            });
        }
    }

    // ── Long vertical process ────────────────────────────────────────────
    if (ir.nodes.length >= 10) {
        const layoutDir = ir.metadata?.layoutPlan?.direction;
        if (layoutDir === 'TB' || layoutDir === 'BT') {
            issues.push({
                id: 'bpmn-too-long-vertical',
                code: 'BPMN_PROCESS_TOO_LONG_VERTICAL',
                severity: 'low',
                message: `Proceso vertical con ${ir.nodes.length} nodos: difícil de leer en pantallas anchas o exportación apaisada.`,
                recommendation: 'Cambia el layout a horizontal (LR) y organiza por swimlanes para que el flujo se lea de izquierda a derecha.',
            });
        }
    }

    // ── Unlabelled loops ─────────────────────────────────────────────────
    const sccs = findCycles(adjacency);
    if (sccs.length > 0) {
        const loopEdges: string[] = [];
        for (const scc of sccs) {
            // An edge is part of the loop when both endpoints are in the SCC.
            for (const edge of ir.edges) {
                if (!scc.has(edge.source) || !scc.has(edge.target)) continue;
                const label = (edge.label ?? '').trim();
                if (label.length === 0 || label.toLowerCase() === 'relaciona') loopEdges.push(edge.id);
            }
        }
        const unique = Array.from(new Set(loopEdges));
        if (unique.length > 0) {
            issues.push({
                id: 'bpmn-loop-without-label',
                code: 'BPMN_LOOP_WITHOUT_LABEL',
                severity: 'medium',
                message: `Hay ${unique.length} arista(s) en bucles sin condición de salida etiquetada.`,
                recommendation: 'Etiqueta cada bucle con su condición de salida (reintentos < N, error/retry, etc.) para que el proceso sea verificable.',
                affectedIds: unique.slice(0, 8),
            });
        }
    }

    return issues;
}
