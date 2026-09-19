/**
 * ContextGraphSerializer — turns an `ArchitectureContextGraph` into a stable,
 * JSON-safe representation and back.
 *
 * The graph is already plain data (no `Date`, `Map` or class instances), so
 * serialization is mostly validation + Firestore hygiene:
 *  - `serialize` / `deserialize` cover string round-trips,
 *  - `toFirestore` strips `undefined` (Firestore rejects it) so the graph is
 *    ready to persist under a future `contextGraphs` collection without
 *    touching the current `Project` model.
 */

import {
  CONTEXT_GRAPH_SCHEMA_VERSION,
  type ArchitectureContextGraph,
} from './contextGraphTypes';

/** JSON-safe persisted shape. Identical to the in-memory graph by design. */
export type SerializedContextGraph = ArchitectureContextGraph;

const REQUIRED_ARRAYS = ['sources', 'signals', 'entities', 'relationships', 'conflicts'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Recursively drop `undefined` values — Firestore rejects them. */
const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      out[key] = stripUndefined(val);
    }
    return out as T;
  }
  return value;
};

export class ContextGraphSerializer {
  /** Validate the shape of a graph-like object. Throws on malformed input. */
  validate(value: unknown): asserts value is ArchitectureContextGraph {
    if (!isRecord(value)) {
      throw new Error('ContextGraphSerializer: graph is not an object.');
    }
    if (typeof value.projectId !== 'string') {
      throw new Error('ContextGraphSerializer: missing projectId.');
    }
    for (const key of REQUIRED_ARRAYS) {
      if (!Array.isArray(value[key])) {
        throw new Error(`ContextGraphSerializer: "${key}" must be an array.`);
      }
    }
    if (!isRecord(value.stats)) {
      throw new Error('ContextGraphSerializer: missing stats.');
    }
  }

  /** Serialize to a JSON string. */
  serialize(graph: ArchitectureContextGraph): string {
    return JSON.stringify(this.toFirestore(graph));
  }

  /** Parse a JSON string back into a validated graph. */
  deserialize(json: string): ArchitectureContextGraph {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      // El SyntaxError original dice en qué posición se rompió el JSON, que es
      // lo único accionable cuando un grafo almacenado llega corrupto.
      throw new Error('ContextGraphSerializer: invalid JSON.', { cause: error });
    }
    this.validate(parsed);
    return parsed;
  }

  /** Produce a Firestore-safe plain object (no `undefined` values). */
  toFirestore(graph: ArchitectureContextGraph): SerializedContextGraph {
    this.validate(graph);
    return stripUndefined({
      ...graph,
      schemaVersion: graph.schemaVersion ?? CONTEXT_GRAPH_SCHEMA_VERSION,
    });
  }

  /** Rehydrate a graph from a persisted Firestore document. */
  fromFirestore(document: unknown): ArchitectureContextGraph {
    this.validate(document);
    return document;
  }
}

export const contextGraphSerializer = new ContextGraphSerializer();
