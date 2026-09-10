/**
 * Deterministic, side-effect-free executors for diagram suggestion actions.
 *
 * Gap 3 — `services/diagram/suggestionActions.ts` declares the catalog of
 * actions the panel exposes; this module turns a chosen action into a
 * pure IR transformation so the UI dispatcher only has to call one
 * function and `updateArtifact` the result. Each executor:
 *
 *   - takes the current IR (+ optional params) as input
 *   - returns either `null` (no-op — preserve the existing IR) or a new
 *     IR with the change applied
 *   - never throws on bad input; returns `null` instead so the UI can
 *     surface a clear "no se detectaron cambios" toast
 *
 * The transformations are intentionally conservative: they record clear
 * provenance on `metadata.layoutPlan` / node tags so the next analysis
 * pass treats the change as a sticky user preference. They do NOT call
 * the AI / network — for actions that legitimately need a generation
 * roundtrip (regenerate-with-ir-direct, convert-to-bpmn, split-c4-levels,
 * repair-exportability) the dispatcher continues to route to the
 * existing auto-improve / regenerate handlers.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode } from '../../lib/diagram';

export interface LayoutDirectionParams {
    direction: 'TB' | 'LR';
}

export interface LayoutDensityParams {
    density: 'compact' | 'normal' | 'spacious';
}

/**
 * Persist a sticky direction choice (TB / LR) on `metadata.layoutPlan`.
 * The layout selector honours `userOverride === true` so subsequent ELK
 * passes don't silently revert the preference.
 */
export function executeSetLayoutDirection(ir: DiagramIR, params: LayoutDirectionParams): DiagramIR | null {
    if (params.direction !== 'TB' && params.direction !== 'LR') return null;
    const previous = ir.metadata?.layoutPlan;
    const next = {
        backend: previous?.backend ?? 'elk',
        algorithm: previous?.algorithm,
        direction: params.direction,
        density: previous?.density ?? 'normal',
        orthogonal: previous?.orthogonal ?? true,
        rationale: previous?.rationale ?? 'Dirección asignada manualmente por el usuario.',
        computedAt: new Date().toISOString(),
        userOverride: true,
    } as const;
    if (previous?.direction === next.direction && previous?.userOverride === true && previous?.density === next.density) return null;
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            layoutPlan: next,
        },
    };
}

/**
 * Persist a sticky density choice (compact / normal / spacious) on
 * `metadata.layoutPlan`. Honoured by `DENSITY_SCALE` in both ELK and
 * Dagre passes so the new spacing materialises on the next re-layout.
 */
export function executeSetLayoutDensity(ir: DiagramIR, params: LayoutDensityParams): DiagramIR | null {
    if (params.density !== 'compact' && params.density !== 'normal' && params.density !== 'spacious') return null;
    const previous = ir.metadata?.layoutPlan;
    const next = {
        backend: previous?.backend ?? 'elk',
        algorithm: previous?.algorithm,
        direction: previous?.direction ?? 'TB',
        density: params.density,
        orthogonal: previous?.orthogonal ?? true,
        rationale: previous?.rationale ?? 'Densidad asignada manualmente por el usuario.',
        computedAt: new Date().toISOString(),
        userOverride: true,
    } as const;
    if (previous?.density === next.density && previous?.userOverride === true && previous?.direction === next.direction) return null;
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            layoutPlan: next,
        },
    };
}

/**
 * Touch `metadata.layoutPlan.computedAt` and force backend = 'elk' so the
 * canvas re-runs the ELK pass on the next render. Preserves any
 * pre-existing user override.
 */
export function executeApplyElkLayout(ir: DiagramIR): DiagramIR | null {
    const previous = ir.metadata?.layoutPlan;
    const next = {
        backend: 'elk' as const,
        algorithm: previous?.algorithm ?? 'layered',
        direction: previous?.direction ?? 'TB',
        density: previous?.density ?? 'normal',
        orthogonal: true,
        rationale: previous?.rationale ?? 'Re-aplicado ELK layered por acción del usuario.',
        computedAt: new Date().toISOString(),
        userOverride: previous?.userOverride ?? false,
    } as const;
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            layoutPlan: next,
        },
    };
}

