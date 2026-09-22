/**
 * Quality-driven structural repair for DiagramIR.
 *
 * Whereas `autoRepair.ts` consumes architectural violations from the guardrails
 * module, this module consumes the lint findings from `analyzeDiagramQuality`
 * and applies *structural* fixes that raise the deterministic 10-dimension
 * score without depending on the LLM:
 *
 *  - Empty / generic edge labels  → verb + protocol derived from source/target kinds.
 *  - Orphan nodes                 → connected to the most-referenced sibling.
 *  - Missing node descriptions    → 1-line synthesised description.
 *  - Labels equal to id           → humanised label (kebab → Title Case).
 *  - Labels too long              → truncated with ellipsis (≤ 32 chars).
 *  - Edge labels too long         → truncated to 4-word verb phrase.
 *  - Missing groups (≥ 5 nodes)   → group by semantic role.
 *  - Missing metadata             → title, audience, theme, density, narrative,
 *                                   generatedAt synthesized from artifact ctx.
 *  - Invalid IDs                  → rewritten to `kebab-case` stable form.
 *  - Inferred kind = 'Component'  → re-classified using the canonical taxonomy.
 *
 * Every repair is **non-destructive**: existing data is preserved unless it
 * was clearly invalid.  All mutations are tracked in `metadata.repairHistory`
 * so the UI can show the architect what changed.
 *
 * This module is the deterministic spine of the quality gate (see
 * `qualityGate.ts`).  It runs before any AI critique pass and resolves the
 * most common reasons a diagram fails to clear the 90/100 threshold.
 */

import type { Artifact } from '../../lib/artifacts';
import { type DiagramAudience, type DiagramDensity, type DiagramIR, type DiagramIREdge, type DiagramIRGroup, type DiagramIRNode, type DiagramNarrative, type DiagramTheme, narrativeHasText } from '../../lib/diagram';
import { detectSemanticRole, type SemanticRole } from '../../lib/diagramTokens';

export interface QualityRepairChange {
    code: string;
    description: string;
    targetIds?: string[];
}

export interface QualityRepairResult {
    ir: DiagramIR;
    applied: QualityRepairChange[];
}

export interface QualityRepairOptions {
    /**
     * Source artifact context. Only `type` is required because some call sites
     * (e.g. the resolver, which doesn't always have full artifact metadata in
     * scope) just want repair. Missing fields fall back to deterministic
     * defaults derived from the IR.
     */
    artifact?: Pick<Artifact, 'type'> & Partial<Pick<Artifact, 'name' | 'objective' | 'audience' | 'theme'>>;
    audience?: DiagramAudience;
    /** Default theme when neither artifact nor IR declares one. */
    defaultTheme?: DiagramTheme;
    /** Default density when neither artifact nor IR declares one. */
    defaultDensity?: DiagramDensity;
    /**
     * When true, fill missing node descriptions with a role-aware sentence.
     * Off by default to avoid visual clutter when the gate runs at render
     * time — the user-facing CustomNode renders descriptions inline, and
     * synthesised text would look noisy alongside hand-authored ones.
     * Enable explicitly from generation pipelines or the manual
     * "Auto-mejorar diagrama" action.
     */
    synthesizeDescriptions?: boolean;
    /**
     * When true, rewrite labels that equal their id into a humanised form
     * ("order-service" → "Order Service"). Off by default for the same
     * visual-stability reason as `synthesizeDescriptions`.
     */
    humaniseLabels?: boolean;
    /**
     * When true, rewrite unstable IDs (UUID/timestamp) into stable
     * kebab-case. Off by default at render time because renaming an id
     * shifts every cached selector that referenced the old one.
     */
    normaliseIds?: boolean;
}

