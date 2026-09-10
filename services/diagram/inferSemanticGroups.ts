/**
 * Heuristic grouping pass — infers visual containers from the semantic
 * type of each node when the IR does not declare explicit groups.
 *
 * Why this matters: the renderer paints `metadata.groups` as visible
 * boundaries (System_Boundary). When the AI emits a diagram without
 * boundaries, the canvas looks like a soup of cards. The screenshots that
 * motivated this overhaul showed PBM container diagrams with no zones —
 * the user couldn't tell at a glance which nodes were legacy vs. cloud
 * vs. external providers.
 *
 * The function is conservative:
 *  - It NEVER overrides explicit groups already declared in the IR.
 *  - It only emits a group when ≥2 nodes share the same archetype.
 *  - It assigns a stable id and Spanish label (the canvas is primarily ES).
 *  - It returns a new IR — the input is never mutated.
 *
 * Pure, deterministic, side-effect free.
 */

import type { DiagramIR, DiagramIRGroup, DiagramIRNode } from '../../lib/diagram';
import { getNodeCategoryLabel, type NodeSemanticType } from '../../lib/diagramCategoryLabels';

/**
 * Boundary kinds per inferred zone. Surfaces the boundary semantics
 * downstream so the renderer can pick a distinct visual treatment per
 * kind (e.g. data zones get a green tint, security boundaries get a
 * dashed warning border).
 */
const ZONE_TO_BOUNDARY_KIND: Record<string, NonNullable<DiagramIRGroup['kind']>> = {
    'Usuarios y Actores':           'cluster',
    'Sistemas Legacy':              'legacy',
    'Plataforma de Integración':    'integration',
    'Servicios Cloud':              'cloud',
    'Sistemas Externos':            'external-provider',
    'Proveedores Externos':         'external-provider',
    'Capa de Datos':                'data',
    'Analítica y Reportes':         'data',
    'Canales Digitales':            'cluster',
    'Servicios de Notificación':    'cluster',
    'Seguridad':                    'security',
    'Motor de Reglas':              'cluster',
    'Procesos Batch':               'cluster',
    'Procesos de Negocio':          'cluster',
};

/** Inverse map: semantic types collapsed into a smaller set of visual zones. */
const SEMANTIC_TYPE_TO_ZONE: Partial<Record<NodeSemanticType, string>> = {
    'human-actor':           'Usuarios y Actores',
    'business-role':         'Usuarios y Actores',
    'legacy-system':         'Sistemas Legacy',
    'integration-platform':  'Plataforma de Integración',
    'messaging':             'Plataforma de Integración',
    'cloud-service':         'Servicios Cloud',
    'external-system':       'Sistemas Externos',
    'external-provider':     'Proveedores Externos',
    'document-repository':   'Capa de Datos',
    'database':              'Capa de Datos',
    'data-product':          'Capa de Datos',
    'analytics-system':      'Analítica y Reportes',
    'report':                'Analítica y Reportes',
    'dashboard':             'Analítica y Reportes',
    'portal':                'Canales Digitales',
    'digital-channel':       'Canales Digitales',
    'notification-service':  'Servicios de Notificación',
    'security-service':      'Seguridad',
    'rules-engine':          'Motor de Reglas',
    'batch-file':            'Procesos Batch',
    'business-process':      'Procesos de Negocio',
};

export interface InferSemanticGroupsResult {
    ir: DiagramIR;
    addedGroups: string[];
    /** Per-node assignments — `undefined` when the node did not match any zone. */
    nodeAssignments: Map<string, string | undefined>;
}

/**
 * Inspect the IR and return a new IR with auto-inferred semantic groups.
 *
 * Behaviour:
 *  1. Walk the IR. If `metadata.groups` already covers > 50 % of the nodes,
 *     the function is a no-op (the IR already has a deliberate grouping).
 *  2. Otherwise, bucket the *ungrouped* nodes by `SEMANTIC_TYPE_TO_ZONE`.
 *     Only buckets with ≥ 2 nodes become a new group.
 *  3. Existing nodes' `group` field is filled in when they fall into one of
 *     the new buckets and don't have a group yet.
 *  4. The new groups are appended to `ir.groups` and a repair-history entry
 *     is added so the source of the grouping is auditable.
 */
