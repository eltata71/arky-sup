import { describe, it, expect } from 'vitest';
import { __test__ } from '../../services/geminiService';
import { DIAGRAM_SYSTEM_INSTRUCTION } from '../../services/ai/prompts/diagramPrompts';

const { buildDiagramGenerationConfig, THINKING_BUDGET } = __test__;

describe('buildDiagramGenerationConfig', () => {
    it('attaches the canonical system instruction unchanged when no extras are given', () => {
        const cfg = buildDiagramGenerationConfig();
        expect(cfg.systemInstruction).toBe(DIAGRAM_SYSTEM_INSTRUCTION);
        // Same input → identical bytes → same Gemini implicit-cache key.
        const cfg2 = buildDiagramGenerationConfig();
        expect(cfg2.systemInstruction).toBe(cfg.systemInstruction);
    });

    it('appends extra system instruction after the canonical block (cache-friendly prefix preserved)', () => {
        const cfg = buildDiagramGenerationConfig({ extraSystemInstruction: 'C4 dialect rules.' });
        expect(cfg.systemInstruction.startsWith(DIAGRAM_SYSTEM_INSTRUCTION)).toBe(true);
        expect(cfg.systemInstruction.endsWith('C4 dialect rules.')).toBe(true);
    });

    it('caps temperature default at 0.3 (diagram-safe) and exposes topP', () => {
        const cfg = buildDiagramGenerationConfig();
        expect(cfg.temperature).toBe(0.3);
        expect(cfg.topP).toBe(0.9);
    });

    it('thinking buckets resolve to deterministic Gemini-safe budgets', () => {
        expect(THINKING_BUDGET.off).toBe(0);
        // Flash-Lite rejects enabled thinking budgets below 512 with
        // INVALID_ARGUMENT; low is the minimum portable enabled budget.
        expect(THINKING_BUDGET.low).toBe(512);
        expect(THINKING_BUDGET.medium).toBeGreaterThan(THINKING_BUDGET.low);
        expect(THINKING_BUDGET.high).toBeGreaterThan(THINKING_BUDGET.medium);
    });

    it('attaches thinkingConfig with the bucket budget', () => {
        const off = buildDiagramGenerationConfig({ thinking: 'off' });
        expect(off.thinkingConfig).toEqual({ thinkingBudget: 0 });

        const high = buildDiagramGenerationConfig({ thinking: 'high' });
        expect(high.thinkingConfig.thinkingBudget).toBe(THINKING_BUDGET.high);
    });

    it('wires responseSchema only when supplied, defaulting mime to application/json', () => {
        const noSchema = buildDiagramGenerationConfig();
        expect(noSchema.responseSchema).toBeUndefined();
        expect(noSchema.responseMimeType).toBeUndefined();

        const withSchema = buildDiagramGenerationConfig({ responseSchema: { type: 'object' } });
        expect(withSchema.responseSchema).toEqual({ type: 'object' });
        expect(withSchema.responseMimeType).toBe('application/json');
    });

    it('honours an explicit responseMimeType override', () => {
        const cfg = buildDiagramGenerationConfig({
            responseSchema: { type: 'array' },
            responseMimeType: 'text/plain',
        });
        expect(cfg.responseMimeType).toBe('text/plain');
    });
});
