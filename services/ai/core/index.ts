/**
 * `services/ai/core` — the canonical, provider-agnostic AI contracts.
 *
 * Everything here is provider-neutral. The Gemini implementation lives under
 * `services/ai/providers/gemini`; orchestration helpers live in sibling
 * folders (`retry`, `errors`, `tracing`, `modelRouting`).
 */

// Model identity
export {
  DEFAULT_TEXT_MODEL,
  IMAGE_MODEL,
  TTS_MODEL,
  MODEL_TIERS,
  MODEL_FALLBACK_CHAIN,
  isKnownTextModel,
} from './AIModel';
export type { AIModelDescriptor, AIModelTier, AIProviderId, ModelSource, ModelTier } from './AIModel';

// Capabilities
export {
  AI_CAPABILITY_NAMES,
  CAPABILITY_LABELS,
  NO_CAPABILITIES,
  providerSupports,
  unmetCapabilities,
} from './AICapabilities';
export type {
  AICapabilityLevel,
  AICapabilityName,
  AIProviderCapabilities,
  AIRequiredCapability,
} from './AICapabilities';

// Content
export { contentNeeds, contentToText, textPart, toContentParts } from './AIContent';
export type {
  AIContentPart,
  AIConversationTurn,
  AIFilePart,
  AIImagePart,
  AIMessageContent,
  AITextPart,
  AIToolCallPart,
  AIToolResultPart,
} from './AIContent';

// Tools
export { toolCallPart, toolResultPart } from './AITool';
export type { AIToolCall, AIToolDefinition, AIToolResult } from './AITool';

// Errors
export { AIError, TRANSIENT_ERROR_CATEGORIES, MODEL_FALLBACK_CATEGORIES } from './AIError';
export type { AIErrorCategory, AIErrorInit, AIErrorSource } from './AIError';

// Request / response
export { collapsePrompt, deriveRequiredCapabilities } from './AIRequest';
export type {
  AIRequest,
  AIMessage,
  AIMessageRole,
  AIGenerationModeId,
  AIResponseFormat,
} from './AIRequest';
export { isEmptyResponse, toStopReason } from './AIResponse';
export type { AIResponse, AIStopReason, AIUsage } from './AIResponse';

// Trace
export type { AITrace, AITraceStatus } from './AITrace';

// Streaming
export { toAITextStream, collectStream } from './AIStream';
export type { AITextStream, AIStreamChunk } from './AIStream';

// Policy
export { AI_POLICIES, AI_POLICY_MODES, resolvePolicy } from './AIPolicy';
export type { AIPolicy, AIPolicyMode, StructuredOutputRequirement } from './AIPolicy';

// Provider contract
export type { AIProvider } from './AIProvider';

// Executor
export { AIRequestExecutor, aiRequestExecutor } from './AIRequestExecutor';
export type { ExecuteOptions } from './AIRequestExecutor';
export { runWithModelFallback } from './modelFallbackLoop';
export type { RunWithModelFallbackOptions } from './modelFallbackLoop';
