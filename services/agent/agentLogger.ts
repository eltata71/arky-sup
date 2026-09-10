/**
 * Append-only, in-memory + console trace for agent actions.
 *
 * Goals:
 *  - Correlation: every event for a given plan carries the same `traceId`.
 *  - Cheap: zero network, zero React state. Subscribers (e.g. the action card
 *    that wants to show "Validating quality…") pull via `getTrace(traceId)`.
 *  - Non-fatal: any failure to log silently degrades; nothing throws.
 */

import type { AgentTraceEvent } from './agentTypes';

const MAX_EVENTS_IN_MEMORY = 500;
const EVENTS: AgentTraceEvent[] = [];

const SUBSCRIBERS = new Set<(event: AgentTraceEvent) => void>();

export function newTraceId(): string {
  // Compact, sortable, RFC-friendly enough.
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logAgentEvent(event: Omit<AgentTraceEvent, 'at'>): AgentTraceEvent {
  const full: AgentTraceEvent = { ...event, at: new Date().toISOString() };
  EVENTS.push(full);
  if (EVENTS.length > MAX_EVENTS_IN_MEMORY) {
    EVENTS.splice(0, EVENTS.length - MAX_EVENTS_IN_MEMORY);
  }
  // Mirror to console, prefixed so it groups in DevTools filters.
  const tag = `[agent:${full.phase}]`;
  const args = [tag, full.message, full.meta ?? {}];
  if (full.level === 'error') console.error(...args);
  else if (full.level === 'warn') console.warn(...args);
  else console.info(...args);

  for (const handler of SUBSCRIBERS) {
    try {
      handler(full);
    } catch {
      // Subscriber failure must never break execution.
    }
  }
  return full;
}

export function getTrace(traceId: string): AgentTraceEvent[] {
  return EVENTS.filter((e) => e.traceId === traceId);
}

export function subscribeAgentTrace(handler: (event: AgentTraceEvent) => void): () => void {
  SUBSCRIBERS.add(handler);
  return () => {
    SUBSCRIBERS.delete(handler);
  };
}
