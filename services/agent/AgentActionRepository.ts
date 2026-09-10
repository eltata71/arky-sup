/**
 * El registro de lo que hizo el agente, y de qué versión de artefacto dejó.
 *
 * Ya no delega. Su persistencia vivía en `services/firestoreService.ts` con
 * la de otros cinco contextos; ahora este módulo dice cómo se guardan sus
 * propios datos.
 *
 * Es **el mejor esfuerzo, a propósito**: un fallo al escribir no se propaga,
 * porque la versión del artefacto es la fuente de verdad para deshacer, no
 * este registro. El espejo local es lo que alimenta el panel de historial
 * cuando Firestore no contesta.
 *
 * `agent_actions` es la única colección del producto con un `orderBy`, y es de
 * un solo campo — por eso `firestore.indexes.json` no existe y no debe crearse
 * hasta que haya un índice compuesto de verdad.
 */

import { collection, doc, getDocs, limit as firestoreLimit, orderBy, query, setDoc } from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
  AGENT_ACTIONS_COLLECTION,
  MirroredList,
  PROJECTS_COLLECTION,
  executeRemoteWrite,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import type { AgentActionRecord } from './agentTypes';

/** Lo que cabe en el panel de historial y en el espejo local. */
const MAX_RETAINED = 200;
const DEFAULT_PAGE = 50;

export interface AgentActionRepository {
  append(projectId: string, record: AgentActionRecord): Promise<PersistenceResult<unknown>>;
  list(projectId: string, options?: { artifactId?: string; limit?: number }): Promise<AgentActionRecord[]>;
  clearCache(): void;
}

// `MirroredList` quiere un `id`; el de una acción del agente es su `traceId`.
type MirroredAction = AgentActionRecord & { id: string };
const withId = (record: AgentActionRecord): MirroredAction => ({ ...record, id: record.traceId });

const mirror = new MirroredList<MirroredAction>((projectId) => `agent_actions_${projectId}`);

export const agentActionRepository: AgentActionRepository = {
  async append(projectId, record) {
    const result = await executeRemoteWrite({ operationName: 'logAgentAction', projectId }, async () => {
      await setDoc(
        doc(requireDb(firestore), PROJECTS_COLLECTION, projectId, AGENT_ACTIONS_COLLECTION, record.traceId),
        sanitizeForFirestore(record),
      );
    });
    mirror.upsert(projectId, withId(record), result, MAX_RETAINED);
    return result;
  },

  async list(projectId, options = {}) {
    const cap = Math.max(1, Math.min(MAX_RETAINED, options.limit ?? DEFAULT_PAGE));
    let records = mirror.cached(projectId);
    if (!records) {
      try {
        const snapshot = await getDocs(query(
          collection(requireDb(firestore), PROJECTS_COLLECTION, projectId, AGENT_ACTIONS_COLLECTION),
          orderBy('createdAt', 'desc'),
          firestoreLimit(cap),
        ));
        records = mirror.remember(projectId, snapshot.docs.map((d) => withId(d.data() as AgentActionRecord)));
      } catch {
        records = mirror.fallback(projectId);
      }
    }
    const filtered = options.artifactId
      ? records.filter((r) => r.artifactVersionGroupId === options.artifactId
        || r.previousArtifactVersionId === options.artifactId
        || r.newArtifactVersionId === options.artifactId)
      : records;
    return filtered.slice(0, cap);
  },

  clearCache() {
    mirror.clear();
  },
};
