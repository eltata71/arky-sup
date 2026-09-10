/**
 * The chat-history document is bounded.
 *
 * `saveChatHistory` rewrites the whole `messages[]` array into a single
 * document on every save, and nothing capped it. A long-running project
 * conversation walks into Firestore's 1 MiB limit and then simply stops
 * saving — the second uncapped surface on the project, and the one the audit
 * did not mention at all.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../services/chat';

vi.mock('../../firebase', () => ({ db: {}, auth: {}, isFirebaseAvailable: true }));
vi.mock('../../services/observability', () => ({
  observabilityService: { recordWarning: vi.fn(), reportError: vi.fn(), trackEvent: vi.fn(() => ({})) },
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(),
  updateDoc: vi.fn(), deleteDoc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(),
  query: vi.fn(), where: vi.fn(), limit: vi.fn(),
}));

import { capChatHistoryForPersistence } from '../../services/chat';

const message = (i: number, size = 40): ChatMessage => ({
  role: i % 2 === 0 ? 'user' : 'model',
  content: `m${i} ${'x'.repeat(size)}`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
});

/** Enough conversation to blow the 400 KB budget. */
const hugeHistory = (): ChatMessage[] => Array.from({ length: 400 }, (_, i) => message(i, 1500));

describe('an ordinary conversation is untouched', () => {
  it('returns the same array when it fits', () => {
    const messages = Array.from({ length: 50 }, (_, i) => message(i));
    expect(capChatHistoryForPersistence('project-1', messages)).toBe(messages);
  });

  it('handles an empty history', () => {
    const empty: ChatMessage[] = [];
    expect(capChatHistoryForPersistence('project-1', empty)).toBe(empty);
  });
});

describe('an oversized conversation is compacted', () => {
  it('drops below the budget', () => {
    const capped = capChatHistoryForPersistence('project-1', hugeHistory());
    expect(JSON.stringify(capped).length).toBeLessThan(400_000);
  });

  it('keeps the most recent turns verbatim, so live context is not eaten', () => {
    const messages = hugeHistory();
    const capped = capChatHistoryForPersistence('project-1', messages);
    const last = messages[messages.length - 1];
    expect(capped[capped.length - 1].content).toBe(last.content);
  });

  it('replaces the older turns with a marker the UI already renders', () => {
    const capped = capChatHistoryForPersistence('project-1', hugeHistory());
    expect(capped[0].meta?.kind).toBe('compaction');
    expect(capped[0].meta?.compactedCount).toBeGreaterThan(0);
    expect(capped[0].content.length).toBeGreaterThan(0);
  });

  it('records the range it compacted', () => {
    const messages = hugeHistory();
    const capped = capChatHistoryForPersistence('project-1', messages);
    expect(capped[0].meta?.compactedRange?.start).toBe(messages[0].timestamp);
  });

  it('shrinks the kept tail when a few enormous turns still exceed the budget', () => {
    // One 500 KB message cannot be kept whole alongside 29 others.
    const messages = Array.from({ length: 40 }, (_, i) => message(i, 20_000));
    const capped = capChatHistoryForPersistence('project-1', messages);
    expect(JSON.stringify(capped).length).toBeLessThan(400_000);
    expect(capped.length).toBeLessThan(messages.length);
  });

  it('never returns an empty history, however large the final turn is', () => {
    const messages = [message(0, 10), { role: 'model' as const, content: 'y'.repeat(600_000) }];
    const capped = capChatHistoryForPersistence('project-1', messages);
    expect(capped.length).toBeGreaterThanOrEqual(1);
  });
});
