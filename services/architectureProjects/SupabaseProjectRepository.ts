/**
 * El agregado Proyecto/Atención contra PostgreSQL.
 *
 * **Desde F4-03 (ADR-106) el Proyecto ya no contiene artefactos.** `saveRoot`
 * —`api.save_project`— guarda sólo la raíz, y cada artefacto se escribe con su
 * propio comando desde `services/artifacts`. `save` —la RPC compuesta— queda
 * para crear un proyecto junto con sus artefactos iniciales; sobre un proyecto
 * existente el servidor sólo acepta la lista que ya tiene. Lo que sigue
 * describe cómo se llegó aquí.
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
 *    la vigente. Quien escribe la dice: viaja en el `Project` leído (F4-07),
 *    igual que en iniciativas y encargos.
 *  - **Ya no hace falta podar el artefacto.** El límite de 1 MiB por documento
 *    era de Firestore; una fila `jsonb` admite tres órdenes de magnitud más.
 *    El plan de maquetación y la traza de generación se guardan enteros, que es
 *    lo que el producto quería y no podía.
 */

import type { Artifact } from '../../lib/artifacts';
import {
  createOperationId,
  supabaseErrorCode,
  supabaseFailure,
  type PersistenceResult,
} from '../persistence';
import { callRpc } from '../adapters';
import type { PersistedProjectDocument } from './projectDocumentMapper';

/** El proyecto tal y como lo devuelve `load_project_aggregate`. */
export interface RemoteProjectAggregate {
  readonly document: Record<string, unknown>;
  readonly artifacts: Artifact[];
  readonly revision: number;
}

/** Código que `load_project_aggregate` usa para «ese proyecto no existe». */
const NOT_FOUND = 'P0002';

/*
 * F4-07 · Aquí había un `Map` global de revisiones por proyecto, y el `index.ts`
 * del contexto lo publicaba (`knownProjectRevision`, `forgetProjectRevisions`):
 * la caché de concurrencia era parte del contrato del módulo. Es el defecto H10
 * que F2-10 quitó de encargos e iniciativas —el mapa recuerda la última
 * revisión que **esta pestaña** leyó, no la del registro que la persona está
 * viendo— y, mientras la lectura no devolvía la revisión (hasta F4-03), valía 0
 * para todo proyecto recargado.
 *
 * Ahora la revisión viaja en el `Project` y quien escribe dice contra cuál. Este
 * repositorio no recuerda nada.
 */

const asAggregate = (value: unknown): RemoteProjectAggregate | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const artifacts = Array.isArray(row.artifacts) ? (row.artifacts as Artifact[]) : [];
  const revision = typeof row.revision === 'number' ? row.revision : 0;
  return { document: row, artifacts, revision };
};

/*
 * Lo que se envía como proyecto es un `PersistedProjectDocument` (F4-04): la
 * forma escrita de la raíz, sin artefactos, índice, contador ni revisión. Aquí
 * había un `withoutDerived` que los quitaba de un `Record` cualquiera; con el
 * documento tipado ya no hay nada que quitar, y un campo derivado que intentara
 * colarse no compilaría.
 */

export interface SupabaseProjectRepository {
  list(): Promise<RemoteProjectAggregate[]>;
  load(projectId: string): Promise<RemoteProjectAggregate | null>;
  save(
    document: PersistedProjectDocument,
    artifacts: Artifact[],
    expectedRevision: number,
  ): Promise<PersistenceResult<RemoteProjectAggregate>>;
  /** Sólo la raíz: nunca toca artefactos, contador ni índice (ADR-106). */
  saveRoot(
    document: PersistedProjectDocument,
    expectedRevision: number,
  ): Promise<PersistenceResult<RemoteProjectAggregate>>;
  remove(projectId: string, expectedRevision: number): Promise<PersistenceResult<void>>;
}

const confirmSave = async (
  operationId: string,
  call: () => Promise<unknown>,
): Promise<PersistenceResult<RemoteProjectAggregate>> => {
  try {
    const aggregate = asAggregate(await call());
    if (!aggregate) {
      return {
        status: 'failed', success: false, operationId, target: 'supabase',
        message: 'La base de datos confirmó una respuesta de proyecto inválida.',
      };
    }
    return { status: 'success', success: true, operationId, target: 'supabase', data: aggregate };
  } catch (error) {
    return supabaseFailure<RemoteProjectAggregate>(
      operationId, error, 'No se pudo confirmar el proyecto en la base de datos.',
    );
  }
};

export const supabaseProjectRepository: SupabaseProjectRepository = {
  async list() {
    const rows = await callRpc<unknown>('list_project_aggregates');
    if (!Array.isArray(rows)) throw new Error('La respuesta remota de proyectos no es una lista.');
    return rows.map(asAggregate).filter((row): row is RemoteProjectAggregate => row !== null);
  },

  async load(projectId) {
    try {
      return asAggregate(await callRpc<unknown>('load_project_aggregate', { p_id: projectId }));
    } catch (error) {
      // Ausente no es fallo: el llamante decide si eso significa «se borró» o
      // «este id nunca existió», y las dos respuestas son `undefined`.
      if (supabaseErrorCode(error) === NOT_FOUND) return null;
      throw error;
    }
  },

  async save(document, artifacts, expectedRevision) {
    return confirmSave(createOperationId('saveProjectAggregate'), () =>
      callRpc<unknown>('save_project_aggregate', {
        p_project: document,
        p_artifacts: artifacts,
        p_expected_revision: expectedRevision,
      }));
  },

  async saveRoot(document, expectedRevision) {
    return confirmSave(createOperationId('saveProject'), () =>
      callRpc<unknown>('save_project', {
        p_project: document,
        p_expected_revision: expectedRevision,
      }));
  },

  async remove(projectId, expectedRevision) {
    const operationId = createOperationId('deleteProjectAggregate');
    try {
      await callRpc<unknown>('delete_project_aggregate', {
        p_id: projectId,
        p_expected_revision: expectedRevision,
      });
      return { status: 'success', success: true, operationId, target: 'supabase' };
    } catch (error) {
      return supabaseFailure<void>(
        operationId, error, 'No se pudo confirmar el borrado del proyecto en la base de datos.',
      );
    }
  },
};
