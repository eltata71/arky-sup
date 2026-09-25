/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../../../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: vi.fn(() => ({
    models: { generateContent, generateContentStream },
  })),
}));

import { GeminiProvider } from '../../../../services/ai/providers/gemini/GeminiProvider';
import { AIError } from '../../../../services/ai/core/AIError';
import { collectStream } from '../../../../services/ai/core/AIStream';
import type { Settings } from '../../../../types';

const settings = (apiKeySource: 'user' | 'global' = 'user'): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource,
  },
});

describe('GeminiProvider', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('declares its capabilities', () => {
    const provider = new GeminiProvider({ settings: settings() });
    expect(provider.id).toBe('gemini');
    expect(provider.name).toBe('Google Gemini');
    expect(provider.capabilities).toEqual({
      streaming: true,
      structuredOutput: true,
      tools: true,
      images: true,
      files: true,
      audio: true,
    });
  });

  it('encapsulates a successful generateContent call into an AIResponse', async () => {
    generateContent.mockResolvedValue({
      text: 'hello world',
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
      candidates: [{ finishReason: 'STOP' }],
    });
    const provider = new GeminiProvider({ settings: settings() });
    const response = await provider.generateText({
      purpose: 'unit-test',
      prompt: 'Say hello.',
      mode: 'balanced',
    });
    expect(response.text).toBe('hello world');
    expect(response.usage.promptTokens).toBe(12);
    expect(response.usage.totalTokens).toBe(20);
    expect(response.finishReason).toBe('STOP');
    expect(response.trace.provider).toBe('gemini');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('throws a configuration AIError when no API key is available', async () => {
    localStorage.clear();
    vi.stubEnv('VITE_GEMINI_API_KEY', '');
    const provider = new GeminiProvider({ settings: settings('user') });
    await expect(
      provider.generateText({ purpose: 'unit-test', prompt: 'hi' }),
    ).rejects.toMatchObject({ category: 'configuration', errorCode: 'missing_api_key' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('parses structured JSON output via generateStructured', async () => {
    generateContent.mockResolvedValue({ text: '```json\n{"score": 9}\n```' });
    const provider = new GeminiProvider({ settings: settings() });
    const response = await provider.generateStructured<{ score: number }>(
      { purpose: 'unit-test', prompt: 'rate it', responseFormat: 'json' },
      { type: 'object' },
    );
    expect(response.structured).toEqual({ score: 9 });
  });

  it('streams chunks through streamText', async () => {
    generateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'Hola ' };
        yield { text: 'Gemini' };
      })(),
    );
    const provider = new GeminiProvider({ settings: settings() });
    const stream = await provider.streamText({ purpose: 'unit-test', prompt: 'stream please' });
    expect(await collectStream(stream)).toBe('Hola Gemini');
  });

  it('translates a 429 SDK error into a rate-limit AIError', async () => {
    generateContent.mockRejectedValue({ status: 429, message: 'Resource exhausted' });
    const provider = new GeminiProvider({ settings: settings() });
    await expect(
      provider.generateText({ purpose: 'unit-test', prompt: 'go' }),
    ).rejects.toBeInstanceOf(AIError);
    await expect(
      provider.generateText({ purpose: 'unit-test', prompt: 'go' }),
    ).rejects.toMatchObject({ category: 'rate-limit', provider: 'gemini' });
  });

  it('translates a 503 SDK error into an overloaded AIError', async () => {
    generateContent.mockRejectedValue({ status: 503, message: 'high demand' });
    const provider = new GeminiProvider({ settings: settings() });
    await expect(
      provider.generateText({ purpose: 'unit-test', prompt: 'go' }),
    ).rejects.toMatchObject({ category: 'overloaded' });
  });

  it('classifyError exposes the canonical classifier', () => {
    const provider = new GeminiProvider({ settings: settings() });
    expect(provider.classifyError({ status: 500 })).toBeInstanceOf(AIError);
    expect(provider.classifyError({ status: 500 }).category).toBe('overloaded');
  });
});