const GROUP_KIND_KEYWORDS: Array<{ kind: NonNullable<DiagramIRGroup['kind']>; patterns: RegExp[] }> = [
    {
        kind: 'security',
        patterns: [/(security|seguridad|trust|dmz|perimetr|firewall|waf|zero[\s_-]?trust)/i],
    },
    {
        kind: 'cloud',
        patterns: [/(cloud|nube|aws|azure|gcp|saas|paas|iaas|vpc|kubernetes|k8s)/i],
    },
    {
        kind: 'data',
        patterns: [/(data[\s_-]?zone|datos|warehouse|lake|lakehouse|dwh|odp|datamart|almac[eé]n|postgres|mongo|redis|cassandra)/i],
    },
    {
        kind: 'integration',
        patterns: [/(integraci|integration|esb|ipaas|api[\s-]?gateway|broker|hub|middleware|kafka|mq)/i],
    },
    {
        kind: 'external-provider',
        patterns: [/(externo|external|proveedor|vendor|third[\s-]?party|partner|prestador|pbm|payer)/i],
    },
    {
        kind: 'legacy',
        patterns: [/(legacy|mainframe|host|cics|cobol|as\/?400|monolito)/i],
    },
    {
        kind: 'swimlane',
        patterns: [/(swimlane|lane|carril|rol\b|actor|equipo|owner|department|departamento)/i],
    },
    {
        kind: 'enterprise',
        patterns: [/(enterprise|empresa|corporativ|holding)/i],
    },
    {
        kind: 'system-boundary',
        patterns: [/(system[\s-]?boundary|sistema|application|aplicaci[oó]n|plataforma|core)/i],
    },
];

function classifyGroupKind(group: DiagramIRGroup): NonNullable<DiagramIRGroup['kind']> | undefined {
    const hay = `${group.label} ${group.purpose ?? ''} ${group.boundaryType ?? ''}`;
    for (const rule of GROUP_KIND_KEYWORDS) {
        for (const pattern of rule.patterns) {
            if (pattern.test(hay)) return rule.kind;
        }
    }
    return undefined;
}

/**
 * Heuristically classify each unclassified group with one of the standard
 * kinds (swimlane / system-boundary / security-boundary / data-zone /
 * cloud-zone / legacy / integration-zone / external-provider). Returns
 * `null` when every group already has a kind.
 */
export function executeAssignGroupKind(ir: DiagramIR): DiagramIR | null {
    if (!Array.isArray(ir.groups) || ir.groups.length === 0) return null;
    const groups = ir.groups.slice();
    let changed = 0;
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (g.kind) continue;
        const kind = classifyGroupKind(g);
        if (!kind) continue;
        groups[i] = { ...g, kind };
        changed += 1;
    }
    if (changed === 0) return null;
    return { ...ir, groups };
}

const PHI_PATTERNS = [
    /(diagn[oó]stico|cl[ií]nic|paciente|patient|prescription|recet|farmacia|pharmacy|medicaci|drug|hl7|fhir|icd|cpt|ehr|emr|historia[\s_-]?cl[ií]nica|encounter|adverse|allergy)/i,
];
const PII_PATTERNS = [
    /(asegurado|insured|member|memberid|policy[\s_-]?holder|titular|beneficiario|beneficiary|persona|customer|cliente|address|direcci[oó]n|email|tel[eé]fono|phone|ssn|rut|dni|nss)/i,
];
const PCI_PATTERNS = [
    /(payment|pago|tarjeta|credit[\s_-]?card|debit|cvv|pan|track|emv|pci[\s_-]?dss)/i,
];

function classifyDataClassification(node: DiagramIRNode): DiagramIRNode['dataClassification'] | undefined {
    const hay = `${node.label} ${node.description ?? ''} ${node.businessMeaning ?? ''} ${node.technicalMeaning ?? ''} ${node.semanticType ?? ''}`;
    for (const re of PCI_PATTERNS) if (re.test(hay)) return 'pci';
    for (const re of PHI_PATTERNS) if (re.test(hay)) return 'phi';
    for (const re of PII_PATTERNS) if (re.test(hay)) return 'pii';
    return undefined;
}

