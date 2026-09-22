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
 * Ahora vive en `artifactPersistence.ts`, al lado de este fichero, y desde
 * F4-03 cada operación es un comando del servidor con la revisión del propio
 * artefacto (ADR-106). Esto es sólo la puerta.
 */

import {
  createArtifact,
  createArtifactVersion,
  deleteArtifact,
  deletionChanges,
  reviseArtifacts,
  updateArtifact,
  type ArtifactRevisionChange,
  type ArtifactWriteConfirmation,
} from './artifactPersistence';
import type { PersistenceResult } from '../persistence';
import type { Artifact } from '../../types';

export type { ArtifactRevisionChange, ArtifactWriteConfirmation } from './artifactPersistence';

/**
 * Un método por comando (ADR-106). No hay «reemplazar todos»: la operación que
 * recibía la lista entera era la que podía borrar lo que no nombraba.
 */
export interface ArtifactRepository {
  /** Un artefacto en un grupo de versiones nuevo. */
  create(projectId: string, artifact: Artifact, userId?: string): Promise<PersistenceResult<Artifact>>;
  /** La versión siguiente de un grupo existente — también al restaurar una anterior. */
  createVersion(projectId: string, artifact: Artifact, userId?: string): Promise<PersistenceResult<Artifact>>;
  update(
    projectId: string,
    artifactId: string,
    updates: Partial<Artifact>,
    options?: { expectedRevision?: number; userId?: string },
  ): Promise<PersistenceResult<ArtifactWriteConfirmation>>;
  remove(
    projectId: string,
    artifactId: string,
    options?: { expectedRevision?: number; userId?: string },
  ): Promise<PersistenceResult<{ updatedAt: string }>>;
  /** Varias versiones y borrados en una transacción: todo o nada. */
  revise(projectId: string, changes: readonly ArtifactRevisionChange[], userId?: string): Promise<PersistenceResult<Artifact[]>>;
  /** Borra varios en una transacción, cada uno con su revisión. */
  removeMany(
    projectId: string,
    artifacts: readonly Pick<Artifact, 'id' | 'revision'>[],
    userId?: string,
  ): Promise<PersistenceResult<Artifact[]>>;
}

export const artifactRepository: ArtifactRepository = {
  create: (projectId, artifact, userId) => createArtifact(projectId, artifact, { userId }),
  createVersion: (projectId, artifact, userId) => createArtifactVersion(projectId, artifact, { userId }),
  update: (projectId, artifactId, updates, options = {}) =>
    updateArtifact(projectId, artifactId, updates, options),
  remove: (projectId, artifactId, options = {}) => deleteArtifact(projectId, artifactId, options),
  revise: (projectId, changes, userId) => reviseArtifacts(projectId, changes, { userId }),
  removeMany: async (projectId, artifacts, userId) =>
    reviseArtifacts(projectId, await deletionChanges(projectId, artifacts), { userId }),
};
