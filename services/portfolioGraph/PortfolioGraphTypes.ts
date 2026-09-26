/**
 * The portfolio as a keyed graph.
 *
 * Four levels, three edges, and every edge is an **id**:
 *
 * ```
 * BusinessInitiative.id
 *   ←── Project.initiativeIds[]
 *          ←── OfficeEngagement.projectId
 *                 ←── OfficeTask.producedArtifactId → Artifact.id
 * ```
 *
 * Two of those edges were already keys. The first one was a list of
 * hand-typed `NEG-YYYY-NNN` codes, which is why this module exists: a code can
 * be misspelled, can name an initiative nobody created, and survives a rename
 * without complaining. An id either resolves or is reported as broken — and
 * being able to *report* it is the point. Silently dropping a bad reference is
 * how a portfolio quietly loses work.
 *
 * Every node carries the resolved objects, so a caller walks the hierarchy by
 * following references rather than by re-matching strings at each level.
 */

import type { ArtifactSummary } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { BusinessInitiative } from '../businessInitiatives/domain';
import type { OfficeEngagement, OfficeTask } from '../architectureOffice/domain/OfficeTypes';

/** The four levels, outermost first. Mirrors `EaLevel` in `lib/eaTerminology`. */
export type PortfolioLevel = 'initiative' | 'attention' | 'deliverable' | 'artifact';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface ArtifactNode {
  level: 'artifact';
  id: string;
  name: string;
  /**
   * The artifact's identity, not its body.
   *
   * A portfolio answers "what exists and how does it connect", and it answers
   * it for every project at once. Typing this as the full `Artifact` obliged
   * the resolver's callers to have loaded every document in the account before
   * a single node could be built — which is exactly what app startup did. A
   * full `Artifact` still satisfies this shape, so a hydrated project loses
   * nothing.
   */
  artifact: ArtifactSummary;
  /** The deliverable whose task produced it, when one did. */
  deliverableId?: string;
  attentionId: string;
}

export interface DeliverableNode {
  level: 'deliverable';
  id: string;
  name: string;
  engagement: OfficeEngagement;
  /** Its project. Always present — `projectId` has always been a real key. */
  attentionId: string;
  /** Initiatives it serves, resolved. May be empty. */
  initiativeIds: string[];
  artifacts: ArtifactNode[];
}

export interface AttentionNode {
  level: 'attention';
  id: string;
  name: string;
  project: Project;
  /** Resolved initiative ids — after migration from codes where needed. */
  initiativeIds: string[];
  deliverables: DeliverableNode[];
  /** Latest version of each artifact in the project. */
  artifacts: ArtifactNode[];
}

export interface InitiativeNode {
  level: 'initiative';
  id: string;
  name: string;
  initiative: BusinessInitiative;
  attentions: AttentionNode[];
}

export type PortfolioNode = InitiativeNode | AttentionNode | DeliverableNode | ArtifactNode;

// ---------------------------------------------------------------------------
// Referential integrity
// ---------------------------------------------------------------------------

export type LinkIssueKind =
  /** A project or deliverable points at an initiative id that does not exist. */
  | 'dangling-initiative'
  /** A code was recorded that matches no registered initiative. */
  | 'unresolved-code'
  /** A deliverable points at a project that does not exist. */
  | 'dangling-attention'
  /** An attention answers no initiative at all. */
  | 'orphan-attention';

export interface LinkIssue {
  kind: LinkIssueKind;
  /** Level of the record that carries the broken reference. */
  level: PortfolioLevel;
  /** Id of that record. */
  sourceId: string;
  /** Name of that record, for the message the user reads. */
  sourceName: string;
  /** The reference that could not be resolved, when there is one. */
  reference?: string;
  /** One Spanish sentence saying what is wrong and what it costs. */
  message: string;
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export interface PortfolioGraph {
  initiatives: InitiativeNode[];
  attentions: AttentionNode[];
  deliverables: DeliverableNode[];
  artifacts: ArtifactNode[];
  /** Attentions that answer no initiative — real work with no stated reason. */
  unlinkedAttentions: AttentionNode[];
  /** Everything that does not resolve, so the UI can say so instead of hiding it. */
  issues: LinkIssue[];
  /** Lookup by id, across every level. */
  byId: ReadonlyMap<string, PortfolioNode>;
}

/** Where a node sits in the hierarchy, outermost first. Powers breadcrumbs. */
export interface PortfolioPath {
  initiative?: InitiativeNode;
  attention?: AttentionNode;
  deliverable?: DeliverableNode;
  artifact?: ArtifactNode;
}

export const isInitiativeNode = (node: PortfolioNode): node is InitiativeNode =>
  node.level === 'initiative';
export const isAttentionNode = (node: PortfolioNode): node is AttentionNode =>
  node.level === 'attention';
export const isDeliverableNode = (node: PortfolioNode): node is DeliverableNode =>
  node.level === 'deliverable';
export const isArtifactNode = (node: PortfolioNode): node is ArtifactNode =>
  node.level === 'artifact';

export type { OfficeTask };
