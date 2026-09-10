/**
 * Specs for the project-document size guard.
 *
 * The artifact path has had one since the persistence hardening work; the
 * project document never did, and it is the one that grew. The value here is
 * not the refusal — Firestore refuses too — but the *message*: "el proyecto es
 * demasiado grande" is not something a user can act on, while "el grafo de
 * arquitectura ocupa 780 KB" tells them exactly what to prune.
 */

import { describe, expect, it } from 'vitest';
import {
  FIRESTORE_DOC_SAFE_BUDGET_BYTES,
  PersistenceValidationError,
  assertProjectDocumentFits,
  measureProjectDocument,
} from '../../lib/artifactPersistenceGuards';

const filler = (bytes: number) => 'x'.repeat(bytes);

describe('measureProjectDocument', () => {
  it('accepts an ordinary project', () => {
    const report = measureProjectDocument({ id: 'p1', name: 'Proyecto', description: 'corto' });
    expect(report.withinBudget).toBe(true);
    expect(report.largestFields).toEqual([]);
  });

  it('names only the unbounded fields that are actually present', () => {
    const report = measureProjectDocument({
      name: 'Proyecto',
      architectureKnowledgeGraph: { entities: [filler(500)] },
    });
    expect(report.largestFields.map((f) => f.field)).toEqual(['architectureKnowledgeGraph']);
  });

  it('orders them largest first, so the message names the real culprit', () => {
    const report = measureProjectDocument({
      architectureKnowledgeGraph: { entities: [filler(200)] },
      publicationPackages: [filler(5_000)],
      agentMemoryEntries: [filler(50)],
    });
    expect(report.largestFields[0].field).toBe('publicationPackages');
    expect(report.largestFields[report.largestFields.length - 1].field).toBe('agentMemoryEntries');
  });

  it('ignores a field that is absent or null rather than reporting it at zero', () => {
    const report = measureProjectDocument({ name: 'x', publicationPackages: null });
    expect(report.largestFields).toEqual([]);
  });
});

describe('assertProjectDocumentFits', () => {
  it('returns the measurement for a document within budget', () => {
    const report = assertProjectDocumentFits({ id: 'p1', name: 'Proyecto' }, 'p1');
    expect(report.withinBudget).toBe(true);
  });

  it('throws a validation error that names the project and the guilty field', () => {
    const oversized = {
      id: 'p1',
      name: 'Proyecto',
      architectureKnowledgeGraph: { entities: [filler(FIRESTORE_DOC_SAFE_BUDGET_BYTES + 1_000)] },
    };

    expect(() => assertProjectDocumentFits(oversized, 'p1')).toThrow(PersistenceValidationError);
    try {
      assertProjectDocumentFits(oversized, 'p1');
    } catch (error) {
      const failure = error as PersistenceValidationError;
      expect(failure.message).toContain('p1');
      expect(failure.message).toContain('el grafo de arquitectura');
      // `invalid-argument` is what maps the failure to `'validation-error'`
      // rather than to an opaque remote failure.
      expect(failure.code).toBe('invalid-argument');
      expect(failure.sizeBytes).toBeGreaterThan(FIRESTORE_DOC_SAFE_BUDGET_BYTES);
    }
  });

  it('still refuses, without naming a field, when the bulk is elsewhere', () => {
    // No unbounded field is set, so there is nothing specific to blame — but
    // silently accepting a document Firestore will reject is not an option.
    expect(() => assertProjectDocumentFits(
      { id: 'p1', description: filler(FIRESTORE_DOC_SAFE_BUDGET_BYTES + 1_000) },
      'p1',
    )).toThrow(/supera el límite seguro/);
  });
});
