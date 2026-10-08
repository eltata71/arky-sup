import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectArtifacts } from '../../hooks/useProjectArtifacts';

const state = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; artifactsLoaded?: boolean }>,
  ensure: vi.fn(),
}));

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ projects: state.projects, ensureProjectArtifacts: state.ensure }),
}));

describe('useProjectArtifacts', () => {
  beforeEach(() => {
    state.projects = [];
    state.ensure.mockReset();
  });

  it('hydrates when the project index arrives after the workspace mounts', () => {
    const { rerender } = renderHook(() => useProjectArtifacts('project-1'));
    expect(state.ensure).not.toHaveBeenCalled();

    state.projects = [{ id: 'project-1', artifactsLoaded: false }];
    rerender();
    expect(state.ensure).toHaveBeenCalledExactlyOnceWith('project-1');

    state.projects = [{ id: 'project-1', artifactsLoaded: true }];
    rerender();
    expect(state.ensure).toHaveBeenCalledTimes(1);
  });
});
