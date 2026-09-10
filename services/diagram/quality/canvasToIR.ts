/**
 * Canvas → DiagramIR, and merging what the canvas cannot see.
 *
 * Extracted from `services/diagramQualityService.ts`, which had grown to 1.357
 * lines holding four separate jobs: this conversion, the lint rules, the ten
 * scoring dimensions, and the orchestration that combines them. Reading any
 * one of them meant scrolling past the other three.
 *
 * The conversion is the part with the longest memory. Earlier versions kept
 * only label/kind/description/group/shape and silently degraded the IR on
 * every visual edit — `semanticType`, `technology`, `criticality`,
 * `dataSensitivity` and `compliance` were lost on a round trip. That is why
 * every field here is read defensively and `mergeIRMetadata` exists at all.
 */

import type { Edge, Node } from 'reactflow';
import type { DiagramIR, DiagramIREdge, DiagramIRGroup, DiagramIRNode } from '../../../lib/diagram';

/**
 * Convert a ReactFlow graph back into a DiagramIR.
 *
 * Phase 2: preserve the full semantic metadata that the canvas carries on
 * each node/edge `data` payload. Earlier versions discarded everything
 * except label/kind/description/group/shape, which silently degraded the
 * IR on every visual edit (the round-trip would lose `semanticType`,
 * `technology`, `criticality`, `dataSensitivity`, `compliance`, …).
 *
 * The function tolerates legacy nodes that only ship the bare minimum:
 * every new field is read defensively and only included when it carries a
 * usable value, so the resulting IR stays compact for downstream
 * serialisation and the existing tests keep passing.
 *
 * Callers that previously stored an enriched IR alongside the canvas
 * (`Artifact.ir`) should pass the existing IR through `mergeIRMetadata`
 * (below) so node/edge metadata that the canvas does not surface (e.g.
 * `narrative`, `layoutPlan`, `audience`) is preserved across edits.
 */
type CanvasNodeData = Partial<DiagramIRNode> & {
    type?: string;
    semanticRole?: DiagramIRNode['semanticRole'];
    semanticType?: DiagramIRNode['semanticType'];
    tags?: string[];
    badge?: string;
    icon?: string;
    status?: DiagramIRNode['status'];
};

type CanvasEdgeData = Partial<DiagramIREdge> & {
    edgeType?: DiagramIREdge['relation'];
};

const trimOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const trimArrayOrUndefined = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const cleaned = value
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
};

const pickIfSet = <T,>(value: T | undefined | null): T | undefined => (
    value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
        ? undefined
        : value
);

