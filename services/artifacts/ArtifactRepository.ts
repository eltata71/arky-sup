/**
 * Where an artifact is written.
 *
 * Los artefactos son una subcolección de un proyecto, y hasta la Ola 2 su
 * persistencia estaba en `services/firestoreService.ts` junto a la de los
 * proyectos, los ajustes, el historial de chat, el registro del agente, los
 * encargos de la Oficina y las iniciativas de negocio. Siete contextos en un
 * fichero: cambiar la forma de un artefacto era editar un módulo del que
 * dependían otros seis dominios.
 *
 * Ahora vive en `artifactPersistence.ts`, al lado de este fichero. Las guardas
 * de tamaño, el índice de artefactos y el reintento contra la carrera de
 * creación están ahí; esto es sólo la puerta.
 */

import {
  createArtifact,
  deleteArtifact,
  restoreArtifactVersion,
  updateArtifact,
  updateProjectArtifacts,
} from './artifactPersistence';
import type { PersistenceResult } from '../persistence';
import type { Artifact } from '../../types';

export interface ArtifactRepository {
  create(projectId: string, artifact: Artifact, userId?: string): Promise<PersistenceResult<Artifact>>;
  update(
    projectId: string,
    artifactId: string,
    updates: Partial<Artifact>,
    options?: { expectedUpdatedAt?: string; userId?: string },
  ): Promise<PersistenceResult<{ updatedAt: string }>>;
  remove(projectId: string, artifactId: string, userId?: string): Promise<PersistenceResult<{ updatedAt: string }>>;
  /** Replace the whole set — used by the flows that rewrite several at once. */
  replaceAll(
    projectId: string,
    artifacts: Artifact[],
    options?: { expectedUpdatedAt?: string; userId?: string },
  ): Promise<PersistenceResult<{ updatedAt: string }>>;
  restoreVersion(projectId: string, version: Artifact): Promise<PersistenceResult<Artifact>>;
}

export const artifactRepository: ArtifactRepository = {
  create: (projectId, artifact, userId) => createArtifact(projectId, artifact, { userId }),
  update: (projectId, artifactId, updates, options = {}) =>
    updateArtifact(projectId, artifactId, updates, options),
  remove: (projectId, artifactId, userId) => deleteArtifact(projectId, artifactId, { userId }),
  replaceAll: (projectId, artifacts, options = {}) =>
    updateProjectArtifacts(projectId, artifacts, options),
  restoreVersion: (projectId, version) => restoreArtifactVersion(projectId, version),
};
