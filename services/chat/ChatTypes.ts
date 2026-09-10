/**
 * A chat message and the metadata a turn carries.
 *
 * The `chat` module already owned compaction and, since the persistence pass,
 * its repository. This is the last piece: its own model, out of the root
 * `types.ts` where every other context paid for it.
 *
 * Re-exported from `types.ts` for existing callers.
 */

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  /**
   * Optional stable id. Populated for all NEW messages created after the
   * history-management feature; older persisted messages may lack one and
   * the UI must tolerate that (it falls back to position-based identity).
   */
  id?: string;
  /** ISO timestamp at which the message was created. Optional for backward compat. */
  timestamp?: string;
  /** Optional metadata for special messages (e.g. compaction markers). */
  meta?: ChatMessageMeta;
}

/**
 * Metadata for special chat messages. Today the only consumer is the
 * "compaction marker" — a single message that replaces a range of older
 * messages so the persisted history can be summarised without losing the
 * key concepts. The UI renders these with a distinct visual treatment.
 */
export interface ChatMessageMeta {
  kind?: 'compaction';
  compactedCount?: number;
  compactedRange?: { start: string; end: string };
  compactedTopics?: string[];
}
