/**
 * AnthropicProvider — the Claude implementation of `AIProvider`.
 *
 * This provider is the plan's acceptance test, not a feature request. Two
 * backends can always be made to work by bending the abstraction around the
 * second one; a third says whether the abstraction describes a family. It was
 * written against the published contracts only — `AIProvider`, `AIRequest`,
 * `AIJsonSchema`, `AIToolDefinition` — with no change to any call site.
 *
 * Talks to `/v1/messages` over plain `fetch`, matching `OpenRouterProvider`.
 * The official SDK is the usual recommendation, and it is the right one for a
 * server: here the provider runs in the browser, where the SDK needs an
 * explicit unsafe-browser opt-in and would add hundreds of kilobytes to the
 * bundle the previous phase just cut by 79%. The wire contract below follows
 * the documented API.
 *
 * Three Anthropic-specific details the adapter absorbs, none of which leak out:
 *
 *   - `max_tokens` is mandatory, so a request without one gets a sane ceiling
 *     rather than a 400.
 *   - The system prompt is a top-level field, not a message with a role.
 *   - Sampling controls were removed on the newest models: sending
 *     `temperature` to Opus 5 or Sonnet 5 is rejected outright, so it is
 *     omitted for those and forwarded for the models that still take it.
 */

import type { Settings } from '../../../../types';
import { AIError } from '../../core/AIError';
import type { AIModelDescriptor, AIProviderId, ModelSource } from '../../core/AIModel';
import type { AIProvider } from '../../core/AIProvider';
import type { AIRequest, AIGenerationModeId } from '../../core/AIRequest';
import type { AIProviderCapabilities } from '../../core/AICapabilities';
import { contentToText } from '../../core/AIContent';
import type { AIResponse, AIUsage } from '../../core/AIResponse';
import { toStopReason } from '../../core/AIResponse';
import type { AIToolCall } from '../../core/AITool';
import { toAITextStream, type AITextStream } from '../../core/AIStream';
import { aiModelRouter } from '../../modelRouting/AIModelRouter';
import { parseAiJson } from '../../parseAiJson';
import { AITraceBuilder, newRequestId } from '../../tracing/AITraceBuilder';
import { AIErrorClassifier } from '../../errors/AIErrorClassifier';
import { toJsonSchema } from '../../schema';
import type { AIJsonSchema } from '../../schema';
import { toAnthropicTools } from '../../tools';
import { parseSSE } from '../openrouter/sse';
import { resolveAnthropicApiKey } from './anthropicApiKey';
import {
  ANTHROPIC_FALLBACK_CHAIN,
  ANTHROPIC_MODEL_TIERS,
  acceptsTemperature,
} from './anthropicModels';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = ANTHROPIC_MODEL_TIERS.default;

/** `max_tokens` is required by the API; this is the ceiling when none is given. */
const DEFAULT_MAX_TOKENS = 8192;

export interface AnthropicProviderOptions {
  settings: Settings;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  id?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * What this adapter implements.
 *
 * Claude reads images and PDFs; this adapter sends `content` as a plain string,
 * so it cannot. Declaring `images: true` on the vendor's behalf would make the
 * router eligible to send an image here and then drop it — which is exactly the
 * silent degradation the capability record exists to stop. Raise these the day
 * the adapter emits Anthropic's block form.
 */
const ANTHROPIC_CAPABILITIES: AIProviderCapabilities = Object.freeze({
  streaming: true,
  structuredOutput: true,
  tools: true,
  images: false,
  files: false,
  audio: false,
});

/** Claude's own error classifier — same status semantics, its own provider id. */
const anthropicErrorClassifier = new AIErrorClassifier('anthropic');

/**
 * Split a neutral prompt into Claude's shape: a top-level `system` string plus
 * a `messages` array that carries only user/assistant turns.
 */
function toConversation(request: AIRequest): {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const systemParts: string[] = [];
  if (request.systemInstruction) systemParts.push(request.systemInstruction);

  if (typeof request.prompt === 'string') {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    for (const message of request.prompt) {
      const text = contentToText(message.content);
      if (message.role === 'system') {
        systemParts.push(text);
        continue;
      }
      // `tool` turns carry their result as text; Claude's own `tool_result`
      // block form needs the block content shape this adapter does not emit.
      messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: text });
    }
  }

  const attachments = request.attachments ?? [];
  if (attachments.length > 0) {
    messages.push({ role: 'user', content: contentToText(attachments) });
  }

  // The API requires at least one message and the first must be a user turn.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: ' ' });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages,
  };
}

export class AnthropicProvider implements AIProvider {
  readonly id: AIProviderId = 'anthropic';
  readonly name = 'Anthropic Claude';
  readonly capabilities = ANTHROPIC_CAPABILITIES;

