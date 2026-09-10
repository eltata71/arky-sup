/**
 * GeminiProvider — the Google Gemini implementation of `AIProvider`.
 *
 * This is the *only* place in the new AI layer that touches `@google/genai`.
 * It performs exactly one SDK round-trip per call: client construction,
 * request/response conversion, abort-signal wiring and SDK-error translation.
 * Retry, timeout and model fallback are NOT done here — that is the
 * `AIRequestExecutor`'s job.
 */

import type { GoogleGenAI } from '@google/genai';
import type { Settings } from '../../../../types';
import { createGeminiAIClient } from './geminiClient';
import { resolveEffectiveApiKey } from '../../../../lib/ai/modelCatalog';
import { AIError } from '../../core/AIError';
import type { AIProviderCapabilities } from '../../core/AICapabilities';
import type { AIContentPart } from '../../core/AIContent';
import type { AIProviderId } from '../../core/AIModel';
import type { AIProvider } from '../../core/AIProvider';
import type { AIRequest } from '../../core/AIRequest';
import { collapsePrompt } from '../../core/AIRequest';
import type { AIResponse, AIUsage } from '../../core/AIResponse';
import type { AIToolCall } from '../../core/AITool';
import { toStopReason } from '../../core/AIResponse';
import { toGeminiTools } from '../../tools';
import { toAITextStream, type AITextStream } from '../../core/AIStream';
import type { AITrace } from '../../core/AITrace';
import { AITraceBuilder, newRequestId } from '../../tracing/AITraceBuilder';
import { aiModelRouter } from '../../modelRouting/AIModelRouter';
import { geminiErrorClassifier } from '../../errors/AIErrorClassifier';
import { parseAiJson } from '../../parseAiJson';
import { toGeminiSchema } from '../../schema';
import type { AIJsonSchema } from '../../schema';

const PROVIDER_ID: AIProviderId = 'gemini';

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface GeminiSdkResponse {
  text?: string;
  functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
  usageMetadata?: GeminiUsageMetadata;
  candidates?: Array<{ finishReason?: string }>;
  responseId?: string;
}

/**
 * What Google's API can do, in the canonical vocabulary.
 *
 * `tools` was absent from the old four-boolean surface, so negotiation read it
 * through an optimistic cast — and this adapter never put tools on the wire at
 * all. Both halves are fixed here: the capability is declared and
 * `buildConfig` forwards the definitions.
 */
const GEMINI_CAPABILITIES: AIProviderCapabilities = Object.freeze({
  streaming: true,
  structuredOutput: true,
  tools: true,
  images: true,
  files: true,
  audio: true,
});

export interface GeminiProviderOptions {
  /** Settings carrier — required because the Gemini SDK needs the API key. */
  settings: Settings;
}

export class GeminiProvider implements AIProvider {
  readonly id: AIProviderId = PROVIDER_ID;
  readonly name = 'Google Gemini';
  readonly capabilities = GEMINI_CAPABILITIES;

  private readonly settings: Settings;

  constructor(options: GeminiProviderOptions) {
    this.settings = options.settings;
  }

  /** Resolve the effective Gemini API key, or throw a configuration error. */
  private getClient(): GoogleGenAI {
    const apiKey = resolveEffectiveApiKey(this.settings);
    if (!apiKey) {
      throw new AIError({
        category: 'configuration',
        provider: this.id,
        message: 'No Gemini API key resolved from settings or environment.',
        userMessage:
          'No se encontró una API Key de Gemini. Configúrala en Configuración > IA.',
        retryable: false,
        errorCode: 'missing_api_key',
      });
    }
    return createGeminiAIClient({ apiKey });
  }

  /** Concrete model for an attempt — request override, else router default. */
  private resolveModel(request: AIRequest): {
    model: string;
    route: ReturnType<typeof aiModelRouter.route>;
  } {
    const route = aiModelRouter.route({
      mode: request.mode,
      tier: request.tier,
      modelOverride: request.modelOverride,
      settings: this.settings,
    });
    return { model: request.model ?? route.id, route };
  }

