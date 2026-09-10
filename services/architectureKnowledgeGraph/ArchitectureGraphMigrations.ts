/**
 * Schema migrations for the Architecture Knowledge Graph (Task 6 / Task 11).
 *
 * Persisted graphs may predate the current schema. Migrations are applied as
 * a forward-only chain: each step upgrades a graph by exactly one version.
 * Migration is non-destructive and always routed through runtime validation,
 * so a corrupt or partial legacy graph degrades gracefully instead of
 * crashing a render.
 */

import type { ArchitectureGraph } from './ArchitectureKnowledgeGraphTypes';
import { ARCHITECTURE_GRAPH_SCHEMA_VERSION } from './ArchitectureKnowledgeGraphTypes';
import { validateArchitectureGraph } from './ArchitectureGraphRuntimeValidation';

/** A single forward migration step (`from` → `from + 1`). */
type MigrationStep = (graph: ArchitectureGraph) => ArchitectureGraph;

/**
 * Ordered migration steps keyed by the version they upgrade *from*.
 * Empty today (schema v1 is the first persisted shape); future schema bumps
 * register a step here.
 */
const MIGRATION_STEPS: Record<number, MigrationStep> = {};

/** Whether a raw persisted graph needs migration or revalidation. */
export const needsMigration = (input: unknown): boolean => {
  if (!input || typeof input !== 'object') return false;
  const version = (input as { version?: unknown }).version;
  return typeof version !== 'number' || version < ARCHITECTURE_GRAPH_SCHEMA_VERSION;
};

/**
 * Migrates and validates a persisted graph to the current schema version.
 * Returns `null` when the input is unsalvageable — callers then rebuild.
 */
export const migrateArchitectureGraph = (input: unknown): ArchitectureGraph | null => {
  const validated = validateArchitectureGraph(input);
  if (!validated.value) return null;

  let graph = validated.value;
  let guard = 0;
  while (graph.version < ARCHITECTURE_GRAPH_SCHEMA_VERSION && guard < 50) {
    const step = MIGRATION_STEPS[graph.version];
    if (!step) {
      // No registered step — fast-forward the version marker; the shape is
      // already normalized by runtime validation above.
      graph = { ...graph, version: graph.version + 1 };
    } else {
      graph = { ...step(graph), version: graph.version + 1 };
    }
    guard += 1;
  }

  if (graph.version > ARCHITECTURE_GRAPH_SCHEMA_VERSION) {
    // A newer persisted graph — clamp the marker but keep the data.
    graph = { ...graph, version: ARCHITECTURE_GRAPH_SCHEMA_VERSION };
  }
  return graph;
};
