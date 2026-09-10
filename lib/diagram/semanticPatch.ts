/**
 * The semantic patch — a change to a diagram expressed as operations on its
 * model, rather than as a regenerated diagram.
 *
 * "Resalta únicamente el flujo de autorización" and "mueve esta integración al
 * dominio externo" are small, local edits. The only way to make either of them
 * was to regenerate the artifact: a fresh model call, new ids, a new layout,
 * and every manual adjustment the architect had made since — pinned positions,
 * renamed labels, curated groups — gone. A change of one word cost the whole
 * diagram, which is why nobody made small changes.
 *
 * An operation names what changes and what it changes it to, against ids that
 * already exist. That is what makes it checkable before anything is applied,
 * reversible after, and cheap enough that a model can propose one instead of
 * rewriting the artifact.
 *
 * **Nothing here decides geometry.** There is no `move-node` with coordinates
 * and no `set-colour`: position belongs to the layout engine and appearance to
 * the design system, and an operation that could set either would let a model
 * overrule both from inside a JSON payload. `set-layout-hint` is the closest
 * this gets, and it states an intent (a direction, a density) that the engine
 * is still free to satisfy however it lays out.
 *
 * Foundation layer, declarations only: the engine that applies these, the
 * schema that asks a model for one, and the UI that previews one all need the
 * same vocabulary.
 */

import type {
    DiagramCallout,
    DiagramIREdge,
    DiagramIRGroup,
    DiagramIRNode,
} from './DiagramIRTypes';

/** Node fields a patch may set. Identity and position are deliberately absent. */
export type DiagramNodePatchFields = Omit<DiagramIRNode, 'id' | 'position'>;

/** Edge fields a patch may set. Identity and endpoints are deliberately absent:
 *  re-pointing an edge is removing one and adding another, and saying so keeps
 *  the two ends of the change visible in the audit trail. */
export type DiagramEdgePatchFields = Omit<DiagramIREdge, 'id' | 'source' | 'target'>;

export type DiagramPatchOperation =
    | { op: 'add-node'; node: DiagramIRNode }
    | { op: 'remove-node'; nodeId: string }
    | { op: 'update-node'; nodeId: string; changes: Partial<DiagramNodePatchFields> }
    | { op: 'add-edge'; edge: DiagramIREdge }
    | { op: 'remove-edge'; edgeId: string }
    | { op: 'update-edge'; edgeId: string; changes: Partial<DiagramEdgePatchFields> }
    | { op: 'group-nodes'; group: DiagramIRGroup }
    | { op: 'ungroup'; groupId: string }
    | { op: 'add-to-group'; groupId: string; nodeIds: string[] }
    | { op: 'remove-from-group'; groupId: string; nodeIds: string[] }
    | { op: 'add-callout'; callout: DiagramCallout }
    | { op: 'remove-callout'; calloutId: string }
    | { op: 'set-layout-hint'; direction?: 'TB' | 'LR' | 'BT' | 'RL'; density?: 'compact' | 'normal' | 'spacious' };

export type DiagramPatchOperationKind = DiagramPatchOperation['op'];

export interface DiagramPatch {
    id: string;
    /** Who proposed it. A model's patch is previewed; a person's is theirs. */
    source: 'ai' | 'user';
    /** Why, in the proposer's own words. Shown in the preview and the trail. */
    rationale?: string;
    operations: DiagramPatchOperation[];
}

/** Why an operation could not be applied. Never a free-text string alone. */
export type PatchRejectionCode =
    | 'unknown-node'
    | 'unknown-edge'
    | 'unknown-group'
    | 'unknown-callout'
    | 'duplicate-id'
    | 'invalid-shape'
    | 'empty-result'
    | 'no-effect';

export interface PatchRejection {
    index: number;
    op: DiagramPatchOperationKind;
    code: PatchRejectionCode;
    message: string;
}

/** What an operation actually did, in the words a person reads in the trail. */
export interface PatchApplication {
    index: number;
    op: DiagramPatchOperationKind;
    description: string;
    /**
     * Changes the operation caused that nobody asked for — the edges that had
     * to go when their node did, the group membership that came with it.
     * Reported rather than performed quietly: a cascade the user cannot see is
     * a deletion they did not authorise.
     */
    cascaded?: string[];
}

export interface DiagramPatchResult {
    /** The IR after every valid operation. Unchanged when none applied. */
    ir: import('./DiagramIRTypes').DiagramIR;
    applied: PatchApplication[];
    rejected: PatchRejection[];
    /** True when at least one operation changed the model. */
    changed: boolean;
}
