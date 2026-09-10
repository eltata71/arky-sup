/**
 * The chat context: its model, its compaction, its persistence and the session
 * grouping the Memory Center renders.
 *
 * The module had no barrel, which meant it had no public API: whatever a
 * caller happened to import became one. `modules.json` declares this file as
 * the entrance and `check:module-boundaries` enforces it.
 */
export * from './chatCompactor';
export { chatHistoryRepository, type ChatHistoryRepository } from './ChatHistoryRepository';
export { capChatHistoryForPersistence } from './chatHistoryCap';
export * from './ChatTypes';
export * from './chatHistory';
