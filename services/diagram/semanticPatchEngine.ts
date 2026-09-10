/**
 * Apply a semantic patch to a DiagramIR — checked first, cascades reported,
 * never partially broken.
 *
 * Three properties this engine exists to guarantee, and each of them is a
 * failure mode the "regenerate the whole artifact" approach hid rather than
 * solved:
 *
 *  - **An operation is checked before it is applied.** An id that does not
 *    exist, a second node claiming an id that does, an edge to nowhere: each
 *    comes back as a `PatchRejection` naming the operation and the reason. The
 *    alternative — apply what parses and hope — is how a model's plausible
 *    JSON becomes a diagram with edges into thin air.
 *  - **The result is always a valid IR.** Removing a node removes the edges
 *    that used it and the group memberships that named it, because leaving
 *    them is leaving the exact dangling references the lint rules exist to
 *    catch. Every one of those is listed in `cascaded`: a deletion the user
 *    did not ask for is one they get told about.
 *  - **A patch that changes nothing says so.** `changed: false` and the
 *    original object, so a caller can skip a version, a re-layout and a write.
 *
 * Pure and synchronous. Nothing here calls a model — validating a reference is
 * something an algorithm does reliably, and spending a call on it is the trade
 * this codebase refuses everywhere else.
 *
 * What it deliberately does **not** do: positions, colours, sizes. Those come
 * from the layout engine and the design system, and `DiagramPatchOperation`
 * has no way to express them on purpose.
 */

import type {
    DiagramCallout,
    DiagramIR,
    DiagramIREdge,
    DiagramIRGroup,
    DiagramIRNode,
    DiagramPatch,
    DiagramPatchOperation,
    DiagramPatchResult,
    PatchApplication,
    PatchRejection,
} from '../../lib/diagram';

interface Draft {
    nodes: DiagramIRNode[];
    edges: DiagramIREdge[];
    groups: DiagramIRGroup[];
    callouts: DiagramCallout[];
    metadata: NonNullable<DiagramIR['metadata']>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readCallouts = (ir: DiagramIR): DiagramCallout[] => {
    const narrative = ir.metadata?.narrative;
    if (!narrative || typeof narrative === 'string') return [];
    return [...(narrative.callouts ?? [])];
};

const toDraft = (ir: DiagramIR): Draft => ({
    nodes: ir.nodes.map(node => ({ ...node })),
    edges: ir.edges.map(edge => ({ ...edge })),
    groups: ir.groups.map(group => ({ ...group, nodeIds: [...group.nodeIds] })),
    callouts: readCallouts(ir),
    metadata: { ...(ir.metadata ?? {}) },
});

const fromDraft = (ir: DiagramIR, draft: Draft): DiagramIR => {
    const previous = draft.metadata.narrative;
    const narrative = typeof previous === 'string'
        ? { summary: previous, callouts: draft.callouts }
        : { ...(previous ?? {}), callouts: draft.callouts };
    return {
        ...ir,
        nodes: draft.nodes,
        edges: draft.edges,
        groups: draft.groups,
        metadata: {
            ...draft.metadata,
            // A narrative with no callouts left keeps its other halves; an IR
            // that never had one does not grow an empty object just because a
            // patch touched something else.
            ...(draft.callouts.length > 0 || previous ? { narrative } : {}),
        },
    };
};

/**
 * Drop everything that referenced a node, and say what was dropped. Called on
 * every node removal — the caller does not get to decide whether the model
 * stays consistent.
 */
const cascadeNodeRemoval = (draft: Draft, nodeId: string): string[] => {
    const cascaded: string[] = [];

    const orphanedEdges = draft.edges.filter(edge => edge.source === nodeId || edge.target === nodeId);
    if (orphanedEdges.length > 0) {
        draft.edges = draft.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId);
        cascaded.push(`${orphanedEdges.length} conexión(es) eliminadas: ${orphanedEdges.map(edge => edge.id).join(', ')}.`);
    }

