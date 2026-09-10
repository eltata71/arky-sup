/**
 * Architecture Knowledge Graph — freshness model.
 *
 * The persisted graph can drift out of sync with the project's artifacts.
 * Rather than maintaining a separate, fragile "stale" flag that some mutation
 * path could forget to set, freshness is *derived deterministically* from a
 * content signature of the build inputs:
 *
 *  - the build stamps the graph with the signature of the inputs it was built
 *    from (`ArchitectureGraph.sourceSignature`);
 *  - freshness is then a pure comparison between that stamp and the signature
 *    of the project's current state.
 *
 * This is self-healing: any change to an artifact's content, IR, objective,
 * key concepts, envelope, generation trace, type or representation — as well
 * as deletions, version restores and new versions — shifts the signature, so
 * the graph is reported `stale` without any explicit invalidation call. A
 * graph produced by an older code path (no signature) is conservatively
 * treated as `stale`. Every function here is pure and total — never throws.
 */

import type {
  ArchitectureGraph,
  ArchitectureGraphArtifactInput,
  ArchitectureGraphBuildInput,
} from './ArchitectureKnowledgeGraphTypes';

/** Whether the persisted graph still reflects the project's current state. */
export type ArchitectureGraphFreshness = 'current' | 'stale' | 'missing';

/** UI-facing presentation for a freshness value. */
export interface ArchitectureGraphFreshnessDescriptor {
  label: string;
  tone: 'success' | 'warning' | 'gray';
  description: string;
}

/* Field separators chosen so they never collide with real artifact content. */
const FIELD_SEP = '␟';
const RECORD_SEP = '␞';

/**
 * Deterministic 64-bit content hash (two interleaved FNV-1a-style passes).
 * Collisions are astronomically unlikely for change-detection; a false
 * "stale" merely triggers a harmless rebuild, and the hash is stable so a
 * false "current" cannot arise from the same inputs.
 */
const hashString = (value: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};

/** JSON-stringifies any value without ever throwing. */
const safeJson = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

/**
 * Serializes a generation trace for the signature, dropping the volatile
 * `lifecycle` / `persistence` fields: those mutate on every persistence
 * status update and would otherwise churn the graph to `stale` without any
 * change to the architectural knowledge it carries.
 */
const stableGenerationTrace = (trace: unknown): string => {
  if (!trace || typeof trace !== 'object') return safeJson(trace);
  const { lifecycle: _lifecycle, persistence: _persistence, ...rest } =
    trace as Record<string, unknown>;
  return safeJson(rest);
};

/** Canonical, order-independent signature fragment for a single artifact. */
const artifactSignaturePart = (artifact: ArchitectureGraphArtifactInput): string =>
  [
    artifact.id ?? '',
    artifact.name ?? '',
    artifact.type ?? '',
    artifact.representation ?? '',
    artifact.objective ?? '',
    safeJson(artifact.keyConcepts ?? []),
    artifact.content ?? '',
    safeJson(artifact.ir),
    safeJson(artifact.artifactEnvelope),
    stableGenerationTrace(artifact.generationTrace),
    safeJson(artifact.artifactMemory ?? []),
  ].join(FIELD_SEP);

/**
 * Computes the deterministic content signature of a graph build input. Two
 * inputs that would produce the same architectural knowledge yield the same
 * signature; any meaningful change yields a different one.
 *
 * Artifacts are sorted by id so reordering them (without editing them) does
 * not flip the graph to `stale`.
 */
export const computeArchitectureGraphSignature = (
  input: ArchitectureGraphBuildInput,
): string => {
  const artifacts = [...(input.artifacts ?? [])].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const parts: string[] = [
    input.projectId ?? '',
    input.projectName ?? '',
    input.projectDescription ?? '',
    safeJson(input.projectContext ?? []),
    safeJson(input.agentMemory ?? []),
    safeJson(input.initialCapture ?? []),
    safeJson(input.globalContext ?? []),
    `count=${artifacts.length}`,
    ...artifacts.map(artifactSignaturePart),
  ];
  return hashString(parts.join(RECORD_SEP));
};

/**
 * Resolves the freshness of a (possibly absent) graph against the signature
 * of the project's current state.
 *
 *  - `missing`  — there is no persisted graph;
 *  - `stale`    — the graph predates the current state (or carries no
 *                 signature, i.e. it was built by an older code path);
 *  - `current`  — the graph still reflects the current state.
 */
export const resolveArchitectureGraphFreshness = (
  graph: ArchitectureGraph | null | undefined,
  currentSignature: string,
): ArchitectureGraphFreshness => {
  if (!graph) return 'missing';
  if (!graph.sourceSignature) return 'stale';
  return graph.sourceSignature === currentSignature ? 'current' : 'stale';
};

/** Maps a freshness value to its localized, UI-facing presentation. */
export const describeArchitectureGraphFreshness = (
  freshness: ArchitectureGraphFreshness,
): ArchitectureGraphFreshnessDescriptor => {
  switch (freshness) {
    case 'current':
      return {
        label: 'Vigente',
        tone: 'success',
        description: 'El grafo refleja el estado actual de los artefactos del proyecto.',
      };
    case 'stale':
      return {
        label: 'Obsoleto',
        tone: 'warning',
        description:
          'Los artefactos cambiaron desde la última construcción del grafo. Se reconstruirá automáticamente o puedes recalcularlo ahora.',
      };
    default:
      return {
        label: 'No persistido',
        tone: 'gray',
        description: 'El proyecto aún no tiene un grafo de conocimiento persistido.',
      };
  }
};
