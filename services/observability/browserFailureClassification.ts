/** Browser error signatures used by the global resilience boundary. */

/** Failed dynamic imports / Vite preload signals, as opposed to app defects. */
export const isChunkLoadFailure = (value: string): boolean => (
  /loading chunk|failed to fetch dynamically imported module|importing a module script failed|module script|vite:preloadError/i.test(value)
);

/** Benign layout notice emitted by canvas libraries during a resize frame. */
export const isResizeObserverLoopNotice = (value: string): boolean => (
  /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(value)
);
