/**
 * The portfolio loads an index, not every artifact in the account.
 *
 * Booting the app used to run one query for the projects and then, for each
 * project, a full read of its artifact subcollection — every document body,
 * before a single screen had rendered, for screens that only count and group
 * them. This is the compact index that replaced it.
 *
 * The property that makes the change safe is the count check: the index
 * records how many artifacts it described, and a reader trusts it only when
 * that still matches the project's `artifactCount`. Drift makes it fall back
 * to loading the artifacts, so a stale index costs a slow read and can never
 * put a wrong number on a portfolio screen. Those are the tests that matter
 * most here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Project } from '../../types';

const batchSet = vi.fn();
const batchUpdate = vi.fn();
const batchDelete = vi.fn();
const batchCommit = vi.fn(async () => undefined);

const { observabilityRecordWarning, observabilityReportError, observabilityTrackEvent } = vi.hoisted(() => ({
  observabilityRecordWarning: vi.fn(),
  observabilityReportError: vi.fn(),
  observabilityTrackEvent: vi.fn(() => ({ id: 'e', at: new Date().toISOString() })),
}));

const { getDocMock, getDocsMock } = vi.hoisted(() => ({ getDocMock: vi.fn(), getDocsMock: vi.fn() }));

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
  runTransaction: vi.fn(),
  query: vi.fn((c: unknown) => c),
  where: vi.fn(),
  limit: vi.fn(),
}));

import { clearProjectCache } from '../../services/architectureProjects/projectCache';
import { getAllProjects, getProject } from '../../services/architectureProjects/projectReads';
import { createProject, updateProject } from '../../services/architectureProjects/projectWrites';
import { createArtifact, updateArtifact, updateProjectArtifacts } from '../../services/artifacts/artifactPersistence';

const makeArtifact = (id: string, group = id, version = 1): Artifact => ({
  id,
  versionGroupId: group,
  version,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: `Artefacto ${id}`,
  type: 'markdown',
  phase: 'Design',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# '.padEnd(5000, 'x'),
  objective: 'Objetivo',
  keyConcepts: [],
  representation: 'document',
});

const projectDoc = (overrides: Record<string, unknown> = {}) => ({
  id: 'project-1',
  name: 'Proyecto',
  description: '',
  projectContext: [],
  userId: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  artifactCount: 2,
  ...overrides,
});

const summary = (id: string, group = id, version = 1) => ({
  id, name: `Artefacto ${id}`, type: 'markdown', versionGroupId: group, version,
});

/** One project in the collection query, with the given project document. */
const givenPortfolio = (data: Record<string, unknown>) => {
  getDocsMock.mockImplementation(async (ref: { path: string }) => {
    if (ref.path === 'projects') {
      return { docs: [{ id: 'project-1', data: () => data }], empty: false };
    }
    // Artifact subcollection — only reached by the fallback path.
    if (ref.path.endsWith('/artifacts')) {
      return {
        docs: [
          { id: 'a1', data: () => makeArtifact('a1') },
          { id: 'a2', data: () => makeArtifact('a2') },
        ],
        empty: false,
      };
    }
    return { docs: [], empty: true };
  });
};

const givenIndexDoc = (indexData: unknown) => {
  getDocMock.mockImplementation(async (ref: { path: string }) => (
    ref.path.endsWith('/aggregates/artifactIndex') && indexData !== undefined
      ? { exists: () => true, data: () => indexData }
      : { exists: () => false, data: () => undefined }
  ));
};

const artifactReadsMade = (): number =>
  getDocsMock.mock.calls.filter(([ref]) => (ref as { path: string }).path.endsWith('/artifacts')).length;

beforeEach(() => {
  vi.clearAllMocks();
  clearProjectCache();
});

