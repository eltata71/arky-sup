/**
 * The compaction digest, and the way to build one without a model.
 *
 * Both lived in `chatCompactor.ts` next to `compactChatMessages`, which calls
 * `aiGateway` — and that adjacency had a measurable cost. `chatHistoryCap`
 * needs only the deterministic fallback to cap a history before writing it, and
 * `projectWrites` needs `chatHistoryCap` on the application's boot path. So
 * `AppContext` reached the chat repository, which reached the cap, which
 * reached the compactor, which imported the `services/ai` barrel, which
 * re-exports `generation`, which reaches the 5 400-line engine. The entire AI
 * layer was downloaded before the login screen rendered, in order to count the
 * roles in a list of messages.
 *
 * It is the same rule the repository already applies to the deterministic
 * artifact fallbacks, which are `services/artifacts` and not `services/ai`:
 * **a pure function that never calls a model does not live behind a door that
 * does.** Splitting the file is what lets the compactor stay where it is.
 */

import type { ChatMessage } from './ChatTypes';

export interface CompactionDigest {
  /** Title summarising the compacted range. */
  title: string;
  /** Key decisions / conclusions worth preserving. */
  decisions: string[];
  /** Open questions or follow-ups discussed in the range. */
  openQuestions: string[];
  /** Topics covered — used both for the marker preview and for future search. */
  topics: string[];
  /** Free-form summary paragraph (≤ ~600 chars). */
  summary: string;
}

/**
 * Deterministic, AI-less fallback. Builds a usable digest from the raw
 * message list: counts roles, extracts the first user prompt as the title
 * and concatenates the headlines of subsequent messages. Always succeeds.
 */
export function deterministicCompactionDigest(messages: ChatMessage[]): CompactionDigest {
  if (messages.length === 0) {
    return {
      title: 'Sin mensajes',
      summary: 'No había mensajes para compactar.',
      decisions: [],
      openQuestions: [],
      topics: [],
    };
  }
  const firstUser = messages.find((m) => m.role === 'user');
  const title = (firstUser?.content ?? messages[0].content)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 88);
  const userCount = messages.filter((m) => m.role === 'user').length;
  const modelCount = messages.length - userCount;
  const summary =
    `Conversación compactada con ${messages.length} mensaje(s) ` +
    `(${userCount} del usuario · ${modelCount} del Arquitecto Agente). ` +
    `Tema inicial: "${title}".`;
  return {
    title: title || 'Conversación compactada',
    summary: summary.slice(0, 700),
    decisions: [],
    openQuestions: [],
    topics: [],
  };
}
