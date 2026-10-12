/**
 * Dónde se lee y se escribe el historial de chat de un proyecto.
 *
 * Un registro por mensaje en `api.project_chat_messages` (14.3, R-03/T-06).
 * `save` solo AÑADE, de forma idempotente por id: dos pestañas sobre el mismo
 * proyecto no se pisan, porque ninguna reescribe lo que la otra escribió. Lo
 * único que quita mensajes es `replace`, la operación explícita del Centro de
 * Memoria (borrar o compactar), y por eso es la única que pasa por
 * `capChatHistoryForPersistence`.
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
  /** Añade lo que el servidor aún no tiene; nunca quita mensajes. */
  save(projectId: string, messages: ChatMessage[]): Promise<PersistenceResult<unknown>>;
  /** Sustituye la lista entera: borrar o compactar. */
  replace(projectId: string, messages: ChatMessage[]): Promise<PersistenceResult<unknown>>;
  clearCache(): void;
}

const cache = new MemoryCache();
const keyFor = (projectId: string): string => `chat_${projectId}`;
const sent = new Map<string, Set<string>>();

const hashText = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

// Un mensaje sin id (historial antiguo) recibe uno estable derivado de su
// contenido, para que reenviarlo sea idempotente en vez de duplicarlo.
const withMessageId = (message: ChatMessage): ChatMessage & { id: string } =>
  message.id
    ? (message as ChatMessage & { id: string })
    : { ...message, id: `legacy-${hashText(`${message.role}|${message.timestamp ?? ''}|${message.content}`)}` };

export const chatHistoryRepository: ChatHistoryRepository = {
  async load(projectId) {
    const key = keyFor(projectId);
    const cached = cache.get<ChatMessage[]>(key);
    if (cached) return cached;
    try {
      const rows = await callRpc<unknown>('load_chat_history', { p_project_id: projectId });
      const messages = Array.isArray(rows) ? (rows as ChatMessage[]) : [];
      cache.set(key, messages);
      sent.set(projectId, new Set(messages.map((m) => m.id).filter((id): id is string => Boolean(id))));
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
    const withIds = messages.map(withMessageId);
    const known = sent.get(projectId) ?? new Set<string>();
    const pending = withIds.filter((m) => !known.has(m.id));
    let result: PersistenceResult<unknown>;
    try {
      result = pending.length === 0
        ? await executeRemoteWrite({ operationName: 'saveChatHistory', projectId }, async () => 0)
        : await executeRemoteWrite({ operationName: 'saveChatHistory', projectId }, () =>
          callRpc<number>('append_chat_messages', { p_project_id: projectId, p_messages: pending }));
    } catch (error) {
      result = createFailureResult('saveChatHistory', error);
    }
    if (isWriteConfirmed(result)) {
      sent.set(projectId, new Set([...known, ...pending.map((m) => m.id)]));
      cache.set(keyFor(projectId), withIds);
    } else if (result.status === 'offline') writeLocalDraft(keyFor(projectId), withIds);
    return result;
  },

  async replace(projectId, messages) {
    const persisted = capChatHistoryForPersistence(projectId, messages).map(withMessageId);
    let result: PersistenceResult<unknown>;
    try {
      result = await executeRemoteWrite({ operationName: 'replaceChatHistory', projectId }, () =>
        callRpc<number>('replace_chat_history', { p_project_id: projectId, p_messages: persisted }));
    } catch (error) {
      result = createFailureResult('replaceChatHistory', error);
    }
    if (isWriteConfirmed(result)) {
      sent.set(projectId, new Set(persisted.map((m) => m.id)));
      cache.set(keyFor(projectId), persisted);
    } else if (result.status === 'offline') writeLocalDraft(keyFor(projectId), persisted);
    return result;
  },

  clearCache() {
    cache.clear();
    sent.clear();
  },
};