describe('the portfolio read', () => {
  it('uses the index and does not read a single artifact document', async () => {
    givenPortfolio(projectDoc());
    givenIndexDoc({ summaries: [summary('a1'), summary('a2')], count: 2 });

    const [project] = await getAllProjects('user-1');

    expect(artifactReadsMade()).toBe(0);
    expect(project.artifactsLoaded).toBe(false);
    expect(project.artifactIndex).toHaveLength(2);
    expect(project.artifactCount).toBe(2);
    // The bodies are deliberately absent — that is the whole saving.
    expect(project.artifacts).toEqual([]);
  });

  it('marks the project unloaded so nothing mistakes it for having no artifacts', async () => {
    givenPortfolio(projectDoc());
    givenIndexDoc({ summaries: [summary('a1'), summary('a2')], count: 2 });
    const [project] = await getAllProjects('user-1');
    // `artifacts.length === 0` is true here and means nothing. This is the
    // field that carries the fact.
    expect(project.artifacts).toHaveLength(0);
    expect(project.artifactsLoaded).toBe(false);
  });
});

describe('the index is trusted only when it still describes the project', () => {
  it('falls back to loading the artifacts when the count disagrees', async () => {
    // An artifact was added or removed after the index was written.
    givenPortfolio(projectDoc({ artifactCount: 3 }));
    givenIndexDoc({ summaries: [summary('a1'), summary('a2')], count: 2 });

    const [project] = await getAllProjects('user-1');

    expect(artifactReadsMade()).toBe(1);
    expect(project.artifactsLoaded).toBe(true);
    expect(project.artifacts).toHaveLength(2);
  });

  it('falls back when the stored summaries and the stored count disagree', async () => {
    givenPortfolio(projectDoc({ artifactCount: 2 }));
    givenIndexDoc({ summaries: [summary('a1')], count: 2 });
    await getAllProjects('user-1');
    expect(artifactReadsMade()).toBe(1);
  });

  it('falls back for a legacy project that has no index at all', async () => {
    givenPortfolio(projectDoc());
    givenIndexDoc(undefined);

    const [project] = await getAllProjects('user-1');

    expect(artifactReadsMade()).toBe(1);
    expect(project.artifactsLoaded).toBe(true);
    expect(project.artifacts).toHaveLength(2);
    // Having paid for the read, it reports the index it now knows.
    expect(project.artifactIndex).toHaveLength(2);
  });

  it('falls back when the project document carries no artifactCount to check against', async () => {
    const { artifactCount: _drop, ...withoutCount } = projectDoc();
    givenPortfolio(withoutCount);
    givenIndexDoc({ summaries: [summary('a1'), summary('a2')], count: 2 });
    await getAllProjects('user-1');
    expect(artifactReadsMade()).toBe(1);
  });

  it('falls back when the index document is unreadable', async () => {
    givenPortfolio(projectDoc());
    getDocMock.mockRejectedValue(new Error('permission-denied'));
    await getAllProjects('user-1');
    expect(artifactReadsMade()).toBe(1);
  });
});

describe('the index is written wherever the count is', () => {
  it('is created with the project', async () => {
    await createProject({
      ...(projectDoc() as unknown as Project),
      artifacts: [makeArtifact('a1'), makeArtifact('a2')],
    } as Project & { userId: string });

    const written = new Map(batchSet.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data]));
    const index = written.get('projects/project-1/aggregates/artifactIndex') as { summaries: unknown[]; count: number };
    expect(index.count).toBe(2);
    expect(index.summaries).toHaveLength(2);
    // Identity only — the body must not be duplicated into the index, or it
    // would be as expensive as the thing it replaces.
    expect(JSON.stringify(index.summaries)).not.toContain('xxxx');
  });

  it('is rebuilt by the full-set artifact write', async () => {
    getDocsMock.mockResolvedValue({ docs: [], empty: true });
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ userId: 'user-1', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });

    await updateProjectArtifacts('project-1', [makeArtifact('a1')], { userId: 'user-1' });

    const written = new Map(batchSet.mock.calls.map(([ref, data]) => [(ref as { path: string }).path, data]));
    const index = written.get('projects/project-1/aggregates/artifactIndex') as { count: number };
    expect(index.count).toBe(1);
  });
});