const VERB_BY_SOURCE_ROLE: Record<SemanticRole, string> = {
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

const OBJECT_BY_TARGET_ROLE: Record<SemanticRole, string> = {
    person: 'al usuario',
    gateway: 'pasarela',
    service: 'servicio',
    process: 'proceso',
    messaging: 'evento',
    data: 'almacén',
    external: 'sistema externo',
    system: 'sistema',
    generic: 'destino',
};

const ROLE_GROUP_LABEL: Record<SemanticRole, string> = {
    person: 'Actores',
    gateway: 'Capa de borde',
    service: 'Servicios',
    process: 'Procesos',
    messaging: 'Mensajería',
    data: 'Datos',
    external: 'Sistemas externos',
    system: 'Sistemas',
    generic: 'Componentes',
};

const ROLE_TO_CANONICAL_KIND: Record<SemanticRole, string> = {
    person: 'person',
    gateway: 'gateway',
    service: 'service',
    process: 'process',
    messaging: 'messaging',
    data: 'data',
    external: 'external',
    system: 'system',
    generic: 'generic',
};

const NODE_LABEL_MAX = 32;
const EDGE_LABEL_MAX = 40;

const PROTOCOL_BY_ROLE: Record<SemanticRole, string> = {
    person: 'HTTPS',
    gateway: 'REST/HTTPS',
    service: 'REST/HTTPS',
    process: 'REST/HTTPS',
    messaging: 'Kafka',
    data: 'JDBC',
    external: 'REST/HTTPS',
    system: 'REST/HTTPS',
    generic: 'REST/HTTPS',
};

const PROTOCOL_HINTS_RE = /\b(http|https|rest|grpc|soap|graphql|webhook|websocket|sftp|smtp|kafka|amqp|jdbc|odbc|tcp|udp)\b/i;

const GENERIC_EDGE_LABELS = new Set([
    '', 'data', 'datos', 'flow', 'flujo', 'call', 'calls', 'invoke', 'invokes',
    'request', 'requests', 'response', 'uses', 'usa', 'use', 'connects',
    'connection', 'link', 'enlace', 'edge', 'arrow', 'reads', 'writes',
    'read', 'write', 'rw', 'relaciona', 'relates', 'related', 'relacion',
    '->', '-->', '=>', '<-', '<->', 'interactua',
]);

function deepCloneIR(ir: DiagramIR): DiagramIR {
    return {
        nodes: ir.nodes.map((n) => ({ ...n })),
        edges: ir.edges.map((e) => ({ ...e })),
        groups: ir.groups.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })),
        metadata: { ...(ir.metadata ?? {}) },
    };
}

