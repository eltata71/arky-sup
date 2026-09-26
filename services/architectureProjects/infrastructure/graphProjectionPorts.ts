/**
 * Los puertos de producción de la recuperación del grafo (F5-05): el
 * repositorio del grafo y una lectura del proyecto que salta la caché.
 */
import { forgetProject } from './projectCache';
import { getProject } from './projectReads';
import { getGraphRepository } from './projectWrites';
import type { GraphProjectionPorts } from '../application/graphProjectionRecovery';

export const createGraphProjectionPorts = (globalContext: readonly string[]): GraphProjectionPorts => ({
  listPending: async () => (await getGraphRepository()).listPendingProjections(),
  loadFreshProject: async (projectId) => {
    // Sin caché: el pendiente puede venir de otra pestaña o dispositivo.
    forgetProject(projectId);
    return getProject(projectId);
  },
  saveProjection: async (graph, generation) => (await getGraphRepository()).saveProjection(graph, generation),
  failProjection: async (projectId, generation, error) =>
    (await getGraphRepository()).failProjection(projectId, generation, error),
  globalContext,
});