/**
 * Tag healthcare / insurance nodes with `dataClassification` (PHI / PII /
 * PCI) based on label / description keywords. Conservative: only writes a
 * classification when the keyword match is unambiguous and the node has
 * none yet. Returns `null` when no node needed tagging.
 */
export function executeTagPhiPii(ir: DiagramIR): DiagramIR | null {
    if (!Array.isArray(ir.nodes) || ir.nodes.length === 0) return null;
    const nodes = ir.nodes.slice();
    let changed = 0;
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.dataClassification) continue;
        const classification = classifyDataClassification(n);
        if (!classification) continue;
        nodes[i] = { ...n, dataClassification: classification };
        changed += 1;
    }
    if (changed === 0) return null;
    return { ...ir, nodes };
}

/**
 * Heuristic protocol inference for an edge. Only assigns a protocol when
 * the existing label / semanticType / payload provides enough evidence —
 * never invents a protocol out of thin air, as the briefing requires.
 * Returns `undefined` when the evidence is insufficient.
 */
function inferEdgeProtocol(edge: DiagramIREdge): string | undefined {
    if (edge.protocol && edge.protocol.trim().length > 0) return undefined;
    const hay = `${edge.label ?? ''} ${edge.payload ?? ''} ${edge.semanticType ?? ''} ${edge.businessMeaning ?? ''} ${edge.technicalMeaning ?? ''}`;
    if (/\b(graphql|gql)\b/i.test(hay)) return 'GraphQL';
    if (/\b(soap|wsdl|xsd|ws-?security)\b/i.test(hay)) return 'SOAP';
    if (/\b(grpc|protobuf)\b/i.test(hay)) return 'gRPC';
    if (/\b(kafka|event[\s-]?bus|event[\s-]?stream|publish|subscribe|broker|topic|pub[\s-]?sub)\b/i.test(hay)) return 'Kafka';
    if (/\b(rabbit(mq)?|amqp|message[\s-]?queue|jms|mq[\s-]?series)\b/i.test(hay)) return 'AMQP';
    if (/\b(sftp|ftp|secure[\s-]?file[\s-]?transfer)\b/i.test(hay)) return 'SFTP';
    if (/\b(s3|gcs|blob[\s-]?storage|object[\s-]?storage)\b/i.test(hay)) return 'S3 API';
    if (/\b(jdbc|sql|postgres|mysql|oracle|sqlserver|tds)\b/i.test(hay)) return 'JDBC';
    if (/\b(mongo|nosql|cassandra|dynamodb)\b/i.test(hay)) return 'NoSQL';
    if (/\b(ws|websocket)\b/i.test(hay)) return 'WebSocket';
    if (/\b(webhook|callback|notify|notification)\b/i.test(hay)) return 'Webhook';
    if (/\b(rest|http|api|json|invoke|query|call)\b/i.test(hay)) return 'REST/HTTPS';
    return undefined;
}

/**
 * Add protocol metadata to critical edges that don't yet have one. Only
 * writes a protocol when the existing edge metadata gives us evidence —
 * we never invent one. The briefing explicitly warns against synthetic
 * protocols ("add-missing-protocols: agregar protocolos sugeridos sólo
 * cuando haya evidencia. No inventar protocolos sin contexto").
 */
export function executeAddMissingProtocols(ir: DiagramIR): DiagramIR | null {
    if (!Array.isArray(ir.edges) || ir.edges.length === 0) return null;
    const edges = ir.edges.slice();
    let changed = 0;
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const isCritical = edge.criticality === 'critical' || edge.criticality === 'high';
        if (!isCritical) continue;
        if (edge.protocol && edge.protocol.trim().length > 0) continue;
        const protocol = inferEdgeProtocol(edge);
        if (!protocol) continue;
        edges[i] = { ...edge, protocol };
        changed += 1;
    }
    if (changed === 0) return null;
    return { ...ir, edges };
}

/**
 * Heuristic security control inference for an edge. As with protocols
 * the briefing demands evidence-backed inferences only ("agregar
 * OAuth2/JWT/mTLS/API Key/TLS cuando el contexto lo justifique. Marcar
 * como sugerido o pendiente si no hay certeza").
 *
 * When the evidence is weak we return `'TLS (sugerido)'` rather than no
 * value, so the inspector surfaces the recommendation without claiming
 * the control is in place. The label suffix `(sugerido)` is the
 * agreed-upon convention with the inspector pill component.
 */
