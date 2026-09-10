/**
 * WCAG 2.1 colour contrast utilities.
 *
 * Phase 3 surfaces a contrast warning when the architect picks a custom
 * node colour that would make the label illegible. The functions here
 * are deterministic and dependency-free; they take hex / rgb / rgba
 * strings and return the relative luminance, the contrast ratio and a
 * pass/fail verdict against AA / AAA.
 *
 * We deliberately keep the API tiny: one normaliser, one luminance
 * computation, one contrast ratio, and one verdict. Higher-level
 * helpers (`evaluateNodeContrast`) wrap these for the renderer / the
 * inspector.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

export type WCAGLevel = 'AA' | 'AAA';

export interface ContrastVerdict {
    ratio: number;
    /** Passes WCAG AA for normal text (4.5:1). */
    passesAANormal: boolean;
    /** Passes WCAG AA for large text (3:1). */
    passesAALarge: boolean;
    /** Passes WCAG AAA for normal text (7:1). */
    passesAAANormal: boolean;
    /** Aggregate verdict suitable for a single UI badge. */
    level: 'aaa' | 'aa' | 'aa-large' | 'fail';
}

export interface RGB {
    r: number;
    g: number;
    b: number;
    a: number; // 0..1
}

/**
 * Parse a CSS colour string into an RGBA object. Supports:
 *  - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
 *  - `rgb(r,g,b)` and `rgba(r,g,b,a)`
 *
 * Returns `null` when the string is not parseable so callers can degrade
 * gracefully instead of crashing on user-supplied input.
 */
export function parseColor(input: string | undefined | null): RGB | null {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim().toLowerCase();
    if (trimmed.length === 0) return null;

    if (trimmed.startsWith('#')) {
        const hex = trimmed.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
            if ([r, g, b].some(Number.isNaN)) return null;
            return { r, g, b, a };
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            if ([r, g, b].some(Number.isNaN)) return null;
            return { r, g, b, a };
        }
        return null;
    }

    const rgbMatch = trimmed.match(/^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
    if (rgbMatch) {
        const r = Math.round(Number(rgbMatch[1]));
        const g = Math.round(Number(rgbMatch[2]));
        const b = Math.round(Number(rgbMatch[3]));
        const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
        if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
        return { r, g, b, a };
    }

    return null;
}

/**
 * Composite `foreground` over `background` honouring the foreground's
 * alpha channel. Returns a fully opaque RGB suitable for luminance
 * calculations.
 */
export function compositeOver(foreground: RGB, background: RGB): RGB {
    const alpha = foreground.a;
    return {
        r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
        g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
        b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
        a: 1,
    };
}

function channelToLinear(value: number): number {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.1 §1.4.3. */
export function relativeLuminance(color: RGB): number {
    const r = channelToLinear(color.r);
    const g = channelToLinear(color.g);
    const b = channelToLinear(color.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two opaque colours per WCAG 2.1 §1.4.3. */
export function contrastRatio(a: RGB, b: RGB): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * Evaluate two colours against WCAG AA/AAA thresholds.
 *
 *  - `text` is composited over `background` first (so a translucent text
 *    colour is evaluated as it would actually render).
 *  - `largeText` switches to 3:1/4.5:1 thresholds when the text is ≥18pt
 *    regular or ≥14pt bold per the spec.
 */
export function evaluateContrast(
    text: string,
    background: string,
    options: { largeText?: boolean; fallbackBg?: RGB } = {},
): ContrastVerdict | null {
    const fg = parseColor(text);
    const bg = parseColor(background) ?? options.fallbackBg ?? null;
    if (!fg || !bg) return null;
    const fgComposite = fg.a < 1 ? compositeOver(fg, bg) : fg;
    const ratio = contrastRatio(fgComposite, bg);
    const verdict: ContrastVerdict = {
        ratio,
        passesAANormal: ratio >= 4.5,
        passesAALarge: ratio >= 3,
        passesAAANormal: ratio >= 7,
        level: 'fail',
    };
    if (verdict.passesAAANormal) verdict.level = 'aaa';
    else if (verdict.passesAANormal) verdict.level = 'aa';
    else if (verdict.passesAALarge && options.largeText) verdict.level = 'aa-large';
    return verdict;
}

/**
 * Convenience wrapper used by `CustomNode` to validate a user-supplied
 * background colour against the card's text colour. Returns a short,
 * inspectable summary the UI can render as a tooltip / inline warning.
 */
export function evaluateNodeContrast(
    backgroundColor: string,
    textColor: string,
): { verdict: ContrastVerdict | null; needsWarning: boolean; suggestedTextColor: string | null } {
    const verdict = evaluateContrast(textColor, backgroundColor);
    if (!verdict) return { verdict: null, needsWarning: false, suggestedTextColor: null };
    const needsWarning = !verdict.passesAANormal;
    let suggestedTextColor: string | null = null;
    if (needsWarning) {
        const bg = parseColor(backgroundColor);
        if (bg) {
            const lum = relativeLuminance(bg);
            // Prefer the high-contrast text colour the canvas already uses
            // for accessible cards: near-black for light backgrounds and
            // near-white for dark backgrounds. The caller can override this
            // in the UI.
            suggestedTextColor = lum > 0.5 ? '#0f172a' : '#f8fafc';
        }
    }
    return { verdict, needsWarning, suggestedTextColor };
}
