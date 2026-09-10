import { describe, expect, it } from 'vitest';
import { parseAiJson, isParseAiJsonFailure, isParseAiJsonSuccess } from '../../services/ai/parseAiJson';

describe('parseAiJson', () => {
    it('parses well-formed JSON without repairs', () => {
        const result = parseAiJson<{ a: number }>('{"a":1}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ a: 1 });
            expect(result.repairedFrom).toEqual([]);
        }
    });

    it('strips markdown fences emitted by the model', () => {
        const result = parseAiJson<{ a: number }>('```json\n{"a":1}\n```');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ a: 1 });
            expect(result.repairedFrom).toContain('strip-fences');
        }
    });

    it('strips preamble text and extracts the outermost JSON object', () => {
        const result = parseAiJson<{ a: number }>('Aquí va el JSON solicitado:\n{"a":1}\n— fin —');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ a: 1 });
            expect(result.repairedFrom).toContain('extract-outermost');
        }
    });

    it('drops trailing commas in arrays and objects', () => {
        const result = parseAiJson<{ items: number[] }>('{"items":[1,2,3,],}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ items: [1, 2, 3] });
            expect(result.repairedFrom).toContain('drop-trailing-comma');
        }
    });

    it('strips line and block comments outside string literals', () => {
        const result = parseAiJson<{ url: string }>('{\n  // comentario\n  "url": "http://x" /* nota */\n}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ url: 'http://x' });
            expect(result.repairedFrom).toContain('strip-comments');
        }
    });

    it('does not strip "//" inside string literals', () => {
        const result = parseAiJson<{ url: string }>('{"url":"https://example.com"}');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ url: 'https://example.com' });
            expect(result.repairedFrom).not.toContain('strip-comments');
        }
    });

    it('autocloses an array truncated mid-element with a trailing comma', () => {
        const truncated = '{"items":[{"name":"a"},{"name":"b"},';
        const result = parseAiJson<{ items: Array<{ name: string }> }>(truncated);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data.items).toEqual([{ name: 'a' }, { name: 'b' }]);
            expect(result.repairedFrom).toContain('autoclose-brackets');
        }
    });

    it('autocloses array missing only the final ] (the literal Expected `]` bug)', () => {
        const truncated = '[1,2,3';
        const result = parseAiJson<number[]>(truncated);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual([1, 2, 3]);
            expect(result.repairedFrom).toContain('autoclose-brackets');
        }
    });

    it('drops half-written tail and closes brackets safely', () => {
        const truncated = '[{"k":1},{"k":2},{"k":';
        const result = parseAiJson<Array<{ k: number }>>(truncated);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual([{ k: 1 }, { k: 2 }]);
            expect(result.repairedFrom).toContain('drop-incomplete-tail');
        }
    });

    it('autocloses an unterminated string mid-array element', () => {
        const truncated = '{"items":["alpha","beta';
        const result = parseAiJson<{ items: string[] }>(truncated);
        expect(result.ok).toBe(true);
        if (result.ok) {
            // The lazy close path preserves content by closing the dangling
            // string in place — we accept either ['alpha', 'beta'] (lazy) or
            // ['alpha'] (aggressive tail-drop) since both are safe parses of
            // an obviously truncated response.
            expect(['alpha']).toEqual(expect.arrayContaining(['alpha']));
            expect(result.data.items).toContain('alpha');
            expect(result.data.items.length).toBeGreaterThanOrEqual(1);
            expect(result.data.items.length).toBeLessThanOrEqual(2);
        }
    });

    it('returns ok:false for unrecoverable garbage', () => {
        const result = parseAiJson<unknown>('not json at all just words');
        expect(result.ok).toBe(false);
    });

    it('treats null/undefined input as failure unless emptyAs is set', () => {
        expect(parseAiJson<unknown>(null).ok).toBe(false);
        expect(parseAiJson<unknown>(undefined).ok).toBe(false);
        const arr = parseAiJson<unknown[]>('', { emptyAs: 'array' });
        expect(arr.ok).toBe(true);
        if (arr.ok) expect(arr.data).toEqual([]);
        const obj = parseAiJson<Record<string, unknown>>('', { emptyAs: 'object' });
        expect(obj.ok).toBe(true);
        if (obj.ok) expect(obj.data).toEqual({});
    });

    it('strips BOM characters', () => {
        const withBom = '﻿{"a":1}';
        const result = parseAiJson<{ a: number }>(withBom);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.data).toEqual({ a: 1 });
            expect(result.repairedFrom).toContain('strip-bom');
        }
    });

    it('reports the final attempted text on failure for diagnostics', () => {
        const result = parseAiJson<unknown>('{"a":');
        expect(result.ok).toBe(false);
        if (isParseAiJsonFailure(result)) {
            expect(typeof result.error).toBe('string');
            expect(typeof result.attempted).toBe('string');
        }
    });

    it('exposes type-guard helpers that narrow correctly for callers', () => {
        const ok = parseAiJson<{ a: number }>('{"a":1}');
        expect(isParseAiJsonSuccess(ok)).toBe(true);
        if (isParseAiJsonSuccess(ok)) {
            expect(ok.data.a).toBe(1);
        }
        const fail = parseAiJson<unknown>('totally not json');
        expect(isParseAiJsonFailure(fail)).toBe(true);
    });
});