function humaniseId(id: string): string {
    const cleaned = id
        .replace(/[._-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return id;
    return cleaned
        .split(' ')
        .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
        .join(' ');
}

function shortenLabel(label: string, max: number): string {
    if (label.length <= max) return label;
    const trimmed = label.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, '');
    return `${trimmed}…`;
}

function inferProtocol(source?: DiagramIRNode, target?: DiagramIRNode, edge?: DiagramIREdge): string {
    const sourceText = `${source?.label ?? ''} ${source?.kind ?? ''} ${source?.technology ?? ''}`;
    const targetText = `${target?.label ?? ''} ${target?.kind ?? ''} ${target?.technology ?? ''}`;
    const combined = `${sourceText} ${targetText} ${edge?.label ?? ''}`.toLowerCase();

    if (/grpc/.test(combined)) return 'gRPC';
    if (/graphql/.test(combined)) return 'GraphQL';
    if (/webhook|callback/.test(combined)) return 'Webhook/HTTPS';
    if (/kafka|topic|evento|event|stream|pub\/sub/.test(combined)) return 'Kafka';
    if (/rabbit|amqp|queue|cola/.test(combined)) return 'AMQP';
    if (/sftp|file|archivo|batch/.test(combined)) return 'SFTP';
    if (/jdbc|postgres|mysql|oracle|sql|database|db|datos/.test(combined)) return 'JDBC';

    if (edge?.relation === 'async') return 'Kafka';
    if (edge?.relation === 'data-flow') return 'JDBC';

    const targetRole = detectSemanticRole(target?.label ?? '', target?.kind);
    const sourceRole = detectSemanticRole(source?.label ?? '', source?.kind);
    if (targetRole === 'messaging' || sourceRole === 'messaging') return PROTOCOL_BY_ROLE.messaging;
    if (targetRole === 'data' || sourceRole === 'data') return PROTOCOL_BY_ROLE.data;
    if (targetRole === 'person') return 'HTTPS';
    return PROTOCOL_BY_ROLE[targetRole] ?? PROTOCOL_BY_ROLE[sourceRole] ?? 'REST/HTTPS';
}

function withProtocolHint(label: string, protocol: string): string {
    const trimmed = label.trim();
    if (!trimmed) return protocol;
    if (PROTOCOL_HINTS_RE.test(trimmed)) return shortenLabel(trimmed, EDGE_LABEL_MAX);
    const candidate = `${trimmed} · ${protocol}`;
    if (candidate.length <= EDGE_LABEL_MAX) return candidate;
    const compact = `${trimmed} ${protocol}`;
    if (compact.length <= EDGE_LABEL_MAX) return compact;
    return shortenLabel(compact, EDGE_LABEL_MAX);
}

function buildVerbLabel(source: DiagramIRNode | undefined, target: DiagramIRNode | undefined, edge?: DiagramIREdge): string {
    if (!source || !target) return 'Interactúa · REST/HTTPS';
    const sRole = detectSemanticRole(source.label ?? '', source.kind);
    const tRole = detectSemanticRole(target.label ?? '', target.kind);
    const verb = VERB_BY_SOURCE_ROLE[sRole] ?? 'Conecta';
    const obj = OBJECT_BY_TARGET_ROLE[tRole] ?? 'destino';
    return withProtocolHint(`${verb} ${obj}`, inferProtocol(source, target, edge));
}

function inferDescription(node: DiagramIRNode): string {
    const role = detectSemanticRole(node.label ?? '', node.kind);
    const friendlyName = node.label?.trim() || humaniseId(node.id);
    switch (role) {
        case 'person':    return `Actor o usuario: ${friendlyName}.`;
        case 'gateway':   return `Capa de borde que media el acceso a ${friendlyName}.`;
        case 'service':   return `Servicio responsable de ${friendlyName}.`;
        case 'process':   return `Proceso que orquesta ${friendlyName}.`;
        case 'messaging': return `Canal de mensajería para ${friendlyName}.`;
        case 'data':      return `Almacén de datos para ${friendlyName}.`;
        case 'external':  return `Sistema externo: ${friendlyName}.`;
        case 'system':    return `Sistema o bounded context: ${friendlyName}.`;
        default:          return `Componente del flujo: ${friendlyName}.`;
    }
}

function isGenericEdgeLabel(label: string | undefined): boolean {
    if (!label) return true;
    const trimmed = label.trim().toLowerCase();
    if (!trimmed) return true;
    if (GENERIC_EDGE_LABELS.has(trimmed)) return true;
    return false;
}

/** Re-classify a node's `kind` to the canonical taxonomy when it's empty,
 *  unknown, or a non-canonical synonym ("Component", "DB", "Microservice"). */
function reclassifyKind(node: DiagramIRNode, applied: QualityRepairChange[]): boolean {
    const current = (node.kind ?? '').toLowerCase().trim();
    const role = detectSemanticRole(node.label ?? '', node.kind);
    const canonical = ROLE_TO_CANONICAL_KIND[role];
    // Already canonical? Leave alone.
    if (current === canonical) return false;
    // Preserve recognised C4 declarations (Container, ContainerDb, Component,
    // SoftwareSystem, Person, Deployment_Node…) — those carry richer meaning.
    if (/(person|system|container|component|deployment|node)/i.test(current)
        && current !== 'component' && current !== 'unknown') {
        return false;
    }
    node.kind = canonical;
    applied.push({
        code: 'NODE_KIND_NORMALIZED',
        description: `Reasignado kind canónico "${canonical}" al nodo "${node.label ?? node.id}".`,
        targetIds: [node.id],
    });
    return true;
}

function repairNodeLabels(ir: DiagramIR, applied: QualityRepairChange[], opts: { humanise: boolean }): void {
    for (const node of ir.nodes) {
        const label = (node.label ?? '').trim();
        if (!label) {
            // Always fix empty labels — an unlabelled node is unrenderable.
            node.label = humaniseId(node.id);
            applied.push({
                code: 'NODE_LABEL_FILLED',
                description: `Asignado label legible "${node.label}" al nodo ${node.id}.`,
                targetIds: [node.id],
            });
            continue;
        }
        // Humanisation is opt-in: rewriting "order-service" to "Order Service"
        // visually changes a diagram on every render. Default off; opt-in via
        // explicit auto-improve.
        if (opts.humanise && label === node.id.trim()) {
            node.label = humaniseId(node.id);
            applied.push({
                code: 'NODE_LABEL_HUMANISED',
                description: `Reemplazado id técnico por label legible "${node.label}".`,
                targetIds: [node.id],
            });
        }
        if (node.label.length > NODE_LABEL_MAX) {
            const original = node.label;
            node.label = shortenLabel(node.label, NODE_LABEL_MAX);
            applied.push({
                code: 'NODE_LABEL_TRUNCATED',
                description: `Acortado label largo (${original.length}→${node.label.length} chars) en ${node.id}.`,
                targetIds: [node.id],
            });
        }
    }
}

function repairNodeDescriptions(ir: DiagramIR, applied: QualityRepairChange[]): void {
    for (const node of ir.nodes) {
        if ((node.description ?? '').trim().length > 0) continue;
        node.description = inferDescription(node);
        applied.push({
            code: 'NODE_DESCRIPTION_FILLED',
            description: `Generada descripción mínima para ${node.label || node.id}.`,
            targetIds: [node.id],
        });
    }
}

function repairEdgeLabels(ir: DiagramIR, applied: QualityRepairChange[]): void {
    const nodeMap = new Map(ir.nodes.map((n) => [n.id, n]));
    for (const edge of ir.edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        const inferredProtocol = inferProtocol(source, target, edge);
        const protocolWasMissing = !edge.protocol?.trim();
        if (protocolWasMissing) edge.protocol = inferredProtocol;

        const wasGeneric = isGenericEdgeLabel(edge.label);
        if (wasGeneric) {
            const newLabel = buildVerbLabel(source, target, edge);
            edge.label = newLabel;
            applied.push({
                code: 'EDGE_LABEL_FILLED',
                description: `Etiqueta accionable "${newLabel}" generada para arista ${edge.id}.`,
                targetIds: [edge.id],
            });
        } else if (!PROTOCOL_HINTS_RE.test(edge.label ?? '') && inferredProtocol) {
            const enrichedLabel = withProtocolHint(edge.label, inferredProtocol);
            if (enrichedLabel !== edge.label) {
                edge.label = enrichedLabel;
                applied.push({
                    code: 'EDGE_PROTOCOL_LABEL_ADDED',
                    description: `Agregado protocolo "${inferredProtocol}" a la arista ${edge.id}.`,
                    targetIds: [edge.id],
                });
            }
        }

        if (protocolWasMissing) {
            applied.push({
                code: 'EDGE_PROTOCOL_INFERRED',
                description: `Inferido protocolo "${edge.protocol}" para arista ${edge.id}.`,
                targetIds: [edge.id],
            });
        }

        if (edge.label && edge.label.length > EDGE_LABEL_MAX) {
            const original = edge.label;
            edge.label = shortenLabel(edge.label, EDGE_LABEL_MAX);
            applied.push({
                code: 'EDGE_LABEL_SHORTENED',
                description: `Acortada etiqueta de arista (${original.length}→${edge.label.length} chars).`,
                targetIds: [edge.id],
            });
        }
    }
}

/** Drop edges whose endpoints don't exist; survive partial AI output gracefully. */
function dropDanglingEdges(ir: DiagramIR, applied: QualityRepairChange[]): void {
    const ids = new Set(ir.nodes.map((n) => n.id));
    const before = ir.edges.length;
    const removed: string[] = [];
    ir.edges = ir.edges.filter((e) => {
        const ok = ids.has(e.source) && ids.has(e.target);
        if (!ok) removed.push(e.id);
        return ok;
    });
    if (removed.length === 0) return;
    applied.push({
        code: 'EDGE_REFERENCE_DROPPED',
        description: `Eliminadas ${before - ir.edges.length} arista(s) con referencias inválidas.`,
        targetIds: removed,
    });
}

/**
 * Connect orphan nodes to the most-connected sibling that shares (or is
 * compatible with) their semantic role.  This avoids the score-killing
 * "ORPHAN_NODE" lint while keeping the connection meaningful — we prefer the
 * busiest service or gateway as a hub instead of a random node.
 */
function repairOrphans(ir: DiagramIR, applied: QualityRepairChange[]): void {
    if (ir.nodes.length <= 1) return;
    const connected = new Set<string>();
    for (const e of ir.edges) {
        connected.add(e.source);
        connected.add(e.target);
    }
    const orphans = ir.nodes.filter((n) => !connected.has(n.id));
    if (orphans.length === 0) return;

    // Build a degree map to find the busiest candidate hub.
    const degree = new Map<string, number>();
    for (const e of ir.edges) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const candidates = ir.nodes
        .filter((n) => !orphans.find((o) => o.id === n.id))
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

    if (candidates.length === 0) return;

    let edgeCounter = ir.edges.length + 1;
    const reconnectedIds: string[] = [];
    for (const orphan of orphans) {
        const orphanRole = detectSemanticRole(orphan.label ?? '', orphan.kind);
        const preferred = candidates.find((c) => detectSemanticRole(c.label ?? '', c.kind) !== orphanRole) ?? candidates[0];
        const newEdge: DiagramIREdge = {
            id: `e-orphan-${edgeCounter++}`,
            source: orphan.id,
            target: preferred.id,
            label: buildVerbLabel(orphan, preferred),
            protocol: inferProtocol(orphan, preferred),
            relation: 'default',
        };
        ir.edges.push(newEdge);
        reconnectedIds.push(orphan.id);
    }
    applied.push({
        code: 'ORPHAN_RECONNECTED',
        description: `Reconectados ${orphans.length} nodo(s) huérfano(s) al flujo principal.`,
        targetIds: reconnectedIds,
    });
}

/**
 * Improve visual hierarchy. When the model emits one huge swimlane (the common
 * low-score case reported by users), split it into readable chunks; when no
 * groups exist, synthesize semantic buckets by role.
 */
function repairGrouping(ir: DiagramIR, applied: QualityRepairChange[]): void {
    if (ir.nodes.length < 5) return;

    const nodeIds = new Set(ir.nodes.map((node) => node.id));
    const validGroups = ir.groups
        .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => nodeIds.has(id)) }))
        .filter((group) => group.nodeIds.length > 0);

    if (validGroups.length > 0) {
        const readableGroups: DiagramIRGroup[] = [];
        const splitTargets: string[] = [];

        for (const group of validGroups) {
            if (group.nodeIds.length <= 8) {
                readableGroups.push(group);
                continue;
            }

            splitTargets.push(group.id);
            for (let offset = 0; offset < group.nodeIds.length; offset += 6) {
                const chunk = group.nodeIds.slice(offset, offset + 6);
                const index = Math.floor(offset / 6) + 1;
                readableGroups.push({
                    id: `${group.id}-p${index}`,
                    label: `${group.label} · ${index}`,
                    nodeIds: chunk,
                });
            }
        }

        if (splitTargets.length > 0) {
            ir.groups = readableGroups;
            const groupByNode = new Map(readableGroups.flatMap((group) => group.nodeIds.map((nodeId) => [nodeId, group.label] as const)));
            for (const node of ir.nodes) {
                const groupLabel = groupByNode.get(node.id);
                if (groupLabel) node.group = groupLabel;
            }
            applied.push({
                code: 'DENSE_GROUP_SPLIT',
                description: `Divididos ${splitTargets.length} grupo(s) densos en secciones legibles de hasta 6 nodos.`,
                targetIds: splitTargets,
            });
        }
        return;
    }

    const buckets = new Map<SemanticRole, string[]>();
    for (const node of ir.nodes) {
        const role = detectSemanticRole(node.label ?? '', node.kind);
        if (!buckets.has(role)) buckets.set(role, []);
        buckets.get(role)!.push(node.id);
    }
    const groups: DiagramIRGroup[] = [];
    let i = 1;
    for (const [role, ids] of buckets) {
        if (ids.length < 2) continue;
        groups.push({ id: `group-${i++}`, label: ROLE_GROUP_LABEL[role], nodeIds: ids });
    }
    if (groups.length === 0) return;
    ir.groups.push(...groups);
    // Sync `node.group` so renderers/quality computations see the grouping.
    const labelById = new Map<string, string>();
    for (const g of groups) for (const id of g.nodeIds) labelById.set(id, g.label);
    for (const node of ir.nodes) {
        if (!node.group && labelById.has(node.id)) node.group = labelById.get(node.id);
    }
    applied.push({
        code: 'GROUPING_SYNTHESIZED',
        description: `Creados ${groups.length} grupo(s) por rol semántico.`,
        targetIds: groups.map((g) => g.id),
    });
}

