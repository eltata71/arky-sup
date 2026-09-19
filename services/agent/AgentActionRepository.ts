/**
 * El registro de lo que hizo el agente, y de qué versión de artefacto dejó.
 *
 * Es **el mejor esfuerzo, a propósito**: un fallo al escribir no se propaga,
 * porque la versión del artefacto es la fuente de verdad para deshacer, no
 * este registro. El espejo local es lo que alimenta el panel de historial
 * cuando la base de datos no contesta.
 *
 * El orden lo pone `api.list_agent_actions`, que ordena por `created_at`
 * descendente sobre un índice declarado en la migración. En Firestore esto era
 * la única colección con `orderBy` y obligaba a razonar sobre índices
 * compuestos; en PostgreSQL el índice se declara donde se declara la tabla.
 */

import {
  MirroredList,
  createFailureResult,
  executeRemoteWrite,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { callRpc } from '../adapters';
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
    let result: PersistenceResult<unknown>;
    try {
      result = await executeRemoteWrite({ operationName: 'logAgentAction', projectId }, () =>
        callRpc<void>('append_agent_action', { p_project_id: projectId, p_action: record }));
    } catch (error) {
      result = createFailureResult('logAgentAction', error);
    }
    mirror.upsert(projectId, withId(record), result, MAX_RETAINED);
    return result;
  },

  async list(projectId, options = {}) {
    const cap = Math.max(1, Math.min(MAX_RETAINED, options.limit ?? DEFAULT_PAGE));
    let records = mirror.cached(projectId);
    if (!records) {
      try {
        const rows = await callRpc<unknown>('list_agent_actions', { p_project_id: projectId, p_limit: cap });
        const list = Array.isArray(rows) ? (rows as AgentActionRecord[]) : [];
        records = mirror.remember(projectId, list.map(withId));
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
