/**
 * `useArchitectureGraphSync` desde F5-05: al arrancar recupera lo que la
 * bitácora de la base tiene pendiente y lo pone en el estado sin volver a
 * escribirlo; y con una base sin bitácora, la reconstrucción automática sigue
 * funcionando como antes. La lógica de la recuperación está probada aparte
 * (`graphProjectionRecovery.test.ts`); aquí sólo el cableado de React.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../services/architectureProjects';

const mocks = vi.hoisted(() => ({ recover: vi.fn() }));

vi.mock('../../services/architectureProjects/graphProjection', () => ({
  recoverGraphProjections: mocks.recover,
  createGraphProjectionPorts: () => ({}),
}));

import { useArchitectureGraphSync } from '../../context/app/useArchitectureGraphSync';

const project = { id: 'p1', name: 'Reclamos', artifacts: [], projectContext: [] } as unknown as Project;

const render = (projects: Project[]) => {
  const setProjects = vi.fn();
  const updateProject = vi.fn();
  const projectsRef = { current: projects } as React.MutableRefObject<Project[]>;
  const globalContextRef = { current: [] as string[] } as React.MutableRefObject<string[]>;
  renderHook(() => useArchitectureGraphSync({
    projects, projectsRef, globalContext: [], globalContextRef, updateProject, setProjects,
  }));
  return { setProjects, updateProject };
};

describe('useArchitectureGraphSync — recuperación al arrancar (F5-05)', () => {
  it('procesa los pendientes una vez cargados los proyectos y aplica el grafo al estado', async () => {
    const graph = { projectId: 'p1', buildId: 'b', revision: 4 };
    mocks.recover.mockResolvedValue({ available: true, recovered: [{ projectId: 'p1', graph }], skipped: [], failed: [] });
    const { setProjects, updateProject } = render([project]);

    await waitFor(() => expect(setProjects).toHaveBeenCalledTimes(1));
    const apply = setProjects.mock.calls[0][0] as (prev: Project[]) => Project[];
    expect(apply([project])[0].architectureKnowledgeGraph).toEqual(graph);
    // Ya está guardado: aplicarlo no vuelve a escribir el proyecto.
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('sin proyectos no pregunta todavía', () => {
    mocks.recover.mockReset();
    render([]);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});