  /** Build the Gemini `config` object from a provider-neutral request. */
  private buildConfig(
    request: AIRequest,
    signal: AbortSignal,
    schema?: AIJsonSchema,
  ): Record<string, unknown> {
    // Only this adapter's own slice of `providerConfig` — a value written for
    // Anthropic can no longer reach Google's API just because the provider
    // changed between the call site and the call.
    const config: Record<string, unknown> = { ...(request.providerConfig?.gemini ?? {}) };
    if (typeof request.temperature === 'number') config.temperature = request.temperature;
    if (typeof request.topP === 'number') config.topP = request.topP;
    if (typeof request.maxOutputTokens === 'number') {
      config.maxOutputTokens = request.maxOutputTokens;
    }
    if (request.systemInstruction) config.systemInstruction = request.systemInstruction;
    if (typeof request.thinkingBudget === 'number') {
      config.thinkingConfig = { thinkingBudget: request.thinkingBudget };
    }
    if (request.tools && request.tools.length > 0) {
      // Previously omitted entirely: the canonical path built a Gemini config
      // with no `tools` key, so a request that declared functions reached the
      // API unable to call any of them and came back as prose.
      config.tools = toGeminiTools(request.tools);
    }
    const effectiveSchema = schema ?? request.responseSchema;
    if (request.responseFormat === 'json' || effectiveSchema) {
      config.responseMimeType = 'application/json';
      // Translated at the SDK boundary, so the domain never has to know that
      // Google spells its type names in uppercase.
      if (effectiveSchema) config.responseSchema = toGeminiSchema(effectiveSchema);
    }
    config.abortSignal = signal;
    return config;
  }

  /**
   * Gemini `contents` — the collapsed prompt, plus any canonical attachments
   * translated into Google's part shapes.
   *
   * The plain-string form is kept for the overwhelmingly common text-only case
   * because the SDK accepts it and it keeps the wire payload small. Anything
   * multimodal becomes a single user `Content` whose `parts` carry the
   * translation of each `AIContentPart` — which is what `rawContents` used to
   * ask every call site to build by hand, in Google's vocabulary.
   */
  private buildContents(request: AIRequest): unknown {
    const text = collapsePrompt(request.prompt);
    const attachments = request.attachments ?? [];
    if (attachments.length === 0) return text;
    const parts: unknown[] = [];
    if (text.length > 0) parts.push({ text });
    for (const part of attachments) parts.push(toGeminiPart(part));
    return [{ role: 'user', parts }];
  }

  private buildTrace(request: AIRequest, route: ReturnType<typeof aiModelRouter.route>, model: string, streaming: boolean, structured: boolean): AITraceBuilder {
    return new AITraceBuilder({
      requestId: request.requestId ?? newRequestId(request.purpose),
      operationId: request.operationId,
      purpose: request.purpose,
      provider: this.id,
      route: { ...route, id: model },
      mode: request.mode ?? 'balanced',
      timeoutMs: request.timeoutMs ?? 0,
      structuredOutput: structured,
      streaming,
      contextPackId: request.contextPackId,
    });
  }

