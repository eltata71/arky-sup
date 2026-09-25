/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Provider conformance — one suite, every provider, identical assertions.
 *
 * This is the instrument the model-independence work is judged by. It asserts
 * the *observable* contract of `AIProvider`: what the caller gets back, and
 * what actually reaches the backend. It never asks a provider what it can do —
 * a declared capability is a claim, and this suite exists because one of those
 * claims was false.
 *
 * A provider joins by supplying a `ProviderHarness`. Nothing else in this file
 * changes, which is the whole point: if adding a backend required editing the
 * assertions, the abstraction would not be one.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted SDK doubles for the Gemini transport. `vi.mock` is lifted above the
// imports, so these must be declared with it rather than inside the harness.
const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../../../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: vi.fn(() => ({
    models: { generateContent, generateContentStream },
  })),
}));

import { AIError } from '../../../../services/ai/core/AIError';
import { collectStream } from '../../../../services/ai/core/AIStream';
import { isEmptyResponse } from '../../../../services/ai/core/AIResponse';
import type { AIRequest } from '../../../../services/ai/core/AIRequest';
import {
  createAnthropicHarness,
  createGeminiHarness,
  createOpenRouterHarness,
} from './harnesses';
import {
  CONFORMANCE_PAYLOAD,
  CONFORMANCE_SCHEMA,
  type ProviderHarness,
} from './providerHarness';
import type { AIToolDefinition } from '../../../../services/ai/core/AITool';

/** One tool, declared neutrally, translated by whichever adapter is under test. */
const CONFORMANCE_TOOL: AIToolDefinition = {
  name: 'modifyArtifact',
  description: 'Aplica un cambio al artefacto activo.',
  parameters: {
    type: 'object',
    required: ['target'],
    properties: {
      target: { type: 'string', enum: ['current', 'new_version'] },
      newContent: { type: 'string' },
    },
  },
};

const harnesses: ProviderHarness[] = [
  createGeminiHarness({ generateContent, generateContentStream }),
  createOpenRouterHarness(),
  // Added for the third-provider acceptance test. Only this line and a harness
  // were needed — no assertion below changed.
  createAnthropicHarness(),
];

/** Minimal well-formed request; individual tests widen it. */
const req = (over: Partial<AIRequest> = {}): AIRequest => ({
  purpose: 'conformance',
  prompt: 'Describe el sistema en una frase.',
  ...over,
});

