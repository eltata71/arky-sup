/**
 * Los comandos del Artefacto contra PostgreSQL (F4-03, ADR-106).
 *
 * Un comando por intención, y ninguno recibe la lista de artefactos del
 * proyecto. Eso es lo que cambió respecto de la RPC compuesta:
 *
 *  - **Editar uno envía uno.** La amplificación `N:1` que midió F4-01 era de
 *    red y de filas; aquí viaja un parche y se escribe una fila.
 *  - **La revisión que se compara es la del artefacto.** Dos ediciones de
 *    artefactos distintos ya no chocan; la misma edición sobre una revisión
 *    vieja sí, con `P0001`.
 *  - **Ninguna operación puede borrar lo que no nombra.** El borrado por
 *    omisión de la lista era la única defensa que A-03 no tenía.
 *
 * El contador y el índice del proyecto los recalcula el servidor en la misma
 * transacción; este fichero no los conoce. Tampoco conoce `PersistenceResult`:
 * devuelve lo que la base confirmó o lanza, y `artifactPersistence` traduce.
 */

import type { Artifact } from '../../types';
import { callRpc } from '../adapters';

/** Una operación de `api.revise_artifacts`. */
export type ArtifactRevisionChange =
  | { readonly op: 'create-version'; readonly artifact: Artifact }
  | { readonly op: 'delete'; readonly artifactId: string; readonly expectedRevision: number };

const asArtifact = (value: unknown): Artifact => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La base de datos confirmó una respuesta de artefacto inválida.');
  }
  return value as Artifact;
};

/** Lo que se envía: el documento, nunca la revisión que el servidor superpone. */
const document = (artifact: Artifact): Omit<Artifact, 'revision'> => {
  const { revision: _revision, ...rest } = artifact;
  return rest;
};

export const supabaseArtifactCommands = {
  async create(projectId: string, artifact: Artifact): Promise<Artifact> {
    return asArtifact(await callRpc<unknown>('create_artifact', {
      p_project_id: projectId,
      p_artifact: document(artifact),
    }));
  },

  async createVersion(projectId: string, artifact: Artifact): Promise<Artifact> {
    return asArtifact(await callRpc<unknown>('create_artifact_version', {
      p_project_id: projectId,
      p_artifact: document(artifact),
    }));
  },

  async update(artifactId: string, expectedRevision: number, patch: Partial<Artifact>): Promise<Artifact> {
    const { revision: _revision, ...rest } = patch;
    return asArtifact(await callRpc<unknown>('update_artifact', {
      p_artifact_id: artifactId,
      p_expected_revision: expectedRevision,
      p_patch: rest,
    }));
  },

  async remove(artifactId: string, expectedRevision: number): Promise<void> {
    await callRpc<unknown>('delete_artifact', {
      p_artifact_id: artifactId,
      p_expected_revision: expectedRevision,
    });
  },

  async revise(projectId: string, changes: readonly ArtifactRevisionChange[]): Promise<Artifact[]> {
    const created = await callRpc<unknown>('revise_artifacts', {
      p_project_id: projectId,
      p_changes: changes.map((change) => (change.op === 'create-version'
        ? { op: change.op, artifact: document(change.artifact) }
        : change)),
    });
    if (!Array.isArray(created)) throw new Error('La base de datos confirmó una respuesta de artefactos inválida.');
    return created.map(asArtifact);
  },
};