/** Default audience to executive when ≤ 6 nodes, technical otherwise. */
function defaultAudienceFor(ir: DiagramIR): DiagramAudience {
    if (ir.nodes.length <= 6) return 'executive';
    if (ir.nodes.length >= 18) return 'operations';
    return 'technical';
}

/** A 1-line narrative from the topology, marked `derived` — see that field. */
function synthesizeNarrative(ir: DiagramIR, audience: DiagramAudience, title?: string): DiagramNarrative {
    const head = title ? `${title}: ` : '';
    const persons = ir.nodes.filter((n) => detectSemanticRole(n.label ?? '', n.kind) === 'person');
    const services = ir.nodes.filter((n) => detectSemanticRole(n.label ?? '', n.kind) === 'service');
    const stores = ir.nodes.filter((n) => detectSemanticRole(n.label ?? '', n.kind) === 'data');
    const externals = ir.nodes.filter((n) => detectSemanticRole(n.label ?? '', n.kind) === 'external');
    const subject = persons[0]?.label ?? services[0]?.label ?? ir.nodes[0]?.label ?? 'el sistema';
    const audienceTone =
        audience === 'executive' ? 'el valor de negocio' :
        audience === 'operations' ? 'la operación y observabilidad' :
        'la implementación técnica';
    const tail = stores.length
        ? ` con ${stores.length} almacén(es) y ${externals.length} integración(es) externa(s)`
        : externals.length
            ? ` con ${externals.length} integración(es) externa(s)`
            : '';
    return {
        summary: `${head}flujo centrado en ${subject}, optimizado para ${audienceTone}${tail}.`,
        source: 'derived',
    };
}

