/**
 * structuredOutput — provider-agnostic helpers for JSON / schema responses.
 *
 * Wraps the tolerant `parseAiJson` repairer with a thin, typed surface so the
 * domain layer never has to reason about fenced/truncated model JSON.
 */

import {
  isParseAiJsonSuccess,
  parseAiJson,
  type ParseAiJsonOptions,
  type ParseAiJsonResult,
} from '../parseAiJson';

export {
  parseAiJson,
  isParseAiJsonSuccess,
  isParseAiJsonFailure,
} from '../parseAiJson';
export type {
  AiJsonRepair,
  ParseAiJsonOptions,
  ParseAiJsonResult,
  ParseAiJsonSuccess,
  ParseAiJsonFailure,
} from '../parseAiJson';

/** Minimal, provider-neutral JSON schema descriptor. */
export interface AIJsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, AIJsonSchema>;
  items?: AIJsonSchema;
  required?: string[];
  enum?: unknown[];
  nullable?: boolean;
}

/** Identity helper that documents intent at schema definition sites. */
export function defineSchema(schema: AIJsonSchema): AIJsonSchema {
  return schema;
}

export interface ParseStructuredResult<T> {
  /** Parsed value when parsing (with repair) succeeded. */
  value?: T;
  /** True when a usable value was produced. */
  ok: boolean;
  /** True when conservative repairs were needed to parse the payload. */
  repaired: boolean;
  /** Parser error message when `ok` is false. */
  error?: string;
}

/**
 * Parse a model's text output into a structured value, tolerating fenced or
 * truncated JSON. Never throws — callers branch on `ok`.
 */
export function parseStructured<T = unknown>(
  raw: string | undefined | null,
  options: ParseAiJsonOptions = {},
): ParseStructuredResult<T> {
  const result: ParseAiJsonResult<T> = parseAiJson<T>(raw, options);
  if (isParseAiJsonSuccess(result)) {
    return {
      ok: true,
      value: result.data,
      repaired: result.repairedFrom.length > 0,
    };
  }
  return { ok: false, repaired: false, error: result.error };
}