export const toDiagramIR = (nodes: Node[], edges: Edge[]): DiagramIR => {
    const irNodes: DiagramIRNode[] = nodes
        .filter(n => n.type !== 'groupZone')
        .map((n) => {
            const data = (n.data ?? {}) as CanvasNodeData;
            const label = String(data.label ?? '');
            const kind = String(
                data.kind ||
                data.type ||
                'Unknown'
            );
            const node: DiagramIRNode = {
                id: String(n.id),
                label,
                kind,
            };
            // Persist the canvas position so manual adjustments survive the
            // round-trip (consumed when `metadata.layoutMode === 'manual'`).
            if (n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y)) {
                node.position = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
            }
            const description = trimOrUndefined(data.description);
            if (description) node.description = description;
            const technology = trimOrUndefined(data.technology);
            if (technology) node.technology = technology;
            const group = trimOrUndefined(data.group);
            if (group) node.group = group;
            if (data.shape) node.shape = data.shape as DiagramIRNode['shape'];
            if (data.icon) node.icon = data.icon;
            if (data.status) node.status = data.status;
            if (data.badge) node.badge = data.badge;
            const tags = trimArrayOrUndefined(data.tags);
            if (tags) node.tags = tags;
            if (data.semanticRole) node.semanticRole = data.semanticRole;
            if (data.semanticType) node.semanticType = data.semanticType;
            // Phase 2 governance fields. Each is only emitted when the
            // canvas actually carried a value so we don't fabricate metadata.
            const owner = trimOrUndefined(data.owner);
            if (owner) node.owner = owner;
            const domain = trimOrUndefined(data.domain);
            if (domain) node.domain = domain;
            const dataClassification = pickIfSet(data.dataClassification);
            if (dataClassification) node.dataClassification = dataClassification;
            const securityLevel = pickIfSet(data.securityLevel);
            if (securityLevel) node.securityLevel = securityLevel;
            const compliance = trimArrayOrUndefined(data.compliance);
            if (compliance) node.compliance = compliance;
            const criticality = pickIfSet(data.criticality);
            if (criticality) node.criticality = criticality;
            const trust = pickIfSet(data.trust);
            if (trust) node.trust = trust;
            const businessMeaning = trimOrUndefined(data.businessMeaning);
            if (businessMeaning) node.businessMeaning = businessMeaning;
            const technicalMeaning = trimOrUndefined(data.technicalMeaning);
            if (technicalMeaning) node.technicalMeaning = technicalMeaning;
            return node;
        });

    const irEdges: DiagramIREdge[] = edges.map((e) => {
        const data = (e.data ?? {}) as CanvasEdgeData;
        const edge: DiagramIREdge = {
            id: String(e.id),
            source: String(e.source),
            target: String(e.target),
            label: String((e.label as string | undefined) ?? '').trim() || 'Relaciona',
            relation: data.edgeType ?? data.relation ?? 'default',
        };
        const protocol = trimOrUndefined(data.protocol);
        if (protocol) edge.protocol = protocol;
        if (data.direction) edge.direction = data.direction;
        if (data.criticality) edge.criticality = data.criticality;
        if (typeof data.animated === 'boolean') edge.animated = data.animated;
        if (data.dataSensitivity) edge.dataSensitivity = data.dataSensitivity;
        const retryPolicy = trimOrUndefined(data.retryPolicy);
        if (retryPolicy) edge.retryPolicy = retryPolicy;
        if (data.semanticType) edge.semanticType = data.semanticType;
        // Phase 2 extended edge metadata.
        if (data.frequency) edge.frequency = data.frequency;
        if (data.synchrony) edge.synchrony = data.synchrony;
        const security = trimOrUndefined(data.security);
        if (security) edge.security = security;
        const payload = trimOrUndefined(data.payload);
        if (payload) edge.payload = payload;
        if (data.trust) edge.trust = data.trust;
        const businessMeaning = trimOrUndefined(data.businessMeaning);
        if (businessMeaning) edge.businessMeaning = businessMeaning;
        const technicalMeaning = trimOrUndefined(data.technicalMeaning);
        if (technicalMeaning) edge.technicalMeaning = technicalMeaning;
        const observability = trimOrUndefined(data.observability);
        if (observability) edge.observability = observability;
        const sla = trimOrUndefined(data.sla);
        if (sla) edge.sla = sla;
        const errorHandling = trimOrUndefined(data.errorHandling);
        if (errorHandling) edge.errorHandling = errorHandling;
        return edge;
    });

    const groupsMap = new Map<string, string[]>();
    irNodes.forEach((n) => {
        if (!n.group) return;
        groupsMap.set(n.group, [...(groupsMap.get(n.group) ?? []), n.id]);
    });

    // Gap 7: when the canvas carries explicit group-zone nodes, they
    // already hold the semantic metadata (`kind`, `purpose`, `boundaryType`,
    // `owner`, `trust`). Pre-index them by label so the IR groups inherit
    // the metadata that the previous IR populated — even before
    // `mergeIRMetadata` runs.
    const groupZoneIndex = new Map<string, {
        id?: string;
        kind?: DiagramIRGroup['kind'];
        purpose?: string;
        boundaryType?: DiagramIRGroup['boundaryType'];
        owner?: string;
        trust?: DiagramIRGroup['trust'];
    }>();
    for (const n of nodes) {
        if (n.type !== 'groupZone') continue;
        const data = (n.data ?? {}) as {
            label?: string;
            kind?: DiagramIRGroup['kind'];
            purpose?: string;
            boundaryType?: DiagramIRGroup['boundaryType'];
            owner?: string;
            trust?: DiagramIRGroup['trust'];
            groupId?: string;
        };
        const label = String(data.label ?? '').trim();
        if (!label) continue;
        groupZoneIndex.set(label.toLowerCase(), {
            id: data.groupId,
            kind: data.kind,
            purpose: data.purpose,
            boundaryType: data.boundaryType,
            owner: data.owner,
            trust: data.trust,
        });
    }

    const groups: DiagramIRGroup[] = Array.from(groupsMap.entries()).map(([label, nodeIds], idx) => {
        const zone = groupZoneIndex.get(label.toLowerCase());
        const base: DiagramIRGroup = {
            id: zone?.id ?? `group-${idx + 1}`,
            label,
            nodeIds,
        };
        if (zone?.kind) base.kind = zone.kind;
        if (zone?.purpose) base.purpose = zone.purpose;
        if (zone?.boundaryType) base.boundaryType = zone.boundaryType;
        if (zone?.owner) base.owner = zone.owner;
        if (zone?.trust) base.trust = zone.trust;
        return base;
    });

    return {
        nodes: irNodes,
        edges: irEdges,
        groups,
        metadata: {
            sourceFormat: 'react-flow',
            generatedAt: new Date().toISOString(),
        },
    };
};

