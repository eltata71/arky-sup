/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but a local draft is a `localStorage` write — that is the
 * whole subject.
 *
 * What this locks in is the half of degradation that keeps getting dropped.
 * Keeping the user's data when a write does not reach Firestore is the easy
 * part and everyone does it; reporting that it is *only* here is the part
 * `trainingService` skipped for eleven methods, which is how a trainer could
 * author a course, see it saved, and have it exist in one browser. So the
 * assertion that matters most below is the dullest one: `success` is `false`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../firebase', () => ({ db: {}, auth: {}, isFirebaseAvailable: true }));
vi.mock('../../../services/observability', () => ({
  observabilityService: { recordWarning: vi.fn(), reportError: vi.fn(), trackEvent: vi.fn() },
}));

const { createFailureResult, draftKey, readLocal, writeLocalDraft } = await import(
  '../../../services/persistence'
);

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a local draft is not a saved document', () => {
  it('reports the write as unsuccessful, however well it went locally', () => {
    const result = writeLocalDraft('project.p-1', { name: 'Siniestros' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('offline');
    expect(result.target).toBe('local-draft');
    expect(result.message).toContain('pendiente de sincronizar');
  });

  it('keeps the value, so the work is not lost', () => {
    writeLocalDraft('project.p-1', { name: 'Siniestros' });

    const stored = JSON.parse(localStorage.getItem(draftKey('project.p-1')) ?? '{}');
    expect(stored.value).toEqual({ name: 'Siniestros' });
    expect(stored.status).toBe('pending-sync');
    expect(typeof stored.at).toBe('string');
  });

  it('namespaces the key, so a draft is recognisable in a storage inspector', () => {
    expect(draftKey('settings')).toBe('arky.offlineDraft.settings');
  });

  it('classifies a storage failure rather than throwing into the caller', () => {
    // Private browsing and a full quota both surface as a throwing setItem.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const result = writeLocalDraft('project.p-1', { name: 'Siniestros' });

    expect(result.success).toBe(false);
    // `createOperationId` slugifies the name; the point is that the operation is identifiable.
    expect(result.operationId).toContain('localdraft-project-p-1');
    expect(result.message).toContain('QuotaExceededError');
  });
});

describe('reading back what a previous session left', () => {
  it('returns the value', () => {
    localStorage.setItem('k', JSON.stringify({ a: 1 }));
    expect(readLocal<{ a: number }>('k')).toEqual({ a: 1 });
  });

  it('treats absent and unreadable as the same answer', () => {
    expect(readLocal('missing')).toBeNull();
    localStorage.setItem('corrupt', '{ not json');
    expect(readLocal('corrupt')).toBeNull();
  });
});

describe('a failure classified without going through executeRemoteWrite', () => {
  it('carries the provider code, so the caller can tell retry from call-an-admin', () => {
    const error = new Error('Missing or insufficient permissions.') as Error & { code: string };
    error.code = 'permission-denied';

    const result = createFailureResult('saveCourse', error);

    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
    expect(result.errorCode).toBe('permission-denied');
    expect(result.target).toBe('firestore');
    expect(result.message).toBe('Missing or insufficient permissions.');
  });

  it('survives something that is not an Error', () => {
    const result = createFailureResult('saveCourse', 'a string was thrown');

    expect(result.success).toBe(false);
    expect(result.message).toBe('a string was thrown');
  });
});
