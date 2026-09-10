/**
 * Provider adapters for the canonical tool contract.
 *
 * The vocabulary — `AIToolDefinition`, `AIToolCall`, `AIToolResult` — lives in
 * `core/AITool`, next to the request that carries it. What lives here is the
 * translation: Google nests declarations under
 * `tools: [{ functionDeclarations: [...] }]`; OpenAI-style backends use
 * `tools: [{ type: 'function', function: {...} }]`. Neither shape belongs in a
 * call site that only wants to say "the model may ask me to modify an artifact".
 *
 * `fromGeminiTools` used to sit here too — an adapter that read tool
 * definitions back *out* of Google's wire shape, because the monolith assembled
 * `functionDeclarations` inline at two call sites and the neutral path had to
 * recover something from them. Both sites now declare
 * `MODIFY_ARTIFACT_TOOL` and the Gemini translation happens at the SDK
 * boundary, so the recovery adapter has nothing left to recover and is gone.
 * Reversing that arrow is the whole point: the canonical form is the source and
 * the vendor form is derived, not the other way round.
 */

import { toGeminiSchema, toJsonSchema } from '../schema';
import type { AIToolDefinition } from '../core/AITool';

/** Translate tools into Google's `tools` array. */
export function toGeminiTools(tools: readonly AIToolDefinition[]): unknown[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.parameters),
      })),
    },
  ];
}

/** Translate tools into the OpenAI-style `tools` array. */
export function toOpenAITools(tools: readonly AIToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.parameters),
    },
  }));
}

/** Translate tools into Anthropic's `tools` array. */
export function toAnthropicTools(
  tools: readonly AIToolDefinition[],
): Array<{ name: string; description: string; input_schema: unknown }> {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toJsonSchema(tool.parameters),
  }));
}
