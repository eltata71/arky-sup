import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../types';
import {
  FIRESTORE_DOC_HARD_LIMIT_BYTES,
  MAX_INLINE_ARTIFACT_BYTES,
  PRUNABLE_ARTIFACT_FIELDS,
  PersistenceValidationError,
  estimateBytes,
  prepareArtifactForFirestore,
  prepareArtifactUpdateForFirestore,
} from '../../lib/artifactPersistenceGuards';

const baseArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  versionGroupId: 'artifact-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Modelo de Proceso',
  type: 'mermaid-c4-context',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# contenido',
  objective: 'Documentar el proceso',
  keyConcepts: [{ term: 'BPMN', definition: 'Notación de procesos' }],
  representation: 'hybrid',
  ...overrides,
});

const filler = (bytes: number): string => 'x'.repeat(Math.max(0, bytes));

describe('estimateBytes', () => {
  it('returns 4 for null', () => {
    expect(estimateBytes(null)).toBe(4);
  });

  it('measures the JSON encoding of objects', () => {
    expect(estimateBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });
});

describe('prepareArtifactForFirestore', () => {
  it('returns a sanitized document with storageMode "firestore" for small artifacts', () => {
    const prepared = prepareArtifactForFirestore(baseArtifact());
    expect(prepared.storageMode).toBe('firestore');
    expect(prepared.prunedFields).toEqual([]);
    expect(prepared.document.storageMode).toBe('firestore');
    expect(prepared.document.id).toBe('artifact-1');
    expect(prepared.sizeBytes).toBeLessThan(MAX_INLINE_ARTIFACT_BYTES);
  });

  it('marks the document as external-required when above the inline budget but still inline-writable', () => {
    const heavyContent = filler(MAX_INLINE_ARTIFACT_BYTES + 50_000);
    const prepared = prepareArtifactForFirestore(baseArtifact({ content: heavyContent }));
    expect(prepared.storageMode).toBe('external-required');
    expect(prepared.document.storageMode).toBe('external-required');
    expect(prepared.prunedFields).toEqual([]);
  });

  it('drops ephemeral fields (rawResponse first) when the document exceeds the safe budget', () => {
    const prepared = prepareArtifactForFirestore(baseArtifact({
      rawResponse: filler(700_000),
      content: filler(250_000),
    }));
    expect(prepared.prunedFields).toContain('rawResponse');
    expect(prepared.document.rawResponse).toBeUndefined();
    expect(prepared.document.content).toBe(filler(250_000));
    expect(prepared.sizeBytes).toBeLessThan(FIRESTORE_DOC_HARD_LIMIT_BYTES);
  });

  it('preserves every non-ephemeral field after pruning', () => {
    const artifact = baseArtifact({
      rawResponse: filler(900_000),
      ir: {
        nodes: [{ id: 'n1', kind: 'system', label: 'Sistema' }],
        edges: [],
        groups: [],
        metadata: { title: 'Vista 1' },
      } as unknown as Artifact['ir'],
      keyConcepts: [{ term: 'A', definition: 'B' }],
      audience: 'technical',
    });
    const prepared = prepareArtifactForFirestore(artifact);
    expect(prepared.prunedFields).toContain('rawResponse');
    expect(prepared.document.rawResponse).toBeUndefined();
    expect(prepared.document.ir).toBeDefined();
    expect(prepared.document.keyConcepts).toEqual([{ term: 'A', definition: 'B' }]);
    expect(prepared.document.audience).toBe('technical');
    expect(prepared.document.name).toBe('Modelo de Proceso');
  });

  it('throws a PersistenceValidationError with an actionable Spanish message when even pruning is not enough', () => {
    const artifact = baseArtifact({ content: filler(FIRESTORE_DOC_HARD_LIMIT_BYTES + 100_000) });
    expect(() => prepareArtifactForFirestore(artifact)).toThrowError(PersistenceValidationError);
    try {
      prepareArtifactForFirestore(artifact);
    } catch (error) {
      const validationError = error as PersistenceValidationError;
      expect(validationError.code).toBe('invalid-argument');
      expect(validationError.userMessage).toMatch(/límite de Firestore/);
      expect(validationError.sizeBytes).toBeGreaterThan(FIRESTORE_DOC_HARD_LIMIT_BYTES);
    }
  });

  it('does not prune ephemeral fields when the document is comfortably under the budget', () => {
    const prepared = prepareArtifactForFirestore(baseArtifact({
      rawResponse: 'small raw response',
      generationTrace: {
        id: 'trace-1',
        source: 'on-demand',
        status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z',
        decisions: [],
        errors: [],
      },
    }));
    expect(prepared.prunedFields).toEqual([]);
    expect(prepared.document.rawResponse).toBe('small raw response');
    expect(prepared.document.generationTrace).toBeDefined();
  });
});

describe('prepareArtifactUpdateForFirestore', () => {
  it('returns a partial patch with refreshed storageMode when the merge fits comfortably', () => {
    const currentData = { ...baseArtifact(), updatedAt: '2026-01-01T00:00:00.000Z' } as unknown as Record<string, unknown>;
    const patch = { content: '# nuevo', updatedAt: '2026-01-02T00:00:00.000Z' };
    const prepared = prepareArtifactUpdateForFirestore(currentData, patch);
    expect(prepared.mode).toBe('partial');
    expect(prepared.prunedFields).toEqual([]);
    expect(prepared.document.content).toBe('# nuevo');
    expect(prepared.document.storageMode).toBe('firestore');
    expect((prepared.document as Record<string, unknown>).id).toBeUndefined();
  });

  it('switches to overwrite mode and prunes ephemeral fields when the merged document would exceed the budget', () => {
    // Existing remote doc carries a 200 KB `rawResponse`; the patch adds an
    // 800 KB content blob. Merged size ≈ 1 MB → pruning kicks in. After
    // pruning rawResponse, the document is ≈ 800 KB → still above the
    // inline budget (`MAX_INLINE_ARTIFACT_BYTES` = 650 KB) so `storageMode`
    // flips to `external-required` while staying under Firestore's 1 MiB
    // hard limit.
    const currentData = {
      ...baseArtifact(),
      rawResponse: filler(200_000),
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Record<string, unknown>;
    const patch = { content: filler(800_000), updatedAt: '2026-01-02T00:00:00.000Z' };
    const prepared = prepareArtifactUpdateForFirestore(currentData, patch);
    expect(prepared.mode).toBe('overwrite');
    expect(prepared.prunedFields).toContain('rawResponse');
    expect(prepared.document.rawResponse).toBeUndefined();
    expect(prepared.document.content).toBe(filler(800_000));
    expect(prepared.document.storageMode).toBe('external-required');
    expect(prepared.sizeBytes).toBeLessThan(FIRESTORE_DOC_HARD_LIMIT_BYTES);
  });

  it('keeps storageMode "firestore" after pruning when the remaining document fits inline', () => {
    const currentData = {
      ...baseArtifact(),
      rawResponse: filler(700_000),
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Record<string, unknown>;
    const patch = { content: filler(300_000), updatedAt: '2026-01-02T00:00:00.000Z' };
    const prepared = prepareArtifactUpdateForFirestore(currentData, patch);
    expect(prepared.mode).toBe('overwrite');
    expect(prepared.prunedFields).toContain('rawResponse');
    expect(prepared.document.storageMode).toBe('firestore');
  });

  it('propagates PersistenceValidationError when even the overwrite path would exceed the hard limit', () => {
    const currentData = baseArtifact() as unknown as Record<string, unknown>;
    const patch = { content: filler(FIRESTORE_DOC_HARD_LIMIT_BYTES + 100_000) };
    expect(() => prepareArtifactUpdateForFirestore(currentData, patch)).toThrowError(PersistenceValidationError);
  });

  it('always echoes storageMode in the partial patch even when the patch did not touch it', () => {
    const currentData = baseArtifact() as unknown as Record<string, unknown>;
    const patch = { reviewStatus: 'approved' };
    const prepared = prepareArtifactUpdateForFirestore(currentData, patch);
    expect(prepared.mode).toBe('partial');
    expect(prepared.document).toMatchObject({ reviewStatus: 'approved', storageMode: 'firestore' });
  });
});

describe('PRUNABLE_ARTIFACT_FIELDS ordering', () => {
  it('lists rawResponse first because it is the cheapest field to drop', () => {
    expect(PRUNABLE_ARTIFACT_FIELDS[0]).toBe('rawResponse');
  });

  it('drops generationTrace last because the trace has the highest support value', () => {
    expect(PRUNABLE_ARTIFACT_FIELDS[PRUNABLE_ARTIFACT_FIELDS.length - 1]).toBe('generationTrace');
  });
});