/**
 * Merge a fresh round-tripped IR (from `toDiagramIR`) with a previously
 * persisted IR so semantic metadata that the canvas does not surface
 * (narrative, audience, layoutPlan, diagramType, group.kind, group.purpose…)
 * survives the visual edit.
 *
 * Strategy:
 *  - The fresh nodes/edges/groups are the source of truth for the graph
 *    topology and the labels the user just edited.
 *  - For every node/edge whose id matches a node/edge in the previous IR,
 *    we backfill missing optional fields (`owner`, `domain`, `compliance`,
 *    `semanticType`, …) from the previous payload. We never overwrite a
 *    value that the canvas actively cleared.
 *  - For groups, we re-attach the previous `kind`, `purpose`, `boundaryType`,
 *    `owner` and `trust` when the labels match.
 *  - Metadata is shallow-merged: the fresh metadata wins on
 *    `sourceFormat` / `generatedAt`; everything else (narrative,
 *    diagramType, layoutPlan, qualityReview, …) is restored from the
 *    previous IR when the fresh IR did not set it explicitly.
 */
export const mergeIRMetadata = (fresh: DiagramIR, previous: DiagramIR | undefined | null): DiagramIR => {
    if (!previous) return fresh;
    const nodeIndex = new Map(previous.nodes.map((n) => [n.id, n] as const));
    const edgeIndex = new Map(previous.edges.map((e) => [e.id, e] as const));
    const groupIndex = new Map(previous.groups.map((g) => [g.label.toLowerCase(), g] as const));

    const mergedNodes = fresh.nodes.map((next) => {
        const prev = nodeIndex.get(next.id);
        if (!prev) return next;
        // Per-field merge: fresh wins; previous fills in optional fields
        // that the canvas does not surface.
        const merged: DiagramIRNode = { ...prev, ...next };
        // Restore non-canvas semantic fields the canvas may not propagate.
        if (next.icon === undefined && prev.icon !== undefined) merged.icon = prev.icon;
        if (next.tags === undefined && prev.tags !== undefined) merged.tags = prev.tags;
        if (next.badge === undefined && prev.badge !== undefined) merged.badge = prev.badge;
        if (next.status === undefined && prev.status !== undefined) merged.status = prev.status;
        if (next.semanticRole === undefined && prev.semanticRole !== undefined) merged.semanticRole = prev.semanticRole;
        if (next.semanticType === undefined && prev.semanticType !== undefined) merged.semanticType = prev.semanticType;
        if (next.owner === undefined && prev.owner !== undefined) merged.owner = prev.owner;
        if (next.domain === undefined && prev.domain !== undefined) merged.domain = prev.domain;
        if (next.dataClassification === undefined && prev.dataClassification !== undefined) merged.dataClassification = prev.dataClassification;
        if (next.securityLevel === undefined && prev.securityLevel !== undefined) merged.securityLevel = prev.securityLevel;
        if (next.compliance === undefined && prev.compliance !== undefined) merged.compliance = prev.compliance;
        if (next.criticality === undefined && prev.criticality !== undefined) merged.criticality = prev.criticality;
        if (next.trust === undefined && prev.trust !== undefined) merged.trust = prev.trust;
        if (next.businessMeaning === undefined && prev.businessMeaning !== undefined) merged.businessMeaning = prev.businessMeaning;
        if (next.technicalMeaning === undefined && prev.technicalMeaning !== undefined) merged.technicalMeaning = prev.technicalMeaning;
        return merged;
    });

    const mergedEdges = fresh.edges.map((next) => {
        const prev = edgeIndex.get(next.id);
        if (!prev) return next;
        const merged: DiagramIREdge = { ...prev, ...next };
        if (next.protocol === undefined && prev.protocol !== undefined) merged.protocol = prev.protocol;
        if (next.direction === undefined && prev.direction !== undefined) merged.direction = prev.direction;
        if (next.criticality === undefined && prev.criticality !== undefined) merged.criticality = prev.criticality;
        if (next.dataSensitivity === undefined && prev.dataSensitivity !== undefined) merged.dataSensitivity = prev.dataSensitivity;
        if (next.retryPolicy === undefined && prev.retryPolicy !== undefined) merged.retryPolicy = prev.retryPolicy;
        if (next.semanticType === undefined && prev.semanticType !== undefined) merged.semanticType = prev.semanticType;
        if (next.frequency === undefined && prev.frequency !== undefined) merged.frequency = prev.frequency;
        if (next.synchrony === undefined && prev.synchrony !== undefined) merged.synchrony = prev.synchrony;
        if (next.security === undefined && prev.security !== undefined) merged.security = prev.security;
        if (next.payload === undefined && prev.payload !== undefined) merged.payload = prev.payload;
        if (next.trust === undefined && prev.trust !== undefined) merged.trust = prev.trust;
        if (next.businessMeaning === undefined && prev.businessMeaning !== undefined) merged.businessMeaning = prev.businessMeaning;
        if (next.technicalMeaning === undefined && prev.technicalMeaning !== undefined) merged.technicalMeaning = prev.technicalMeaning;
        if (next.observability === undefined && prev.observability !== undefined) merged.observability = prev.observability;
        if (next.sla === undefined && prev.sla !== undefined) merged.sla = prev.sla;
        if (next.errorHandling === undefined && prev.errorHandling !== undefined) merged.errorHandling = prev.errorHandling;
        return merged;
    });

    const mergedGroups = fresh.groups.map((next) => {
        const prev = groupIndex.get(next.label.toLowerCase());
        if (!prev) return next;
        const merged: DiagramIRGroup = { ...prev, ...next };
        if (next.kind === undefined && prev.kind !== undefined) merged.kind = prev.kind;
        if (next.purpose === undefined && prev.purpose !== undefined) merged.purpose = prev.purpose;
        if (next.boundaryType === undefined && prev.boundaryType !== undefined) merged.boundaryType = prev.boundaryType;
        if (next.owner === undefined && prev.owner !== undefined) merged.owner = prev.owner;
        if (next.trust === undefined && prev.trust !== undefined) merged.trust = prev.trust;
        return merged;
    });

    return {
        ...fresh,
        nodes: mergedNodes,
        edges: mergedEdges,
        groups: mergedGroups,
        metadata: {
            // previous metadata first so the fresh values (sourceFormat,
            // generatedAt) always overwrite the stale ones — but the
            // narrative, diagramType, layoutPlan, qualityReview, audience
            // and theme survive the visual edit.
            ...(previous.metadata ?? {}),
            ...(fresh.metadata ?? {}),
        },
    };
};

// ── Ten-dimension rubric ────────────────────────────────────────────────────
// Each dimension is computed from *different* evidence so the breakdown carries
// information rather than reflecting the same penalty count. Scores stay in
// [0,100]. Issues contribute separately to a mild penalty floor.
