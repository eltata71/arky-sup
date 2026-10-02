/**
 * What a repair wrote on its own, and what was there before (plan de
 * diagramas, 8.4a).
 *
 * The quality rubric used to pay for whatever the repair passes filled in —
 * a theme, an audience, a synthesised description, a verb on a bare edge, a
 * group by role — so repairing a diagram raised its score without anyone
 * improving it: 80 points across the evaluation corpus from the structural
 * repair that runs on every generation, 263 from «Auto-mejora».
 *
 * A repair records each change here, with the value before and the value it
 * wrote. The rubric scores the diagram with those changes reverted. A change
 * is reverted only while the current value is still the one the repair
 * wrote: once a person edits it, it is theirs, and it counts.
 */
import type { DiagramIRGroup } from './DiagramIRTypes';

/** A value the repair replaced: what it was, and what the repair wrote. */
export interface DerivedChange<T> {
  before: T;
  after: T;
}

export interface DiagramDerivedContent {
  /** Diagram-level metadata the repair filled (`audience`, `title`, `theme`, `density`, `generatedAt`). */
  fields?: Record<string, DerivedChange<unknown>>;
  nodeLabels?: Record<string, DerivedChange<string>>;
  nodeDescriptions?: Record<string, DerivedChange<string>>;
  /** A kind the repair overwrote. Classifying a role on read is not recorded: that is reading. */
  nodeKinds?: Record<string, DerivedChange<string>>;
  edgeLabels?: Record<string, DerivedChange<string>>;
  edgeProtocols?: Record<string, DerivedChange<string>>;
  edgeRelations?: Record<string, DerivedChange<string>>;
  edgeTargets?: Record<string, DerivedChange<string>>;
  /** Nodes and edges the repair inserted. */
  addedNodes?: string[];
  addedEdges?: string[];
  /** The grouping the repair replaced, and the ids of the groups it wrote. */
  groups?: { before: DiagramIRGroup[]; after: string[] };
}