  private readonly settings: Settings;

  constructor(options: AnthropicProviderOptions) {
    this.settings = options.settings;
  }

  private getKey(): string {
    const key = resolveAnthropicApiKey(this.settings);
    if (!key) {
      throw new AIError({
        category: 'configuration',
        provider: this.id,
        message: 'No Anthropic API key resolved from settings or environment.',
        userMessage:
          'No se encontró una API Key de Anthropic. Configúrala en Configuración > IA.',
        retryable: false,
        errorCode: 'missing_api_key',
      });
    }
    return key;
  }

  /** True when this id belongs to Anthropic's model space. */
  private owns(modelId: string): boolean {
    return /^claude-/i.test(modelId.trim());
  }

  /**
   * Concrete model for this request. An override is honoured only when it is
   * a Claude id — a caller resolving a tier through another provider's tables
   * can still hand this adapter a foreign id, and forwarding it would request
   * a model that does not exist here.
   */
  private resolveModel(request: AIRequest): string {
    const override = request.modelOverride?.trim();
    if (override && this.owns(override)) return override;
    const userModel = this.settings.aiConfig?.model?.trim();
    if (userModel && this.owns(userModel)) return userModel;
    const tier = aiModelRouter.resolveTier(request.mode ?? 'balanced', request.tier);
    return ANTHROPIC_MODEL_TIERS[tier] ?? DEFAULT_MODEL;
  }

  private resolveDescriptor(request: AIRequest): AIModelDescriptor {
    const model = this.resolveModel(request);
    const mode: AIGenerationModeId = request.mode ?? 'balanced';
    const tier = aiModelRouter.resolveTier(mode, request.tier);
    const requested = request.modelOverride?.trim() ?? this.settings.aiConfig?.model?.trim();
    const source: ModelSource = requested && this.owns(requested) ? 'user' : 'fallback';
    return {
      id: model,
      tier,
      source,
      requested: requested || undefined,
      fallbackChain: ANTHROPIC_FALLBACK_CHAIN.filter((m) => m !== model),
    };
  }

  private buildTrace(
    request: AIRequest,
    descriptor: AIModelDescriptor,
    streaming: boolean,
    structured: boolean,
  ): AITraceBuilder {
    return new AITraceBuilder({
      requestId: request.requestId ?? newRequestId(request.purpose),
      operationId: request.operationId,
      purpose: request.purpose,
      provider: this.id,
      route: descriptor,
      mode: request.mode ?? 'balanced',
      timeoutMs: request.timeoutMs ?? 0,
      structuredOutput: structured,
      streaming,
      contextPackId: request.contextPackId,
    });
  }

  /** Compose the `/v1/messages` body from a provider-neutral request. */
  private body(request: AIRequest, stream: boolean, schema?: AIJsonSchema): Record<string, unknown> {
    const model = this.resolveModel(request);
    const { system, messages } = toConversation(request);

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      stream,
    };
    if (system) body.system = system;

    // Omitted rather than forwarded on the models that reject it outright.
    if (typeof request.temperature === 'number' && acceptsTemperature(model)) {
      body.temperature = request.temperature;
    }

    const effectiveSchema = schema ?? request.responseSchema;
    if (effectiveSchema !== undefined && effectiveSchema !== null) {
      body.output_config = {
        format: { type: 'json_schema', schema: toJsonSchema(effectiveSchema) },
      };
    }

    if (request.tools && request.tools.length > 0) {
      // Claude names the field `input_schema`. It used to be produced by
      // translating to OpenAI's shape and then unwrapping the `function`
      // envelope — a second adapter's output reshaped into a third form, which
      // meant an OpenAI-specific change silently changed what Claude received.
      body.tools = toAnthropicTools(request.tools);
    }

