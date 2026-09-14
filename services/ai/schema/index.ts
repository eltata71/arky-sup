/**
 * `services/ai/schema` — the neutral schema dialect and its provider adapters.
 *
 * Import the dialect from here; import the adapters only from inside a
 * provider. A call site that needs `toGeminiSchema` is a call site that knows
 * which backend it is talking to, and that is the coupling this module exists
 * to remove.
 */

export {
  defineSchema,
  toGeminiSchema,
  toJsonSchema,
  toResponseFormat,
} from './AISchema.js';
export type { AIJsonSchema, AISchemaType } from './AISchema.js';
