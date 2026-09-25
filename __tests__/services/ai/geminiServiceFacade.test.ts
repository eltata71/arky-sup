/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Engine façade compatibility (the engine is `artifactGenerationEngine` since
 * F5-01 corte 14) — proves the legacy public surface still
 * works after its retry/timeout/model-fallback loop was migrated onto the
 * provider-agnostic `AIRequestExecutor`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../../../services/ai/providers/gemini/geminiClient', () => ({
  createGeminiAIClient: vi.fn(() => ({
    models: { generateContent, generateContentStream },
  })),
}));

import { artifactGenerationEngine as geminiService } from '../../../services/ai/generation/artifacts/artifactGenerationEngine';
import { AIServiceError } from '../../../services/ai/errors';
import { generateDiagramIR } from '../../../services/ai/generation/diagram';
import { legacyTransport } from '../../../services/ai/generation/legacyTransport';
import type { Settings } from '../../../types';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import type { DiagramIR } from '../../../lib/diagram';

const settings: Settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'user',
  },
};

describe('geminiService façade — generateContentWithFallback', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns normalised text through the migrated executor', async () => {
    generateContent.mockResolvedValue({ text: 'ok', functionCalls: undefined });
    const result = await geminiService.generateContentWithFallback(
      settings,
      'gemini-2.5-flash',
      'hello',
      {},
    );
    expect(result.text).toBe('ok');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('falls through to the next model on an unrecoverable model error', async () => {
    generateContent
      .mockRejectedValueOnce({ status: 400, message: 'invalid model foo' })
      .mockResolvedValueOnce({ text: 'recovered', functionCalls: undefined });
    const result = await geminiService.generateContentWithFallback(
      settings,
      'gemini-2.5-flash',
      'hello',
      {},
    );
    expect(result.text).toBe('recovered');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('surfaces a 429 as a AIServiceError (legacy error type preserved)', async () => {
    generateContent.mockRejectedValue({ status: 429, message: 'rate limit exceeded' });
    await expect(
      geminiService.generateContentWithFallback(settings, 'gemini-2.5-flash', 'hello', {}),
    ).rejects.toBeInstanceOf(AIServiceError);
    await expect(
      geminiService.generateContentWithFallback(settings, 'gemini-2.5-flash', 'hello', {}),
    ).rejects.toMatchObject({ category: 'rate-limit' });
  });

  it('streams content through the migrated executor', async () => {
    generateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'part-1 ' };
        yield { text: 'part-2' };
      })(),
    );
    const stream = await geminiService.generateContentStreamWithFallback(
      settings,
      'gemini-2.5-flash',
      'hello',
      {},
    );
    let collected = '';
    for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
      collected += chunk.text ?? '';
    }
    expect(collected).toBe('part-1 part-2');
  });
});

describe('geminiService façade — OpenRouter dispatch', () => {
  const openRouterSettings: Settings = {
    theme: 'dark',
    language: 'es',
    globalContext: [],
    aiConfig: {
      model: 'openrouter/deepseek/deepseek-chat',
      provider: 'openrouter',
      temperature: 0.7,
      tone: 'Profesional y Técnico',
      languageStyle: 'Conciso y directo',
      apiKeySource: 'user',
    },
  };

  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    localStorage.setItem('user_openrouter_key', 'test-or-key');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('serves generateContentWithFallback through OpenRouter (not Gemini) when provider is openrouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'from-openrouter' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await geminiService.generateContentWithFallback(
      openRouterSettings,
      'openrouter/deepseek/deepseek-chat',
      'hello',
      {},
    );

    // The text must come from the OpenRouter mock — the Gemini client mock
    // must never have been touched.
    expect(result.text).toBe('from-openrouter');
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The request actually hit the OpenRouter endpoint with the resolved key
    // and the preferred model forwarded as the model id.
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toContain('chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-or-key');
    const sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sentBody.model).toBe('openrouter/deepseek/deepseek-chat');
  });

  it('isOpenRouterConfigured reflects the provider selection', () => {
    expect(geminiService.isOpenRouterConfigured(openRouterSettings)).toBe(true);
    expect(geminiService.isOpenRouterConfigured(settings)).toBe(false);
  });

  it('streams through OpenRouter (not Gemini) when provider is openrouter', async () => {
    const encoder = new TextEncoder();
    const sseChunks = [
      JSON.stringify({ choices: [{ delta: { content: 'part-1 ' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'part-2' } }] }),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const stream = await geminiService.generateContentStreamWithFallback(
      openRouterSettings,
      'openrouter/deepseek/deepseek-chat',
      'hello',
      {},
    );
    let collected = '';
    for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
      collected += chunk.text ?? '';
    }
    expect(collected).toBe('part-1 part-2');
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('routes generateTextWithFallback through OpenRouter (not Gemini) for diagram IR generation', async () => {
    const ir: DiagramIR = {
      nodes: [{ id: 'n1', label: 'Sistema', kind: 'System' }],
      edges: [],
      groups: [],
      metadata: { sourceFormat: 'unknown', audience: 'technical', generatedAt: '2026-08-03T00:00:00.000Z' },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(ir) } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const artifact = {
      id: 'art-1',
      versionGroupId: 'grp-1',
      version: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      name: 'Diagrama',
      type: 'mermaid-c4-context',
      phase: 'architecture',
      architecturalView: 'Vista de Contexto y Negocio',
      content: '',
      objective: 'Mostrar contexto',
      keyConcepts: [],
      representation: 'diagram',
    } as Artifact;

    const project = {
      id: 'proj-1',
      name: 'Proyecto',
      description: 'Desc',
      projectContext: [],
      artifacts: [],
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    } as Project;

    // generateDiagramIR (out of the engine since F5-01 corte 6) routes
    // through the shared transport's generateTextWithFallback.
    const result = await generateDiagramIR(artifact, project, openRouterSettings);

    // The IR must originate from the OpenRouter mock — the Gemini client mock
    // must never have been touched.
    expect(result).not.toBeNull();
    expect(result!.nodes[0].id).toBe('n1');
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toContain('chat/completions');
    const sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sentBody.model).toBe('openrouter/deepseek/deepseek-chat');
  });
});

