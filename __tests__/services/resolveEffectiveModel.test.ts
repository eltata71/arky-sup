import { describe, expect, it } from 'vitest';
import {
    resolveEffectiveModel,
    DEFAULT_TEXT_MODEL,
    MODEL_TIERS,
    IMAGE_MODEL,
    TTS_MODEL,
} from '../../lib/ai/modelCatalog';
import type { Settings } from '../../types';

const baseSettings = (overrides: Partial<Settings['aiConfig']> = {}): Settings => ({
    theme: 'dark',
    language: 'es',
    globalContext: [],
    aiConfig: {
        model: '',
        temperature: 0.7,
        tone: 'Profesional y Técnico',
        languageStyle: 'Conciso y directo',
        apiKeySource: 'global',
        ...overrides,
    },
});

describe('resolveEffectiveModel', () => {
    it('returns the tier default with source=global when the user has no preference', () => {
        const result = resolveEffectiveModel('default', baseSettings({ model: '' }));
        expect(result.id).toBe(MODEL_TIERS.default);
        expect(result.source).toBe('global');
        expect(result.tier).toBe('default');
    });

    it('honours the user preference for default tier and reports source=user', () => {
        const result = resolveEffectiveModel('default', baseSettings({ model: 'gemini-2.5-pro' }));
        expect(result.id).toBe('gemini-2.5-pro');
        expect(result.source).toBe('user');
        expect(result.requested).toBe('gemini-2.5-pro');
    });

    it('keeps the deep tier on Pro even when the user selected Flash', () => {
        const result = resolveEffectiveModel('deep', baseSettings({ model: 'gemini-2.5-flash' }));
        expect(result.id).toBe(MODEL_TIERS.deep);
        expect(result.source).toBe('tier-floor');
    });

    it('forces stable Flash-Lite for the quick tier even when the user picked pro, with source=tier-floor', () => {
        const result = resolveEffectiveModel('quick', baseSettings({ model: 'gemini-2.5-pro' }));
        expect(result.id).toBe(MODEL_TIERS.quick);
        expect(result.source).toBe('tier-floor');
        expect(result.requested).toBe('gemini-2.5-pro');
    });

    it('returns fallback source when settings is missing entirely', () => {
        const result = resolveEffectiveModel('default', undefined);
        expect(result.source).toBe('fallback');
        expect(result.id).toBe(DEFAULT_TEXT_MODEL);
    });

    it('normalises deprecated preview ids to a stable supported model', () => {
        const result = resolveEffectiveModel('default', baseSettings({ model: 'gemini-3-flash-preview' }));
        expect(result.id).toBe(DEFAULT_TEXT_MODEL);
        expect(result.source).toBe('user');
        expect(result.requested).toBe('gemini-3-flash-preview');
    });

    it('preserves the stable quick model when explicitly selected for the standard tier', () => {
        expect(resolveEffectiveModel('default', baseSettings({ model: MODEL_TIERS.quick })).id).toBe(MODEL_TIERS.quick);
    });

    it('exposes IMAGE_MODEL and TTS_MODEL as centralised constants', () => {
        expect(IMAGE_MODEL).toMatch(/image/);
        expect(TTS_MODEL).toMatch(/tts/);
    });
});
