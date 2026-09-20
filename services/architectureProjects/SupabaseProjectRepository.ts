/**
 * El agregado Proyecto/Atención contra PostgreSQL.
 *
 * Una diferencia de forma con el camino que sustituye, y es la que explica
 * todo lo demás: en Firestore un proyecto eran **muchos documentos** —la raíz,
 * un documento por artefacto, el índice, el grafo, un documento por paquete— y
 * cada escritura tocaba los que le correspondían. Aquí hay **una RPC
 * compuesta**: `api.save_project_aggregate` recibe el proyecto y la lista
 * completa de artefactos, y mantiene en la misma transacción la raíz, las filas
 * hijas, el contador y el índice. Los artefactos que no viajan en la carga se
 * borran, que es justamente lo que hace que el agregado no pueda quedar a
 * medias.
 *
 * Tres consecuencias que conviene ver escritas:
 *
 *  - **Una escritura de un artefacto es una escritura del agregado.** No hay
 *    forma de tocar un artefacto sin enviar los demás, y eso es correcto para
 *    un agregado: el contador y el índice no pueden discrepar de las filas.
 *    `services/artifacts` lee el proyecto, aplica su cambio y vuelve a
 *    guardarlo.
 *  - **La concurrencia es por revisión, no por `updatedAt`.** Firestore
 *    comparaba cadenas de fecha, que es una heurística: dos escrituras en el
 *    mismo milisegundo empataban. `revision` es un entero que el servidor
 *    incrementa, y la RPC rechaza la escritura cuya revisión esperada ya no es
 *    la vigente. Este repositorio recuerda la última revisión leída por
 *    proyecto, igual que los de iniciativas y encargos.
 *  - **Ya no hace falta podar el artefacto.** El límite de 1 MiB por documento
 *    era de Firestore; una fila `jsonb` admite tres órdenes de magnitud más.
 *    El plan de maquetación y la traza de generación se guardan enteros, que es
 *    lo que el producto quería y no podía.
 */

import type { Artifact } from '../../types';
import {
  createOperationId,
  supabaseErrorCode,
  supabaseFailure,
  type PersistenceResult,
} from '../persistence';
import { callRpc } from '../adapters';

/** El proyecto tal y como lo devuelve `load_project_aggregate`. */
export interface RemoteProjectAggregate {
  readonly document: Record<string, unknown>;
  readonly artifacts: Artifact[];
  readonly revision: number;
}

/** Código que `load_project_aggregate` usa para «ese proyecto no existe». */
const NOT_FOUND = 'P0002';

const revisions = new Map<string, number>();

/** La última revisión confirmada de un proyecto, o 0 si nunca se leyó. */
export const knownProjectRevision = (projectId: string): number => revisions.get(projectId) ?? 0;

/** Solo para pruebas y para el cierre de sesión. */
export const forgetProjectRevisions = (): void => revisions.clear();

const asAggregate = (value: unknown): RemoteProjectAggregate | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const artifacts = Array.isArray(row.artifacts) ? (row.artifacts as Artifact[]) : [];
  const revision = typeof row.revision === 'number' ? row.revision : 0;
  return { document: row, artifacts, revision };
};

/**
 * Lo que se envía como proyecto: todo menos los artefactos y lo que el
 * servidor deriva.
 *
 * La RPC ya quita `artifacts`, `artifactIndex` y `artifactCount` antes de
 * guardar, pero enviarlos sería enviar el cuerpo de cada artefacto dos veces
 * en cada escritura.
 */
const withoutDerived = (document: Record<string, unknown>): Record<string, unknown> => {
  const { artifacts: _a, artifactIndex: _i, artifactCount: _c, artifactsLoaded: _l, ...rest } = document;
  return rest;
};

export interface SupabaseProjectRepository {
  list(): Promise<RemoteProjectAggregate[]>;
  load(projectId: string): Promise<RemoteProjectAggregate | null>;
  save(
    document: Record<string, unknown>,
    artifacts: Artifact[],
    expectedRevision?: number,
  ): Promise<PersistenceResult<RemoteProjectAggregate>>;
  remove(projectId: string, expectedRevision?: number): Promise<PersistenceResult<void>>;
}

export const supabaseProjectRepository: SupabaseProjectRepository = {
  async list() {
    const rows = await callRpc<unknown>('list_project_aggregates');
    if (!Array.isArray(rows)) throw new Error('La respuesta remota de proyectos no es una lista.');
    const aggregates = rows.map(asAggregate).filter((row): row is RemoteProjectAggregate => row !== null);
    for (const aggregate of aggregates) {
      const id = aggregate.document.id;
      if (typeof id === 'string') revisions.set(id, aggregate.revision);
    }
    return aggregates;
  },

  async load(projectId) {
    try {
      const row = await callRpc<unknown>('load_project_aggregate', { p_id: projectId });
      const aggregate = asAggregate(row);
      if (aggregate) revisions.set(projectId, aggregate.revision);
      return aggregate;
    } catch (error) {
      // Ausente no es fallo: el llamante decide si eso significa «se borró» o
      // «este id nunca existió», y las dos respuestas son `undefined`.
      if (supabaseErrorCode(error) === NOT_FOUND) return null;
      throw error;
    }
  },

  async save(document, artifacts, expectedRevision) {
    const projectId = typeof document.id === 'string' ? document.id : '';
    const operationId = createOperationId('saveProjectAggregate');
    const expected = expectedRevision ?? knownProjectRevision(projectId);
    try {
      const row = await callRpc<unknown>('save_project_aggregate', {
        p_project: withoutDerived(document),
        p_artifacts: artifacts,
        p_expected_revision: expected,
      });
      const aggregate = asAggregate(row);
      if (!aggregate) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'La base de datos confirmó una respuesta de proyecto inválida.',
        };
      }
      revisions.set(projectId, aggregate.revision);
      return { status: 'success', success: true, operationId, target: 'supabase', data: aggregate };
    } catch (error) {
      return supabaseFailure<RemoteProjectAggregate>(
        operationId, error, 'No se pudo confirmar el proyecto en la base de datos.',
      );
    }
  },

  async remove(projectId, expectedRevision) {
    const operationId = createOperationId('deleteProjectAggregate');
    try {
      await callRpc<unknown>('delete_project_aggregate', {
        p_id: projectId,
        p_expected_revision: expectedRevision ?? knownProjectRevision(projectId),
      });
      revisions.delete(projectId);
      return { status: 'success', success: true, operationId, target: 'supabase' };
    } catch (error) {
      return supabaseFailure<void>(
        operationId, error, 'No se pudo confirmar el borrado del proyecto en la base de datos.',
      );
    }
  },
};