function repairMetadata(
    ir: DiagramIR,
    applied: QualityRepairChange[],
    opts: QualityRepairOptions,
): void {
    const meta = { ...(ir.metadata ?? {}) };
    let changed = false;

    const audience = opts.audience
        ?? opts.artifact?.audience
        ?? meta.audience
        ?? defaultAudienceFor(ir);
    if (meta.audience !== audience) {
        meta.audience = audience;
        changed = true;
    }

    const desiredTitle = (meta.title ?? '').trim() || (opts.artifact?.name ?? '').trim();
    if (!meta.title && desiredTitle) {
        meta.title = desiredTitle;
        changed = true;
    }

    if (!meta.theme) {
        meta.theme = opts.artifact?.theme ?? opts.defaultTheme ?? 'editorial';
        changed = true;
    }
    if (!meta.density) {
        meta.density = opts.defaultDensity ?? (ir.nodes.length <= 8 ? 'standard' : ir.nodes.length <= 16 ? 'rich' : 'compact');
        changed = true;
    }
    if (!meta.generatedAt) {
        meta.generatedAt = new Date().toISOString();
        changed = true;
    }

    if (!narrativeHasText(meta.narrative) && ir.nodes.length > 0) {
        meta.narrative = synthesizeNarrative(ir, audience, meta.title);
        changed = true;
    }

    if (changed) {
        ir.metadata = meta;
        applied.push({
            code: 'METADATA_FILLED',
            description: 'Metadata completada (audience, title, theme, density, narrative).',
        });
    }
}

