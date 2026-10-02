/**
 * Recording what a repair wrote on its own, and scoring without it (plan de
 * diagramas, 8.4a). See `lib/diagram/derivedContent.ts`.
 *
 * The repair passes call `noteDerived*` as they change a value; the quality
 * analysis scores `withoutDerived(ir)`. Repairing a diagram therefore cannot
 * raise its score by what it filled in — only by what it fixed: an edge to a
 * node that does not exist is removed, and that removal is not reverted.
 *
 * A kind the repair overwrote is recorded; classifying a role on read is
 * not — the analysis classifies every diagram it judges, which is reading.
 */
import type { DerivedChange, DiagramDerivedContent, DiagramIR, DiagramIREdge, DiagramIRNode } from '../../../lib/diagram';

type ChangeMap = 'nodeLabels' | 'nodeDescriptions' | 'nodeKinds' | 'edgeLabels' | 'edgeProtocols' | 'edgeRelations' | 'edgeTargets';

/** The record on `ir`, copied first: the metadata object may be shared with the caller's IR. */
const derivedOf = (ir: DiagramIR): DiagramDerivedContent => {
    const derived: DiagramDerivedContent = { ...(ir.metadata?.derived ?? {}) };
    ir.metadata = { ...(ir.metadata ?? {}), derived };
    return derived;
};

/**
 * Records that a repair changed `id`'s value in `map` from `before` to
 * `after`. The first `before` wins: a second pass that changes its own
 * value again still reverts to what the diagram had.
 */
export function noteDerived(ir: DiagramIR, map: ChangeMap, id: string, before: string | undefined, after: string): void {
    if ((before ?? '') === after) return;
    const derived = derivedOf(ir);
    const changes = (derived[map] = { ...(derived[map] ?? {}) });
    changes[id] = { before: changes[id]?.before ?? before ?? '', after };
}

/** Records a diagram-level metadata field the repair filled. */
export function noteDerivedField(ir: DiagramIR, field: string, before: unknown, after: unknown): void {
    if (before === after) return;
    const derived = derivedOf(ir);
    const fields = (derived.fields = { ...(derived.fields ?? {}) });
    fields[field] = { before: field in fields ? fields[field].before : before ?? null, after };
}

/** Records nodes and edges a repair inserted. */
export function noteDerivedAdditions(ir: DiagramIR, additions: { nodes?: string[]; edges?: string[] }): void {
    const derived = derivedOf(ir);
    if (additions.nodes?.length) derived.addedNodes = [...new Set([...(derived.addedNodes ?? []), ...additions.nodes])];
    if (additions.edges?.length) derived.addedEdges = [...new Set([...(derived.addedEdges ?? []), ...additions.edges])];
}

/** Records that a repair replaced the grouping. The first grouping wins. */
export function noteDerivedGroups(ir: DiagramIR, before: DiagramIR['groups'], afterIds: string[]): void {
    const derived = derivedOf(ir);
    derived.groups = { before: derived.groups?.before ?? before.map((g) => ({ ...g, nodeIds: [...g.nodeIds] })), after: afterIds };
}

const revert = <T extends DiagramIRNode | DiagramIREdge, K extends keyof T & string>(
    item: T,
    field: K,
    change: DerivedChange<string> | undefined,
): T => (change && item[field] === change.after ? { ...item, [field]: change.before } : item);

const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

/**
 * The diagram as it would be without what the repair wrote on its own. A
 * value someone changed after the repair is kept: it is no longer derived.
 * A narrative marked `derived` is dropped too — the repair composed it.
 */
export function withoutDerived(ir: DiagramIR): DiagramIR {
    const derived = ir.metadata?.derived;
    const narrative = ir.metadata?.narrative;
    const derivedNarrative = typeof narrative === 'object' && narrative !== null && narrative.source === 'derived';
    if (!derived && !derivedNarrative) return ir;

    const addedNodes = new Set(derived?.addedNodes ?? []);
    const addedEdges = new Set(derived?.addedEdges ?? []);
    const nodes = ir.nodes
        .filter((n) => !addedNodes.has(n.id))
        .map((n) => {
            const node = revert(n, 'label', derived?.nodeLabels?.[n.id]);
            const described = revert(node, 'description', derived?.nodeDescriptions?.[n.id]);
            return revert(described, 'kind', derived?.nodeKinds?.[n.id]);
        });
    const kept = new Set(nodes.map((n) => n.id));
    const edges = ir.edges
        .filter((e) => !addedEdges.has(e.id))
        .map((e) => {
            let edge = revert(e, 'label', derived?.edgeLabels?.[e.id]);
            edge = revert(edge, 'protocol', derived?.edgeProtocols?.[e.id]);
            edge = revert(edge, 'relation', derived?.edgeRelations?.[e.id]);
            return revert(edge, 'target', derived?.edgeTargets?.[e.id]);
        })
        .filter((e) => kept.has(e.source) && kept.has(e.target))
        .map((e) => ({
            ...e,
            ...(e.protocol === '' ? { protocol: undefined } : {}),
            ...((e.relation as string | undefined) === '' ? { relation: undefined } : {}),
        }));
    const groups = derived?.groups && sameIds(ir.groups.map((g) => g.id), derived.groups.after)
        ? derived.groups.before
        : ir.groups;

    const metadata: NonNullable<DiagramIR['metadata']> = { ...(ir.metadata ?? {}) };
    for (const [field, change] of Object.entries(derived?.fields ?? {})) {
        const key = field as keyof typeof metadata;
        if (metadata[key] !== change.after) continue;
        if (change.before === null || change.before === undefined) delete metadata[key];
        else (metadata as Record<string, unknown>)[key] = change.before;
    }
    if (derivedNarrative) delete metadata.narrative;
    return {
        ...ir,
        nodes,
        edges,
        groups: groups.map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => kept.has(id)) })).filter((g) => g.nodeIds.length > 0),
        metadata,
    };
}