function inferEdgeSecurity(edge: DiagramIREdge, sourceNode?: DiagramIRNode, targetNode?: DiagramIRNode): string | undefined {
    if (edge.security && edge.security.trim().length > 0) return undefined;
    const hay = `${edge.label ?? ''} ${edge.protocol ?? ''} ${edge.payload ?? ''} ${edge.security ?? ''}`;
    if (/\b(oauth2?|oidc|openid|sso)\b/i.test(hay)) return 'OAuth2';
    if (/\b(jwt|bearer)\b/i.test(hay)) return 'JWT';
    if (/\b(mtls|mutual[\s-]?tls)\b/i.test(hay)) return 'mTLS';
    if (/\b(api[\s-]?key|apikey)\b/i.test(hay)) return 'API Key';
    if (/\b(saml)\b/i.test(hay)) return 'SAML';
    if (/\b(hmac|signature)\b/i.test(hay)) return 'HMAC';
    // External-bound or PHI/PII-bearing edges → recommend OAuth2 + mTLS
    // pero marcado como sugerido para que el inspector lo muestre como
    // pendiente.
    const sensitive = edge.dataSensitivity === 'phi' || edge.dataSensitivity === 'pii' || edge.dataSensitivity === 'pci';
    const crossesTrust = (sourceNode?.trust && targetNode?.trust && sourceNode.trust !== targetNode.trust) ||
        edge.trust === 'external' || edge.trust === 'partner' || edge.trust === 'public';
    if (sensitive && crossesTrust) return 'OAuth2 + mTLS (sugerido)';
    if (sensitive) return 'OAuth2 + JWT (sugerido)';
    if (crossesTrust) return 'TLS + API Key (sugerido)';
    return undefined;
}

/**
 * Document security controls on critical edges that lack them. Conservative
 * by design: when evidence is weak the inferred control is suffixed with
 * `(sugerido)` so the inspector renders it as a pending recommendation
 * rather than a guaranteed control.
 */
export function executeAddSecurityControls(ir: DiagramIR): DiagramIR | null {
    if (!Array.isArray(ir.edges) || ir.edges.length === 0) return null;
    const nodeById = new Map(ir.nodes.map((n) => [n.id, n] as const));
    const edges = ir.edges.slice();
    let changed = 0;
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const isCritical = edge.criticality === 'critical' || edge.criticality === 'high';
        if (!isCritical) continue;
        if (edge.security && edge.security.trim().length > 0) continue;
        const security = inferEdgeSecurity(edge, nodeById.get(edge.source), nodeById.get(edge.target));
        if (!security) continue;
        edges[i] = { ...edge, security };
        changed += 1;
    }
    if (changed === 0) return null;
    return { ...ir, edges };
}

/**
 * Split a mixed C4 diagram by promoting it to its strictest level. When
 * a `c4-context` diagram already contains containers/components we cannot
 * generate the other levels without AI — the action just rewrites the
 * `metadata.diagramType` to the dominant level so the validator switches
 * to the stricter rules. Returns `null` when the diagram is already at
 * its strictest level (no mixed-level evidence).
 *
 * The briefing accepts both behaviours: "Proponer o generar nuevas vistas
 * separadas". Generating new artefacts requires the AI route; this
 * deterministic path tightens the *current* artefact so its quality
 * report stops being graded with permissive context-level rules.
 */
export function executeSplitC4Levels(ir: DiagramIR): DiagramIR | null {
    const current = ir.metadata?.diagramType;
    if (!current || !current.startsWith('c4-')) return null;
    const labels = ir.nodes.map((n) => `${n.label} ${n.kind ?? ''} ${n.semanticType ?? ''}`).join(' ');
    const hasComponents = /(component|class|controller|dto|repository|module|library)/i.test(labels);
    const hasContainers = /(container|microservice|service|database|datastore|queue|cache|spa|api[\s-]?gateway)/i.test(labels);
    // Pick the strictest level supported by the IR's evidence.
    const target: 'c4-context' | 'c4-container' | 'c4-component' | null =
        hasComponents ? 'c4-component' :
        hasContainers ? 'c4-container' :
        null;
    if (!target || target === current) return null;
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            diagramType: target,
        },
    };
}