    const overrides = request.providerConfig?.anthropic;
    if (overrides) Object.assign(body, overrides);
    return body;
  }

  private async request(request: AIRequest, stream: boolean, schema?: AIJsonSchema): Promise<Response> {
    const key = this.getKey();
    const signal = request.signal ?? new AbortController().signal;
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        // The app is frontend-first; this header is the documented opt-in for
        // calling the API from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(this.body(request, stream, schema)),
      signal,
    });
  }

  /** Throw a statused error for a non-OK response so the classifier maps it. */
  private assertOk(resp: Response): void {
    if (resp.ok) return;
    const err = new Error(`Anthropic HTTP ${resp.status}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }

  /** Normalise a Claude response into the provider-neutral `AIResponse`. */
  private toResponse(raw: AnthropicResponse, trace: AITraceBuilder): AIResponse {
    const text = (raw.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');

    const toolCalls = toCanonicalToolCalls(raw.content);

    const usage: AIUsage = {
      promptTokens: raw.usage?.input_tokens,
      completionTokens: raw.usage?.output_tokens,
      cachedPromptTokens: raw.usage?.cache_read_input_tokens,
      totalTokens:
        typeof raw.usage?.input_tokens === 'number' && typeof raw.usage?.output_tokens === 'number'
          ? raw.usage.input_tokens + raw.usage.output_tokens
          : undefined,
      durationMs: 0,
    };
    const sealed = trace.success(usage);
    return {
      text,
      toolCalls,
      stopReason: toStopReason(raw.stop_reason),
      finishReason: raw.stop_reason,
      providerRequestId: raw.id,
      usage: { ...usage, durationMs: sealed.durationMs },
      trace: sealed,
    };
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const descriptor = this.resolveDescriptor(request);
    const trace = this.buildTrace(request, descriptor, false, request.responseFormat === 'json');
    try {
      const resp = await this.request(request, false);
      this.assertOk(resp);
      return this.toResponse((await resp.json()) as AnthropicResponse, trace);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  async generateStructured<T = unknown>(
    request: AIRequest,
    schema?: AIJsonSchema,
  ): Promise<AIResponse<T>> {
    const descriptor = this.resolveDescriptor(request);
    const trace = this.buildTrace(request, descriptor, false, true);
    try {
      const resp = await this.request(request, false, schema);
      this.assertOk(resp);
      const base = this.toResponse((await resp.json()) as AnthropicResponse, trace);
      const parsed = parseAiJson<T>(base.text);
      return { ...base, structured: parsed.ok ? parsed.data : undefined } as AIResponse<T>;
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  async streamText(request: AIRequest): Promise<AITextStream> {
    try {
      const resp = await this.request(request, true);
      this.assertOk(resp);
      if (!resp.body) {
        throw new AIError({
          category: 'malformed-response',
          provider: this.id,
          message: 'Anthropic stream response carried no body.',
          userMessage: 'Anthropic devolvió una respuesta vacía. Reintenta.',
          retryable: true,
          errorCode: 'missing_stream_body',
        });
      }
      return toAITextStream(textFramesOnly(parseSSE(resp.body)), anthropicDelta);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  classifyError(error: unknown): AIError {
    return anthropicErrorClassifier.classify(error);
  }

  estimateUsage(response: AIResponse): AIUsage {
    return response.usage;
  }
}

/**
 * Keep only the frames that carry text.
 *
 * Claude's stream is a sequence of typed events — `message_start`, `ping`,
 * `content_block_stop`, `message_stop` — and only `content_block_delta` carries
 * content. Gemini and OpenRouter emit one frame per delta, so the shared
 * `AITextStream` contract had never had to distinguish the two; forwarding
 * every frame here made consumers see empty chunks interleaved with real ones.
 *
 * Filtering belongs at this boundary rather than in the consumers: the point of
 * the provider layer is that a caller iterating a stream should not need to
 * know which backend's event vocabulary produced it.
 */
async function* textFramesOnly(source: AsyncIterable<string>): AsyncGenerator<string> {
  for await (const frame of source) {
    if (anthropicDelta(frame).length > 0) yield frame;
  }
}

/**
 * Pull the incremental text out of one Claude SSE frame.
 *
 * Claude's stream is a sequence of typed events; only `content_block_delta`
 * carries text. Everything else (`message_start`, `ping`, `content_block_stop`)
 * contributes nothing and is skipped rather than stringified into the output.
 */
export function anthropicDelta(payload: unknown): string {
  let frame = payload;
  if (typeof frame === 'string') {
    try {
      frame = JSON.parse(frame);
    } catch {
      return '';
    }
  }
  if (!frame || typeof frame !== 'object') return '';
  const event = frame as { type?: string; delta?: { type?: string; text?: string } };
  if (event.type !== 'content_block_delta') return '';
  return typeof event.delta?.text === 'string' ? event.delta.text : '';
}

/** Normalise Claude's `tool_use` blocks into the canonical shape. */
function toCanonicalToolCalls(
  content: AnthropicContentBlock[] | undefined,
): readonly AIToolCall[] | undefined {
  const calls: AIToolCall[] = [];
  for (const block of content ?? []) {
    if (block.type !== 'tool_use') continue;
    if (typeof block.name !== 'string' || block.name.length === 0) continue;
    calls.push({
      toolCallId: block.id ?? `anthropic-call-${calls.length}`,
      name: block.name,
      arguments: block.input ?? {},
    });
  }
  return calls.length > 0 ? calls : undefined;
}
