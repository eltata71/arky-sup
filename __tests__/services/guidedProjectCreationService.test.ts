import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIServiceError } from '../../services/ai/errors';
import { legacyTransport } from '../../services/ai/generation/legacyTransport';
import { parseGuidedProjectCommand, sendGuidedProjectCreationMessage } from '../../services/ai/generation/guidedProjectCreationService';
import { getAiBlockingCooldownRemainingMs, getAiCooldownRemainingMs, setAiCooldown, __test__ as aiCallControlTest } from '../../services/ai/callControl/aiCallControlService';
import type { Settings } from '../../types';
import type { ChatMessage } from '../../services/chat';

const settings: Settings = {
  globalContext: ['estándar corporativo que no debe expandirse en creación guiada'],
  language: 'es',
  theme: 'dark',
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.2,
    tone: 'Profesional',
    languageStyle: 'es',
    apiKeySource: 'global',
  },
};

const baseHistory = (input = 'Portal de clientes'): ChatMessage[] => [
  { role: 'model', content: 'Hola, dime el nombre del proyecto.' },
  { role: 'user', content: input },
];

describe('guidedProjectCreationService', () => {
  beforeEach(() => {
    aiCallControlTest.reset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    aiCallControlTest.reset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });



  /**
   * F6-01: guided creation used its own route to the legacy Gemini-only proxy
   * (`api/gemini.ts`). In production `VITE_GEMINI_PROXY_URL` was empty, so it
   * asserted `not-configured` against the strict policy and refused anyone
   * without a personal key — before reaching `aiGateway`, whose `/api/ai` would
   * have answered. It now has one route, the gateway's, proxy first.
   */
  const setAiProxyUrl = (value: string | undefined) => {
    if (value === undefined) delete (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL;
    else (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL = value;
  };
  const proxyAnswer = (text: string) => vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ requestId: 'proxy-1', text, provider: 'gemini', model: 'gemini-2.5-flash' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  );

  it('goes through the provider-agnostic proxy first, never the direct client', async () => {
    setAiProxyUrl('/api/ai');
    const fetchMock = proxyAnswer('¿Cuál es el objetivo?');
    vi.stubGlobal('fetch', fetchMock);
    const directSpy = vi.spyOn(legacyTransport, 'getAIClient');
    try {
      const result = await sendGuidedProjectCreationMessage(baseHistory('Banca móvil'), 'Banca móvil', settings);
      expect(result.text).toBe('¿Cuál es el objetivo?');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain('/api/ai');
      expect(directSpy).not.toHaveBeenCalled();
    } finally {
      setAiProxyUrl(undefined);
    }
  });

  it('under the strict policy and without a personal key it answers through the proxy instead of refusing', async () => {
    vi.stubEnv('VITE_AI_STRICT_PROXY', 'true');
    setAiProxyUrl('/api/ai');
    vi.stubGlobal('fetch', proxyAnswer('Describe el alcance.'));
    try {
      const result = await sendGuidedProjectCreationMessage(baseHistory('CRM'), 'CRM', settings);
      expect(result.text).toBe('Describe el alcance.');
    } finally {
      setAiProxyUrl(undefined);
    }
  });

  it('does not treat proxy-local cooldown as a UI-blocking Gemini cooldown', () => {
    setAiCooldown('guided-creation', 30_000, 'proxy-local-rate-limit');

    expect(getAiCooldownRemainingMs('guided-creation', 'proxy-local-rate-limit')).toBeGreaterThan(0);
    expect(getAiBlockingCooldownRemainingMs('guided-creation')).toBe(0);
  });

  it('normalizes the first model greeting into user-compatible contents and keeps the guided budget', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '¿Cuál es el objetivo?' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);
    const noisyHistory: ChatMessage[] = [
      { role: 'model', content: 'Hola, dime el nombre.' },
      { role: 'user', content: 'Proyecto A' },
      ...Array.from({ length: 12 }, (_, index) => ({ role: index % 2 === 0 ? 'model' : 'user', content: `mensaje ${index}` }) as ChatMessage),
    ];

    await sendGuidedProjectCreationMessage(noisyHistory, 'Proyecto A', settings);

    const payload = generateContent.mock.calls[0][0] as { contents: { role: string; parts: { text: string }[] }[] };
    expect(payload.contents.length).toBeLessThanOrEqual(8);
    expect(payload.contents[0].role).toBe('user');
    expect(JSON.stringify(payload.contents)).not.toContain('cursos LMS');
  });

  it('does not send projects, courses or artifact payloads on the first interaction', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"message":"¿Cuál es el objetivo principal?"}' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    await sendGuidedProjectCreationMessage(baseHistory(), 'Portal de clientes', settings);

    expect(generateContent).toHaveBeenCalledTimes(1);
    const payload = generateContent.mock.calls[0][0] as { contents: unknown; config: { systemInstruction: string } };
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('Portal de clientes');
    expect(serialized).not.toContain('EXISTING PROJECTS CONTEXT');
    expect(serialized).not.toContain('EXISTING COURSES CONTEXT');
    expect(serialized).not.toContain('Artifacts:');
    expect(payload.config.systemInstruction).toMatch(/No uses contexto de otros proyectos/i);
  });

  it('generates exactly one Gemini call per user message', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"message":"Describe el objetivo."}' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    await sendGuidedProjectCreationMessage(baseHistory('Sistema PBM'), 'Sistema PBM', settings);

    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('deduplicates double Enter or double click while the first call is in flight', async () => {
    let resolveCall: (value: { text: string }) => void = () => undefined;
    const generateContent = vi.fn(() => new Promise<{ text: string }>(resolve => { resolveCall = resolve; }));
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    const first = sendGuidedProjectCreationMessage(baseHistory('Cotizador'), 'Cotizador', settings);
    const second = sendGuidedProjectCreationMessage(baseHistory('Cotizador'), 'Cotizador', settings);
    resolveCall({ text: '{"message":"Objetivo?"}' });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('classifies 429 as rate-limit and activates cooldown', async () => {
    const generateContent = vi.fn().mockRejectedValue({ status: 429, message: 'quota exceeded', retryAfter: 7 });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    await expect(sendGuidedProjectCreationMessage(baseHistory('CRM'), 'CRM', settings)).rejects.toMatchObject({ category: 'rate-limit' });
    expect(getAiCooldownRemainingMs('guided-creation')).toBeGreaterThan(0);
  });

  it('falls back through MODEL_FALLBACK_CHAIN when the preferred model returns 429', async () => {
    // Standardised behaviour: when the preferred model is rate-limited, the
    // unified generation pipeline tries the next candidate in the fallback
    // chain (same path artifact-generation already uses) instead of
    // surfacing the first 429 as a hard error.
    const generateContent = vi.fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate' })
      .mockResolvedValueOnce({ text: '¿Cuál es el objetivo?' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    const result = await sendGuidedProjectCreationMessage(baseHistory('ERP'), 'ERP', settings);

    expect(result.text).toBe('¿Cuál es el objetivo?');
    expect(generateContent).toHaveBeenCalledTimes(2);
    const firstModel = (generateContent.mock.calls[0][0] as { model: string }).model;
    const secondModel = (generateContent.mock.calls[1][0] as { model: string }).model;
    expect(firstModel).toBe('gemini-2.5-flash');
    expect(secondModel).not.toBe(firstModel);
  });

  it('surfaces a rate-limit error only when every fallback model also fails', async () => {
    const generateContent = vi.fn().mockRejectedValue({ status: 429, message: 'rate' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    await expect(sendGuidedProjectCreationMessage(baseHistory('ERP'), 'ERP', settings)).rejects.toBeInstanceOf(AIServiceError);

    // All models in MODEL_FALLBACK_CHAIN should have been attempted before
    // surfacing the error — at least 2 attempts (more than the legacy single-call behaviour).
    expect(generateContent.mock.calls.length).toBeGreaterThan(1);
  });

  it('classifies 503 as temporary saturation and allows controlled retry after failure', async () => {
    const generateContent = vi.fn().mockRejectedValue({ status: 503, message: 'overloaded' });
    vi.spyOn(legacyTransport, 'getAIClient').mockReturnValue({ models: { generateContent } } as never);

    await expect(sendGuidedProjectCreationMessage(baseHistory('Pagos'), 'Pagos', settings)).rejects.toMatchObject({ category: 'overloaded' });
    expect(getAiCooldownRemainingMs('guided-creation')).toBeGreaterThan(0);
  });

  it('parses action createProject even when the model wraps JSON with text', () => {
    const command = parseGuidedProjectCommand(`Listo:\n\n{\n  "action": "createProject",\n  "data": {\n    "name": "Portal",\n    "description": "Portal de clientes",\n    "projectContext": ["Seguro de salud"],\n    "initialArtifacts": ["Diagrama de Contexto (C4-N1)"]\n  }\n}`);

    expect(command).toEqual({
      action: 'createProject',
      data: {
        name: 'Portal',
        description: 'Portal de clientes',
        projectContext: ['Seguro de salud'],
        initialArtifacts: ['Diagrama de Contexto (C4-N1)'],
      },
    });
  });
});
