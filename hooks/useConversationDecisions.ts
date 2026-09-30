/**
 * What the conversation with the agent settled, read when a generation starts
 * (plan de calidad de artefactos, 7.3b).
 *
 * It is a loader, not a value: a decision agreed in the chat a minute ago has
 * to reach the generation that starts now, so the history is read at that
 * moment rather than when the screen opened. It never fails a generation —
 * a history that cannot be read means no decisions, not no artifact.
 */
import { useCallback } from 'react';
import type { ArtifactConversationDigest } from '../lib/artifacts';
import { extractConversationDecisions } from '../services/chat';
import { useAppContext } from '../context/AppContext';

export const useConversationDecisions = (): ((projectId: string) => Promise<ArtifactConversationDigest | undefined>) => {
  const { loadChatHistory } = useAppContext();
  return useCallback(async (projectId: string) => {
    try {
      const digest = extractConversationDecisions(await loadChatHistory(projectId));
      return digest.decisions.length > 0 ? digest : undefined;
    } catch {
      return undefined;
    }
  }, [loadChatHistory]);
};
