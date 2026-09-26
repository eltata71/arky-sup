/**
 * Persistence boundary for Architecture Office engagements.
 *
 * The runner writes on **every** task transition so a reload resumes from the
 * last completed task instead of losing a multi-minute operation. That makes
 * this the hot path, so the contract is:
 *
 *  - never throws — callers get a `PersistenceResult`-shaped outcome;
 *  - normalizes on read, so a hand-edited or legacy document cannot crash the
 *    runner (the same defensive posture as `services/runtimeValidation.ts`);
 *  - degrades to the local mirror this repository keeps when the database is
 *    unavailable, exactly like artifacts and agent actions do.
 */

import { MirroredList, createFailureResult } from '../../persistence';
import type { PersistenceResult } from '../../persistence';
import { createSupabaseOfficeEngagementRepository } from './SupabaseOfficeEngagementRepository';
import { loadSupabaseDataClient } from '../../adapters';
import {
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  type OfficeArbDecision,
  type OfficeEngagement,
} from '../domain/OfficeTypes';
import { normalizeEngagement } from '../domain/officeEngagementRecord';
import { normalizeBusinessProjectIds } from '../domain/officeShared';

export interface OfficeEngagementRepository {
  list(projectId: string): Promise<OfficeEngagement[]>;
  /** Bandeja global de encargos ajenos para quien tenga `arb:decide`. */
  listForArb(): Promise<OfficeEngagement[]>;
  /**
   * Guarda y devuelve el encargo **tal y como quedó**, con su revisión nueva.
   *
   * Quien llama tiene que quedarse con lo devuelto, no con lo que envió: lo que
   * envió lleva el testigo anterior, y una segunda escritura partiendo de ahí
   * es un conflicto garantizado. En degradación local devuelve el encargo tal
   * cual, sin revisión nueva, porque no la hay — y el estado dice `failed`.
   */
  save(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  remove(projectId: string, engagementId: string, expectedRevision?: number): Promise<PersistenceResult<void>>;
  /**
   * La decisión del comité y la transición del encargo, en una transacción.
   *
   * Eran dos escrituras y ninguna ordenación las arreglaba del todo: sólo una
   * transacción elimina el estado intermedio, y una transacción entre dos
   * tablas no se escribe desde el navegador. La hace `api.decide_engagement`.
   */
  decide(engagement: OfficeEngagement, decision: OfficeArbDecision): Promise<PersistenceResult<OfficeEngagement>>;
}

/**
 * Los encargos viven en su propia tabla y no dentro de la fila del proyecto: el
 * runner escribe en cada transición de tarea, y reescribir el agregado entero
 * —artefactos incluidos— en cada una sería lento y una ocasión de perder
 * actualizaciones.
 */
const mirror = new MirroredList<OfficeEngagement>((projectId) => `engagements_${projectId}`);

let remote: ReturnType<typeof createSupabaseOfficeEngagementRepository> | null = null;
const getRemote = async () => {
  if (!remote) {
    const client = await loadSupabaseDataClient();
    remote = createSupabaseOfficeEngagementRepository(
      client as unknown as Parameters<typeof createSupabaseOfficeEngagementRepository>[0],
    );
  }
  return remote;
};

/** Solo para pruebas: olvida el repositorio remoto memorizado. */
export const resetOfficeEngagementRepositoryCache = (): void => {
  remote = null;
  mirror.clear();
};

class SupabaseBackedOfficeEngagementRepository implements OfficeEngagementRepository {
  async list(projectId: string): Promise<OfficeEngagement[]> {
    const raw = mirror.cached(projectId) ?? await this.fetch(projectId);
    return raw
      .map((item) => normalizeEngagement(item, projectId))
      .filter((item): item is OfficeEngagement => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listForArb(): Promise<OfficeEngagement[]> {
    try {
      return (await (await getRemote()).listForArb())
        .map((item) => normalizeEngagement(item, item.projectId))
        .filter((item): item is OfficeEngagement => item !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      // La bandeja ARB no degrada a datos propios: mostrar el espejo del autor
      // como si fueran encargos revisables violaría la separación adoptada.
      return [];
    }
  }

  private async fetch(projectId: string): Promise<OfficeEngagement[]> {
    try {
      return mirror.remember(projectId, await (await getRemote()).list(projectId));
    } catch {
      return mirror.fallback(projectId);
    }
  }

  async save(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>> {
    const normalized: OfficeEngagement = {
      ...engagement,
      initiativeIds: [...new Set(engagement.initiativeIds)],
      businessProjectIds: normalizeBusinessProjectIds(engagement.businessProjectIds),
      schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    let result: PersistenceResult<OfficeEngagement>;
    try {
      result = await (await getRemote()).save(normalized);
    } catch (error) {
      result = createFailureResult('saveEngagement', error);
    }
    // El espejo guarda lo confirmado cuando lo hay —con su revisión nueva— y lo
    // enviado cuando no: en degradación el trabajo no se pierde, y `result` ya
    // dice que sólo está en local.
    const stored = result.success && result.data ? result.data : normalized;
    mirror.upsert(stored.projectId, stored, result);
    return result.success && result.data ? result : { ...result, data: stored };
  }

  async remove(
    projectId: string,
    engagementId: string,
    expectedRevision = 0,
  ): Promise<PersistenceResult<void>> {
    let result: PersistenceResult<void>;
    try {
      result = await (await getRemote()).remove(projectId, engagementId, expectedRevision);
    } catch (error) {
      result = createFailureResult('deleteEngagement', error);
    }
    mirror.remove(projectId, engagementId);
    return result;
  }

  /**
   * Una decisión del ARB y la transición que la aplica, en una transacción.
   *
   * `api.decide_engagement` escribe el registro inmutable —sólo-creación, así
   * que un reintento no firma dos veces— y mueve el encargo dentro de la misma
   * transacción. El espejo `arbDecisions` que el documento lleva para leer
   * rápido lo **reconstruye el servidor** desde ese registro: un espejo que el
   * cliente pueda escribir es un espejo que puede decir algo distinto del
   * rastro inmutable, y la pantalla lee el espejo.
   */
  async decide(
    engagement: OfficeEngagement,
    decision: OfficeArbDecision,
  ): Promise<PersistenceResult<OfficeEngagement>> {
    let result: PersistenceResult<OfficeEngagement>;
    try {
      result = await (await getRemote()).decide(engagement, decision);
    } catch (error) {
      result = createFailureResult('decideEngagement', error);
    }
    // El espejo local sólo recibe lo confirmado. Guardar una decisión que el
    // servidor no aceptó la serviría de vuelta como buena durante los próximos
    // cinco minutos, que es más o menos lo que tarda alguien en cerrar la
    // pestaña creyendo que el comité ya firmó.
    if (result.success && result.data) mirror.upsert(result.data.projectId, result.data, result);
    return result;
  }
}

export const createOfficeEngagementRepository = (): OfficeEngagementRepository =>
  new SupabaseBackedOfficeEngagementRepository();

export const officeEngagementRepository: OfficeEngagementRepository = createOfficeEngagementRepository();
