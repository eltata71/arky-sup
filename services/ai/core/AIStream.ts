/**
 * AIStream — provider-agnostic streaming primitives.
 *
 * Providers return raw SDK async iterables; `AITextStream` normalises them
 * into `{ text, raw }` chunks so callers consume the same shape regardless of
 * the backend.
 */

export interface AIStreamChunk {
  /** Incremental text delta for this chunk (may be empty). */
  text: string;
  /** Raw provider chunk, exposed for advanced callers. Treat as opaque. */
  raw?: unknown;
}

/** A normalised, async-iterable text stream. */
export type AITextStream = AsyncIterable<AIStreamChunk>;

/**
 * Adapt an arbitrary provider async-iterable into an `AITextStream`.
 *
 * `extractText` pulls the incremental text out of each raw chunk; when it is
 * not supplied the adapter looks for the common `.text` field used by the
 * Gemini SDK.
 */
export async function* toAITextStream(
  source: AsyncIterable<unknown>,
  extractText: (chunk: unknown) => string = defaultExtractText,
): AITextStream {
  for await (const raw of source) {
    yield { text: extractText(raw) ?? '', raw };
  }
}

function defaultExtractText(chunk: unknown): string {
  if (chunk && typeof chunk === 'object' && 'text' in chunk) {
    const value = (chunk as { text?: unknown }).text;
    if (typeof value === 'string') return value;
  }
  if (typeof chunk === 'string') return chunk;
  return '';
}

/** Collect a full stream into a single string (used for tests / fallbacks). */
export async function collectStream(stream: AITextStream): Promise<string> {
  let out = '';
  for await (const chunk of stream) out += chunk.text;
  return out;
}