    const touchedGroups = draft.groups.filter(group => group.nodeIds.includes(nodeId));
    if (touchedGroups.length > 0) {
        draft.groups = draft.groups
            .map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => id !== nodeId) }))
            .filter(group => group.nodeIds.length > 0);
        const emptied = touchedGroups.filter(group => group.nodeIds.length === 1);
        cascaded.push(`Retirado de ${touchedGroups.length} agrupación(es).`);
        if (emptied.length > 0) {
            cascaded.push(`${emptied.length} agrupación(es) quedaron vacías y se eliminaron.`);
        }
    }

    const orphanedCallouts = draft.callouts.filter(callout => callout.targetId === nodeId);
    if (orphanedCallouts.length > 0) {
        draft.callouts = draft.callouts.filter(callout => callout.targetId !== nodeId);
        cascaded.push(`${orphanedCallouts.length} anotación(es) sin destino eliminadas.`);
    }

    return cascaded;
};

const applyOne = (
    draft: Draft,
    operation: DiagramPatchOperation,
    index: number,
): PatchApplication | PatchRejection => {
    const reject = (code: PatchRejection['code'], message: string): PatchRejection =>
        ({ index, op: operation.op, code, message });
    const done = (description: string, cascaded?: string[]): PatchApplication =>
        ({ index, op: operation.op, description, ...(cascaded?.length ? { cascaded } : {}) });

    switch (operation.op) {
        case 'add-node': {
            const id = text(operation.node?.id);
            if (!id || !text(operation.node?.label)) return reject('invalid-shape', 'Un nodo necesita id y label.');
            if (draft.nodes.some(node => node.id === id)) return reject('duplicate-id', `Ya existe un nodo con id "${id}".`);
            draft.nodes.push({ ...operation.node, id });
            return done(`Nodo "${operation.node.label}" añadido.`);
        }

        case 'remove-node': {
            const index_ = draft.nodes.findIndex(node => node.id === operation.nodeId);
            if (index_ < 0) return reject('unknown-node', `No existe el nodo "${operation.nodeId}".`);
            if (draft.nodes.length === 1) return reject('empty-result', 'Un diagrama no puede quedarse sin nodos.');
            const [removed] = draft.nodes.splice(index_, 1);
            return done(`Nodo "${removed.label}" eliminado.`, cascadeNodeRemoval(draft, operation.nodeId));
        }

        case 'update-node': {
            const node = draft.nodes.find(candidate => candidate.id === operation.nodeId);
            if (!node) return reject('unknown-node', `No existe el nodo "${operation.nodeId}".`);
            const changes = operation.changes ?? {};
            const keys = Object.keys(changes) as Array<keyof typeof changes>;
            if (keys.length === 0) return reject('no-effect', 'La operación no declara ningún cambio.');
            Object.assign(node, changes);
            return done(`Nodo "${node.label}" actualizado (${keys.join(', ')}).`);
        }

        case 'add-edge': {
            const edge = operation.edge;
            const id = text(edge?.id);
            if (!id || !text(edge?.source) || !text(edge?.target)) {
                return reject('invalid-shape', 'Una conexión necesita id, source y target.');
            }
            if (draft.edges.some(candidate => candidate.id === id)) {
                return reject('duplicate-id', `Ya existe una conexión con id "${id}".`);
            }
            const known = new Set(draft.nodes.map(node => node.id));
            if (!known.has(edge.source)) return reject('unknown-node', `El origen "${edge.source}" no existe.`);
            if (!known.has(edge.target)) return reject('unknown-node', `El destino "${edge.target}" no existe.`);
            draft.edges.push({ ...edge, id, label: edge.label ?? '' });
            return done(`Conexión ${edge.source} → ${edge.target} añadida.`);
        }

        case 'remove-edge': {
            const index_ = draft.edges.findIndex(edge => edge.id === operation.edgeId);
            if (index_ < 0) return reject('unknown-edge', `No existe la conexión "${operation.edgeId}".`);
            const [removed] = draft.edges.splice(index_, 1);
            const orphanedCallouts = draft.callouts.filter(callout => callout.targetId === operation.edgeId);
            if (orphanedCallouts.length > 0) {
                draft.callouts = draft.callouts.filter(callout => callout.targetId !== operation.edgeId);
            }
            return done(
                `Conexión ${removed.source} → ${removed.target} eliminada.`,
                orphanedCallouts.length > 0 ? [`${orphanedCallouts.length} anotación(es) sin destino eliminadas.`] : undefined,
            );
        }

        case 'update-edge': {
            const edge = draft.edges.find(candidate => candidate.id === operation.edgeId);
            if (!edge) return reject('unknown-edge', `No existe la conexión "${operation.edgeId}".`);
            const changes = operation.changes ?? {};
            const keys = Object.keys(changes) as Array<keyof typeof changes>;
            if (keys.length === 0) return reject('no-effect', 'La operación no declara ningún cambio.');
            Object.assign(edge, changes);
            return done(`Conexión "${operation.edgeId}" actualizada (${keys.join(', ')}).`);
        }

        case 'group-nodes': {
            const group = operation.group;
            const id = text(group?.id);
            if (!id || !text(group?.label)) return reject('invalid-shape', 'Una agrupación necesita id y label.');
            if (draft.groups.some(candidate => candidate.id === id)) {
                return reject('duplicate-id', `Ya existe una agrupación con id "${id}".`);
            }
            const known = new Set(draft.nodes.map(node => node.id));
            const members = (group.nodeIds ?? []).filter(nodeId => known.has(nodeId));
            if (members.length === 0) return reject('unknown-node', 'Ninguno de los nodos de la agrupación existe.');
            const dropped = (group.nodeIds ?? []).length - members.length;
            draft.groups.push({ ...group, id, nodeIds: members });
            return done(
                `Agrupación "${group.label}" creada con ${members.length} nodo(s).`,
                dropped > 0 ? [`${dropped} id(s) inexistentes descartados.`] : undefined,
            );
        }

        case 'ungroup': {
            const index_ = draft.groups.findIndex(group => group.id === operation.groupId);
            if (index_ < 0) return reject('unknown-group', `No existe la agrupación "${operation.groupId}".`);
            const [removed] = draft.groups.splice(index_, 1);
            return done(`Agrupación "${removed.label}" deshecha; sus ${removed.nodeIds.length} nodo(s) siguen en el diagrama.`);
        }

        case 'add-to-group': {
            const group = draft.groups.find(candidate => candidate.id === operation.groupId);
            if (!group) return reject('unknown-group', `No existe la agrupación "${operation.groupId}".`);
            const known = new Set(draft.nodes.map(node => node.id));
            const added = (operation.nodeIds ?? []).filter(id => known.has(id) && !group.nodeIds.includes(id));
            if (added.length === 0) return reject('no-effect', 'Ningún nodo nuevo que añadir a la agrupación.');
            group.nodeIds.push(...added);
            return done(`${added.length} nodo(s) añadidos a "${group.label}".`);
        }

        case 'remove-from-group': {
            const group = draft.groups.find(candidate => candidate.id === operation.groupId);
            if (!group) return reject('unknown-group', `No existe la agrupación "${operation.groupId}".`);
            const removed = (operation.nodeIds ?? []).filter(id => group.nodeIds.includes(id));
            if (removed.length === 0) return reject('no-effect', 'Ninguno de esos nodos está en la agrupación.');
            group.nodeIds = group.nodeIds.filter(id => !removed.includes(id));
            if (group.nodeIds.length === 0) {
                draft.groups = draft.groups.filter(candidate => candidate.id !== group.id);
                return done(`${removed.length} nodo(s) retirados de "${group.label}".`, ['La agrupación quedó vacía y se eliminó.']);
            }
            return done(`${removed.length} nodo(s) retirados de "${group.label}".`);
        }

        case 'add-callout': {
            const callout = operation.callout;
            const id = text(callout?.id);
            if (!id || !text(callout?.text)) return reject('invalid-shape', 'Una anotación necesita id y texto.');
            if (draft.callouts.some(candidate => candidate.id === id)) {
                return reject('duplicate-id', `Ya existe una anotación con id "${id}".`);
            }
            const isNode = draft.nodes.some(node => node.id === callout.targetId);
            const isEdge = draft.edges.some(edge => edge.id === callout.targetId);
            if (!isNode && !isEdge) {
                return reject('unknown-node', `La anotación apunta a "${callout.targetId}", que no existe.`);
            }
            draft.callouts.push({ ...callout, id, targetKind: callout.targetKind ?? (isNode ? 'node' : 'edge') });
            return done(`Anotación añadida sobre "${callout.targetId}".`);
        }

        case 'remove-callout': {
            const index_ = draft.callouts.findIndex(callout => callout.id === operation.calloutId);
            if (index_ < 0) return reject('unknown-callout', `No existe la anotación "${operation.calloutId}".`);
            draft.callouts.splice(index_, 1);
            return done('Anotación eliminada.');
        }

        case 'set-layout-hint': {
            const { direction, density } = operation;
            if (!direction && !density) return reject('no-effect', 'La operación no declara dirección ni densidad.');
            const previous = draft.metadata.layoutPlan;
            if (previous?.direction === (direction ?? previous?.direction)
                && previous?.density === (density ?? previous?.density)
                && previous?.userOverride === true) {
                return reject('no-effect', 'El layout ya está en esa configuración.');
            }
            draft.metadata.layoutPlan = {
                backend: previous?.backend ?? 'elk',
                algorithm: previous?.algorithm,
                orthogonal: previous?.orthogonal ?? true,
                rationale: previous?.rationale,
                ...previous,
                direction: direction ?? previous?.direction,
                density: density ?? previous?.density,
                // A hint from a patch is a preference the selector must not
                // silently revert on its next pass — the same marker the
                // deterministic suggestion actions already set.
                userOverride: true,
                computedAt: new Date().toISOString(),
            };
            return done(`Layout ajustado (${[direction, density].filter(Boolean).join(', ')}).`);
        }

        default: {
            // Unreachable for a well-typed patch; reachable for one that came
            // off the wire. Rejected rather than ignored — silently dropping an
            // operation reports success for a change that never happened.
            const unknown = operation as { op?: string };
            return reject('invalid-shape', `Operación no soportada: "${unknown.op ?? 'sin nombre'}".`);
        }
    }
};