describe.each(harnesses)('AIProvider conformance — $label', (harness) => {
  beforeEach(() => {
    harness.reset();
  });

  afterEach(() => {
    harness.reset();
  });

  afterAll(() => {
    harness.teardown();
  });

  /* ---------------------------------------------------------- identity */

  it('declares a stable identity', () => {
    const provider = harness.create();
    expect(provider.id).toBe(harness.id);
    expect(provider.name.length).toBeGreaterThan(0);
  });

  /* ------------------------------------------------------- text output */

  it('normalises a successful generation into an AIResponse', async () => {
    harness.stubText('El sistema expone una API REST.', {
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });

    const response = await harness.create().generateText(req());

    expect(response.text).toBe('El sistema expone una API REST.');
    expect(response.usage.promptTokens).toBe(12);
    expect(response.usage.completionTokens).toBe(8);
    expect(response.usage.totalTokens).toBe(20);
    expect(typeof response.usage.durationMs).toBe('number');
  });

  it('seals a trace on every response', async () => {
    harness.stubText('ok');
    const response = await harness.create().generateText(req({ purpose: 'trace-check' }));

    expect(response.trace).toBeDefined();
    expect(response.trace.provider).toBe(harness.id);
    expect(response.trace.purpose).toBe('trace-check');
    expect(response.trace.requestId).toBeTruthy();
  });

  it('reports an empty generation as empty rather than as text', async () => {
    harness.stubText('');
    const response = await harness.create().generateText(req());
    expect(isEmptyResponse(response)).toBe(true);
  });

  /* ------------------------------------------------- request faithfulness */

  it('forwards the system instruction to the backend', async () => {
    harness.stubText('ok');
    await harness
      .create()
      .generateText(req({ systemInstruction: 'Responde siempre en español.' }));

    expect(harness.readWire().systemInstruction).toBe('Responde siempre en español.');
  });

  it('forwards the temperature to the backend', async () => {
    harness.stubText('ok');
    await harness.create().generateText(req({ temperature: 0.15 }));
    expect(harness.readWire().temperature).toBe(0.15);
  });

  it('asks the backend for a concrete model, never an empty one', async () => {
    harness.stubText('ok');
    await harness.create().generateText(req());
    expect(harness.readWire().model).toBeTruthy();
  });

  /* --------------------------------------------------- structured output */

  it('parses a structured generation into `structured`', async () => {
    harness.stubText(JSON.stringify(CONFORMANCE_PAYLOAD));

    const response = await harness
      .create()
      .generateStructured(req({ responseFormat: 'json' }), CONFORMANCE_SCHEMA);

    expect(response.structured).toEqual(CONFORMANCE_PAYLOAD);
  });

  it('recovers a fenced JSON payload the model wrapped in markdown', async () => {
    harness.stubText('```json\n' + JSON.stringify(CONFORMANCE_PAYLOAD) + '\n```');

    const response = await harness
      .create()
      .generateStructured(req({ responseFormat: 'json' }), CONFORMANCE_SCHEMA);

    expect(response.structured).toEqual(CONFORMANCE_PAYLOAD);
  });

  it('tells the backend it wants JSON', async () => {
    harness.stubText(JSON.stringify(CONFORMANCE_PAYLOAD));
    await harness
      .create()
      .generateStructured(req({ responseFormat: 'json' }), CONFORMANCE_SCHEMA);

    expect(harness.readWire().jsonMode).toBe(true);
  });

  /**
   * The assertion this whole suite was built for.
   *
   * A provider that declares `capabilities.structuredOutput` must put the schema on
   * the wire — in its own dialect, but recognisably the same schema. Declaring
   * the capability and dropping the payload is worse than declaring it false:
   * the call still succeeds, so the degradation is invisible at every layer
   * above.
   */
  it('puts the requested schema on the wire, in its own dialect', async () => {
    const provider = harness.create();
    if (!provider.capabilities.structuredOutput) return;

    harness.stubText(JSON.stringify(CONFORMANCE_PAYLOAD));
    await provider.generateStructured(req({ responseFormat: 'json' }), CONFORMANCE_SCHEMA);

    const sent = harness.readWire().schema as Record<string, unknown> | undefined;
    expect(sent, 'the provider dropped the schema on the way out').toBeDefined();

    // Dialect-neutral checks: the structure has to survive translation, whatever
    // the casing convention of the target backend.
    const asText = JSON.stringify(sent).toLowerCase();
    expect(asText).toContain('"title"');
    expect(asText).toContain('"items"');
    expect(asText).toContain('"weight"');
    expect(asText).toContain('diagram');
  });

  /* ------------------------------------------------------------ streaming */

  it('streams normalised chunks', async () => {
    const provider = harness.create();
    if (!provider.capabilities.streaming) return;

    harness.stubStream(['Un ', 'sistema ', 'distribuido.']);
    const stream = await provider.streamText(req());

    expect(await collectStream(stream)).toBe('Un sistema distribuido.');
  });

  it('yields chunks shaped as { text }', async () => {
    const provider = harness.create();
    if (!provider.capabilities.streaming) return;

    harness.stubStream(['a', 'b']);
    const seen: unknown[] = [];
    for await (const chunk of await provider.streamText(req())) seen.push(chunk);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ text: 'a' });
  });

  /* --------------------------------------------------------------- errors */

  it('translates a backend failure into an AIError', async () => {
    harness.stubFailure(500, 'upstream exploded');

    await expect(harness.create().generateText(req())).rejects.toBeInstanceOf(AIError);
  });

  it('classifies a rate limit as retryable', async () => {
    harness.stubFailure(429, 'rate limited');

    const error = await harness
      .create()
      .generateText(req())
      .catch((e: unknown) => e as AIError);

    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).retryable).toBe(true);
  });

  it('classifies an overload as retryable', async () => {
    harness.stubFailure(503, 'overloaded');

    const error = await harness
      .create()
      .generateText(req())
      .catch((e: unknown) => e as AIError);

    expect((error as AIError).retryable).toBe(true);
  });

  it('classifies a bad request as not retryable', async () => {
    harness.stubFailure(400, 'invalid argument');

    const error = await harness
      .create()
      .generateText(req())
      .catch((e: unknown) => e as AIError);

    expect((error as AIError).retryable).toBe(false);
  });

  it('always attributes an error to its own provider', async () => {
    harness.stubFailure(500);

    const error = await harness
      .create()
      .generateText(req())
      .catch((e: unknown) => e as AIError);

    expect((error as AIError).provider).toBe(harness.id);
  });

  /* -------------------------------------------------------------- tools */

  /**
   * `tools` was the capability that was never in the contract. Negotiation read
   * it through `(provider as { supportsTools?: boolean })` and defaulted to
   * *supported*, and the Gemini adapter — which does support them — built its
   * config without a `tools` key at all. Both halves were invisible: the call
   * succeeded and simply came back as prose.
   */
  it('puts declared tools on the wire when it claims to support them', async () => {
    const provider = harness.create();
    if (!provider.capabilities.tools) return;

    harness.stubText('ok');
    await provider.generateText(req({ tools: [CONFORMANCE_TOOL] }));

    const sent = harness.readWire().tools;
    expect(sent, 'the provider dropped the tool declarations on the way out').toBeDefined();
    expect(JSON.stringify(sent)).toContain(CONFORMANCE_TOOL.name);
  });

  it('sends no tools when the request declares none', async () => {
    harness.stubText('ok');
    await harness.create().generateText(req());
    expect(harness.readWire().tools).toBeUndefined();
  });

  it('normalises a tool call into the canonical shape, with a correlation id', async () => {
    const provider = harness.create();
    if (!provider.capabilities.tools) return;

    harness.stubToolCall('modifyArtifact', { target: 'current', newContent: 'x' });
    const response = await provider.generateText(req({ tools: [CONFORMANCE_TOOL] }));

    expect(response.toolCalls).toHaveLength(1);
    const [call] = response.toolCalls ?? [];
    expect(call.name).toBe('modifyArtifact');
    expect(call.arguments).toEqual({ target: 'current', newContent: 'x' });
    expect(call.toolCallId).toBeTruthy();
  });

  it('does not report a tool call as an empty response', async () => {
    const provider = harness.create();
    if (!provider.capabilities.tools) return;

    harness.stubToolCall('modifyArtifact', {});
    const response = await provider.generateText(req({ tools: [CONFORMANCE_TOOL] }));
    expect(isEmptyResponse(response)).toBe(false);
  });

  /* -------------------------------------------------------- stop reasons */

  /**
   * The three backends spell the same four outcomes six ways (`STOP`/`end_turn`
   * /`stop`, `MAX_TOKENS`/`max_tokens`/`length`). A caller asking "did this get
   * cut off?" should not have to know which one answered.
   */
  it('normalises a completed generation to `stop`', async () => {
    harness.stubText('completo');
    const response = await harness.create().generateText(req());
    expect(response.stopReason).toBe('stop');
  });

  it('normalises a truncated generation to `length`', async () => {
    harness.stubTruncated('cortad');
    const response = await harness.create().generateText(req());
    expect(response.stopReason).toBe('length');
  });

  it('keeps the backend’s own finish string for diagnostics', async () => {
    harness.stubTruncated('cortad');
    const response = await harness.create().generateText(req());
    expect(response.finishReason).toBeTruthy();
  });

  it('reports the backend’s own request id when it returns one', async () => {
    const provider = harness.create();
    if (!provider.capabilities.tools) return;

    harness.stubToolCall('modifyArtifact', {});
    const response = await provider.generateText(req({ tools: [CONFORMANCE_TOOL] }));
    expect(response.providerRequestId).toBeTruthy();
  });

  /* ------------------------------------------ classification, per category */

  /**
   * The executor now trusts `classifyError` completely: it stopped defaulting
   * to a Gemini-scoped classifier, so retry and fallback are decided from
   * whatever category the adapter returns. An adapter that answers `unknown` to
   * a 429 silently disables both. These four cases are the contract that makes
   * that trust safe.
   */
  it.each([
    [401, 'auth'],
    [429, 'rate-limit'],
    [503, 'overloaded'],
    [400, 'invalid-request'],
  ] as const)('classifies HTTP %i as %s', async (status, category) => {
    harness.stubFailure(status, `status ${status}`);
    const error = (await harness
      .create()
      .generateText(req())
      .catch((e: unknown) => e)) as AIError;
    expect(error.category).toBe(category);
  });

  /* ------------------------------------------------------ cancellation */

  it('wires the caller abort signal through to the backend', async () => {
    harness.stubText('ok');
    const controller = new AbortController();
    await harness.create().generateText(req({ signal: controller.signal }));

    expect(harness.readWire().abortWired).toBe(true);
  });
});
