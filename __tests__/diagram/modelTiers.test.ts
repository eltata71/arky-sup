import { describe, it, expect } from 'vitest';
import { MODEL_TIERS, resolveTierModel, DEFAULT_TEXT_MODEL } from '../../lib/ai/modelCatalog';

describe('MODEL_TIERS', () => {
    it('quick tier maps to stable Flash-Lite for mechanical hops', () => {
        expect(MODEL_TIERS.quick).toBe('gemini-3.1-flash-lite');
    });

    it('default tier matches the canonical default text model', () => {
        expect(MODEL_TIERS.default).toBe(DEFAULT_TEXT_MODEL);
    });

    it('deep tier reserves a flagship reasoning model', () => {
        expect(MODEL_TIERS.deep).toBe('gemini-2.5-pro');
    });
});

describe('resolveTierModel', () => {
    it('quick tier ignores the user model and locks to stable Flash-Lite', () => {
        // Mechanical tasks must remain available even when the user
        // selected a heavier model in Settings.
        expect(resolveTierModel('quick', 'gemini-2.5-pro')).toBe('gemini-3.1-flash-lite');
        expect(resolveTierModel('quick')).toBe('gemini-3.1-flash-lite');
    });

    it('default tier honours the user-selected model when present', () => {
        expect(resolveTierModel('default', 'gemini-2.5-pro')).toBe('gemini-2.5-pro');
    });

    it('default tier falls back to the canonical default when no user choice exists', () => {
        expect(resolveTierModel('default')).toBe(DEFAULT_TEXT_MODEL);
        expect(resolveTierModel('default', '')).toBe(DEFAULT_TEXT_MODEL);
    });
});
