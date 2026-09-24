/**
 * The chat context: its model, its deterministic compaction, its persistence
 * and the session grouping the Memory Center renders. Compaction with a model
 * is `services/ai` (`compactChatMessages`) since F5-03: this module imports no
 * AI, which is what lets the project aggregate write chat history without
 * closing a cycle.
 *
 * The module had no barrel, which meant it had no public API: whatever a
 * caller happened to import became one. `modules.json` declares this file as
 * the entrance and `check:module-boundaries` enforces it.
 */
export { deterministicCompactionDigest, type CompactionDigest } from './compactionDigest';
export { chatHistoryRepository, type ChatHistoryRepository } from './ChatHistoryRepository';
export { capChatHistoryForPersistence } from './chatHistoryCap';
export * from './ChatTypes';
export * from './chatHistory';
