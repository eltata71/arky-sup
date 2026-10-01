/** Historical context captured by the prompt composers, never rebuilt by the UI. */
export interface ContextManifestSource {
  id: string;
  label: string;
  /** Absent when the source port does not expose a revision. */
  revision?: number;
}

/** A `[ctx:*]` tag as the pack that numbered it defined it (7.5b). */
export interface ContextManifestCitation {
  tag: string;
  label: string;
  entityType: string;
  /** Labels of the sources the entity was extracted from. */
  sources: string[];
}

export interface ContextManifestRecord {
  label: string;
  profile?: string;
  sources: ContextManifestSource[];
  sections: Array<{
    scope: string;
    items: Array<{ text: string; sourceId?: string; truncated?: boolean }>;
  }>;
  omitted: Array<{ scope: string; count: number; reason: string }>;
  /** Present when the record numbered context the model was asked to cite. */
  citations?: ContextManifestCitation[];
}

export interface ContextManifest {
  version: 1;
  capturedAt: string;
  /** Includes the initial generation and any recorded refinement context. */
  records: ContextManifestRecord[];
}

/** Each capture and read is detached from live settings and project objects. */
export function createContextManifestRecorder(capturedAt: string) {
  const records: ContextManifestRecord[] = [];
  const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    capture: (record: ContextManifestRecord): void => { records.push(snapshot(record)); },
    manifest: (): ContextManifest | undefined => records.length
      ? { version: 1, capturedAt, records: snapshot(records) }
      : undefined,
  };
}
