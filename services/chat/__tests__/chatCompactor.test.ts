import { describe, it, expect } from 'vitest';
import { deterministicCompactionDigest } from '../chatCompactor';
import type { ChatMessage } from '../../../types';

describe('deterministicCompactionDigest', () => {
    it('returns a safe placeholder when no messages are given', () => {
        const digest = deterministicCompactionDigest([]);
        expect(digest.title).toBe('Sin mensajes');
        expect(digest.summary.length).toBeGreaterThan(0);
        expect(digest.decisions).toEqual([]);
        expect(digest.openQuestions).toEqual([]);
        expect(digest.topics).toEqual([]);
    });

    it('uses the first user message as the title when present', () => {
        const messages: ChatMessage[] = [
            { role: 'model', content: 'Hola, ¿en qué te ayudo?' },
            { role: 'user', content: 'Quiero modelar una arquitectura serverless' },
            { role: 'model', content: 'Perfecto, comencemos por el contexto…' },
        ];
        const digest = deterministicCompactionDigest(messages);
        expect(digest.title).toContain('serverless');
    });

    it('falls back to the first message when no user message exists', () => {
        const messages: ChatMessage[] = [
            { role: 'model', content: 'Bienvenido a ArkyPro.' },
        ];
        const digest = deterministicCompactionDigest(messages);
        expect(digest.title).toContain('Bienvenido');
    });

    it('counts role distribution in the summary', () => {
        const messages: ChatMessage[] = [
            { role: 'user', content: 'a' },
            { role: 'user', content: 'b' },
            { role: 'model', content: 'c' },
        ];
        const digest = deterministicCompactionDigest(messages);
        expect(digest.summary).toContain('3 mensaje(s)');
        expect(digest.summary).toContain('2 del usuario');
        expect(digest.summary).toContain('1 del Arquitecto Agente');
    });

    it('caps the summary length to a reasonable bound', () => {
        const longContent = 'palabra '.repeat(500);
        const messages: ChatMessage[] = [{ role: 'user', content: longContent }];
        const digest = deterministicCompactionDigest(messages);
        expect(digest.summary.length).toBeLessThanOrEqual(700);
    });
});
