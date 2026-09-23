import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    classifyAIError,
    isTransientGeminiError,
    AIServiceError,
} from '../../services/geminiService';
import { LegacyGenerationTransport } from '../../services/ai/generation/legacyTransport';
import type { Settings } from '../../types';

describe('isTransientGeminiError', () => {
    it('treats 503 status as transient', () => {
        expect(isTransientGeminiError({ status: 503, message: 'Unavailable' })).toBe(true);
    });

    it('treats 429 status as transient', () => {
        expect(isTransientGeminiError({ status: 429, message: 'Too many requests' })).toBe(true);
    });

    it('treats nested error.code = 503 as transient', () => {
        // Some SDK error shapes nest the code under .error
        expect(isTransientGeminiError({ error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } })).toBe(true);
    });

    it('treats network "fetch failed" messages as transient', () => {
        expect(isTransientGeminiError({ message: 'fetch failed' })).toBe(true);
    });

    it('treats Safari/iOS "Load failed" as transient', () => {
        // Safari surfaces every aborted/CORS-killed fetch with the generic
        // message "Load failed". Without this branch the UI would show an
        // opaque "Ocurrió un error inesperado" instead of recovering.
        expect(isTransientGeminiError({ message: 'Load failed' })).toBe(true);
        expect(isTransientGeminiError(new Error('Load failed'))).toBe(true);
    });

    it('treats AbortError / TimeoutError DOMException-like errors as transient', () => {
        const aborted: unknown = { name: 'AbortError', message: 'The operation was aborted.' };
        const timed:  unknown  = { name: 'TimeoutError', message: 'Request timed out' };
        expect(isTransientGeminiError(aborted)).toBe(true);
        expect(isTransientGeminiError(timed)).toBe(true);
    });

    it('treats 5xx infrastructure blips as transient', () => {
        expect(isTransientGeminiError({ status: 502, message: 'Bad Gateway' })).toBe(true);
        expect(isTransientGeminiError({ status: 504, message: 'Gateway Timeout' })).toBe(true);
    });

    it('treats high-demand wording as transient', () => {
        expect(isTransientGeminiError({ message: 'This model is currently experiencing high demand.' })).toBe(true);
    });

    it('treats 401 / auth errors as non-transient', () => {
        expect(isTransientGeminiError({ status: 401, message: 'API key invalid' })).toBe(false);
    });

    it('treats 400 / invalid-request as non-transient', () => {
        expect(isTransientGeminiError({ status: 400, message: 'Invalid request' })).toBe(false);
    });

    it('returns false for empty / null inputs', () => {
        expect(isTransientGeminiError(null)).toBe(false);
        expect(isTransientGeminiError(undefined)).toBe(false);
        expect(isTransientGeminiError({})).toBe(false);
    });
});

describe('classifyAIError', () => {
    it('produces an "overloaded" category for 503', () => {
        const err = classifyAIError({ status: 503, message: 'high demand' });
        expect(err).toBeInstanceOf(AIServiceError);
        expect(err.category).toBe('overloaded');
        expect(err.retryable).toBe(true);
        expect(err.userMessage).toMatch(/saturado/i);
    });

    it('produces a "rate-limit" category for 429', () => {
        const err = classifyAIError({ status: 429, message: 'quota exceeded' });
        expect(err.category).toBe('rate-limit');
        expect(err.retryable).toBe(true);
        expect(err.userMessage).toMatch(/límite/i);
    });

    it('produces an "auth" category for 401/403 — non-retryable', () => {
        const e1 = classifyAIError({ status: 401, message: 'bad api key' });
        expect(e1.category).toBe('auth');
        expect(e1.retryable).toBe(false);
        const e2 = classifyAIError({ status: 403, message: 'permission denied' });
        expect(e2.category).toBe('auth');
        expect(e2.retryable).toBe(false);
    });

    it('produces an "invalid-request" category for 400 — non-retryable', () => {
        const err = classifyAIError({ status: 400, message: 'invalid' });
        expect(err.category).toBe('invalid-request');
        expect(err.retryable).toBe(false);
    });

    it('produces a "timeout" category for timeout messages', () => {
        const err = classifyAIError(new Error('Request timed out after 180000ms'));
        expect(err.category).toBe('timeout');
        expect(err.retryable).toBe(true);
    });

    it('produces a "network" category for fetch failed', () => {
        const err = classifyAIError(new Error('fetch failed'));
        expect(err.category).toBe('network');
        expect(err.retryable).toBe(true);
    });

    it('produces a "network" category for Safari "Load failed"', () => {
        const err = classifyAIError(new Error('Load failed'));
        expect(err.category).toBe('network');
        expect(err.retryable).toBe(true);
    });

    it('produces a "timeout" category for AbortError-like errors', () => {
        const err = classifyAIError({ name: 'AbortError', message: 'The operation was aborted.' });
        expect(err.category).toBe('timeout');
        expect(err.retryable).toBe(true);
    });

    it('returns the same instance when already a AIServiceError', () => {
        const original = new AIServiceError('overloaded', 503, 'orig', 'user', true);
        expect(classifyAIError(original)).toBe(original);
    });

    it('falls back to "unknown" when nothing matches', () => {
        const err = classifyAIError({});
        expect(err.category).toBe('unknown');
        expect(err.retryable).toBe(true);
    });

    it('classifies 500 INTERNAL as overloaded (transient, retryable)', () => {
        const err = classifyAIError({
            name: 'ApiError',
            status: 500,
            message: '{"error":{"code":500,"message":"Internal error encountered","status":"INTERNAL"}}',
        });
        expect(err.category).toBe('overloaded');
        expect(err.retryable).toBe(true);
    });

    it('classifies 502/504 as overloaded (transient)', () => {
        expect(classifyAIError({ status: 502, message: 'Bad Gateway' }).category).toBe('overloaded');
        expect(classifyAIError({ status: 504, message: 'Gateway Timeout' }).category).toBe('overloaded');
    });

    it('parses HTTP status from the SDK "got status: NNN" message prefix', () => {
        // The @google/genai SDK wraps streaming errors as
        // "got status: 503. {...}" with no top-level .status field.
        const err = classifyAIError(new Error('got status: 503. {"error":{"code":503,"status":"UNAVAILABLE"}}'));
        expect(err.category).toBe('overloaded');
        expect(err.status).toBe(503);
        expect(err.retryable).toBe(true);
    });

    it('parses status + message from a JSON-stringified SDK ApiError', () => {
        const err = classifyAIError({
            name: 'ApiError',
            status: 400,
            message: '{"error":{"code":400,"message":"Invalid responseSchema field","status":"INVALID_ARGUMENT"}}',
        });
        expect(err.category).toBe('invalid-request');
        expect(err.status).toBe(400);
        expect(err.message).toMatch(/Invalid responseSchema/i);
    });

    it('preserves the original error as cause', () => {
        const orig = { status: 503, message: 'boom' };
        const err = classifyAIError(orig);
        expect(err.cause).toBe(orig);
    });
});