const isRejection = (value: PatchApplication | PatchRejection): value is PatchRejection =>
    'code' in value;

/**
 * Apply a patch. Valid operations are applied in order; invalid ones are
 * rejected individually and reported, so one bad reference in a model's
 * proposal does not throw away the nine good changes beside it.
 */
export function applySemanticPatch(ir: DiagramIR, patch: DiagramPatch): DiagramPatchResult {
    const operations = Array.isArray(patch?.operations) ? patch.operations : [];
    if (operations.length === 0) {
        return { ir, applied: [], rejected: [], changed: false };
    }

    const draft = toDraft(ir);
    const applied: PatchApplication[] = [];
    const rejected: PatchRejection[] = [];

    operations.forEach((operation, index) => {
        const outcome = applyOne(draft, operation, index);
        if (isRejection(outcome)) rejected.push(outcome);
        else applied.push(outcome);
    });

    if (applied.length === 0) {
        return { ir, applied, rejected, changed: false };
    }
    return { ir: fromDraft(ir, draft), applied, rejected, changed: true };
}

/**
 * What the patch would do, without doing it — the preview a person reads
 * before authorising a model's change.
 *
 * It is the same code path as the real application, run against a copy, so the
 * preview cannot describe one thing and the apply do another. A preview
 * assembled from the operations' own words would drift from the engine the
 * first time a cascade changed.
 */
export function describeSemanticPatch(ir: DiagramIR, patch: DiagramPatch): {
    applied: PatchApplication[];
    rejected: PatchRejection[];
    changed: boolean;
} {
    const { applied, rejected, changed } = applySemanticPatch(ir, patch);
    return { applied, rejected, changed };
}
