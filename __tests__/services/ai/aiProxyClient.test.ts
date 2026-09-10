/**
 * Specs for the provider-agnostic proxy client (`services/ai/aiProxyClient`).
 *
 * The contract that matters is the degradation guarantee: when
 * `VITE_AI_PROXY_URL` is unset — or the proxy fails for any reason — the
 * client returns `null` so the caller keeps its current direct-provider
 * behaviour untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../firebase', () => ({
  auth: {
    currentUser: {
      uid: 'user-42',
      getIdToken: vi.fn(async () => 'id-token-for-user-42'),
    },
  },
}));

import {
  callAiProxy,
  callAiProxyDetailed,
  DEFAULT_AI_PROXY_PATH,
  getAiProxyUrl,
  isAiProxyConfigured,
  streamAiProxy,
} from '../../../services/ai/aiProxyClient';

const setProxyUrl = (value: string | undefined) => {
  if (value === undefined) delete (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL;
  else (import.meta.env as Record<string, unknown>).VITE_AI_PROXY_URL = value;
};

const setProdBuild = (value: boolean) => {
  (import.meta.env as Record<string, unknown>).PROD = value;
};

const baseRequest = {
  provider: 'gemini' as const,
  model: 'gemini-2.5-flash',
  contents: 'hola',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  setProxyUrl(undefined);
});

afterEach(() => {
  setProxyUrl(undefined);
  setProdBuild(false);
});

describe('isAiProxyConfigured', () => {
  it('is false when VITE_AI_PROXY_URL is unset or blank', () => {
    expect(isAiProxyConfigured()).toBe(false);
    setProxyUrl('   ');
    expect(isAiProxyConfigured()).toBe(false);
  });

  it('is true when a proxy URL is configured', () => {
    setProxyUrl('/api/ai');
    expect(isAiProxyConfigured()).toBe(true);
  });
});

describe('el endpoint por defecto', () => {
  it('en desarrollo no hay proxy implícito: la ruta directa sigue igual', () => {
    expect(getAiProxyUrl()).toBeNull();
    expect(isAiProxyConfigured()).toBe(false);
  });

  it('un build de producción usa el /api/ai que despliega a su lado', () => {
    // Exigir la variable convertía un olvido del panel de Vercel en «toda la IA
    // bloqueada», apuntando a una ruta que ese mismo despliegue ya servía.
    setProdBuild(true);
    expect(getAiProxyUrl()).toBe(DEFAULT_AI_PROXY_PATH);
    expect(isAiProxyConfigured()).toBe(true);
  });

  it('una variable configurada manda sobre el valor por defecto', () => {
    setProdBuild(true);
    setProxyUrl('https://proxy.example/api/ai');
    expect(getAiProxyUrl()).toBe('https://proxy.example/api/ai');
  });

  it('sin función desplegada el 404 se cuenta como «no configurado», no como fallo del proveedor', async () => {
    setProdBuild(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));

    const outcome = await callAiProxyDetailed(baseRequest);
    expect(outcome).toMatchObject({ ok: false, reason: 'not-configured', retryable: false });
  });

  it('el index.html del SPA servido en /api/ai tampoco es el proxy', async () => {
    // El rewrite catch-all responde 200 con HTML. Contarlo como `malformed`
    // invitaría a reintentar algo que no puede funcionar nunca.
    setProdBuild(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    const outcome = await callAiProxyDetailed(baseRequest);
    expect(outcome).toMatchObject({ ok: false, reason: 'not-configured' });
  });
});

describe('callAiProxy', () => {
  it('returns null without touching the network when unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await callAiProxy(baseRequest)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts the request and returns the generated text', async () => {
    setProxyUrl('/api/ai');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'r1', text: 'respuesta' }), { status: 200 }),
    );

    const text = await callAiProxy({
      ...baseRequest,
      provider: 'openrouter',
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
      temperature: 0.2,
    });

    expect(text).toBe('respuesta');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      provider: 'openrouter',
      model: 'gemini-2.5-flash',
      contents: 'hola',
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
      temperature: 0.2,
    });
    // The identity travels as a verifiable ID token, not as a bare uid the
    // server would have to take on trust.
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer id-token-for-user-42');
    expect(headers['x-arky-user-id']).toBeUndefined();
    expect(headers['x-arky-session-id']).toEqual(expect.any(String));
  });

  it('returns null on a proxy error response so the caller falls back', async () => {
    setProxyUrl('/api/ai');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'proxy_rate_limited' }), { status: 429 }),
    );

    expect(await callAiProxy(baseRequest)).toBeNull();
  });

  it('returns null when the proxy is unreachable', async () => {
    setProxyUrl('/api/ai');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    expect(await callAiProxy(baseRequest)).toBeNull();
  });

  it('returns null when the proxy answers without usable text', async () => {
      setProxyUrl('/api/ai');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ requestId: 'r1', text: '' }), { status: 200 }),
      );

      expect(await callAiProxy(baseRequest)).toBeNull();
    });
  });

  const sseStream = (frames: string[]): ReadableStream<Uint8Array> => {
    const encoder = new TextEncoder();
    const chunks = frames.map(frame => encoder.encode(frame));
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  };

  describe('streamAiProxy', () => {
    it('returns null without touching the network when unconfigured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      expect(await streamAiProxy(baseRequest)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('posts with stream flag and yields text chunks from the SSE body', async () => {
      setProxyUrl('/api/ai');
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          sseStream([
            'data: {"text":"hola"}\n\n',
            'data: {"text":" mundo","extra":true}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );

      const stream = await streamAiProxy(baseRequest);
      expect(stream).not.toBeNull();
      let collected = '';
      for await (const chunk of stream as AsyncIterable<{ text: string }>) {
        collected += chunk.text;
      }
      expect(collected).toBe('hola mundo');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/ai');
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(sent.stream).toBe(true);
      expect(sent.provider).toBe('gemini');
    });

    it('skips malformed/keep-alive frames and stops at [DONE]', async () => {
      setProxyUrl('/api/ai');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          sseStream([
            ': ping\n\n',
            'data: not-json\n\n',
            'data: {"text":"a","extra":true}\n\n',
            'data: {"text":"b"}\n\n',
            'data: [DONE]\n\n',
          ]),
          { status: 200 },
        ),
      );

      const stream = await streamAiProxy(baseRequest);
      let collected = '';
      for await (const chunk of stream as AsyncIterable<{ text: string }>) {
        collected += chunk.text;
      }
      expect(collected).toBe('ab');
    });

    it('returns null on a non-2xx proxy response so the caller falls back', async () => {
      setProxyUrl('/api/ai');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'proxy_rate_limited' }), { status: 429 }),
      );

      expect(await streamAiProxy(baseRequest)).toBeNull();
    });

    it('returns null when the proxy open fails', async () => {
      setProxyUrl('/api/ai');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

      expect(await streamAiProxy(baseRequest)).toBeNull();
    });
  });
