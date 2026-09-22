/**
 * La revisión de un artefacto viaja con el artefacto (ADR-106, patrón F2-10).
 *
 * El hook de estado es el único sitio que la sostiene entre dos escrituras: la
 * primera edición compara la revisión leída, y la segunda tiene que comparar la
 * que **confirmó** la primera. Si el hook no la guardara, la segunda edición del
 * mismo artefacto sería siempre un conflicto falso — el mismo defecto que tenía
 * la lectura de proyectos antes de F4-03, un nivel más abajo.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Project } from '../../types';

const repository = vi.hoisted(() => ({
  create: vi.fn(),
  createVersion: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  revise: vi.fn(),
  removeMany: vi.fn(),
}));

vi.mock('../../services/artifacts/ArtifactRepository', () => ({ artifactRepository: repository }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../services/observability', () => ({
  observabilityService: { reportError: vi.fn(), recordWarning: vi.fn(), trackEvent: vi.fn() },
}));

import { useArtifactsState } from '../../context/app/useArtifactsState';

const artifact = (id: string, revision?: number): Artifact => ({
  id,
  versionGroupId: id,
  version: 1,
  createdAt: '2026-09-22T00:00:00.000Z',
  name: `Artefacto ${id}`,
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# contenido',
  objective: 'Documentar',
  keyConcepts: [],
  representation: 'document',
  ...(revision === undefined ? {} : { revision }),
});

const confirmed = <T,>(data: T) => ({ status: 'success', success: true, target: 'supabase', operationId: 'op', data });

const useHarness = (initial: Artifact[]) => {
  const [projects, setProjects] = useState<Project[]>([
    { id: 'p1', name: 'Atención', artifacts: initial } as unknown as Project,
  ]);
  const state = useArtifactsState({
    setProjects,
    getProject: (id) => projects.find((project) => project.id === id),
    reporter: {
      handleWriteResult: (result: { success: boolean }) => result.success,
      setPersistenceStatus: vi.fn(),
      setPersistenceMessage: vi.fn(),
    } as never,
  });
  return { projects, state };
};

beforeEach(() => {
  Object.values(repository).forEach((fn) => fn.mockReset());
});

describe('the revision an edit compares', () => {
  it('is the one read first, then the one the previous write confirmed', async () => {
    repository.update
      .mockResolvedValueOnce(confirmed({ updatedAt: 't1', revision: 5 }))
      .mockResolvedValueOnce(confirmed({ updatedAt: 't2', revision: 6 }));
    const { result } = renderHook(() => useHarness([artifact('a1', 4)]));

    act(() => result.current.state.updateArtifact('p1', 'a1', { name: 'Uno' }));
    await waitFor(() => expect(result.current.projects[0].artifacts[0].revision).toBe(5));
    act(() => result.current.state.updateArtifact('p1', 'a1', { name: 'Dos' }));
    await waitFor(() => expect(result.current.projects[0].artifacts[0].revision).toBe(6));

    expect(repository.update.mock.calls[0][3]).toMatchObject({ expectedRevision: 4 });
    expect(repository.update.mock.calls[1][3]).toMatchObject({ expectedRevision: 5 });
  });

  it('does not lose the second consecutive edit (it used to depend on React running the updater eagerly)', async () => {
    repository.update.mockResolvedValue(confirmed({ updatedAt: 't', revision: 2 }));
    const { result } = renderHook(() => useHarness([artifact('a1', 1)]));

    act(() => result.current.state.updateArtifact('p1', 'a1', { name: 'Uno' }));
    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(1));
    act(() => result.current.state.updateArtifact('p1', 'a1', { name: 'Dos' }));

    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(2));
    expect(repository.update.mock.calls[1][2]).toMatchObject({ name: 'Dos' });
  });

  it('is recorded for a freshly created artifact, so its first edit does not re-read the project', async () => {
    repository.create.mockImplementation(async (_project: string, created: Artifact) => confirmed({ ...created, revision: 1 }));
    const { result } = renderHook(() => useHarness([]));

    let createdId = '';
    act(() => {
      createdId = result.current.state.createArtifact('p1', {
        name: 'Nuevo', type: 'markdown', phase: 'Diseño', architecturalView: 'Vista Lógica y de Diseño',
        content: '# nuevo', objective: 'Probar', keyConcepts: [], representation: 'document',
      }).id;
    });

    await waitFor(() => expect(result.current.projects[0].artifacts[0].revision).toBe(1));
    expect(result.current.projects[0].artifacts[0].id).toBe(createdId);
  });

  it('travels with a deletion', async () => {
    repository.remove.mockResolvedValue(confirmed({ updatedAt: 't' }));
    const { result } = renderHook(() => useHarness([artifact('a1', 7)]));

    act(() => result.current.state.deleteArtifact('p1', 'a1'));

    await waitFor(() => expect(repository.remove).toHaveBeenCalled());
    expect(repository.remove.mock.calls[0][2]).toMatchObject({ expectedRevision: 7 });
  });

  it('a stale revision rolls the edit back instead of keeping it on screen', async () => {
    repository.update.mockResolvedValue({
      status: 'conflict', success: false, target: 'supabase', operationId: 'op', message: 'Conflicto de artefacto',
    });
    const { result } = renderHook(() => useHarness([artifact('a1', 2)]));

    act(() => result.current.state.updateArtifact('p1', 'a1', { name: 'Pisado' }));

    await waitFor(() => expect(repository.update).toHaveBeenCalled());
    await waitFor(() => expect(result.current.projects[0].artifacts[0].name).toBe('Artefacto a1'));
    expect(result.current.projects[0].artifacts[0].revision).toBe(2);
  });

  it('a new version never inherits the revision of the one it was made from', () => {
    repository.createVersion.mockResolvedValue(confirmed({ ...artifact('v2'), revision: 1 }));
    const { result } = renderHook(() => useHarness([artifact('a1', 9)]));

    let restored: Artifact | undefined;
    act(() => { restored = result.current.state.restoreArtifactVersion('p1', artifact('a1', 9)); });

    expect(restored?.revision).toBeUndefined();
    expect(repository.createVersion).toHaveBeenCalled();
  });

  it('removes corrupt artifacts in one transaction, each with its revision', async () => {
    repository.removeMany.mockResolvedValue(confirmed([]));
    const { result } = renderHook(() => useHarness([artifact('a1', 3), artifact('a2', 4)]));

    act(() => result.current.state.removeCorruptArtifacts('p1', ['a2']));

    await waitFor(() => expect(repository.removeMany).toHaveBeenCalled());
    expect(repository.removeMany.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 'a2', revision: 4 })]);
  });
});
