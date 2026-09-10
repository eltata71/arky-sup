/**
 * Persistence adapter for the Architecture Knowledge Graph (Task 6).
 *
 * Strategy for this phase: the graph is stored **additively** on the project
 * document as `Project.architectureKnowledgeGraph`. This keeps every existing
 * project working untouched — legacy projects simply have no graph until the
 * first rebuild.
 *
 * The adapter is the single choke point for graph (de)serialization:
 *  - writes go through `sanitizeForFirestore` (Firestore rejects `undefined`);
 *  - reads go through migration + runtime validation, so a corrupt or older
 *    persisted graph degrades gracefully instead of crashing a render.
 *
 * A future migration to a dedicated subcollection
 * (`projects/{id}/knowledgeGraph/*`) only needs to change this file — see
 * {@link getKnowledgeGraphSubcollectionPath}.
 */

import type { Project } from '../../types';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import type { ArchitectureGraph } from './ArchitectureKnowledgeGraphTypes';
import { migrateArchitectureGraph } from './ArchitectureGraphMigrations';
import { reportGraphFailure } from './ArchitectureGraphObservability';

/** Project field that carries the persisted graph. */
export const ARCHITECTURE_GRAPH_PROJECT_FIELD = 'architectureKnowledgeGraph' as const;

/**
 * Future-facing subcollection layout. Not used while the graph lives on the
 * project document, but kept here so the migration path is explicit.
 */
export const getKnowledgeGraphSubcollectionPath = (
  projectId: string,
): { entities: string; relations: string } => ({
  entities: `projects/${projectId}/knowledgeGraph/entities`,
  relations: `projects/${projectId}/knowledgeGraph/relations`,
});

/**
 * Prepares a graph for persistence: drops `undefined` values that Firestore
 * rejects. Returns a plain, JSON-safe object.
 */
export const serializeArchitectureGraph = (graph: ArchitectureGraph): ArchitectureGraph =>
  sanitizeForFirestore(graph);

/**
 * Reads a persisted graph back into a validated, migrated `ArchitectureGraph`.
 * Returns `null` for absent or unrecoverable data — callers then rebuild.
 */
export const deserializeArchitectureGraph = (raw: unknown): ArchitectureGraph | null => {
  if (raw === undefined || raw === null) return null;
  try {
    return migrateArchitectureGraph(raw);
  } catch (error) {
    reportGraphFailure('graph.persistence.failed', error);
    return null;
  }
};

/** Reads + validates the graph attached to a project, if any. */
export const readGraphFromProject = (
  project: Pick<Project, 'architectureKnowledgeGraph'> | null | undefined,
): ArchitectureGraph | null => {
  if (!project) return null;
  return deserializeArchitectureGraph(project.architectureKnowledgeGraph);
};

/**
 * Returns a shallow copy of the project with the (serialized) graph attached.
 * Non-mutating — the caller persists the result through the normal project
 * update path so rollback and concurrency control are unchanged.
 */
export const attachGraphToProject = (project: Project, graph: ArchitectureGraph): Project => ({
  ...project,
  architectureKnowledgeGraph: serializeArchitectureGraph(graph),
});

/**
 * Builds the additive partial update payload for `updateProject`. Keeping the
 * payload tiny (a single field) means the existing optimistic-update +
 * rollback flow handles graph persistence without any special-casing.
 */
export const buildGraphUpdatePayload = (
  graph: ArchitectureGraph,
): { architectureKnowledgeGraph: ArchitectureGraph } => ({
  architectureKnowledgeGraph: serializeArchitectureGraph(graph),
});