// ────────────────────────────────────────────────────────────────────────
//  BPMN visual maturity executors (Gap closure 1).
// ────────────────────────────────────────────────────────────────────────

function getSwimlaneAssignments(ir: DiagramIR): Map<string, string> {
    const out = new Map<string, string>();
    for (const group of ir.groups) {
        if (group.kind !== 'swimlane') continue;
        for (const id of group.nodeIds) out.set(id, group.id);
    }
    return out;
}

/**
 * Re-type the cross-lane edges of a BPMN process so they are visually
 * rendered as message flows. Only mutates `relation` / `semanticType` on
 * edges that cross a swimlane and do not already declare async semantics.
 */
export function executeMarkEdgesAsMessageFlow(ir: DiagramIR): { ir: DiagramIR | null; changed: number } {
    if (!Array.isArray(ir.edges) || ir.edges.length === 0) return { ir: null, changed: 0 };
    const laneByNode = getSwimlaneAssignments(ir);
    if (laneByNode.size === 0) return { ir: null, changed: 0 };
    const next = ir.edges.slice();
    let changed = 0;
    for (let i = 0; i < next.length; i++) {
        const edge = next[i];
        const sLane = laneByNode.get(edge.source);
        const tLane = laneByNode.get(edge.target);
        if (!sLane || !tLane || sLane === tLane) continue;
        const sem = (edge.semanticType ?? '').toLowerCase();
        if (sem === 'async-messaging' || sem === 'event' || sem === 'publish' || sem === 'subscribe') continue;
        next[i] = { ...edge, relation: 'async', semanticType: 'async-messaging' };
        changed += 1;
    }
    if (changed === 0) return { ir: null, changed: 0 };
    return { ir: { ...ir, edges: next }, changed };
}

/**
 * Re-type the within-lane edges that have async/message semantics so they
 * become sequence flows (BPMN 2.0 reserves sequence flow for in-lane
 * traffic). Only edges that explicitly declare async/message semantics
 * are downgraded — everything else is left alone.
 */
export function executeMarkEdgesAsSequenceFlow(ir: DiagramIR): { ir: DiagramIR | null; changed: number } {
    if (!Array.isArray(ir.edges) || ir.edges.length === 0) return { ir: null, changed: 0 };
    const laneByNode = getSwimlaneAssignments(ir);
    if (laneByNode.size === 0) return { ir: null, changed: 0 };
    const next = ir.edges.slice();
    let changed = 0;
    for (let i = 0; i < next.length; i++) {
        const edge = next[i];
        const sLane = laneByNode.get(edge.source);
        const tLane = laneByNode.get(edge.target);
        if (!sLane || !tLane || sLane !== tLane) continue;
        const sem = (edge.semanticType ?? '').toLowerCase();
        const rel = (edge.relation ?? '').toLowerCase();
        const looksAsync = sem === 'async-messaging' || sem === 'event' || sem === 'publish' || sem === 'subscribe' || rel === 'async';
        if (!looksAsync) continue;
        next[i] = { ...edge, relation: undefined, semanticType: 'business-flow' };
        changed += 1;
    }
    if (changed === 0) return { ir: null, changed: 0 };
    return { ir: { ...ir, edges: next }, changed };
}

const START_KEYWORDS_RE = /\b(inicio|start|trigger|comienzo)\b/i;
const END_KEYWORDS_RE = /\b(fin|end|complete|finaliza|cierre|t[eé]rmino)\b/i;
const GATEWAY_KIND_FAMILIES = /^(gateway|exclusive[-_ ]?gateway|parallel[-_ ]?gateway|inclusive[-_ ]?gateway|event[-_ ]?based[-_ ]?gateway|gw)$/i;

function hasStartEvent(ir: DiagramIR): boolean {
    return ir.nodes.some((n) => {
        const k = (n.kind ?? '').toLowerCase();
        if (k === 'start' || k === 'start_event' || k === 'start-event') return true;
        return START_KEYWORDS_RE.test(n.label ?? '');
    });
}
function hasEndEvent(ir: DiagramIR): boolean {
    return ir.nodes.some((n) => {
        const k = (n.kind ?? '').toLowerCase();
        if (k === 'end' || k === 'end_event' || k === 'end-event') return true;
        return END_KEYWORDS_RE.test(n.label ?? '');
    });
}

