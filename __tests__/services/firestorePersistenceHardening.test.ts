/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Project } from '../../types';

const batchSet = vi.fn();
const batchUpdate = vi.fn();
const batchDelete = vi.fn();
const batchCommit = vi.fn(async () => undefined);
const transactionSet = vi.fn();
const transactionUpdate = vi.fn();
const transactionDelete = vi.fn();

// `vi.mock` is hoisted above any top-level `const`, so the mock factory cannot
// close over module-scope variables directly. `vi.hoisted` lifts the mock spies
// alongside the factory call.
const { observabilityRecordWarning, observabilityReportError, observabilityTrackEvent } = vi.hoisted(() => ({
  observabilityRecordWarning: vi.fn(),
  observabilityReportError: vi.fn(),
  observabilityTrackEvent: vi.fn(() => ({ id: 'event-1', at: new Date().toISOString() })),
}));

vi.mock('../../firebase', () => ({
  db: {},
  auth: {},
  isFirebaseAvailable: true,
}));

vi.mock('../../services/observability', () => ({
  observabilityService: {
    recordWarning: observabilityRecordWarning,
    reportError: observabilityReportError,
    trackEvent: observabilityTrackEvent,
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  writeBatch: vi.fn(() => ({ set: batchSet, update: batchUpdate, delete: batchDelete, commit: batchCommit })),
  runTransaction: vi.fn(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => {
    const transaction = {
      get: vi.fn(async (ref: { path: string }) => {
        if (ref.path.includes('/artifacts/')) return { exists: () => false, data: () => ({}) };
        return { exists: () => true, data: () => ({ userId: 'user-1', artifactCount: 0, updatedAt: '2026-01-01T00:00:00.000Z' }) };
      }),
      set: transactionSet,
      update: transactionUpdate,
      delete: transactionDelete,
    };
    await callback(transaction);
  }),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(),
  limit: vi.fn(),
}));

import { clearProjectCache } from '../../services/architectureProjects/projectCache';
import { getAllProjects, getProject } from '../../services/architectureProjects/projectReads';
import { createProject, updateProject } from '../../services/architectureProjects/projectWrites';
import { createArtifact, updateArtifact } from '../../services/artifacts/artifactPersistence';


const containsUndefinedValue = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefinedValue);
  if (value && typeof value === 'object') return Object.values(value).some(containsUndefinedValue);
  return false;
};

const makeArtifact = (id: string): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: `Artifact ${id}`,
  type: 'markdown',
  phase: 'Design',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# Content',
  objective: 'Objective',
  keyConcepts: [],
  representation: 'document',
});

