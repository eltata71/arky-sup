/**
 * The two append-mostly logs a project carries: its chat history and the
 * agent's action trail.
 *
 * Both are best-effort by design, and for different reasons. Chat history
 * reports its outcome — the Memory Center's delete and compact operations show
 * a toast, so `replaceChatHistory` returns whether the write applied. Agent
 * actions do not: the artifact versions are the rollback source of truth, so a
 * missing audit line is a gap in the record, never lost work, and blocking the
 * executor on it would be worse than the gap.
 */

import { useCallback } from 'react';
import type { ChatMessage } from '../../services/chat';
import { chatHistoryRepository } from '../../services/chat/ChatHistoryRepository';
import { agentActionRepository } from '../../services/agent/AgentActionRepository';
import type { AgentActionRecord } from '../../services/agent';
import type { PersistenceReporter } from './usePersistenceReporter';

export const useProjectHistory = (reporter: PersistenceReporter) => {
  const { handleWriteResult } = reporter;

  const saveChatHistory = useCallback(async (projectId: string, messages: ChatMessage[]) => {
      try {
          const result = await chatHistoryRepository.save(projectId, messages);
          handleWriteResult(result, 'Historial de chat guardado en base de datos.');
      } catch (e) {
          console.error("Failed to save chat history remotely", e);
      }
  }, [handleWriteResult]);

  const loadChatHistory = useCallback(async (projectId: string): Promise<ChatMessage[]> => {
      try {
          return await chatHistoryRepository.load(projectId);
      } catch (e) {
          console.error("Failed to load chat history remotely", e);
          return [];
      }
  }, []);

  const replaceChatHistory = useCallback(async (projectId: string, messages: ChatMessage[]): Promise<boolean> => {
      try {
          const result = await chatHistoryRepository.save(projectId, messages);
          handleWriteResult(result, 'Historial de chat actualizado en base de datos.');
          // `success` is the broad flag set by `executeRemoteWrite` for both
          // `confirmed` and `optimistic` outcomes — both states are fine for
          // the UI to treat as "applied" (Firestore retries finish the job).
          return result.success;
      } catch (e) {
          console.error('Failed to replace chat history remotely', e);
          return false;
      }
  }, [handleWriteResult]);

  const logAgentAction = useCallback(async (projectId: string, record: AgentActionRecord) => {
      try {
          // Fire-and-forget — never blocks the UI nor the executor flow.
          await agentActionRepository.append(projectId, record);
      } catch (e) {
          console.warn('[AppContext] logAgentAction failed (record kept locally)', e);
      }
  }, []);

  const listAgentActions = useCallback(async (projectId: string, options?: { artifactId?: string; limit?: number }) => {
      try {
          return await agentActionRepository.list(projectId, options);
      } catch (e) {
          console.warn('[AppContext] listAgentActions failed', e);
          return [];
      }
  }, []);

  return { saveChatHistory, loadChatHistory, replaceChatHistory, logAgentAction, listAgentActions };
};