describe('geminiService façade — proxy streaming dispatch', () => {
  const setProxyUrl = (value: string | undefined) => {
    if (value === undefined) delete (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL;
    else (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL = value;
  };

  beforeEach(() => {
    generateContent.mockReset();
    generateContentStream.mockReset();
    vi.restoreAllMocks();
    localStorage.setItem('user_gemini_key', 'test-key');
  });

  afterEach(() => {
    setProxyUrl(undefined);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('routes Gemini streaming through the proxy when configured (not the direct SDK)', async () => {
    setProxyUrl('/api/ai');
    const encoder = new TextEncoder();
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"hola "}\n\n'));
        controller.enqueue(encoder.encode('data: {"text":"mundo"}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const stream = await geminiService.generateContentStreamWithFallback(
      settings,
      'gemini-2.5-flash',
      'hola',
      {},
    );

    let collected = '';
    for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
      collected += chunk.text ?? '';
    }
    expect(collected).toBe('hola mundo');
    // The direct Gemini stream client must never have been reached.
    expect(generateContentStream).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('/api/ai');
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.stream).toBe(true);
    expect(sent.provider).toBe('gemini');
  });

  it('routes generateTextWithFallback through the proxy when configured (not the direct SDK)', async () => {
    // The text path is the one diagram IR and artifact generation use. It
    // skipped the proxy, so in production — operator key on the server, no
    // personal key in the browser — every call was refused before reaching a
    // model. It must behave like the content and streaming paths.
    setProxyUrl('/api/ai');
    localStorage.clear();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'r1', text: '{"nodes":[]}', provider: 'gemini', model: 'gemini-2.5-flash' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await legacyTransport.generateTextWithFallback(
      { ...settings, aiConfig: { ...settings.aiConfig!, apiKeySource: 'global' } },
      'gemini-2.5-flash',
      'describe el sistema',
      { temperature: 0.2, responseMimeType: 'application/json' },
    );

    expect(text).toBe('{"nodes":[]}');
    expect(generateContent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe('/api/ai');
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.provider).toBe('gemini');
    expect(sent.responseMimeType).toBe('application/json');
  });

  it('keeps generateTextWithFallback direct when the proxy is not configured', async () => {
    generateContent.mockResolvedValue({ text: 'directo' });

    const text = await legacyTransport.generateTextWithFallback(settings, 'gemini-2.5-flash', 'hola', {});

    expect(text).toBe('directo');
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('keeps streaming direct when the proxy is not configured', async () => {
    generateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'directo' };
      })(),
    );

    const stream = await geminiService.generateContentStreamWithFallback(
      settings,
      'gemini-2.5-flash',
      'hola',
      {},
    );
    let collected = '';
    for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
      collected += chunk.text ?? '';
    }
    expect(collected).toBe('directo');
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });
});