/** Guarantee deterministic, kebab-cased ids when the existing id is unstable. */
function repairIds(ir: DiagramIR, applied: QualityRepairChange[]): void {
    const renamed: string[] = [];
    const idMap = new Map<string, string>();
    const taken = new Set(ir.nodes.map((n) => n.id));
    const idIsUnstable = (id: string) => /^\d{8,}$/.test(id) || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(id);
    for (const node of ir.nodes) {
        if (!idIsUnstable(node.id)) continue;
        const base = (node.label ?? 'node')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 24) || 'node';
        let candidate = base;
        let n = 1;
        while (taken.has(candidate)) candidate = `${base}-${++n}`;
        taken.add(candidate);
        idMap.set(node.id, candidate);
        node.id = candidate;
        renamed.push(candidate);
    }
    if (idMap.size === 0) return;
    for (const edge of ir.edges) {
        if (idMap.has(edge.source)) edge.source = idMap.get(edge.source)!;
        if (idMap.has(edge.target)) edge.target = idMap.get(edge.target)!;
    }
    for (const group of ir.groups) {
        group.nodeIds = group.nodeIds.map((id) => idMap.get(id) ?? id);
    }
    applied.push({
        code: 'NODE_ID_NORMALIZED',
        description: `Normalizados ${idMap.size} id(s) técnicos a kebab-case estable.`,
        targetIds: renamed,
    });
}