/**
 * Insert missing Start / End events into a BPMN process. Conservative:
 * we only add events that are missing, and we attach them to nodes that
 * currently have no incoming (for start) / outgoing (for end) edges so
 * the topology stays meaningful. Returns `null` when nothing was added.
 */
export function executeAddBpmnStartEndEvents(ir: DiagramIR): { ir: DiagramIR | null; added: number } {
    if (!Array.isArray(ir.nodes) || ir.nodes.length === 0) return { ir: null, added: 0 };
    const needStart = !hasStartEvent(ir);
    const needEnd = !hasEndEvent(ir);
    if (!needStart && !needEnd) return { ir: null, added: 0 };

    const nodes = ir.nodes.slice();
    const edges = ir.edges.slice();
    let added = 0;

    if (needStart) {
        // Prefer a real, non-gateway, non-event task with no incoming edges.
        const incomingByNode = new Map<string, number>();
        for (const edge of edges) incomingByNode.set(edge.target, (incomingByNode.get(edge.target) ?? 0) + 1);
        const candidateTask = nodes.find((n) => {
            const k = (n.kind ?? '').toLowerCase();
            if (GATEWAY_KIND_FAMILIES.test(k)) return false;
            if (k.includes('event')) return false;
            return (incomingByNode.get(n.id) ?? 0) === 0;
        }) ?? nodes[0];
        const startId = `bpmn-start-${Date.now().toString(36)}`;
        nodes.unshift({ id: startId, label: 'Inicio', kind: 'start_event' });
        if (candidateTask) {
            edges.push({ id: `${startId}->${candidateTask.id}`, source: startId, target: candidateTask.id, label: '', semanticType: 'business-flow' });
        }
        added += 1;
    }

    if (needEnd) {
        const outgoingByNode = new Map<string, number>();
        for (const edge of edges) outgoingByNode.set(edge.source, (outgoingByNode.get(edge.source) ?? 0) + 1);
        const candidateTask = nodes.find((n) => {
            const k = (n.kind ?? '').toLowerCase();
            if (GATEWAY_KIND_FAMILIES.test(k)) return false;
            if (k.includes('event')) return false;
            return (outgoingByNode.get(n.id) ?? 0) === 0;
        }) ?? nodes[nodes.length - 1];
        const endId = `bpmn-end-${Date.now().toString(36)}`;
        nodes.push({ id: endId, label: 'Fin', kind: 'end_event' });
        if (candidateTask) {
            edges.push({ id: `${candidateTask.id}->${endId}`, source: candidateTask.id, target: endId, label: '', semanticType: 'business-flow' });
        }
        added += 1;
    }

    return {
        ir: {
            ...ir,
            nodes,
            edges,
            metadata: {
                ...(ir.metadata ?? {}),
                diagramType: ir.metadata?.diagramType ?? 'bpmn-process',
            },
        },
        added,
    };
}

/**
 * Materialise swimlane groups from the `owner` / `domain` metadata on the
 * task nodes. Conservative: only adds lanes when ≥ 2 distinct owners are
 * present and the IR does not already declare ≥ 2 swimlane groups.
 */
export function executeCreateSwimlanesFromOwners(ir: DiagramIR): { ir: DiagramIR | null; lanes: number } {
    if (!Array.isArray(ir.nodes) || ir.nodes.length === 0) return { ir: null, lanes: 0 };
    const existingSwimlanes = ir.groups.filter((g) => g.kind === 'swimlane');
    if (existingSwimlanes.length >= 2) return { ir: null, lanes: 0 };

    const ownerLookup = new Map<string, string[]>();
    for (const node of ir.nodes) {
        const owner = (node.owner ?? node.domain ?? '').trim();
        if (!owner) continue;
        const prev = ownerLookup.get(owner) ?? [];
        prev.push(node.id);
        ownerLookup.set(owner, prev);
    }
    if (ownerLookup.size < 2) return { ir: null, lanes: 0 };

    const newGroups: DiagramIRGroup[] = [];
    let idx = 0;
    for (const [owner, nodeIds] of ownerLookup.entries()) {
        idx += 1;
        newGroups.push({
            id: `swimlane-${owner.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${idx}`,
            label: owner,
            nodeIds,
            kind: 'swimlane',
            owner,
            boundaryType: 'organizational',
        });
    }
    if (newGroups.length < 2) return { ir: null, lanes: 0 };

    // Keep non-swimlane groups untouched.
    const otherGroups = ir.groups.filter((g) => g.kind !== 'swimlane');
    return {
        ir: {
            ...ir,
            groups: [...otherGroups, ...newGroups],
            metadata: {
                ...(ir.metadata ?? {}),
                diagramType: ir.metadata?.diagramType ?? 'bpmn-process',
            },
        },
        lanes: newGroups.length,
    };
}

