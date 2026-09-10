/**
 * The project document is bounded, and what used to fill it now lives
 * elsewhere.
 *
 * `Project.artifacts` was already split into a subcollection; the audit read
 * the type signature and concluded otherwise. What it did not catch is that
 * two genuinely unbounded aggregates were still written inline — the
 * architecture graph, which rebuilds on every artifact change and grows with
 * the artifact count, and the publication packages array, which only ever
 * grows and carries an append-only audit trail per package. They shared the
 * project's 1 MiB budget with its name and its memory arrays, and there was no
 * size guard on that document at all: going over produced an opaque Firestore
 * error naming nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../types';

const batchSet = vi.fn();
const batchUpdate = vi.fn();
const batchDelete = vi.fn();
const batchCommit = vi.fn(async () => undefined);
const transactionUpdate = vi.fn();

const { observabilityRecordWarning, observabilityReportError, observabilityTrackEvent } = vi.hoisted(() => ({
  observabilityRecordWarning: vi.fn(),
  observabilityReportError: vi.fn(),
  observabilityTrackEvent: vi.fn(() => ({ id: 'event-1', at: new Date().toISOString() })),
}));

const { getDocMock, getDocsMock } = vi.hoisted(() => ({
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
}));

vi.mock('../../firebase', () => ({ db: {}, auth: {}, isFirebaseAvailable: true }));

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
  getDoc: getDocMock,
  getDocs: getDocsMock,
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  writeBatch: vi.fn(() => ({ set: batchSet, update: batchUpdate, delete: batchDelete, commit: batchCommit })),
  runTransaction: vi.fn(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => {
    await callback({
      get: vi.fn(async () => ({
        exists: () => true,
        data: () => ({ userId: 'user-1', artifactCount: 0, updatedAt: '2026-01-01T00:00:00.000Z' }),
      })),
      set: vi.fn(),
      update: transactionUpdate,
      delete: vi.fn(),
    });
  }),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(),
  limit: vi.fn(),
}));

import { clearProjectCache } from '../../services/architectureProjects/projectCache';
import { getAllProjects, getProject } from '../../services/architectureProjects/projectReads';
import { createProject, updateProject } from '../../services/architectureProjects/projectWrites';
import { createArtifact, updateArtifact } from '../../services/artifacts/artifactPersistence';

const emptySnapshot = { docs: [], empty: true };
const missingDoc = { exists: () => false, data: () => undefined };

/** A graph large enough to matter, shaped like the real one. */
const makeGraph = (entityCount: number) => ({
  version: 1,
  entities: Array.from({ length: entityCount }, (_, i) => ({
    id: `entity-${i}`,
    name: `Entidad ${i}`,
    type: 'component',
    description: 'x'.repeat(200),
    sourceArtifactIds: [`artifact-${i}`],
  })),
  relations: [],
});