function repairKinds(ir: DiagramIR, applied: QualityRepairChange[]): void {
    for (const node of ir.nodes) reclassifyKind(node, applied);
}

/**
 * Public entry point. Apply all deterministic structural repairs and return
 * the mutated IR plus a list of changes.  Safe to invoke multiple times — most
 * passes are idempotent (a second invocation should produce no further fixes).
 */
export function autoRepairDiagramIR(
    ir: DiagramIR,
    options: QualityRepairOptions = {},
): QualityRepairResult {
    const next = deepCloneIR(ir);
    const applied: QualityRepairChange[] = [];

    const synthesizeDescriptions = options.synthesizeDescriptions ?? false;
    const humaniseLabels = options.humaniseLabels ?? false;
    const normaliseIds = options.normaliseIds ?? false;

    // 1) Drop dangling edges first so subsequent passes operate on a coherent graph.
    dropDanglingEdges(next, applied);
    // 2) Normalise ids — opt-in. Defaults off because renaming ids visually
    //    breaks any cached external references (selectors, deep links).
    if (normaliseIds) repairIds(next, applied);
    // 3) Re-classify kinds so role-aware repairs use the canonical taxonomy.
    repairKinds(next, applied);
    // 4) Node labels (shorten / fill blanks; humanise only when explicitly
    //    requested by the caller).
    repairNodeLabels(next, applied, { humanise: humaniseLabels });
    // 5) Node descriptions — opt-in. The generation pipeline and the manual
    //    "Auto-mejorar" button enable this; the render-time gate does not so
    //    persisted diagrams keep their original visual texture.
    if (synthesizeDescriptions) repairNodeDescriptions(next, applied);
    // 6) Edge labels (verbs, length cap).
    repairEdgeLabels(next, applied);
    // 7) Reconnect orphans to a meaningful hub.
    repairOrphans(next, applied);
    // 8) Synthesize role-based grouping when needed.
    repairGrouping(next, applied);
    // 9) Fill metadata (title, audience, theme, density, narrative).
    repairMetadata(next, applied, options);

    if (applied.length > 0) {
        next.metadata = next.metadata ?? {};
        const history = Array.isArray(next.metadata.repairHistory) ? [...next.metadata.repairHistory] : [];
        history.push({
            at: new Date().toISOString(),
            reason: 'quality-repair',
            changes: applied.map((a) => `${a.code}: ${a.description}`),
        });
        next.metadata.repairHistory = history;
    }

    return { ir: next, applied };
}
