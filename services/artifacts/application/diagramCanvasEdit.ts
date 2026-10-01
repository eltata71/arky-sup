/**
 * What a manual edit on the canvas writes to the artifact (plan de diagramas, 8.0b).
 *
 * The canvas is the one place a person changes a diagram by hand —dragging a
 * node, deleting one— and the write it causes used to be composed inside
 * `useDiagramRendering`, where only a rendered React tree could reach it. It
 * lives here so the evaluation bench can measure it the way it measures a
 * generation: the same function the screen calls, over plain values.
 *
 * This file was moved as-is. What it writes is exactly what the hook wrote,
 * defects included —the text rewritten as a flowchart for any non-C4 Mermaid
 * type, and the IR rebuilt from what the screen shows— because 8.0 measures
 * before 8.1 changes anything.
 */
import type { Edge, Node } from 'reactflow';
import type { Artifact } from '../../../lib/artifacts';
import { irToMermaid, mergeIRMetadata, toDiagramIR } from '../../diagram';

/** The canvas state after the edit: content nodes (no group zones) and edges. */
export interface CanvasEditFlow {
    nodes: Node[];
    edges: Edge[];
}

export function planCanvasEdit(
    artifact: Pick<Artifact, 'type' | 'representation' | 'ir'>,
    flow: CanvasEditFlow,
): Partial<Artifact> {
    // Round-trip preservation: the canvas does not surface every semantic
    // field (narrative, audience, layoutPlan, group.kind, compliance, …), so
    // the fresh IR is merged over the persisted one.
    const fresh = toDiagramIR(flow.nodes, flow.edges);
    const ir = mergeIRMetadata(fresh, artifact.ir);
    // The edit snapshotted the canvas geometry: from now on the persisted
    // positions drive the layout (until an explicit re-layout).
    ir.metadata = { ...(ir.metadata ?? {}), layoutMode: 'manual' };
    const patch: Partial<Artifact> = { ir };
    const isC4 = artifact.type.startsWith('mermaid-c4-');
    if (artifact.type.startsWith('mermaid') && !isC4 && artifact.representation === 'diagram') {
        patch.content = irToMermaid(ir);
    }
    return patch;
}
