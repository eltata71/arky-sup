/**
 * What a manual edit on the canvas writes to the artifact (plan de diagramas, 8.1a).
 *
 * The canvas is the one place a person changes a diagram by hand —dragging,
 * deleting, connecting, renaming— and until 8.1a its write was composed from
 * **what the screen showed**: the IR was rebuilt from the canvas nodes and
 * the text rewritten with `irToMermaid`. Both were wrong for the same reason.
 * The canvas shows a *projection* (the executive view groups nodes, the
 * technical one hides undescribed leaves) and a *rendering* (a sequence
 * diagram drawn as boxes): a drag in the executive view deleted everything
 * that view hides, and a drag in any sequence, ERD or state diagram saved it
 * as a flowchart. The bench measured both (8.0: 57 nodes lost, 26 % of the
 * diagrams converted).
 *
 * The rule now is the one every other change already follows: **a change
 * applies to the model, never to what the screen shows.**
 *
 * - The edit starts from the full stored IR (`resolveEditableDiagramIR`).
 * - What the person did is the *difference* between the canvas before and
 *   after the edit, translated into semantic patch operations — so a removal
 *   cascades exactly as it does for a patch, and an edge pointing at a node
 *   that exists only in the projection is rejected rather than saved.
 * - Positions are applied apart, because the patch vocabulary refuses
 *   geometry on purpose: they are the person's own layout, not a model's.
 *   Only nodes of the stored model take one; the projection's synthetic
 *   nodes have nowhere to keep it.
 * - The text is rewritten only when the model changed, and only in a dialect
 *   that can hold the IR (`rewriteDiagramContent`). Moving a node never
 *   touches the text. A structural change in a sequence or an ERD lives in
 *   the IR and the result says the text was kept, so the screen can say so.
 */
import type { Edge, Node } from 'reactflow';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR, DiagramPatchOperation } from '../../../lib/diagram';
import { applySemanticPatch, resolveEditableDiagramIR, toDiagramIR } from '../../diagram';
import { rewriteDiagramContent } from './diagramContentRewrite';

/** A canvas state: content nodes (group zones are ignored) and edges. */
export interface CanvasEditFlow {
    nodes: Node[];
    edges: Edge[];
}

export interface CanvasEdit {
    /** What the canvas showed before the edit. */
    before: CanvasEditFlow;
    /** What it shows after. */
    after: CanvasEditFlow;
}

export interface CanvasEditPlan {
    /** The write; `null` when the edit changed nothing the model keeps. */
    patch: Partial<Artifact> | null;
    /** Operations the model refused, in the engine's words. */
    rejected: string[];
    /**
     * The model changed and its text could not follow: the dialect cannot be
     * written from the IR. One Spanish sentence for the person.
     */
    notice: string | null;
}

type ArtifactForEdit = Pick<Artifact, 'type' | 'content' | 'representation' | 'ir'>;

/** Node fields the canvas lets a person change. */
const NODE_FIELDS = ['label', 'description', 'kind', 'technology', 'shape'] as const;
/** Edge fields the canvas lets a person change. */
const EDGE_FIELDS = ['label', 'relation', 'protocol'] as const;

const contentNodes = (flow: CanvasEditFlow) => flow.nodes.filter((n) => n.type !== 'groupZone');

const sameValue = (a: unknown, b: unknown): boolean =>
    (a ?? '') === (b ?? '');

export function planCanvasEdit(artifact: ArtifactForEdit, edit: CanvasEdit): CanvasEditPlan {
    const base = resolveEditableDiagramIR(artifact);
    if (!base) {
        // Nothing stored to edit: the canvas is all there is.
        const ir = withPositions(toDiagramIR(contentNodes(edit.after), edit.after.edges), edit);
        return { patch: { ir }, rejected: [], notice: null };
    }

    const operations = diffCanvas(base, edit);
    const result = operations.length > 0
        ? applySemanticPatch(base, { id: 'canvas-edit', source: 'user', operations })
        : { ir: base, applied: [], rejected: [], changed: false };
    const ir = withPositions(result.ir, edit);
    const rejected = result.rejected.map((r) => r.message);

    const moved = ir !== result.ir;
    if (!result.changed && !moved) return { patch: null, rejected, notice: null };

    const patch: Partial<Artifact> = { ir };
    let notice: string | null = null;
    if (result.changed && artifact.representation !== 'document') {
        const rewrite = rewriteDiagramContent(artifact.content, ir, artifact.type, artifact.representation === 'hybrid');
        if (rewrite.rewritten) patch.content = rewrite.content;
        else notice = `El cambio se guardó en el modelo del diagrama; el texto ${rewrite.dialect || 'Mermaid'} se conserva como estaba porque reescribirlo desde el modelo perdería parte de lo que dice.`;
    }
    return { patch, rejected, notice };
}

