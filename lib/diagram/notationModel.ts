/**
 * What a dialect says that boxes and arrows cannot (plan de diagramas, 8.3b).
 *
 * The IR is a graph: nodes, edges, groups. A sequence diagram is also an
 * *order* of messages with `alt`/`loop` fragments, notes and activations; an
 * ERD carries each entity's attributes and each relation's cardinality; a
 * state diagram has composite states, pseudostates and descriptions. Until
 * 8.3b the parser read the graph and dropped the rest, so the text was the
 * only place those things lived and nothing could rewrite it without losing
 * them.
 *
 * `DiagramIR.notation` keeps them, **by reference**: every entry points at a
 * node or edge id that already exists in the IR, never at a copied label. A
 * reference that no longer resolves (a patch removed the node) is skipped by
 * the serializer, never resurrected.
 *
 * `unsupported` is the safety half. It lists the statements the reader could
 * not represent (`box`, `create participant`, `classDef`…). While it is not
 * empty the IR does not hold the whole text, and nothing may rewrite that
 * text from the IR: the caller keeps the original.
 *
 * Optional and additive: an IR without it is exactly the IR of before.
 */
import type { ArchimateElementType, ArchimateRelationType } from '../archimate/archimateMetamodel';


export type SequenceArrow = '->>' | '-->>' | '->' | '-->' | '-)' | '--)' | '-x' | '--x';

export type SequenceFragmentKind = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break' | 'rect';

export type SequenceStep =
  | {
      kind: 'message';
      /** The IR edge that carries the message's endpoints and text. */
      edgeId: string;
      arrow: SequenceArrow;
      /** `+` activates the target, `-` deactivates the source (`A->>+B`). */
      activation?: '+' | '-';
    }
  | {
      kind: 'note';
      placement: 'left of' | 'right of' | 'over';
      /** Node ids — one, or two for `over A,B`. */
      participants: string[];
      text: string;
    }
  | { kind: 'activate' | 'deactivate'; participant: string }
  | {
      kind: 'fragment';
      fragment: SequenceFragmentKind;
      /**
       * The first branch is the fragment itself (`alt <label>`); the rest are
       * `else` (alt), `and` (par) or `option` (critical). Other fragments
       * have one branch.
       */
      branches: Array<{ label: string; steps: SequenceStep[] }>;
    };

export interface SequenceNotation {
  dialect: 'sequence';
  autonumber?: boolean;
  /** Declared with `actor` rather than `participant`. */
  actors: string[];
  steps: SequenceStep[];
  unsupported: string[];
}

export type ErdCardinality = '||' | '|o' | 'o|' | '}o' | 'o{' | '}|' | '|{';

export interface ErdAttribute {
  type: string;
  name: string;
  keys?: Array<'PK' | 'FK' | 'UK'>;
  comment?: string;
}

export interface ErdRelation {
  /** Cardinality at the source end, as written (`||`, `}o`…). */
  left: ErdCardinality;
  right: ErdCardinality;
  /** `--` (identifying) or `..` (non-identifying). */
  identifying: boolean;
  /** The relation's verb, without the cardinality the canvas label adds. */
  label: string;
}

export interface ErdNotation {
  dialect: 'erd';
  /** Attributes by entity (node) id, in their written order. */
  attributes: Record<string, ErdAttribute[]>;
  /** Cardinality by edge id. */
  relations: Record<string, ErdRelation>;
  unsupported: string[];
}

export interface StateNote {
  placement: 'left of' | 'right of';
  stateId: string;
  text: string;
}

export interface StateNotation {
  dialect: 'state';
  /** `stateDiagram` or `stateDiagram-v2`, as written. */
  header: 'stateDiagram' | 'stateDiagram-v2';
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Composite states in written order; a child may itself be composite. */
  composites: Array<{ id: string; childIds: string[] }>;
  /** The composite each edge was written inside; absent means top level. */
  edgeScopes: Record<string, string>;
  pseudostates: Record<string, 'choice' | 'fork' | 'join'>;
  /** Transitions written without a label (the IR gives every edge one). */
  unlabeledEdges: string[];
  notes: StateNote[];
  unsupported: string[];
}

export interface ArchimateNotation {
  dialect: 'archimate';
  /** The viewpoint the diagram was drawn for (`layered`, `capability`…). */
  viewpoint: string;
  /** ArchiMate element type by node id. */
  elements: Record<string, ArchimateElementType>;
  /** Relation type and written text by edge id. */
  relations: Record<string, { type: ArchimateRelationType; text: string }>;
  unsupported: string[];
}

export type DiagramNotation = SequenceNotation | ErdNotation | StateNotation | ArchimateNotation;
