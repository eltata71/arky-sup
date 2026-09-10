/**
 * OpenRouterProvider — OpenRouter implementation of `AIProvider`.
 *
 * Talks to the OpenRouter `/chat/completions` endpoint over plain `fetch`
 * (no SDK). Request/response conversion, abort-signal wiring and HTTP-error
 * translation are all contained here; retry, timeout and model fallback are
 * NOT — that is the `AIRequestExecutor`'s job. Every successful response is
 * sealed with a full `AITrace`, mirroring `GeminiProvider`.
 */

import type { Settings } from '../../../../types';
import { AIError } from '../../core/AIError';
import type { AIModelDescriptor, AIProviderId, ModelSource } from '../../core/AIModel';
import { aiModelRouter } from '../../modelRouting/AIModelRouter';
import type { AIProvider } from '../../core/AIProvider';
import type { AIRequest, AIGenerationModeId } from '../../core/AIRequest';
import type { AIProviderCapabilities } from '../../core/AICapabilities';
import { contentToText } from '../../core/AIContent';
import type { AIResponse, AIUsage } from '../../core/AIResponse';
import { toStopReason } from '../../core/AIResponse';
import type { AIToolCall } from '../../core/AITool';
import { toAITextStream, type AITextStream } from '../../core/AIStream';
import { resolveOpenRouterApiKey } from './openRouterApiKey';
import { parseAiJson } from '../../parseAiJson';
import { AITraceBuilder, newRequestId } from '../../tracing/AITraceBuilder';
import { parseSSE, openRouterDelta } from './sse';
import { openRouterErrorClassifier } from './openRouterErrorClassifier';
import { toResponseFormat } from '../../schema';
import type { AIJsonSchema } from '../../schema';
import { openRouterCatalog } from '../../catalog';
import { toOpenAITools } from '../../tools';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/auto';

export interface OpenRouterProviderOptions {
  /** Settings carrier — supplies the API key backends and preferred model. */
  settings: Settings;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenRouterToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenRouterResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string; tool_calls?: OpenRouterToolCall[] };
    finish_reason?: string;
  }>;
  usage?: OpenRouterUsage;
}

/**
 * What this adapter implements, not what OpenRouter markets.
 *
 * OpenRouter fronts models that accept images; this adapter sends only text
 * parts, so `images: false` is the truthful answer for a request routed
 * through it. Declaring the vendor's ceiling instead of the adapter's would
 * let the router pick this backend for a request carrying an image and then
 * drop the image on the way out — which is the whole class of failure the
 * capability record exists to prevent.
 */
const OPENROUTER_CAPABILITIES: AIProviderCapabilities = Object.freeze({
  streaming: true,
  structuredOutput: true,
  tools: true,
  images: false,
  files: false,
  audio: false,
});

function toMessages(request: AIRequest): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (request.systemInstruction) {
    messages.push({ role: 'system', content: request.systemInstruction });
  }
  if (typeof request.prompt === 'string') {
    messages.push({ role: 'user', content: request.prompt });
  } else {
    for (const m of request.prompt) {
      // `tool` is a role this backend spells the OpenAI way; every other role
      // passes through unchanged.
      messages.push({ role: m.role, content: contentToText(m.content) });
    }
  }
  const attachments = request.attachments ?? [];
  if (attachments.length > 0) {
    // This adapter carries no binary parts, so they arrive as named
    // placeholders rather than silently vanishing. The capability record is
    // what stops a request that *needs* them being routed here at all; this is
    // the honest rendering for the `preferred`/`optional` case that still runs.
    messages.push({ role: 'user', content: contentToText(attachments) });
  }
  return messages;
}

export class OpenRouterProvider implements AIProvider {
  readonly id: AIProviderId = 'openrouter';
  readonly name = 'OpenRouter';
  readonly capabilities = OPENROUTER_CAPABILITIES;

  private readonly settings: Settings;

  constructor(options: OpenRouterProviderOptions) {
    this.settings = options.settings;
  }

  /** Resolve the OpenRouter API key, or throw a configuration error. */
  private getKey(): string {
    const key = resolveOpenRouterApiKey(this.settings);
    if (!key) {
      throw new AIError({
        category: 'configuration',
        provider: this.id,
        message: 'No OpenRouter API key resolved from settings or environment.',
        userMessage:
          'No se encontró una API Key de OpenRouter. Configúrala en Configuración > IA.',
        retryable: false,
        errorCode: 'missing_api_key',
      });
    }
    return key;
  }

  /**
   * Concrete model for this request.
   *
   * An override is honoured only when it belongs to OpenRouter's id space. A
   * caller resolving a tier through the shared model tables can still hand this
   * provider a Gemini id (`gemini-2.5-flash-lite` was the reproducible case);
   * forwarding it produced a request for a model OpenRouter does not have.
   */
  private resolveModel(request: AIRequest): string {
    const override = request.modelOverride?.trim();
    if (override && openRouterCatalog.owns(override)) return override;
    const userModel = this.settings.aiConfig?.model?.trim();
    if (userModel && openRouterCatalog.owns(userModel)) return userModel;
    return DEFAULT_MODEL;
  }

