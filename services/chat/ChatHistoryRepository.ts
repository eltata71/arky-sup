/**
 * Dónde se lee y se escribe el historial de chat de un proyecto.
 *
 * Una fila por proyecto en `api.project_chat_history`, reescrita entera en cada
 * guardado, por lo que `capChatHistoryForPersistence` corre antes de escribir.
 * Lo que se guarda compactado es también lo que se cachea: si se cachearan los
 * mensajes sin compactar, la siguiente lectura devolvería algo que la fila
 * remota ya no contiene.
 *
 * **Este fichero está en el camino de arranque** —`AppContext` →
 * `useProjectsState` → `ArchitectureProjectRepository` → `projectWrites` lo
 * importa por ruta de fichero— así que no puede alcanzar la capa de IA. Sus
 * únicas dependencias son la puerta de datos, observabilidad, persistencia y el
 * tope de historial, y `compactionDigest` existe precisamente para que el tope
 * no tenga que entrar por un fichero que llama a un modelo.
 */

import type { ChatMessage } from './ChatTypes';
import { observabilityService } from '../observability';
import {
  classifyPersistenceError,
  createFailureResult,
  executeRemoteWrite,
  getErrorCode,
  isWriteConfirmed,
  readLocal,
  writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { MemoryCache } from '../../utils';
import { capChatHistoryForPersistence } from './chatHistoryCap';
import { callRpc } from '../adapters';

export interface ChatHistoryRepository {
  load(projectId: string): Promise<ChatMessage[]>;
  save(projectId: string, messages: ChatMessage[]): Promise<PersistenceResult<unknown>>;
  clearCache(): void;
}

const cache = new MemoryCache();
const keyFor = (projectId: string): string => `chat_${projectId}`;

export const chatHistoryRepository: ChatHistoryRepository = {
  async load(projectId) {
    const key = keyFor(projectId);
    const cached = cache.get<ChatMessage[]>(key);
    if (cached) return cached;
    try {
      const rows = await callRpc<unknown>('load_chat_history', { p_project_id: projectId });
      const messages = Array.isArray(rows) ? (rows as ChatMessage[]) : [];
      cache.set(key, messages);
      return messages;
    } catch (error) {
      observabilityService.reportError(error, {
        source: 'operation',
        title: 'No se pudo cargar historial remoto',
        message: 'La lectura de historial de chat falló. Se intentará el espejo local si existe.',
        operationName: `getChatHistory(${projectId})`,
        recoverable: true,
        userVisible: true,
        metadata: { projectId, errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
      });
      return readLocal<ChatMessage[]>(key) ?? [];
    }
  },

  async save(projectId, messages) {
    const persisted = capChatHistoryForPersistence(projectId, messages);
    let result: PersistenceResult<unknown>;
    try {
      result = await executeRemoteWrite({ operationName: 'saveChatHistory', projectId }, () =>
        callRpc<void>('save_chat_history', { p_project_id: projectId, p_messages: persisted }));
    } catch (error) {
      result = createFailureResult('saveChatHistory', error);
    }
    // Se cachea `messages`, no `persisted`: mientras la caché viva la sesión ve
    // más turnos de los que hay escritos, y al caducar el historial se encoge a
    // la vista del usuario. Es el comportamiento que traía `firestoreService`;
    // cambiarlo es una decisión de producto y va en su propio commit, no
    // escondida dentro de un cambio de proveedor.
    if (isWriteConfirmed(result)) cache.set(keyFor(projectId), messages);
    else if (result.status === 'offline') writeLocalDraft(keyFor(projectId), messages);
    return result;
  },

  clearCache() {
    cache.clear();
  },
};
