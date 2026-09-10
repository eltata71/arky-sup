/**
 * Pure utilities for chat history management.
 *
 * Two responsibilities:
 *  - Message factory: produce ChatMessage instances with stable id + ISO
 *    timestamp so the history-management UI can filter, search and select
 *    them deterministically.
 *  - Session grouping & filtering: turn a flat ChatMessage[] into the
 *    user-facing "sessions" rendered in the Memory Center.
 *
 * Stateless on purpose — every function is sync, deterministic and trivially
 * unit-testable.
 *
 * It lived in `utils/`, which is the foundation layer, and operated entirely on
 * `ChatMessage`. When that model moved into this module the file followed it:
 * `foundation` may not depend on `domain`, and a chat-session grouper is chat
 * domain wherever the folder says it is.
 */

import type { ChatMessage, ChatMessageMeta } from './ChatTypes';

/** Maximum gap (ms) between two consecutive messages before we split them into separate sessions. */
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const FALLBACK_TIMESTAMP_PREFIX = '1970-01-01T00:00:00.000Z';

let counter = 0;
const newMessageId = (): string =>
  `msg-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Factory for new chat messages. ALWAYS use this for messages destined to be
 * persisted — populating the id + timestamp up-front means the history
 * management UI can manage them. Older persisted messages without these
 * fields keep working: utilities below tolerate missing values.
 */
export function createChatMessage(
  role: ChatMessage['role'],
  content: string,
  options: { meta?: ChatMessageMeta; id?: string; timestamp?: string } = {},
): ChatMessage {
  return {
    role,
    content,
    id: options.id ?? newMessageId(),
    timestamp: options.timestamp ?? new Date().toISOString(),
    ...(options.meta ? { meta: options.meta } : {}),
  };
}

/**
 * Ensure every message in the array has an id. Backward-compat helper: when
 * we load older persisted histories we want to render them as managed items
 * without forcing a write-back to Firestore. Index-based ids are stable for
 * the rendered list but not portable across edits — anything destructive
 * (delete/compact) is performed by re-comparing arrays, not by id.
 */
export function ensureMessageIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m, idx) => (m.id ? m : { ...m, id: `legacy-${idx}-${hashContent(m.content)}` }));
}

/** Cheap, stable hash for legacy message ids — collision risk is negligible at our scale. */
const hashContent = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36).slice(0, 6);
};

/** A logical conversation chunk derived from contiguous messages. */
export interface ChatSession {
  id: string;
  startedAt: string;
  endedAt: string;
  /** Local date string (YYYY-MM-DD) of the session for day-level grouping. */
  day: string;
  messages: ChatMessage[];
  /** Quick stats used by the list view (no need to recompute on every render). */
  stats: {
    userMessages: number;
    modelMessages: number;
    totalCharacters: number;
    hasCompaction: boolean;
  };
}

/** Get a stable timestamp, falling back to a sentinel for legacy messages. */
const getTimestamp = (m: ChatMessage): string => m.timestamp ?? FALLBACK_TIMESTAMP_PREFIX;

/** Local-day string (YYYY-MM-DD) for grouping; legacy messages share the sentinel day. */
const localDay = (iso: string): string => {
  if (iso === FALLBACK_TIMESTAMP_PREFIX) return 'sin-fecha';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin-fecha';
  // Use local time so a "today" filter matches the user's expectation.
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
};

/**
 * Group a flat message array into sessions. Sessions are delimited by:
 *  - A day boundary (different local day → new session).
 *  - A gap of more than `SESSION_GAP_MS` between two consecutive timestamps.
 *  - A compaction marker (always starts its own session — visually distinct).
 */
export function groupMessagesIntoSessions(messages: ChatMessage[]): ChatSession[] {
  const withIds = ensureMessageIds(messages);
  if (withIds.length === 0) return [];
  const sessions: ChatSession[] = [];
  let current: ChatMessage[] = [];

  const flush = () => {
    if (current.length === 0) return;
    sessions.push(buildSession(current));
    current = [];
  };

  for (let i = 0; i < withIds.length; i++) {
    const msg = withIds[i];
    const prev = withIds[i - 1];
    const isCompaction = msg.meta?.kind === 'compaction';
    const prevIsCompaction = prev?.meta?.kind === 'compaction';

    if (prev) {
      const prevDay = localDay(getTimestamp(prev));
      const currDay = localDay(getTimestamp(msg));
      const dayChanged = prevDay !== currDay;
      const tPrev = Date.parse(getTimestamp(prev));
      const tCurr = Date.parse(getTimestamp(msg));
      const gap = Number.isFinite(tPrev) && Number.isFinite(tCurr) ? tCurr - tPrev : 0;
      const gapTooBig = gap > SESSION_GAP_MS;
      if (isCompaction || prevIsCompaction || dayChanged || gapTooBig) {
        flush();
      }
    }
    current.push(msg);
  }
  flush();
  return sessions;
}

const buildSession = (messages: ChatMessage[]): ChatSession => {
  const startedAt = getTimestamp(messages[0]);
  const endedAt = getTimestamp(messages[messages.length - 1]);
  const userMessages = messages.filter((m) => m.role === 'user').length;
  const modelMessages = messages.length - userMessages;
  const totalCharacters = messages.reduce((sum, m) => sum + m.content.length, 0);
  const hasCompaction = messages.some((m) => m.meta?.kind === 'compaction');
  return {
    id: `session-${messages[0].id ?? hashContent(messages[0].content)}`,
    startedAt,
    endedAt,
    day: localDay(startedAt),
    messages,
    stats: { userMessages, modelMessages, totalCharacters, hasCompaction },
  };
};

export interface ChatHistoryFilters {
  /** Free-text query — matched against message content (case-insensitive). */
  query?: string;
  /** From (inclusive) ISO date — sessions whose `endedAt` >= this. */
  fromDate?: string;
  /** To (inclusive) ISO date — sessions whose `startedAt` <= this (end of day). */
  toDate?: string;
  /** Filter by message role. `'all'` means no filter. */
  role?: 'all' | 'user' | 'model';
  /** When true, keep only sessions that contain at least one compaction marker. */
  onlyCompacted?: boolean;
  /** When true, keep only sessions that contain NO compaction marker. */
  onlyUncompacted?: boolean;
}

/**
 * Filter a list of sessions in-memory. Returns sessions where AT LEAST ONE
 * message matches the criteria — never removes individual messages from a
 * session (so the user always sees the full context when previewing a hit).
 */
export function filterSessions(sessions: ChatSession[], filters: ChatHistoryFilters): ChatSession[] {
  const normalisedQuery = filters.query?.trim().toLowerCase() ?? '';
  const fromTs = filters.fromDate ? Date.parse(filters.fromDate) : null;
  // Interpret the `toDate` as end-of-day so a single-day filter (from=to) works.
  const toTs = filters.toDate ? Date.parse(filters.toDate) + (24 * 60 * 60 * 1000 - 1) : null;
  return sessions.filter((session) => {
    if (filters.onlyCompacted && !session.stats.hasCompaction) return false;
    if (filters.onlyUncompacted && session.stats.hasCompaction) return false;
    if (fromTs && Date.parse(session.endedAt) < fromTs) return false;
    if (toTs && Date.parse(session.startedAt) > toTs) return false;
    if (filters.role && filters.role !== 'all') {
      const hasRole = session.messages.some((m) => m.role === filters.role);
      if (!hasRole) return false;
    }
    if (normalisedQuery) {
      const hasMatch = session.messages.some((m) => m.content.toLowerCase().includes(normalisedQuery));
      if (!hasMatch) return false;
    }
    return true;
  });
}

/** Cheap title for a session — first user message (or first message if none). */
export function getSessionTitle(session: ChatSession): string {
  const firstUser = session.messages.find((m) => m.role === 'user');
  const seed = (firstUser ?? session.messages[0]).content;
  return seed.replace(/\s+/g, ' ').trim().slice(0, 88);
}

/**
 * Subtract a set of message ids from a full chat history. Used to implement
 * "delete N messages" without touching the rest. Tolerates legacy messages
 * by also matching on (role+content+index) when an id is missing.
 */
export function removeMessagesById(messages: ChatMessage[], idsToRemove: Set<string>): ChatMessage[] {
  const withIds = ensureMessageIds(messages);
  return withIds.filter((m) => !idsToRemove.has(m.id ?? '')).map(({ id, ...rest }) => {
    // Preserve the (now stable) id we assigned for legacy messages so the
    // remaining items stay manageable across renders.
    return { ...rest, id };
  });
}

/**
 * Splice a compaction marker into the persisted history: removes the
 * selected messages and inserts the marker at the position of the FIRST
 * removed message. Returns the new array.
 *
 * The caller (Memory Center) builds the marker via `createChatMessage` so
 * the new entry carries an id + timestamp the management UI can keep using.
 */
export function spliceCompactionMarker(
  messages: ChatMessage[],
  idsToRemove: Set<string>,
  marker: ChatMessage,
): ChatMessage[] {
  const withIds = ensureMessageIds(messages);
  const result: ChatMessage[] = [];
  let inserted = false;
  for (const m of withIds) {
    if (idsToRemove.has(m.id ?? '')) {
      if (!inserted) {
        result.push(marker);
        inserted = true;
      }
      continue;
    }
    result.push(m);
  }
  // If the selected set was empty (shouldn't happen but defensive),
  // still append the marker so the caller sees evidence the request ran.
  if (!inserted) result.push(marker);
  return result;
}