  /**
   * Build the trace-attribution descriptor for a request. OpenRouter has its
   * own model space, so we resolve a provider-neutral descriptor manually
   * instead of going through the Gemini model router.
   */
  private resolveDescriptor(request: AIRequest): AIModelDescriptor {
    const model = this.resolveModel(request);
    const mode: AIGenerationModeId = request.mode ?? 'balanced';
    const tier = aiModelRouter.resolveTier(mode, request.tier);

    let source: ModelSource;
    let requested: string | undefined;
    const override = request.modelOverride?.trim();
    const userModel = this.settings.aiConfig?.model?.trim();
    if (override && openRouterCatalog.owns(override)) {
      source = 'user';
      requested = override;
    } else if (!override && userModel && openRouterCatalog.owns(userModel)) {
      source = 'user';
      requested = userModel;
    } else {
      // Either nothing was asked for, or what was asked for belongs to another
      // provider. The trace records the request either way so the substitution
      // is visible rather than silent.
      source = 'fallback';
      requested = override ?? userModel ?? undefined;
    }

    return { id: model, tier, source, requested, fallbackChain: [] };
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

  /** Compose the OpenAI-style request body for the /chat/completions endpoint. */
  private body(request: AIRequest, stream: boolean, schema?: AIJsonSchema): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(request),
      messages: toMessages(request),
      stream,
    };
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    if (typeof request.maxOutputTokens === 'number') body.max_tokens = request.maxOutputTokens;

    // A schema, when supplied, is honoured as a schema — not downgraded to
    // "return some JSON". `json_object` mode constrains the syntax and nothing
    // else, so a caller that asked for a shape would have received a silently
    // weaker guarantee than the one Gemini gives for the same request.
    const effectiveSchema = schema ?? request.responseSchema;
    if (effectiveSchema !== undefined && effectiveSchema !== null) {
      body.response_format = toResponseFormat(effectiveSchema);
    } else if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    // Tools travel too. Dropping them was the other half of the lossy
    // translation: the model was offered no functions and the caller was left
    // parsing an answer that could never contain a call.
    if (request.tools && request.tools.length > 0) {
      body.tools = toOpenAITools(request.tools);
    }

    // Only this adapter's slice of `providerConfig`. A flat record was merged
    // verbatim before, so a key written for Google's API travelled into
    // OpenRouter's body the moment a user switched provider.
    const overrides = request.providerConfig?.openrouter;
    if (overrides) Object.assign(body, overrides);
    return body;
  }

  /** Perform the single POST round-trip against the OpenRouter endpoint. */
  private async request(request: AIRequest, stream: boolean, schema?: AIJsonSchema): Promise<Response> {
    const key = this.getKey();
    const signal = request.signal ?? new AbortController().signal;
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://arky.app',
        'X-Title': 'Arky 10',
      },
      body: JSON.stringify(this.body(request, stream, schema)),
      signal,
    });
  }

  /**
   * Throw a canonical `AIError` for a non-OK HTTP response. Throws a plain
   * statused error when the call site runs inside the classify catch-list, so
   * the shared classifier maps it (429 → rate-limit, 401 → auth, 5xx →
   * overloaded, ...).
   */
  private assertOk(resp: Response): void {
    if (resp.ok) return;
    const err = new Error(`OpenRouter HTTP ${resp.status}`) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }

  /** Normalise an OpenRouter JSON response into a provider-neutral AIResponse. */
  private toResponse(raw: OpenRouterResponse, text: string, trace: AITraceBuilder): AIResponse {
    const usage: AIUsage = {
      promptTokens: raw.usage?.prompt_tokens,
      completionTokens: raw.usage?.completion_tokens,
      totalTokens: raw.usage?.total_tokens,
      durationMs: 0,
    };
    const sealed = trace.success(usage);
    const finishReason = raw.choices?.[0]?.finish_reason;
    return {
      text,
      // Previously unread: the adapter offered the model functions and then
      // threw away the calls it made, so a tool request could only ever come
      // back as prose that no caller was parsing.
      toolCalls: toCanonicalToolCalls(raw.choices?.[0]?.message?.tool_calls),
      stopReason: toStopReason(finishReason),
      finishReason,
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
      const json = (await resp.json()) as OpenRouterResponse;
      const text = json.choices?.[0]?.message?.content ?? '';
      return this.toResponse(json, text, trace);
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
      const json = (await resp.json()) as OpenRouterResponse;
      const text = json.choices?.[0]?.message?.content ?? '';
      const base = this.toResponse(json, text, trace);
      const parsed = parseAiJson<T>(text);
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
          message: 'OpenRouter stream response carried no body.',
          userMessage: 'OpenRouter devolvió una respuesta vacía. Reintenta.',
          retryable: true,
          errorCode: 'missing_stream_body',
        });
      }
      return toAITextStream(parseSSE(resp.body), openRouterDelta);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /** Translate any error into a canonical `AIError` via the shared classifier. */
  classifyError(error: unknown): AIError {
    return openRouterErrorClassifier.classify(error);
  }

  /** Normalise OpenRouter `usage` into the provider-neutral `AIUsage`. */
  estimateUsage(response: AIResponse): AIUsage {
    return response.usage;
  }
}

/**
 * Normalise OpenAI-style `tool_calls` into the canonical shape.
 *
 * Arguments arrive as a JSON *string*; a call whose arguments do not parse is
 * reported with an empty argument record rather than dropped, because the model
 * did ask for the tool and the caller needs to know that before deciding what
 * to do about the malformed payload.
 */
function toCanonicalToolCalls(
  raw: OpenRouterToolCall[] | undefined,
): readonly AIToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: AIToolCall[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const call = raw[index];
    const name = call?.function?.name;
    if (typeof name !== 'string' || name.length === 0) continue;
    calls.push({
      toolCallId: call.id ?? `openrouter-call-${index}`,
      name,
      arguments: parseArguments(call.function?.arguments),
    });
  }
  return calls.length > 0 ? calls : undefined;
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