export function inferSemanticGroups(ir: DiagramIR): InferSemanticGroupsResult {
    const explicitlyGroupedCount = ir.nodes.filter((n) => n.group && n.group.trim().length > 0).length;
    if (ir.nodes.length === 0 || explicitlyGroupedCount / ir.nodes.length >= 0.5) {
        return { ir, addedGroups: [], nodeAssignments: new Map() };
    }

    // Bucket ungrouped nodes by zone.
    const buckets = new Map<string, DiagramIRNode[]>();
    const assignments = new Map<string, string | undefined>();
    for (const node of ir.nodes) {
        if (node.group && node.group.trim().length > 0) {
            assignments.set(node.id, node.group.trim());
            continue;
        }
        const type = (node.semanticType ?? 'generic') as NodeSemanticType;
        const zone = SEMANTIC_TYPE_TO_ZONE[type];
        if (!zone) {
            assignments.set(node.id, undefined);
            continue;
        }
        const bucket = buckets.get(zone) ?? [];
        bucket.push(node);
        buckets.set(zone, bucket);
        assignments.set(node.id, zone);
    }

    // Reject buckets with only one node — singletons add visual noise.
    const meaningfulBuckets = Array.from(buckets.entries()).filter(([, nodes]) => nodes.length >= 2);
    if (meaningfulBuckets.length === 0) {
        return { ir, addedGroups: [], nodeAssignments: assignments };
    }

    const existingIds = new Set(ir.groups.map((g) => g.id));
    const newGroups: DiagramIRGroup[] = [];
    const addedGroups: string[] = [];

    for (const [zone, nodes] of meaningfulBuckets) {
        const slug = zone.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const baseId = `auto-${slug}`;
        let id = baseId;
        let counter = 1;
        while (existingIds.has(id)) {
            counter++;
            id = `${baseId}-${counter}`;
        }
        existingIds.add(id);
        newGroups.push({
            id,
            label: zone,
            nodeIds: nodes.map((n) => n.id),
            kind: ZONE_TO_BOUNDARY_KIND[zone] ?? 'cluster',
        });
        addedGroups.push(zone);
    }

    // Re-emit the nodes with the inferred `group` field set.
    const nodesByZone = new Map<string, string>();
    for (const g of newGroups) {
        for (const id of g.nodeIds) nodesByZone.set(id, g.label);
    }
    const repairedNodes: DiagramIRNode[] = ir.nodes.map((n) => {
        if (n.group && n.group.trim().length > 0) return n;
        const zone = nodesByZone.get(n.id);
        if (!zone) return n;
        return { ...n, group: zone };
    });

    const repairedIR: DiagramIR = {
        ...ir,
        nodes: repairedNodes,
        groups: [...ir.groups, ...newGroups],
        metadata: {
            ...ir.metadata,
            repairHistory: [
                ...(ir.metadata?.repairHistory ?? []),
                {
                    at: new Date().toISOString(),
                    reason: 'semantic-group-inference',
                    changes: addedGroups.map((g) => `grupo inferido: ${g}`),
                },
            ],
        },
    };

    return { ir: repairedIR, addedGroups, nodeAssignments: assignments };
}

/** Lookup helper exposed for tests and tooling. */
export function getSemanticZoneForType(type: NodeSemanticType | string): string | undefined {
    const candidate = type as NodeSemanticType;
    return SEMANTIC_TYPE_TO_ZONE[candidate];
}

/** Friendly label for the zone — falls back to the original category. */
export function getZoneLabel(zone: string): string {
    return zone;
}

// Surface the underlying type so consumers can lookup labels directly.
export { getNodeCategoryLabel };
