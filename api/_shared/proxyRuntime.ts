/**
 * Shared runtime for the Vercel serverless AI proxy (`api/ai.ts`; the legacy
 * Gemini-only `api/gemini.ts` it also served was retired in F6-01).
 *
 * Files/directories prefixed with `_` inside `api/` are NOT turned into
 * routes by Vercel, so this module is safe to keep next to the handlers.
 *
 * It owns everything that is transport-level rather than provider-level:
 * body reading, caller identity, the in-memory rate-limit bucket, the JSON
 * error envelope and provider error-status normalisation. Provider calls
 * themselves live in the individual handlers.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { TRACE_ID_HEADER, resolveTraceId } from '../../lib/traceId.js';

export type JsonRecord = Record<string, unknown>;

export type ResponseWithJson = ServerResponse & {
  status: (code: number) => ResponseWithJson;
  json: (body: JsonRecord) => void;
};

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 60;
/** Defensive cap so a malformed/hostile client can't buffer unbounded memory. */
const MAX_BODY_BYTES = 2_000_000;

const buckets = new Map<string, RateLimitBucket>();

/** Sweep threshold for the bucket map — see `consumeRateLimit`. */
const MAX_TRACKED_CLIENTS = 5_000;

export const readBody = async <T extends object>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
};

export const readHeader = (req: IncomingMessage, name: string): string | undefined => {
  const raw = req.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const sanitizeIdentityPart = (value: string, maxLength = 96): string =>
  value.replace(/[^a-zA-Z0-9._:@-]/g, '').slice(0, maxLength) || 'unknown';

const getForwardedIp = (req: IncomingMessage): string => {
  const forwardedFor = readHeader(req, 'x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || req.socket.remoteAddress || 'anonymous-ip';
};

/**
 * The key a request is rate-limited under.
 *
 * `verifiedUid` comes from a checked ID token and is the only identity worth
 * budgeting against. The header fallbacks below are written by the caller, so
 * rotating one yields an unlimited supply of fresh buckets — they remain only
 * for the explicitly unauthenticated mode, where there is nothing better, and
 * IP+UA is the last resort because it is the one part the caller does not
 * fully choose.
 */
export const getClientId = (req: IncomingMessage, verifiedUid?: string): string => {
  if (verifiedUid) return `uid:${sanitizeIdentityPart(verifiedUid)}`;

  const sessionId = readHeader(req, 'x-arky-session-id');
  if (sessionId) return `session:${sanitizeIdentityPart(sessionId)}`;

  const ip = getForwardedIp(req);
  const userAgent = readHeader(req, 'user-agent') ?? 'unknown-ua';
  const userAgentPrefix = userAgent.slice(0, 80).replace(/\s+/g, ' ');
  return `ipua:${sanitizeIdentityPart(ip)}:${sanitizeIdentityPart(userAgentPrefix, 80)}`;
};

/**
 * Models this proxy is willing to spend the operator's keys on.
 *
 * With several providers behind one endpoint, a model chosen freely by the
 * client is a bill chosen freely by the client. The list is configuration
 * rather than code because the right ceiling is a deployment decision, and it
 * is unset by default so existing deployments keep working — an operator opts
 * into the tighter posture rather than being surprised by it.
 */
export const isModelAllowed = (model: string): boolean => {
  const raw = process.env.AI_PROXY_ALLOWED_MODELS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return true;
  const allowed = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(model.trim());
};

const getMaxRequestsPerWindow = (envVar: string): number => {
  const raw = process.env[envVar];
  const parsed = raw ? Number(raw) : DEFAULT_MAX_REQUESTS_PER_WINDOW;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_REQUESTS_PER_WINDOW;
  return Math.floor(parsed);
};

export const consumeRateLimit = (
  clientId: string,
  envVar: string,
): { allowed: boolean; retryAfterMs?: number; limit: number } => {
  const now = Date.now();
  const limit = getMaxRequestsPerWindow(envVar);

  // Drop expired buckets on the way past. Without this the map only ever grows,
  // and a long-lived instance accumulates one entry per identity ever seen.
  if (buckets.size > MAX_TRACKED_CLIENTS) {
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }

  const bucket = buckets.get(clientId);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now), limit };
  }
  bucket.count += 1;
  return { allowed: true, limit };
};

export const resetRateLimitBuckets = (): void => {
  buckets.clear();
};

export const sendJson = (
  res: ResponseWithJson,
  status: number,
  body: JsonRecord,
  retryAfterMs?: number,
): void => {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
  }
  res.status(status).json(body);
};

export const readStatus = (error: unknown): number => {
  if (!error || typeof error !== 'object') return 500;
  const candidate = error as { status?: unknown; code?: unknown; error?: { code?: unknown } };
  const status = candidate.status ?? candidate.code ?? candidate.error?.code;
  return typeof status === 'number' ? status : 500;
};

export const readProviderRetryAfterMs = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { retryAfterMs?: unknown; retryAfter?: unknown; headers?: { get?: (name: string) => string | null } };
  const raw = candidate.retryAfterMs ?? candidate.retryAfter ?? candidate.headers?.get?.('Retry-After') ?? candidate.headers?.get?.('retry-after');
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1000 ? raw : raw * 1000;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  return undefined;
};

export const createProxyLogger = (tag: string) =>
  (level: 'info' | 'warn' | 'error', event: string, metadata: JsonRecord): void => {
    const safeMetadata = { ...metadata };
    if ('apiKey' in safeMetadata) delete safeMetadata.apiKey;
    console[level](tag, event, safeMetadata);
  };

export const newRequestId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The caller's trace id when it is one we are willing to log, a fresh one
 * otherwise.
 *
 * The proxy used to mint its own id unconditionally and discard whatever the
 * browser had, which meant the browser event and the server log line could
 * never be joined — the correlation was lost at precisely the hop that matters
 * most, because it is the one the user cannot see.
 *
 * The header is written by the caller, so `resolveTraceId` validates it
 * against a strict charset before it is echoed or logged: a value carrying a
 * newline would forge log entries.
 */
export const resolveRequestId = (req: IncomingMessage, prefix: string): string =>
  resolveTraceId(readHeader(req, TRACE_ID_HEADER), prefix);