  async generateText(request: AIRequest): Promise<AIResponse> {
    const { model, route } = this.resolveModel(request);
    const trace = this.buildTrace(request, route, model, false, request.responseFormat === 'json');
    const signal = request.signal ?? new AbortController().signal;
    try {
      const client = this.getClient();
      const raw = (await client.models.generateContent({
        model,
        contents: this.buildContents(request) as never,
        config: this.buildConfig(request, signal) as never,
      })) as GeminiSdkResponse;
      return this.toResponse(raw, trace);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  async generateStructured<T = unknown>(
    request: AIRequest,
    schema?: AIJsonSchema,
  ): Promise<AIResponse<T>> {
    const { model, route } = this.resolveModel(request);
    const trace = this.buildTrace(request, route, model, false, true);
    const signal = request.signal ?? new AbortController().signal;
    try {
      const client = this.getClient();
      const raw = (await client.models.generateContent({
        model,
        contents: this.buildContents(request) as never,
        config: this.buildConfig({ ...request, responseFormat: 'json' }, signal, schema) as never,
      })) as GeminiSdkResponse;
      const response = this.toResponse(raw, trace);
      const parsed = parseAiJson<T>(response.text);
      return {
        ...response,
        structured: parsed.ok ? parsed.data : undefined,
      } as AIResponse<T>;
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  async streamText(request: AIRequest): Promise<AITextStream> {
    const { model } = this.resolveModel(request);
    const signal = request.signal ?? new AbortController().signal;
    try {
      const client = this.getClient();
      const sdkStream = (await client.models.generateContentStream({
        model,
        contents: this.buildContents(request) as never,
        config: this.buildConfig(request, signal) as never,
      })) as AsyncIterable<unknown>;
      return toAITextStream(sdkStream);
    } catch (error) {
      throw this.classifyError(error);
    }
  }

  /** Translate any SDK/generic error into a canonical `AIError`. */
  classifyError(error: unknown): AIError {
    return geminiErrorClassifier.classify(error);
  }

  /** Normalise Gemini `usageMetadata` into the provider-neutral `AIUsage`. */
  estimateUsage(response: AIResponse): AIUsage {
    return response.usage;
  }

  /** Convert a raw Gemini SDK response into a normalised `AIResponse`. */
  private toResponse(raw: GeminiSdkResponse, trace: AITraceBuilder): AIResponse {
    const usage: AIUsage = {
      promptTokens: raw.usageMetadata?.promptTokenCount,
      completionTokens: raw.usageMetadata?.candidatesTokenCount,
      thoughtsTokens: raw.usageMetadata?.thoughtsTokenCount,
      totalTokens: raw.usageMetadata?.totalTokenCount,
      durationMs: 0,
    };
    const sealed: AITrace = trace.success(usage);
    const finishReason = raw.candidates?.[0]?.finishReason;
    return {
      text: raw.text ?? '',
      toolCalls: toCanonicalToolCalls(raw.functionCalls),
      stopReason: toStopReason(finishReason),
      finishReason,
      providerRequestId: raw.responseId,
      usage: { ...usage, durationMs: sealed.durationMs },
      trace: sealed,
    };
  }
}

/** Translate one canonical content part into Google's part vocabulary. */
function toGeminiPart(part: AIContentPart): unknown {
  switch (part.kind) {
    case 'text':
      return { text: part.text };
    case 'image':
    case 'file':
      return { inlineData: { mimeType: part.mimeType, data: part.data } };
    case 'tool-call':
      return { functionCall: { name: part.name, args: part.arguments } };
    case 'tool-result':
      return { functionResponse: { name: part.name, response: { result: part.result } } };
    default:
      return { text: '' };
  }
}

/**
 * Normalise Google's function calls into the canonical shape.
 *
 * A call without a name is dropped rather than forwarded as a nameless record:
 * the caller's only possible response to `{ name: undefined }` is to ignore it,
 * and doing that here means `isEmptyResponse` sees the truth.
 *
 * Google does not always return a call id; when it does not, one is minted so
 * the result can still be correlated back to its call.
 */
function toCanonicalToolCalls(
  raw: GeminiSdkResponse['functionCalls'],
): readonly AIToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const calls: AIToolCall[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const call = raw[index];
    if (!call || typeof call.name !== 'string' || call.name.length === 0) continue;
    calls.push({
      toolCallId: call.id ?? `gemini-call-${index}`,
      name: call.name,
      arguments: call.args ?? {},
    });
  }
  return calls.length > 0 ? calls : undefined;
}
