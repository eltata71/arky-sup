import { describe, expect, it } from 'vitest';
import { DIAGRAM_THEMES, getTheme, DEFAULT_THEME } from '../../lib/diagramThemes';

describe('diagramThemes', () => {
    it('exposes the four canonical themes', () => {
        expect(Object.keys(DIAGRAM_THEMES).sort()).toEqual(['editorial', 'high-contrast', 'monochrome', 'whiteboard']);
    });

    it('defaults to editorial', () => {
        expect(DEFAULT_THEME).toBe('editorial');
        expect(getTheme().id).toBe('editorial');
        expect(getTheme(undefined).id).toBe('editorial');
    });

    it('whiteboard introduces roughness, editorial does not', () => {
        expect(getTheme('whiteboard').node.roughness).toBeGreaterThan(0);
        expect(getTheme('editorial').node.roughness).toBe(0);
    });

    it('high-contrast has the thickest strokes', () => {
        const editorial = getTheme('editorial');
        const hc = getTheme('high-contrast');
        expect(hc.node.strokeWidthScale).toBeGreaterThan(editorial.node.strokeWidthScale);
        expect(hc.edge.strokeWidthScale).toBeGreaterThan(editorial.edge.strokeWidthScale);
    });
});
