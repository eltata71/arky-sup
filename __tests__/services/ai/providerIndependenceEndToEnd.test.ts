/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * End-to-end proof of model independence.
 *
 * The conformance suite checks each provider in isolation and the unit specs
 * check each seam. Neither answers the question the whole engagement was about:
 * when a real call site generates something, does the user's chosen provider
 * actually serve it, with the request intact?
 *
 * These specs run the monolith's own public entry point — the seam all 51
 * generation call sites funnel through — once per provider, with only
 * `aiConfig.provider` changed between runs, and assert against what reached the
 * wire. No provider is named by the caller; the settings decide.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: vi.fn(() => ({
    models: { generateContent, generateContentStream },
  })),
}));

// No proxy in these specs: the point is which provider the direct path picks.
vi.mock('../../../services/ai/aiProxyClient', () => ({
  callAiProxy: vi.fn(async () => null),
  streamAiProxy: vi.fn(async () => null),
  isAiProxyConfigured: () => false,
  getAiProxyUrl: () => null,
}));

import { aiGateway } from '../../../services/ai';
import { defineSchema } from '../../../services/ai/schema';
import type { AIConfig, Settings } from '../../../types';

/** A schema written once, in the neutral dialect, for every provider. */
const SCHEMA = defineSchema({
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string' },
    score: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
  },
});

const settingsFor = (over: Partial<AIConfig>): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: '',
    temperature: 0.3,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'user',
    ...over,
  },
});

/** What the last HTTP provider put on the wire. */
let lastBody: Record<string, unknown> = {};

const stubHttpProvider = (payload: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      lastBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
};

beforeEach(() => {
  lastBody = {};
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: '{"title":"ok"}', candidates: [{ finishReason: 'STOP' }] });
  localStorage.setItem('user_gemini_key', 'k');
  localStorage.setItem('user_openrouter_key', 'k');
  localStorage.setItem('user_anthropic_key', 'k');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** The Gemini-shaped config a real call site passes to the seam. */
const CONFIG = {
  responseMimeType: 'application/json',
  responseSchema: SCHEMA,
  systemInstruction: 'Responde en español.',
  temperature: 0.3,
};

describe('the active provider serves the request', () => {
  it('routes to Gemini when the settings say Gemini', async () => {
    const result = await aiGateway.generateContent(
      settingsFor({ provider: 'gemini', model: 'gemini-2.5-flash' }),
      'gemini-2.5-flash',
      'Genera un artefacto',
      CONFIG,
    );

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('{"title":"ok"}');
  });

  it('routes to OpenRouter when the settings say OpenRouter, without touching Gemini', async () => {
    stubHttpProvider({ choices: [{ message: { content: '{"title":"ok"}' } }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
      'openrouter/auto',
      'Genera un artefacto',
      CONFIG,
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(lastBody.model).toBe('openrouter/auto');
  });

  it('routes to Anthropic when the settings say Anthropic, without touching Gemini', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{"title":"ok"}' }], stop_reason: 'end_turn' });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'claude-sonnet-5',
      'Genera un artefacto',
      CONFIG,
    );

    expect(generateContent).not.toHaveBeenCalled();
    expect(lastBody.model).toBe('claude-sonnet-5');
  });
});

describe('the request survives the crossing', () => {
  it('carries the schema to OpenRouter, translated into its dialect', async () => {
    stubHttpProvider({ choices: [{ message: { content: '{}' } }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
      'openrouter/auto',
      'x',
      CONFIG,
    );

    const format = lastBody.response_format as { type: string; json_schema: { schema: unknown } };
    expect(format.type).toBe('json_schema');
    expect(JSON.stringify(format.json_schema.schema)).toContain('"title"');
  });

  it('carries the schema to Anthropic, translated into its dialect', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'claude-sonnet-5',
      'x',
      CONFIG,
    );

    const config = lastBody.output_config as { format: { type: string; schema: unknown } };
    expect(config.format.type).toBe('json_schema');
    expect(JSON.stringify(config.format.schema)).toContain('"title"');
  });

  it('carries the system instruction to every provider', async () => {
    stubHttpProvider({ choices: [{ message: { content: '{}' } }] });
    await aiGateway.generateContent(
      settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
      'openrouter/auto',
      'x',
      CONFIG,
    );
    const messages = lastBody.messages as Array<{ role: string; content: string }>;
    expect(messages.find((m) => m.role === 'system')?.content).toBe('Responde en español.');

    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });
    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'claude-sonnet-5',
      'x',
      CONFIG,
    );
    // Claude takes it as a top-level field rather than a message.
    expect(lastBody.system).toBe('Responde en español.');
  });
});

describe('no provider receives another provider’s model id', () => {
  /**
   * The reproducible defect this whole phase set closed: a tier resolved from
   * the shared Gemini tables and forwarded verbatim, so OpenRouter was asked
   * for `gemini-2.5-flash-lite`.
   */
  it('substitutes a Gemini id when the active provider is OpenRouter', async () => {
    stubHttpProvider({ choices: [{ message: { content: '{}' } }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
      'gemini-2.5-flash-lite', // what the quick tier used to hand over
      'x',
      CONFIG,
    );

    expect(lastBody.model).not.toBe('gemini-2.5-flash-lite');
    expect(String(lastBody.model)).toContain('/');
  });

  it('substitutes a Gemini id when the active provider is Anthropic', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'gemini-2.5-flash-lite',
      'x',
      CONFIG,
    );

    expect(String(lastBody.model)).toMatch(/^claude-/);
  });
});

describe('provider-specific rules stay inside their adapter', () => {
  it('omits temperature for a Claude model that rejects it', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'claude-sonnet-5',
      'x',
      CONFIG,
    );

    // Sampling controls were removed on Sonnet 5; sending one is a 400.
    expect(lastBody.temperature).toBeUndefined();
  });

  it('forwards temperature for a Claude model that accepts it', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
      'claude-haiku-4-5',
      'x',
      CONFIG,
    );

    expect(lastBody.temperature).toBe(0.3);
  });

  it('always sends the max_tokens Claude requires', async () => {
    stubHttpProvider({ content: [{ type: 'text', text: '{}' }] });

    await aiGateway.generateContent(
      settingsFor({ provider: 'anthropic', model: 'claude-sonnet-5' }),
      'claude-sonnet-5',
      'x',
      CONFIG,
    );

    expect(typeof lastBody.max_tokens).toBe('number');
  });
});