/**
 * Reset the BPMN layout plan so the next render picks ELK layered LR
 * with comfortable spacing — the recommended BPMN reading direction.
 */
export function executeRepairBpmnLayout(ir: DiagramIR): DiagramIR | null {
    const previous = ir.metadata?.layoutPlan;
    const next = {
        backend: 'elk' as const,
        algorithm: 'layered' as const,
        direction: 'LR' as const,
        density: 'normal' as const,
        orthogonal: true,
        rationale: 'Layout BPMN reparado: LR + ELK layered con espaciado normal para legibilidad.',
        computedAt: new Date().toISOString(),
        userOverride: true,
    };
    if (
        previous?.backend === next.backend
        && previous?.algorithm === next.algorithm
        && previous?.direction === next.direction
        && previous?.density === next.density
        && previous?.orthogonal === next.orthogonal
        && previous?.userOverride === true
    ) {
        return null;
    }
    return {
        ...ir,
        metadata: {
            ...(ir.metadata ?? {}),
            diagramType: ir.metadata?.diagramType ?? 'bpmn-process',
            layoutPlan: next,
        },
    };
}

export interface ExecuteResult {
    /** New IR when the action mutated something, null when there was nothing to do. */
    ir: DiagramIR | null;
    /** Human-readable summary suitable for a toast. */
    summary: string;
}

/**
 * Convenience dispatcher used by the UI handler. Returns
 * `{ ir: null, summary }` when the action exists but produced no changes
 * so the UI can show a "no changes detected" toast.
 */
