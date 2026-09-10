/**
 * harnesses — one `ProviderHarness` per shipped `AIProvider`.
 *
 * Each harness stands in for exactly one transport: the Gemini SDK client for
 * `GeminiProvider`, `fetch` for the HTTP providers. They are factories rather
 * than module-level constants because `vi.mock` is hoisted to the top of the
 * *test* file — the SDK doubles have to be created there and handed in.
 */

import { vi } from 'vitest';
import { GeminiProvider } from '../../../../services/ai/providers/gemini/GeminiProvider';
import { OpenRouterProvider } from '../../../../services/ai/providers/openrouter/OpenRouterProvider';
import { AnthropicProvider } from '../../../../services/ai/providers/anthropic/AnthropicProvider';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { Settings } from '../../../../types';
import {
  baseSettings,
  restoreGlobals,
  type ProviderHarness,
  type WireRequest,
  type WireUsage,
} from './providerHarness';

const EMPTY_WIRE: WireRequest = { jsonMode: false, abortWired: false };

/* ------------------------------------------------------------------ Gemini */

/** Shape of the two SDK methods the Gemini provider calls. */
export interface GeminiSdkDoubles {
  generateContent: ReturnType<typeof vi.fn>;
  generateContentStream: ReturnType<typeof vi.fn>;
}

export function createGeminiHarness(sdk: GeminiSdkDoubles): ProviderHarness {
  let wire: WireRequest = { ...EMPTY_WIRE };

  /** Record what the provider handed the SDK, in Gemini's own dialect. */
  const capture = (args: Record<string, unknown>): void => {
    const config = (args.config ?? {}) as Record<string, unknown>;
    wire = {
      model: typeof args.model === 'string' ? args.model : undefined,
      schema: config.responseSchema,
      jsonMode: config.responseMimeType === 'application/json',
      systemInstruction:
        typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
      temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
      abortWired: config.abortSignal !== undefined,
      tools: config.tools,
    };
  };

  return {
    id: 'gemini',
    label: 'GeminiProvider',

    settings: () => baseSettings('gemini-2.5-flash'),

    create(settings?: Settings): AIProvider {
      localStorage.setItem('user_gemini_key', 'conformance-key');
      return new GeminiProvider({ settings: settings ?? baseSettings('gemini-2.5-flash') });
    },

    stubText(text: string, usage?: WireUsage) {
      sdk.generateContent.mockImplementation(async (args: Record<string, unknown>) => {
        capture(args);
        return {
          text,
          usageMetadata: {
            promptTokenCount: usage?.promptTokens,
            candidatesTokenCount: usage?.completionTokens,
            totalTokenCount: usage?.totalTokens,
          },
          candidates: [{ finishReason: 'STOP' }],
        };
      });
    },

    stubStream(chunks: string[]) {
      sdk.generateContentStream.mockImplementation(async (args: Record<string, unknown>) => {
        capture(args);
        return (async function* () {
          for (const text of chunks) yield { text };
        })();
      });
    },

    stubFailure(status: number, message = 'backend failure') {
      const fail = async (args: Record<string, unknown>) => {
        capture(args);
        throw Object.assign(new Error(message), { status });
      };
      sdk.generateContent.mockImplementation(fail);
      sdk.generateContentStream.mockImplementation(fail);
    },

    stubToolCall(name: string, args: Record<string, unknown>) {
      sdk.generateContent.mockImplementation(async (callArgs: Record<string, unknown>) => {
        capture(callArgs);
        return {
          text: '',
          functionCalls: [{ id: 'call_1', name, args }],
          candidates: [{ finishReason: 'STOP' }],
          responseId: 'resp-gemini-1',
        };
      });
    },

    stubTruncated(text: string) {
      sdk.generateContent.mockImplementation(async (callArgs: Record<string, unknown>) => {
        capture(callArgs);
        return { text, candidates: [{ finishReason: 'MAX_TOKENS' }] };
      });
    },

    readWire: () => wire,

    reset() {
      wire = { ...EMPTY_WIRE };
      sdk.generateContent.mockReset();
      sdk.generateContentStream.mockReset();
      localStorage.setItem('user_gemini_key', 'conformance-key');
    },

    teardown: restoreGlobals,
  };
}

/* -------------------------------------------------------------- OpenRouter */

/** Read the schema back out of an OpenAI-style `response_format`. */
function readOpenAiSchema(body: Record<string, unknown>): unknown {
  const format = body.response_format as Record<string, unknown> | undefined;
  if (!format) return undefined;
  if (format.type === 'json_schema') {
    const wrapper = format.json_schema as Record<string, unknown> | undefined;
    return wrapper?.schema;
  }
  return undefined;
}

function readOpenAiSystem(body: Record<string, unknown>): string | undefined {
  const messages = body.messages as Array<{ role?: string; content?: string }> | undefined;
  return messages?.find((m) => m.role === 'system')?.content;
}

