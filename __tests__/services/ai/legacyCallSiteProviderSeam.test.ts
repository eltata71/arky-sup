/**
 * Regression guard for the provider-agnostic seam sweep (follow-up of PR #204).
 *
 * `intentClassifierLLM`, `memoryExtractor` and `chatCompactor` used to call
 * `ai.models.generateContent` directly, which pinned them to Gemini and
 * ignored `aiConfig.provider`. They now go through `aiGateway`, whose
 * transport (`legacyTransport.generateContentWithFallback`) is the single seam
 * that dispatches to Gemini or OpenRouter. Since F5-01 that transport no longer
 * lives in the engine, so these call sites do not load it at all.
 *
 * These specs assert three things per call site:
 *  1. the seam is used (never the engine's `getAIClient`),
 *  2. the Gemini structured-output config (`responseMimeType` +
 *     `responseSchema`) is forwarded unchanged, and
 *  3. the existing failure fallback still holds (null / heuristic verdict).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Settings } from '../../../types';

// `vi.mock` is hoisted above the module scope, so the spies must be created
// with `vi.hoisted` to be reachable from the factory.
const { generateContentWithFallback, getAIClient } = vi.hoisted(() => ({
  generateContentWithFallback: vi.fn(),
  getAIClient: vi.fn(() => {
    throw new Error('getAIClient must not be used — the provider seam is mandatory.');
  }),
}));

vi.mock('../../../services/ai/generation/legacyTransport', () => ({
  legacyTransport: { generateContentWithFallback },
}));
// The engine is still mocked so that reaching it at all fails loudly: these
// call sites compose their own prompt and have no business in it (F5-01).
vi.mock('../../../services/geminiService', () => ({
  geminiService: { generateContentWithFallback: getAIClient, getAIClient },
}));

// Partial mock: only model resolution is pinned. The real module also supplies
// the tier tables the provider catalogs are built from, so the rest has to come
// through — replacing it wholesale leaves `geminiCatalog` without a tier table.
vi.mock('../../../lib/ai/modelCatalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai/modelCatalog')>()),
  resolveEffectiveModel: () => ({ id: 'model-under-test' }),
  MODEL_FALLBACK_CHAIN: [],
}));

import { refineIntentWithLLM, __resetIntentClassifierCache } from '../../../services/agent/intentClassifierLLM';
import { extractMemoryBullets, fallbackBulletsFromInstruction, type ExtractMemoryBulletsInput } from '../../../services/agent/memoryExtractor';
import { compactChatMessages } from '../../../services/chat/chatCompactor';
import type { AgentContext, AgentIntent } from '../../../services/agent/agentTypes';

const settingsFor = (provider: 'gemini' | 'openrouter'): Settings => ({
  globalContext: [],
  language: 'es',
  theme: 'light',
  aiConfig: {
    model: provider === 'openrouter' ? 'openrouter/deepseek/deepseek-chat' : 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'professional',
    languageStyle: 'concise',
    apiKeySource: 'global',
    provider,
  },
});

const heuristicIntent: AgentIntent = {
  type: 'unknown',
  confidence: 0.3,
  userInstruction: 'aplica eso',
  artifactId: 'art-1',
  artifactVersionGroupId: 'grp-1',
  artifactViewContext: null,
  extractedRequirements: [],
  requiresConfirmation: true,
  impact: 'medium',
  suggestedTarget: 'new_version',
};

const context = {
  artifact: { id: 'art-1', name: 'Diagrama de Contexto' },
  viewMode: 'canvas',
} as unknown as AgentContext;

/** Shape of the seam's positional arguments: (settings, model, contents, config, options). */
const configOf = (call: unknown[]): Record<string, unknown> => call[3] as Record<string, unknown>;
const optionsOf = (call: unknown[]): Record<string, unknown> => call[4] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetIntentClassifierCache();
});

describe('intentClassifierLLM goes through the provider seam', () => {
  it('forwards the Gemini structured-output config unchanged', async () => {
    generateContentWithFallback.mockResolvedValue({
      text: JSON.stringify({ type: 'artifact.improve', confidence: 0.9, impact: 'medium', suggestedTarget: 'new_version' }),
    });

    const refined = await refineIntentWithLLM({
      userInput: 'aplica eso',
      context,
      heuristicIntent,
      settings: settingsFor('gemini'),
    });

    expect(getAIClient).not.toHaveBeenCalled();
    expect(generateContentWithFallback).toHaveBeenCalledTimes(1);

    const call = generateContentWithFallback.mock.calls[0];
    expect(call[1]).toBe('model-under-test');
    expect(configOf(call)).toMatchObject({ responseMimeType: 'application/json', temperature: 0.1 });
    expect(configOf(call).responseSchema).toBeDefined();
    // Single attempt — identical to the previous direct SDK call.
    expect(optionsOf(call)).toMatchObject({ maxRetries: 0, maxCandidates: 1 });
    expect(refined.type).toBe('artifact.improve');
  });

  it('uses the same seam when the provider is OpenRouter', async () => {
    generateContentWithFallback.mockResolvedValue({
      text: JSON.stringify({ type: 'artifact.patch', confidence: 0.88, impact: 'low', suggestedTarget: 'new_version' }),
    });

    const refined = await refineIntentWithLLM({
      userInput: 'cambia el nombre del nodo',
      context,
      heuristicIntent,
      settings: settingsFor('openrouter'),
    });

    expect(generateContentWithFallback).toHaveBeenCalledTimes(1);
    expect(generateContentWithFallback.mock.calls[0][0]).toMatchObject({
      aiConfig: expect.objectContaining({ provider: 'openrouter' }),
    });
    expect(refined.type).toBe('artifact.patch');
  });

  it('keeps the heuristic verdict when the seam throws', async () => {
    generateContentWithFallback.mockRejectedValue(new Error('provider down'));

    const refined = await refineIntentWithLLM({
      userInput: 'algo ambiguo',
      context,
      heuristicIntent,
      settings: settingsFor('gemini'),
    });

    expect(refined).toBe(heuristicIntent);
  });

  it('keeps the heuristic verdict on malformed JSON', async () => {
    generateContentWithFallback.mockResolvedValue({ text: 'not json at all' });

    const refined = await refineIntentWithLLM({
      userInput: 'otra cosa ambigua',
      context,
      heuristicIntent,
      settings: settingsFor('gemini'),
    });

    expect(refined).toBe(heuristicIntent);
  });
});

