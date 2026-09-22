/**
 * El agregado Proyecto/Atención contra PostgreSQL.
 *
 * **Una sola ruta de escritura (F4-06).** `saveRoot` —`api.save_project`— guarda
 * la raíz: con revisión esperada 0 la crea, con cualquier otra la actualiza si
 * sigue siendo la almacenada. Cada artefacto se escribe con su propio comando
 * desde `services/artifacts` (ADR-106). La RPC compuesta que recibía el
 * proyecto y la lista entera de artefactos, y borraba los que no viajaban, se
 * retiró cuando su último llamante —la creación, siempre con la lista vacía—
 * pasó a esta puerta; `retiredRpcs.test.ts` impide que vuelva.
 *
 * Dos cosas que conviene ver escritas:
 *
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
  /**
   * Sólo la raíz: nunca toca artefactos, contador ni índice (ADR-106). Con
   * revisión 0 crea; con otra, actualiza si sigue siendo la almacenada.
   */
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