/** Build an SSE body in the shape OpenRouter streams. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const text of chunks) {
        const frame = JSON.stringify({ choices: [{ delta: { content: text } }] });
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

export function createOpenRouterHarness(): ProviderHarness {
  let wire: WireRequest = { ...EMPTY_WIRE };

  const capture = (input: RequestInit | undefined): Record<string, unknown> => {
    const body = JSON.parse(String(input?.body ?? '{}')) as Record<string, unknown>;
    const format = body.response_format as Record<string, unknown> | undefined;
    wire = {
      model: typeof body.model === 'string' ? body.model : undefined,
      schema: readOpenAiSchema(body),
      jsonMode: format !== undefined,
      systemInstruction: readOpenAiSystem(body),
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      abortWired: input?.signal !== undefined && input?.signal !== null,
      tools: body.tools,
    };
    return body;
  };

  const install = (handler: (body: Record<string, unknown>) => Response): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, input?: RequestInit) => handler(capture(input))),
    );
  };

  return {
    id: 'openrouter',
    label: 'OpenRouterProvider',

    settings: () => baseSettings('openrouter/auto'),

    create(settings?: Settings): AIProvider {
      localStorage.setItem('user_openrouter_key', 'conformance-key');
      return new OpenRouterProvider({ settings: settings ?? baseSettings('openrouter/auto') });
    },

    stubText(text: string, usage?: WireUsage) {
      install(() =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: text }, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: usage?.promptTokens,
              completion_tokens: usage?.completionTokens,
              total_tokens: usage?.totalTokens,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    },

    stubStream(chunks: string[]) {
      install(
        () =>
          new Response(sseStream(chunks), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      );
    },

    stubFailure(status: number, message = 'backend failure') {
      install(
        () =>
          new Response(JSON.stringify({ error: { message } }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
    },

    stubToolCall(name: string, args: Record<string, unknown>) {
      install(
        () =>
          new Response(
            JSON.stringify({
              id: 'resp-openrouter-1',
              choices: [
                {
                  message: {
                    content: '',
                    tool_calls: [
                      { id: 'call_1', function: { name, arguments: JSON.stringify(args) } },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    },

    stubTruncated(text: string) {
      install(
        () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'length' }] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    },

    readWire: () => wire,

    reset() {
      wire = { ...EMPTY_WIRE };
      localStorage.setItem('user_openrouter_key', 'conformance-key');
    },

    teardown: restoreGlobals,
  };
}

/* --------------------------------------------------------------- Anthropic */

/** Read the schema back out of Claude's `output_config.format`. */
function readAnthropicSchema(body: Record<string, unknown>): unknown {
  const config = body.output_config as Record<string, unknown> | undefined;
  const format = config?.format as Record<string, unknown> | undefined;
  return format?.schema;
}

/** Build an SSE body in the shape Claude streams. */
function anthropicSse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'message_start' })}\n\n`),
      );
      for (const text of chunks) {
        const frame = JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text },
        });
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`),
      );
      controller.close();
    },
  });
}

export function createAnthropicHarness(): ProviderHarness {
  let wire: WireRequest = { ...EMPTY_WIRE };

  const capture = (input: RequestInit | undefined): void => {
    const body = JSON.parse(String(input?.body ?? '{}')) as Record<string, unknown>;
    wire = {
      model: typeof body.model === 'string' ? body.model : undefined,
      schema: readAnthropicSchema(body),
      jsonMode: body.output_config !== undefined,
      // Claude carries the system prompt as a top-level field, not a message.
      systemInstruction: typeof body.system === 'string' ? body.system : undefined,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      abortWired: input?.signal !== undefined && input?.signal !== null,
      tools: body.tools,
    };
  };

  const install = (handler: () => Response): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, input?: RequestInit) => {
        capture(input);
        return handler();
      }),
    );
  };

  return {
    id: 'anthropic',
    label: 'AnthropicProvider',

    // A model that still accepts `temperature`, so the shared assertion about
    // forwarding it exercises real behaviour rather than the omission rule.
    settings: () => baseSettings('claude-haiku-4-5'),

    create(settings?: Settings): AIProvider {
      localStorage.setItem('user_anthropic_key', 'conformance-key');
      return new AnthropicProvider({ settings: settings ?? baseSettings('claude-haiku-4-5') });
    },

    stubText(text: string, usage?: WireUsage) {
      install(
        () =>
          new Response(
            JSON.stringify({
              content: [{ type: 'text', text }],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: usage?.promptTokens,
                output_tokens: usage?.completionTokens,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    },

    stubStream(chunks: string[]) {
      install(
        () =>
          new Response(anthropicSse(chunks), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      );
    },

    stubFailure(status: number, message = 'backend failure') {
      install(
        () =>
          new Response(JSON.stringify({ error: { message } }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          }),
      );
    },

    stubToolCall(name: string, args: Record<string, unknown>) {
      install(
        () =>
          new Response(
            JSON.stringify({
              id: 'resp-anthropic-1',
              content: [{ type: 'tool_use', id: 'call_1', name, input: args }],
              stop_reason: 'tool_use',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    },

    stubTruncated(text: string) {
      install(
        () =>
          new Response(
            JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'max_tokens' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    },

    readWire: () => wire,

    reset() {
      wire = { ...EMPTY_WIRE };
      localStorage.setItem('user_anthropic_key', 'conformance-key');
    },

    teardown: restoreGlobals,
  };
}
