/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LucidApiError,
    createLucidDocumentFromMermaid,
    createLucidEmbedSession,
    createLucidShareLink,
    exportLucidDocumentAsPNG,
    getLucidConfig,
    setUserLucidToken,
} from '../../services/lucid/lucidService';

const originalFetch = globalThis.fetch;

beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('getLucidConfig', () => {
    it('reports no token when neither localStorage nor env is populated', () => {
        const cfg = getLucidConfig();
        expect(cfg.hasToken).toBe(false);
        expect(cfg.source).toBe('none');
        expect(cfg.token).toBeNull();
    });

    it('prefers user localStorage token over global env', () => {
        setUserLucidToken('user-token');
        const cfg = getLucidConfig();
        expect(cfg.hasToken).toBe(true);
        expect(cfg.source).toBe('user');
        expect(cfg.token).toBe('user-token');
    });

    it('setUserLucidToken(null) removes the stored token', () => {
        setUserLucidToken('abc');
        setUserLucidToken(null);
        expect(getLucidConfig().hasToken).toBe(false);
    });
});

describe('lucid fetch wrapper', () => {
    it('throws 401 LucidApiError when no token is configured', async () => {
        await expect(createLucidEmbedSession('doc1')).rejects.toBeInstanceOf(LucidApiError);
    });

    it('createLucidDocumentFromMermaid POSTs multipart with bearer token', async () => {
        setUserLucidToken('tok-123');
        const mockResponse = new Response(JSON.stringify({ documentId: 'doc-1', editUrl: 'https://lucid.app/lucidchart/doc-1/edit' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
        globalThis.fetch = fetchSpy as unknown as typeof fetch;

        const result = await createLucidDocumentFromMermaid({ title: 'Demo', mermaid: 'flowchart LR\n A --> B' });

        expect(result.documentId).toBe('doc-1');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toContain('/documents');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
        expect(init.body).toBeInstanceOf(FormData);
    });

    it('createLucidEmbedSession posts JSON and bubbles up server error messages', async () => {
        setUserLucidToken('tok-123');
        const error = new Response(JSON.stringify({ message: 'rate limited', code: 'too_many' }), { status: 429 });
        globalThis.fetch = vi.fn().mockResolvedValue(error) as unknown as typeof fetch;

        await expect(createLucidEmbedSession('doc-1')).rejects.toMatchObject({
            name: 'LucidApiError',
            status: 429,
            message: 'rate limited',
            code: 'too_many',
        });
    });

    it('createLucidShareLink returns the payload verbatim', async () => {
        setUserLucidToken('tok-123');
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ url: 'https://share.lucid/abc', role: 'viewer' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }),
        ) as unknown as typeof fetch;
        const result = await createLucidShareLink('doc-1', 'viewer');
        expect(result.url).toBe('https://share.lucid/abc');
        expect(result.role).toBe('viewer');
    });

    it('exportLucidDocumentAsPNG returns a blob URL', async () => {
        setUserLucidToken('tok-123');
        const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            blob: () => Promise.resolve(blob),
        }) as unknown as typeof fetch;
        const originalCreate = URL.createObjectURL;
        URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
        try {
            const url = await exportLucidDocumentAsPNG('doc-1');
            expect(url).toBe('blob:mock');
        } finally {
            URL.createObjectURL = originalCreate;
        }
    });
});
