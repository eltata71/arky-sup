/**
 * One identifier for one piece of work, from the click to the provider.
 *
 * Three id schemes coexisted and none of them met: `services/ai/tracing` minted
 * `ai-*` request ids, `api/ai.ts` minted its own `aiproxy-*` on the server and
 * ignored whatever the client had, and `services/agent` carried a `traceId`
 * that never left the agent. `ObservabilityEvent` had neither. So a user
 * reporting "generation failed" produced a browser event, a proxy log line and
 * possibly an agent trace, with nothing tying them together — which is the
 * moment correlation is worth anything.
 *
 * This module is deliberately dependency-free and shared by both sides of the
 * wire: the client mints, the serverless function accepts. A format defined in
 * two places is a format that drifts.
 */

/**
 * Trace ids travel in an HTTP header and end up in log lines. The charset is
 * therefore restricted rather than merely conventional: a header is written by
 * whoever is calling, and a value carrying a newline forges log entries.
 */
const TRACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/** Longest value accepted from a header, before the pattern is even tried. */
export const MAX_TRACE_ID_LENGTH = 64;

const slug = (value: string): string => (value || 'op')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 24) || 'op';

/**
 * Mint a trace id for one unit of work.
 *
 * `purpose` is embedded so a log line is readable without a lookup — the point
 * is that someone reading a proxy log can tell an artifact generation from a
 * lesson without joining anything.
 */
export function newTraceId(purpose: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${slug(purpose)}-${Date.now().toString(36)}-${random}`.slice(0, MAX_TRACE_ID_LENGTH);
}

/**
 * Whether a value is a trace id this system is willing to log and echo.
 *
 * Used on the server against a client-supplied header, so it is a validation
 * boundary, not a formality.
 */
export function isTraceId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_TRACE_ID_LENGTH
    && TRACE_ID_PATTERN.test(value);
}

/**
 * The caller's trace id, or a fresh one.
 *
 * Never throws and never propagates an untrusted value: an absent, malformed
 * or over-long header yields a newly minted id, so a request is always
 * traceable and a hostile header is never echoed back or written to a log.
 */
export function resolveTraceId(candidate: unknown, purpose: string): string {
  return isTraceId(candidate) ? candidate : newTraceId(purpose);
}

/** The header both sides agree on. */
export const TRACE_ID_HEADER = 'x-arky-trace-id';