describe('retry decisions on the generation transport', () => {
    // These assertions used to target the engine's private `retryWithBackoff`.
    // Its last caller — the custom-artifact recommender — left the engine in
    // F5-01 (corte 4) and now reaches a model through `aiGateway`, so the
    // helper was deleted. The rules it pinned still hold, on the path every
    // generation actually takes: the transport's retry loop.
    const settings = { aiConfig: { model: 'gemini-2.5-flash', apiKeySource: 'global' } } as unknown as Settings;
    const transport = new LegacyGenerationTransport({ getClient: () => ({}) as never });
    const run = <T>(fn: () => Promise<T>, maxRetries: number) =>
        transport.runWithModelFallback(settings, 'gemini-2.5-flash', () => fn(), { maxRetries, maxCandidates: 1, timeoutMs: 60_000 });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns immediately on first success', async () => {
        const fn = vi.fn(async () => 42);
        const promise = run(fn, 2);
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on 503 and eventually succeeds', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce({ status: 503, message: 'overloaded' })
            .mockRejectedValueOnce({ status: 503, message: 'overloaded' })
            .mockResolvedValueOnce('ok');
        const promise = run(fn, 4);
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on 429 / rate limit to avoid quota amplification', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce({ status: 429, message: 'rate' })
            .mockResolvedValueOnce('ok');
        const promise = run(fn, 2).catch((e) => e);
        await vi.runAllTimersAsync();
        const err = await promise;
        expect(err).toBeInstanceOf(AIServiceError);
        expect((err as AIServiceError).category).toBe('rate-limit');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-transient (401) and rewraps as AIServiceError', async () => {
        const fn = vi.fn().mockRejectedValue({ status: 401, message: 'bad key' });
        const promise = run(fn, 4).catch((e) => e);
        await vi.runAllTimersAsync();
        const err = await promise;
        expect(err).toBeInstanceOf(AIServiceError);
        expect((err as AIServiceError).category).toBe('auth');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('exhausts retries and rewraps the final transient error', async () => {
        const fn = vi.fn().mockRejectedValue({ status: 503, message: 'overloaded' });
        const promise = run(fn, 2).catch((e) => e);
        await vi.runAllTimersAsync();
        const err = await promise;
        expect(err).toBeInstanceOf(AIServiceError);
        expect((err as AIServiceError).category).toBe('overloaded');
        // initial call + 2 retries = 3 attempts
        expect(fn).toHaveBeenCalledTimes(3);
    });
});

describe('classifyAIError — malformed responses', () => {
    it('classifies SDK JSON parse errors as malformed-response instead of unknown', () => {
        const err = classifyAIError(new Error("JSON Parse error: Expected ']'") );
        expect(err.category).toBe('malformed-response');
        expect(err.retryable).toBe(true);
        expect(err.userMessage).toMatch(/malformada/i);
    });
});
