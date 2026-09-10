/**
 * `services/ai/tools` — the tool declarations this product offers, and the
 * per-provider adapters that put them on the wire.
 *
 * The vocabulary itself (`AIToolDefinition`, `AIToolCall`, `AIToolResult`) is
 * published by `services/ai/core`: it is a contract with no behaviour, and it
 * belongs next to the request that carries it rather than one layer above.
 */

export { toAnthropicTools, toGeminiTools, toOpenAITools } from './AITool';
export { MODIFY_ARTIFACT_TOOL, MODIFY_ARTIFACT_TOOL_NAME } from './artifactTools';
export type { AIToolCall, AIToolDefinition, AIToolResult } from '../core/AITool';
