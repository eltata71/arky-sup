/**
 * F4-07 — la revisión de un proyecto viaja con el registro.
 *
 * Antes la guardaba un `Map` del repositorio, publicado por el `index.ts` del
 * contexto, y el hook capturaba su instantánea dentro del actualizador de
 * `setProjects`: desde la segunda edición consecutiva no había instantánea, ni
 * revisión que comparar, ni reversión posible.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../../services/architectureProjects';

const repository = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  loadArtifacts: vi.fn(),
}));

vi.mock('../../services/architectureProjects/infrastructure/ArchitectureProjectRepository', () => ({
  architectureProjectRepository: repository,
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
vi.mock('../../services/observability', () => ({
  observabilityService: { reportError: vi.fn(), recordWarning: vi.fn(), trackEvent: vi.fn() },
}));

import { useProjectsState } from '../../context/app/useProjectsState';

const project = (revision?: number): Project => ({
  id: 'p1', name: 'Atención', description: '', projectContext: [], initiativeIds: ['i1'],
  artifacts: [], createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
  ...(revision === undefined ? {} : { revision }),
});

const confirmed = (revision: number) => ({
  status: 'success', success: true, target: 'supabase', operationId: 'op', data: { updatedAt: 't', revision },
});

const mount = (initial: Project[]) => {
  const hook = renderHook(() => useProjectsState({
    handleWriteResult: (result: { success: boolean }) => result.success,
    setPersistenceStatus: vi.fn(),
    setPersistenceMessage: vi.fn(),
  } as never));
  act(() => hook.result.current.setProjects(initial));
  return hook;
};

beforeEach(() => Object.values(repository).forEach((fn) => fn.mockReset()));

describe('the revision a project edit compares', () => {
  it('is the one it was read with, then the one the previous write confirmed', async () => {
    repository.update.mockResolvedValueOnce(confirmed(4)).mockResolvedValueOnce(confirmed(5));
    const { result } = mount([project(3)]);

    act(() => result.current.runProjectCommand('p1', { kind: 'rename', name: 'Uno' }));
    await waitFor(() => expect(result.current.projects[0].revision).toBe(4));
    act(() => result.current.runProjectCommand('p1', { kind: 'rename', name: 'Dos' }));
    await waitFor(() => expect(result.current.projects[0].revision).toBe(5));

    expect(repository.update.mock.calls[0][2]).toMatchObject({ expectedRevision: 3 });
    expect(repository.update.mock.calls[1][2]).toMatchObject({ expectedRevision: 4 });
  });

  it('rolls back the second consecutive edit too, not only the first', async () => {
    repository.update
      .mockResolvedValueOnce(confirmed(4))
      .mockResolvedValueOnce({ status: 'conflict', success: false, target: 'supabase', operationId: 'op', message: 'Conflicto' });
    const { result } = mount([project(3)]);

    act(() => result.current.runProjectCommand('p1', { kind: 'rename', name: 'Uno' }));
    await waitFor(() => expect(result.current.projects[0].revision).toBe(4));
    act(() => result.current.runProjectCommand('p1', { kind: 'rename', name: 'Pisado' }));

    await waitFor(() => expect(repository.update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.projects[0].name).toBe('Uno'));
  });

  it('never sends a revision in the changes: the one compared is the record\'s', async () => {
    repository.update.mockResolvedValue(confirmed(4));
    const { result } = mount([project(3)]);

    act(() => { result.current.runProjectCommand('p1', { kind: 'rename', name: 'Uno' }); });

    await waitFor(() => expect(repository.update).toHaveBeenCalled());
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty('revision');
    expect(repository.update.mock.calls[0][2]).toMatchObject({ expectedRevision: 3 });
  });

  it('a rejected command never reaches the database, and says why (F6-03, corte 2b)', () => {
    const { result } = mount([project(3)]);
    let outcome: unknown;
    act(() => { outcome = result.current.runProjectCommand('p1', { kind: 'link-initiatives', initiativeIds: [] }); });
    expect(outcome).toMatchObject({ ok: false, rejection: { reason: 'no-initiative' } });
    act(() => { outcome = result.current.runProjectCommand('p1', { kind: 'rename', name: '   ' }); });
    expect(outcome).toMatchObject({ ok: false, rejection: { reason: 'empty-name' } });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('a command that changes nothing does not write a new revision', () => {
    const { result } = mount([project(3)]);
    let outcome: unknown;
    act(() => { outcome = result.current.runProjectCommand('p1', { kind: 'rename', name: result.current.projects[0].name }); });
    expect(outcome).toEqual({ ok: true, changed: false });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('travels with a deletion', async () => {
    repository.remove.mockResolvedValue({ status: 'success', success: true, target: 'supabase', operationId: 'op' });
    const { result } = mount([project(7)]);

    act(() => result.current.deleteProject('p1'));

    await waitFor(() => expect(repository.remove).toHaveBeenCalledWith('p1', 7));
  });
});