export function executeDiagramSuggestionAction(
    ir: DiagramIR,
    kind: string,
    params: Record<string, string> = {},
): ExecuteResult {
    switch (kind) {
        case 'apply-elk-layout': {
            const next = executeApplyElkLayout(ir);
            return {
                ir: next,
                summary: 'Plan de layout actualizado a ELK layered (se re-ejecutará en el próximo render).',
            };
        }
        case 'set-layout-direction': {
            const direction = (params.direction ?? 'TB').toUpperCase() as 'TB' | 'LR';
            const next = executeSetLayoutDirection(ir, { direction });
            return {
                ir: next,
                summary: next
                    ? `Dirección de layout fijada en ${direction} (preferencia persistente).`
                    : `Dirección ya estaba fijada en ${direction}; no se aplicaron cambios.`,
            };
        }
        case 'set-layout-density': {
            const density = (params.density ?? 'normal') as 'compact' | 'normal' | 'spacious';
            const next = executeSetLayoutDensity(ir, { density });
            return {
                ir: next,
                summary: next
                    ? `Densidad fijada en ${density} (preferencia persistente).`
                    : `Densidad ya estaba en ${density}; no se aplicaron cambios.`,
            };
        }
        case 'assign-group-kind': {
            const next = executeAssignGroupKind(ir);
            const before = ir.groups.filter((g) => !g.kind).length;
            const after = next ? next.groups.filter((g) => !g.kind).length : before;
            const tagged = before - after;
            return {
                ir: next,
                summary: tagged > 0
                    ? `Se clasificaron ${tagged} grupo(s) automáticamente.`
                    : 'No fue posible inferir un tipo para los grupos sin clasificar; ajusta sus etiquetas o descripciones.',
            };
        }
        case 'tag-phi-pii': {
            const next = executeTagPhiPii(ir);
            const before = ir.nodes.filter((n) => !n.dataClassification).length;
            const after = next ? next.nodes.filter((n) => !n.dataClassification).length : before;
            const tagged = before - after;
            return {
                ir: next,
                summary: tagged > 0
                    ? `Se etiquetaron ${tagged} nodo(s) con clasificación PHI/PII/PCI.`
                    : 'No se detectaron nodos con señales claras de PHI/PII/PCI; revisa manualmente desde el inspector.',
            };
        }
        case 'add-missing-protocols': {
            const next = executeAddMissingProtocols(ir);
            const before = ir.edges.filter((e) => (e.criticality === 'critical' || e.criticality === 'high') && !e.protocol).length;
            const after = next ? next.edges.filter((e) => (e.criticality === 'critical' || e.criticality === 'high') && !e.protocol).length : before;
            const tagged = before - after;
            return {
                ir: next,
                summary: tagged > 0
                    ? `Se agregó protocolo a ${tagged} relación(es) crítica(s) con evidencia clara.`
                    : 'Las relaciones críticas sin protocolo no muestran evidencia suficiente; complétalas desde el inspector.',
            };
        }
        case 'add-security-controls': {
            const next = executeAddSecurityControls(ir);
            const before = ir.edges.filter((e) => (e.criticality === 'critical' || e.criticality === 'high') && !e.security).length;
            const after = next ? next.edges.filter((e) => (e.criticality === 'critical' || e.criticality === 'high') && !e.security).length : before;
            const tagged = before - after;
            return {
                ir: next,
                summary: tagged > 0
                    ? `Se documentó seguridad (algunos controles quedan como "sugerido") en ${tagged} flujo(s) crítico(s).`
                    : 'No se detectaron evidencias para asignar controles de seguridad; complétalos manualmente.',
            };
        }
        case 'split-c4-levels': {
            const next = executeSplitC4Levels(ir);
            if (!next) {
                return {
                    ir: null,
                    summary: 'El diagrama ya está al nivel C4 más estricto compatible con su contenido; no se aplicaron cambios.',
                };
            }
            return {
                ir: next,
                summary: `Diagrama re-clasificado como ${next.metadata?.diagramType}; las reglas C4 ahora son más estrictas.`,
            };
        }
        case 'mark-edges-as-message-flow': {
            const result = executeMarkEdgesAsMessageFlow(ir);
            return {
                ir: result.ir,
                summary: result.changed > 0
                    ? `Se marcaron ${result.changed} edge(s) entre swimlanes como message flow (BPMN 2.0).`
                    : 'No se detectaron edges cross-lane elegibles para convertir a message flow.',
            };
        }
        case 'mark-edges-as-sequence-flow': {
            const result = executeMarkEdgesAsSequenceFlow(ir);
            return {
                ir: result.ir,
                summary: result.changed > 0
                    ? `Se restauraron ${result.changed} edge(s) dentro de swimlanes como sequence flow.`
                    : 'No se detectaron edges within-lane con message flow para corregir.',
            };
        }
        case 'add-bpmn-start-end-events': {
            const result = executeAddBpmnStartEndEvents(ir);
            return {
                ir: result.ir,
                summary: result.added > 0
                    ? `Se agregaron ${result.added} evento(s) BPMN faltantes (Inicio/Fin) al proceso.`
                    : 'El proceso ya tiene eventos de Inicio y Fin; no se aplicaron cambios.',
            };
        }
        case 'create-swimlanes-from-owners': {
            const result = executeCreateSwimlanesFromOwners(ir);
            return {
                ir: result.ir,
                summary: result.lanes > 0
                    ? `Se crearon ${result.lanes} swimlane(s) a partir de los owners declarados en las tareas.`
                    : 'No hay suficientes owners distintos (o el diagrama ya tiene swimlanes) para crear carriles automáticamente.',
            };
        }
        case 'repair-bpmn-layout': {
            const next = executeRepairBpmnLayout(ir);
            return {
                ir: next,
                summary: next
                    ? 'Layout BPMN reparado: dirección LR + ELK layered con densidad normal.'
                    : 'El layout BPMN ya estaba alineado con la recomendación; no se aplicaron cambios.',
            };
        }
        default:
            return { ir: null, summary: `Acción "${kind}" no implementada de forma determinística; usando auto-mejora.` };
    }
}