/** The person's edit, as operations on the stored model. */
function diffCanvas(base: DiagramIR, edit: CanvasEdit): DiagramPatchOperation[] {
    const baseNodes = new Map(base.nodes.map((n) => [n.id, n] as const));
    const baseEdges = new Map(base.edges.map((e) => [e.id, e] as const));
    const beforeIR = toDiagramIR(contentNodes(edit.before), edit.before.edges);
    const afterIR = toDiagramIR(contentNodes(edit.after), edit.after.edges);
    const before = new Map(beforeIR.nodes.map((n) => [n.id, n] as const));
    const after = new Map(afterIR.nodes.map((n) => [n.id, n] as const));
    const beforeEdges = new Map(beforeIR.edges.map((e) => [e.id, e] as const));
    const afterEdges = new Map(afterIR.edges.map((e) => [e.id, e] as const));
    const operations: DiagramPatchOperation[] = [];

    for (const id of before.keys()) {
        if (!after.has(id) && baseNodes.has(id)) operations.push({ op: 'remove-node', nodeId: id });
    }
    for (const [id, node] of after) {
        if (!before.has(id) && !baseNodes.has(id)) {
            const { position: _position, ...rest } = node;
            operations.push({ op: 'add-node', node: rest });
            continue;
        }
        const prior = before.get(id);
        if (!prior || !baseNodes.has(id)) continue;
        const changes: Record<string, unknown> = {};
        for (const field of NODE_FIELDS) {
            if (!sameValue(prior[field], node[field])) changes[field] = node[field];
        }
        if (Object.keys(changes).length > 0) operations.push({ op: 'update-node', nodeId: id, changes });
    }

    // Removals first: a reconnection is the old edge removed and a new one added.
    for (const id of beforeEdges.keys()) {
        if (!afterEdges.has(id) && baseEdges.has(id)) operations.push({ op: 'remove-edge', edgeId: id });
    }
    for (const [id, edge] of afterEdges) {
        const prior = beforeEdges.get(id);
        if (!prior) {
            if (!baseEdges.has(id)) operations.push({ op: 'add-edge', edge });
            continue;
        }
        if (!baseEdges.has(id)) continue;
        const changes: Record<string, unknown> = {};
        for (const field of EDGE_FIELDS) {
            if (!sameValue(prior[field], edge[field])) changes[field] = edge[field];
        }
        if (Object.keys(changes).length > 0) operations.push({ op: 'update-edge', edgeId: id, changes });
    }
    return operations;
}

/**
 * The canvas geometry, kept on the stored nodes — only when the person moved
 * or placed something: an automatic layout has no positions to compare against, and
 * writing its coordinates on every edit would freeze it. When a node moved,
 * the whole visible geometry is kept, as the canvas has always done.
 *
 * Manual layout is switched on only when every node of the model has a place:
 * the executive view shows a projection, and a layout half made of its
 * positions would scatter the rest. Returns the same object when nothing moved.
 */
function withPositions(ir: DiagramIR, edit: CanvasEdit): DiagramIR {
    const placed = (flow: CanvasEditFlow) => new Map(contentNodes(flow)
        .filter((n) => Number.isFinite(n.position?.x) && Number.isFinite(n.position?.y))
        // Rounded like the canvas has always stored them (`toDiagramIR`).
        .map((n) => [String(n.id), { x: Math.round(n.position.x), y: Math.round(n.position.y) }] as const));
    const before = placed(edit.before);
    const after = placed(edit.after);
    const somethingMoved = [...after].some(([id, p]) => {
        const prior = before.get(id);
        // A node the person just placed counts as moved: its place is theirs.
        return !prior || prior.x !== p.x || prior.y !== p.y;
    });
    if (!somethingMoved) return ir;
    let moved = false;
    const nextNodes = ir.nodes.map((node) => {
        const position = after.get(node.id);
        if (!position || (node.position?.x === position.x && node.position?.y === position.y)) return node;
        moved = true;
        return { ...node, position };
    });
    if (!moved) return ir;
    const everyNodePlaced = nextNodes.every((n) => Number.isFinite(n.position?.x) && Number.isFinite(n.position?.y));
    return {
        ...ir,
        nodes: nextNodes,
        metadata: everyNodePlaced ? { ...(ir.metadata ?? {}), layoutMode: 'manual' } : ir.metadata,
    };
}