const makeProject = (artifacts: Artifact[] = []): Project & { userId: string } => ({
  id: 'project-1',
  userId: 'user-1',
  name: 'Project',
  description: 'Description',
  projectContext: ['ctx'],
  artifacts,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('project & artifact persistence hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batchSet.mockClear();
    batchUpdate.mockClear();
    batchDelete.mockClear();
    batchCommit.mockClear();
    transactionSet.mockClear();
    transactionUpdate.mockClear();
    transactionDelete.mockClear();
    observabilityRecordWarning.mockClear();
    observabilityReportError.mockClear();
    observabilityTrackEvent.mockClear();
    clearProjectCache();
  });

  it('rejects project creation without userId instead of creating phantom local data', async () => {
    const result = await createProject({ ...makeProject(), userId: undefined });
    expect(result.success).toBe(false);
    expect(result.status).toBe('validation-error');
    expect(result.errorCode).toBe('project/missing-user-id');
  });

  it('creates project metadata and artifact documents in the artifacts subcollection', async () => {
    const firestore = await import('firebase/firestore');
    const result = await createProject(makeProject([makeArtifact('artifact-1')]));
    expect(result.status).toBe('success');
    expect(firestore.writeBatch).toHaveBeenCalledOnce();

    // Asserted by path rather than by call index: the batch legitimately grew
    // when the artifact index was added, and a positional assertion would
    // report that as a regression while saying nothing about what matters —
    // which is that the artifacts are written to the subcollection and never
    // onto the project document.
    const written = new Map(
      batchSet.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data]),
    );
    expect(written.has('projects/project-1')).toBe(true);
    expect(JSON.stringify(written.get('projects/project-1'))).not.toContain('"artifacts"');
    expect(written.has('projects/project-1/artifacts/artifact-1')).toBe(true);
    expect(batchCommit).toHaveBeenCalledOnce();
  });

  it('filters invalid and duplicate NEG links before writing project metadata', async () => {
    await createProject({
      ...makeProject(),
      linkedBusinessProjects: ['NEG-2026-001', 'bad-id', 'neg-2026-001', 'NEG-2026-002'],
    });

    const persisted = batchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(persisted.linkedBusinessProjects).toEqual(['NEG-2026-001', 'NEG-2026-002']);
  });

  it('returns permission-denied explicitly and does not commit local fallback', async () => {
    const firestore = await import('firebase/firestore');
    (firestore.writeBatch as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      set: batchSet,
      update: batchUpdate,
      delete: batchDelete,
      commit: vi.fn(async () => {
        const error = new Error('rules rejected') as Error & { code: string };
        error.code = 'permission-denied';
        throw error;
      }),
    });
    const result = await createProject(makeProject());
    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
    expect(Object.keys(localStorage).some(key => key.includes('arky.offlineDraft'))).toBe(false);
  });

  it('writes a new artifact as a single subcollection document and updates project metadata', async () => {
    const result = await createArtifact('project-1', makeArtifact('artifact-2'), { userId: 'user-1' });
    expect(result.success).toBe(true);
    const firestore = await import('firebase/firestore');
    expect(firestore.runTransaction).toHaveBeenCalledOnce();
  });


  it('sanitizes undefined optional artifact fields before Firestore writes', async () => {
    const artifactWithUndefined = {
      ...makeArtifact('artifact-undefined'),
      coverImageUrl: undefined,
      generationTrace: {
        id: 'trace-1',
        source: 'catalog',
        status: 'clean',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: undefined,
        decisions: [
          {
            at: '2026-01-01T00:00:00.000Z',
            stage: 'prompt',
            status: 'success',
            message: 'started',
            detail: undefined,
          },
        ],
        errors: [],
        warnings: [undefined as unknown as string, 'visible warning'],
      },
    } satisfies Artifact;

    const result = await createArtifact('project-1', artifactWithUndefined, { userId: 'user-1' });

    expect(result.success).toBe(true);
    expect(transactionSet).toHaveBeenCalledOnce();
    const persisted = transactionSet.mock.calls[0][1] as Record<string, unknown>;
    expect(containsUndefinedValue(persisted)).toBe(false);
    expect(persisted.coverImageUrl).toBeUndefined();
    expect((persisted.generationTrace as { completedAt?: string }).completedAt).toBeUndefined();
    expect((persisted.generationTrace as { warnings: Array<string | null> }).warnings).toEqual([null, 'visible warning']);
  });

  describe('updateArtifact size guardrails', () => {
    const filler = (bytes: number): string => 'x'.repeat(Math.max(0, bytes));

    const mockArtifactSnapshot = async (artifactData: Record<string, unknown>) => {
      const firestore = await import('firebase/firestore');
      (firestore.runTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(async (
        _db: unknown,
        callback: (transaction: unknown) => Promise<void>,
      ) => {
        const transaction = {
          get: vi.fn(async (ref: { path: string }) => {
            if (ref.path.includes('/artifacts/')) {
              return { exists: () => true, data: () => artifactData };
            }
            return { exists: () => true, data: () => ({ userId: 'user-1', artifactCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' }) };
          }),
          set: transactionSet,
          update: transactionUpdate,
          delete: transactionDelete,
        };
        await callback(transaction);
      });
    };

    it('applies a partial update with refreshed storageMode for small patches', async () => {
      await mockArtifactSnapshot({ ...makeArtifact('artifact-update-1'), updatedAt: '2026-01-01T00:00:00.000Z' });

      const result = await updateArtifact('project-1', 'artifact-update-1', { content: '# nuevo' }, { userId: 'user-1' });

      expect(result.success).toBe(true);
      expect(transactionUpdate).toHaveBeenCalled();
      expect(transactionSet).not.toHaveBeenCalled();
      const patchArg = transactionUpdate.mock.calls.find((call) => (call[0] as { path: string }).path.includes('/artifacts/'))?.[1] as Record<string, unknown>;
      expect(patchArg).toBeDefined();
      expect(patchArg.content).toBe('# nuevo');
      expect(patchArg.storageMode).toBe('firestore');
      expect(observabilityRecordWarning).not.toHaveBeenCalled();
    });

    it('prunes ephemeral fields and switches to full overwrite when the merged document would exceed the safe budget', async () => {
      // Existing doc carries a 200 KB rawResponse; the patch adds 800 KB of
      // content. Merged ≈ 1 MB → pruning kicks in. After dropping
      // rawResponse the document is ≈ 800 KB so storageMode flips to
      // `external-required` while staying under Firestore's hard limit.
      const heavyExisting = {
        ...makeArtifact('artifact-update-heavy'),
        rawResponse: filler(200_000),
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await mockArtifactSnapshot(heavyExisting);

      const patch: Partial<Artifact> = { content: filler(800_000) };
      const result = await updateArtifact('project-1', 'artifact-update-heavy', patch, { userId: 'user-1' });

      expect(result.success).toBe(true);
      expect(transactionSet).toHaveBeenCalled();
      const setCall = transactionSet.mock.calls.find((call) => (call[0] as { path: string }).path.includes('/artifacts/'));
      expect(setCall).toBeDefined();
      const persisted = setCall![1] as Record<string, unknown>;
      expect(persisted.rawResponse).toBeUndefined();
      expect(persisted.content).toBe(filler(800_000));
      expect(persisted.storageMode).toBe('external-required');
      expect(observabilityRecordWarning).toHaveBeenCalledOnce();
      const warning = observabilityRecordWarning.mock.calls[0][0] as Record<string, unknown>;
      expect(warning.title).toBe('Artefacto recortado antes de persistir');
      expect(warning.operationName).toBe('updateArtifact');
      expect((warning.metadata as Record<string, unknown>).prunedFields).toContain('rawResponse');
    });

    it('returns a validation-error with an actionable Spanish message when even pruning cannot fit the document', async () => {
      await mockArtifactSnapshot({ ...makeArtifact('artifact-update-huge'), updatedAt: '2026-01-01T00:00:00.000Z' });

      const oversizedPatch: Partial<Artifact> = { content: filler(1_200_000) };
      const result = await updateArtifact('project-1', 'artifact-update-huge', oversizedPatch, { userId: 'user-1' });

      expect(result.success).toBe(false);
      expect(result.status).toBe('validation-error');
      expect(result.errorCode).toBe('invalid-argument');
      expect(result.message).toMatch(/límite de Firestore/);
      expect(transactionSet).not.toHaveBeenCalled();
      expect(transactionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('updateArtifact race vs. createArtifact', () => {
    // The most common observable failure is the layoutPlan persistence
    // fired by `useDiagramRendering` immediately after `createArtifact`:
    // the create transaction is still propagating to Firestore when
    // `updateArtifact` issues `transaction.get(artifactRef)` and gets
    // `!exists()`. These tests pin down the transparent retry so the
    // user never sees the spurious banner again, and so a genuine
    // missing-artifact surfaces an actionable Spanish message via
    // `userMessage` instead of the generic "no se pudo guardar".

    const queueMissingThenPresent = async (missingAttempts: number, presentArtifactData: Record<string, unknown>) => {
      const firestore = await import('firebase/firestore');
      let invocation = 0;
      (firestore.runTransaction as ReturnType<typeof vi.fn>).mockImplementation(async (
        _db: unknown,
        callback: (transaction: unknown) => Promise<void>,
      ) => {
        const currentInvocation = invocation;
        invocation += 1;
        const transaction = {
          get: vi.fn(async (ref: { path: string }) => {
            if (ref.path.includes('/artifacts/')) {
              if (currentInvocation < missingAttempts) {
                return { exists: () => false, data: () => ({}) };
              }
              return { exists: () => true, data: () => presentArtifactData };
            }
            return { exists: () => true, data: () => ({ userId: 'user-1', artifactCount: 1, updatedAt: '2026-01-01T00:00:00.000Z' }) };
          }),
          set: transactionSet,
          update: transactionUpdate,
          delete: transactionDelete,
        };
        await callback(transaction);
      });
    };

    it('retries transparently when the artifact is not yet visible and succeeds on a later attempt', async () => {
      const presentArtifact = { ...makeArtifact('artifact-race'), updatedAt: '2026-01-01T00:00:00.000Z' };
      // First two transactions see !exists() (propagation race), third one sees the artifact.
      await queueMissingThenPresent(2, presentArtifact);

      const result = await updateArtifact('project-1', 'artifact-race', { ir: { nodes: [], edges: [], groups: [], metadata: { title: 'Vista 1' } } as unknown as Artifact['ir'] }, { userId: 'user-1' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('success');
      // The successful path runs `transaction.update` for both the artifact and the project document.
      expect(transactionUpdate).toHaveBeenCalled();
      // The internal `recordWarning` should be the race-retry telemetry, not the size-pruning one.
      const racingWarning = observabilityRecordWarning.mock.calls.find((call) => (call[0] as { title?: string }).title === 'updateArtifact resolvió tras reintento');
      expect(racingWarning).toBeDefined();
      expect(((racingWarning as unknown[])[0] as { metadata: Record<string, unknown> }).metadata.raceRetryAttempts).toBe(2);
    });

    it('surfaces an actionable Spanish message via userMessage when the artifact is still missing after all retries', async () => {
      // Every attempt sees !exists() — genuine missing artifact (or hopeless race).
      await queueMissingThenPresent(99, { ...makeArtifact('artifact-missing'), updatedAt: '2026-01-01T00:00:00.000Z' });

      const result = await updateArtifact('project-1', 'artifact-missing', { content: 'noop' }, { userId: 'user-1' });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('not-found');
      // The user-visible message must be the actionable one carried by
      // `userMessage`, not the generic `buildUserMessage('failed')` text.
      expect(result.message).toMatch(/todavía no está disponible/);
      expect(result.message).not.toMatch(/No se pudo guardar en la base de datos durante updateArtifact/);
    });
  });

  it('reads backward-compatible embedded artifacts when subcollection is empty', async () => {
    const firestore = await import('firebase/firestore');
    (firestore.getDoc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exists: () => true,
      id: 'project-legacy',
      data: () => ({
        name: 'Legacy',
        description: 'Legacy doc',
        projectContext: [],
        artifacts: [makeArtifact('legacy-artifact')],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    (firestore.getDocs as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ docs: [] });
    const project = await getProject('project-legacy');
    expect(project?.artifacts).toHaveLength(1);
    expect(project?.artifacts[0].id).toBe('legacy-artifact');
  });
});
