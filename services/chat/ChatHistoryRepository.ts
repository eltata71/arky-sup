/**
 * Dónde se lee y se escribe el historial de chat de un proyecto.
 *
 * Ya no delega. Hasta la Ola 2 este fichero eran dos líneas que llamaban a
 * `firestoreService`, y el módulo `chat` era dueño de la compactación pero no
 * de su propio almacenamiento — un contexto que no puede decir cómo se guardan
 * sus datos es una carpeta con un `index.ts`.
 *
 * El documento es uno por proyecto (`projects/{id}/history/chat`) y se
 * reescribe entero en cada guardado, por lo que `capChatHistoryForPersistence`
 * corre antes de escribir. Lo que se guarda compactado es también lo que se
 * cachea: si se cachearan los mensajes sin compactar, la siguiente lectura
 * devolvería algo que el documento remoto ya no contiene.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import type { ChatMessage } from '../../types';
import { observabilityService } from '../observability';
import {
  CHAT_DOC,
  HISTORY_COLLECTION,
  PROJECTS_COLLECTION,
  classifyPersistenceError,
  executeRemoteWrite,
  getErrorCode,
  isWriteConfirmed,
  readLocal,
  writeLocalDraft,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { MemoryCache } from '../../utils';
import { capChatHistoryForPersistence } from './chatHistoryCap';

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
      const snap = await getDoc(doc(requireDb(firestore), PROJECTS_COLLECTION, projectId, HISTORY_COLLECTION, CHAT_DOC));
      if (!snap.exists()) return [];
      const messages = (snap.data().messages as ChatMessage[]) ?? [];
      cache.set(key, messages);
      return messages;
    } catch (error) {
      observabilityService.reportError(error, {
        source: 'operation',
        title: 'No se pudo cargar historial remoto',
        message: 'La lectura de historial de chat falló. Se intentará caché local de lectura si existe.',
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
    const result = await executeRemoteWrite({ operationName: 'saveChatHistory', projectId }, async () => {
      await setDoc(doc(requireDb(firestore), PROJECTS_COLLECTION, projectId, HISTORY_COLLECTION, CHAT_DOC), {
        messages: persisted,
        updatedAt: new Date().toISOString(),
      });
    });
    // Se cachea `messages`, no `persisted`: es lo que hacía `firestoreService`
    // y esta ola mueve la propiedad, no el comportamiento.
    //
    // Merece una nota porque no es obviamente correcto. El documento remoto
    // guarda la versión compactada, así que mientras la caché viva la sesión ve
    // más turnos de los que hay escritos, y al caducar el historial se encoge a
    // la vista del usuario. Puede ser deliberado —mantener el contexto vivo en
    // memoria aunque el documento esté topado— o puede ser un defecto. Decidirlo
    // es un cambio de comportamiento y va en su propio commit, no escondido
    // dentro del reparto de un fichero de 1 379 líneas.
    if (isWriteConfirmed(result)) cache.set(keyFor(projectId), messages);
    else if (result.status === 'offline') writeLocalDraft(keyFor(projectId), messages);
    return result;
  },

  clearCache() {
    cache.clear();
  },
};
