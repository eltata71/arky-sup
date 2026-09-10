import { describe, it, expect } from 'vitest';
import {
    parseColor,
    relativeLuminance,
    contrastRatio,
    evaluateContrast,
    evaluateNodeContrast,
    compositeOver,
} from '../../lib/colorContrast';

describe('Phase 3 — colour contrast (WCAG 2.1)', () => {
    it('parses #rrggbb hex strings', () => {
        expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    });

    it('parses #rgb shorthand', () => {
        expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    });

    it('parses #rrggbbaa', () => {
        const c = parseColor('#11223380');
        expect(c?.r).toBe(0x11);
        expect(c?.a).toBeCloseTo(0x80 / 255, 3);
    });

    it('parses rgb()/rgba()', () => {
        expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
        const c = parseColor('rgba(0, 0, 0, 0.5)');
        expect(c?.a).toBe(0.5);
    });

    it('returns null for malformed inputs', () => {
        expect(parseColor('')).toBeNull();
        expect(parseColor('chartreuse')).toBeNull();
        expect(parseColor('#zz')).toBeNull();
        expect(parseColor(undefined)).toBeNull();
    });

    it('computes relative luminance for white and black correctly', () => {
        expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 4);
        expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 4);
    });

    it('computes the canonical 21:1 contrast ratio for black/white', () => {
        const ratio = contrastRatio(
            { r: 0, g: 0, b: 0, a: 1 },
            { r: 255, g: 255, b: 255, a: 1 },
        );
        expect(ratio).toBeCloseTo(21, 1);
    });

    it('white text on black background passes AAA', () => {
        const verdict = evaluateContrast('#ffffff', '#000000');
        expect(verdict?.level).toBe('aaa');
        expect(verdict?.passesAAANormal).toBe(true);
    });

    it('mid-gray text on white background fails AA', () => {
        const verdict = evaluateContrast('#bbbbbb', '#ffffff');
        expect(verdict?.level).toBe('fail');
        expect(verdict?.passesAANormal).toBe(false);
    });

    it('composites alpha foreground over background before evaluating', () => {
        // Translucent white over black → mid-gray, contrast should drop.
        const composed = compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
        expect(composed.r).toBeGreaterThan(120);
        expect(composed.r).toBeLessThan(140);
    });

    it('evaluateNodeContrast warns when text fails AA and suggests a safer text colour', () => {
        const result = evaluateNodeContrast('#ffff00', '#ffffff'); // yellow bg + white text
        expect(result.needsWarning).toBe(true);
        // Yellow background has high luminance → suggested text is dark
        expect(result.suggestedTextColor).toBe('#0f172a');
    });

    it('evaluateNodeContrast keeps AAA combinations silent', () => {
        const result = evaluateNodeContrast('#0f172a', '#f8fafc'); // dark bg + near-white text
        expect(result.needsWarning).toBe(false);
        expect(result.suggestedTextColor).toBeNull();
    });
});