const makePackage = (id: string) => ({
  id,
  name: `Paquete ${id}`,
  status: 'draft',
  artifactRefs: [],
  auditTrail: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const makeProject = (overrides: Partial<Project> = {}): Project & { userId: string } => ({
  id: 'project-1',
  userId: 'user-1',
  name: 'Project',
  description: 'Description',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
} as Project & { userId: string });

const pathsWrittenBy = (mock: typeof batchSet): string[] =>
  mock.mock.calls.map(([ref]) => (ref as { path: string }).path);

beforeEach(() => {
  vi.clearAllMocks();
  getDocMock.mockResolvedValue(missingDoc);
  getDocsMock.mockResolvedValue(emptySnapshot);
  clearProjectCache();
});

describe('the project document carries neither aggregate', () => {
  it('writes the graph to its own document, not onto the project', async () => {
    await createProject(makeProject({ architectureKnowledgeGraph: makeGraph(3) as never }));

    const [, projectDocument] = batchSet.mock.calls
      .find(([ref]) => (ref as { path: string }).path === 'projects/project-1')!;
    expect(projectDocument).not.toHaveProperty('architectureKnowledgeGraph');
    expect(pathsWrittenBy(batchSet)).toContain('projects/project-1/aggregates/architectureGraph');
  });

  it('writes one document per publication package', async () => {
    await createProject(makeProject({
      publicationPackages: [makePackage('pkg-a'), makePackage('pkg-b')] as never,
    }));

    const [, projectDocument] = batchSet.mock.calls
      .find(([ref]) => (ref as { path: string }).path === 'projects/project-1')!;
    expect(projectDocument).not.toHaveProperty('publicationPackages');

    const written = pathsWrittenBy(batchSet);
    expect(written).toContain('projects/project-1/publications/pkg-a');
    expect(written).toContain('projects/project-1/publications/pkg-b');
  });

  it('marks the storage scheme so a reader knows which layout it has', async () => {
    await createProject(makeProject());
    const [, projectDocument] = batchSet.mock.calls
      .find(([ref]) => (ref as { path: string }).path === 'projects/project-1')!;
    expect(projectDocument).toMatchObject({ aggregateStorage: 'split-v1' });
  });

  it('routes an update of either aggregate away from the project document', async () => {
    await updateProject('project-1', {
      name: 'Renombrado',
      architectureKnowledgeGraph: makeGraph(2) as never,
      publicationPackages: [makePackage('pkg-a')] as never,
    }, { userId: 'user-1' });

    const [, patch] = transactionUpdate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(patch).toHaveProperty('name', 'Renombrado');
    expect(patch).not.toHaveProperty('architectureKnowledgeGraph');
    expect(patch).not.toHaveProperty('publicationPackages');

    const written = pathsWrittenBy(batchSet);
    expect(written).toContain('projects/project-1/aggregates/architectureGraph');
    expect(written).toContain('projects/project-1/publications/pkg-a');
  });

  it('does not touch the aggregates when an update does not mention them', async () => {
    await updateProject('project-1', { name: 'Sólo el nombre' }, { userId: 'user-1' });
    expect(batchSet).not.toHaveBeenCalled();
  });

  it('deletes the document of a package removed from the array', async () => {
    // Reconciling, not overwriting: a collection cannot be replaced the way a
    // field can, so a removed package would otherwise come back on next read.
    getDocsMock.mockResolvedValue({
      docs: [
        { id: 'pkg-a', ref: { path: 'projects/project-1/publications/pkg-a' }, data: () => ({}) },
        { id: 'pkg-stale', ref: { path: 'projects/project-1/publications/pkg-stale' }, data: () => ({}) },
      ],
      empty: false,
    });

    await updateProject('project-1', {
      publicationPackages: [makePackage('pkg-a')] as never,
    }, { userId: 'user-1' });

    expect(pathsWrittenBy(batchDelete)).toEqual(['projects/project-1/publications/pkg-stale']);
  });
});

describe('attention tracking survives creation', () => {
  it('persists `attention`, which the serializer used to drop silently', () => {
    // It reached Firestore only through `updateProject`, which sanitizes the
    // raw patch — so a project created with attention set lost it, and nothing
    // reported the loss.
    return createProject(makeProject({
      attention: { status: 'active', capturedAt: '2026-01-01T00:00:00.000Z' } as never,
    })).then(() => {
      const [, projectDocument] = batchSet.mock.calls
        .find(([ref]) => (ref as { path: string }).path === 'projects/project-1')!;
      expect(projectDocument).toHaveProperty('attention');
    });
  });
});

describe('the size guard reports which field is the problem', () => {
  it('refuses a project document over the safe budget with an actionable message', async () => {
    // 6000 entities of ~200 bytes of description each is far past the budget.
    const result = await createProject(makeProject({
      agentMemoryEntries: Array.from({ length: 6000 }, (_, i) => ({
        id: `m-${i}`,
        content: 'x'.repeat(200),
        createdAt: '2026-01-01T00:00:00.000Z',
        priority: 'medium',
      })) as never,
    }));

    expect(result.success).toBe(false);
    expect(result.status).toBe('validation-error');
    expect(result.message).toContain('la memoria del agente');
    expect(result.message).toContain('supera el límite seguro');
  });

  it('lets an ordinary project through untouched', async () => {
    const result = await createProject(makeProject());
    expect(result.status).not.toBe('validation-error');
  });
});

describe('a project still opens when its aggregates cannot be read', () => {
  it('falls back to the legacy inline fields and records a warning', async () => {
    // Before the split, a project read touched neither document. Letting a
    // failed read of derived data (the graph) or a governance record (the
    // packages) block the project entirely would be a new failure mode, and a
    // worse one: a degraded view beats no view.
    getDocMock.mockImplementation(async (ref: { path: string }) => {
      if (ref.path.includes('/aggregates/')) throw new Error('permission-denied');
      return {
        exists: () => true,
        id: 'project-1',
        data: () => ({
          name: 'Legacy',
          description: '',
          projectContext: [],
          userId: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      };
    });

    const project = await getProject('project-1');

    expect(project?.name).toBe('Legacy');
    expect(observabilityRecordWarning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Agregados del proyecto no disponibles' }),
    );
  });
});