describe('memoryExtractor goes through the provider seam', () => {
  const input: ExtractMemoryBulletsInput = {
    scope: 'project',
    history: [{ role: 'user', content: 'Recuerda que usamos PostgreSQL 15.' }],
    userInstruction: 'Recuerda que usamos PostgreSQL 15.',
    projectName: 'Arky',
    settings: settingsFor('gemini'),
  };

  it('forwards the structured-output config and returns sanitised bullets', async () => {
    generateContentWithFallback.mockResolvedValue({
      text: JSON.stringify({ bullets: ['Usamos PostgreSQL 15 como base principal'] }),
    });

    const bullets = await extractMemoryBullets(input);

    expect(getAIClient).not.toHaveBeenCalled();
    const call = generateContentWithFallback.mock.calls[0];
    expect(configOf(call)).toMatchObject({ responseMimeType: 'application/json', temperature: 0.2 });
    expect(configOf(call).responseSchema).toBeDefined();
    expect(optionsOf(call)).toMatchObject({ maxRetries: 0, maxCandidates: 1 });
    expect(bullets).toEqual(['Usamos PostgreSQL 15 como base principal']);
  });

  it('honours the OpenRouter provider selection', async () => {
    generateContentWithFallback.mockResolvedValue({ text: JSON.stringify({ bullets: ['Latencia objetivo 200ms'] }) });

    await extractMemoryBullets({ ...input, settings: settingsFor('openrouter') });

    expect(generateContentWithFallback.mock.calls[0][0]).toMatchObject({
      aiConfig: expect.objectContaining({ provider: 'openrouter' }),
    });
  });

  it('returns null on failure so the deterministic fallback takes over', async () => {
    generateContentWithFallback.mockRejectedValue(new Error('provider down'));

    expect(await extractMemoryBullets(input)).toBeNull();
    // The caller-side fallback is unaffected by the seam change.
    expect(fallbackBulletsFromInstruction(input.userInstruction)).toHaveLength(1);
  });
});

describe('chatCompactor goes through the provider seam', () => {
  const messages = [
    { role: 'user' as const, content: 'Quiero una arquitectura serverless' },
    { role: 'model' as const, content: 'Empecemos por el contexto' },
  ];

  it('forwards the structured-output config and returns a digest', async () => {
    generateContentWithFallback.mockResolvedValue({
      text: JSON.stringify({ title: 'Arquitectura serverless', summary: 'Resumen del hilo', topics: ['serverless'] }),
    });

    const digest = await compactChatMessages(messages, settingsFor('gemini'));

    expect(getAIClient).not.toHaveBeenCalled();
    const call = generateContentWithFallback.mock.calls[0];
    expect(configOf(call)).toMatchObject({ responseMimeType: 'application/json', temperature: 0.2 });
    expect(configOf(call).responseSchema).toBeDefined();
    expect(optionsOf(call)).toMatchObject({ maxRetries: 0, maxCandidates: 1 });
    expect(digest?.title).toBe('Arquitectura serverless');
  });

  it('honours the OpenRouter provider selection', async () => {
    generateContentWithFallback.mockResolvedValue({
      text: JSON.stringify({ title: 'T', summary: 'S' }),
    });

    await compactChatMessages(messages, settingsFor('openrouter'));

    expect(generateContentWithFallback.mock.calls[0][0]).toMatchObject({
      aiConfig: expect.objectContaining({ provider: 'openrouter' }),
    });
  });

  it('returns null on failure so the deterministic digest takes over', async () => {
    generateContentWithFallback.mockRejectedValue(new Error('provider down'));

    expect(await compactChatMessages(messages, settingsFor('gemini'))).toBeNull();
  });

  it('returns null when the model omits the required title/summary', async () => {
    generateContentWithFallback.mockResolvedValue({ text: JSON.stringify({ topics: ['x'] }) });

    expect(await compactChatMessages(messages, settingsFor('gemini'))).toBeNull();
  });
});
